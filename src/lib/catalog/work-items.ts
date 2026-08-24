import type { Prisma } from "@/generated/prisma";

const REVIEWABLE_BATCH_STATUSES = ["SUBMITTED", "REVIEWING", "REVIEWED"] as const;

export function catalogBatchNeedsRevisionWhere(actorId: string): Prisma.CatalogSubmissionBatchWhereInput {
  return {
    OR: [
      {
        status: { in: ["STALE", "REJECTED"] },
        OR: [{ proposerId: actorId }, { resolutionOwnerId: actorId }],
        retriedBy: null,
      },
      { status: "PREVIEW", proposerId: actorId },
      {
        status: "NEEDS_RESOLUTION",
        OR: [
          { proposerId: actorId, resolutionOwnerId: null },
          { resolutionOwnerId: actorId },
        ],
      },
    ],
  };
}

export function catalogBatchReviewWhere(actorId: string): Prisma.CatalogSubmissionBatchWhereInput {
  return {
    proposerId: { not: actorId },
    proposalGroups: { none: { authors: { some: { actorUserId: actorId } } } },
    OR: [
      // An unclaimed resolution can be picked up for review. Once claimed, the
      // owner sees it only in the revision bucket so the badge is not doubled.
      { status: "NEEDS_RESOLUTION", resolutionOwnerId: null },
      {
        status: { in: [...REVIEWABLE_BATCH_STATUSES] },
        OR: [{ reviewerId: null }, { reviewerId: actorId }],
      },
    ],
  };
}

export function standaloneRequestNeedsRevision(input: {
  status: string;
  proposerId: string;
  actorId: string;
  supersededById: string | null;
}): boolean {
  return input.status === "REJECTED"
    && input.proposerId === input.actorId
    && input.supersededById === null;
}

export function batchNeedsRevision(input: {
  status: string;
  proposerId: string;
  resolutionOwnerId: string | null;
  actorId: string;
  retriedById: string | null;
}): boolean {
  return ["STALE", "REJECTED"].includes(input.status)
    && (input.proposerId === input.actorId || input.resolutionOwnerId === input.actorId)
    && input.retriedById === null;
}

export function actionableCatalogWorkCount(input: {
  requestsToRevise: number;
  batchesToRevise: number;
  requestsToReview: number;
  batchesToReview: number;
  feedbackToReview: number;
}): number {
  return Object.values(input).reduce((total, count) => total + Math.max(0, count), 0);
}
