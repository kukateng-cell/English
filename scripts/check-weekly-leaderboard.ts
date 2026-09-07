/** Read-only local smoke checks for the student weekly leaderboard. */
import assert from "node:assert/strict";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config();

function assertLocalDatabase() {
  const value = process.env.MIGRATE_URL ?? "";
  const target = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(target.hostname), "leaderboard DB check must use localhost");
  assert.equal(target.pathname.replace(/^\//u, ""), "english_dev", "leaderboard DB check must use english_dev");
}

function assertPublicPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["accountName", "legalName", "studentNumber", "passwordHash", "objectiveQuestionSnapshot", "correctOptionId"]) {
    assert.equal(serialized.includes(forbidden), false, `public payload leaked ${forbidden}`);
  }
}

function plusDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const {
    getWeeklyLeaderboard,
    WeeklyLeaderboardCursorError,
    WeeklyLeaderboardForbiddenError,
  } = await import("../src/lib/leaderboard");
  try {
    assertLocalDatabase();
    const student = await prisma.user.findUniqueOrThrow({ where: { accountName: "student-test" }, select: { id: true, role: true } });
    const otherStudent = await prisma.user.findUniqueOrThrow({ where: { accountName: "student-test_webkit" }, select: { id: true, role: true } });
    const teacher = await prisma.user.findUniqueOrThrow({ where: { accountName: "teacher" }, select: { id: true, role: true } });
    assert.equal(student.role, "STUDENT");
    assert.equal(teacher.role, "TEACHER");
    const countsBefore = await Promise.all([prisma.user.count(), prisma.reviewEvent.count(), prisma.studyEncounter.count(), prisma.studyDay.count(), prisma.studySession.count()]);

  const classSummary = await getWeeklyLeaderboard({ userId: student.id, scope: "class", view: "summary" });
  assert.equal(classSummary.policyVersion, "student-weekly-v1");
  assert.equal(classSummary.scope, "class");
  assert.equal(classSummary.week.endExclusive, plusDays(classSummary.week.start, 7));
  assert.ok(classSummary.personal.goal.targetDays >= 1);
  assert.equal(classSummary.personal.dailyProgress.length, 7);
  assert.ok(classSummary.personal.rank !== null || classSummary.personal.rankingState !== "RANKED");
  assertPublicPayload(classSummary);

  const schoolFirstPage = await getWeeklyLeaderboard({ userId: student.id, scope: "school", view: "all" });
  assert.ok(schoolFirstPage.participantCount >= 100);
  assert.ok(schoolFirstPage.page.entries.length <= 50);
  assert.ok(schoolFirstPage.page.nextCursor, "school fixture should exercise pagination");
  const firstKeys = new Set(schoolFirstPage.page.entries.map((entry) => entry.entryKey));
  assert.equal(firstKeys.size, schoolFirstPage.page.entries.length);
  assertPublicPayload(schoolFirstPage.page.entries);

  const schoolSecondPage = await getWeeklyLeaderboard({ userId: student.id, scope: "school", view: "all", cursor: schoolFirstPage.page.nextCursor! });
  assert.ok(schoolSecondPage.page.entries.length > 0);
  assert.equal(schoolSecondPage.scope, "school");
  assert.equal(schoolSecondPage.page.entries.some((entry) => firstKeys.has(entry.entryKey)), false, "pagination duplicated an entry");
  assertPublicPayload(schoolSecondPage.page.entries);

  const gradeSummary = await getWeeklyLeaderboard({ userId: student.id, scope: "grade", view: "summary" });
  assert.equal(gradeSummary.scope, "grade");
  assert.equal(gradeSummary.scopeContext.grade, classSummary.scopeContext.grade);
  assert.ok(gradeSummary.participantCount > 0);

  await assert.rejects(
    () => getWeeklyLeaderboard({ userId: teacher.id, scope: "school", view: "summary" }),
    (error: unknown) => error instanceof WeeklyLeaderboardForbiddenError,
  );
  await assert.rejects(
    () => getWeeklyLeaderboard({ userId: student.id, scope: "school", view: "summary", cursor: schoolFirstPage.page.nextCursor! }),
    (error: unknown) => error instanceof WeeklyLeaderboardCursorError && !error.stale,
  );
  await assert.rejects(
    () => getWeeklyLeaderboard({ userId: otherStudent.id, scope: "school", view: "all", cursor: schoolFirstPage.page.nextCursor! }),
    (error: unknown) => error instanceof WeeklyLeaderboardCursorError && !error.stale,
  );
  const tamperedCursor = `${schoolFirstPage.page.nextCursor!.slice(0, -1)}${schoolFirstPage.page.nextCursor!.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(
    () => getWeeklyLeaderboard({ userId: student.id, scope: "school", view: "all", cursor: tamperedCursor }),
    (error: unknown) => error instanceof WeeklyLeaderboardCursorError && !error.stale,
  );
    const countsAfter = await Promise.all([prisma.user.count(), prisma.reviewEvent.count(), prisma.studyEncounter.count(), prisma.studyDay.count(), prisma.studySession.count()]);
    assert.deepEqual(countsAfter, countsBefore, "leaderboard reads must not write learning data");

    console.log(JSON.stringify({
      ready: true,
      week: classSummary.week,
      class: { participants: classSummary.participantCount, ranked: classSummary.rankedCount, unranked: classSummary.unrankedCount },
      school: { participants: schoolFirstPage.participantCount, firstPage: schoolFirstPage.page.entries.length, secondPage: schoolSecondPage.page.entries.length },
      grade: { participants: gradeSummary.participantCount, ranked: gradeSummary.rankedCount },
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
