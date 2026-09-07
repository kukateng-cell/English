import ExcelJS from "exceljs";
import { csvCell, spreadsheetValue } from "@/lib/learning-analytics-export-format";
import type { RewardCoverage, RewardDay, RewardExportResult, RewardStudentTotal } from "@/lib/learning-reward-analytics";
import { formatRewardMilliPoints } from "@/lib/learning-reward-policy";

export const MAX_REWARD_EXPORT_BYTES = 32 * 1024 * 1024;

const SCORE_COLUMNS = [
  ["effortScore", "投入分"],
  ["outcomeScore", "成效分"],
  ["effortContribution", "投入加權貢獻"],
  ["outcomeContribution", "成效加權貢獻"],
  ["weightedScore", "加權總分"],
] as const;

const COVERAGE_COLUMNS = [
  ["candidateCount", "候選數"],
  ["outsideEligibility", "入籍前排除"],
  ["policyExcluded", "政策排除"],
  ["unsupportedVersion", "不支援版本"],
  ["missingIdentityOrProvenance", "身份／來源缺漏"],
  ["nonWinningOrInvalidOutcome", "非勝出／無效結果"],
  ["included", "納入計算"],
] as const;

const IDENTITY_COLUMNS = [
  ["studentId", "學生 ID"],
  ["studentNumber", "學號"],
  ["accountName", "學生帳號"],
  ["legalName", "姓名"],
  ["nickname", "暱稱"],
  ["grade", "年級"],
  ["classLabel", "班級"],
] as const;

const LEVEL_COLUMNS = [
  ["A1Attempts", "A1 作答"], ["A1Correct", "A1 答對"],
  ["A2Attempts", "A2 作答"], ["A2Correct", "A2 答對"],
  ["B1Attempts", "B1 作答"], ["B1Correct", "B1 答對"],
  ["B2Attempts", "B2 作答"], ["B2Correct", "B2 答對"],
] as const;

const TOTAL_COLUMNS = [
  ...IDENTITY_COLUMNS,
  ["eligibleFrom", "合資格開始日"],
  ["eligibleDayCount", "合資格日數"],
  ["activeDayCount", "活躍日數"],
  ["learningCardCount", "Learning Card 數"],
  ["objectiveAttemptCount", "客觀作答數"],
  ["objectiveCorrectCount", "客觀答對數"],
  ["effortActivityCount", "原始投入活動數"],
  ["creditedEffortActivityCount", "計入投入活動數"],
  ["firstCorrectSenseDayCount", "原始首次答對詞義日數"],
  ["creditedFirstCorrectSenseDayCount", "計入首次答對詞義日數"],
  ["distinctSenseCount", "期間不同詞義數"],
  ...LEVEL_COLUMNS,
  ["objectiveAccuracyPercent", "客觀正確率"],
  ["accuracyStatus", "正確率樣本狀態"],
  ["effortCapDays", "投入封頂日數"],
  ["outcomeCapDays", "成效封頂日數"],
  ["effortCapDayPercent", "期內投入封頂日比例"],
  ["outcomeCapDayPercent", "期內成效封頂日比例"],
  ...SCORE_COLUMNS,
  ["coverageValidationStatus", "資料核對狀態"],
  ["historyCoverage", "歷史覆蓋狀態"],
  ["policyExcludedCount", "政策排除總數"],
  ["validationGapCount", "資料待核對總數"],
  ["studyDayMismatchCount", "StudyDay 不一致數"],
  ["coverageWarnings", "資料提示"],
  ...COVERAGE_COLUMNS.flatMap(([key, label]) => [[`encounters_${key}`, `認字卡_${label}`], [`reviews_${key}`, `客觀題_${label}`]] as const),
] as const;

const DAY_COLUMNS = [
  ...IDENTITY_COLUMNS,
  ["date", "日期"],
  ["eligible", "合資格"],
  ["learningCardCount", "Learning Card 數"],
  ["objectiveAttemptCount", "客觀作答數"],
  ["objectiveCorrectCount", "客觀答對數"],
  ["effortActivityCount", "原始投入活動數"],
  ["creditedEffortActivityCount", "計入投入活動數"],
  ["firstCorrectSenseCount", "原始首次答對詞義數"],
  ["creditedFirstCorrectSenseCount", "計入首次答對詞義數"],
  ["distinctSenseCount", "不同詞義數"],
  ...LEVEL_COLUMNS,
  ["objectiveAccuracyPercent", "客觀正確率"],
  ["accuracyStatus", "正確率樣本狀態"],
  ["effortCapReached", "投入封頂"],
  ["outcomeCapReached", "成效封頂"],
  ...SCORE_COLUMNS,
  ["cumulativeEffortScore", "截至當日投入累積"],
  ["cumulativeOutcomeScore", "截至當日成效累積"],
  ["cumulativeEffortContribution", "截至當日投入加權累積"],
  ["cumulativeOutcomeContribution", "截至當日成效加權累積"],
  ["cumulativeWeightedScore", "截至當日加權總累積"],
  ["coverageValidationStatus", "資料核對狀態"],
  ["historyCoverage", "歷史覆蓋狀態"],
  ["policyExcludedCount", "政策排除總數"],
  ["validationGapCount", "資料待核對總數"],
  ["studyDayMismatchCount", "StudyDay 不一致數"],
  ["coverageWarnings", "資料提示"],
  ...COVERAGE_COLUMNS.flatMap(([key, label]) => [[`encounters_${key}`, `認字卡_${label}`], [`reviews_${key}`, `客觀題_${label}`]] as const),
] as const;

