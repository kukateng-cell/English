import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateUnitStatRows,
  computeUnlocks,
  isLevel,
  isUnitCompleted,
  isUnitUnlockedByProgress,
  unitCategoryToStorage,
  UNIT_UNLOCK_RATIO,
} from "./units";

const stat = (mastered: number) => ({
  total: 10,
  learned: mastered,
  mastered,
  due: 0,
});

/** 已學過但全部答錯：learned 有數、mastered 為 0。 */
const learnedOnly = (learned: number, total = 10) => ({
  total,
  learned,
  mastered: 0,
  due: 0,
});

test("unlock chain cannot skip an incomplete earlier unit or level", () => {
  const result = computeUnlocks({
    A1: [
      { name: "one", stat: stat(0) },
      { name: "two", stat: stat(10) },
      { name: "three", stat: stat(10) },
    ],
    A2: [{ name: "legacy-complete", stat: stat(10) }],
    B1: [{ name: "must-stay-locked", stat: stat(0) }],
  });

  assert.equal(result.unitUnlock["A1::one"], true);
  assert.equal(result.unitUnlock["A1::two"], false);
  assert.equal(result.unitUnlock["A1::three"], false);
  assert.equal(result.levelUnlock.A2, false);
  assert.equal(result.levelUnlock.B1, false);
});

test("strict level predicate rejects mutation typos", () => {
  assert.equal(isLevel("B2"), true);
  assert.equal(isLevel("b2"), false);
  assert.equal(isLevel("B3"), false);
  assert.equal(isLevel(null), false);
});

test("the Traditional canonical and legacy Simplified uncategorized labels map to null", () => {
  assert.equal(unitCategoryToStorage("未分類"), null);
  assert.equal(unitCategoryToStorage("未分类"), null);
  assert.equal(unitCategoryToStorage("Family"), "Family");
});

test("database-aggregated unit rows retain unlock semantics", () => {
  const result = aggregateUnitStatRows([
    {
      level: "A1",
      category: "one",
      total: 10,
      learned: 9,
      mastered: 8,
      due: 2,
    },
    {
      level: "A1",
      category: "two",
      total: 10,
      learned: 0,
      mastered: 0,
      due: 0,
    },
  ]);
  assert.equal(result[0].units[0].completed, true);
  assert.equal(result[0].units[1].unlocked, true);
  assert.equal(result[0].units[0].due, 2);
  assert.equal(result[0].units[0].progress, 80);
});

// ── #94：解鎖改用「已學過」而非「已答對」 ──────────────────────────

test("learned ratio alone unlocks the next unit even when every answer was wrong", () => {
  const result = computeUnlocks({
    A1: [
      { name: "one", stat: learnedOnly(10) },
      { name: "two", stat: learnedOnly(0) },
      { name: "three", stat: learnedOnly(0) },
    ],
  });

  assert.equal(UNIT_UNLOCK_RATIO, 0.8);
  assert.equal(result.unitUnlock["A1::one"], true);
  // 第一單元 10/10 已學過但 0 個認字：舊規則會鎖住第二單元，新規則要解鎖。
  assert.equal(result.unitUnlock["A1::two"], true);
  assert.equal(result.unitUnlock["A1::three"], false);
});

test("exactly 80% learned already unlocks; below it stays locked", () => {
  const atThreshold = computeUnlocks({
    A1: [
      { name: "one", stat: learnedOnly(8, 10) },
      { name: "two", stat: learnedOnly(0) },
    ],
  });
  assert.equal(atThreshold.unitUnlock["A1::two"], true);

  const belowThreshold = computeUnlocks({
    A1: [
      { name: "one", stat: learnedOnly(79, 100) },
      { name: "two", stat: learnedOnly(0) },
    ],
  });
  assert.equal(belowThreshold.unitUnlock["A1::two"], false);
});

test("words that were never verified do not count towards unlock", () => {
  // 只做過 Learning Card、未完成初次驗證的詞沒有 Review，learned 仍然是 0。
  const result = computeUnlocks({
    A1: [
      { name: "one", stat: { total: 10, learned: 0, mastered: 0, due: 0 } },
      { name: "two", stat: learnedOnly(0) },
    ],
  });
  assert.equal(result.unitUnlock["A1::two"], false);
});

test("level unlock chain also uses learned so a weak learner is not stuck at A1", () => {
  const result = computeUnlocks({
    A1: [
      { name: "one", stat: learnedOnly(10) },
      { name: "two", stat: learnedOnly(10) },
    ],
    A2: [{ name: "next", stat: learnedOnly(0) }],
    B1: [{ name: "later", stat: learnedOnly(0) }],
  });

  assert.equal(result.levelUnlock.A1, true);
  assert.equal(result.levelUnlock.A2, true); // 全部單元已學過，即使 0 認字
  assert.equal(result.levelUnlock.B1, false);
  assert.equal(result.unitUnlock["A2::next"], true);
});

test("a level still needs every unit (not just one) above the unlock threshold", () => {
  const result = computeUnlocks({
    A1: [
      { name: "one", stat: learnedOnly(10) },
      { name: "two", stat: learnedOnly(7) },
    ],
    A2: [{ name: "next", stat: learnedOnly(0) }],
  });

  assert.equal(result.levelUnlock.A2, false);
  assert.equal(result.unitUnlock["A2::next"], false);
});

test("completed and recognized progress still require a correct answer", () => {
  assert.equal(isUnitUnlockedByProgress(10, 10), true);
  assert.equal(isUnitCompleted(10, 0), false);
  assert.equal(isUnitCompleted(10, 8), true);
  assert.equal(isUnitCompleted(0, 0), true, "空單元視為已完成，避免解鎖死鎖");
  assert.equal(isUnitUnlockedByProgress(0, 0), true, "空單元視為已達解鎖門檻");

  const result = aggregateUnitStatRows([
    {
      level: "A1",
      category: "all-learned-none-correct",
      total: 10,
      learned: 10,
      mastered: 0,
      due: 10,
    },
  ]);
  assert.equal(result[0].units[0].unlocked, true, "第一個單元恆開放");
  assert.equal(result[0].units[0].completed, false);
  assert.equal(result[0].units[0].progress, 0);
  assert.equal(result[0].units[0].learned, 10);
  assert.equal(result[0].completed, false, "級別完成仍然需要認字");
});

