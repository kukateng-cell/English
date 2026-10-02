import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogHistoryArrayChangeText,
  catalogHistoryComparable,
  catalogHistoryDate,
  catalogHistoryValueText,
} from "../../components/catalog/catalogHistoryPresentation";

test("history presentation compares arrays without treating order as content change", () => {
  assert.equal(
    catalogHistoryComparable(["beta", "alpha"]),
    catalogHistoryComparable(["alpha", "beta"]),
  );
});

test("history presentation explains array additions and removals", () => {
  assert.equal(
    catalogHistoryArrayChangeText(
      ["舊一", "保留"],
      ["保留", "新增一"],
      (value) => value,
    ),
    "新增：新增一；移除：舊一",
  );
});

test("history presentation localizes primitive values and Shanghai dates", () => {
  assert.equal(catalogHistoryValueText(true), "啟用");
  assert.equal(catalogHistoryValueText([]), "—");
  assert.match(catalogHistoryDate("2026-08-26T01:00:00.000Z"), /2026/);
});
