import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseDefaultLeaderboardScope,
  countLeaderboardStreak,
  isLeaderboardScope,
  rankLeaderboardEntries,
  trimLeaderboardEntries,
} from "./leaderboard";
import { offsetDay, todayKey } from "./streak";

test("leaderboard scope parser only accepts the three public scopes", () => {
  assert.equal(isLeaderboardScope("class"), true);
  assert.equal(isLeaderboardScope("grade"), true);
  assert.equal(isLeaderboardScope("school"), true);
  assert.equal(isLeaderboardScope("other"), false);
});

test("default leaderboard scope prefers class, then grade, then school", () => {
  assert.equal(chooseDefaultLeaderboardScope({ classId: "class-1", grade: "JUNIOR_1" }), "class");
  assert.equal(chooseDefaultLeaderboardScope({ classId: null, grade: "JUNIOR_1" }), "grade");
  assert.equal(chooseDefaultLeaderboardScope({ classId: null, grade: null }), "school");
});

test("leaderboard ranks keep competition rank and stable same-value ordering", () => {
  const entries = rankLeaderboardEntries([
    { userId: "student-b", name: "B", value: 4 },
    { userId: "student-c", name: "C", value: 2 },
    { userId: "student-a", name: "A", value: 4 },
  ], "student-b");

  assert.deepEqual(entries.map((entry) => [entry.userId, entry.rank, entry.isMe]), [
    ["student-a", 1, false],
    ["student-b", 1, true],
    ["student-c", 3, false],
  ]);
});

test("top twenty keeps the current student even when they are outside the top", () => {
  const ranked = rankLeaderboardEntries(
    Array.from({ length: 22 }, (_, index) => ({
      userId: `student-${String(index + 1).padStart(2, "0")}`,
      name: `Student ${index + 1}`,
      value: 22 - index,
    })),
    "student-22",
  );
  const visible = trimLeaderboardEntries(ranked);

  assert.equal(visible.length, 21);
  assert.equal(visible.at(-1)?.userId, "student-22");
  assert.equal(visible.at(-1)?.rank, 22);
});

test("scored streak counts today or yesterday and stops at the first gap", () => {
  const today = todayKey();
  const yesterday = offsetDay(today, -1);
  const twoDaysAgo = offsetDay(today, -2);
  const fourDaysAgo = offsetDay(today, -4);
  assert.equal(countLeaderboardStreak(new Set([today, yesterday, twoDaysAgo, fourDaysAgo])), 3);
  assert.equal(countLeaderboardStreak(new Set([yesterday, twoDaysAgo])), 2);
  assert.equal(countLeaderboardStreak(new Set([fourDaysAgo])), 0);
});
