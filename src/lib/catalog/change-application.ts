import { Prisma } from "@/lib/prisma";
import {
  normalizeCatalogRow,
  normalizeCatalogText,
} from "./csv";
import {
  catalogEntryAcceptsLemma,
  parseCatalogGovernancePayload,
  payloadFromRevision,
  payloadToSourceRow,
  resolveExistingCatalogEntryForLemma,
  revisionContentDigest,
  validateCatalogGovernancePayload,
  type CatalogGovernancePayload,
} from "./governance";

type Tx = Prisma.TransactionClient;

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function projectionData(
  payload: CatalogGovernancePayload,
  senseId: string,
  senseKey: string,
  revisionId: string,
  catalogRevisionId: string,
): Prisma.WordUncheckedCreateInput {
  return {
    id: undefined,
    senseId,
    senseKey,
    contentRevisionId: revisionId,
    catalogRevisionId,
    term: payload.term,
    phonetic: payload.phoneticIpa,
    pos: payload.partOfSpeech,
    definition: payload.definitionZh,
    level: payload.level,
    category: payload.category,
    examples: payload.exampleEn && payload.exampleZh
      ? jsonValue([{ en: payload.exampleEn, zh: payload.exampleZh }])
      : jsonValue([]),
    synonyms: payload.synonymsEn,
    antonyms: payload.antonymsEn,
    acceptedAnswers: payload.acceptedAnswersZh,
    acceptedForms: payload.acceptedFormsEn,
    distractorZh: payload.distractorZh,
    distractorEn: payload.distractorEn,
    enableEnToZh: payload.enableEnToZh,
    enableZhToEn: payload.enableZhToEn,
  };
}

const requestInclude = {
  sense: {
    include: {
      catalogEntry: true,
      revisions: { orderBy: { revision: "desc" as const }, take: 1 },
      approvedRevision: true,
    },
  },
  sourceImportRow: true,
  submissionProposalGroup: { include: { batch: true } },
} as const;

type LoadedRequest = Prisma.CatalogChangeRequestGetPayload<{ include: typeof requestInclude }>;

export interface CatalogChangePlan {
  request: LoadedRequest;
  payload: CatalogGovernancePayload | null;
  latestRevision: NonNullable<LoadedRequest["sense"]>["revisions"][number] | null;
  catalogRevisionId: string;
  identity: { catalogKey: string; senseKey: string; sourceFile: string; sourceRow: number };
  validationWarnings: string[];
}

export interface ReviewCatalogChangeInput {
  requestId: string;
  reviewerId: string;
  expectedRevision: number;
  decision: "APPROVE" | "REJECT";
  reviewNote: string;
  batchMode: boolean;
  incrementMutationState?: boolean;
  createStandaloneHistory?: boolean;
}

export interface ReviewCatalogChangeResult {
  replay: boolean;
  request: {
    id: string;
    status: string;
    kind: string;
    reviewNote: string | null;
    reviewedAt: string | null;
  };
  canonicalMutation: boolean;
  resultRevisionId: string | null;
}

function summary(request: { id: string; status: string; kind: string; reviewNote: string | null; reviewedAt: Date | null }) {
  return {
    id: request.id,
    status: request.status,
    kind: request.kind,
    reviewNote: request.reviewNote,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
  };
}

async function ensureMutationStateLocked(tx: Tx): Promise<void> {
  await tx.catalogMutationState.upsert({
    where: { id: 1 },
    create: { id: 1, revision: 0 },
    update: {},
  });
  await tx.$queryRaw`SELECT "id" FROM "CatalogMutationState" WHERE "id" = 1 FOR UPDATE`;
}

async function incrementMutationState(tx: Tx): Promise<void> {
  await tx.catalogMutationState.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
}

async function writeStandaloneHistory(tx: Tx, request: LoadedRequest, occurredAt: Date): Promise<void> {
  if (request.submissionProposalGroupId) return;
  await tx.catalogHistoryFeedEntry.upsert({
    where: { requestId: request.id },
    create: { occurredAt, sourceKind: "STANDALONE_REQUEST", requestId: request.id },
    update: {},
  });
}

