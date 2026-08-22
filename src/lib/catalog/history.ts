import { Prisma, prisma } from "@/lib/prisma";
import { normalizeCatalogText } from "./csv";
import {
  catalogHistoryFilterFingerprint,
  decodeCatalogBatchChildCursor,
  decodeCatalogHistoryCursor,
  encodeCatalogBatchChildCursor,
  encodeCatalogHistoryCursor,
  normalizeCatalogHistoryFilters,
  type CatalogHistoryFilters,
} from "./history-query";

export type { CatalogHistoryFilters } from "./history-query";

export type CatalogHistoryVisibility = "PUBLIC_APPROVED" | "OWNER" | "REVIEWER";

export async function ensureCatalogHistoryFeed(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const baseline = await tx.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (baseline) {
      await tx.catalogHistoryFeedEntry.upsert({
        where: { initialImportBatchId: baseline.id },
        create: { occurredAt: baseline.createdAt, sourceKind: "INITIAL_BASELINE", initialImportBatchId: baseline.id },
        update: {},
      });
    }
    const requests = await tx.catalogChangeRequest.findMany({
      where: { submissionProposalGroupId: null, historyFeedEntry: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, createdAt: true },
    });
    for (const request of requests) {
      await tx.catalogHistoryFeedEntry.create({ data: { occurredAt: request.createdAt, sourceKind: "STANDALONE_REQUEST", requestId: request.id } });
    }
    const batches = await tx.catalogSubmissionBatch.findMany({
      where: { submittedAt: { not: null }, historyFeedEntry: null },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, submittedAt: true, createdAt: true },
    });
    for (const batch of batches) {
      await tx.catalogHistoryFeedEntry.create({ data: { occurredAt: batch.submittedAt ?? batch.createdAt, sourceKind: "BATCH", submissionBatchId: batch.id } });
    }
  });
}

const requestSelect = {
  id: true,
  submissionProposalGroupId: true,
  kind: true,
  status: true,
  catalogKey: true,
  senseKey: true,
  senseId: true,
  proposerId: true,
  reviewerId: true,
  baseStatus: true,
  baseRevision: true,
  proposedRevision: true,
  resultRevisionId: true,
  payload: true,
  beforePayloadSnapshot: true,
  afterPayloadSnapshot: true,
  reason: true,
  reviewNote: true,
  beforeTermSnapshot: true,
  afterTermSnapshot: true,
  beforeDefinitionSnapshot: true,
  afterDefinitionSnapshot: true,
  beforeLevelSnapshot: true,
  afterLevelSnapshot: true,
  beforeCategorySnapshot: true,
  afterCategorySnapshot: true,
  createdAt: true,
  reviewedAt: true,
  proposer: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
  reviewer: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
} as const;

function actorName(actor: { accountName: string; teacherProfile: { legalName: string } | null } | null): string | null {
  return actor?.teacherProfile?.legalName || actor?.accountName || null;
}

function publicCatalogPayload(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publicFields = { ...value } as Record<string, unknown>;
  delete publicFields.sourceReference;
  delete publicFields.contributorRef;
  delete publicFields.changeNote;
  delete publicFields.retirementReason;
  return publicFields;
}

function payloadForVisibility(value: Prisma.JsonValue | null, visibility: CatalogHistoryVisibility) {
  if (visibility === "REVIEWER") return value;
  return publicCatalogPayload(value);
}

function requestVisibility(request: { proposerId: string; status: string }, actorId: string, canReview: boolean): CatalogHistoryVisibility | null {
  if (canReview) return "REVIEWER";
  if (request.proposerId === actorId) return "OWNER";
  return request.status === "APPROVED" ? "PUBLIC_APPROVED" : null;
}

