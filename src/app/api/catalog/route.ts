import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogAccess, requireCatalogReviewerInTransaction } from "@/lib/catalog/access";
import { catalogBulkSubmissionEnabled, catalogHistoryEnabled } from "@/lib/catalog/features";
import {
  catalogEntryAcceptsLemma,
  parseCatalogGovernancePayload,
  payloadFingerprint,
  payloadFromRevision,
  validateCatalogGovernancePayload,
  type CatalogGovernancePayload,
} from "@/lib/catalog/governance";
import { normalizeCatalogRow, normalizeCatalogText } from "@/lib/catalog/csv";
import { isRetryableTransactionConflict } from "@/lib/transaction-retry";
import { catalogActorPseudonym } from "@/lib/catalog/submission";
import { consumeCatalogGovernanceLimit } from "@/lib/catalog-limiter";
import { getClientIp } from "@/lib/login-limiter";
import {
  cancelSupersededStandaloneRetireRequests,
  ensureCatalogMutationStateLocked,
  reviewCatalogChange,
} from "@/lib/catalog/change-application";
import { parseCatalogExpectedRevision } from "@/lib/catalog/review-policy";
import { readCatalogWorkspaceVersion } from "@/lib/catalog/workspace-version";

const MAX_REQUEST_BYTES = 128 * 1024;
const CHANGE_KINDS = ["UPDATE", "CREATE", "RETIRE", "REACTIVATE"] as const;
type ChangeKind = (typeof CHANGE_KINDS)[number];

