import { offsetDay } from "@/lib/streak";
import {
  calculateRewardScores,
  formatRewardMilliPoints,
  REWARD_DAILY_EFFORT_CAP,
  REWARD_DAILY_OUTCOME_CAP,
  type RewardScores,
  type RewardWeights,
} from "@/lib/learning-reward-policy";

export const STUDENT_WEEKLY_LEADERBOARD_POLICY_VERSION = "student-weekly-v1" as const;
export const STUDENT_WEEKLY_LEADERBOARD_WEIGHTS: RewardWeights = { effort: 70, outcome: 30 };
export const STUDENT_WEEKLY_GOAL_DAYS = 4 as const;
export const STUDENT_WEEKLY_PAGE_SIZE = 50 as const;
export const STUDENT_WEEKLY_CURSOR_TTL_MS = 5 * 60_000;

export type WeeklyDateRange = {
  start: string;
  endExclusive: string;
  effectiveFrom: string;
  effectiveTo: string;
  scoreTo: string;
};

export type WeeklyRankingState = "RANKED" | "UNRANKED" | "PENDING_REVIEW";

export type WeeklyRankingCandidate = {
  studentId: string;
  nickname: string;
  scoreMilliPoints: number;
  rankingState: WeeklyRankingState;
};

export type WeeklyRankedEntry = WeeklyRankingCandidate & {
  rank: number | null;
  isTied: boolean;
};

export function dateFromParts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("DATE_INVALID");
  }
  return { year, month, day };
}

export function daysBetweenKeys(from: string, to: string): string[] {
  if (from > to) return [];
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = offsetDay(cursor, 1)) days.push(cursor);
  return days;
}

/** Monday 00:00 local date for the supplied Asia/Shanghai calendar day. */
export function startOfLeaderboardWeek(dateKey: string): string {
  const { year, month, day } = dateFromParts(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return offsetDay(dateKey, -daysSinceMonday);
}

export function buildWeeklyDateRange(input: {
  today: string;
  yearFrom: string;
  yearTo: string;
}): WeeklyDateRange | null {
  if (input.today < input.yearFrom || input.yearFrom > input.yearTo) return null;
  const start = startOfLeaderboardWeek(input.today);
  const endExclusive = offsetDay(start, 7);
  const effectiveFrom = start < input.yearFrom ? input.yearFrom : start;
  const weekEnd = offsetDay(endExclusive, -1);
  const effectiveTo = weekEnd > input.yearTo ? input.yearTo : weekEnd;
  const scoreTo = input.today < effectiveTo ? input.today : effectiveTo;
  if (effectiveFrom > effectiveTo || effectiveFrom > scoreTo) return null;
  return { start, endExclusive, effectiveFrom, effectiveTo, scoreTo };
}

export function calculateStudentWeeklyScores(input: {
  effortActivityCount: number;
  firstCorrectSenseCount: number;
  weights?: RewardWeights;
}): RewardScores {
  return calculateRewardScores({
    effortActivityCount: input.effortActivityCount,
    firstCorrectSenseCount: input.firstCorrectSenseCount,
    weights: input.weights ?? STUDENT_WEEKLY_LEADERBOARD_WEIGHTS,
  });
}

export function weeklyScoreDisplay(scoreMilliPoints: number | null): number | null {
  return formatRewardMilliPoints(scoreMilliPoints);
}

export function weeklyGoalTargetDays(effectiveFrom: string, effectiveTo: string): number {
  return Math.min(STUDENT_WEEKLY_GOAL_DAYS, daysBetweenKeys(effectiveFrom, effectiveTo).length);
}

export function rankWeeklyEntries(
  candidates: readonly WeeklyRankingCandidate[],
): WeeklyRankedEntry[] {
  const eligible = candidates
    .filter((candidate) => candidate.rankingState === "RANKED" && candidate.scoreMilliPoints > 0)
    .sort((left, right) => right.scoreMilliPoints - left.scoreMilliPoints || left.studentId.localeCompare(right.studentId));
  const tieCounts = new Map<number, number>();
  for (const candidate of eligible) tieCounts.set(candidate.scoreMilliPoints, (tieCounts.get(candidate.scoreMilliPoints) ?? 0) + 1);
  const pending = candidates
    .filter((candidate) => candidate.rankingState === "PENDING_REVIEW")
    .sort((left, right) => right.scoreMilliPoints - left.scoreMilliPoints || left.studentId.localeCompare(right.studentId));
  const unranked = candidates
    .filter((candidate) => candidate.rankingState === "UNRANKED")
    .sort((left, right) => right.scoreMilliPoints - left.scoreMilliPoints || left.studentId.localeCompare(right.studentId));

  const ranked: WeeklyRankedEntry[] = [];
  let previousScore: number | null = null;
  let previousRank = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const candidate = eligible[index];
    const rank = candidate.scoreMilliPoints === previousScore ? previousRank : index + 1;
    previousScore = candidate.scoreMilliPoints;
    previousRank = rank;
    ranked.push({
      ...candidate,
      rank,
      isTied: (tieCounts.get(candidate.scoreMilliPoints) ?? 0) > 1,
    });
  }
  ranked.push(...pending.map((candidate) => ({ ...candidate, rank: null, isTied: false })));
  ranked.push(...unranked.map((candidate) => ({ ...candidate, rank: null, isTied: false })));
  return ranked;
}

export function gapToNextWeeklyRank(entries: readonly WeeklyRankedEntry[], studentId: string): number | null {
  const me = entries.find((entry) => entry.studentId === studentId);
  if (!me || me.rank === null || me.rankingState !== "RANKED") return null;
  const nextHigher = entries.find((entry) => entry.rank !== null && entry.scoreMilliPoints > me.scoreMilliPoints);
  return nextHigher ? nextHigher.scoreMilliPoints - me.scoreMilliPoints : null;
}

export function nearbyWeeklyEntries(entries: readonly WeeklyRankedEntry[], studentId: string, radius = 2): WeeklyRankedEntry[] {
  const index = entries.findIndex((entry) => entry.studentId === studentId);
  if (index < 0) return [];
  return entries.slice(Math.max(0, index - radius), Math.min(entries.length, index + radius + 1));
}

export function scorePartsForDisplay(scores: RewardScores | null) {
  return scores ? {
    effort: weeklyScoreDisplay(scores.effortContributionMilliPoints),
    outcome: weeklyScoreDisplay(scores.outcomeContributionMilliPoints),
    total: weeklyScoreDisplay(scores.weightedMilliPoints),
  } : { effort: null, outcome: null, total: null };
}

export const WEEKLY_SCORE_EXPLANATION = {
  weights: STUDENT_WEEKLY_LEADERBOARD_WEIGHTS,
  effortCap: REWARD_DAILY_EFFORT_CAP,
  outcomeCap: REWARD_DAILY_OUTCOME_CAP,
} as const;
