import { createHash } from "node:crypto";
import { Prisma, prisma } from "@/lib/prisma";
import {
  CATALOG_GOVERNANCE_MAX_BYTES,
  CATALOG_GOVERNANCE_HEADERS,
  CatalogCsvError,
  catalogRowsToCsv,
  normalizeCatalogText,
  parseCatalogGovernanceCsv,
  safeCatalogDownloadName,
  neutralizeCsvCell,
  type CatalogSourceRow,
} from "./csv";
import {
  catalogActorPseudonym,
  assertCatalogRetryPreviewActionable,
  buildCatalogSubmissionPreview,
  buildCatalogPreviewDependencyDigests,
  catalogDependencyDigest,
  classifyCatalogReviewRisk,
  CATALOG_REVIEW_RISK_VERSION,
  CATALOG_SUBMISSION_VERSIONS,
  deterministicBatchRequestOperationId,
  deterministicSubmissionProposalGroupId,
  describeCatalogBatchError,
  isCanonicalUuid,
  refreshSubmissionExpiry,
  submissionExpiry,
  type CatalogDatabaseSenseSnapshot,
  type CatalogPendingDependencySnapshot,
  type SubmissionResolution,
} from "./submission";
import {
  parseCatalogGovernancePayload,
  payloadFingerprint,
  payloadFromRevision,
  payloadToSourceRow,
} from "./governance";
import { bumpCatalogMutationState, reviewCatalogChange } from "./change-application";
import {
  catalogReviewerHasAuthorityAfterLock,
  lockCatalogReviewUsers,
  requireCatalogReviewerInTransaction,
} from "./access";
import {
  CATALOG_SUBMISSION_PATCH_VERSION,
  type CatalogSubmissionBatchPatch,
} from "./submission-patch";
import { isRetryableTransactionConflict, waitForTransactionRetry } from "@/lib/transaction-retry";
import { threeWayMergeCatalogPayload } from "./retry-merge";
import { isCatalogBatchRetrySourceStatus } from "./work-items";
import {
  catalogRetryEffectiveKind,
  catalogRetryGroupsAreContentOnly,
  mergeCatalogRetryConflictFields,
  parseCatalogRetryMergeConflictFields,
  retryableCatalogContentGroups,
} from "./submission-retry";

type Tx = Prisma.TransactionClient;

const PREVIEW_STATUSES = ["PREVIEW", "NEEDS_RESOLUTION"] as const;
const REVIEW_STATUSES = ["SUBMITTED", "REVIEWING", "REVIEWED"] as const;
const CLAIMABLE_STATUSES = ["NEEDS_RESOLUTION", ...REVIEW_STATUSES] as const;
const TERMINAL_STATUSES = ["COMMITTED", "REJECTED", "STALE", "EXPIRED", "CANCELLED", "SUPERSEDED"] as const;
const REVIEW_CLAIM_TRANSACTION_ATTEMPTS = 3;

async function withReviewClaimTransactionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= REVIEW_CLAIM_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt === REVIEW_CLAIM_TRANSACTION_ATTEMPTS) throw error;
      await waitForTransactionRetry(attempt);
    }
  }
  throw new Error("CATALOG_REQUEST_STALE");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function createIdentity(prefix: "cat" | "sense", value: string): string {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

const revisionSelect = {
  revision: true,
  term: true,
  lemma: true,
  pos: true,
  level: true,
  category: true,
  definitionZh: true,
  acceptedAnswersZh: true,
  phoneticIpa: true,
  exampleEn: true,
  exampleZh: true,
  acceptedFormsEn: true,
  synonymsEn: true,
  antonymsEn: true,
  enableEnToZh: true,
  distractorZh: true,
  enableZhToEn: true,
  distractorEn: true,
  sourceReference: true,
  contributorRef: true,
  changeNote: true,
  retirementReason: true,
} as const;

async function databaseSnapshots(tx: Tx, rows: readonly CatalogSourceRow[]): Promise<CatalogDatabaseSenseSnapshot[]> {
  const normalizedTerms = [...new Set(rows.map((row) => normalizeCatalogText(row.term)).filter(Boolean))];
  const normalizedLemmas = [...new Set(rows.map((row) => normalizeCatalogText(row.lemma || row.term)).filter(Boolean))];
  const senseKeys = [...new Set(rows.map((row) => row.sense_key.trim()).filter(Boolean))];
  const senses = await tx.wordSense.findMany({
    where: {
      OR: [
        ...(senseKeys.length ? [{ senseKey: { in: senseKeys } }] : []),
        ...(normalizedTerms.length ? [{ normalizedTerm: { in: normalizedTerms } }] : []),
        ...(normalizedLemmas.length ? [{ catalogEntry: { normalizedLemma: { in: normalizedLemmas } } }] : []),
      ],
    },
    include: {
      catalogEntry: { select: { catalogKey: true } },
      approvedRevision: { select: revisionSelect },
      revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect },
    },
  });
  return senses.flatMap((sense) => {
    const revision = sense.approvedRevision ?? sense.revisions[0];
    if (!revision) return [];
    return [{
      id: sense.id,
      catalogKey: sense.catalogEntry.catalogKey,
      senseKey: sense.senseKey,
      status: sense.status,
      revision: revision.revision,
      payload: payloadFromRevision(revision),
    }];
  });
}

async function currentGroupDependencyDigest(
  tx: Tx,
  group: {
    requestedAction: "CREATE" | "UPDATE" | "RETIRE" | "REACTIVATE";
    targetSenseId: string | null;
    finalProposalPayload: Prisma.JsonValue;
  },
  excludeBatchId?: string,
): Promise<string> {
  const payload = parseCatalogGovernancePayload(group.finalProposalPayload);
  const targetSense = group.targetSenseId ? await tx.wordSense.findUnique({
    where: { id: group.targetSenseId },
    include: { catalogEntry: { select: { catalogKey: true } }, approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect } },
  }) : null;
  const targetRevision = targetSense?.approvedRevision ?? targetSense?.revisions[0] ?? null;
  const target: CatalogDatabaseSenseSnapshot | null = targetSense && targetRevision ? {
    id: targetSense.id,
    catalogKey: targetSense.catalogEntry.catalogKey,
    senseKey: targetSense.senseKey,
    status: targetSense.status,
    revision: targetRevision.revision,
    payload: payloadFromRevision(targetRevision),
  } : null;
  const related = await tx.wordSense.findMany({
    where: { OR: [{ normalizedTerm: normalizeCatalogText(payload.term) }, { catalogEntry: { normalizedLemma: normalizeCatalogText(payload.lemma) } }] },
    include: { catalogEntry: { select: { catalogKey: true } }, approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect } },
  });
  const siblingDigests = related.flatMap((sense) => {
    const revision = sense.approvedRevision ?? sense.revisions[0];
    return revision ? [payloadFingerprint(payloadFromRevision(revision))] : [];
  });
  const pending = await tx.catalogChangeRequest.findMany({
    where: {
      status: "PENDING",
      OR: [
        ...(targetSense ? [{ senseId: targetSense.id }] : []),
        { afterNormalizedTermSnapshot: normalizeCatalogText(payload.term) },
      ],
    },
    select: { requestFingerprint: true, submissionProposalGroup: { select: { batchId: true } } },
  });
  const pendingConflictDigests = pending
    .filter((request) => !excludeBatchId || request.submissionProposalGroup?.batchId !== excludeBatchId)
    .map((request) => request.requestFingerprint);
  return catalogDependencyDigest({
    action: group.requestedAction === "UPDATE" ? "UPDATE" : "CREATE",
    target,
    siblingDigests,
    pendingConflictDigests,
  });
}

async function lockAndValidateSubmitter(tx: Tx, actorId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
  if (!actor || actor.status !== "ACTIVE" || (actor.role !== "ADMIN" && actor.role !== "TEACHER")) throw new Error("CATALOG_BATCH_FORBIDDEN");
}

export function decodeCatalogUploadName(value: string | null): string {
  if (!value) return "word-catalog.csv";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new CatalogCsvError("CATALOG_FILENAME_INVALID", "filename header must be percent-encoded UTF-8");
  }
  return safeCatalogDownloadName(decoded);
}

