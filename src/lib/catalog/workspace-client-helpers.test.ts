import assert from "node:assert/strict";
import test from "node:test";
import {
  listText,
  normalizeCatalogClientText,
  parseList,
  retryConflictValueText,
} from "./workspace-client-helpers";

test("catalog client text uses stable Unicode and case normalization", () => {
  assert.equal(normalizeCatalogClientText("  Ｒｕｎ\n  FAST  "), "run fast");
});

test("catalog list helpers preserve values while removing blank entries", () => {
  assert.deepEqual(parseList(" 一 |  |二\t|三 "), ["一", "二", "三"]);
  assert.equal(listText(["一", "二"]), "一 | 二");
  assert.equal(listText(null), "");
});

test("retry conflict values use localized labels for empty and boolean values", () => {
  const tc = (value: string) => `tc:${value}`;
  assert.equal(retryConflictValueText(null, tc), "tc:（空白）");
  assert.equal(retryConflictValueText([], tc), "tc:（空白）");
  assert.equal(retryConflictValueText(true, tc), "tc:啟用");
  assert.equal(retryConflictValueText(["a", "b"], tc), "a | b");
});
