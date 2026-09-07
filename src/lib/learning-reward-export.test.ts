import assert from "node:assert/strict";
import test from "node:test";
import type { RewardCoverage, RewardExportResult, RewardStudentTotal } from "@/lib/learning-reward-analytics";
import { serializeLearningRewardCsv, serializeLearningRewardXlsx } from "@/lib/learning-reward-export";

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
