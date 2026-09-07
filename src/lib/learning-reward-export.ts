import ExcelJS from "exceljs";
import { csvCell, safeSpreadsheetText, spreadsheetValue } from "@/lib/learning-analytics-export-format";
import type { RewardCoverage, RewardDay, RewardExportResult, RewardStudentTotal } from "@/lib/learning-reward-analytics";
import { formatRewardMilliPoints } from "@/lib/learning-reward-policy";

export const MAX_REWARD_EXPORT_BYTES = 32 * 1024 * 1024;

export const REWARD_SUMMARY_COLUMNS = [
  ["classLabel", "班級"],
  ["studentNumber", "學號"],
  ["name", "姓名"],
  ["accountName", "學生帳號"],
  ["effortScore", "累積投入分"],
  ["outcomeScore", "累積成效分"],
  ["weightedScore", "累積總分"],
  ["note", "備註"],
] as const;

export const REWARD_DAILY_COLUMNS = [
  ["classLabel", "班級"],
  ["studentNumber", "學號"],
  ["name", "姓名"],
  ["accountName", "學生帳號"],
  ["date", "日期"],
  ["effortScore", "當日投入分"],
  ["outcomeScore", "當日成效分"],
  ["weightedScore", "當日總分"],
  ["note", "備註"],
] as const;

type ExportColumn = readonly [string, string];

function displayName(total: RewardStudentTotal) {
  return total.legalName.trim() || total.nickname.trim() || total.accountName;
}

function candidateCount(coverage: RewardCoverage) {
  return coverage.sources.encounters.candidateCount + coverage.sources.reviews.candidateCount;
}

/** Keep technical provenance out of the normal teacher table while surfacing real data problems. */
export function rewardStudentNote(total: RewardStudentTotal) {
  if (total.eligibleDayCount === 0) return "此期間未在籍";
  if (total.coverage.validationGapCount > 0 || total.coverage.historyCoverage === "KNOWN_GAP") return "部分紀錄未能核對，分數可能受影響";
  if (total.coverage.policyExcludedCount > 0) return "部分活動不計入本次分數";
  if (candidateCount(total.coverage) === 0) return "這段期間未有可計分的學習紀錄";
  return "";
}

function rewardDayNote(day: RewardDay) {
  if (!day.eligible) return "此期間未在籍";
  if (day.coverage.validationGapCount > 0 || day.coverage.historyCoverage === "KNOWN_GAP") return "部分紀錄未能核對，分數可能受影響";
  if (day.coverage.policyExcludedCount > 0) return "部分活動不計入本次分數";
  if (candidateCount(day.coverage) === 0) return "這段期間未有可計分的學習紀錄";
  return "";
}

function scoreValue(value: number | null | undefined) {
  return formatRewardMilliPoints(value ?? null);
}

function formatAsOfShanghai(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-Hant", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}年${part("month")}月${part("day")}日 ${part("hour")}:${part("minute")}（上海時間）`;
}

function summaryRow(total: RewardStudentTotal) {
  return {
    classLabel: total.classLabel,
    studentNumber: total.studentNumber,
    name: displayName(total),
    accountName: total.accountName,
    effortScore: scoreValue(total.scores?.effortMilliPoints),
    outcomeScore: scoreValue(total.scores?.outcomeMilliPoints),
    weightedScore: scoreValue(total.scores?.weightedMilliPoints),
    note: rewardStudentNote(total),
  };
}

function dailyRow(day: RewardDay, total: RewardStudentTotal) {
  return {
    classLabel: total.classLabel,
    studentNumber: total.studentNumber,
    name: displayName(total),
    accountName: total.accountName,
    date: day.date,
    effortScore: scoreValue(day.scores?.effortMilliPoints),
    outcomeScore: scoreValue(day.scores?.outcomeMilliPoints),
    weightedScore: scoreValue(day.scores?.weightedMilliPoints),
    note: rewardDayNote(day),
  };
}

function metadataRows(result: RewardExportResult): Array<[string, string]> {
  const coverage = result.coverageSummary.combined;
  const warning = coverage.validationGapCount > 0 || coverage.historyCoverage === "KNOWN_GAP"
    ? "部分學生有未能計入的紀錄，分數可能受影響"
    : coverage.policyExcludedCount > 0
      ? "部分活動不計入本次分數"
      : "按目前保存的學習紀錄計算";
  const classLabels = [...new Set(result.totals.map((total) => total.classLabel).filter(Boolean))];
  const rangeNote = result.effectiveRange.rangeClamped
    ? `；日期已按學年調整為 ${result.effectiveRange.from} 至 ${result.effectiveRange.to}`
    : "";
  return [
    ["報告名稱", "學生累積分"],
    ["學年／期間", `${result.academicYear.label} · ${result.effectiveRange.from} 至 ${result.effectiveRange.to}`],
    ["班級／人數", `${classLabels.join("、") || "目前授權範圍"} · ${result.totals.length} 名學生`],
    ["權重／資料截點", `投入 ${result.policy.weights.effort}%、成效 ${result.policy.weights.outcome}% · ${formatAsOfShanghai(result.asOf)}${rangeNote}`],
    ["計分說明", "投入分、成效分為加權前累積；總分按目前權重計算。"],
    ["資料提示", warning],
  ];
}

function rowValues(row: Record<string, unknown>, columns: readonly ExportColumn[]) {
  return columns.map(([key]) => row[key]);
}

function safeCellValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return spreadsheetValue(value);
}

