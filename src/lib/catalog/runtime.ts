import { Prisma } from "@/generated/prisma";
import {
  OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
  OBJECTIVE_QUALITY_POLICY_VERSION,
  RETRIEVAL_POLICY_VERSION,
} from "@/lib/learning-policy/types";

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
 * Coarse SQL candidate set for provenance-complete Objective Probe events.
 * The relational checks are deliberately conservative and branch by probe
 * purpose: a direct due review has no obligation, while an evidence
 * obligation must be answered. Prisma cannot compare an event scalar to a
 * related target scalar (for example `probePurpose = target.purpose`), so
 * every consumer must apply isEligibleOperationalObjectiveEvent() to the
 * selected rows before counting or projecting them.
 */
export function eligibleOperationalObjectiveEventWhere(): Prisma.ReviewEventWhereInput {
  return {
    ...currentCatalogReviewEventWhere(),
    evidenceKind: "OBJECTIVE_PROBE",
    flowVersion: "v2",
    qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
    itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
    quality: { in: [2, 4] },
    probePurpose: { in: ["DUE_REVIEW", "EVIDENCE_OBLIGATION"] },
    objectiveEvidenceTargetId: { not: null },
    objectiveQuestionSnapshotId: { not: null },
    objectiveEvidenceTarget: {
      status: "CONSUMED",
      winningOperationId: { not: null },
      winningReviewEventId: { not: null },
      questionSnapshot: { isNot: null },
      OR: [
        {
          purpose: "DUE_REVIEW",
          obligation: { is: null },
        },
        {
          purpose: "EVIDENCE_OBLIGATION",
          obligation: { is: { status: "ANSWERED" } },
        },
      ],
    },
  };
}

/**
 * In-memory counterpart of eligibleOperationalObjectiveEventWhere().
 * Analytics and teacher-side projections already load the target relation, so
 * using this resolver keeps their purpose/obligation/quality semantics in
 * lockstep with SQL-backed student metrics.
 */
export function isEligibleOperationalObjectiveEvent(event: {
  id?: string | null;
  userId?: string | null;
  submittedWordId?: string | null;
  wordId?: string | null;
  senseId?: string | null;
  contentRevisionId?: string | null;
  catalogRevisionId?: string | null;
  eventKind?: string | null;
  isHistorical?: boolean | null;
  evidenceKind?: string | null;
  flowVersion?: string | null;
  qualityPolicyVersion?: string | null;
  itemConstructionVersion?: string | null;
  probePurpose?: string | null;
  objectiveEvidenceTargetId?: string | null;
  objectiveQuestionSnapshotId?: string | null;
  operationId?: string | null;
  quality?: number | null;
  objectiveEvidenceTarget?: {
    id?: string | null;
    userId?: string | null;
    wordId?: string | null;
    senseId?: string | null;
    policyVersion?: string | null;
    itemConstructionVersion?: string | null;
    status?: string | null;
    purpose?: string | null;
    winningOperationId?: string | null;
    winningReviewEventId?: string | null;
    questionSnapshot?: {
      id?: string | null;
      targetId?: string | null;
      wordId?: string | null;
      senseId?: string | null;
      contentRevisionId?: string | null;
      catalogRevisionId?: string | null;
      contentVersion?: string | null;
      itemConstructionVersion?: string | null;
    } | null;
    obligation?: { status?: string | null } | null;
  } | null;
}): boolean {
  if (
    event.eventKind !== "REVIEW" || event.isHistorical !== false ||
    !event.id || !event.userId || !event.submittedWordId || !event.wordId || !event.senseId ||
    event.submittedWordId !== event.wordId ||
    event.evidenceKind !== "OBJECTIVE_PROBE" || event.flowVersion !== "v2" ||
    event.qualityPolicyVersion !== OBJECTIVE_QUALITY_POLICY_VERSION ||
    event.itemConstructionVersion !== OBJECTIVE_ITEM_CONSTRUCTION_VERSION ||
    (event.quality !== 2 && event.quality !== 4) ||
    (event.probePurpose !== "DUE_REVIEW" && event.probePurpose !== "EVIDENCE_OBLIGATION") ||
    !event.objectiveEvidenceTargetId || !event.objectiveQuestionSnapshotId ||
    !event.objectiveEvidenceTarget ||
    event.objectiveEvidenceTarget.id !== event.objectiveEvidenceTargetId ||
    event.objectiveEvidenceTarget.userId !== event.userId ||
    event.objectiveEvidenceTarget.wordId !== event.wordId ||
    event.objectiveEvidenceTarget.senseId !== event.senseId ||
    event.objectiveEvidenceTarget.policyVersion !== RETRIEVAL_POLICY_VERSION ||
    event.objectiveEvidenceTarget.itemConstructionVersion !== OBJECTIVE_ITEM_CONSTRUCTION_VERSION ||
    event.objectiveEvidenceTarget.status !== "CONSUMED" ||
    event.objectiveEvidenceTarget.winningOperationId !== event.operationId ||
    !event.objectiveEvidenceTarget.winningReviewEventId ||
    (event.id !== undefined && event.objectiveEvidenceTarget.winningReviewEventId !== event.id) ||
    event.objectiveEvidenceTarget.questionSnapshot?.id !== event.objectiveQuestionSnapshotId ||
    event.objectiveEvidenceTarget.questionSnapshot.targetId !== event.objectiveEvidenceTargetId ||
    event.objectiveEvidenceTarget.questionSnapshot.wordId !== event.wordId ||
    event.objectiveEvidenceTarget.questionSnapshot.senseId !== event.senseId ||
    event.objectiveEvidenceTarget.questionSnapshot.contentRevisionId !== event.contentRevisionId ||
    event.objectiveEvidenceTarget.questionSnapshot.catalogRevisionId !== event.catalogRevisionId ||
    event.objectiveEvidenceTarget.questionSnapshot.contentVersion !== OBJECTIVE_ITEM_CONSTRUCTION_VERSION ||
    event.objectiveEvidenceTarget.questionSnapshot.itemConstructionVersion !== OBJECTIVE_ITEM_CONSTRUCTION_VERSION ||
    event.objectiveEvidenceTarget.purpose !== event.probePurpose
  ) return false;
  if (event.probePurpose === "DUE_REVIEW") {
    return event.objectiveEvidenceTarget.obligation === null;
  }
  return event.objectiveEvidenceTarget.obligation?.status === "ANSWERED";
}
