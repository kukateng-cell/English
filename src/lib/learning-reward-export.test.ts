import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import test from "node:test";
import type { RewardCoverage, RewardExportResult, RewardStudentTotal } from "@/lib/learning-reward-analytics";
import { MAX_REWARD_EXPORT_BYTES, serializeLearningRewardCsv, serializeLearningRewardXlsx } from "@/lib/learning-reward-export";

const coverage: RewardCoverage = {
  sources: {
    encounters: { candidateCount: 1, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 1 },
    reviews: { candidateCount: 1, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 1 },
  },
  validationGapCount: 0,
  policyExcludedCount: 0,
  validationStatus: "CHECKED",
  historyCoverage: "NOT_GUARANTEED",
  studyDayMismatchCount: 0,
  warningCodes: [],
};

const scores = {
  effortMilliPoints: 2500,
  outcomeMilliPoints: 4000,
  effortContributionMilliPoints: 1000,
  outcomeContributionMilliPoints: 2400,
  weightedMilliPoints: 3400,
};

const total: RewardStudentTotal = {
  studentId: "student-1",
  studentNumber: 7,
  accountName: "student7",
  legalName: "測試學生",
  nickname: "小測",
  grade: "JUNIOR_1",
  classId: "class-a",
  classLabel: "初一A班",
  eligibleFrom: "2026-08-01",
  eligibleDayCount: 31,
  activeDayCount: 1,
  learningCardCount: 5,
  objectiveAttemptCount: 2,
  objectiveCorrectCount: 1,
  effortActivityCount: 5,
  creditedEffortActivityCount: 5,
  firstCorrectSenseDayCount: 1,
  creditedFirstCorrectSenseDayCount: 1,
  distinctSenseCount: 1,
  levelCounts: { A1: { attempts: 2, correct: 1 }, A2: { attempts: 0, correct: 0 }, B1: { attempts: 0, correct: 0 }, B2: { attempts: 0, correct: 0 } },
  objectiveAccuracyPercent: 50,
  accuracyStatus: "SUFFICIENT",
  effortCapDays: 0,
  outcomeCapDays: 0,
  effortCapDayPercent: 0,
  outcomeCapDayPercent: 0,
  scores,
  coverage,
};

const result: RewardExportResult = {
  requestedRange: { fromDate: "2026-08-01", toDate: "2026-08-31" },
  effectiveRange: { requestedFrom: "2026-08-01", requestedTo: "2026-08-31", from: "2026-08-01", to: "2026-08-31", rangeClamped: false, timezone: "Asia/Shanghai" },
  academicYear: { id: "year-1", label: "2026–2027", startsOn: "2026-08-01T00:00:00.000Z", endsOn: "2027-07-31T00:00:00.000Z" },
  cohortBasis: "CURRENT_MEMBERSHIP",
  asOf: "2026-09-01T00:00:00.000Z",
  policy: { version: "reward-v1", dailyEffortCap: 20, dailyOutcomeCap: 5, dailyScale: 10, weights: { effort: 40, outcome: 60 } },
  scopeRevision: 3,
  scopeToken: "signed-context",
  coverageSummary: { basis: "WHOLE_REPORT", studentCount: 1, studentsWithValidationGaps: 0, studentsWithPolicyExclusions: 0, studentsWithKnownHistoryGaps: 0, combined: coverage },
  totals: [total],
  days: [{ studentId: "student-1", date: "2026-08-01", eligible: true, learningCardCount: 5, objectiveAttemptCount: 2, objectiveCorrectCount: 1, effortActivityCount: 5, creditedEffortActivityCount: 5, firstCorrectSenseCount: 1, creditedFirstCorrectSenseCount: 1, distinctSenseCount: 1, levelCounts: total.levelCounts, objectiveAccuracyPercent: 50, accuracyStatus: "SUFFICIENT", effortCapReached: false, outcomeCapReached: false, scores, cumulative: scores, coverage }],
  settings: [["policyVersion", "reward-v1"]],
};