function assertModelSize(result: RewardExportResult, rows: Array<Record<string, unknown>>, columns: readonly ExportColumn[]) {
  let modelBytes = 0;
  const countRow = (values: unknown[]) => {
    for (const value of values) {
      modelBytes += 256 + (typeof value === "string" ? value.length * 2 : 0);
      if (modelBytes > 256 * 1024 * 1024) throw new Error("EXPORT_TOO_LARGE");
    }
  };
  for (const metadata of metadataRows(result)) countRow(metadata);
  countRow(columns.map(([, label]) => label));
  for (const row of rows) countRow(rowValues(row, columns));
}

function addMetadata(sheet: ExcelJS.Worksheet, result: RewardExportResult, columns: readonly ExportColumn[]) {
  for (const row of metadataRows(result)) {
    sheet.addRow([safeCellValue(row[0]), safeCellValue(row[1])]);
    const rowNumber = sheet.rowCount;
    if (columns.length > 2) sheet.mergeCells(rowNumber, 2, rowNumber, columns.length);
    sheet.getRow(rowNumber).height = row[1].length > 70 ? 36 : 22;
    sheet.getRow(rowNumber).alignment = { vertical: "top", wrapText: true };
    sheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: "FF4F46E5" } };
    sheet.getCell(rowNumber, 2).alignment = { vertical: "top", wrapText: true };
  }
  sheet.addRow([]);
  const headerRow = sheet.rowCount + 1;
  sheet.addRow(columns.map(([, label]) => label));
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  return headerRow;
}

function configureSheet(sheet: ExcelJS.Worksheet, headerRow: number, columns: readonly ExportColumn[], rowCount: number) {
  sheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: 4 }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, headerRow + rowCount), column: columns.length } };
  columns.forEach(([key], index) => {
    const width = key === "classLabel" ? 18
      : key === "studentNumber" ? 12
        : key === "name" ? 22
          : key === "accountName" ? 30
            : key === "note" ? 38
              : 16;
    sheet.getColumn(index + 1).width = width;
    sheet.getColumn(index + 1).alignment = { vertical: "top", wrapText: key === "name" || key === "accountName" || key === "note" };
    if (key.endsWith("Score")) sheet.getColumn(index + 1).numFmt = "0.000";
  });
  for (let row = headerRow + 1; row <= headerRow + rowCount; row += 1) {
    sheet.getRow(row).eachCell((cell, column) => {
      if (columns[column - 1]?.[0].endsWith("Score")) cell.alignment = { horizontal: "right", vertical: "top" };
      else if (columns[column - 1]?.[0] === "note") cell.alignment = { wrapText: true, vertical: "top" };
    });
  }
}

function appendCsvRow(lines: string[], values: unknown[], state: { bytes: number }) {
  const line = values.map((value) => csvCell(value)).join(",");
  state.bytes += Buffer.byteLength(line, "utf8") + (lines.length ? 2 : 0);
  if (state.bytes > MAX_REWARD_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  lines.push(line);
}

export function serializeLearningRewardCsv(result: RewardExportResult) {
  const lines: string[] = [];
  const state = { bytes: Buffer.byteLength("\uFEFF", "utf8") };
  appendCsvRow(lines, REWARD_SUMMARY_COLUMNS.map(([, label]) => label), state);
  for (const total of result.totals) {
    const row = summaryRow(total);
    appendCsvRow(lines, REWARD_SUMMARY_COLUMNS.map(([key]) => {
      if (key.endsWith("Score")) {
        const value = row[key as "effortScore" | "outcomeScore" | "weightedScore"];
        return typeof value === "number" ? value.toFixed(3) : "";
      }
      return row[key as keyof typeof row];
    }), state);
  }
  return "\uFEFF" + lines.join("\r\n");
}

async function serializeRewardWorkbook(result: RewardExportResult, mode: "SUMMARY" | "DAILY") {
  const totals = result.totals.map(summaryRow);
  const totalById = new Map(result.totals.map((total) => [total.studentId, total]));
  const rows = mode === "SUMMARY"
    ? totals
    : result.days.map((day) => {
      const total = totalById.get(day.studentId);
      if (!total) throw new Error("EXPORT_FAILED");
      return dailyRow(day, total);
    });
  const columns = mode === "SUMMARY" ? REWARD_SUMMARY_COLUMNS : REWARD_DAILY_COLUMNS;
  assertModelSize(result, rows, columns);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "English Vocabulary Learning Analytics";
  const sheet = workbook.addWorksheet(mode === "SUMMARY" ? "學生累積分" : "每日分數");
  const headerRow = addMetadata(sheet, result, columns);
  for (const row of rows) sheet.addRow(rowValues(row, columns).map(safeCellValue));
  configureSheet(sheet, headerRow, columns, rows.length);
  if (mode === "SUMMARY") {
    for (let row = headerRow + 1; row <= headerRow + rows.length; row += 1) {
      const scoreCell = sheet.getCell(row, 7);
      scoreCell.font = { bold: true, color: { argb: "FF3730A3" } };
      scoreCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  if (buffer.byteLength > MAX_REWARD_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return new Uint8Array(buffer);
}

export function serializeLearningRewardXlsx(result: RewardExportResult) {
  return serializeRewardWorkbook(result, "SUMMARY");
}

export function serializeLearningRewardDailyXlsx(result: RewardExportResult) {
  return serializeRewardWorkbook(result, "DAILY");
}

export function rewardExportColumnsForTests() {
  return { summary: REWARD_SUMMARY_COLUMNS, daily: REWARD_DAILY_COLUMNS };
}

// Exposed for focused serializer tests; identity text still uses the shared
// formula-injection guard before reaching ExcelJS/CSV.
export function safeRewardIdentity(value: unknown) {
  return safeSpreadsheetText(value);
}