export async function createCatalogSubmissionPreview(input: {
  actorId: string;
  operationId: string;
  fileName: string;
  bytes: Uint8Array;
  retrySourceBatchId?: string;
  retryMergeConflicts?: ReadonlyMap<number, readonly string[]>;
}) {
  if (!isCanonicalUuid(input.operationId)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  if (input.bytes.byteLength > CATALOG_GOVERNANCE_MAX_BYTES) throw new Error("CATALOG_CSV_TOO_LARGE");
  const rows = parseCatalogGovernanceCsv(input.bytes, input.fileName);
  const fileHash = sha256(input.bytes);
  const requestDigest = sha256(JSON.stringify({
    operationId: input.operationId,
    fileName: input.fileName,
    fileHash,
    retrySourceBatchId: input.retrySourceBatchId ?? null,
    retryMergeConflicts: [...(input.retryMergeConflicts?.entries() ?? [])]
      .map(([sourceRowNumber, fields]) => ({ sourceRowNumber, fields: [...fields].sort() }))
      .sort((left, right) => left.sourceRowNumber - right.sourceRowNumber),
    versions: CATALOG_SUBMISSION_VERSIONS,
  }));
  const actor = catalogActorPseudonym(input.actorId);
  const expiry = submissionExpiry();

  try {
    return await prisma.$transaction(async (tx) => {
    const existing = await tx.catalogSubmissionBatch.findUnique({
      where: { proposerId_operationId: { proposerId: input.actorId, operationId: input.operationId } },
      select: { id: true, requestDigest: true },
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new Error("IDEMPOTENCY_CONFLICT");
      return { replay: true, batch: submissionBatchDto(await readBatchForDto(tx, existing.id)) };
    }
    if (input.retrySourceBatchId) {
      const retrySource = await tx.catalogSubmissionBatch.findUnique({
        where: { id: input.retrySourceBatchId },
        select: {
          proposerId: true,
          resolutionOwnerId: true,
          status: true,
          retryOfBatchId: true,
          contentPurgedAt: true,
          retriedBy: { select: { id: true } },
        },
      });
      if (!retrySource) throw new Error("CATALOG_BATCH_NOT_FOUND");
      if (retrySource.proposerId !== input.actorId && retrySource.resolutionOwnerId !== input.actorId) {
        throw new Error("CATALOG_BATCH_FORBIDDEN");
      }
      if (
        retrySource.contentPurgedAt
        || !isCatalogBatchRetrySourceStatus({
          status: retrySource.status,
          retryOfBatchId: retrySource.retryOfBatchId,
        })
      ) {
        throw new Error("CATALOG_BATCH_NOT_RETRYABLE");
      }
      if (retrySource.retriedBy) {
        return { replay: true, batch: submissionBatchDto(await readBatchForDto(tx, retrySource.retriedBy.id)) };
      }
    }
    const ready = await tx.catalogRevision.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!ready) throw new Error("CATALOG_NOT_READY");
    const mutation = await tx.catalogMutationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 0 }, update: {} });
    const snapshots = await databaseSnapshots(tx, rows);
    const snapshotSenseIds = snapshots.map((snapshot) => snapshot.id);
    const senseKeys = [...new Set(rows.map((row) => row.sense_key.trim()).filter(Boolean))];
    const normalizedTerms = [...new Set(rows.map((row) => normalizeCatalogText(row.term)).filter(Boolean))];
    const pendingRows = await tx.catalogChangeRequest.findMany({
      where: {
        status: "PENDING",
        OR: [
          ...(snapshotSenseIds.length ? [{ senseId: { in: snapshotSenseIds } }] : []),
          ...(senseKeys.length ? [{ senseKey: { in: senseKeys } }] : []),
          ...(normalizedTerms.length ? [{ afterNormalizedTermSnapshot: { in: normalizedTerms } }] : []),
        ],
      },
      select: { senseId: true, senseKey: true, afterNormalizedTermSnapshot: true, requestFingerprint: true },
    });
    const pendingChanges: CatalogPendingDependencySnapshot[] = pendingRows.map((row) => ({
      senseId: row.senseId,
      senseKey: row.senseKey,
      normalizedTerm: row.afterNormalizedTermSnapshot,
      requestFingerprint: row.requestFingerprint,
    }));
    const preview = buildCatalogSubmissionPreview(rows, snapshots, pendingChanges);
    if (input.retrySourceBatchId) assertCatalogRetryPreviewActionable(preview);
    const retryMergeConflictFieldsByGroup = new Map<number, ReturnType<typeof parseCatalogRetryMergeConflictFields>>();
    if (input.retryMergeConflicts?.size) {
      for (const [sourceRowNumber, fields] of input.retryMergeConflicts) {
        const conflictRow = preview.rows.find((candidate) => candidate.rowNumber === sourceRowNumber);
        const groupNumber = conflictRow?.proposalGroupNumber ?? null;
        const group = groupNumber === null
          ? null
          : preview.groups.find((candidate) => candidate.groupNumber === groupNumber);
        if (!conflictRow || !group) throw new Error("CATALOG_BATCH_RETRY_STALE");
        const normalizedFields = parseCatalogRetryMergeConflictFields(fields);
        if (!normalizedFields.length) throw new Error("CATALOG_BATCH_RETRY_STALE");
        const mergedFields = mergeCatalogRetryConflictFields(
          retryMergeConflictFieldsByGroup.get(groupNumber!) ?? [],
          normalizedFields,
        );
        retryMergeConflictFieldsByGroup.set(groupNumber!, mergedFields);
        group.needsResolution = true;
        group.resolution = null;
        group.resolutionReason = `retry merge conflict: ${mergedFields.join(", ")}`;
        for (const row of preview.rows) {
          if (row.proposalGroupNumber === groupNumber) row.primaryDisposition = "CONFLICT";
        }
      }
      preview.summary.unresolvedGroups = preview.groups.filter((group) => group.needsResolution).length;
      preview.status = preview.summary.unresolvedGroups ? "NEEDS_RESOLUTION" : preview.status;
    }
    if (preview.summary.invalidRows > 0) preview.status = "NEEDS_RESOLUTION";
    const dependencyDigests = buildCatalogPreviewDependencyDigests(preview.groups, snapshots, pendingChanges);
    const batch = await tx.catalogSubmissionBatch.create({
      data: {
        proposerId: input.actorId,
        operationId: input.operationId,
        fileName: input.fileName,
        fileHash,
        requestDigest,
        schemaVersion: CATALOG_SUBMISSION_VERSIONS.schemaVersion,
        validatorVersion: CATALOG_SUBMISSION_VERSIONS.validatorVersion,
        normalizationVersion: CATALOG_SUBMISSION_VERSIONS.normalizationVersion,
        taxonomyDigest: CATALOG_SUBMISSION_VERSIONS.taxonomyDigest,
        readyCatalogRevisionId: ready.id,
        baseMutationRevision: mutation.revision,
        status: preview.status,
        rowCount: rows.length,
        summary: json(preview.summary),
        retryOfBatchId: input.retrySourceBatchId ?? null,
        ...expiry,
        actorPseudonym: actor.value,
        actorKeyVersion: actor.keyVersion,
      },
    });
    const groupIds = new Map<number, string>();
    const reusableEntryByLemma = new Map<string, string>();
    for (const snapshot of snapshots) {
      const normalizedLemma = normalizeCatalogText(snapshot.payload.lemma);
      if (!reusableEntryByLemma.has(normalizedLemma)) reusableEntryByLemma.set(normalizedLemma, snapshot.catalogKey);
    }
    const groupRows = preview.groups.map((group) => {
      const id = deterministicSubmissionProposalGroupId(batch.id, group.groupNumber);
      groupIds.set(group.groupNumber, id);
      const dependencyDigest = dependencyDigests.get(group.groupNumber);
      if (!dependencyDigest) throw new Error("CATALOG_BATCH_DEPENDENCY_INVALID");
      const normalizedLemma = normalizeCatalogText(group.finalProposalPayload.lemma);
      const targetCatalogKey = group.requestedAction === "CREATE"
        ? reusableEntryByLemma.get(normalizedLemma) ?? createIdentity("cat", normalizedLemma)
        : group.targetCatalogKey;
      const targetSenseKey = group.requestedAction === "CREATE"
        ? createIdentity("sense", `${group.payloadDigest}\u0000${batch.id}\u0000${group.groupNumber}`)
        : group.targetSenseKey;
      return {
        id,
        batchId: batch.id,
        groupNumber: group.groupNumber,
        requestedAction: group.requestedAction,
        resolution: group.resolution,
        resolutionReason: group.resolutionReason,
        retryMergeConflictFields: retryMergeConflictFieldsByGroup.has(group.groupNumber)
          ? json(retryMergeConflictFieldsByGroup.get(group.groupNumber)!)
          : Prisma.JsonNull,
        targetCatalogKey,
        targetSenseKey,
        targetSenseId: group.targetSenseId,
        baseRevision: group.baseRevision,
        baseStatus: group.baseStatus,
        dependencyDigest,
        finalProposalPayload: json(group.finalProposalPayload),
        payloadDigest: group.payloadDigest,
        lastContentAuthorId: input.actorId,
        reviewRisk: group.reviewRisk,
        reviewRiskVersion: CATALOG_REVIEW_RISK_VERSION,
        reviewRiskReason: json(group.reviewRiskReason),
        actorPseudonym: actor.value,
        actorKeyVersion: actor.keyVersion,
      };
    });
    if (groupRows.length) {
      await tx.catalogSubmissionProposalGroup.createMany({ data: groupRows });
      await tx.catalogSubmissionProposalAuthor.createMany({
        data: preview.groups.map((group) => ({
          proposalGroupId: groupIds.get(group.groupNumber)!,
          actorUserId: input.actorId,
          payloadDigest: group.payloadDigest,
          contributionKind: "UPLOAD",
          actorPseudonym: actor.value,
          actorKeyVersion: actor.keyVersion,
        })),
      });
    }
    await tx.catalogSubmissionRow.createMany({
      data: preview.rows.map((row) => ({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        rowDigest: row.rowDigest,
        requestedAction: row.requestedAction,
        primaryDisposition: row.primaryDisposition,
        warnings: json(row.warnings),
        errors: json(row.errors),
        normalizedTerm: row.normalizedTerm,
        normalizedLemma: row.normalizedLemma,
        normalizedSourcePayload: json(row.normalizedSourcePayload),
        proposalGroupId: row.proposalGroupNumber ? groupIds.get(row.proposalGroupNumber) ?? null : null,
        rowRole: row.rowRole,
      })),
    });
    await tx.catalogAuditEvent.create({
      data: {
        actorUserId: input.actorId,
        submissionBatchId: batch.id,
        action: "BATCH_PREVIEWED",
        toStatus: preview.status,
        metadata: json({ ...preview.summary, ...(input.retrySourceBatchId ? { retrySourceBatchId: input.retrySourceBatchId } : {}) }),
      },
    });
    const created = await readBatchForDto(tx, batch.id);
    return { replay: false, batch: submissionBatchDto(created) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
  } catch (error) {
    if (
      isRetryableTransactionConflict(error)
      || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      const existing = await prisma.catalogSubmissionBatch.findUnique({
        where: { proposerId_operationId: { proposerId: input.actorId, operationId: input.operationId } },
        select: { id: true, requestDigest: true },
      });
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new Error("IDEMPOTENCY_CONFLICT");
        const replayBatch = await prisma.$transaction((tx) => readBatchForDto(tx, existing.id));
        return { replay: true, batch: submissionBatchDto(replayBatch) };
      }
      if (input.retrySourceBatchId) {
        const source = await prisma.catalogSubmissionBatch.findUnique({
          where: { id: input.retrySourceBatchId },
          select: { retriedBy: { select: { id: true } } },
        });
        if (source?.retriedBy) {
          const replayBatch = await prisma.$transaction((tx) => readBatchForDto(tx, source.retriedBy!.id));
          return { replay: true, batch: submissionBatchDto(replayBatch) };
        }
      }
    }
    throw error;
  }
}