const CSV_DATA_COLUMNS = [...new Set([...TOTAL_COLUMNS, ...DAY_COLUMNS].map(([key]) => key))];

const SCORE_VALUE_KEYS = new Set([
  "effortScore", "outcomeScore", "effortContribution", "outcomeContribution", "weightedScore",
  "cumulativeEffortScore", "cumulativeOutcomeScore", "cumulativeEffortContribution", "cumulativeOutcomeContribution", "cumulativeWeightedScore",
]);

const CSV_TYPED_VALUE_KEYS = new Set(["rowType", "accuracyStatus", "coverageValidationStatus", "historyCoverage"]);

function scoreValues(prefix: string, scores: RewardStudentTotal["scores"] | RewardDay["scores"] | RewardDay["cumulative"]) {
  const key = (lower: string, upper: string) => prefix ? `${prefix}${upper}` : lower;
  return {
    [key("effortScore", "EffortScore")]: formatRewardMilliPoints(scores?.effortMilliPoints ?? null),
    [key("outcomeScore", "OutcomeScore")]: formatRewardMilliPoints(scores?.outcomeMilliPoints ?? null),
    [key("effortContribution", "EffortContribution")]: formatRewardMilliPoints(scores?.effortContributionMilliPoints ?? null),
    [key("outcomeContribution", "OutcomeContribution")]: formatRewardMilliPoints(scores?.outcomeContributionMilliPoints ?? null),
    [key("weightedScore", "WeightedScore")]: formatRewardMilliPoints(scores?.weightedMilliPoints ?? null),
  };
}

function coverageValues(coverage: RewardCoverage) {
  const values: Record<string, unknown> = {
    coverageValidationStatus: coverage.validationStatus,
    historyCoverage: coverage.historyCoverage,
    policyExcludedCount: coverage.policyExcludedCount,
    validationGapCount: coverage.validationGapCount,
    studyDayMismatchCount: coverage.studyDayMismatchCount,
    coverageWarnings: coverage.warningCodes.join(" | "),
  };
  for (const [sourceKey, source] of [["encounters", coverage.sources.encounters], ["reviews", coverage.sources.reviews]] as const) {
    for (const [key] of COVERAGE_COLUMNS) values[`${sourceKey}_${key}`] = source[key as keyof typeof source];
  }
  return values;
}

function levelValues(levelCounts: RewardStudentTotal["levelCounts"] | RewardDay["levelCounts"]) {
  return {
    A1Attempts: levelCounts?.A1.attempts ?? null,
    A1Correct: levelCounts?.A1.correct ?? null,
    A2Attempts: levelCounts?.A2.attempts ?? null,
    A2Correct: levelCounts?.A2.correct ?? null,
    B1Attempts: levelCounts?.B1.attempts ?? null,
    B1Correct: levelCounts?.B1.correct ?? null,
    B2Attempts: levelCounts?.B2.attempts ?? null,
    B2Correct: levelCounts?.B2.correct ?? null,
  };
}

function identityValues(total: RewardStudentTotal | RewardDay) {
  return {
    studentId: total.studentId,
    studentNumber: "studentNumber" in total ? total.studentNumber : null,
    accountName: "accountName" in total ? total.accountName : null,
    legalName: "legalName" in total ? total.legalName : null,
    nickname: "nickname" in total ? total.nickname : null,
    grade: "grade" in total ? total.grade : null,
    classLabel: "classLabel" in total ? total.classLabel : null,
  };
}

