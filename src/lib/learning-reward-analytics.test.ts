import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@/generated/prisma";
import { buildStudentReward, readRewardMembers, type RewardMember, type RewardRange, type RewardReviewEvent } from "@/lib/learning-reward-analytics";

const member: RewardMember = {
  id: "student-1",
  accountName: "student",
  studentNumber: null,
  legalName: "Student",
  nickname: "",
  grade: "JUNIOR_1",
  classId: "class-a",
  classCode: "A",
  startedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const range: RewardRange = {
  requestedFrom: "2026-09-07",
  requestedTo: "2026-09-07",
  from: "2026-09-07",
  to: "2026-09-07",
  rangeClamped: false,
  timezone: "Asia/Shanghai",
};

function makeReview(overrides: { id?: string; createdAt?: Date; isHistorical?: boolean; eventKind?: "REVIEW" | "LEGACY_BRIDGE" | "HISTORICAL_BACKFILL" } = {}): RewardReviewEvent {
  return {
    id: overrides.id ?? "review-1",
    operationId: "operation-1",
    userId: member.id,
    submittedWordId: "word-1",
    wordId: null,
    senseId: null,
    submittedSenseId: null,
    contentRevisionId: null,
    catalogRevisionId: null,
    wordLevel: "A1",
    eventKind: overrides.eventKind ?? "REVIEW",
    quality: 0,
    isHistorical: overrides.isHistorical ?? false,
    evidenceKind: null,
    flowVersion: null,
    qualityPolicyVersion: null,
    probePurpose: null,
    itemConstructionVersion: null,
    objectiveEvidenceTargetId: null,
    objectiveQuestionSnapshotId: null,
    createdAt: overrides.createdAt ?? new Date("2026-09-07T02:00:00.000Z"),
    objectiveEvidenceTarget: null,
  };
}

function emptyActivity(reviewEvents: RewardReviewEvent[], studyDays: Array<{ userId: string; date: string; createdAt: Date }> = []) {
  return { reviewEvents, encounters: [], studyDays };
}

test("ordinary null-marker REVIEW remains a candidate and prevents a false StudyDay history gap", () => {
  const { total, days: [day] } = buildStudentReward({
    member,
    activity: emptyActivity([makeReview()], [{ userId: member.id, date: "2026-09-07", createdAt: new Date("2026-09-07T02:01:00.000Z") }]),
    range,
    weights: { effort: 50, outcome: 50 },
  });
  assert.equal(day.coverage.sources.reviews.candidateCount, 1);
  assert.equal(day.coverage.sources.reviews.missingIdentityOrProvenance, 1);
  assert.equal(day.coverage.validationGapCount, 1);
  assert.equal(day.coverage.validationStatus, "INCOMPLETE");
  assert.equal(day.coverage.historyCoverage, "NOT_GUARANTEED");
  assert.equal(day.scores?.weightedMilliPoints, 0);
  assert.equal(total.scores?.weightedMilliPoints, 0);
});

test("historical null-marker REVIEW is classified as policy excluded", () => {
  const { total, days: [day] } = buildStudentReward({
    member,
    activity: emptyActivity([makeReview({ isHistorical: true })]),
    range,
    weights: { effort: 50, outcome: 50 },
  });
  assert.equal(day.coverage.sources.reviews.candidateCount, 1);
  assert.equal(day.coverage.sources.reviews.policyExcluded, 1);
  assert.equal(day.coverage.validationGapCount, 0);
  assert.equal(day.coverage.validationStatus, "CHECKED");
  assert.equal(day.coverage.historyCoverage, "NOT_GUARANTEED");
  assert.equal(total.scores?.weightedMilliPoints, 0);
});

test("pre-enrollment REVIEW is outside eligibility without creating a validation gap", () => {
  const preEnrollmentMember = { ...member, startedAt: new Date("2026-09-07T00:00:00.000Z") };
  const preEnrollmentRange: RewardRange = { ...range, requestedFrom: "2026-09-06", from: "2026-09-06" };
  const { total, days: [day] } = buildStudentReward({
    member: preEnrollmentMember,
    activity: emptyActivity([makeReview({ createdAt: new Date("2026-09-06T02:00:00.000Z") })]),
    range: preEnrollmentRange,
    weights: { effort: 50, outcome: 50 },
  });
  assert.equal(day.eligible, false);
  assert.equal(day.coverage.sources.reviews.candidateCount, 1);
  assert.equal(day.coverage.sources.reviews.outsideEligibility, 1);
  assert.equal(total.coverage.validationGapCount, 0);
  assert.equal(total.coverage.validationStatus, "CHECKED");
  assert.equal(total.scores?.weightedMilliPoints, 0);
});


test("student-number search uses the same current enrollment scope as membership", async () => {
  for (const search of ["7", " ００７ ", "alice", "0", "1000000", "1.5"]) {
    let captured: Prisma.UserFindManyArgs | undefined;
    const db = { user: { findMany: async (args: Prisma.UserFindManyArgs) => { captured = args; return []; } } } as unknown as Parameters<typeof readRewardMembers>[0];
    await readRewardMembers(db, { userId: "teacher", role: "TEACHER", yearId: "current-year", classIds: ["selected-class"], grade: "JUNIOR_1", search });
    const where = captured!.where!;
    const branches = where.OR ?? [];
    const numberBranch = branches.find(branch => JSON.stringify(branch).includes('"studentNumber"'));
    if (search === "7" || search.includes("００７")) {
      assert.deepEqual(numberBranch, { studentProfile: { is: { enrollments: { some: { academicYearId: "current-year", status: "ACTIVE", grade: "JUNIOR_1", classId: { in: ["selected-class"] }, studentNumber: 7 } } } } });
    } else assert.equal(numberBranch, undefined);
  }
});