export async function createRetryCatalogSubmissionPreview(input: {
  sourceBatchId: string;
  actorId: string;
  operationId: string;
}) {
  const source = await prisma.catalogSubmissionBatch.findUnique({
    where: { id: input.sourceBatchId },
    select: {
      id: true,
      proposerId: true,
      resolutionOwnerId: true,
      status: true,
      fileName: true,
      retryOfBatchId: true,
      contentPurgedAt: true,
      retriedBy: { select: { id: true } },
      proposalGroups: {
        orderBy: { groupNumber: "asc" },
        select: {
          groupNumber: true,
          requestedAction: true,
          resolution: true,
          retryMergeConflictFields: true,
          baseRevision: true,
          targetCatalogKey: true,
          targetSenseKey: true,
          finalProposalPayload: true,
          changeRequest: { select: { kind: true, beforePayloadSnapshot: true } },
          targetSense: {
            select: {
              id: true,
              status: true,
              catalogEntry: { select: { catalogKey: true } },
              approvedRevision: { select: revisionSelect },
              revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect },
            },
          },
        },
      },
    },
  });
  if (!source) throw new Error("CATALOG_BATCH_NOT_FOUND");
  if (source.proposerId !== input.actorId && source.resolutionOwnerId !== input.actorId) {
    throw new Error("CATALOG_BATCH_FORBIDDEN");
  }
  if (source.retriedBy) {
    const batch = await prisma.$transaction((tx) => readBatchForDto(tx, source.retriedBy!.id));
    return { replay: true, batch: submissionBatchDto(batch) };
  }
  if (
    source.contentPurgedAt
    || !isCatalogBatchRetrySourceStatus({
      status: source.status,
      retryOfBatchId: source.retryOfBatchId,
    })
  ) {
    throw new Error("CATALOG_BATCH_NOT_RETRYABLE");
  }
  const retryGroups = retryableCatalogContentGroups(source.proposalGroups);
  if (!retryGroups.length) throw new Error("CATALOG_BATCH_EMPTY");
  if (!catalogRetryGroupsAreContentOnly(retryGroups)) throw new Error("CATALOG_BATCH_NOT_RETRYABLE");

  const basePairs = retryGroups.flatMap((group) => {
    const effectiveKind = catalogRetryEffectiveKind(group);
    return effectiveKind === "UPDATE" && group.targetSense?.id && group.baseRevision !== null
      ? [{ senseId: group.targetSense.id, revision: group.baseRevision }]
      : [];
  });
  const baseRevisions = basePairs.length
    ? await prisma.wordSenseRevision.findMany({
        where: { OR: basePairs },
        select: { senseId: true, ...revisionSelect },
      })
    : [];
  const baseRevisionByKey = new Map(baseRevisions.map((revision) => [
    `${revision.senseId}:${revision.revision}`,
    payloadFromRevision(revision),
  ]));
  const retryMergeConflicts = new Map<number, readonly string[]>();
  const rows: CatalogSourceRow[] = [];
  for (const group of retryGroups) {
    const effectiveKind = catalogRetryEffectiveKind(group);
    if (effectiveKind !== "CREATE" && effectiveKind !== "UPDATE") throw new Error("CATALOG_BATCH_NOT_RETRYABLE");
    const sourceRowNumber = rows.length + 2;
    const inheritedConflicts = parseCatalogRetryMergeConflictFields(group.retryMergeConflictFields);
    let unresolvedConflicts = inheritedConflicts;
    const proposal = parseCatalogGovernancePayload(group.finalProposalPayload);
    const currentRevision = group.targetSense?.approvedRevision ?? group.targetSense?.revisions[0] ?? null;
    if (effectiveKind === "UPDATE" && !currentRevision) {
      throw new Error("CATALOG_BATCH_RETRY_STALE");
    }
    let payload = proposal;
    if (effectiveKind === "UPDATE" && currentRevision?.revision !== group.baseRevision) {
      const base = group.changeRequest?.beforePayloadSnapshot
        ? parseCatalogGovernancePayload(group.changeRequest.beforePayloadSnapshot)
        : group.targetSense?.id && group.baseRevision !== null
          ? baseRevisionByKey.get(`${group.targetSense.id}:${group.baseRevision}`) ?? null
          : null;
      if (!base) throw new Error("CATALOG_BATCH_RETRY_STALE");
      const current = payloadFromRevision(currentRevision!);
      const firstPass = threeWayMergeCatalogPayload({ base, proposal, current });
      if (firstPass.conflicts.length) {
        unresolvedConflicts = mergeCatalogRetryConflictFields(
          unresolvedConflicts,
          firstPass.conflicts.map((conflict) => conflict.field),
        );
        payload = threeWayMergeCatalogPayload({
          base,
          proposal,
          current,
          choices: Object.fromEntries(firstPass.conflicts.map((conflict) => [conflict.field, "PROPOSAL"])),
        }).payload;
      } else {
        payload = firstPass.payload;
      }
    }
    if (unresolvedConflicts.length) retryMergeConflicts.set(sourceRowNumber, unresolvedConflicts);
    const catalogKey = group.targetSense?.catalogEntry.catalogKey
      ?? group.targetCatalogKey
      ?? `retry-${source.id}`;
    const senseKey = group.targetSenseKey ?? `retry-${source.id}-${group.groupNumber}`;
    const row = {
      ...payloadToSourceRow(payload, {
        catalogKey,
        senseKey,
        sourceFile: `retry-${source.fileName}`,
        sourceRow: sourceRowNumber,
      }, currentRevision?.revision ?? 0),
      requested_action: effectiveKind,
      catalog_status: group.targetSense?.status ?? "DRAFT",
    };
    rows.push(effectiveKind === "CREATE"
      ? { ...row, catalog_key: "", sense_key: "", record_revision: "", catalog_status: "" }
      : row);
  }
  const csv = catalogRowsToCsv(rows, CATALOG_GOVERNANCE_HEADERS);
  return createCatalogSubmissionPreview({
    actorId: input.actorId,
    operationId: input.operationId,
    fileName: `retry-${source.fileName}`.slice(0, 120),
    bytes: new TextEncoder().encode(csv),
    retrySourceBatchId: source.id,
    retryMergeConflicts,
  });
}

const proposalGroupInclude = {
  sourceRows: { orderBy: { rowNumber: "asc" as const }, select: { rowNumber: true, rowDigest: true, rowRole: true, normalizedSourcePayload: true } },
  changeRequest: { select: { id: true, status: true, revision: true, resultRevisionId: true, beforePayloadSnapshot: true } },
  authors: { select: { actorUserId: true, contributionKind: true, createdAt: true } },
  targetSense: { select: { approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" as const }, take: 1, select: revisionSelect } } },
} as const;

const batchInclude = {
  rows: { orderBy: { rowNumber: "asc" as const } },
  proposalGroups: { orderBy: { groupNumber: "asc" as const }, include: proposalGroupInclude },
} as const;

type BatchForDto = Prisma.CatalogSubmissionBatchGetPayload<{ include: typeof batchInclude }>;
type ProposalGroupForDto = Prisma.CatalogSubmissionProposalGroupGetPayload<{ include: typeof proposalGroupInclude }>;

async function readBatchForDto(tx: Tx, id: string): Promise<BatchForDto> {
  const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id }, include: batchInclude });
  if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
  return batch;
}

type SubmissionBatchDtoVisibility = "OWNER" | "REVIEWER";

function submissionProposalGroupDto(group: ProposalGroupForDto, visibility: SubmissionBatchDtoVisibility) {
  const reviewerView = visibility === "REVIEWER";
  const requestBefore = group.changeRequest?.beforePayloadSnapshot
    ? parseCatalogGovernancePayload(group.changeRequest.beforePayloadSnapshot)
    : null;
  const targetRevision = group.targetSense?.approvedRevision?.revision === group.baseRevision
    ? group.targetSense.approvedRevision
    : group.targetSense?.revisions.find((revision) => revision.revision === group.baseRevision) ?? null;
  return {
    id: group.id,
    groupNumber: group.groupNumber,
    requestedAction: group.requestedAction,
    resolution: group.resolution,
    resolutionReason: group.resolutionReason,
    retryMergeConflictFields: group.retryMergeConflictFields,
    targetCatalogKey: group.targetCatalogKey,
    targetSenseKey: group.targetSenseKey,
    targetSenseId: group.targetSenseId,
    baseRevision: group.baseRevision,
    baseStatus: group.baseStatus,
    baseProposalPayload: requestBefore ?? (targetRevision ? payloadFromRevision(targetRevision) : null),
    finalProposalPayload: group.finalProposalPayload,
    reviewRisk: group.reviewRisk,
    reviewRiskReason: group.reviewRiskReason,
    decision: group.decision,
    reviewNote: group.reviewNote,
    revision: group.revision,
    sourceSetDigest: sha256(JSON.stringify(group.sourceRows.map((row) => ({ rowNumber: row.rowNumber, rowDigest: row.rowDigest })).sort((a, b) => a.rowNumber - b.rowNumber))),
    sourceRows: group.sourceRows,
    changeRequest: group.changeRequest,
    ...(reviewerView ? {
      payloadDigest: group.payloadDigest,
      reviewedPayloadDigest: group.reviewedPayloadDigest,
      lastContentAuthorId: group.lastContentAuthorId,
      authors: group.authors.map((author) => ({ ...author, createdAt: author.createdAt.toISOString() })),
    } : {}),
  };
}