function requestDto(request: Prisma.CatalogChangeRequestGetPayload<{ select: typeof requestSelect }>, visibility: CatalogHistoryVisibility) {
  const afterStatus = request.status !== "APPROVED"
    ? request.baseStatus
    : request.kind === "RETIRE"
      ? "RETIRED"
      : request.kind === "CREATE" || request.kind === "REACTIVATE"
        ? "ACTIVE"
        : request.baseStatus === "RETIRED" ? "RETIRED" : "ACTIVE";
  const base = {
    id: request.id,
    kind: request.kind,
    status: request.status,
    catalogKey: request.catalogKey,
    senseKey: request.senseKey,
    baseRevision: request.baseRevision,
    proposedRevision: request.proposedRevision,
    resultRevisionId: request.resultRevisionId,
    before: {
      term: request.beforeTermSnapshot,
      definitionZh: request.beforeDefinitionSnapshot,
      level: request.beforeLevelSnapshot,
      category: request.beforeCategorySnapshot,
      status: request.kind === "CREATE" ? null : request.baseStatus,
      payload: payloadForVisibility(request.beforePayloadSnapshot, visibility),
    },
    after: {
      term: request.afterTermSnapshot,
      definitionZh: request.afterDefinitionSnapshot,
      level: request.afterLevelSnapshot,
      category: request.afterCategorySnapshot,
      status: afterStatus,
      payload: payloadForVisibility(request.afterPayloadSnapshot, visibility),
    },
    createdAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
  };
  if (visibility === "PUBLIC_APPROVED") return { ...base, visibility };
  if (visibility === "OWNER") return { ...base, visibility, payload: request.payload, reason: request.reason, reviewNote: request.reviewNote };
  return {
    ...base,
    visibility,
    payload: request.payload,
    reason: request.reason,
    reviewNote: request.reviewNote,
    proposerId: request.proposerId,
    reviewerId: request.reviewerId,
    proposerName: actorName(request.proposer),
    reviewerName: actorName(request.reviewer),
  };
}

const feedInclude = {
  request: { select: requestSelect },
  submissionBatch: {
    include: {
      proposer: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
      reviewer: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
      finalizer: { select: { accountName: true, teacherProfile: { select: { legalName: true } } } },
      _count: { select: { proposalGroups: true } },
    },
  },
  initialImportBatch: { select: { id: true, sourceDigest: true, report: true, createdAt: true } },
} as const;

type FeedEntry = Prisma.CatalogHistoryFeedEntryGetPayload<{ include: typeof feedInclude }>;

function feedDto(entry: FeedEntry, actorId: string, canReview: boolean) {
  if (entry.sourceKind === "STANDALONE_REQUEST" && entry.request) {
    const visibility = requestVisibility(entry.request, actorId, canReview);
    if (!visibility) return null;
    return { feedEntryId: entry.id, sourceKind: entry.sourceKind, occurredAt: entry.occurredAt.toISOString(), request: requestDto(entry.request, visibility) };
  }
  if (entry.sourceKind === "BATCH" && entry.submissionBatch) {
    const batch = entry.submissionBatch;
    const owner = batch.proposerId === actorId;
    const publiclyVisible = batch.status === "COMMITTED";
    if (!canReview && !owner && !publiclyVisible) return null;
    const visibility: CatalogHistoryVisibility = canReview ? "REVIEWER" : owner ? "OWNER" : "PUBLIC_APPROVED";
    return {
      feedEntryId: entry.id,
      sourceKind: entry.sourceKind,
      occurredAt: entry.occurredAt.toISOString(),
      batch: {
        id: batch.id,
        ...(visibility === "PUBLIC_APPROVED" ? {} : { fileName: batch.fileName }),
        status: batch.status,
        rowCount: batch.rowCount,
        summary: batch.summary,
        createdAt: batch.createdAt.toISOString(),
        submittedAt: batch.submittedAt?.toISOString() ?? null,
        reviewedAt: batch.reviewedAt?.toISOString() ?? null,
        committedAt: batch.committedAt?.toISOString() ?? null,
        visibility,
        groupCount: batch._count.proposalGroups,
        ...(visibility === "REVIEWER" ? {
          proposerId: batch.proposerId,
          reviewerId: batch.reviewerId,
          finalizerId: batch.finalizerId,
          proposerName: actorName(batch.proposer),
          reviewerName: actorName(batch.reviewer),
          finalizerName: actorName(batch.finalizer),
        } : {}),
      },
    };
  }
  if (entry.sourceKind === "INITIAL_BASELINE" && entry.initialImportBatch) {
    return {
      feedEntryId: entry.id,
      sourceKind: entry.sourceKind,
      occurredAt: entry.occurredAt.toISOString(),
      baseline: {
        id: entry.initialImportBatch.id,
        report: canReview ? entry.initialImportBatch.report : {
          rows: typeof (entry.initialImportBatch.report as Record<string, unknown> | null)?.rows === "number" ? (entry.initialImportBatch.report as Record<string, unknown>).rows : undefined,
          status: "READY",
        },
        createdAt: entry.initialImportBatch.createdAt.toISOString(),
        ...(canReview ? { sourceDigest: entry.initialImportBatch.sourceDigest } : {}),
      },
    };
  }
  return null;
}