function totalRow(total: RewardStudentTotal) {
  return {
    rowType: "STUDENT_TOTAL",
    ...identityValues(total),
    eligibleFrom: total.eligibleFrom,
    eligibleDayCount: total.eligibleDayCount,
    activeDayCount: total.activeDayCount,
    learningCardCount: total.learningCardCount,
    objectiveAttemptCount: total.objectiveAttemptCount,
    objectiveCorrectCount: total.objectiveCorrectCount,
    effortActivityCount: total.effortActivityCount,
    creditedEffortActivityCount: total.creditedEffortActivityCount,
    firstCorrectSenseDayCount: total.firstCorrectSenseDayCount,
    creditedFirstCorrectSenseDayCount: total.creditedFirstCorrectSenseDayCount,
    distinctSenseCount: total.distinctSenseCount,
    ...levelValues(total.levelCounts),
    objectiveAccuracyPercent: total.objectiveAccuracyPercent,
    accuracyStatus: total.accuracyStatus,
    effortCapDays: total.effortCapDays,
    outcomeCapDays: total.outcomeCapDays,
    effortCapDayPercent: total.effortCapDayPercent,
    outcomeCapDayPercent: total.outcomeCapDayPercent,
    ...scoreValues("", total.scores),
    ...coverageValues(total.coverage),
  };
}

function dayRow(day: RewardDay, total: RewardStudentTotal) {
  return {
    rowType: "STUDENT_DAY",
    ...identityValues(total),
    date: day.date,
    eligible: day.eligible,
    learningCardCount: day.learningCardCount,
    objectiveAttemptCount: day.objectiveAttemptCount,
    objectiveCorrectCount: day.objectiveCorrectCount,
    effortActivityCount: day.effortActivityCount,
    creditedEffortActivityCount: day.creditedEffortActivityCount,
    firstCorrectSenseCount: day.firstCorrectSenseCount,
    creditedFirstCorrectSenseCount: day.creditedFirstCorrectSenseCount,
    distinctSenseCount: day.distinctSenseCount,
    ...levelValues(day.levelCounts),
    objectiveAccuracyPercent: day.objectiveAccuracyPercent,
    accuracyStatus: day.accuracyStatus,
    effortCapReached: day.effortCapReached,
    outcomeCapReached: day.outcomeCapReached,
    ...scoreValues("", day.scores),
    ...scoreValues("cumulative", day.cumulative),
    ...coverageValues(day.coverage),
  };
}

function friendlyValue(value: unknown) {
  if (value === "STUDENT_TOTAL") return "學生總表";
  if (value === "STUDENT_DAY") return "每日明細";
  if (value === "CHECKED") return "已核對";
  if (value === "INCOMPLETE") return "資料不完整";
  if (value === "NOT_GUARANTEED") return "未保證完整歷史";
  if (value === "KNOWN_GAP") return "已知歷史缺口";
  if (value === "NO_DATA") return "未有客觀作答";
  if (value === "SMALL_SAMPLE") return "樣本較少";
  if (value === "SUFFICIENT") return "已有作答資料";
  return value;
}

function metadataRows(result: RewardExportResult): Array<[string, string]> {
  return [
    ["學年", result.academicYear.label],
    ["要求日期", `${result.requestedRange.fromDate} 至 ${result.requestedRange.toDate}`],
    ["實際日期", `${result.effectiveRange.from} 至 ${result.effectiveRange.to}`],
    ["目前班籍口徑", "按目前在籍學生計算"],
    ["資料截止時間", result.asOf],
    ["政策版本", result.policy.version],
    ["每日投入上限", String(result.policy.dailyEffortCap)],
    ["每日成效上限", String(result.policy.dailyOutcomeCap)],
    ["投入權重", String(result.policy.weights.effort)],
    ["成效權重", String(result.policy.weights.outcome)],
    ["時區", "Asia/Shanghai"],
    ["公式", "Ed=10×min(Ud,20)/20；Od=10×min(Cd,5)/5；Td=Ed×投入權重/100+Od×成效權重/100"],
    ["權重算例", "50/50：一張合資格卡片=0.250；同一活動若同時是首次答對probe，合計=1.250；兩軸可重疊"],
    ["資料完整性", result.coverageSummary.combined.validationStatus],
    ["歷史覆蓋", result.coverageSummary.combined.historyCoverage],
    ["限制說明", "分數只作教師獎勵參考，不代表能力、正確率或長期掌握度"],
  ];
}

function rowValues(row: Record<string, unknown>, columns: readonly (readonly [string, string])[]) {
  return columns.map(([key]) => friendlyValue(row[key]));
}