export function submissionBatchDto(batch: BatchForDto, visibility: SubmissionBatchDtoVisibility = "OWNER") {
  const reviewerView = visibility === "REVIEWER";
  return {
    id: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    revision: batch.revision,
    rowCount: batch.rowCount,
    summary: batch.summary,
    proposerId: batch.proposerId,
    resolutionOwnerId: reviewerView ? batch.resolutionOwnerId : null,
    reviewerId: reviewerView ? batch.reviewerId : null,
    resolutionClaimed: Boolean(batch.resolutionOwnerId),
    reviewClaimed: Boolean(batch.reviewerId),
    supersedesBatchId: batch.supersedesBatchId,
    retryOfBatchId: batch.retryOfBatchId,
    ...(reviewerView ? {
      operationId: batch.operationId,
      fileHash: batch.fileHash,
      finalizerId: batch.finalizerId,
      versions: {
      schemaVersion: batch.schemaVersion,
      validatorVersion: batch.validatorVersion,
      normalizationVersion: batch.normalizationVersion,
      taxonomyDigest: batch.taxonomyDigest,
      },
    } : {}),
    expiresAt: batch.expiresAt.toISOString(),
    absoluteExpiresAt: batch.absoluteExpiresAt.toISOString(),
    submittedAt: batch.submittedAt?.toISOString() ?? null,
    reviewedAt: batch.reviewedAt?.toISOString() ?? null,
    committedAt: batch.committedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    rows: batch.rows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      requestedAction: row.requestedAction,
      primaryDisposition: row.primaryDisposition,
      warnings: row.warnings,
      errors: row.errors,
      normalizedTerm: row.normalizedTerm,
      normalizedLemma: row.normalizedLemma,
      normalizedSourcePayload: row.normalizedSourcePayload,
      proposalGroupId: row.proposalGroupId,
      rowRole: row.rowRole,
    })),
    groups: batch.proposalGroups.map((group) => submissionProposalGroupDto(group, visibility)),
  };
}

const mutationBatchSelect = {
  id: true,
  status: true,
  revision: true,
  resolutionOwnerId: true,
  reviewerId: true,
  expiresAt: true,
  absoluteExpiresAt: true,
  submittedAt: true,
  reviewedAt: true,
  committedAt: true,
} as const;

async function readBatchMutationPatch(
  tx: Tx,
  input: {
    batchId: string;
    baseRevision: number;
    visibility: SubmissionBatchDtoVisibility;
    group?: { id: string; baseRevision: number };
  },
): Promise<CatalogSubmissionBatchPatch<ReturnType<typeof submissionProposalGroupDto>>> {
  const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, select: mutationBatchSelect });
  const group = input.group
    ? await tx.catalogSubmissionProposalGroup.findFirst({ where: { id: input.group.id, batchId: input.batchId }, include: proposalGroupInclude })
    : null;
  if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
  if (input.group && !group) throw new Error("CATALOG_GROUP_NOT_FOUND");
  const reviewerView = input.visibility === "REVIEWER";
  return {
    version: CATALOG_SUBMISSION_PATCH_VERSION,
    batchId: batch.id,
    baseRevision: input.baseRevision,
    revision: batch.revision,
    batch: {
      status: batch.status,
      resolutionOwnerId: reviewerView ? batch.resolutionOwnerId : null,
      reviewerId: reviewerView ? batch.reviewerId : null,
      resolutionClaimed: Boolean(batch.resolutionOwnerId),
      reviewClaimed: Boolean(batch.reviewerId),
      expiresAt: batch.expiresAt.toISOString(),
      absoluteExpiresAt: batch.absoluteExpiresAt.toISOString(),
      submittedAt: batch.submittedAt?.toISOString() ?? null,
      reviewedAt: batch.reviewedAt?.toISOString() ?? null,
      committedAt: batch.committedAt?.toISOString() ?? null,
    },
    group: group && input.group ? {
      baseRevision: input.group.baseRevision,
      value: submissionProposalGroupDto(group, input.visibility),
    } : null,
  };
}

export async function getCatalogSubmissionBatch(input: { batchId: string; actorId: string; canReview: boolean }) {
  const batch = await prisma.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: batchInclude });
  if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
  if (batch.proposerId !== input.actorId && !input.canReview) throw new Error("CATALOG_BATCH_FORBIDDEN");
  return submissionBatchDto(batch, input.canReview ? "REVIEWER" : "OWNER");
}

export async function listCatalogSubmissionBatches(input: {
  actorId: string;
  canReview: boolean;
  scope: "mine" | "reviewable";
  cursor?: string | null;
  limit?: number;
}) {
  if (input.scope === "reviewable" && !input.canReview) throw new Error("CATALOG_REVIEW_FORBIDDEN");
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await prisma.catalogSubmissionBatch.findMany({
    where: input.scope === "mine"
      ? { proposerId: input.actorId }
      : { status: { in: [...CLAIMABLE_STATUSES] }, proposerId: { not: input.actorId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      fileName: true,
      status: true,
      rowCount: true,
      summary: true,
      proposerId: true,
      reviewerId: true,
      resolutionOwnerId: true,
      revision: true,
      createdAt: true,
      submittedAt: true,
      reviewedAt: true,
      committedAt: true,
    },
  });
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...row,
      reviewerId: input.scope === "reviewable" ? row.reviewerId : null,
      resolutionOwnerId: input.scope === "reviewable" ? row.resolutionOwnerId : null,
      reviewClaimed: Boolean(row.reviewerId),
      resolutionClaimed: Boolean(row.resolutionOwnerId),
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      committedAt: row.committedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? rows[limit - 1]!.id : null,
  };
}

