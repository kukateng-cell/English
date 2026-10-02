import ExcelJS from "exceljs";
import { analyticsExportMetadataRows, ANALYTICS_EXPORT_COLUMNS as columns, csvCell, estimateAnalyticsExportBytes, friendlyExportValue, spreadsheetValue } from "@/lib/learning-analytics-export-format";
import type { exportLearningAnalytics } from "@/lib/learning-analytics";

export type AnalyticsExportResult = Awaited<ReturnType<typeof exportLearningAnalytics>>;
export const MAX_ANALYTICS_EXPORT_BYTES = 16 * 1024 * 1024;

export function mapAnalyticsExportError(code: string) {
  const status = code === "PAYLOAD_TOO_LARGE" || code === "EXPORT_TOO_LARGE" || code === "ANALYTICS_SCOPE_TOO_LARGE" ? 413
    : ["CLASS_NOT_FOUND", "STUDENT_NOT_FOUND"].includes(code) ? 404
      : ["QUERY_INVALID", "RANGE_OUTSIDE_CURRENT_YEAR"].includes(code) ? 422
        : code === "ANALYTICS_SCOPE_STALE" ? 409
          : ["CURRENT_YEAR_UNAVAILABLE", "AUDIT_BACKEND_UNAVAILABLE", "AUTH_BACKEND_UNAVAILABLE"].includes(code) ? 503
            : code === "ROLE_FORBIDDEN" ? 403
              : ["AUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(code) ? 401
                : 500;
  return { status, code: status === 500 ? "EXPORT_FAILED" : code };
}

function metadata(result: AnalyticsExportResult) {
  return analyticsExportMetadataRows(result);
}

function assertEstimatedSize(result: AnalyticsExportResult) {
  if (estimateAnalyticsExportBytes(metadata(result), result.rows, columns.length) > MAX_ANALYTICS_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
}

export function serializeAnalyticsCsv(result: AnalyticsExportResult) {
  assertEstimatedSize(result);
  const rows = [...metadata(result), columns.map(([, label]) => label), ...result.rows.map((row) => columns.map(([column]) => friendlyExportValue(column, row[column])))];
  const text = `\uFEFF${rows.map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
  if (Buffer.byteLength(text, "utf8") > MAX_ANALYTICS_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return text;
}

export async function serializeAnalyticsXlsx(result: AnalyticsExportResult) {
  assertEstimatedSize(result);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "English Vocabulary Learning Analytics";
  const summary = workbook.addWorksheet("摘要");
  summary.addRows(metadata(result).concat([["資料列數", String(result.rowCount)]]).map((row) => row.map((value) => spreadsheetValue(value))));
  summary.getColumn(1).width = 18;
  summary.getColumn(2).width = 42;
  const sheet = workbook.addWorksheet("學習分析", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([column, label]) => ({ header: label, key: column, width: Math.max(14, label.length + 4) }));
  for (const row of result.rows) sheet.addRow(Object.fromEntries(columns.map(([column]) => [column, spreadsheetValue(friendlyExportValue(column, row[column]))])));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, result.rows.length + 1), column: columns.length } };
  const buffer = await workbook.xlsx.writeBuffer();
  if (buffer.byteLength > MAX_ANALYTICS_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return new Uint8Array(buffer);
}