const revisionSelect = {
  id: true,
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

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function errorResponse(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers: privateHeaders() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function listValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function issueRecord(value: Prisma.JsonValue | null): { errors: string[]; warnings: string[] } {
  if (!isRecord(value)) return { errors: [], warnings: [] };
  return {
    errors: listValue(value.errors),
    warnings: listValue(value.warnings),
  };
}

function summaryPayload(value: unknown): {
  term: string;
  lemma: string;
  definitionZh: string;
  partOfSpeech: string;
  level: string;
  category: string;
  phoneticIpa: string | null;
  enableEnToZh: boolean;
  enableZhToEn: boolean;
} {
  const row = isRecord(value) ? value : {};
  return {
    term: stringValue(row.term) ?? "",
    lemma: stringValue(row.lemma) ?? "",
    definitionZh: stringValue(row.definitionZh) ?? "",
    partOfSpeech: stringValue(row.pos) ?? stringValue(row.partOfSpeech) ?? "",
    level: stringValue(row.level) ?? "",
    category: stringValue(row.category) ?? "",
    phoneticIpa: stringValue(row.phoneticIpa),
    enableEnToZh: booleanValue(row.enableEnToZh),
    enableZhToEn: booleanValue(row.enableZhToEn),
  };
}

function changeSummary(request: {
  id: string;
  kind: string;
  status: string;
  proposerId: string;
  reviewerId: string | null;
  baseRevision: number | null;
  revision: number;
  reason: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}) {
  return {
    id: request.id,
    kind: request.kind,
    status: request.status,
    proposerId: request.proposerId,
    reviewerId: request.reviewerId,
    baseRevision: request.baseRevision,
    revision: request.revision,
    reason: request.reason,
    reviewNote: request.reviewNote,
    createdAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return errorResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);

  try {
    const access = await catalogAccess(auth);
    const initialVersion = await readCatalogWorkspaceVersion();
    const batch = await prisma.catalogImportBatch.findFirst({
      where: { status: "READY" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, sourceDigest: true, status: true, createdAt: true, report: true },
    });
    if (!batch) {
      const version = await readCatalogWorkspaceVersion();
      if (version.signature !== initialVersion.signature) return errorResponse("CATALOG_READ_STALE", 409);
      return NextResponse.json({ rows: [], counts: { all: 0 }, mutationRevision: version.mutationRevision, workspaceSignature: version.signature, canReview: access.canReview, actorUserId: auth.userId, bulkEnabled: catalogBulkSubmissionEnabled(), historyEnabled: catalogHistoryEnabled(), batch: null }, { headers: privateHeaders() });
    }

    const importRows = await prisma.catalogImportRow.findMany({
      where: { batchId: batch.id },
      orderBy: [{ sourceFile: "asc" }, { sourceRow: "asc" }],
      select: {
        id: true,
        sourceFile: true,
        sourceRow: true,
        primaryDisposition: true,
        eligibilityResult: true,
        catalogKey: true,
        senseKey: true,
        issues: true,
        sourceData: true,
        changeRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, kind: true, status: true, proposerId: true, reviewerId: true, baseRevision: true, revision: true, reason: true, reviewNote: true, createdAt: true, reviewedAt: true },
        },
      },
    });
    const senseKeys = importRows.flatMap((row) => row.senseKey ? [row.senseKey] : []);
    const senses = await prisma.wordSense.findMany({
      select: {
        id: true,
        senseKey: true,
        catalogEntry: { select: { catalogKey: true } },
        status: true,
        term: true,
        level: true,
        category: true,
        approvedRevisionId: true,
        revisions: {
          orderBy: { revision: "desc" },
          take: 1,
          select: revisionSelect,
        },
        approvedRevision: { select: revisionSelect },
        changeRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, kind: true, status: true, proposerId: true, reviewerId: true, baseRevision: true, revision: true, reason: true, reviewNote: true, createdAt: true, reviewedAt: true },
        },
      },
    });
    const standaloneCreates = await prisma.catalogChangeRequest.findMany({
      where: {
        status: "PENDING",
        kind: "CREATE",
        senseId: null,
        sourceImportRowId: null,
        ...(access.canReview ? {} : { proposerId: auth.userId }),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        proposerId: true,
        reviewerId: true,
        baseRevision: true,
        revision: true,
        reason: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
        catalogKey: true,
        senseKey: true,
        payload: true,
      },
    });
    const senseByKey = new Map(senses.map((sense) => [sense.senseKey, sense]));
    const importedSenseKeys = new Set(senseKeys);
    const listRows = [
      ...importRows,
      ...senses
        .filter((sense) => !importedSenseKeys.has(sense.senseKey))
        .map((sense) => ({
          id: sense.id,
          sourceFile: "governance",
          sourceRow: 0,
          primaryDisposition: "NO_CHANGE",
          eligibilityResult: sense.status === "ACTIVE" ? "ACTIVATION_ELIGIBLE" : "DRAFT_BLOCKED",
          catalogKey: sense.catalogEntry.catalogKey,
          senseKey: sense.senseKey,
          issues: null,
          sourceData: null,
          changeRequests: [],
        })),
      ...standaloneCreates.map((request) => ({
        id: request.id,
        sourceFile: null,
        sourceRow: 0,
        primaryDisposition: "CREATED_DRAFT",
        eligibilityResult: "DRAFT_BLOCKED",
        catalogKey: request.catalogKey,
        senseKey: request.senseKey,
        issues: { errors: ["PENDING_CREATE"], warnings: [] },
        sourceData: request.payload,
        changeRequests: [request],
      })),
    ];
    const rows = listRows.map((sourceRow) => {
      const sense = sourceRow.senseKey ? senseByKey.get(sourceRow.senseKey) : undefined;
      const latestRevision = sense?.revisions[0];
      const revision = sense?.approvedRevision ?? latestRevision;
      const sourcePayload = isRecord(sourceRow.sourceData) ? sourceRow.sourceData : {};
      const compact = revision ? summaryPayload(revision) : summaryPayload(sourcePayload);
      const issue = issueRecord(sourceRow.issues);
      const pending = sense?.changeRequests[0] ?? sourceRow.changeRequests[0] ?? null;
      return {
        id: sourceRow.id,
        senseKey: sourceRow.senseKey,
        catalogKey: sourceRow.catalogKey,
        sourceFile: sourceRow.sourceFile,
        sourceRow: sourceRow.sourceRow,
        term: compact.term,
        lemma: compact.lemma,
        definitionZh: compact.definitionZh,
        partOfSpeech: compact.partOfSpeech,
        level: compact.level,
        category: compact.category,
        phoneticIpa: compact.phoneticIpa,
        enableEnToZh: compact.enableEnToZh,
        enableZhToEn: compact.enableZhToEn,
        status: sense?.status ?? "DRAFT",
        revision: sense?.approvedRevision?.revision ?? latestRevision?.revision ?? null,
        latestRevision: latestRevision?.revision ?? null,
        approvedRevisionId: sense?.approvedRevisionId ?? null,
        primaryDisposition: sourceRow.primaryDisposition,
        eligibilityResult: sourceRow.eligibilityResult,
        validationErrors: issue.errors,
        validationWarnings: issue.warnings,
        pendingRequest: pending ? changeSummary(pending) : null,
        hasSense: Boolean(sense),
      };
    });
    const counts = rows.reduce<Record<string, number>>((result, row) => {
      result.all = (result.all ?? 0) + 1;
      result[row.status] = (result[row.status] ?? 0) + 1;
      if (row.primaryDisposition === "VALIDATION_FAILED") result.validationFailed = (result.validationFailed ?? 0) + 1;
      if (row.eligibilityResult === "DRAFT_BLOCKED") result.blocked = (result.blocked ?? 0) + 1;
      if (row.pendingRequest) result.pending = (result.pending ?? 0) + 1;
      return result;
    }, { all: 0 });
    const version = await readCatalogWorkspaceVersion();
    if (version.signature !== initialVersion.signature) return errorResponse("CATALOG_READ_STALE", 409);
    return NextResponse.json({
      rows,
      counts,
      mutationRevision: version.mutationRevision,
      workspaceSignature: version.signature,
      canReview: access.canReview,
      actorUserId: auth.userId,
      bulkEnabled: catalogBulkSubmissionEnabled(),
      historyEnabled: catalogHistoryEnabled(),
      batch: { id: batch.id, sourceDigest: batch.sourceDigest, status: batch.status, createdAt: batch.createdAt.toISOString(), report: batch.report },
    }, { headers: privateHeaders() });
  } catch (error) {
    console.error("[catalog] list failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return errorResponse("CATALOG_READ_FAILED", 500);
  }
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return errorResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return errorResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);
  const limit = await consumeCatalogGovernanceLimit(auth.userId, getClientIp(req));
  if (!limit.ok) {
    const response = errorResponse(limit.backendUnavailable ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "CATALOG_RATE_LIMITED", limit.backendUnavailable ? 503 : 429);
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) return errorResponse("CATALOG_INPUT_TOO_LARGE", 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed)) throw new Error("invalid body");
    body = parsed;
  } catch {
    return errorResponse("CATALOG_INPUT_INVALID", 422);
  }
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const senseKey = typeof body.senseKey === "string" ? body.senseKey.trim() : "";
  if (body.sourceRowId !== undefined && typeof body.sourceRowId !== "string") return errorResponse("CATALOG_INPUT_INVALID", 422);
  const sourceRowId = typeof body.sourceRowId === "string" ? body.sourceRowId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.immediate !== undefined && typeof body.immediate !== "boolean") return errorResponse("CATALOG_INPUT_INVALID", 422);
  const immediateRetire = body.immediate === true;
  if (!operationId || operationId.length > 120 || !CHANGE_KINDS.includes(kind as ChangeKind)) return errorResponse("CATALOG_INPUT_INVALID", 422);
  if (immediateRetire && kind !== "RETIRE") return errorResponse("CATALOG_INPUT_INVALID", 422);
  if ((kind === "RETIRE" || kind === "REACTIVATE") && !senseKey) return errorResponse("CATALOG_SENSE_REQUIRED", 422);
  if (kind === "RETIRE" && reason.length < 3) return errorResponse("CATALOG_REASON_REQUIRED", 422);
  if (reason.length > 2000) return errorResponse("CATALOG_REASON_INVALID", 422);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseCatalogExpectedRevision(body.expectedRevision, immediateRetire);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CATALOG_REVISION_INVALID";
    return errorResponse(code, 422);
  }

  let payload: CatalogGovernancePayload | null = null;
  if (kind === "UPDATE" || kind === "CREATE") {
    try {
      payload = parseCatalogGovernancePayload(body.payload);
    } catch (error) {
      return errorResponse("CATALOG_PAYLOAD_INVALID", 422, { detail: error instanceof Error ? error.message : "invalid payload" });
    }
  }
  const requestFingerprint = payloadFingerprint({
    operationId,
    kind,
    senseKey,
    sourceRowId,
    expectedRevision,
    payload,
    reason,
    ...(immediateRetire ? { immediateRetire: true } : {}),
  });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.catalogChangeRequest.findUnique({ where: { proposerId_operationId: { proposerId: auth.userId, operationId } }, select: { id: true, requestFingerprint: true, status: true } });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
        return { replay: true, requestId: existing.id, status: existing.status, immediate: immediateRetire };
      }
      if (immediateRetire) {
        await requireCatalogReviewerInTransaction(tx, auth.userId);
        // Keep the same lock order as ordinary review: reviewer -> mutation
        // state -> request/sense. This prevents a direct retirement from
        // deadlocking with a reviewer deciding an existing RETIRE request.
        await ensureCatalogMutationStateLocked(tx);
      }
      const batch = await tx.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
      if (!batch) throw new Error("CATALOG_NOT_READY");
      const sourceRow = sourceRowId
        ? await tx.catalogImportRow.findFirst({ where: { id: sourceRowId, batchId: batch.id }, select: { id: true, catalogKey: true, senseKey: true, sourceFile: true, sourceRow: true, sourceData: true, changeRequests: { where: { status: "PENDING" }, select: { id: true } } } })
        : senseKey
          ? await tx.catalogImportRow.findFirst({ where: { batchId: batch.id, senseKey }, select: { id: true, catalogKey: true, senseKey: true, sourceFile: true, sourceRow: true, sourceData: true, changeRequests: { where: { status: "PENDING" }, select: { id: true } } } })
          : null;
      if (sourceRowId && !sourceRow) throw new Error("CATALOG_SOURCE_ROW_NOT_FOUND");
      if (!sourceRow && !senseKey) throw new Error("CATALOG_SENSE_REQUIRED");
      const resolvedSenseKey = senseKey || sourceRow?.senseKey || "";
      if (kind === "CREATE" && !resolvedSenseKey) throw new Error("CATALOG_SENSE_REQUIRED");
      if (sourceRow && sourceRow.senseKey !== resolvedSenseKey) throw new Error("CATALOG_IDENTITY_MISMATCH");
      if (sourceRow?.changeRequests.length && !immediateRetire) throw new Error("CATALOG_CHANGE_PENDING");
      const targetSense = resolvedSenseKey
        ? await tx.wordSense.findUnique({ where: { senseKey: resolvedSenseKey }, include: { catalogEntry: { select: { catalogKey: true, normalizedLemma: true } }, revisions: { orderBy: { revision: "desc" }, take: 1 }, approvedRevision: true, changeRequests: { where: { status: "PENDING" }, select: { id: true, kind: true, submissionProposalGroupId: true } } } })
        : null;
      if (targetSense?.changeRequests.length && !immediateRetire) throw new Error("CATALOG_CHANGE_PENDING");
      if (kind === "CREATE" && targetSense) throw new Error("CATALOG_ALREADY_EXISTS");
      if (kind !== "CREATE" && !targetSense) throw new Error("CATALOG_SENSE_NOT_FOUND");
      const latest = targetSense?.revisions[0] ?? null;
      const beforePayload = targetSense && (targetSense.approvedRevision ?? latest)
        ? payloadFromRevision((targetSense.approvedRevision ?? latest)!)
        : null;
      const baseRevision = targetSense?.approvedRevision?.revision ?? latest?.revision ?? null;
      if (targetSense && expectedRevision !== null && baseRevision !== expectedRevision) throw new Error("CATALOG_REVISION_STALE");
      if (kind === "REACTIVATE" && targetSense?.status !== "RETIRED") throw new Error("CATALOG_NOT_RETIRED");
      if (kind === "RETIRE" && targetSense?.status === "RETIRED") throw new Error("CATALOG_ALREADY_RETIRED");
      if (kind === "RETIRE" && (targetSense?.status !== "ACTIVE" || !targetSense.approvedRevisionId)) throw new Error("CATALOG_NOT_ACTIVE");
      if (kind === "UPDATE" && payload && targetSense && !catalogEntryAcceptsLemma(targetSense.catalogEntry.normalizedLemma, payload.lemma)) {
        throw new Error("CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE");
      }

      if (immediateRetire && targetSense) {
        const supersededRetireIds = targetSense.changeRequests
          .filter((request) => request.kind === "RETIRE" && !request.submissionProposalGroupId)
          .map((request) => request.id);
        await cancelSupersededStandaloneRetireRequests(tx, {
          requestIds: supersededRetireIds,
          reviewerId: auth.userId,
          senseId: targetSense.id,
          baseRevision,
        });
      }

      if (kind === "CREATE" && payload) {
        const pendingCreates = await tx.catalogChangeRequest.findMany({ where: { status: "PENDING", kind: "CREATE" }, select: { id: true, senseKey: true, payload: true } });
        const sameSense = (candidate: unknown) => {
          if (!isRecord(candidate)) return false;
          const candidateLemma = typeof candidate.lemma === "string" ? candidate.lemma : typeof candidate.term === "string" ? candidate.term : "";
          const candidateDefinition = typeof candidate.definitionZh === "string" ? candidate.definitionZh : "";
          const candidatePos = typeof candidate.partOfSpeech === "string" ? candidate.partOfSpeech : typeof candidate.pos === "string" ? candidate.pos : "";
          return normalizeCatalogText(candidateLemma) === normalizeCatalogText(payload!.lemma)
            && normalizeCatalogText(candidateDefinition) === normalizeCatalogText(payload!.definitionZh)
            && normalizeCatalogText(candidatePos) === normalizeCatalogText(payload!.partOfSpeech);
        };
        if (pendingCreates.some((candidate) => candidate.senseKey === resolvedSenseKey || sameSense(candidate.payload))) throw new Error("CATALOG_PENDING_SENSE_CONFLICT");
        if (!targetSense) {
          const existingSenses = await tx.wordSense.findMany({ where: { OR: [{ normalizedTerm: normalizeCatalogText(payload.term) }, { catalogEntry: { normalizedLemma: normalizeCatalogText(payload.lemma) } }] }, include: { approvedRevision: true, revisions: { orderBy: { revision: "desc" }, take: 1 } } });
          if (existingSenses.some((candidate) => sameSense(candidate.approvedRevision ?? candidate.revisions[0]))) throw new Error("CATALOG_ALREADY_EXISTS");
        }
      }

      let validationWarnings: string[] = [];
      const matchingEntry = kind === "CREATE" && payload
        ? await tx.catalogEntry.findFirst({
          where: { normalizedLemma: normalizeCatalogText(payload.lemma) },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { catalogKey: true },
        })
        : null;
      const resolvedCatalogKey = sourceRow?.catalogKey ?? targetSense?.catalogEntry.catalogKey ?? matchingEntry?.catalogKey ?? `pending-${resolvedSenseKey}`;
      if (payload) {
        const identity = {
          catalogKey: resolvedCatalogKey,
          senseKey: sourceRow?.senseKey ?? targetSense?.senseKey ?? resolvedSenseKey,
          sourceFile: sourceRow?.sourceFile ?? "governance",
          sourceRow: sourceRow?.sourceRow ?? 0,
        };
        const siblings = await tx.wordSense.findMany({ where: { normalizedTerm: normalizeCatalogText(payload.term), ...(targetSense ? { senseKey: { not: targetSense.senseKey } } : {}) }, include: { catalogEntry: { select: { catalogKey: true } }, revisions: { orderBy: { revision: "desc" }, take: 1 }, approvedRevision: true } });
        const siblingRows = siblings.flatMap((sibling) => {
          const siblingRevision = sibling.approvedRevision ?? sibling.revisions[0];
          if (!siblingRevision) return [];
          const siblingPayload = payloadFromRevision(siblingRevision);
          return [normalizeCatalogRow({
            sourceFile: "sibling",
            sourceRow: 0,
            schema_version: "word-catalog-v1",
            requested_action: "CREATE_DRAFT",
            catalog_key: sibling.catalogEntry.catalogKey,
            sense_key: sibling.senseKey,
            record_revision: String(siblingRevision.revision),
            catalog_status: "DRAFT",
            term: siblingPayload.term,
            lemma: siblingPayload.lemma,
            part_of_speech: siblingPayload.partOfSpeech,
            level: siblingPayload.level,
            category: siblingPayload.category,
            definition_zh: siblingPayload.definitionZh,
            accepted_answers_zh: siblingPayload.acceptedAnswersZh.join("|"),
            prompt_en: "",
            prompt_zh: "",
            phonetic_ipa: siblingPayload.phoneticIpa ?? "",
            example_en: siblingPayload.exampleEn ?? "",
            example_zh: siblingPayload.exampleZh ?? "",
            accepted_forms_en: siblingPayload.acceptedFormsEn.join("|"),
            synonyms_en: siblingPayload.synonymsEn.join("|"),
            antonyms_en: siblingPayload.antonymsEn.join("|"),
            enable_en_to_zh: String(siblingPayload.enableEnToZh).toUpperCase(),
            distractor_zh_1: siblingPayload.distractorZh[0] ?? "",
            distractor_zh_2: siblingPayload.distractorZh[1] ?? "",
            distractor_zh_3: siblingPayload.distractorZh[2] ?? "",
            distractor_zh_4: siblingPayload.distractorZh[3] ?? "",
            distractor_zh_5: siblingPayload.distractorZh[4] ?? "",
            distractor_zh_6: siblingPayload.distractorZh[5] ?? "",
            enable_zh_to_en: String(siblingPayload.enableZhToEn).toUpperCase(),
            distractor_en_1: siblingPayload.distractorEn[0] ?? "",
            distractor_en_2: siblingPayload.distractorEn[1] ?? "",
            distractor_en_3: siblingPayload.distractorEn[2] ?? "",
            distractor_en_4: siblingPayload.distractorEn[3] ?? "",
            distractor_en_5: siblingPayload.distractorEn[4] ?? "",
            distractor_en_6: siblingPayload.distractorEn[5] ?? "",
            source_reference: "",
            contributor_ref: "",
            change_note: "",
            retirement_reason: siblingPayload.retirementReason ?? "",
          }, 0)];
        });
        const validation = validateCatalogGovernancePayload(payload, identity, (latest?.revision ?? 0) + 1, siblingRows);
        if (validation.errors.length) throw new Error(`CATALOG_PAYLOAD_REJECTED:${JSON.stringify(validation.errors)}`);
        validationWarnings = validation.warnings;
      }
      const created = await tx.catalogChangeRequest.create({
        data: {
          operationId,
          requestFingerprint,
          kind: kind as ChangeKind,
          catalogKey: resolvedCatalogKey,
          senseKey: resolvedSenseKey,
          senseId: targetSense?.id ?? null,
          sourceImportRowId: sourceRow?.id ?? null,
          proposerId: auth.userId,
          baseRevision,
          baseStatus: targetSense?.status ?? "DRAFT",
          payload: (payload ?? {}) as unknown as Prisma.InputJsonValue,
          beforePayloadSnapshot: beforePayload ? beforePayload as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
          afterPayloadSnapshot: (payload ?? beforePayload ?? {}) as unknown as Prisma.InputJsonValue,
          reason: reason || null,
          beforeTermSnapshot: targetSense?.approvedRevision?.term ?? latest?.term ?? null,
          afterTermSnapshot: payload?.term ?? targetSense?.approvedRevision?.term ?? latest?.term ?? null,
          beforeNormalizedTermSnapshot: targetSense ? normalizeCatalogText(targetSense.approvedRevision?.term ?? latest?.term ?? targetSense.term) : null,
          afterNormalizedTermSnapshot: payload ? normalizeCatalogText(payload.term) : targetSense ? normalizeCatalogText(targetSense.approvedRevision?.term ?? latest?.term ?? targetSense.term) : null,
          beforeDefinitionSnapshot: targetSense?.approvedRevision?.definitionZh ?? latest?.definitionZh ?? null,
          afterDefinitionSnapshot: payload?.definitionZh ?? targetSense?.approvedRevision?.definitionZh ?? latest?.definitionZh ?? null,
          beforeLevelSnapshot: targetSense?.approvedRevision?.level ?? latest?.level ?? null,
          afterLevelSnapshot: payload?.level ?? targetSense?.approvedRevision?.level ?? latest?.level ?? null,
          beforeCategorySnapshot: targetSense?.approvedRevision?.category ?? latest?.category ?? null,
          afterCategorySnapshot: payload?.category ?? targetSense?.approvedRevision?.category ?? latest?.category ?? null,
          actorPseudonym: catalogActorPseudonym(auth.userId).value,
          actorKeyVersion: catalogActorPseudonym(auth.userId).keyVersion,
        },
        select: { id: true, status: true, kind: true, revision: true, createdAt: true },
      });
      await tx.catalogAuditEvent.create({ data: { requestId: created.id, actorUserId: auth.userId, senseId: targetSense?.id ?? null, action: "SUBMITTED", fromStatus: targetSense?.status ?? null, toStatus: "PENDING", revision: latest?.revision ?? null, metadata: { warnings: validationWarnings } } });
      await tx.catalogHistoryFeedEntry.create({ data: { occurredAt: created.createdAt, sourceKind: "STANDALONE_REQUEST", requestId: created.id } });
      if (immediateRetire) {
        const reviewed = await reviewCatalogChange(tx, {
          requestId: created.id,
          reviewerId: auth.userId,
          expectedRevision: created.revision,
          decision: "APPROVE",
          reviewNote: reason,
          batchMode: false,
          reviewMode: "AUTHORIZED_IMMEDIATE_RETIRE",
        });
        return {
          replay: false,
          requestId: created.id,
          status: reviewed.request.status,
          kind: created.kind,
          createdAt: created.createdAt.toISOString(),
          immediate: true,
        };
      }
      return { replay: false, requestId: created.id, status: created.status, kind: created.kind, createdAt: created.createdAt.toISOString(), immediate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    return NextResponse.json(result, { status: result.replay ? 200 : 201, headers: privateHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isRetryableTransactionConflict(error)) return errorResponse("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return errorResponse("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return errorResponse("CATALOG_IDENTITY_CONFLICT", 409);
    if (message === "IDEMPOTENCY_CONFLICT") return errorResponse("IDEMPOTENCY_CONFLICT", 409);
    if (message === "CATALOG_REVISION_STALE") return errorResponse("CATALOG_REVISION_STALE", 409);
    if (message === "CATALOG_REVIEW_FORBIDDEN") return errorResponse(message, 403);
    if (["CATALOG_CHANGE_PENDING", "CATALOG_ALREADY_EXISTS", "CATALOG_ALREADY_RETIRED", "CATALOG_NOT_RETIRED", "CATALOG_NOT_ACTIVE", "CATALOG_SOURCE_ROW_NOT_FOUND", "CATALOG_PENDING_SENSE_CONFLICT", "CATALOG_IDENTITY_MISMATCH"].includes(message)) return errorResponse(message, 409);
    if (message.startsWith("CATALOG_PAYLOAD_REJECTED:")) {
      let errors: string[] = [];
      try { errors = JSON.parse(message.slice("CATALOG_PAYLOAD_REJECTED:".length)) as string[]; } catch { errors = ["payload rejected"]; }
      return errorResponse("CATALOG_PAYLOAD_REJECTED", 422, { errors });
    }
    if (["CATALOG_NOT_READY", "CATALOG_SENSE_REQUIRED", "CATALOG_SENSE_NOT_FOUND", "CATALOG_REVISION_REQUIRED", "CATALOG_REVISION_INVALID", "CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE"].includes(message)) return errorResponse(message, 422);
    console.error("[catalog] request failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return errorResponse("CATALOG_REQUEST_FAILED", 500);
  }
}