export async function resolveCatalogSubmissionGroup(input: {
  batchId: string;
  groupId: string;
  actorId: string;
  canReview: boolean;
  expectedBatchRevision: number;
  expectedGroupRevision: number;
  resolution: SubmissionResolution;
  reason: string;
  payload?: unknown;
  sourceSelectionMode?: "SOURCE_ROW" | "CUSTOM";
  selectedSourceRowNumber?: number;
  acknowledgedSourceSetDigest?: string;
}) {
  const allowed = ["MERGE", "KEEP_SEPARATE", "REPLACE_EXISTING", "REJECT", "ESCALATE"];
  if (!allowed.includes(input.resolution)) throw new Error("CATALOG_RESOLUTION_INVALID");
  if (input.reason.length > 1000 || (["REPLACE_EXISTING", "REJECT", "ESCALATE"].includes(input.resolution) && input.reason.length < 3)) {
    throw new Error("CATALOG_RESOLUTION_REASON_REQUIRED");
  }
  return prisma.$transaction(async (tx) => {
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (!PREVIEW_STATUSES.includes(batch.status as (typeof PREVIEW_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_EDITABLE");
    if (batch.revision !== input.expectedBatchRevision) throw new Error("CATALOG_BATCH_STALE");
    const actingAsReviewer = batch.proposerId !== input.actorId;
    if (actingAsReviewer) await requireCatalogReviewerInTransaction(tx, input.actorId);
    if (batch.resolutionOwnerId && batch.resolutionOwnerId !== input.actorId) throw new Error("CATALOG_BATCH_ALREADY_CLAIMED");
    if (actingAsReviewer && batch.resolutionOwnerId !== input.actorId && batch.reviewerId !== input.actorId) throw new Error("CATALOG_BATCH_FORBIDDEN");
    const group = await tx.catalogSubmissionProposalGroup.findFirst({
      where: { id: input.groupId, batchId: batch.id },
      include: { sourceRows: { select: { rowNumber: true, rowDigest: true, normalizedSourcePayload: true } } },
    });
    if (!group) throw new Error("CATALOG_GROUP_NOT_FOUND");
    if (group.revision !== input.expectedGroupRevision) throw new Error("CATALOG_GROUP_STALE");
    let payload = parseCatalogGovernancePayload(group.finalProposalPayload);
    let materialResolution = false;
    if (input.resolution === "REPLACE_EXISTING" && !group.targetSenseId) throw new Error("CATALOG_RESOLUTION_TARGET_REQUIRED");
    if (input.resolution === "KEEP_SEPARATE" && (group.targetSenseId || group.sourceRows.length !== 1)) {
      throw new Error("CATALOG_RESOLUTION_INVALID");
    }
    if (input.resolution === "MERGE") {
      const sourceDigests = new Set(group.sourceRows.flatMap((row) => row.normalizedSourcePayload === null
        ? []
        : [payloadFingerprint(parseCatalogGovernancePayload(row.normalizedSourcePayload))]));
      const sourceSetDigest = sha256(JSON.stringify(group.sourceRows.map((row) => ({ rowNumber: row.rowNumber, rowDigest: row.rowDigest })).sort((a, b) => a.rowNumber - b.rowNumber)));
      if (group.targetSenseId || group.sourceRows.length < 2) {
        throw new Error("CATALOG_RESOLUTION_INVALID");
      }
      if (sourceDigests.size > 1) {
        materialResolution = true;
        if (input.acknowledgedSourceSetDigest !== sourceSetDigest) throw new Error("CATALOG_SOURCE_SELECTION_REQUIRED");
        if (input.sourceSelectionMode === "SOURCE_ROW") {
          const selected = group.sourceRows.find((row) => row.rowNumber === input.selectedSourceRowNumber);
          if (!selected?.normalizedSourcePayload) throw new Error("CATALOG_SOURCE_SELECTION_REQUIRED");
          payload = parseCatalogGovernancePayload(selected.normalizedSourcePayload);
        } else if (input.sourceSelectionMode === "CUSTOM" && input.payload !== undefined && input.reason.trim().length >= 3) {
          payload = parseCatalogGovernancePayload(input.payload);
        } else {
          throw new Error("CATALOG_SOURCE_SELECTION_REQUIRED");
        }
      } else if (input.payload !== undefined) {
        payload = parseCatalogGovernancePayload(input.payload);
      }
    } else if (input.payload !== undefined) {
      payload = parseCatalogGovernancePayload(input.payload);
    }
    const payloadChanged = payloadFingerprint(payload) !== group.payloadDigest;
    const before = group.targetSenseId
      ? await tx.wordSense.findUnique({ where: { id: group.targetSenseId }, include: { approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect } } })
      : null;
    const beforePayload = before ? payloadFromRevision(before.approvedRevision ?? before.revisions[0]!) : null;
    const risk = classifyCatalogReviewRisk(beforePayload, payload);
    const actor = catalogActorPseudonym(input.actorId);
    await tx.catalogSubmissionProposalGroup.update({
      where: { id: group.id, revision: input.expectedGroupRevision },
      data: {
        resolution: input.resolution,
        resolutionReason: input.reason || null,
        retryMergeConflictFields: input.resolution === "ESCALATE"
          ? group.retryMergeConflictFields ?? Prisma.JsonNull
          : Prisma.JsonNull,
        finalProposalPayload: json(payload),
        payloadDigest: payloadFingerprint(payload),
        lastContentAuthorId: payloadChanged || materialResolution ? input.actorId : group.lastContentAuthorId,
        reviewRisk: materialResolution ? "MATERIAL" : risk.risk,
        reviewRiskVersion: CATALOG_REVIEW_RISK_VERSION,
        reviewRiskReason: json(materialResolution ? ["multi-source-content-selection", ...risk.reasons] : risk.reasons),
        decision: "PENDING",
        decidedById: null,
        decidedAt: null,
        reviewedPayloadDigest: null,
        reviewNote: null,
        revision: { increment: 1 },
      },
    });
    if (payloadChanged || materialResolution) {
      await tx.catalogSubmissionProposalAuthor.create({
        data: {
          proposalGroupId: group.id,
          actorUserId: input.actorId,
          payloadDigest: payloadFingerprint(payload),
          contributionKind: "RESOLUTION_EDIT",
          actorPseudonym: actor.value,
          actorKeyVersion: actor.keyVersion,
        },
      });
    }
    const unresolved = await tx.catalogSubmissionProposalGroup.count({ where: { batchId: batch.id, OR: [{ resolution: null }, { resolution: "ESCALATE" }] } });
    const invalid = await tx.catalogSubmissionRow.count({ where: { batchId: batch.id, primaryDisposition: "VALIDATION_FAILED" } });
    await tx.catalogSubmissionBatch.update({
      where: { id: batch.id, revision: input.expectedBatchRevision },
      data: {
        status: unresolved || invalid ? "NEEDS_RESOLUTION" : "PREVIEW",
        resolutionOwnerId: unresolved || invalid ? batch.resolutionOwnerId : null,
        revision: { increment: 1 },
        lastActivityAt: new Date(),
        expiresAt: refreshSubmissionExpiry(batch.createdAt),
      },
    });
    await tx.catalogAuditEvent.create({
      data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "RESOLUTION_SAVED", metadata: { groupId: group.id, resolution: input.resolution, payloadChanged, materialResolution, sourceSelectionMode: input.sourceSelectionMode ?? null, selectedSourceRowNumber: input.selectedSourceRowNumber ?? null, acknowledgedSourceSetDigest: input.acknowledgedSourceSetDigest ?? null } },
    });
    return readBatchMutationPatch(tx, {
      batchId: batch.id,
      baseRevision: input.expectedBatchRevision,
      visibility: actingAsReviewer ? "REVIEWER" : "OWNER",
      group: { id: group.id, baseRevision: input.expectedGroupRevision },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
}

export async function claimCatalogSubmissionBatch(input: { batchId: string; actorId: string; expectedRevision: number; release: boolean }) {
  return withReviewClaimTransactionRetry(() => prisma.$transaction(async (tx) => {
    // Read only enough to discover the complete user lock set. User rows stay
    // ahead of the batch row in the catalog-wide lock hierarchy; the batch is
    // then locked and reread before any decision is made.
    const snapshot = await tx.catalogSubmissionBatch.findUnique({
      where: { id: input.batchId },
      select: { status: true, resolutionOwnerId: true, reviewerId: true },
    });
    if (!snapshot) throw new Error("CATALOG_BATCH_NOT_FOUND");
    const snapshotOwner = snapshot.status === "NEEDS_RESOLUTION"
      ? snapshot.resolutionOwnerId
      : snapshot.reviewerId;
    await lockCatalogReviewUsers(tx, [input.actorId, snapshotOwner]);
    await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${input.batchId} FOR UPDATE`;
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (!CLAIMABLE_STATUSES.includes(batch.status as (typeof CLAIMABLE_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_REVIEWABLE");
    if (batch.revision !== input.expectedRevision) throw new Error("CATALOG_BATCH_STALE");
    if (!await catalogReviewerHasAuthorityAfterLock(tx, input.actorId)) throw new Error("CATALOG_REVIEW_FORBIDDEN");
    if (batch.proposerId === input.actorId) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    const resolutionMode = batch.status === "NEEDS_RESOLUTION";
    const actorAuthoredProposal = !resolutionMode && Boolean(await tx.catalogSubmissionProposalAuthor.findFirst({
      where: { actorUserId: input.actorId, proposalGroup: { batchId: batch.id } },
      select: { id: true },
    }));
    if (actorAuthoredProposal) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    const currentOwner = resolutionMode ? batch.resolutionOwnerId : batch.reviewerId;
    const currentOwnerHasConflict = !resolutionMode && Boolean(currentOwner) && (
      batch.proposerId === currentOwner
      || Boolean(await tx.catalogSubmissionProposalAuthor.findFirst({
        where: { actorUserId: currentOwner!, proposalGroup: { batchId: batch.id } },
        select: { id: true },
      }))
    );
    const invalidOwnerCanBeReplaced = !input.release
      && Boolean(currentOwner && currentOwner !== input.actorId)
      && (currentOwnerHasConflict || !await catalogReviewerHasAuthorityAfterLock(tx, currentOwner!));
    if (input.release) {
      if (currentOwner !== input.actorId) throw new Error("CATALOG_REVIEW_CLAIM_FORBIDDEN");
    } else if (currentOwner && currentOwner !== input.actorId && !invalidOwnerCanBeReplaced) {
      throw new Error("CATALOG_BATCH_ALREADY_CLAIMED");
    }
    await tx.catalogSubmissionBatch.update({
      where: { id: batch.id, revision: input.expectedRevision },
      data: {
        ...(resolutionMode ? { resolutionOwnerId: input.release ? null : input.actorId } : { reviewerId: input.release ? null : input.actorId }),
        revision: { increment: 1 },
        status: input.release || resolutionMode ? batch.status : batch.status === "SUBMITTED" ? "REVIEWING" : batch.status,
      },
    });
    await tx.catalogAuditEvent.create({ data: {
      actorUserId: input.actorId,
      submissionBatchId: batch.id,
      action: resolutionMode ? input.release ? "RESOLUTION_RELEASED" : "RESOLUTION_CLAIMED" : input.release ? "REVIEW_RELEASED" : "REVIEW_CLAIMED",
      metadata: invalidOwnerCanBeReplaced ? { replacedInvalidClaim: true } : undefined,
    } });
    return readBatchMutationPatch(tx, {
      batchId: batch.id,
      baseRevision: input.expectedRevision,
      visibility: "REVIEWER",
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function submitCatalogSubmissionBatch(input: {
  batchId: string;
  actorId: string;
  expectedRevision: number;
  operationId: string;
  reason: string;
}) {
  if (!isCanonicalUuid(input.operationId)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.catalogSubmissionOperationReceipt.findUnique({
      where: { actorUserId_operationKind_operationId: { actorUserId: input.actorId, operationKind: "SUBMIT", operationId: input.operationId } },
    });
    const fingerprint = sha256(JSON.stringify({ batchId: input.batchId, expectedRevision: input.expectedRevision, reason: input.reason }));
    if (receipt) {
      if (receipt.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return {
        replay: true,
        patch: await readBatchMutationPatch(tx, {
          batchId: receipt.batchId,
          baseRevision: input.expectedRevision,
          visibility: "OWNER",
        }),
      };
    }
    await lockAndValidateSubmitter(tx, input.actorId);
    await tx.catalogMutationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 0 }, update: {} });
    await tx.$queryRaw`SELECT "id" FROM "CatalogMutationState" WHERE "id" = 1 FOR UPDATE`;
    const mutationState = await tx.catalogMutationState.findUniqueOrThrow({ where: { id: 1 } });
    await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${input.batchId} FOR UPDATE`;
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: { proposalGroups: true, rows: true } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (batch.proposerId !== input.actorId) throw new Error("CATALOG_BATCH_FORBIDDEN");
    if (!PREVIEW_STATUSES.includes(batch.status as (typeof PREVIEW_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_SUBMITTABLE");
    if (batch.revision !== input.expectedRevision) throw new Error("CATALOG_BATCH_STALE");
    if (batch.expiresAt <= new Date() || batch.absoluteExpiresAt <= new Date()) throw new Error("CATALOG_BATCH_EXPIRED");
    if (batch.rows.some((row) => row.primaryDisposition === "VALIDATION_FAILED")) throw new Error("CATALOG_BATCH_HAS_ERRORS");
    if (batch.proposalGroups.length === 0) throw new Error("CATALOG_BATCH_EMPTY");
    if (batch.proposalGroups.some((group) => !group.resolution || group.resolution === "ESCALATE")) throw new Error("CATALOG_BATCH_NEEDS_RESOLUTION");
    if (batch.schemaVersion !== CATALOG_SUBMISSION_VERSIONS.schemaVersion || batch.validatorVersion !== CATALOG_SUBMISSION_VERSIONS.validatorVersion || batch.normalizationVersion !== CATALOG_SUBMISSION_VERSIONS.normalizationVersion || batch.taxonomyDigest !== CATALOG_SUBMISSION_VERSIONS.taxonomyDigest) {
      throw new Error("CATALOG_BATCH_VALIDATOR_STALE");
    }
    for (const group of batch.proposalGroups) {
      const dependencyDigest = await currentGroupDependencyDigest(tx, group, batch.id);
      if (dependencyDigest !== group.dependencyDigest) throw new Error("CATALOG_BATCH_DEPENDENCY_STALE");
    }
    const actor = catalogActorPseudonym(input.actorId);
    for (const group of batch.proposalGroups) {
      if (group.resolution === "REJECT") {
        await tx.catalogSubmissionProposalGroup.update({ where: { id: group.id }, data: { decision: "REJECT", reviewedPayloadDigest: group.payloadDigest, reviewNote: group.resolutionReason, revision: { increment: 1 } } });
        continue;
      }
      const effectiveKind = group.requestedAction === "CREATE" && group.resolution === "REPLACE_EXISTING" ? "UPDATE" : group.requestedAction;
      const targetsExistingSense = effectiveKind !== "CREATE";
      const before = group.targetSenseId ? await tx.wordSense.findUnique({ where: { id: group.targetSenseId }, include: { approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "desc" }, take: 1, select: revisionSelect } } }) : null;
      const beforeRevision = before?.approvedRevision ?? before?.revisions[0] ?? null;
      const payload = parseCatalogGovernancePayload(group.finalProposalPayload);
      await tx.catalogChangeRequest.create({
        data: {
          operationId: deterministicBatchRequestOperationId(batch.id, group.id),
          requestFingerprint: payloadFingerprint({ batchId: batch.id, groupId: group.id, payloadDigest: group.payloadDigest, kind: effectiveKind }),
          kind: effectiveKind,
          catalogKey: group.targetCatalogKey,
          senseKey: group.targetSenseKey,
          senseId: targetsExistingSense ? group.targetSenseId : null,
          submissionProposalGroupId: group.id,
          proposerId: input.actorId,
          baseRevision: targetsExistingSense ? group.baseRevision : null,
          baseStatus: targetsExistingSense ? group.baseStatus : "DRAFT",
          payload: json(group.finalProposalPayload),
          beforePayloadSnapshot: beforeRevision ? json(payloadFromRevision(beforeRevision)) : Prisma.JsonNull,
          afterPayloadSnapshot: json(payload),
          reason: input.reason || group.resolutionReason,
          beforeTermSnapshot: beforeRevision?.term ?? null,
          afterTermSnapshot: payload.term,
          beforeNormalizedTermSnapshot: beforeRevision ? normalizeCatalogText(beforeRevision.term) : null,
          afterNormalizedTermSnapshot: normalizeCatalogText(payload.term),
          beforeDefinitionSnapshot: beforeRevision?.definitionZh ?? null,
          afterDefinitionSnapshot: payload.definitionZh,
          beforeLevelSnapshot: beforeRevision?.level ?? null,
          afterLevelSnapshot: payload.level,
          beforeCategorySnapshot: beforeRevision?.category ?? null,
          afterCategorySnapshot: payload.category,
          actorPseudonym: actor.value,
          actorKeyVersion: actor.keyVersion,
        },
      });
    }
    const submittedAt = new Date();
    await tx.catalogSubmissionBatch.update({
      where: { id: batch.id, revision: input.expectedRevision },
      data: { status: "SUBMITTED", submittedAt, baseMutationRevision: mutationState.revision, revision: { increment: 1 }, lastActivityAt: submittedAt },
    });
    await tx.catalogSubmissionOperationReceipt.create({
      data: { batchId: batch.id, actorUserId: input.actorId, operationKind: "SUBMIT", operationId: input.operationId, requestFingerprint: fingerprint, outcomeStatus: "SUBMITTED", summary: json(batch.summary) },
    });
    await tx.catalogHistoryFeedEntry.create({ data: { occurredAt: submittedAt, sourceKind: "BATCH", submissionBatchId: batch.id } });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "BATCH_SUBMITTED", fromStatus: batch.status, toStatus: "SUBMITTED" } });
    return {
      replay: false,
      patch: await readBatchMutationPatch(tx, {
        batchId: batch.id,
        baseRevision: input.expectedRevision,
        visibility: "OWNER",
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
}

export async function reviewCatalogSubmissionGroup(input: {
  batchId: string;
  groupId: string;
  actorId: string;
  expectedBatchRevision: number;
  expectedGroupRevision: number;
  decision: "APPROVE" | "REJECT";
  reviewNote: string;
  acknowledgedPayloadDigest?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await requireCatalogReviewerInTransaction(tx, input.actorId);
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (!REVIEW_STATUSES.includes(batch.status as (typeof REVIEW_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_REVIEWABLE");
    if (batch.revision !== input.expectedBatchRevision) throw new Error("CATALOG_BATCH_STALE");
    if (batch.reviewerId !== input.actorId) throw new Error("CATALOG_REVIEW_CLAIM_REQUIRED");
    if (batch.proposerId === input.actorId) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    const group = await tx.catalogSubmissionProposalGroup.findFirst({ where: { id: input.groupId, batchId: batch.id }, include: { authors: true } });
    if (!group) throw new Error("CATALOG_GROUP_NOT_FOUND");
    if (group.revision !== input.expectedGroupRevision) throw new Error("CATALOG_GROUP_STALE");
    if (group.authors.some((author) => author.actorUserId === input.actorId)) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    if (input.decision === "APPROVE" && input.acknowledgedPayloadDigest !== group.payloadDigest) throw new Error("CATALOG_REVIEW_ACKNOWLEDGEMENT_REQUIRED");
    if (input.decision === "REJECT" && input.reviewNote.trim().length < 3) throw new Error("CATALOG_REVIEW_NOTE_REQUIRED");
    await tx.catalogSubmissionProposalGroup.update({
      where: { id: group.id, revision: input.expectedGroupRevision },
      data: { decision: input.decision, decidedById: input.actorId, decidedAt: new Date(), reviewedPayloadDigest: group.payloadDigest, reviewNote: input.reviewNote || null, revision: { increment: 1 } },
    });
    const pending = await tx.catalogSubmissionProposalGroup.count({ where: { batchId: batch.id, decision: "PENDING" } });
    await tx.catalogSubmissionBatch.update({
      where: { id: batch.id, revision: input.expectedBatchRevision },
      data: { status: pending ? "REVIEWING" : "REVIEWED", reviewedAt: pending ? null : new Date(), revision: { increment: 1 } },
    });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "REVIEW_PROGRESS_SAVED", metadata: { groupId: group.id, decision: input.decision } } });
    return {
      requiresSecondReviewer: false,
      patch: await readBatchMutationPatch(tx, {
        batchId: batch.id,
        baseRevision: input.expectedBatchRevision,
        visibility: "REVIEWER",
        group: { id: group.id, baseRevision: input.expectedGroupRevision },
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
}

export async function requestCatalogSubmissionResolution(input: {
  batchId: string;
  groupId: string;
  actorId: string;
  expectedBatchRevision: number;
  expectedGroupRevision: number;
  reason: string;
}) {
  if (input.reason.trim().length < 3 || input.reason.length > 1000) throw new Error("CATALOG_RESOLUTION_REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await requireCatalogReviewerInTransaction(tx, input.actorId);
    await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${input.batchId} FOR UPDATE`;
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: { proposalGroups: { include: { changeRequest: true } } } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (!REVIEW_STATUSES.includes(batch.status as (typeof REVIEW_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_REVIEWABLE");
    if (batch.revision !== input.expectedBatchRevision) throw new Error("CATALOG_BATCH_STALE");
    if (batch.reviewerId !== input.actorId) throw new Error("CATALOG_REVIEW_CLAIM_REQUIRED");
    const group = batch.proposalGroups.find((item) => item.id === input.groupId);
    if (!group) throw new Error("CATALOG_GROUP_NOT_FOUND");
    if (group.revision !== input.expectedGroupRevision) throw new Error("CATALOG_GROUP_STALE");
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id, revision: input.expectedBatchRevision }, data: { status: "FINALIZING", revision: { increment: 1 } } });
    const pendingIds = batch.proposalGroups.flatMap((item) => item.changeRequest?.status === "PENDING" ? [item.changeRequest.id] : []);
    if (pendingIds.length) await tx.catalogChangeRequest.updateMany({ where: { id: { in: pendingIds }, status: "PENDING" }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id }, data: { status: "STALE", reviewerId: null, revision: { increment: 1 } } });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "RESOLUTION_REQUESTED", fromStatus: batch.status, toStatus: "STALE", metadata: { groupId: group.id, reason: input.reason.trim() } } });
    return readBatchMutationPatch(tx, {
      batchId: batch.id,
      baseRevision: input.expectedBatchRevision,
      visibility: "REVIEWER",
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function transferCatalogSubmissionClaim(input: {
  batchId: string;
  actorId: string;
  nextReviewerId: string;
  expectedRevision: number;
}) {
  return withReviewClaimTransactionRetry(() => prisma.$transaction(async (tx) => {
    const snapshot = await tx.catalogSubmissionBatch.findUnique({
      where: { id: input.batchId },
      select: { status: true, resolutionOwnerId: true, reviewerId: true },
    });
    if (!snapshot) throw new Error("CATALOG_BATCH_NOT_FOUND");
    const snapshotOwner = snapshot.status === "NEEDS_RESOLUTION"
      ? snapshot.resolutionOwnerId
      : snapshot.reviewerId;
    await lockCatalogReviewUsers(tx, [input.actorId, snapshotOwner, input.nextReviewerId]);
    await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${input.batchId} FOR UPDATE`;
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: { proposalGroups: { include: { authors: true } } } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (!CLAIMABLE_STATUSES.includes(batch.status as (typeof CLAIMABLE_STATUSES)[number])) throw new Error("CATALOG_BATCH_NOT_REVIEWABLE");
    if (batch.revision !== input.expectedRevision) throw new Error("CATALOG_BATCH_STALE");
    if (!await catalogReviewerHasAuthorityAfterLock(tx, input.actorId)) throw new Error("CATALOG_REVIEW_FORBIDDEN");
    const resolutionMode = batch.status === "NEEDS_RESOLUTION";
    if ((resolutionMode ? batch.resolutionOwnerId : batch.reviewerId) !== input.actorId) throw new Error("CATALOG_REVIEW_CLAIM_FORBIDDEN");
    if (batch.proposerId === input.nextReviewerId || batch.proposalGroups.some((group) => group.authors.some((author) => author.actorUserId === input.nextReviewerId))) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    if (!await catalogReviewerHasAuthorityAfterLock(tx, input.nextReviewerId)) throw new Error("CATALOG_REVIEW_FORBIDDEN");
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id, revision: input.expectedRevision }, data: { ...(resolutionMode ? { resolutionOwnerId: input.nextReviewerId } : { reviewerId: input.nextReviewerId }), revision: { increment: 1 } } });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "REVIEW_CLAIM_TRANSFERRED", metadata: { nextReviewerId: input.nextReviewerId } } });
    return readBatchMutationPatch(tx, {
      batchId: batch.id,
      baseRevision: input.expectedRevision,
      visibility: "REVIEWER",
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export interface CatalogFinalizeRecentAuth {
  grantId: string;
  tokenVersion: number;
  credentialRevision: number;
  reauthenticatedAt: Date;
  expiresAt: Date;
}

export async function finalizeCatalogSubmissionBatch(input: {
  batchId: string;
  actorId: string;
  expectedRevision: number;
  operationId: string;
  recentAuth: CatalogFinalizeRecentAuth;
}) {
  if (!isCanonicalUuid(input.operationId)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return prisma.$transaction(async (tx) => {
    const fingerprint = sha256(JSON.stringify({ batchId: input.batchId, expectedRevision: input.expectedRevision }));
    const receipt = await tx.catalogSubmissionOperationReceipt.findUnique({
      where: { actorUserId_operationKind_operationId: { actorUserId: input.actorId, operationKind: "FINALIZE", operationId: input.operationId } },
    });
    if (receipt) {
      if (receipt.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return {
        replay: true,
        patch: await readBatchMutationPatch(tx, {
          batchId: receipt.batchId,
          baseRevision: input.expectedRevision,
          visibility: "REVIEWER",
        }),
      };
    }
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "RecentAuthGrant" WHERE "id" = ${input.recentAuth.grantId} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, include: { teacherProfile: true } });
    const grant = await tx.recentAuthGrant.findUnique({ where: { id: input.recentAuth.grantId } });
    if (!actor || actor.status !== "ACTIVE" || (actor.role !== "ADMIN" && (actor.role !== "TEACHER" || !actor.teacherProfile?.canManageWordCatalog))) throw new Error("CATALOG_REVIEW_FORBIDDEN");
    if (!grant || grant.userId !== actor.id || grant.tokenVersion !== actor.tokenVersion || grant.credentialRevision !== actor.credentialRevision || grant.expiresAt <= new Date() || grant.reauthenticatedAt.getTime() !== input.recentAuth.reauthenticatedAt.getTime() || grant.expiresAt.getTime() !== input.recentAuth.expiresAt.getTime()) throw new Error("RECENT_AUTH_REQUIRED");
    await tx.catalogMutationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 0 }, update: {} });
    await tx.$queryRaw`SELECT "id" FROM "CatalogMutationState" WHERE "id" = 1 FOR UPDATE`;
    const mutationState = await tx.catalogMutationState.findUniqueOrThrow({ where: { id: 1 } });
    await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${input.batchId} FOR UPDATE`;
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: { proposalGroups: { orderBy: { groupNumber: "asc" }, include: { changeRequest: true, authors: true } } } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (batch.status !== "REVIEWED") throw new Error("CATALOG_BATCH_NOT_FINALIZABLE");
    if (batch.revision !== input.expectedRevision) throw new Error("CATALOG_BATCH_STALE");
    if (batch.reviewerId !== input.actorId) throw new Error("CATALOG_REVIEW_CLAIM_REQUIRED");
    if (batch.proposerId === input.actorId || batch.proposalGroups.some((group) => group.authors.some((author) => author.actorUserId === input.actorId))) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
    if (batch.proposalGroups.some((group) => group.decision === "PENDING" || group.reviewedPayloadDigest !== group.payloadDigest)) throw new Error("CATALOG_BATCH_REVIEW_INCOMPLETE");
    if (batch.schemaVersion !== CATALOG_SUBMISSION_VERSIONS.schemaVersion || batch.validatorVersion !== CATALOG_SUBMISSION_VERSIONS.validatorVersion || batch.normalizationVersion !== CATALOG_SUBMISSION_VERSIONS.normalizationVersion || batch.taxonomyDigest !== CATALOG_SUBMISSION_VERSIONS.taxonomyDigest) throw new Error("CATALOG_BATCH_VALIDATOR_STALE");
    let dependencyStale = false;
    for (const group of batch.proposalGroups) {
      if (await currentGroupDependencyDigest(tx, group, batch.id) !== group.dependencyDigest) {
        dependencyStale = true;
        break;
      }
    }
    if (dependencyStale) {
      await tx.catalogSubmissionBatch.update({ where: { id: batch.id, revision: input.expectedRevision }, data: { status: "FINALIZING", finalizerId: input.actorId, revision: { increment: 1 } } });
      const pendingRequestIds = batch.proposalGroups.flatMap((group) => group.changeRequest?.status === "PENDING" ? [group.changeRequest.id] : []);
      if (pendingRequestIds.length) await tx.catalogChangeRequest.updateMany({ where: { id: { in: pendingRequestIds }, status: "PENDING" }, data: { status: "CANCELLED", revision: { increment: 1 } } });
      await tx.catalogSubmissionBatch.update({ where: { id: batch.id }, data: { status: "STALE", baseMutationRevision: mutationState.revision, revision: { increment: 1 } } });
      await tx.catalogSubmissionOperationReceipt.create({ data: { batchId: batch.id, actorUserId: input.actorId, operationKind: "FINALIZE", operationId: input.operationId, requestFingerprint: fingerprint, outcomeStatus: "STALE", summary: json({ reason: "dependency changed" }) } });
      await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "BATCH_STALE", fromStatus: "FINALIZING", toStatus: "STALE", metadata: { reason: "dependency changed" } } });
      return {
        replay: false,
        patch: await readBatchMutationPatch(tx, {
          batchId: batch.id,
          baseRevision: input.expectedRevision,
          visibility: "REVIEWER",
        }),
      };
    }
    const lemmas = [...new Set(batch.proposalGroups.map((group) => parseCatalogGovernancePayload(group.finalProposalPayload).lemma).map(normalizeCatalogText))].sort();
    for (const lemma of lemmas) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-lemma:${lemma}`}, 0))`;
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id, revision: input.expectedRevision }, data: { status: "FINALIZING", finalizerId: input.actorId, baseMutationRevision: mutationState.revision, revision: { increment: 1 } } });
    let canonicalMutations = 0;
    for (const group of batch.proposalGroups) {
      if (!group.changeRequest) continue;
      if (group.decision !== "APPROVE" && group.decision !== "REJECT") throw new Error("CATALOG_BATCH_REVIEW_INCOMPLETE");
      const result = await reviewCatalogChange(tx, {
        requestId: group.changeRequest.id,
        reviewerId: input.actorId,
        expectedRevision: group.changeRequest.revision,
        decision: group.decision,
        reviewNote: group.reviewNote ?? "",
        batchMode: true,
        incrementMutationState: false,
        createStandaloneHistory: false,
      });
      if (result.canonicalMutation) canonicalMutations += 1;
    }
    if (canonicalMutations > 0) await bumpCatalogMutationState(tx);
    const terminalStatus = canonicalMutations > 0 ? "COMMITTED" : "REJECTED";
    const committedAt = new Date();
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id }, data: { status: terminalStatus, committedAt, revision: { increment: 1 } } });
    await tx.catalogSubmissionOperationReceipt.create({
      data: { batchId: batch.id, actorUserId: input.actorId, operationKind: "FINALIZE", operationId: input.operationId, requestFingerprint: fingerprint, outcomeStatus: terminalStatus, summary: json({ canonicalMutations }) },
    });
    await tx.catalogHistoryFeedEntry.upsert({ where: { submissionBatchId: batch.id }, create: { occurredAt: committedAt, sourceKind: "BATCH", submissionBatchId: batch.id }, update: {} });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: terminalStatus === "COMMITTED" ? "BATCH_COMMITTED" : "BATCH_REJECTED", fromStatus: "FINALIZING", toStatus: terminalStatus, metadata: { canonicalMutations } } });
    return {
      replay: false,
      patch: await readBatchMutationPatch(tx, {
        batchId: batch.id,
        baseRevision: input.expectedRevision,
        visibility: "REVIEWER",
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
}

export async function cancelCatalogSubmissionBatch(input: { batchId: string; actorId: string; expectedRevision: number }) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, include: { proposalGroups: { include: { changeRequest: true } } } });
    if (!batch) throw new Error("CATALOG_BATCH_NOT_FOUND");
    if (batch.proposerId !== input.actorId) throw new Error("CATALOG_BATCH_FORBIDDEN");
    if (batch.revision !== input.expectedRevision) throw new Error("CATALOG_BATCH_STALE");
    if (TERMINAL_STATUSES.includes(batch.status as (typeof TERMINAL_STATUSES)[number])) {
      return readBatchMutationPatch(tx, {
        batchId: batch.id,
        baseRevision: input.expectedRevision,
        visibility: "OWNER",
      });
    }
    if (batch.status === "FINALIZING") throw new Error("CATALOG_BATCH_NOT_CANCELLABLE");
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id, revision: input.expectedRevision }, data: { status: "FINALIZING", revision: { increment: 1 } } });
    const requestIds = batch.proposalGroups.flatMap((group) => group.changeRequest?.status === "PENDING" ? [group.changeRequest.id] : []);
    if (requestIds.length) await tx.catalogChangeRequest.updateMany({ where: { id: { in: requestIds }, status: "PENDING" }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    await tx.catalogSubmissionBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "BATCH_CANCELLED", fromStatus: batch.status, toStatus: "CANCELLED" } });
    return readBatchMutationPatch(tx, {
      batchId: batch.id,
      baseRevision: input.expectedRevision,
      visibility: "OWNER",
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createCorrectiveCatalogSubmissionPreview(input: {
  sourceBatchId: string;
  actorId: string;
  operationId: string;
}) {
  if (!isCanonicalUuid(input.operationId)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  const actorAudit = catalogActorPseudonym(input.actorId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.catalogSubmissionBatch.findUnique({ where: { proposerId_operationId: { proposerId: input.actorId, operationId: input.operationId } }, select: { id: true, requestDigest: true } });
    const requestDigest = sha256(JSON.stringify({ sourceBatchId: input.sourceBatchId, operationId: input.operationId, kind: "CORRECTIVE_PREVIEW" }));
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new Error("IDEMPOTENCY_CONFLICT");
      return { replay: true, batch: submissionBatchDto(await readBatchForDto(tx, existing.id)) };
    }
    const source = await tx.catalogSubmissionBatch.findUnique({
      where: { id: input.sourceBatchId },
      include: { proposalGroups: { orderBy: { groupNumber: "asc" }, include: { changeRequest: { include: { sense: { include: { approvedRevision: { select: revisionSelect }, revisions: { orderBy: { revision: "asc" }, select: revisionSelect } } } } } } } },
    });
    if (!source || source.status !== "COMMITTED") throw new Error("CATALOG_CORRECTIVE_SOURCE_INVALID");
    const candidates: Array<{
      action: "UPDATE" | "RETIRE";
      payload: ReturnType<typeof payloadFromRevision>;
      currentPayload: ReturnType<typeof payloadFromRevision>;
      sourceGroupNumber: number;
      targetCatalogKey: string | null;
      targetSenseKey: string | null;
      targetSenseId: string;
      baseRevision: number;
      baseStatus: "DRAFT" | "ACTIVE" | "RETIRED";
    }> = [];
    for (const group of source.proposalGroups) {
      const request = group.changeRequest;
      if (!request || request.status !== "APPROVED" || !request.sense || !request.resultRevisionId || request.sense.approvedRevisionId !== request.resultRevisionId) continue;
      const expectedStatus = request.kind === "CREATE" ? "ACTIVE" : request.baseStatus === "RETIRED" ? "RETIRED" : "ACTIVE";
      if (request.sense.status !== expectedStatus) continue;
      if (request.kind === "UPDATE") {
        const before = request.sense.revisions.find((revision) => revision.revision === request.baseRevision);
        const current = request.sense.approvedRevision;
        if (!before || !current) continue;
        candidates.push({
          action: "UPDATE",
          payload: payloadFromRevision(before),
          currentPayload: payloadFromRevision(current),
          sourceGroupNumber: group.groupNumber,
          targetCatalogKey: request.catalogKey,
          targetSenseKey: request.senseKey,
          targetSenseId: request.sense.id,
          baseRevision: current.revision,
          baseStatus: request.sense.status,
        });
      }
      if (request.kind === "CREATE" && request.sense.approvedRevision) {
        const currentPayload = payloadFromRevision(request.sense.approvedRevision);
        candidates.push({
          action: "RETIRE",
          payload: currentPayload,
          currentPayload,
          sourceGroupNumber: group.groupNumber,
          targetCatalogKey: request.catalogKey,
          targetSenseKey: request.senseKey,
          targetSenseId: request.sense.id,
          baseRevision: request.sense.approvedRevision.revision,
          baseStatus: request.sense.status,
        });
      }
    }
    const approvedMutations = source.proposalGroups.filter((group) => group.changeRequest?.status === "APPROVED" && (group.changeRequest.kind === "UPDATE" || group.changeRequest.kind === "CREATE")).length;
    if (!candidates.length || candidates.length !== approvedMutations) throw new Error("CATALOG_CORRECTIVE_STALE");
    const ready = await tx.catalogRevision.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!ready) throw new Error("CATALOG_NOT_READY");
    const mutation = await tx.catalogMutationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 0 }, update: {} });
    const expiry = submissionExpiry();
    const batch = await tx.catalogSubmissionBatch.create({
      data: {
        proposerId: input.actorId,
        operationId: input.operationId,
        fileName: `corrective-${source.fileName}`.slice(0, 120),
        fileHash: sha256(`${source.fileHash}\u0000corrective\u0000${source.id}`),
        requestDigest,
        schemaVersion: CATALOG_SUBMISSION_VERSIONS.schemaVersion,
        validatorVersion: CATALOG_SUBMISSION_VERSIONS.validatorVersion,
        normalizationVersion: CATALOG_SUBMISSION_VERSIONS.normalizationVersion,
        taxonomyDigest: CATALOG_SUBMISSION_VERSIONS.taxonomyDigest,
        readyCatalogRevisionId: ready.id,
        baseMutationRevision: mutation.revision,
        status: "PREVIEW",
        rowCount: candidates.length,
        summary: json({ totalRows: candidates.length, validRows: candidates.length, invalidRows: 0, proposalGroups: candidates.length, unresolvedGroups: 0, correctiveOf: source.id }),
        supersedesBatchId: source.id,
        ...expiry,
        actorPseudonym: actorAudit.value,
        actorKeyVersion: actorAudit.keyVersion,
      },
    });
    let rowNumber = 2;
    let groupNumber = 1;
    for (const candidate of candidates) {
      const payloadDigest = payloadFingerprint(candidate.payload);
      const risk = classifyCatalogReviewRisk(candidate.currentPayload, candidate.payload);
      const group = await tx.catalogSubmissionProposalGroup.create({
        data: {
          batchId: batch.id,
          groupNumber,
          requestedAction: candidate.action,
          resolution: "KEEP_SEPARATE",
          resolutionReason: `corrective proposal for source group ${candidate.sourceGroupNumber}`,
          targetCatalogKey: candidate.targetCatalogKey,
          targetSenseKey: candidate.targetSenseKey,
          targetSenseId: candidate.targetSenseId,
          baseRevision: candidate.baseRevision,
          baseStatus: candidate.baseStatus,
          dependencyDigest: "pending",
          finalProposalPayload: json(candidate.payload),
          payloadDigest,
          lastContentAuthorId: input.actorId,
          reviewRisk: risk.risk,
          reviewRiskVersion: CATALOG_REVIEW_RISK_VERSION,
          reviewRiskReason: json(risk.reasons),
          actorPseudonym: actorAudit.value,
          actorKeyVersion: actorAudit.keyVersion,
        },
      });
      const dependencyDigest = await currentGroupDependencyDigest(tx, group, batch.id);
      await tx.catalogSubmissionProposalGroup.update({ where: { id: group.id }, data: { dependencyDigest } });
      await tx.catalogSubmissionProposalAuthor.create({ data: { proposalGroupId: group.id, actorUserId: input.actorId, payloadDigest, contributionKind: "CORRECTIVE_PREVIEW", actorPseudonym: actorAudit.value, actorKeyVersion: actorAudit.keyVersion } });
      await tx.catalogSubmissionRow.create({ data: { batchId: batch.id, rowNumber, rowDigest: sha256(`${batch.id}\u0000${rowNumber}\u0000${payloadDigest}`), requestedAction: candidate.action, primaryDisposition: candidate.action, warnings: [], errors: [], normalizedTerm: normalizeCatalogText(candidate.payload.term), normalizedLemma: normalizeCatalogText(candidate.payload.lemma), normalizedSourcePayload: json(candidate.payload), proposalGroupId: group.id, rowRole: "CANONICAL_SOURCE" } });
      rowNumber += 1;
      groupNumber += 1;
    }
    await tx.catalogAuditEvent.create({ data: { actorUserId: input.actorId, submissionBatchId: batch.id, action: "CORRECTIVE_PREVIEW_CREATED", metadata: { sourceBatchId: source.id, groups: candidates.length } } });
    return { replay: false, batch: submissionBatchDto(await readBatchForDto(tx, batch.id)) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
}

export function catalogBatchErrorsCsv(batch: Awaited<ReturnType<typeof getCatalogSubmissionBatch>>): string {
  const headers = ["row_number", "excel_column", "field", "term", "action", "disposition", "error_code", "message_zh", "technical_detail", "fix", "target_sense_key", "warnings"];
  const lines = batch.rows.flatMap((row) => {
    const errors = Array.isArray(row.errors) ? row.errors.map(String) : [];
    if (!errors.length) return [];
    const payload = row.normalizedSourcePayload && typeof row.normalizedSourcePayload === "object" ? row.normalizedSourcePayload as Record<string, unknown> : {};
    const warnings = Array.isArray(row.warnings) ? row.warnings.map(String).join(" | ") : "";
    return errors.map((error) => {
      const descriptor = describeCatalogBatchError(error);
      const targetSenseKey = batch.groups.find((group) => group.id === row.proposalGroupId)?.targetSenseKey ?? "";
      return [row.rowNumber, descriptor.excelColumn, descriptor.field, payload.term ?? "", row.requestedAction, row.primaryDisposition, descriptor.code, descriptor.message, error, descriptor.fix, targetSenseKey, warnings].map(neutralizeCsvCell).join(",");
    });
  });
  return `\uFEFF${headers.map(neutralizeCsvCell).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}
