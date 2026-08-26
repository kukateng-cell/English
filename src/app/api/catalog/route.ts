import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { catalogAccess, requireCatalogReviewerInTransaction } from "@/lib/catalog/access";
import { catalogBulkSubmissionEnabled, catalogHistoryEnabled } from "@/lib/catalog/features";
import {
  catalogEntryAcceptsLemma,
  catalogGovernancePayloadFromUnknown,
  parseCatalogGovernancePayload,
  payloadFingerprint,
  payloadFromRevision,
  validateCatalogGovernancePayload,
  type CatalogGovernancePayload,
} from "@/lib/catalog/governance";
import { normalizeCatalogText } from "@/lib/catalog/csv";
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
import {
  catalogWorkspaceQueryFingerprint,
  decodeCatalogWorkspaceCursor,
  encodeCatalogWorkspaceCursor,
  parseCatalogWorkspaceQuery,
} from "@/lib/catalog/workspace-query";
import { readCatalogWorkspacePage } from "@/lib/catalog/workspace-read";
import {
  applyCatalogRetryPayloadPatch,
  parseCatalogRetryConflictChoices,
  parseCatalogRetryPayloadPatch,
  threeWayMergeCatalogPayload,
} from "@/lib/catalog/retry-merge";
import { loadCatalogSiblingValidationRows } from "@/lib/catalog/sibling-validation";
import { CATALOG_STRUCTURED_ISSUE_VERSION } from "@/lib/catalog/validation-issue-contract";