test("reward CSV keeps three-decimal scores and explicit nulls", () => {
  const csv = serializeLearningRewardCsv(result);
  assert.match(csv, /3\.400/);
  assert.match(csv, /STUDENT_TOTAL/);
  assert.match(csv, /coverageValidationStatus/);
  assert.match(csv, /\uFEFF/);
});

test("reward XLSX contains settings, totals, and daily detail sheets", async () => {
  const bytes = await serializeLearningRewardXlsx(result);
  assert.ok(bytes.byteLength > 1_000);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
});


test("36 students over 180 days export without an inflated JSON preflight rejection", async () => {
  const totals = Array.from({ length: 36 }, (_, i) => ({ ...total, studentId: "student-" + i }));
  const report = { ...result, totals, days: totals.flatMap(student => Array.from({ length: 180 }, (_, i) => ({ ...result.days[0], studentId: student.studentId, date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10) }))) };
  const csv = serializeLearningRewardCsv(report);
  assert.equal(csv.split("\r\n").length, 6518);
  assert.ok(Buffer.byteLength(csv) < 32 * 1024 * 1024);
  const bytes = await serializeLearningRewardXlsx(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.equal(workbook.getWorksheet("每日明細")!.rowCount, 6481);
});

test("CSV byte limit counts BOM, UTF-8, escaped quotes and CRLF exactly", () => {
  const report = { ...result, totals: [], days: [], settings: [["test", '中文😀"\r\n']] as Array<[string, string]> };
  const remaining = MAX_REWARD_EXPORT_BYTES - Buffer.byteLength(serializeLearningRewardCsv(report));
  report.settings[0][1] += "x".repeat(remaining);
  assert.equal(Buffer.byteLength(serializeLearningRewardCsv(report)), MAX_REWARD_EXPORT_BYTES);
  report.settings[0][1] += "x";
  assert.throws(() => serializeLearningRewardCsv(report), /EXPORT_TOO_LARGE/);
});

test("XLSX model allocation is bounded independently of final file size", async () => {
  const report = { ...result, days: Array.from({ length: 20000 }, () => result.days[0]) };
  await assert.rejects(serializeLearningRewardXlsx(report), /EXPORT_TOO_LARGE/);
});

test("identity and settings values round-trip without status translation", async () => {
  const codes = ["CHECKED", "INCOMPLETE", "NO_DATA", "STUDENT_TOTAL", "KNOWN_GAP", "NOT_GUARANTEED", "SMALL_SAMPLE", "SUFFICIENT", "STUDENT_DAY"];
  const totals = codes.map(code => ({ ...total, studentId: code, nickname: code, legalName: code, accountName: code }));
  const report = { ...result, totals, days: totals.map(student => ({ ...result.days[0], studentId: student.studentId })), settings: [["test", "CHECKED"]] as Array<[string, string]> };
  const csvWorkbook = new ExcelJS.Workbook();
  const csvSheet = await csvWorkbook.csv.read(Readable.from([serializeLearningRewardCsv(report)]));
  const headers = csvSheet.getRow(1).values as string[];
  for (let i = 0; i < codes.length; i++) {
    for (const key of ["studentId", "nickname", "legalName", "accountName"]) assert.equal(csvSheet.getRow(i + 3).getCell(headers.indexOf(key)).value, codes[i]);
  }
  assert.equal(csvSheet.getRow(2).getCell(headers.indexOf("settingValue")).value, "CHECKED");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await serializeLearningRewardXlsx(report)).buffer);
  for (const name of ["學生總表", "每日明細"]) {
    const sheet = workbook.getWorksheet(name)!;
    const labels = sheet.getRow(1).values as string[];
    for (let i = 0; i < codes.length; i++) {
      for (const label of ["學生 ID", "暱稱", "姓名", "學生帳號"]) {
        const column = labels.indexOf(label);
        assert.ok(column > 0);
        assert.equal(sheet.getRow(i + 2).getCell(column).value, codes[i]);
      }
      assert.equal(sheet.getRow(i + 2).getCell(labels.indexOf("資料核對狀態")).value, "已核對");
    }
  }
});
