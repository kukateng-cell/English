import type { Prisma } from "@/generated/prisma";

const REVIEWABLE_BATCH_STATUSES = ["SUBMITTED", "REVIEWING", "REVIEWED"] as const;
const INITIAL_RETRY_SOURCE_STATUSES = ["STALE", "REJECTED"] as const;
const RESTARTABLE_RETRY_SOURCE_STATUSES = ["CANCELLED", "EXPIRED"] as const;

export function isCatalogBatchRetrySourceStatus(input: {
  status: string;
  retryOfBatchId: string | null;
}): boolean {
  return INITIAL_RETRY_SOURCE_STATUSES.includes(input.status as (typeof INITIAL_RETRY_SOURCE_STATUSES)[number])
    || (
      input.retryOfBatchId !== null
      && RESTARTABLE_RETRY_SOURCE_STATUSES.includes(input.status as (typeof RESTARTABLE_RETRY_SOURCE_STATUSES)[number])
    );
}

const retryableContentGroups: Prisma.CatalogSubmissionProposalGroupListRelationFilter = {
  some: {
    AND: [
      { OR: [{ resolution: null }, { resolution: { not: "REJECT" } }] },
      { requestedAction: { in: ["CREATE", "UPDATE"] } },
    ],
  },
  none: {
    AND: [
      { OR: [{ resolution: null }, { resolution: { not: "REJECT" } }] },
      { OR: [
        { requestedAction: { in: ["RETIRE", "REACTIVATE"] } },
        { changeRequest: { is: { kind: { in: ["RETIRE", "REACTIVATE"] } } } },
      ] },
    ],
  },
};

export function catalogBatchNeedsRevisionWhere(actorId: string): Prisma.CatalogSubmissionBatchWhereInput {
  return {
    OR: [
      {
        AND: [
          {
            OR: [
              { status: { in: [...INITIAL_RETRY_SOURCE_STATUSES] } },
              {
                status: { in: [...RESTARTABLE_RETRY_SOURCE_STATUSES] },
                retryOfBatchId: { not: null },
              },
            ],
          },
          { OR: [{ proposerId: actorId }, { resolutionOwnerId: actorId }] },
        ],
        retriedBy: null,
        contentPurgedAt: null,
        proposalGroups: retryableContentGroups,
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

export type StandaloneRetryIneligibilityReason =
  | "ALREADY_RETIRED"
  | "ALREADY_ACTIVE"
  | "CHANGE_PENDING"
  | "SENSE_REMOVED"
  | "IDENTITY_ALREADY_EXISTS";

export type StandaloneRetryIdentity = {
  status: string;
  approvedRevisionId: string | null;
} | null;

export function evaluateStandaloneRetryEligibility(input: {
  kind: "CREATE" | "UPDATE" | "RETIRE" | "REACTIVATE";
  senseKey: string | null;
  currentIdentity: StandaloneRetryIdentity;
  hasPendingChange: boolean;
}): { eligible: true } | { eligible: false; reason: StandaloneRetryIneligibilityReason } {
  if (input.hasPendingChange) return { eligible: false, reason: "CHANGE_PENDING" };
  if (!input.senseKey) return { eligible: false, reason: "SENSE_REMOVED" };
  if (input.kind === "CREATE") {
    return input.currentIdentity
      ? { eligible: false, reason: "IDENTITY_ALREADY_EXISTS" }
      : { eligible: true };
  }
  if (!input.currentIdentity) return { eligible: false, reason: "SENSE_REMOVED" };
  if (input.kind === "UPDATE") return { eligible: true };
  if (!input.currentIdentity.approvedRevisionId) {
    return { eligible: false, reason: "SENSE_REMOVED" };
  }
  if (input.kind === "RETIRE") {
    return input.currentIdentity.status === "ACTIVE"
      ? { eligible: true }
      : { eligible: false, reason: "ALREADY_RETIRED" };
  }
  return input.currentIdentity.status === "RETIRED"
    ? { eligible: true }
    : { eligible: false, reason: "ALREADY_ACTIVE" };
}

export function standaloneRequestRetryCandidateWhere(actorId: string): Prisma.CatalogChangeRequestWhereInput {
  return {
    proposerId: actorId,
    status: "REJECTED",
    submissionProposalGroupId: null,
    supersededBy: null,
    OR: [
      { kind: "CREATE" },
      { kind: "UPDATE", sense: { is: { changeRequests: { none: { status: "PENDING" } } } } },
      { kind: "RETIRE", sense: { is: { status: "ACTIVE", approvedRevisionId: { not: null }, changeRequests: { none: { status: "PENDING" } } } } },
      { kind: "REACTIVATE", sense: { is: { status: "RETIRED", approvedRevisionId: { not: null }, changeRequests: { none: { status: "PENDING" } } } } },
    ],
  };
}

export function batchNeedsRevision(input: {
  status: string;
  proposerId: string;
  resolutionOwnerId: string | null;
  actorId: string;
  retriedById: string | null;
  retryOfBatchId?: string | null;
  contentPurgedAt?: Date | null;
  hasRetryableContent?: boolean;
}): boolean {
  return isCatalogBatchRetrySourceStatus({ status: input.status, retryOfBatchId: input.retryOfBatchId ?? null })
    && (input.proposerId === input.actorId || input.resolutionOwnerId === input.actorId)
    && input.retriedById === null
    && (input.contentPurgedAt ?? null) === null
    && (input.hasRetryableContent ?? true);
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

export function mergeCatalogWorkItems<T extends { timestamp: string; id: string }>(
  items: T[],
  limit: number,
  order: "asc" | "desc",
): T[] {
  return [...items]
    .sort((left, right) => {
      const time = order === "desc"
        ? right.timestamp.localeCompare(left.timestamp)
        : left.timestamp.localeCompare(right.timestamp);
      const id = order === "desc"
        ? right.id.localeCompare(left.id)
        : left.id.localeCompare(right.id);
      return time || id;
    })
    .slice(0, limit);
}