function assertExportSize(result: RewardExportResult, rows: Array<Record<string, unknown>>) {
  // Include repeated CSV context, fixed headers, quoting, and XML/ZIP margin
  // before building the final representation. The exact post-serialization
  // check below remains authoritative.
  const jsonBytes = Buffer.byteLength(JSON.stringify({ settings: result.settings, rows }), "utf8");
  const repeatedContextBytes = (rows.length + result.settings.length + 1) * 1_024;
  const estimate = jsonBytes * 3 + repeatedContextBytes;
  if (estimate > MAX_REWARD_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
}

export function serializeLearningRewardCsv(result: RewardExportResult) {
  const totals = result.totals.map(totalRow);
  const totalById = new Map(result.totals.map((total) => [total.studentId, total]));
  const days = result.days.map((day) => {
    const total = totalById.get(day.studentId);
    if (!total) throw new Error("EXPORT_FAILED");
    return dayRow(day, total);
  });
  const allRows = [...totals, ...days];
  assertExportSize(result, allRows);
  const context = {
    requestedFrom: result.requestedRange.fromDate,
    requestedTo: result.requestedRange.toDate,
    effectiveFrom: result.effectiveRange.from,
    effectiveTo: result.effectiveRange.to,
    asOf: result.asOf,
    policyVersion: result.policy.version,
    effortWeight: result.policy.weights.effort,
    outcomeWeight: result.policy.weights.outcome,
  };
  const columns = ["rowType", "settingKey", "settingValue", ...Object.keys(context), ...CSV_DATA_COLUMNS];
  const settings = result.settings.map(([settingKey, settingValue]) => ({ rowType: "SETTINGS", settingKey, settingValue, ...context }));
  const rows = [...settings, ...allRows.map((row) => ({ ...context, ...row }))];
  const text = `\uFEFF${[columns, ...rows.map((row) => {
    const values = { ...(row as Record<string, unknown>) };
    for (const key of SCORE_VALUE_KEYS) {
      if (typeof values[key] === "number") values[key] = values[key].toFixed(3);
    }
    return columns.map((column) => CSV_TYPED_VALUE_KEYS.has(column) ? values[column] : friendlyValue(values[column]));
  })].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
  if (Buffer.byteLength(text, "utf8") > MAX_REWARD_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return text;
}

export async function serializeLearningRewardXlsx(result: RewardExportResult) {
  const totals = result.totals.map(totalRow);
  const totalById = new Map(result.totals.map((total) => [total.studentId, total]));
  const days = result.days.map((day) => {
    const total = totalById.get(day.studentId);
    if (!total) throw new Error("EXPORT_FAILED");
    return dayRow(day, total);
  });
  assertExportSize(result, [...totals, ...days]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "English Vocabulary Learning Analytics";
  const settingsSheet = workbook.addWorksheet("報告設定");
  settingsSheet.addRows(metadataRows(result).map((row) => row.map((value) => spreadsheetValue(value))));
  settingsSheet.addRow(["選定學生數", result.totals.length]);
  settingsSheet.addRow(["資料完整性摘要", friendlyValue(result.coverageSummary.combined.validationStatus)]);
  settingsSheet.addRow(["歷史覆蓋摘要", friendlyValue(result.coverageSummary.combined.historyCoverage)]);
  settingsSheet.getColumn(1).width = 24;
  settingsSheet.getColumn(2).width = 64;

  const totalSheet = workbook.addWorksheet("學生總表", { views: [{ state: "frozen", ySplit: 1 }] });
  totalSheet.columns = TOTAL_COLUMNS.map(([key, label]) => ({ key, header: label, width: Math.max(13, label.length + 3) }));
  TOTAL_COLUMNS.forEach(([key], index) => { if (SCORE_VALUE_KEYS.has(key)) totalSheet.getColumn(index + 1).numFmt = "0.000"; });
  for (const row of totals) totalSheet.addRow(rowValues(row, TOTAL_COLUMNS).map((value) => spreadsheetValue(value)));
  totalSheet.getRow(1).font = { bold: true };
  totalSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, totals.length + 1), column: TOTAL_COLUMNS.length } };

  const daySheet = workbook.addWorksheet("每日明細", { views: [{ state: "frozen", ySplit: 1 }] });
  daySheet.columns = DAY_COLUMNS.map(([key, label]) => ({ key, header: label, width: Math.max(13, label.length + 3) }));
  DAY_COLUMNS.forEach(([key], index) => { if (SCORE_VALUE_KEYS.has(key)) daySheet.getColumn(index + 1).numFmt = "0.000"; });
  for (const row of days) daySheet.addRow(rowValues(row, DAY_COLUMNS).map((value) => spreadsheetValue(value)));
  daySheet.getRow(1).font = { bold: true };
  daySheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, days.length + 1), column: DAY_COLUMNS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  if (buffer.byteLength > MAX_REWARD_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return new Uint8Array(buffer);
}

export function rewardExportColumnsForTests() {
  return { total: TOTAL_COLUMNS, day: DAY_COLUMNS, coverage: COVERAGE_COLUMNS };
}
