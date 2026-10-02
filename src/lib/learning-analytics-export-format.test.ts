import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_EXPORT_COLUMNS,
  analyticsExportMetadataRows,
  csvCell,
  friendlyExportValue,
  safeSpreadsheetText,
  spreadsheetValue,
} from "@/lib/learning-analytics-export-format";

test("learning analytics export keeps CSV values quoted and neutralizes formula-like text", () => {
    assert.equal(csvCell("a,b\"c"), '"a,b""c"');
    assert.equal(safeSpreadsheetText("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
    assert.equal(spreadsheetValue(12), 12);
    assert.equal(spreadsheetValue("-1+2"), "'-1+2");
  });

test("learning analytics export uses friendly Traditional Chinese labels instead of internal enums", () => {
    assert.equal(friendlyExportValue("rowType", "STUDENT"), "學生");
    assert.equal(friendlyExportValue("rowType", "UNASSIGNED"), "未分班");
    assert.equal(friendlyExportValue("objectiveAccuracyStatus", "SMALL_SAMPLE"), "樣本較少");
    assert.equal(ANALYTICS_EXPORT_COLUMNS.some(([key]) => key === "objectiveAccuracyStatus"), true);
    assert.deepEqual(ANALYTICS_EXPORT_COLUMNS.find(([key]) => key === "currentMemberCount"), ["currentMemberCount", "目前學生數"]);
    assert.deepEqual(ANALYTICS_EXPORT_COLUMNS.find(([key]) => key === "dueReviewCount"), ["dueReviewCount", "待複習詞數"]);
  });

test("learning analytics export includes scope, cohort, timezone and effective-range metadata", () => {
    const rows = analyticsExportMetadataRows({
      scope: "STUDENTS",
      year: "2025-2026",
      cohortBasis: "CURRENT_MEMBERSHIP",
      timezone: "Asia/Shanghai",
      requestedRange: { fromDate: "2026-01-01", toDate: "2026-01-31" },
      effectiveRange: { from: "2026-01-01", to: "2026-01-30", rangeClamped: true, calendarWarning: "CURRENT_YEAR_ENDED_NOT_ACTIVATED" },
      granularity: "MONTH",
      asOf: "2026-01-31T00:00:00.000Z",
    });
    assert.deepEqual(rows.find((row) => row[0] === "計算口徑"), ["計算口徑", "按目前班級成員計算"]);
    assert.deepEqual(rows.find((row) => row[0] === "時區"), ["時區", "Asia/Shanghai"]);
    assert.deepEqual(rows.find((row) => row[0] === "日期是否調整"), ["日期是否調整", "是"]);
    assert.deepEqual(rows.find((row) => row[0] === "學年提示"), ["學年提示", "目前學年已完結，下一個學年尚未啟用"]);
  });
