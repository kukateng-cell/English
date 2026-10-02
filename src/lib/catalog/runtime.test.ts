import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleOperationalObjectiveEvent } from "./runtime";

function event(purpose: "DUE_REVIEW" | "EVIDENCE_OBLIGATION", obligation: { status: string } | null) {
  return {
    id: "event-1",
    userId: "user-1",
    submittedWordId: "word-1",
    wordId: "word-1",
    senseId: "sense-1",
    contentRevisionId: "content-1",
    catalogRevisionId: "catalog-1",
    eventKind: "REVIEW",
    isHistorical: false,
    evidenceKind: "OBJECTIVE_PROBE",
    flowVersion: "v2",
    qualityPolicyVersion: "retrieval-v1-quality-v1",
    itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
    probePurpose: purpose,
    objectiveEvidenceTargetId: "target-1",
    objectiveQuestionSnapshotId: "snapshot-1",
    operationId: "operation-1",
    quality: 4,
    objectiveEvidenceTarget: {
      id: "target-1",
      userId: "user-1",
      wordId: "word-1",
      senseId: "sense-1",
      policyVersion: "retrieval-v1",
      itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
      status: "CONSUMED",
      purpose,
      winningOperationId: "operation-1",
      winningReviewEventId: "event-1",
      questionSnapshot: {
        id: "snapshot-1",
        targetId: "target-1",
        wordId: "word-1",
        senseId: "sense-1",
        contentRevisionId: "content-1",
        catalogRevisionId: "catalog-1",
        contentVersion: "retrieval-v1-mcq-curated-v2",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
      },
      obligation,
    },
  };
}

test("objective eligibility distinguishes due reviews from evidence obligations", () => {
  assert.equal(isEligibleOperationalObjectiveEvent(event("DUE_REVIEW", null)), true);
  assert.equal(isEligibleOperationalObjectiveEvent(event("EVIDENCE_OBLIGATION", { status: "ANSWERED" })), true);
  assert.equal(isEligibleOperationalObjectiveEvent(event("DUE_REVIEW", { status: "ANSWERED" })), false);
  assert.equal(isEligibleOperationalObjectiveEvent(event("EVIDENCE_OBLIGATION", { status: "EXPIRED" })), false);
});

test("objective eligibility rejects unsupported policy outcomes and mismatched winners", () => {
  const invalidQuality = { ...event("DUE_REVIEW", null), quality: 5 };
  assert.equal(isEligibleOperationalObjectiveEvent(invalidQuality), false);
  const mismatchedWinner = {
    ...event("DUE_REVIEW", null),
    objectiveEvidenceTarget: { ...event("DUE_REVIEW", null).objectiveEvidenceTarget, winningOperationId: "other-operation" },
  };
  assert.equal(isEligibleOperationalObjectiveEvent(mismatchedWinner), false);
  const mismatchedPurpose = {
    ...event("DUE_REVIEW", null),
    objectiveEvidenceTarget: { ...event("DUE_REVIEW", null).objectiveEvidenceTarget, purpose: "EVIDENCE_OBLIGATION" },
  };
  assert.equal(isEligibleOperationalObjectiveEvent(mismatchedPurpose), false);
  const mismatchedEvent = {
    ...event("DUE_REVIEW", null),
    id: "event-2",
  };
  assert.equal(isEligibleOperationalObjectiveEvent(mismatchedEvent), false);
  const mismatchedLineage = {
    ...event("DUE_REVIEW", null),
    objectiveEvidenceTarget: { ...event("DUE_REVIEW", null).objectiveEvidenceTarget, userId: "other-user" },
  };
  assert.equal(isEligibleOperationalObjectiveEvent(mismatchedLineage), false);
  const missingDueObligation = {
    ...event("DUE_REVIEW", null),
    objectiveEvidenceTarget: { ...event("DUE_REVIEW", null).objectiveEvidenceTarget, obligation: undefined },
  };
  assert.equal(isEligibleOperationalObjectiveEvent(missingDueObligation), false);
});
