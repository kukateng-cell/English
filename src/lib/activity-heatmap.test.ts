import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityHeatmap } from "./activity-heatmap";

test("activity heatmap keeps seven weekday rows and aligns the first day", () => {
  const heatmap = buildActivityHeatmap([
    { day: "2026-08-03", count: 0 },
    { day: "2026-08-04", count: 4 },
    { day: "2026-08-05", count: 2 },
  ]);

  assert.equal(heatmap.columnCount, 1);
  assert.equal(heatmap.cells.length, 7);
  assert.equal(heatmap.cells[0].placeholder, true);
  assert.deepEqual(heatmap.cells.slice(1, 4).map((cell) => [cell.day, cell.count, cell.level]), [
    ["2026-08-03", 0, 0],
    ["2026-08-04", 4, 4],
    ["2026-08-05", 2, 2],
  ]);
  assert.equal(heatmap.cells[4].placeholder, true);
});

test("empty activity still returns a seven-cell placeholder column", () => {
  const heatmap = buildActivityHeatmap([]);
  assert.equal(heatmap.columnCount, 1);
  assert.equal(heatmap.maxCount, 0);
  assert.equal(heatmap.cells.every((cell) => cell.placeholder), true);
});
