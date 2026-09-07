/**
 * Teacher reward-v1 is a read-only projection over saved V2 learning events.
 * Keep the arithmetic here pure and integer-based so API, UI and exports share
 * exactly one scoring implementation.
 */

export const REWARD_POLICY_VERSION = "reward-v1" as const;
export const REWARD_TIMEZONE = "Asia/Shanghai" as const;
export const REWARD_DAILY_EFFORT_CAP = 20 as const;
export const REWARD_DAILY_OUTCOME_CAP = 5 as const;
export const REWARD_DAILY_SCALE = 10 as const;
export const MILLI_POINTS_PER_POINT = 1_000 as const;
export const EFFORT_MILLI_POINTS_PER_ACTIVITY = 500 as const;
export const OUTCOME_MILLI_POINTS_PER_SUCCESS = 2_000 as const;

export type RewardWeights = {
  effort: number;
  outcome: number;
};

export type RewardScores = {
  effortMilliPoints: number;
  outcomeMilliPoints: number;
  effortContributionMilliPoints: number;
  outcomeContributionMilliPoints: number;
  weightedMilliPoints: number;
};

export type RewardDayInput = {
  effortActivityCount: number;
  firstCorrectSenseCount: number;
  weights: RewardWeights;
};

export function isRewardWeights(value: unknown): value is RewardWeights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RewardWeights>;
  const effort = candidate.effort;
  const outcome = candidate.outcome;
  if (typeof effort !== "number" || typeof outcome !== "number") return false;
  return Number.isInteger(effort) && Number.isInteger(outcome) &&
    effort >= 0 && effort <= 100 &&
    outcome >= 0 && outcome <= 100 &&
    effort + outcome === 100;
}

export function emptyRewardScores(): RewardScores {
  return {
    effortMilliPoints: 0,
    outcomeMilliPoints: 0,
    effortContributionMilliPoints: 0,
    outcomeContributionMilliPoints: 0,
    weightedMilliPoints: 0,
  };
}

function nonNegativeInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function weighted(baseMilliPoints: number, weight: number) {
  // Both v1 base scales are multiples of 500, so integer percentage weights
  // always produce an exact integer milli-point result.
  return Math.round(baseMilliPoints * weight / 100);
}

export function calculateRewardScores(input: RewardDayInput): RewardScores {
  if (!isRewardWeights(input.weights)) throw new Error("WEIGHTS_INVALID");
  const effortActivityCount = nonNegativeInteger(input.effortActivityCount, "effort_activity_count");
  const firstCorrectSenseCount = nonNegativeInteger(input.firstCorrectSenseCount, "first_correct_sense_count");
  const effortMilliPoints = Math.min(effortActivityCount, REWARD_DAILY_EFFORT_CAP) * EFFORT_MILLI_POINTS_PER_ACTIVITY;
  const outcomeMilliPoints = Math.min(firstCorrectSenseCount, REWARD_DAILY_OUTCOME_CAP) * OUTCOME_MILLI_POINTS_PER_SUCCESS;
  const effortContributionMilliPoints = weighted(effortMilliPoints, input.weights.effort);
  const outcomeContributionMilliPoints = weighted(outcomeMilliPoints, input.weights.outcome);
  return {
    effortMilliPoints,
    outcomeMilliPoints,
    effortContributionMilliPoints,
    outcomeContributionMilliPoints,
    weightedMilliPoints: effortContributionMilliPoints + outcomeContributionMilliPoints,
  };
}

export function addRewardScores(left: RewardScores, right: RewardScores): RewardScores {
  return {
    effortMilliPoints: left.effortMilliPoints + right.effortMilliPoints,
    outcomeMilliPoints: left.outcomeMilliPoints + right.outcomeMilliPoints,
    effortContributionMilliPoints: left.effortContributionMilliPoints + right.effortContributionMilliPoints,
    outcomeContributionMilliPoints: left.outcomeContributionMilliPoints + right.outcomeContributionMilliPoints,
    weightedMilliPoints: left.weightedMilliPoints + right.weightedMilliPoints,
  };
}

export function formatRewardMilliPoints(value: number | null): number | null {
  return value === null ? null : value / MILLI_POINTS_PER_POINT;
}

export function scoreToDisplay(value: number | null): string | null {
  return value === null ? null : (value / MILLI_POINTS_PER_POINT).toFixed(3);
}

export type RewardAccuracyStatus = "NO_DATA" | "SMALL_SAMPLE" | "SUFFICIENT";

export function rewardAccuracyStatus(attempts: number): RewardAccuracyStatus {
  if (attempts === 0) return "NO_DATA";
  return attempts < 5 ? "SMALL_SAMPLE" : "SUFFICIENT";
}

export function rewardAccuracyPercent(correct: number, attempts: number): number | null {
  if (attempts === 0) return null;
  return Math.round((correct / attempts * 100) * 100) / 100;
}
