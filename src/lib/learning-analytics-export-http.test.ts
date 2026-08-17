import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { mapAnalyticsExportError, serializeAnalyticsCsv, serializeAnalyticsXlsx, type AnalyticsExportResult } from "@/lib/learning-analytics-export-http";

function fixture(overrides: Partial<AnalyticsExportResult> = {}) {
  return {
    rows: [{ rowType: "STUDENT", periodStart: "2026-08-01", periodEnd: "2026-08-01", studentNumber: 1, accountName: "student-001", legalName: "=HYPERLINK(\"x\")", nickname: "小明", grade: "初一", classCode: "甲", classLabel: "初一甲", eligibleDayCount: 1, activeDayCount: 1, objectiveAccuracyStatus: "SMALL_SAMPLE", objectiveAccuracyPercent: 50 }],
    requestedRange: { fromDate: "2026-08-01", toDate: "2026-08-01" },
    effectiveRange: { from: "2026-08-01", to: "2026-08-01", rangeClamped: false },
    timezone: "Asia/Shanghai",
    cohortBasis: "CURRENT_MEMBERSHIP" as const,
    asOf: "2026-08-01T00:00:00.000Z",
    granularity: "DAY" as const,
    scope: "STUDENTS" as const,
    year: "=MALICIOUS_YEAR",
    rowCount: 1,
    ...overrides,
  } as unknown as AnalyticsExportResult;
}

test("analytics CSV is a golden-safe UTF-8 report with metadata and neutralized cells", () => {
  const csv = serializeAnalyticsCsv(fixture());
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /"計算口徑","按目前班級成員計算"/);
  assert.match(csv, /'=MALICIOUS_YEAR/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /學生/);
  assert.match(csv, /初一甲/);
  assert.match(csv, /目前學生數/);
  assert.doesNotMatch(csv, /,STUDENT,/);
  assert.doesNotMatch(csv, /SMALL_SAMPLE/);
});

test("analytics XLSX sanitizes metadata and data cells as typed text", async () => {
  const buffer = await serializeAnalyticsXlsx(fixture());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const summary = workbook.getWorksheet("摘要");
  const data = workbook.getWorksheet("學習分析");
  assert.ok(summary);
  assert.ok(data);
  assert.equal(summary?.getCell("B2").value, "'=MALICIOUS_YEAR");
  const headers = data?.getRow(1).values as unknown[];
  assert.equal(headers.includes("資料類型"), true);
  const dataValues = data?.getRow(2).values as unknown[];
  assert.equal(dataValues.includes("學生"), true);
  assert.equal(dataValues.includes("初一甲"), true);
  assert.equal(dataValues.includes("'=HYPERLINK(\"x\")"), true);
  assert.equal(dataValues.includes("樣本較少"), true);
});

test("analytics export route error contract keeps security and size statuses stable", () => {
  assert.deepEqual(mapAnalyticsExportError("RECENT_AUTH_REQUIRED"), { code: "RECENT_AUTH_REQUIRED", status: 401 });
  assert.deepEqual(mapAnalyticsExportError("ROLE_FORBIDDEN"), { code: "ROLE_FORBIDDEN", status: 403 });
  assert.deepEqual(mapAnalyticsExportError("STUDENT_NOT_FOUND"), { code: "STUDENT_NOT_FOUND", status: 404 });
  assert.deepEqual(mapAnalyticsExportError("ANALYTICS_SCOPE_STALE"), { code: "ANALYTICS_SCOPE_STALE", status: 409 });
  assert.deepEqual(mapAnalyticsExportError("EXPORT_TOO_LARGE"), { code: "EXPORT_TOO_LARGE", status: 413 });
  assert.deepEqual(mapAnalyticsExportError("QUERY_INVALID"), { code: "QUERY_INVALID", status: 422 });
  assert.deepEqual(mapAnalyticsExportError("AUDIT_BACKEND_UNAVAILABLE"), { code: "AUDIT_BACKEND_UNAVAILABLE", status: 503 });
  assert.deepEqual(mapAnalyticsExportError("unexpected"), { code: "EXPORT_FAILED", status: 500 });
});