export async function listCatalogHistory(input: {
  actorId: string;
  canReview: boolean;
  cursor?: string | null;
  limit?: number;
  filters?: CatalogHistoryFilters;
}) {
  const filters = normalizeCatalogHistoryFilters(input.filters);
  const cursor = decodeCatalogHistoryCursor(input.cursor);
  if (input.cursor && !cursor) throw new Error("CATALOG_HISTORY_CURSOR_INVALID");
  const scope = input.canReview ? "REVIEWER" : `TEACHER:${input.actorId}`;
  const fingerprint = catalogHistoryFilterFingerprint(filters);
  if (cursor && (cursor.scope !== scope || cursor.fingerprint !== fingerprint)) throw new Error("CATALOG_HISTORY_CURSOR_INVALID");
  if (filters.actor && !input.canReview) throw new Error("CATALOG_HISTORY_FILTER_FORBIDDEN");
  const cutoff = cursor?.cutoff ?? new Date().toISOString();
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new Error("CATALOG_HISTORY_FILTER_INVALID");
  const limit = Math.min(input.limit ?? 25, 50);
  const search = normalizeCatalogText(filters.search ?? "");
  const status = filters.status;
  const kind = filters.kind;
  const level = filters.level;
  const category = filters.category;
  const sourceKind = filters.sourceKind;
  const catalogKey = filters.catalogKey;
  const senseKey = filters.senseKey;
  const batchId = filters.batchId;
  const actorSearch = filters.actor;
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
  const requestFilter: Prisma.CatalogChangeRequestWhereInput = {
    ...(status && ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status) ? { status: status as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } : {}),
    ...(kind && ["CREATE", "UPDATE", "RETIRE", "REACTIVATE"].includes(kind) ? { kind: kind as "CREATE" | "UPDATE" | "RETIRE" | "REACTIVATE" } : {}),
    ...(level && ["A1", "A2", "B1", "B2"].includes(level) ? { OR: [{ beforeLevelSnapshot: level as "A1" | "A2" | "B1" | "B2" }, { afterLevelSnapshot: level as "A1" | "A2" | "B1" | "B2" }] } : {}),
    ...(category ? { OR: [{ beforeCategorySnapshot: category }, { afterCategorySnapshot: category }] } : {}),
    ...(catalogKey ? { catalogKey } : {}),
    ...(senseKey ? { senseKey } : {}),
    ...(actorSearch && input.canReview ? { OR: [
      { proposer: { is: { OR: [{ accountName: { contains: actorSearch, mode: "insensitive" } }, { teacherProfile: { is: { legalName: { contains: actorSearch, mode: "insensitive" } } } }] } } },
      { reviewer: { is: { OR: [{ accountName: { contains: actorSearch, mode: "insensitive" } }, { teacherProfile: { is: { legalName: { contains: actorSearch, mode: "insensitive" } } } }] } } },
    ] } : {}),
    ...(search ? { OR: [{ beforeNormalizedTermSnapshot: { contains: search } }, { afterNormalizedTermSnapshot: { contains: search } }, { beforeDefinitionSnapshot: { contains: filters.search ?? "", mode: "insensitive" } }, { afterDefinitionSnapshot: { contains: filters.search ?? "", mode: "insensitive" } }] } : {}),
  };
  const filterActive = Boolean(search || status || kind || level || category || catalogKey || senseKey || batchId || actorSearch);
  const lowerSourceKinds = cursor
    ? cursor.sourceKind === "INITIAL_BASELINE"
      ? ["BATCH", "STANDALONE_REQUEST"] as const
      : cursor.sourceKind === "BATCH"
        ? ["STANDALONE_REQUEST"] as const
        : []
    : [];
  const cursorCondition: Prisma.CatalogHistoryFeedEntryWhereInput | null = cursor ? {
    OR: [
      { occurredAt: { lt: new Date(cursor.occurredAt) } },
      ...(lowerSourceKinds.length ? [{ occurredAt: new Date(cursor.occurredAt), sourceKind: { in: [...lowerSourceKinds] } }] : []),
      { occurredAt: new Date(cursor.occurredAt), sourceKind: cursor.sourceKind as "STANDALONE_REQUEST" | "BATCH" | "INITIAL_BASELINE", id: { lt: cursor.id } },
    ],
  } : null;
  const standaloneMatch: Prisma.CatalogHistoryFeedEntryWhereInput = {
    request: { is: input.canReview ? requestFilter : { AND: [requestFilter, { OR: [{ proposerId: input.actorId }, { status: "APPROVED" }] }] } },
  };
  const batchMatch: Prisma.CatalogHistoryFeedEntryWhereInput = {
    submissionBatch: { is: input.canReview
      ? { ...(batchId ? { id: batchId } : {}), proposalGroups: { some: { changeRequest: { is: requestFilter } } } }
      : { OR: [
        { proposerId: input.actorId, ...(batchId ? { id: batchId } : {}), proposalGroups: { some: { changeRequest: { is: requestFilter } } } },
        { proposerId: { not: input.actorId }, status: "COMMITTED", ...(batchId ? { id: batchId } : {}), proposalGroups: { some: { changeRequest: { is: { AND: [requestFilter, { status: "APPROVED" }] } } } } },
      ] },
    },
  };
  const filterCondition: Prisma.CatalogHistoryFeedEntryWhereInput | null = filterActive ? { OR: [standaloneMatch, batchMatch] } : null;
  const where: Prisma.CatalogHistoryFeedEntryWhereInput = {
    occurredAt: { lte: dateTo && dateTo < new Date(cutoff) ? dateTo : new Date(cutoff), ...(dateFrom ? { gte: dateFrom } : {}) },
    ...(sourceKind && ["STANDALONE_REQUEST", "BATCH", "INITIAL_BASELINE"].includes(sourceKind) ? { sourceKind: sourceKind as "STANDALONE_REQUEST" | "BATCH" | "INITIAL_BASELINE" } : {}),
    AND: [
      cursorCondition,
      filterCondition,
      input.canReview ? null : {
        OR: [
          { sourceKind: "INITIAL_BASELINE" },
          { request: { is: { OR: [{ proposerId: input.actorId }, { status: "APPROVED" }] } } },
          { submissionBatch: { is: { OR: [{ proposerId: input.actorId }, { status: "COMMITTED" }] } } },
        ],
      },
    ].filter((item): item is Prisma.CatalogHistoryFeedEntryWhereInput => item !== null),
  };
  const entries = await prisma.catalogHistoryFeedEntry.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { sourceKind: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: feedInclude,
  });
  const visible = entries.flatMap((entry) => {
    const dto = feedDto(entry, input.actorId, input.canReview);
    return dto ? [{ entry, dto }] : [];
  });
  const hasMore = visible.length > limit;
  const page = visible.slice(0, limit);
  const last = page.at(-1)?.entry;
  return {
    items: page.map((item) => item.dto),
    snapshotCutoff: cutoff,
    nextCursor: hasMore && last ? encodeCatalogHistoryCursor({ occurredAt: last.occurredAt.toISOString(), sourceKind: last.sourceKind, id: last.id, cutoff, scope, fingerprint }) : null,
  };
}

