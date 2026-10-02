import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryByLevel,
  buildUnlockedWordScope,
  calculateLibraryProgress,
  capNextSession,
  classifyStudentWord,
} from "./student-metrics";

const now = new Date("2026-08-11T04:00:00.000Z");

test("next-session caps preserve the dynamic aggregate contract", () => {
  assert.deepEqual(capNextSession(31, 12), { dueCount: 20, newCount: 5, total: 25 });
  assert.deepEqual(capNextSession(0, 3), { dueCount: 0, newCount: 3, total: 3 });
});

test("word status uses the shared learned/mastered/due precedence", () => {
  assert.deepEqual(classifyStudentWord(null, now), { learned: false, mastered: false, status: "unseen" });
  assert.deepEqual(classifyStudentWord({ repetitions: 1, interval: 2, nextReviewDate: new Date("2026-08-12T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: true, mastered: false, status: "learning" });
  assert.deepEqual(classifyStudentWord({ repetitions: 0, interval: 0, nextReviewDate: new Date("2026-08-10T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: false, mastered: false, status: "due" });
  assert.deepEqual(classifyStudentWord({ repetitions: 4, interval: 22, nextReviewDate: new Date("2026-08-10T00:00:00.000Z"), lastReviewedAt: now }, now), { learned: true, mastered: true, status: "mastered" });
});

test("library progress uses a zero-safe percentage for each visible scope", () => {
  assert.deepEqual(calculateLibraryProgress(12, 5, 2), {
    totalWords: 12,
    learnedCount: 5,
    learnedRate: 42,
    masteredCount: 2,
    mastery: 17,
  });
  assert.deepEqual(calculateLibraryProgress(0, 0, 0), {
    totalWords: 0,
    learnedCount: 0,
    learnedRate: 0,
    masteredCount: 0,
    mastery: 0,
  });
});

function progressLevel(level: string, unlockedUnits: boolean[]) {
  return {
    level,
    unlocked: unlockedUnits.some(Boolean),
    completed: false,
    progress: 0,
    units: unlockedUnits.map((unlocked, index) => ({
      name: `unit-${index + 1}`,
      total: 10,
      learned: 0,
      mastered: 0,
      due: 0,
      progress: 0,
      completed: false,
      unlocked,
    })),
  };
}

test("unlocked word scope derives level badges from unit progress rather than Prisma filters", () => {
  const scope = buildUnlockedWordScope([
    progressLevel("A1", [true, false]),
    progressLevel("A2", [false, false]),
    progressLevel("B1", [false]),
    progressLevel("B2", [false]),
  ]);
  assert.equal(scope.filters.length, 1);
  assert.deepEqual([...scope.unlockedLevels], ["A1"]);
});

test("a level remains unlocked when any one of its units is visible", () => {
  const scope = buildUnlockedWordScope([
    progressLevel("A1", [false, true]),
    progressLevel("A2", [false]),
  ]);
  assert.equal(scope.unlockedLevels.has("A1"), true);
  assert.equal(scope.unlockedLevels.has("A2"), false);
});

test("no visible units leaves every level locked", () => {
  const scope = buildUnlockedWordScope([
    progressLevel("A1", [false]),
    progressLevel("A2", [false]),
    progressLevel("B1", [false]),
    progressLevel("B2", [false]),
  ]);
  assert.equal(scope.filters.length, 0);
  assert.equal(scope.unlockedLevels.size, 0);
});

test("database level aggregates map to all four level rows without loading word objects", () => {
  assert.deepEqual(
    buildLibraryByLevel(
      [
        { level: "A1", totalWords: 355, learnedCount: 120, masteredCount: 40 },
        { level: "A2", totalWords: 1447, learnedCount: 3, masteredCount: 0 },
      ],
      new Set(["A1"]),
    ),
    [
      { level: "A1", unlocked: true, totalWords: 355, learnedCount: 120, learnedRate: 34, masteredCount: 40, mastery: 11 },
      { level: "A2", unlocked: false, totalWords: 1447, learnedCount: 3, learnedRate: 0, masteredCount: 0, mastery: 0 },
      { level: "B1", unlocked: false, totalWords: 0, learnedCount: 0, learnedRate: 0, masteredCount: 0, mastery: 0 },
      { level: "B2", unlocked: false, totalWords: 0, learnedCount: 0, learnedRate: 0, masteredCount: 0, mastery: 0 },
    ],
  );
});