function sameSense(payload: CatalogGovernancePayload, candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const value = candidate as Record<string, unknown>;
  const candidateLemma = typeof value.lemma === "string" ? value.lemma : typeof value.term === "string" ? value.term : "";
  const candidateDefinition = typeof value.definitionZh === "string" ? value.definitionZh : "";
  const candidatePos = typeof value.partOfSpeech === "string" ? value.partOfSpeech : typeof value.pos === "string" ? value.pos : "";
  return normalizeCatalogText(candidateLemma) === normalizeCatalogText(payload.lemma)
    && normalizeCatalogText(candidateDefinition) === normalizeCatalogText(payload.definitionZh)
    && normalizeCatalogText(candidatePos) === normalizeCatalogText(payload.partOfSpeech);
}

export async function validateAndPlanCatalogChange(
  tx: Tx,
  requestId: string,
  expectedRevision: number,
  batchMode: boolean,
): Promise<CatalogChangePlan> {
  const request = await tx.catalogChangeRequest.findUnique({ where: { id: requestId }, include: requestInclude });
  if (!request) throw new Error("CATALOG_REQUEST_NOT_FOUND");
  if (request.revision !== expectedRevision) throw new Error("CATALOG_REQUEST_STALE");
  if (Boolean(request.submissionProposalGroupId) !== batchMode) {
    throw new Error(request.submissionProposalGroupId ? "CATALOG_BATCH_REVIEW_REQUIRED" : "CATALOG_REQUEST_NOT_BATCH_CHILD");
  }
  if (batchMode && request.submissionProposalGroup?.batch.status !== "FINALIZING") {
    throw new Error("CATALOG_BATCH_NOT_FINALIZING");
  }
  const latest = request.sense?.revisions[0] ?? null;
  const baseRevision = request.sense?.approvedRevision?.revision ?? latest?.revision ?? null;
  if (request.baseRevision !== baseRevision) throw new Error("CATALOG_REVISION_STALE");
  const catalogRevision = await tx.catalogRevision.findFirst({
    where: { status: "READY" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!catalogRevision) throw new Error("CATALOG_NOT_READY");

  const identity = {
    catalogKey: request.catalogKey ?? request.sourceImportRow?.catalogKey ?? request.sense?.catalogEntry.catalogKey ?? "",
    senseKey: request.senseKey ?? request.sourceImportRow?.senseKey ?? request.sense?.senseKey ?? "",
    sourceFile: request.sourceImportRow?.sourceFile ?? "governance",
    sourceRow: request.sourceImportRow?.sourceRow ?? 0,
  };
  if (!identity.catalogKey || !identity.senseKey) throw new Error("CATALOG_IDENTITY_MISSING");
  if (request.kind === "RETIRE" || request.kind === "REACTIVATE") {
    return { request, payload: null, latestRevision: latest, catalogRevisionId: catalogRevision.id, identity, validationWarnings: [] };
  }

  let payload: CatalogGovernancePayload;
  try {
    payload = parseCatalogGovernancePayload(request.payload);
  } catch (error) {
    throw new Error(`CATALOG_PAYLOAD_REJECTED:${error instanceof Error ? error.message : "invalid payload"}`);
  }
  if (request.kind === "UPDATE" && request.sense && !catalogEntryAcceptsLemma(request.sense.catalogEntry.normalizedLemma, payload.lemma)) {
    throw new Error("CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE");
  }
  const siblings = await tx.wordSense.findMany({
    where: {
      normalizedTerm: normalizeCatalogText(payload.term),
      ...(request.sense ? { senseKey: { not: request.sense.senseKey } } : {}),
    },
    include: {
      catalogEntry: { select: { catalogKey: true } },
      revisions: { orderBy: { revision: "desc" }, take: 1 },
      approvedRevision: true,
    },
  });
  const siblingRows = siblings.flatMap((sibling) => {
    const siblingRevision = sibling.approvedRevision ?? sibling.revisions[0];
    if (!siblingRevision) return [];
    const siblingPayload = payloadFromRevision(siblingRevision);
    return [normalizeCatalogRow(payloadToSourceRow(siblingPayload, {
      catalogKey: sibling.catalogEntry.catalogKey,
      senseKey: sibling.senseKey,
      sourceFile: "sibling",
      sourceRow: 0,
    }, siblingRevision.revision), 0)];
  });
  const validation = validateCatalogGovernancePayload(payload, identity, (latest?.revision ?? 0) + 1, siblingRows);
  if (validation.errors.length) throw new Error(`CATALOG_PAYLOAD_REJECTED:${JSON.stringify(validation.errors)}`);
  if (!payload.enableEnToZh && !payload.enableZhToEn) throw new Error("CATALOG_NO_ENABLED_DIRECTION");
  if (request.kind === "CREATE") {
    const pendingCreates = await tx.catalogChangeRequest.findMany({
      where: { status: "PENDING", kind: "CREATE", id: { not: requestId } },
      select: {
        senseKey: true,
        payload: true,
        submissionProposalGroup: { select: { batchId: true } },
      },
    });
    const currentBatchId = batchMode ? request.submissionProposalGroup?.batchId : null;
    const conflictingPending = pendingCreates.filter((candidate) => {
      if (!currentBatchId) return true;
      return candidate.submissionProposalGroup?.batchId !== currentBatchId;
    });
    if (conflictingPending.some((candidate) => candidate.senseKey === identity.senseKey || sameSense(payload, candidate.payload))) {
      throw new Error("CATALOG_PENDING_SENSE_CONFLICT");
    }
    const existingSenses = await tx.wordSense.findMany({
      where: {
        OR: [
          { normalizedTerm: normalizeCatalogText(payload.term) },
          { catalogEntry: { normalizedLemma: normalizeCatalogText(payload.lemma) } },
        ],
      },
      include: { approvedRevision: true, revisions: { orderBy: { revision: "desc" }, take: 1 } },
    });
    if (existingSenses.some((candidate) => sameSense(payload, candidate.approvedRevision ?? candidate.revisions[0]))) {
      throw new Error("CATALOG_ALREADY_EXISTS");
    }
  }
  return { request, payload, latestRevision: latest, catalogRevisionId: catalogRevision.id, identity, validationWarnings: validation.warnings };
}

export async function applyCatalogChange(
  tx: Tx,
  plan: CatalogChangePlan,
): Promise<{ resultRevisionId: string | null; senseId: string; senseKey: string; catalogKey: string; toStatus: string; revision: number | null }> {
  const { request, latestRevision: latest, identity } = plan;
  let approvedSenseId = request.senseId;
  let approvedSenseKey = identity.senseKey;
  let approvedCatalogKey = identity.catalogKey;
  let approvedToStatus = request.baseStatus ?? "DRAFT";
  let resultRevisionId: string | null = request.sense?.approvedRevisionId ?? null;
  let resultRevisionNumber: number | null = latest?.revision ?? null;

  if (request.kind === "RETIRE") {
    if (!request.sense || request.sense.status === "RETIRED") throw new Error("CATALOG_ALREADY_RETIRED");
    if (request.sense.status !== "ACTIVE" || !request.sense.approvedRevisionId) throw new Error("CATALOG_NOT_ACTIVE");
    await tx.wordSense.update({ where: { id: request.sense.id }, data: { status: "RETIRED", updatedAt: new Date() } });
    approvedSenseId = request.sense.id;
    approvedToStatus = "RETIRED";
  } else if (request.kind === "REACTIVATE") {
    if (!request.sense || request.sense.status !== "RETIRED" || !request.sense.approvedRevisionId) throw new Error("CATALOG_NOT_RETIRED");
    if (!request.sense.approvedRevision) throw new Error("CATALOG_APPROVED_REVISION_MISSING");
    await tx.wordSense.update({ where: { id: request.sense.id }, data: { status: "ACTIVE", updatedAt: new Date() } });
    const approvedPayload = payloadFromRevision(request.sense.approvedRevision);
    const projection = projectionData(approvedPayload, request.sense.id, request.sense.senseKey, request.sense.approvedRevision.id, plan.catalogRevisionId);
    await tx.word.upsert({ where: { senseId: request.sense.id }, create: projection, update: { ...projection, id: undefined } });
    approvedSenseId = request.sense.id;
    approvedToStatus = "ACTIVE";
  } else if (request.kind === "CREATE") {
    if (!plan.payload) throw new Error("CATALOG_PAYLOAD_REJECTED:missing payload");
    if (request.sense) throw new Error("CATALOG_ALREADY_EXISTS");
    const normalizedLemma = normalizeCatalogText(plan.payload.lemma);
    const [entryByKey, entryByLemma] = await Promise.all([
      tx.catalogEntry.findUnique({ where: { catalogKey: identity.catalogKey } }),
      tx.catalogEntry.findFirst({ where: { normalizedLemma }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    const existingEntry = resolveExistingCatalogEntryForLemma(plan.payload.lemma, entryByKey, entryByLemma);
    const entry = existingEntry ?? await tx.catalogEntry.create({ data: { catalogKey: identity.catalogKey, lemma: plan.payload.lemma, normalizedLemma } });
    const sense = await tx.wordSense.create({
      data: {
        catalogEntryId: entry.id,
        senseKey: identity.senseKey,
        term: plan.payload.term,
        normalizedTerm: normalizeCatalogText(plan.payload.term),
        pos: plan.payload.partOfSpeech,
        level: plan.payload.level,
        category: plan.payload.category,
        status: "DRAFT",
      },
    });
    const revision = await tx.wordSenseRevision.create({
      data: revisionData(plan.payload, sense.id, 1, plan.catalogRevisionId, request.reason),
    });
    await tx.wordSense.update({ where: { id: sense.id }, data: { status: "ACTIVE", approvedRevisionId: revision.id } });
    await tx.word.create({ data: projectionData(plan.payload, sense.id, sense.senseKey, revision.id, plan.catalogRevisionId) });
    approvedSenseId = sense.id;
    approvedSenseKey = sense.senseKey;
    approvedCatalogKey = entry.catalogKey;
    approvedToStatus = "ACTIVE";
    resultRevisionId = revision.id;
    resultRevisionNumber = 1;
  } else {
    if (!plan.payload || !request.sense || !latest) throw new Error("CATALOG_SENSE_NOT_FOUND");
    const revision = await tx.wordSenseRevision.create({
      data: revisionData(plan.payload, request.sense.id, latest.revision + 1, plan.catalogRevisionId, request.reason),
    });
    const nextStatus = request.sense.status === "RETIRED" ? "RETIRED" : "ACTIVE";
    await tx.wordSense.update({
      where: { id: request.sense.id },
      data: {
        term: plan.payload.term,
        normalizedTerm: normalizeCatalogText(plan.payload.term),
        pos: plan.payload.partOfSpeech,
        level: plan.payload.level,
        category: plan.payload.category,
        status: nextStatus,
        approvedRevisionId: revision.id,
      },
    });
    const projection = projectionData(plan.payload, request.sense.id, request.sense.senseKey, revision.id, plan.catalogRevisionId);
    await tx.word.upsert({ where: { senseId: request.sense.id }, create: projection, update: { ...projection, id: undefined } });
    approvedSenseId = request.sense.id;
    approvedToStatus = nextStatus;
    resultRevisionId = revision.id;
    resultRevisionNumber = latest.revision + 1;
  }
  if (!approvedSenseId) throw new Error("CATALOG_SENSE_NOT_FOUND");
  return { resultRevisionId, senseId: approvedSenseId, senseKey: approvedSenseKey, catalogKey: approvedCatalogKey, toStatus: approvedToStatus, revision: resultRevisionNumber };
}

function revisionData(
  payload: CatalogGovernancePayload,
  senseId: string,
  revision: number,
  catalogRevisionId: string,
  requestReason: string | null,
): Prisma.WordSenseRevisionUncheckedCreateInput {
  return {
    senseId,
    revision,
    term: payload.term,
    lemma: payload.lemma,
    pos: payload.partOfSpeech,
    level: payload.level,
    category: payload.category,
    definitionZh: payload.definitionZh,
    acceptedAnswersZh: payload.acceptedAnswersZh,
    phoneticIpa: payload.phoneticIpa,
    exampleEn: payload.exampleEn,
    exampleZh: payload.exampleZh,
    acceptedFormsEn: payload.acceptedFormsEn,
    synonymsEn: payload.synonymsEn,
    antonymsEn: payload.antonymsEn,
    enableEnToZh: payload.enableEnToZh,
    distractorZh: payload.distractorZh,
    enableZhToEn: payload.enableZhToEn,
    distractorEn: payload.distractorEn,
    contentDigest: revisionContentDigest(payload),
    sourceReference: payload.sourceReference,
    contributorRef: payload.contributorRef,
    changeNote: payload.changeNote ?? requestReason,
    retirementReason: payload.retirementReason,
    catalogRevisionId,
  };
}

export async function reviewCatalogChange(
  tx: Tx,
  input: ReviewCatalogChangeInput,
): Promise<ReviewCatalogChangeResult> {
  const current = await tx.catalogChangeRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
  if (!current) throw new Error("CATALOG_REQUEST_NOT_FOUND");
  if (current.status !== "PENDING") {
    return { replay: true, request: summary(current), canonicalMutation: false, resultRevisionId: current.resultRevisionId };
  }
  if (current.proposerId === input.reviewerId) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
  if (current.submissionProposalGroup?.lastContentAuthorId === input.reviewerId) throw new Error("CATALOG_SELF_REVIEW_FORBIDDEN");
  if (Boolean(current.submissionProposalGroupId) !== input.batchMode) {
    throw new Error(current.submissionProposalGroupId ? "CATALOG_BATCH_REVIEW_REQUIRED" : "CATALOG_REQUEST_NOT_BATCH_CHILD");
  }
  await ensureMutationStateLocked(tx);
  const now = new Date();
  if (input.decision === "REJECT") {
    const updated = await tx.catalogChangeRequest.update({
      where: { id: input.requestId, revision: input.expectedRevision, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewerId: input.reviewerId,
        reviewNote: input.reviewNote,
        reviewedAt: now,
        revision: { increment: 1 },
      },
      select: { id: true, status: true, kind: true, reviewNote: true, reviewedAt: true },
    });
    await tx.catalogAuditEvent.create({
      data: {
        requestId: current.id,
        actorUserId: input.reviewerId,
        senseId: current.senseId,
        submissionBatchId: current.submissionProposalGroup?.batchId,
        action: "REJECTED",
        fromStatus: "PENDING",
        toStatus: "REJECTED",
        revision: current.sense?.revisions[0]?.revision ?? null,
        metadata: { reviewNote: input.reviewNote },
      },
    });
    if (input.createStandaloneHistory !== false) await writeStandaloneHistory(tx, current, now);
    return { replay: false, request: summary(updated), canonicalMutation: false, resultRevisionId: null };
  }

  const plan = await validateAndPlanCatalogChange(tx, input.requestId, input.expectedRevision, input.batchMode);
  const applied = await applyCatalogChange(tx, plan);
  if (plan.request.sourceImportRowId) {
    await tx.catalogImportRow.update({
      where: { id: plan.request.sourceImportRowId },
      data: {
        primaryDisposition: "CREATED_DRAFT",
        eligibilityResult: "ACTIVATION_ELIGIBLE",
        issues: { errors: [], warnings: plan.validationWarnings },
      },
    });
  }
  const updated = await tx.catalogChangeRequest.update({
    where: { id: input.requestId, revision: input.expectedRevision, status: "PENDING" },
    data: {
      senseId: applied.senseId,
      catalogKey: applied.catalogKey,
      senseKey: applied.senseKey,
      status: "APPROVED",
      reviewerId: input.reviewerId,
      reviewNote: input.reviewNote || null,
      reviewedAt: now,
      proposedRevision: applied.revision,
      resultRevisionId: applied.resultRevisionId,
      revision: { increment: 1 },
    },
    select: { id: true, status: true, kind: true, reviewNote: true, reviewedAt: true },
  });
  await tx.catalogAuditEvent.create({
    data: {
      requestId: input.requestId,
      actorUserId: input.reviewerId,
      senseId: applied.senseId,
      submissionBatchId: plan.request.submissionProposalGroup?.batchId,
      action: plan.request.kind === "RETIRE" ? "RETIRED" : plan.request.kind === "REACTIVATE" ? "REACTIVATED" : "APPROVED",
      fromStatus: plan.request.baseStatus,
      toStatus: applied.toStatus,
      revision: applied.revision,
      metadata: { reviewNote: input.reviewNote, senseKey: applied.senseKey, sourceIssues: plan.request.sourceImportRow?.issues ?? null },
    },
  });
  if (input.incrementMutationState !== false) await incrementMutationState(tx);
  if (input.createStandaloneHistory !== false) await writeStandaloneHistory(tx, plan.request, now);
  return { replay: false, request: summary(updated), canonicalMutation: true, resultRevisionId: applied.resultRevisionId };
}

export async function bumpCatalogMutationState(tx: Tx): Promise<number> {
  await ensureMutationStateLocked(tx);
  const state = await tx.catalogMutationState.update({
    where: { id: 1 },
    data: { revision: { increment: 1 } },
    select: { revision: true },
  });
  return state.revision;
}