export async function getCatalogHistoryEntry(input: { feedEntryIdOrRequestId: string; actorId: string; canReview: boolean }) {
  const entry = await prisma.catalogHistoryFeedEntry.findFirst({
    where: { OR: [{ id: input.feedEntryIdOrRequestId }, { requestId: input.feedEntryIdOrRequestId }] },
    include: feedInclude,
  });
  if (entry) {
    const dto = feedDto(entry, input.actorId, input.canReview);
    if (!dto) throw new Error("CATALOG_HISTORY_NOT_FOUND");
    return dto;
  }
  const request = await prisma.catalogChangeRequest.findUnique({ where: { id: input.feedEntryIdOrRequestId }, select: requestSelect });
  if (!request) throw new Error("CATALOG_HISTORY_NOT_FOUND");
  const visibility = requestVisibility(request, input.actorId, input.canReview);
  if (!visibility) throw new Error("CATALOG_HISTORY_NOT_FOUND");
  return {
    feedEntryId: request.id,
    sourceKind: request.submissionProposalGroupId ? "BATCH" : "STANDALONE_REQUEST",
    occurredAt: request.createdAt.toISOString(),
    request: requestDto(request, visibility),
  };
}

export async function getCatalogHistoryBatchChildren(input: {
  batchId: string;
  actorId: string;
  canReview: boolean;
  cursor?: string | null;
  limit?: number;
}) {
  const batch = await prisma.catalogSubmissionBatch.findUnique({ where: { id: input.batchId }, select: { proposerId: true, status: true } });
  if (!batch) throw new Error("CATALOG_HISTORY_NOT_FOUND");
  const visibility: CatalogHistoryVisibility | null = input.canReview ? "REVIEWER" : batch.proposerId === input.actorId ? "OWNER" : batch.status === "COMMITTED" ? "PUBLIC_APPROVED" : null;
  if (!visibility) throw new Error("CATALOG_HISTORY_NOT_FOUND");
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new Error("CATALOG_HISTORY_FILTER_INVALID");
  const limit = Math.min(input.limit ?? 50, 100);
  const cursorId = decodeCatalogBatchChildCursor(input.cursor, input.batchId);
  if (input.cursor && !cursorId) throw new Error("CATALOG_HISTORY_CURSOR_INVALID");
  const rows = await prisma.catalogSubmissionProposalGroup.findMany({
    where: {
      batchId: input.batchId,
      changeRequest: { is: visibility === "PUBLIC_APPROVED" ? { status: "APPROVED" } : {} },
    },
    orderBy: [{ groupNumber: "asc" }, { id: "asc" }],
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      groupNumber: true,
      decision: true,
      reviewRisk: true,
      changeRequest: { select: requestSelect },
    },
  });
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).flatMap((group) => group.changeRequest ? [{
      groupNumber: group.groupNumber,
      decision: group.decision,
      reviewRisk: group.reviewRisk,
      request: requestDto(group.changeRequest, visibility),
    }] : []),
    nextCursor: hasMore ? encodeCatalogBatchChildCursor(input.batchId, rows[limit - 1]!.id) : null,
  };
}

export async function getCatalogSenseHistory(input: { senseKey: string; actorId: string; canReview: boolean }) {
  const sense = await prisma.wordSense.findUnique({ where: { senseKey: input.senseKey }, select: { id: true } });
  const requests = await prisma.catalogChangeRequest.findMany({
    where: { OR: [{ senseKey: input.senseKey }, ...(sense ? [{ senseId: sense.id }] : [])] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: requestSelect,
  });
  return requests.flatMap((request) => {
    const visibility = requestVisibility(request, input.actorId, input.canReview);
    return visibility ? [requestDto(request, visibility)] : [];
  });
}
