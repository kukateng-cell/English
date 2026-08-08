import test from "node:test";
import assert from "node:assert/strict";
import { computeUnlocks, isLevel, unitCategoryToStorage } from "./units";

const stat = (mastered: number) => ({
  total: 10,
  learned: mastered,
  mastered,
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
  assert.equal(isLevel("b2"), true);
  assert.equal(isLevel("B3"), false);
  assert.equal(isLevel(null), false);
});

test("the 未分类 route label maps back to a null database category", () => {
  assert.equal(unitCategoryToStorage("未分类"), null);
  assert.equal(unitCategoryToStorage("Family"), "Family");
});
