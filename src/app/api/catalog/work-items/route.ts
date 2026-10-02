import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import {
  CATALOG_PRIVATE_HEADERS,
  catalogRouteError,
  requireCatalogActor,
} from "@/lib/catalog/api";
import {
  actionableCatalogWorkCount,
  catalogBatchNeedsRevisionWhere,
  catalogBatchReviewWhere,
  evaluateStandaloneRetryEligibility,
  mergeCatalogWorkItems,
  standaloneRequestRetryCandidateWhere,
} from "@/lib/catalog/work-items";
import { catalogBulkSubmissionEnabled } from "@/lib/catalog/features";

const DEFAULT_ITEM_LIMIT = 12;
const MAX_ITEM_LIMIT = 500;

export async function GET(req: Request) {
  const auth = await requireCatalogActor(req);
  if (!auth.ok) return auth.response;
  try {
    const actorId = auth.actor.userId;
    const params = new URL(req.url).searchParams;
    const summaryOnly = params.get("summary") === "1";
    const requestedLimit = Number(params.get("limit") ?? DEFAULT_ITEM_LIMIT);
    const itemLimit = Number.isSafeInteger(requestedLimit)
      ? Math.min(MAX_ITEM_LIMIT, Math.max(DEFAULT_ITEM_LIMIT, requestedLimit))
      : DEFAULT_ITEM_LIMIT;
    const bulkEnabled = catalogBulkSubmissionEnabled();
    const requestNeedsRevisionWhere = standaloneRequestRetryCandidateWhere(actorId);
    const batchNeedsRevisionWhere = catalogBatchNeedsRevisionWhere(actorId);
    const requestReviewWhere = {
      status: "PENDING" as const,
      submissionProposalGroupId: null,
      proposerId: { not: actorId },
    };
    const batchReviewWhere = catalogBatchReviewWhere(actorId);
    const feedbackReviewWhere = { status: "OPEN" as const, reporterId: { not: actorId } };

    const [revisionRequestCandidates, batchesToRevise, requestsToReview, batchesToReview, feedbackToReview] = await Promise.all([
      prisma.catalogChangeRequest.findMany({
        where: requestNeedsRevisionWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, kind: true, senseKey: true, afterTermSnapshot: true, reviewNote: true, updatedAt: true },
      }),
      bulkEnabled ? prisma.catalogSubmissionBatch.count({ where: batchNeedsRevisionWhere }) : Promise.resolve(0),
      auth.canReview ? prisma.catalogChangeRequest.count({ where: requestReviewWhere }) : Promise.resolve(0),
      auth.canReview && bulkEnabled ? prisma.catalogSubmissionBatch.count({ where: batchReviewWhere }) : Promise.resolve(0),
      auth.canReview ? prisma.catalogFeedback.count({ where: feedbackReviewWhere }) : Promise.resolve(0),
    ]);
    const retrySenseKeys = [...new Set(revisionRequestCandidates.flatMap((request) => request.senseKey ? [request.senseKey] : []))];
    const [retrySenses, pendingRetryRequests] = retrySenseKeys.length
      ? await Promise.all([
          prisma.wordSense.findMany({
            where: { senseKey: { in: retrySenseKeys } },
            select: { senseKey: true, status: true, approvedRevisionId: true },
          }),
          prisma.catalogChangeRequest.findMany({
            where: { status: "PENDING", senseKey: { in: retrySenseKeys } },
            select: { senseKey: true },
          }),
        ])
      : [[], []];
    const retrySenseByKey = new Map(retrySenses.map((sense) => [sense.senseKey, sense]));
    const pendingRetrySenseKeys = new Set(pendingRetryRequests.flatMap((request) => request.senseKey ? [request.senseKey] : []));
    const revisionRequests = revisionRequestCandidates.filter((request) => evaluateStandaloneRetryEligibility({
      kind: request.kind,
      senseKey: request.senseKey,
      currentIdentity: request.senseKey ? retrySenseByKey.get(request.senseKey) ?? null : null,
      hasPendingChange: request.senseKey ? pendingRetrySenseKeys.has(request.senseKey) : false,
    }).eligible);
    const requestsToRevise = revisionRequests.length;
    const counts = {
      requestsToRevise,
      batchesToRevise,
      requestsToReview,
      batchesToReview,
      feedbackToReview,
      totalActionable: actionableCatalogWorkCount({ requestsToRevise, batchesToRevise, requestsToReview, batchesToReview, feedbackToReview }),
    };
    if (summaryOnly) return NextResponse.json({ counts, bulkEnabled }, { headers: CATALOG_PRIVATE_HEADERS });

    const recentSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const waitingRequestWhere = { proposerId: actorId, status: "PENDING" as const, submissionProposalGroupId: null };
    const waitingBatchWhere: Prisma.CatalogSubmissionBatchWhereInput = {
      proposerId: actorId,
      OR: [
        { status: { in: ["SUBMITTED", "REVIEWING", "REVIEWED", "FINALIZING"] } },
        { status: "NEEDS_RESOLUTION", resolutionOwnerId: { not: null }, NOT: { resolutionOwnerId: actorId } },
      ],
    };
    const waitingFeedbackWhere = { reporterId: actorId, status: "OPEN" as const };
    const recentRequestWhere: Prisma.CatalogChangeRequestWhereInput = { proposerId: actorId, submissionProposalGroupId: null, status: { in: ["APPROVED", "REJECTED", "CANCELLED"] }, updatedAt: { gte: recentSince } };
    const recentBatchWhere: Prisma.CatalogSubmissionBatchWhereInput = { proposerId: actorId, status: { in: ["COMMITTED", "REJECTED", "STALE", "EXPIRED", "CANCELLED", "SUPERSEDED"] }, updatedAt: { gte: recentSince } };
    const recentFeedbackWhere: Prisma.CatalogFeedbackWhereInput = { reporterId: actorId, status: { in: ["RESOLVED", "DISMISSED"] }, updatedAt: { gte: recentSince } };
    const [revisionBatches, reviewRequests, reviewBatches, reviewFeedback, waitingRequests, waitingBatches, waitingFeedback, recentRequests, recentBatches, recentFeedback] = await Promise.all([
      bulkEnabled ? prisma.catalogSubmissionBatch.findMany({
        where: batchNeedsRevisionWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, fileName: true, status: true, rowCount: true, revision: true, updatedAt: true },
      }) : Promise.resolve([]),
      auth.canReview ? prisma.catalogChangeRequest.findMany({
        where: requestReviewWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: itemLimit,
        select: { id: true, kind: true, senseKey: true, afterTermSnapshot: true, proposerId: true, createdAt: true },
      }) : Promise.resolve([]),
      auth.canReview && bulkEnabled ? prisma.catalogSubmissionBatch.findMany({
        where: batchReviewWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: itemLimit,
        select: { id: true, fileName: true, status: true, rowCount: true, reviewerId: true, createdAt: true },
      }) : Promise.resolve([]),
      auth.canReview ? prisma.catalogFeedback.findMany({
        where: feedbackReviewWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: itemLimit,
        select: { id: true, kind: true, senseKey: true, termSnapshot: true, message: true, suggestedValue: true, revision: true, reporterId: true, createdAt: true },
      }) : Promise.resolve([]),
      prisma.catalogChangeRequest.findMany({
        where: waitingRequestWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, kind: true, senseKey: true, afterTermSnapshot: true, createdAt: true },
      }),
      bulkEnabled ? prisma.catalogSubmissionBatch.findMany({
        where: waitingBatchWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, fileName: true, status: true, rowCount: true, createdAt: true },
      }) : Promise.resolve([]),
      prisma.catalogFeedback.findMany({
        where: waitingFeedbackWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, kind: true, senseKey: true, termSnapshot: true, message: true, suggestedValue: true, createdAt: true },
      }),
      prisma.catalogChangeRequest.findMany({
        where: recentRequestWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, kind: true, status: true, senseKey: true, afterTermSnapshot: true, reviewNote: true, updatedAt: true },
      }),
      bulkEnabled ? prisma.catalogSubmissionBatch.findMany({
        where: recentBatchWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, fileName: true, status: true, rowCount: true, updatedAt: true },
      }) : Promise.resolve([]),
      prisma.catalogFeedback.findMany({
        where: recentFeedbackWhere,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: itemLimit,
        select: { id: true, kind: true, status: true, senseKey: true, termSnapshot: true, message: true, suggestedValue: true, resolutionNote: true, updatedAt: true },
      }),
    ]);

    const [waitingRequestCount, waitingBatchCount, waitingFeedbackCount, recentRequestCount, recentBatchCount, recentFeedbackCount] = await Promise.all([
      prisma.catalogChangeRequest.count({ where: waitingRequestWhere }),
      bulkEnabled ? prisma.catalogSubmissionBatch.count({ where: waitingBatchWhere }) : Promise.resolve(0),
      prisma.catalogFeedback.count({ where: waitingFeedbackWhere }),
      prisma.catalogChangeRequest.count({ where: recentRequestWhere }),
      bulkEnabled ? prisma.catalogSubmissionBatch.count({ where: recentBatchWhere }) : Promise.resolve(0),
      prisma.catalogFeedback.count({ where: recentFeedbackWhere }),
    ]);
    const sectionTotals = {
      needsRevision: requestsToRevise + batchesToRevise,
      toReview: requestsToReview + batchesToReview + feedbackToReview,
      waiting: waitingRequestCount + waitingBatchCount + waitingFeedbackCount,
      recent: recentRequestCount + recentBatchCount + recentFeedbackCount,
    };
    const needsRevision = mergeCatalogWorkItems([
      ...revisionRequests.map((item) => ({ type: "REQUEST" as const, ...item, updatedAt: item.updatedAt.toISOString(), timestamp: item.updatedAt.toISOString() })),
      ...revisionBatches.map((item) => ({ type: "BATCH" as const, ...item, updatedAt: item.updatedAt.toISOString(), timestamp: item.updatedAt.toISOString() })),
    ], itemLimit, "desc");
    const toReview = mergeCatalogWorkItems([
      ...reviewRequests.map((item) => ({ type: "REQUEST" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
      ...reviewBatches.map((item) => ({ type: "BATCH" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
      ...reviewFeedback.map((item) => ({ type: "FEEDBACK" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
    ], itemLimit, "asc");
    const waiting = mergeCatalogWorkItems([
      ...waitingRequests.map((item) => ({ type: "REQUEST" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
      ...waitingBatches.map((item) => ({ type: "BATCH" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
      ...waitingFeedback.map((item) => ({ type: "FEEDBACK" as const, ...item, createdAt: item.createdAt.toISOString(), timestamp: item.createdAt.toISOString() })),
    ], itemLimit, "desc");
    const recent = mergeCatalogWorkItems([
      ...recentRequests.map((item) => ({ type: "REQUEST" as const, ...item, updatedAt: item.updatedAt.toISOString(), timestamp: item.updatedAt.toISOString() })),
      ...recentBatches.map((item) => ({ type: "BATCH" as const, ...item, updatedAt: item.updatedAt.toISOString(), timestamp: item.updatedAt.toISOString() })),
      ...recentFeedback.map((item) => ({ type: "FEEDBACK" as const, ...item, updatedAt: item.updatedAt.toISOString(), timestamp: item.updatedAt.toISOString() })),
    ], itemLimit, "desc");

    return NextResponse.json({
      counts,
      canReview: auth.canReview,
      bulkEnabled,
      itemLimit,
      sectionTotals,
      needsRevision,
      toReview,
      waiting,
      recent,
    }, { headers: CATALOG_PRIVATE_HEADERS });
  } catch (error) {
    return catalogRouteError(error);
  }
}