const MAX_REQUEST_BYTES = 128 * 1024;
const CHANGE_KINDS = ["UPDATE", "CREATE", "RETIRE", "REACTIVATE"] as const;
type ChangeKind = (typeof CHANGE_KINDS)[number];

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

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return errorResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 401 ? "AUTH_REQUIRED" : "ROLE_FORBIDDEN", auth.status);

  let query: ReturnType<typeof parseCatalogWorkspaceQuery>;
  try {
    query = parseCatalogWorkspaceQuery(new URL(req.url).searchParams);
  } catch (error) {
    const code = error instanceof Error && error.message === "CATALOG_CURSOR_INVALID"
      ? "CATALOG_CURSOR_INVALID"
      : "CATALOG_QUERY_INVALID";
    return errorResponse(code, 422);
  }

  try {
    const access = await catalogAccess(auth);
    const initialVersion = await readCatalogWorkspaceVersion();
    const batch = await prisma.catalogImportBatch.findFirst({
      where: { status: "READY" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, sourceDigest: true, status: true, createdAt: true },
    });
    if (!batch) {
      if (query.cursor) return errorResponse("CATALOG_CURSOR_STALE", 409);
      const version = await readCatalogWorkspaceVersion();
      if (version.signature !== initialVersion.signature) return errorResponse("CATALOG_READ_STALE", 409);
      return NextResponse.json({
        rows: [],
        structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
        counts: { all: 0, ACTIVE: 0, DRAFT: 0, RETIRED: 0, blocked: 0, validationFailed: 0, pending: 0 },
        facets: { partOfSpeech: [], category: [] },
        filteredTotal: 0,
        nextCursor: null,
        mutationRevision: version.mutationRevision,
        workspaceSignature: version.signature,
        canReview: access.canReview,
        actorUserId: auth.userId,
        bulkEnabled: catalogBulkSubmissionEnabled(),
        historyEnabled: catalogHistoryEnabled(),
        batch: null,
      }, { headers: privateHeaders() });
    }

    const scope = access.canReview
      ? `catalog-reviewer:${auth.userId}`
      : `catalog-teacher:${auth.userId}`;
    const fingerprint = catalogWorkspaceQueryFingerprint(query.filters, query.limit, scope);
    const cursor = query.cursor ? decodeCatalogWorkspaceCursor(query.cursor) : null;
    if (query.cursor && !cursor) return errorResponse("CATALOG_CURSOR_INVALID", 422);
    if (cursor && ((query.filters.mode === "LEGACY_V1" && cursor.v !== 1) || (query.filters.mode === "WORKSPACE_V2" && cursor.v !== 2))) {
      return errorResponse("CATALOG_CURSOR_CONTEXT_MISMATCH", 409, { recoverable: true });
    }
    if (cursor && (cursor.fingerprint !== fingerprint || cursor.batchId !== batch.id)) {
      return errorResponse("CATALOG_CURSOR_CONTEXT_MISMATCH", 409, { recoverable: true });
    }
    if (cursor?.v === 2 && cursor.sort !== query.filters.sort) return errorResponse("CATALOG_CURSOR_CONTEXT_MISMATCH", 409, { recoverable: true });
    if (cursor && cursor.workspaceSignature !== initialVersion.signature) {
      return errorResponse("CATALOG_CURSOR_STALE", 409);
    }

    const offset = cursor?.offset ?? 0;
    const page = await readCatalogWorkspacePage({
      batchId: batch.id,
      filters: query.filters,
      limit: query.limit,
      offset,
      canReview: access.canReview,
      actorUserId: auth.userId,
    });
    const version = await readCatalogWorkspaceVersion();
    if (version.signature !== initialVersion.signature) return errorResponse("CATALOG_READ_STALE", 409);
    const nextOffset = offset + page.rows.length;
    const snapshotCutoff = cursor?.v === 2 ? cursor.snapshotCutoff : new Date().toISOString();
    const nextCursor = nextOffset < page.filteredTotal
      ? query.filters.mode === "LEGACY_V1"
        ? encodeCatalogWorkspaceCursor({
            offset: nextOffset,
            fingerprint,
            workspaceSignature: version.signature,
            batchId: batch.id,
          })
        : encodeCatalogWorkspaceCursor({
            offset: nextOffset,
            fingerprint,
            workspaceSignature: version.signature,
            batchId: batch.id,
            sort: query.filters.sort,
            snapshotCutoff,
          })
      : null;

    return NextResponse.json({
      rows: page.rows,
      structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      counts: page.counts,
      facets: page.facets,
      filteredTotal: page.filteredTotal,
      nextCursor,
      mutationRevision: version.mutationRevision,
      workspaceSignature: version.signature,
      canReview: access.canReview,
      actorUserId: auth.userId,
      bulkEnabled: catalogBulkSubmissionEnabled(),
      historyEnabled: catalogHistoryEnabled(),
      batch: {
        id: batch.id,
        sourceDigest: batch.sourceDigest,
        status: batch.status,
        createdAt: batch.createdAt.toISOString(),
      },
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
  const supersedesRequestId = typeof body.supersedesRequestId === "string" ? body.supersedesRequestId.trim() : "";
  if (body.supersedesRequestId !== undefined && typeof body.supersedesRequestId !== "string") return errorResponse("CATALOG_INPUT_INVALID", 422);
  if (body.immediate !== undefined && typeof body.immediate !== "boolean") return errorResponse("CATALOG_INPUT_INVALID", 422);
  const immediateRetire = body.immediate === true;
  if (!operationId || operationId.length > 120 || !CHANGE_KINDS.includes(kind as ChangeKind)) return errorResponse("CATALOG_INPUT_INVALID", 422);
  if (immediateRetire && kind !== "RETIRE") return errorResponse("CATALOG_INPUT_INVALID", 422);
  if ((kind === "RETIRE" || kind === "REACTIVATE") && body.payload !== undefined) {
    return errorResponse("CATALOG_STATUS_PAYLOAD_NOT_ALLOWED", 422);
  }
  if ((kind === "RETIRE" || kind === "REACTIVATE") && !senseKey) return errorResponse("CATALOG_SENSE_REQUIRED", 422);
  if ((kind === "RETIRE" || kind === "REACTIVATE") && reason.length < 3) return errorResponse("CATALOG_REASON_REQUIRED", 422);
  if (reason.length > 2000) return errorResponse("CATALOG_REASON_INVALID", 422);
  let expectedRevision: number | null;
  try {
    expectedRevision = parseCatalogExpectedRevision(body.expectedRevision, kind as ChangeKind);
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
  let retryConflictChoices: ReturnType<typeof parseCatalogRetryConflictChoices> = {};
  let retryPayloadPatch: ReturnType<typeof parseCatalogRetryPayloadPatch> = {};
  try {
    retryConflictChoices = parseCatalogRetryConflictChoices(body.retryConflictChoices);
    retryPayloadPatch = parseCatalogRetryPayloadPatch(body.retryPayloadPatch);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "CATALOG_REQUEST_RETRY_PATCH_INVALID", 422);
  }
  if (!supersedesRequestId && (Object.keys(retryConflictChoices).length || Object.keys(retryPayloadPatch).length)) {
    return errorResponse("CATALOG_REQUEST_RETRY_MISMATCH", 422);
  }
  if (
    supersedesRequestId
    && kind !== "UPDATE"
    && (Object.keys(retryConflictChoices).length || Object.keys(retryPayloadPatch).length)
  ) {
    return errorResponse("CATALOG_REQUEST_RETRY_PATCH_INVALID", 422);
  }
  const requestFingerprint = payloadFingerprint({
    operationId,
    kind,
    senseKey,
    sourceRowId,
    expectedRevision,
    payload,
    reason,
    supersedesRequestId,
    retryConflictChoices,
    retryPayloadPatch,
    ...(immediateRetire ? { immediateRetire: true } : {}),
  });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.catalogChangeRequest.findUnique({ where: { proposerId_operationId: { proposerId: auth.userId, operationId } }, select: { id: true, requestFingerprint: true, status: true } });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
        return { replay: true, requestId: existing.id, status: existing.status, immediate: immediateRetire };
      }
      const retrySource = supersedesRequestId
        ? await tx.catalogChangeRequest.findUnique({
            where: { id: supersedesRequestId },
            select: {
              id: true,
              proposerId: true,
              kind: true,
              status: true,
              senseKey: true,
              sourceImportRowId: true,
              baseRevision: true,
              payload: true,
              beforePayloadSnapshot: true,
              afterPayloadSnapshot: true,
              submissionProposalGroupId: true,
              supersededBy: { select: { id: true, status: true } },
            },
          })
        : null;
      if (supersedesRequestId) {
        if (!retrySource) throw new Error("CATALOG_REQUEST_NOT_FOUND");
        if (retrySource.proposerId !== auth.userId || retrySource.submissionProposalGroupId) throw new Error("CATALOG_REQUEST_RETRY_FORBIDDEN");
        if (retrySource.status !== "REJECTED") throw new Error("CATALOG_REQUEST_NOT_RETRYABLE");
        if (retrySource.supersededBy) {
          return {
            replay: true,
            requestId: retrySource.supersededBy.id,
            status: retrySource.supersededBy.status,
            immediate: false,
          };
        }
        if (retrySource.kind !== kind || (retrySource.senseKey ?? "") !== senseKey) {
          throw new Error("CATALOG_REQUEST_RETRY_MISMATCH");
        }
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
      if (retrySource && kind === "UPDATE") {
        const retryBase = catalogGovernancePayloadFromUnknown(retrySource.beforePayloadSnapshot);
        const retryProposal = catalogGovernancePayloadFromUnknown(retrySource.afterPayloadSnapshot ?? retrySource.payload);
        if (!retryBase || !retryProposal || !beforePayload || retrySource.baseRevision === null) {
          throw new Error("CATALOG_REQUEST_RETRY_STALE");
        }
        const merge = threeWayMergeCatalogPayload({
          base: retryBase,
          proposal: retryProposal,
          current: beforePayload,
          choices: retryConflictChoices,
        });
        const conflictFields = new Set<string>(merge.conflicts.map((conflict) => conflict.field));
        if (Object.keys(retryConflictChoices).some((field) => !conflictFields.has(field))) {
          throw new Error("CATALOG_REQUEST_RETRY_RESOLUTION_INVALID");
        }
        if (merge.unresolvedFields.length) {
          throw new Error(`CATALOG_REQUEST_RETRY_CONFLICT:${JSON.stringify(merge.unresolvedFields)}`);
        }
        let mergedPayload: CatalogGovernancePayload;
        try {
          mergedPayload = parseCatalogGovernancePayload(applyCatalogRetryPayloadPatch(merge.payload, retryPayloadPatch));
        } catch {
          throw new Error("CATALOG_REQUEST_RETRY_PATCH_INVALID");
        }
        if (!payload || payloadFingerprint(payload) !== payloadFingerprint(mergedPayload)) {
          throw new Error("CATALOG_REQUEST_RETRY_MISMATCH");
        }
        payload = mergedPayload;
      }
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
        const siblingRows = await loadCatalogSiblingValidationRows(tx, payload, targetSense?.senseKey);
        const validation = validateCatalogGovernancePayload(payload, identity, (latest?.revision ?? 0) + 1, siblingRows);
        if (validation.errors.length) throw new Error(`CATALOG_PAYLOAD_REJECTED:${JSON.stringify({
          errors: validation.errors,
          warnings: validation.warnings,
          issues: validation.issues,
        })}`);
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
          supersedesRequestId: retrySource?.id ?? null,
          proposerId: auth.userId,
          baseRevision,
          baseStatus: targetSense?.status ?? "DRAFT",
          payload: (payload ?? beforePayload ?? {}) as unknown as Prisma.InputJsonValue,
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
    if (
      isRetryableTransactionConflict(error)
      || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      const existing = await prisma.catalogChangeRequest.findUnique({
        where: { proposerId_operationId: { proposerId: auth.userId, operationId } },
        select: { id: true, requestFingerprint: true, status: true },
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) return errorResponse("IDEMPOTENCY_CONFLICT", 409);
        return NextResponse.json({
          replay: true,
          requestId: existing.id,
          status: existing.status,
          immediate: immediateRetire,
        }, { headers: privateHeaders() });
      }
      if (isRetryableTransactionConflict(error)) return errorResponse("CATALOG_REQUEST_STALE", 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return errorResponse("CATALOG_REQUEST_STALE", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(supersedesRequestId ? "CATALOG_REQUEST_ALREADY_SUPERSEDED" : "CATALOG_IDENTITY_CONFLICT", 409);
    }
    if (message === "IDEMPOTENCY_CONFLICT") return errorResponse("IDEMPOTENCY_CONFLICT", 409);
    if (message === "CATALOG_REVISION_STALE" || message === "CATALOG_REQUEST_RETRY_STALE") return errorResponse(message, 409);
    if (message.startsWith("CATALOG_REQUEST_RETRY_CONFLICT:")) {
      let fields: string[] = [];
      try { fields = JSON.parse(message.slice("CATALOG_REQUEST_RETRY_CONFLICT:".length)) as string[]; } catch { fields = []; }
      return errorResponse("CATALOG_REQUEST_RETRY_CONFLICT", 409, { fields });
    }
    if (message === "CATALOG_REVIEW_FORBIDDEN") return errorResponse(message, 403);
    if (["CATALOG_CHANGE_PENDING", "CATALOG_ALREADY_EXISTS", "CATALOG_ALREADY_RETIRED", "CATALOG_NOT_RETIRED", "CATALOG_NOT_ACTIVE", "CATALOG_SOURCE_ROW_NOT_FOUND", "CATALOG_PENDING_SENSE_CONFLICT", "CATALOG_IDENTITY_MISMATCH", "CATALOG_REQUEST_NOT_RETRYABLE", "CATALOG_REQUEST_ALREADY_SUPERSEDED", "CATALOG_REQUEST_RETRY_MISMATCH"].includes(message)) return errorResponse(message, 409);
    if (message === "CATALOG_REQUEST_RETRY_FORBIDDEN") return errorResponse(message, 403);
    if (message === "CATALOG_REQUEST_NOT_FOUND") return errorResponse(message, 404);
    if (message.startsWith("CATALOG_PAYLOAD_REJECTED:")) {
      let errors: string[] = [];
      let warnings: string[] = [];
      let issues: Array<{
        code: string;
        field: string | null;
        direction: "EN_TO_ZH" | "ZH_TO_EN" | null;
        severity: "ERROR" | "WARNING";
      }> = [];
      try {
        const parsed = JSON.parse(
          message.slice("CATALOG_PAYLOAD_REJECTED:".length),
        ) as unknown;
        if (Array.isArray(parsed)) errors = parsed as string[];
        else if (parsed && typeof parsed === "object") {
          const payload = parsed as {
            errors?: unknown;
            warnings?: unknown;
            issues?: unknown;
          };
          if (Array.isArray(payload.errors)) errors = payload.errors as string[];
          if (Array.isArray(payload.warnings))
            warnings = payload.warnings as string[];
          if (Array.isArray(payload.issues))
            issues = payload.issues as typeof issues;
        }
      } catch {
        errors = ["payload rejected"];
      }
      return errorResponse("CATALOG_PAYLOAD_REJECTED", 422, {
        errors,
        warnings,
        issues,
        structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      });
    }
    if (["CATALOG_NOT_READY", "CATALOG_SENSE_REQUIRED", "CATALOG_SENSE_NOT_FOUND", "CATALOG_REVISION_REQUIRED", "CATALOG_REVISION_INVALID", "CATALOG_LEMMA_CHANGE_REQUIRES_NEW_SENSE", "CATALOG_REQUEST_RETRY_RESOLUTION_INVALID", "CATALOG_REQUEST_RETRY_PATCH_INVALID", "CATALOG_STATUS_PAYLOAD_NOT_ALLOWED"].includes(message)) return errorResponse(message, 422);
    console.error("[catalog] request failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return errorResponse("CATALOG_REQUEST_FAILED", 500);
  }
}
