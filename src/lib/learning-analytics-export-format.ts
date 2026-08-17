export const ANALYTICS_EXPORT_COLUMNS = [
  ["rowType", "資料類型"], ["periodStart", "時段開始"], ["periodEnd", "時段結束"],
  ["studentNumber", "學號"], ["accountName", "學生證"], ["legalName", "真名"], ["nickname", "暱稱"],
  ["grade", "年級"], ["classCode", "班別"], ["classLabel", "班級"], ["currentMemberCount", "目前學生數"], ["eligibleStudentCount", "符合計算學生數"],
  ["activeStudentCount", "活躍學生數"], ["activeRate", "活躍率"], ["eligibleDayCount", "符合計算日數"], ["activeDayCount", "活躍日數"], ["studyDays", "學習日"],
  ["learningEncounterCount", "練習次數"], ["medianLearningEncounters", "每生練習中位數"], ["effectiveReviewCount", "有效評測"],
  ["objectiveCorrectCount", "客觀答對"], ["objectiveAttemptCount", "客觀有效嘗試"], ["objectiveAccuracyPercent", "客觀正確率"],
  ["objectiveAccuracyStatus", "正確率樣本狀態"], ["objectiveExcludedCount", "排除客觀評測"], ["masteryMeanPercent", "平均掌握率"],
  ["masteryMedianPercent", "掌握率中位數"], ["dueReviewCount", "待複習詞數"], ["dueStudentCount", "待複習學生"], ["dueRate", "待複習率"],
] as const;

export type AnalyticsExportColumn = typeof ANALYTICS_EXPORT_COLUMNS[number][0];

const VALUE_LABELS: Partial<Record<AnalyticsExportColumn, Record<string, string>>> = {
  rowType: { STUDENT: "學生", CLASS: "班級", UNASSIGNED: "未分班" },
  objectiveAccuracyStatus: { NO_DATA: "沒有資料", SMALL_SAMPLE: "樣本較少", SUFFICIENT: "樣本足夠" },
};

export function friendlyExportValue(column: string, value: unknown): unknown {
  if (value === null || value === undefined) return "";
  const labels = VALUE_LABELS[column as AnalyticsExportColumn];
  return labels?.[String(value)] ?? value;
}

export function safeSpreadsheetText(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
}

export function spreadsheetValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : safeSpreadsheetText(value);
}

/** Conservative preflight estimate used before building an in-memory export. */
export function estimateAnalyticsExportBytes(metadataRows: string[][], rows: Array<Record<string, unknown>>, columnCount: number) {
  const encoder = new TextEncoder();
  const metadataBytes = metadataRows.reduce<number>((total, row) => total + row.reduce<number>((rowTotal, value) => rowTotal + encoder.encode(String(value)).byteLength + 4, 0), 0);
  const rowBytes = rows.reduce<number>((total, row) => total + Object.values(row).reduce<number>((rowTotal, value) => rowTotal + encoder.encode(String(value ?? "")).byteLength + 4, 0) + columnCount * 4, 0);
  // XLSX/CSV escaping, ZIP/XML overhead and the UTF-8 BOM are deliberately
  // covered by this margin. The post-serialization check remains the final
  // guard for the exact representation.
  return Math.ceil((metadataBytes + rowBytes + 2048) * 1.5);
}

export function csvCell(value: unknown) {
  const text = safeSpreadsheetText(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export type AnalyticsExportMetadata = {
  scope: string;
  year: string;
  cohortBasis: string;
  timezone: string;
  requestedRange: { fromDate: string; toDate: string };
  effectiveRange: { from: string; to: string; rangeClamped: boolean; calendarWarning?: string };
  granularity: string;
  asOf: string;
};

export function analyticsExportMetadataRows(metadata: AnalyticsExportMetadata): string[][] {
  return [
    ["報告範圍", metadata.scope === "STUDENTS" ? "學生" : metadata.scope === "CLASSES" ? "班級" : metadata.scope],
    ["學年", metadata.year],
    ["計算口徑", metadata.cohortBasis === "CURRENT_MEMBERSHIP" ? "按目前班級成員計算" : metadata.cohortBasis],
    ["時區", metadata.timezone],
    ["要求日期", `${metadata.requestedRange.fromDate} 至 ${metadata.requestedRange.toDate}`],
    ["實際日期", `${metadata.effectiveRange.from} 至 ${metadata.effectiveRange.to}`],
    ["日期是否調整", metadata.effectiveRange.rangeClamped ? "是" : "否"],
    ["學年提示", metadata.effectiveRange.calendarWarning === "CURRENT_YEAR_ENDED_NOT_ACTIVATED" ? "目前學年已完結，下一個學年尚未啟用" : metadata.effectiveRange.calendarWarning ?? "—"],
    ["時間單位", metadata.granularity === "DAY" ? "每日" : metadata.granularity === "WEEK" ? "每週" : "每月"],
    ["資料時間點", metadata.asOf],
  ];
}
