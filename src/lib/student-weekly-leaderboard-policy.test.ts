import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWeeklyDateRange,
  calculateStudentWeeklyScores,
  gapToNextWeeklyRank,
  nearbyWeeklyEntries,
  rankWeeklyEntries,
  startOfLeaderboardWeek,
  weeklyGoalTargetDays,
} from "./student-weekly-leaderboard-policy";

test("weekly calendar uses Monday boundaries in the Shanghai date domain", () => {
  assert.equal(startOfLeaderboardWeek("2026-09-07"), "2026-09-07");
  assert.equal(startOfLeaderboardWeek("2026-09-13"), "2026-09-07");
  assert.equal(startOfLeaderboardWeek("2026-09-14"), "2026-09-14");
});

test("weekly range clamps the score through today but keeps the full goal window", () => {
  const range = buildWeeklyDateRange({ today: "2026-09-09", yearFrom: "2026-09-01", yearTo: "2026-08-31" });
  assert.equal(range, null);
  const current = buildWeeklyDateRange({ today: "2026-09-09", yearFrom: "2026-09-01", yearTo: "2026-12-31" });
  assert.deepEqual(current, {
    start: "2026-09-07",
    endExclusive: "2026-09-14",
    effectiveFrom: "2026-09-07",
    effectiveTo: "2026-09-13",
    scoreTo: "2026-09-09",
  });
  assert.equal(weeklyGoalTargetDays(current!.effectiveFrom, current!.effectiveTo), 4);
});

test("student weekly score reuses reward-v1 caps and fixed 70/30 weights", () => {
  assert.equal(calculateStudentWeeklyScores({ effortActivityCount: 1, firstCorrectSenseCount: 0 }).weightedMilliPoints, 350);
  assert.equal(calculateStudentWeeklyScores({ effortActivityCount: 1, firstCorrectSenseCount: 1 }).weightedMilliPoints, 950);
  assert.equal(calculateStudentWeeklyScores({ effortActivityCount: 40, firstCorrectSenseCount: 8 }).weightedMilliPoints, 10_000);
});

test("weekly ranking excludes zero and pending rows, keeps competition ties, and calculates the chase gap", () => {
  const entries = rankWeeklyEntries([
    { studentId: "b", nickname: "B", scoreMilliPoints: 2_000, rankingState: "RANKED" },
    { studentId: "a", nickname: "A", scoreMilliPoints: 2_000, rankingState: "RANKED" },
    { studentId: "c", nickname: "C", scoreMilliPoints: 1_000, rankingState: "RANKED" },
    { studentId: "d", nickname: "D", scoreMilliPoints: 0, rankingState: "UNRANKED" },
    { studentId: "e", nickname: "E", scoreMilliPoints: 4_000, rankingState: "PENDING_REVIEW" },
  ]);
  assert.deepEqual(entries.map((entry) => [entry.studentId, entry.rank, entry.isTied]), [
    ["a", 1, true], ["b", 1, true], ["c", 3, false], ["e", null, false], ["d", null, false],
  ]);
  assert.equal(gapToNextWeeklyRank(entries, "c"), 1_000);
  assert.deepEqual(nearbyWeeklyEntries(entries, "c", 1).map((entry) => entry.studentId), ["b", "c", "e"]);
  assert.equal(gapToNextWeeklyRank(entries, "d"), null);
});
