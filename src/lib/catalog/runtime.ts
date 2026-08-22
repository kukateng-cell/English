import type { Prisma } from "@/generated/prisma";

/**
 * A sense is current only when its catalog revision is READY and the sense is
 * formally ACTIVE with an approved revision.  The rule is intentionally
 * environment-independent: development, CI and production use one catalog.
 */
export function currentCatalogSenseWhere(): Prisma.WordSenseWhereInput {
  return {
    status: "ACTIVE" as const,
    approvedRevision: {
      is: {
        catalogRevision: { status: "READY" },
      },
    },
  };
}

/** Word is a compatibility projection; legacy Markdown rows are never current. */
export function currentCatalogWordWhere(): Prisma.WordWhereInput {
  return {
    senseId: { not: null },
    catalogRevision: { status: "READY" },
    sense: currentCatalogSenseWhere(),
  };
}

export function withCurrentCatalogWord(
  where: Prisma.WordWhereInput = {},
): Prisma.WordWhereInput {
  return { AND: [currentCatalogWordWhere(), where] };
}

/** Current non-historical review events used by operational metrics. */
export function currentCatalogReviewEventWhere(): Prisma.ReviewEventWhereInput {
  return {
    eventKind: "REVIEW",
    isHistorical: false,
    senseId: { not: null },
    sense: currentCatalogSenseWhere(),
  };
}

/**
 * Provenance-complete Objective Probe events.  The relational checks are
 * deliberately conservative: an event must belong to a consumed target,
 * answered obligation, immutable question snapshot and current sense.  A
 * malformed or diagnostic event therefore cannot affect public metrics.
 */
export function eligibleOperationalObjectiveEventWhere(): Prisma.ReviewEventWhereInput {
  return {
    ...currentCatalogReviewEventWhere(),
    evidenceKind: "OBJECTIVE_PROBE",
    flowVersion: "v2",
    qualityPolicyVersion: { not: null },
    itemConstructionVersion: { not: null },
    probePurpose: { in: ["DUE_REVIEW", "EVIDENCE_OBLIGATION"] },
    objectiveEvidenceTargetId: { not: null },
    objectiveQuestionSnapshotId: { not: null },
    objectiveEvidenceTarget: {
      status: "CONSUMED",
      winningOperationId: { not: null },
      winningReviewEventId: { not: null },
      obligation: { status: "ANSWERED" },
      questionSnapshot: { isNot: null },
    },
  };
}
