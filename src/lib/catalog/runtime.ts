import type { Prisma } from "@/generated/prisma";

export type CatalogRuntimeEnvironment = "development" | "test" | "production";

export function catalogRuntimeEnvironment(): CatalogRuntimeEnvironment {
  const value = process.env.DATABASE_ENVIRONMENT;
  return value === "production" || value === "test" ? value : "development";
}

/**
 * A sense is current only when its catalog revision is READY and the sense is
 * either formally ACTIVE or explicitly eligible for the local/test bootstrap.
 * Keeping this predicate in one place prevents stale Word projections from
 * leaking into queues, denominators, leaderboards, or teacher reports.
 */
export function currentCatalogSenseWhere(
  environment: CatalogRuntimeEnvironment = catalogRuntimeEnvironment(),
): Prisma.WordSenseWhereInput {
  const active = {
    status: "ACTIVE" as const,
    approvedRevision: {
      is: {
        catalogRevision: { status: "READY" },
      },
    },
  };
  if (environment === "production") return active;
  return {
    OR: [
      active,
      {
        status: "DRAFT" as const,
        localEligibilities: {
          some: {
            environment,
            basis: "LOCAL_DEMO_BOOTSTRAP",
            catalogRevision: { status: "READY" },
          },
        },
      },
    ],
  };
}

/** Word is a compatibility projection; legacy Markdown rows are never current. */
export function currentCatalogWordWhere(
  environment: CatalogRuntimeEnvironment = catalogRuntimeEnvironment(),
): Prisma.WordWhereInput {
  return {
    senseId: { not: null },
    catalogRevision: { status: "READY" },
    sense: currentCatalogSenseWhere(environment),
  };
}

export function withCurrentCatalogWord(
  where: Prisma.WordWhereInput = {},
  environment: CatalogRuntimeEnvironment = catalogRuntimeEnvironment(),
): Prisma.WordWhereInput {
  return { AND: [currentCatalogWordWhere(environment), where] };
}

/** Current non-historical review events used by operational metrics. */
export function currentCatalogReviewEventWhere(
  environment: CatalogRuntimeEnvironment = catalogRuntimeEnvironment(),
): Prisma.ReviewEventWhereInput {
  return {
    eventKind: "REVIEW",
    isHistorical: false,
    senseId: { not: null },
    sense: currentCatalogSenseWhere(environment),
  };
}

/**
 * Provenance-complete Objective Probe events.  The relational checks are
 * deliberately conservative: an event must belong to a consumed target,
 * answered obligation, immutable question snapshot and current sense.  A
 * malformed or diagnostic event therefore cannot affect public metrics.
 */
export function eligibleOperationalObjectiveEventWhere(
  environment: CatalogRuntimeEnvironment = catalogRuntimeEnvironment(),
): Prisma.ReviewEventWhereInput {
  return {
    ...currentCatalogReviewEventWhere(environment),
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
