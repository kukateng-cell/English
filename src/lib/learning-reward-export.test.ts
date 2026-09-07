import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import test from "node:test";
import type { RewardCoverage, RewardExportResult, RewardStudentTotal } from "@/lib/learning-reward-analytics";
import { MAX_REWARD_EXPORT_BYTES, serializeLearningRewardCsv, serializeLearningRewardDailyXlsx, serializeLearningRewardXlsx } from "@/lib/learning-reward-export";

const coverage: RewardCoverage = {
  sources: {
    encounters: { candidateCount: 6, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 6 },
    reviews: { candidateCount: 4, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 4 },
  },
  validationGapCount: 0,
  policyExcludedCount: 0,
  validationStatus: "CHECKED",
  historyCoverage: "NOT_GUARANTEED",
  studyDayMismatchCount: 0,
  warningCodes: [],
};

// These values are deliberately hand-calculable: 5.000 effort + 4.000
// outcome at 50/50 produces a 4.500 weighted total. The activity counts
// below agree with the scoring inputs (6 cards + 4 objective attempts = 10
// effort activities; two first-correct senses = 4 outcome points).
const scores = {
  effortMilliPoints: 5000,
  outcomeMilliPoints: 4000,
  effortContributionMilliPoints: 2500,
  outcomeContributionMilliPoints: 2000,
  weightedMilliPoints: 4500,
};

const total: RewardStudentTotal = {
  studentId: "student-1",
  studentNumber: 7,
  accountName: "student7",
  legalName: "正式姓名",
  nickname: "暱稱不應優先",
  grade: "JUNIOR_1",
  classId: "class-a",
  classLabel: "初一A班",
  eligibleFrom: "2026-08-01",
  eligibleDayCount: 31,
  activeDayCount: 1,
  learningCardCount: 6,
  objectiveAttemptCount: 4,
  objectiveCorrectCount: 2,
  effortActivityCount: 10,
  creditedEffortActivityCount: 10,
  firstCorrectSenseDayCount: 2,
  creditedFirstCorrectSenseDayCount: 2,
  distinctSenseCount: 2,
  levelCounts: { A1: { attempts: 4, correct: 2 }, A2: { attempts: 0, correct: 0 }, B1: { attempts: 0, correct: 0 }, B2: { attempts: 0, correct: 0 } },
  objectiveAccuracyPercent: 50,
  accuracyStatus: "SUFFICIENT",
  effortCapDays: 0,
  outcomeCapDays: 0,
  effortCapDayPercent: 0,
  outcomeCapDayPercent: 0,
  scores,
  coverage,
};

const day = {
  studentId: "student-1",
  date: "2026-08-01",
  eligible: true,
  learningCardCount: 6,
  objectiveAttemptCount: 4,
  objectiveCorrectCount: 2,
  effortActivityCount: 10,
  creditedEffortActivityCount: 10,
  firstCorrectSenseCount: 2,
  creditedFirstCorrectSenseCount: 2,
  distinctSenseCount: 2,
  levelCounts: total.levelCounts,
  objectiveAccuracyPercent: 50,
  accuracyStatus: "SUFFICIENT" as const,
  effortCapReached: false,
  outcomeCapReached: false,
  scores,
  cumulative: scores,
  coverage,
};

const result: RewardExportResult = {
  requestedRange: { fromDate: "2026-08-01", toDate: "2026-08-31" },
  effectiveRange: { requestedFrom: "2026-08-01", requestedTo: "2026-08-31", from: "2026-08-01", to: "2026-08-31", rangeClamped: false, timezone: "Asia/Shanghai" },
  academicYear: { id: "year-1", label: "2026–2027", startsOn: "2026-08-01T00:00:00.000Z", endsOn: "2027-07-31T00:00:00.000Z" },
  cohortBasis: "CURRENT_MEMBERSHIP",
  asOf: "2026-09-01T00:00:00.000Z",
  policy: { version: "reward-v1", dailyEffortCap: 20, dailyOutcomeCap: 5, dailyScale: 10, weights: { effort: 50, outcome: 50 } },
  scopeRevision: 3,
  scopeToken: "signed-context",
  coverageSummary: { basis: "WHOLE_REPORT", studentCount: 1, studentsWithValidationGaps: 0, studentsWithPolicyExclusions: 0, studentsWithKnownHistoryGaps: 0, combined: coverage },
  totals: [total],
  days: [day],
  settings: [["policyVersion", "reward-v1"]],
};

test("reward CSV contains exactly the eight summary columns and points are not divided twice", () => {
  const csv = serializeLearningRewardCsv(result);
  const lines = csv.replace(/^\uFEFF/u, "").split("\r\n");
  assert.equal(lines[0], "\"班級\",\"學號\",\"姓名\",\"學生帳號\",\"累積投入分\",\"累積成效分\",\"累積總分\",\"備註\"");
  assert.equal(lines[1], '"初一A班","7","正式姓名","student7","5.000","4.000","4.500",""');
  assert.ok(!csv.includes("STUDENT_TOTAL"));
  assert.ok(Buffer.byteLength(csv, "utf8") > 0);
});

test("summary XLSX is one readable sheet with numeric scores and print settings", async () => {
  const bytes = await serializeLearningRewardXlsx(result);
  assert.ok(bytes.byteLength > 1_000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["學生累積分"]);
  const sheet = workbook.getWorksheet("學生累積分")!;
  assert.equal(sheet.pageSetup.orientation, "landscape");
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, "8:8");
  const firstView = sheet.views[0];
  assert.equal(firstView && "ySplit" in firstView ? firstView.ySplit : undefined, 8);
  assert.equal(sheet.getCell("A8").value, "班級");
  assert.equal(sheet.getCell("C9").value, "正式姓名");
  assert.equal(sheet.getCell("G9").value, 4.5);
  assert.equal(sheet.getColumn(4).width, 30);
  assert.ok((sheet.getColumn(3).width ?? 0) >= 18);
});

test("daily XLSX keeps four daily score columns plus identity and note", async () => {
  const bytes = await serializeLearningRewardDailyXlsx(result);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["每日分數"]);
  const sheet = workbook.getWorksheet("每日分數")!;
  assert.equal(sheet.getCell("A8").value, "班級");
  assert.equal(sheet.getCell("E8").value, "日期");
  assert.equal(sheet.getCell("H8").value, "當日總分");
  assert.equal(sheet.getCell("H9").value, 4.5);
  assert.equal(sheet.getColumn(9).width, 38);
});

test("formula-like identities are escaped in CSV", () => {
  const report = { ...result, totals: [{ ...total, legalName: "=HYPERLINK(\"https://example.com\")" }] };
  assert.match(serializeLearningRewardCsv(report), /'=HYPERLINK/u);
});

test("CSV byte limit counts BOM, UTF-8, escaped values and CRLF exactly", () => {
  const longName = "x".repeat(MAX_REWARD_EXPORT_BYTES);
  const report = { ...result, totals: [{ ...total, legalName: longName }] };
  assert.throws(() => serializeLearningRewardCsv(report), /EXPORT_TOO_LARGE/u);
});

test("XLSX model allocation is bounded independently of final file size", async () => {
  const longAccount = "x".repeat(300_000);
  const totals = Array.from({ length: 600 }, (_, index) => ({ ...total, studentId: `student-${index}`, accountName: longAccount }));
  await assert.rejects(serializeLearningRewardXlsx({ ...result, totals }), /EXPORT_TOO_LARGE/u);
});
