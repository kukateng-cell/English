import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@/generated/prisma";
import { readRewardMembers, isRewardReviewCandidate } from "@/lib/learning-reward-analytics";

const emptyObjectiveMarker = {
  flowVersion: null,
  evidenceKind: null,
  objectiveEvidenceTargetId: null,
  objectiveQuestionSnapshotId: null,
  probePurpose: null,
  submittedSenseId: null,
} as const;

test("reward reader keeps explicit bridge rows in the coverage candidate universe", () => {
  assert.equal(isRewardReviewCandidate({ eventKind: "LEGACY_BRIDGE", ...emptyObjectiveMarker }), true);
  assert.equal(isRewardReviewCandidate({ eventKind: "HISTORICAL_BACKFILL", ...emptyObjectiveMarker }), true);
});

test("reward reader does not treat an ordinary non-objective review as an objective candidate", () => {
  assert.equal(isRewardReviewCandidate({ eventKind: "REVIEW", ...emptyObjectiveMarker }), false);
  assert.equal(isRewardReviewCandidate({ eventKind: "REVIEW", ...emptyObjectiveMarker, flowVersion: "v2" }), true);
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
