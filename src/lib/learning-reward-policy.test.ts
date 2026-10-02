import assert from "node:assert/strict";
import test from "node:test";
import {
  addRewardScores,
  calculateRewardScores,
  emptyRewardScores,
  isRewardWeights,
  rewardAccuracyPercent,
  rewardAccuracyStatus,
} from "@/lib/learning-reward-policy";

test("reward-v1 reproduces the approved 40/60 daily example", () => {
  const septemberFirst = calculateRewardScores({ effortActivityCount: 20, firstCorrectSenseCount: 3, weights: { effort: 40, outcome: 60 } });
  const septemberSecond = calculateRewardScores({ effortActivityCount: 10, firstCorrectSenseCount: 1, weights: { effort: 40, outcome: 60 } });
  assert.deepEqual(septemberFirst, {
    effortMilliPoints: 10_000,
    outcomeMilliPoints: 6_000,
    effortContributionMilliPoints: 4_000,
    outcomeContributionMilliPoints: 3_600,
    weightedMilliPoints: 7_600,
  });
  assert.equal(addRewardScores(septemberFirst, septemberSecond).weightedMilliPoints, 10_800);
});

test("reward-v1 caps each axis per day without stopping raw activity counting", () => {
  const scores = calculateRewardScores({ effortActivityCount: 21, firstCorrectSenseCount: 6, weights: { effort: 50, outcome: 50 } });
  assert.equal(scores.effortMilliPoints, 10_000);
  assert.equal(scores.outcomeMilliPoints, 10_000);
  assert.equal(scores.weightedMilliPoints, 10_000);
});

test("reward-v1 keeps both axes when one activity is also a successful probe", () => {
  const scores = calculateRewardScores({ effortActivityCount: 1, firstCorrectSenseCount: 1, weights: { effort: 50, outcome: 50 } });
  assert.equal(scores.effortContributionMilliPoints, 250);
  assert.equal(scores.outcomeContributionMilliPoints, 1_000);
  assert.equal(scores.weightedMilliPoints, 1_250);
});

test("reward-v1 validates integer weights and preserves exact zero-weight axes", () => {
  assert.equal(isRewardWeights({ effort: 100, outcome: 0 }), true);
  assert.equal(isRewardWeights({ effort: 40, outcome: 60 }), true);
  assert.equal(isRewardWeights({ effort: 40, outcome: 61 }), false);
  assert.equal(isRewardWeights({ effort: 50.5, outcome: 49.5 }), false);
  const scores = calculateRewardScores({ effortActivityCount: 2, firstCorrectSenseCount: 2, weights: { effort: 100, outcome: 0 } });
  assert.equal(scores.outcomeMilliPoints, 4_000);
  assert.equal(scores.outcomeContributionMilliPoints, 0);
  assert.equal(scores.weightedMilliPoints, 1_000);
});

test("accuracy keeps no-data separate from zero percent", () => {
  assert.equal(rewardAccuracyPercent(0, 0), null);
  assert.equal(rewardAccuracyPercent(0, 2), 0);
  assert.equal(rewardAccuracyPercent(1, 3), 33.33);
  assert.equal(rewardAccuracyStatus(0), "NO_DATA");
  assert.equal(rewardAccuracyStatus(4), "SMALL_SAMPLE");
  assert.equal(rewardAccuracyStatus(5), "SUFFICIENT");
  assert.deepEqual(emptyRewardScores(), calculateRewardScores({ effortActivityCount: 0, firstCorrectSenseCount: 0, weights: { effort: 50, outcome: 50 } }));
});

test("daily reward scores are exactly additive in milli-points", () => {
  const left = calculateRewardScores({ effortActivityCount: 9, firstCorrectSenseCount: 2, weights: { effort: 40, outcome: 60 } });
  const right = calculateRewardScores({ effortActivityCount: 10, firstCorrectSenseCount: 1, weights: { effort: 40, outcome: 60 } });
  assert.deepEqual(addRewardScores(left, right), {
    effortMilliPoints: 9_500,
    outcomeMilliPoints: 6_000,
    effortContributionMilliPoints: 3_800,
    outcomeContributionMilliPoints: 3_600,
    weightedMilliPoints: 7_400,
  });
});
