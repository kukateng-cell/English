import { Prisma } from "@/generated/prisma";

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

/**
 * SQL representation of currentCatalogWordWhere() for aggregate-only paths.
 * Keep this fragment and the Prisma predicate above set-equivalent; the DB
 * integration checker compares their exact word-ID sets.
 */
export function currentCatalogWordCtesSql() {
  return Prisma.sql`
    ready_revisions AS MATERIALIZED (
      SELECT revision."id"
      FROM "CatalogRevision" AS revision
      WHERE revision."status" = ${"READY"}
    ),
    active_senses AS MATERIALIZED (
      SELECT sense."id"
      FROM "WordSense" AS sense
      INNER JOIN "WordSenseRevision" AS approved_revision
        ON approved_revision."id" = sense."approvedRevisionId"
      INNER JOIN ready_revisions AS approved_catalog
        ON approved_catalog."id" = approved_revision."catalogRevisionId"
      WHERE sense."status" = ${"ACTIVE"}::"CatalogStatus"
    ),
    current_words AS MATERIALIZED (
      SELECT word."id", word."level", word."category"
      FROM "Word" AS word
      INNER JOIN ready_revisions AS word_catalog
        ON word_catalog."id" = word."catalogRevisionId"
      INNER JOIN active_senses AS sense
        ON sense."id" = word."senseId"
      WHERE word."senseId" IS NOT NULL
    )
  `;
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
