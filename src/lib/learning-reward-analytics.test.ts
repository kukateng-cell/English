import test from "node:test";
import assert from "node:assert/strict";
import { isRewardReviewCandidate } from "@/lib/learning-reward-analytics";

const emptyObjectiveMarker = {
  flowVersion: null,
  evidenceKind: null,
  objectiveEvidenceTargetId: null,
  objectiveQuestionSnapshotId: null,
  probePurpose: null,
  submittedSenseId: null,
} as const;

test("reward reader keeps explicit bridge rows in the coverage candidate universe", () => {
  assert.equal(isRewardReviewCandidate({ eventKind: "LEGACY_BRIDGE", ...emptyObjectiveMarker }), true);
  assert.equal(isRewardReviewCandidate({ eventKind: "HISTORICAL_BACKFILL", ...emptyObjectiveMarker }), true);
});

test("reward reader does not treat an ordinary non-objective review as an objective candidate", () => {
  assert.equal(isRewardReviewCandidate({ eventKind: "REVIEW", ...emptyObjectiveMarker }), false);
  assert.equal(isRewardReviewCandidate({ eventKind: "REVIEW", ...emptyObjectiveMarker, flowVersion: "v2" }), true);
});
