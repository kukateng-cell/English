/**
 * Development-only deterministic analytics fixture.
 *
 * This command intentionally has a guarded destructive mode. It keeps the
 * canonical Word catalogue, but replaces all local User/roster/learning rows
 * with the exact demo namespace so stale test accounts cannot distort charts.
 */
import dotenv from "dotenv";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type StudentGrade, type ClassCode } from "../src/generated/prisma";
import { currentAcademicYearDates, STUDENT_GRADES } from "../src/lib/roster-domain";
import { passwordPolicyError } from "../src/lib/password-policy";
import { todayKey, offsetDay } from "../src/lib/streak";
import { createInitialState, updateSM2At, type ReviewState, type Quality } from "../src/lib/sm2";
import { OBJECTIVE_ITEM_CONSTRUCTION_VERSION, OBJECTIVE_QUALITY_POLICY_VERSION, RETRIEVAL_POLICY_VERSION } from "../src/lib/learning-policy/types";

dotenv.config({ path: ".env.local" });
dotenv.config();

type Environment = "development" | "test";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL ?? "" }) });
const args = new Set(process.argv.slice(2));
const preview = args.has("--preview-reset");
const rebuild = args.has("--reset-and-rebuild");
const confirmed = args.has("--confirm-local-demo-reset");
const VERSION = "demo-analytics-v1";

function fail(message: string): never { throw new Error(message); }
function requireLocalEnvironment(): Environment {
  if (!process.env.MIGRATE_URL) fail("建立示範資料必須明確設定 MIGRATE_URL。");
  const env = process.env.DATABASE_ENVIRONMENT;
  if (env !== "development" && env !== "test") fail("示範資料只容許 DATABASE_ENVIRONMENT=development 或 test。");
  if (process.env.CONFIRM_DATABASE_ENVIRONMENT !== env) fail(`請同時設定 CONFIRM_DATABASE_ENVIRONMENT=${env}。`);
  return env;
}
function randomId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function dateAt(key: string, hour = 12) { return new Date(`${key}T${String(hour).padStart(2, "0")}:00:00+08:00`); }
function archetype(index: number) { const ratio = index % 20; return ratio < 4 ? "STEADY_HIGH" : ratio < 9 ? "STEADY_GENERAL" : ratio < 13 ? "IMPROVING" : ratio < 16 ? "INTERMITTENT" : ratio < 19 ? "FOLLOW_UP" : "NEW"; }
function fixturePassword(envName: string) { const value = process.env[envName] ?? ""; if (passwordPolicyError(value)) fail(`${envName} 不符合密碼政策。`); return value; }

async function previewReset(env: Environment) {
  const [users, years, classes, reviews, events, encounters, days] = await Promise.all([
    prisma.user.count(), prisma.academicYear.count(), prisma.schoolClass.count(), prisma.review.count(), prisma.reviewEvent.count(), prisma.studyEncounter.count(), prisma.studyDay.count(),
  ]);
  console.log(JSON.stringify({ environment: env, version: VERSION, warning: "這會徹底刪除本機名單及學習測試資料，只保留 Word 詞庫。", existingRows: { users, years, classes, reviews, events, encounters, days }, target: { classes: 18, rosterStudents: 144, specialStudents: 6 } }, null, 2));
}

async function clearLocalDemo(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`TRUNCATE TABLE "User", "AcademicYear", "RosterMutationState", "DatabaseMetadata" RESTART IDENTITY CASCADE`;
  await tx.rosterMutationState.create({ data: { id: 1, revision: 0, calendarRevision: 0 } });
  await tx.databaseMetadata.create({ data: { key: "environment", value: process.env.DATABASE_ENVIRONMENT! } });
  await tx.databaseMetadata.create({ data: { key: "demoAnalytics", value: "BUILDING" } });
}

async function createUser(tx: Prisma.TransactionClient, input: { accountName: string; legalName: string; nickname?: string; role: "STUDENT" | "TEACHER" | "ADMIN"; password: string; grade?: StudentGrade; classId?: string | null; studentNumber?: number | null; startedAt?: Date | null; canResetStudentPassword?: boolean }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  if (input.role === "STUDENT") {
    if (!input.grade || input.classId === undefined) fail("student fixture requires grade/class");
    return tx.user.create({ data: { accountName: input.accountName, accountNameCanonical: input.accountName, passwordHash, credentialRevision: 1, legacyName: input.legalName, role: "STUDENT", mustChangePassword: false, studentProfile: { create: { legalName: input.legalName, nickname: input.nickname ?? input.legalName, nicknameNormalized: (input.nickname ?? input.legalName).normalize("NFKC").toLowerCase(), enrollments: { create: { academicYearId: (await tx.academicYear.findFirstOrThrow({ where: { status: "CURRENT" }, select: { id: true } })).id, grade: input.grade, classId: input.classId, studentNumber: input.studentNumber ?? null, isCurrent: true, status: "ACTIVE", origin: "SEED", startedAt: input.startedAt ?? new Date() } } } } } });
  }
  if (input.role === "TEACHER") return tx.user.create({ data: { accountName: input.accountName, accountNameCanonical: input.accountName, passwordHash, credentialRevision: 1, legacyName: input.legalName, role: "TEACHER", mustChangePassword: false, teacherProfile: { create: { legalName: input.legalName, canResetStudentPassword: input.canResetStudentPassword ?? false } } } });
  return tx.user.create({ data: { accountName: input.accountName, accountNameCanonical: input.accountName, passwordHash, credentialRevision: 1, legacyName: input.legalName, role: "ADMIN", mustChangePassword: false } });
}

async function buildDemo() {
  const dates = currentAcademicYearDates();
  const anchor = todayKey();
  const start = todayKey(dates.startsOn) > anchor ? todayKey(dates.startsOn) : todayKey(dates.endsOn) < anchor ? todayKey(dates.endsOn) : todayKey(dates.startsOn);
  const effectiveEnd = todayKey(dates.endsOn) < anchor ? todayKey(dates.endsOn) : anchor;
  if (start > effectiveEnd) fail("目前學年沒有可建立示範資料的有效日期。");
  const effectiveStart = dateAt(offsetDay(effectiveEnd, -89)) > dates.startsOn ? offsetDay(effectiveEnd, -89) : start;
  const effectiveDays = dateDistance(effectiveStart, effectiveEnd) + 1;
  if (effectiveDays < 1) fail("示範資料日期範圍無效。");
  // The rich analytics fixture deliberately reuses the normal local test
  // identities and their existing env-owned credentials. It is the data
  // that is special, not a second set of "demo" accounts.
  const adminPassword = fixturePassword("INITIAL_ADMIN_PASSWORD");
  const teacherPassword = adminPassword;
  const studentPassword = fixturePassword("TEST_STUDENT_PASSWORD");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-analytics-reset-v1'))`;
    await clearLocalDemo(tx);
    const year = await tx.academicYear.create({ data: { ...dates, isCurrent: true, status: "CURRENT", revision: 1 } });
    const classMap = new Map<string, string>();
    for (const grade of STUDENT_GRADES) for (const code of ["A", "B", "C"] as const) {
      const row = await tx.schoolClass.create({ data: { academicYearId: year.id, grade, classCode: code, active: true, revision: 1 } });
      classMap.set(`${grade}:${code}`, row.id);
    }
    const admin = await createUser(tx, { accountName: "admin", legalName: "管理員", role: "ADMIN", password: adminPassword });
    const teachers = [];
    const teacherFixtures = [
      ["teacher", "王老師"],
      ["teacher-reset", "重設密碼測試老師"],
      ["teacher-analytics-3", "分析測試老師三"],
      ["teacher-analytics-4", "分析測試老師四"],
    ] as const;
    for (const [index, [accountName, name]] of teacherFixtures.entries()) teachers.push(await createUser(tx, { accountName, legalName: name, role: "TEACHER", password: teacherPassword, canResetStudentPassword: index < 3 }));
    for (const [index, teacher] of teachers.entries()) {
      const assigned = [...classMap.values()].filter((_, classIndex) => classIndex % teachers.length === index || (index === 0 && classIndex < 6));
      for (const classId of assigned) await tx.teacherClassAccess.create({ data: { teacherId: teacher.id, classId, canViewProgress: true, canResetStudentPassword: index < 3, grantedById: admin.id } });
    }
    const words = await tx.word.findMany({ take: 24, orderBy: { term: "asc" }, select: { id: true, term: true, level: true, definition: true } });
    if (!words.length) fail("Word 詞庫為空，請先執行標準 seed。");
    // Direct fixture writes still use the same V2 writer marker as production,
    // so the legacy Review trigger cannot create a second incomplete event.
    await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
    const students = [] as Array<{ id: string; grade: StudentGrade; classId: string; index: number }>;
    for (let classIndex = 0; classIndex < 18; classIndex += 1) {
      const grade = STUDENT_GRADES[Math.floor(classIndex / 3)]!; const code = ["A", "B", "C"][classIndex % 3] as ClassCode; const classId = classMap.get(`${grade}:${code}`)!;
      for (let studentIndex = 0; studentIndex < 8; studentIndex += 1) {
        const index = classIndex * 8 + studentIndex;
        const accountName = index === 0 ? "student-test" : index === 1 ? "student-test_webkit" : `student-${String(index + 1).padStart(3, "0")}`;
        const user = await createUser(tx, { accountName, legalName: `測試學生${String(index + 1).padStart(3, "0")}`, nickname: `學習者${String(index + 1).padStart(3, "0")}`, role: "STUDENT", password: studentPassword, grade, classId, studentNumber: studentIndex + 1, startedAt: dateAt(effectiveStart) });
        students.push({ id: user.id, grade, classId, index });
      }
    }
    const specialSpecs: Array<{ accountName: string; legalName: string; grade: StudentGrade; studentNumber: number; status?: "SUSPENDED"; classId?: string | null; startedAt?: Date }> = [
      { accountName: "student-unassigned", legalName: "未分班測試學生", grade: "JUNIOR_1", studentNumber: 1001, classId: null },
      { accountName: "student-new", legalName: "新加入測試學生", grade: "JUNIOR_1", studentNumber: 1002, classId: null, startedAt: dateAt(offsetDay(effectiveEnd, -2)) },
      { accountName: "student-quiet", legalName: "低活動測試學生", grade: "JUNIOR_2", studentNumber: 1003, classId: null },
      { accountName: "student-suspended", legalName: "停權測試學生", grade: "JUNIOR_3", studentNumber: 1004, classId: null, status: "SUSPENDED" },
      { accountName: "student-transfer", legalName: "轉班測試學生", grade: "SENIOR_1", studentNumber: 1005, classId: null },
      { accountName: "student-followup", legalName: "跟進測試學生", grade: "SENIOR_2", studentNumber: 1006, classId: null },
    ];
    const special = [] as string[];
    for (const spec of specialSpecs) {
      const user = await createUser(tx, { accountName: spec.accountName, legalName: spec.legalName, nickname: `測試${spec.legalName}`, role: "STUDENT", password: studentPassword, grade: spec.grade, classId: spec.classId ?? null, studentNumber: spec.studentNumber, startedAt: spec.startedAt ?? dateAt(effectiveStart) });
      if (spec.status) await tx.user.update({ where: { id: user.id }, data: { status: spec.status, suspendedAt: new Date(), tokenVersion: { increment: 1 }, revision: { increment: 1 } } });
      special.push(user.id);
    }
    const missingStudentNumbers = await tx.studentEnrollment.count({ where: { academicYearId: year.id, student: { user: { role: "STUDENT" } }, studentNumber: null } });
    if (missingStudentNumbers !== 0) fail(`示範資料有 ${missingStudentNumbers} 名學生未設定學號。`);
    for (const student of students) {
      const kind = archetype(student.index);
      const session = await tx.studySession.create({ data: { userId: student.id, queueFingerprint: hash(`${VERSION}:${student.id}`), expiresAt: dateAt(offsetDay(effectiveEnd, -1)), retiredAt: dateAt(effectiveEnd), flowVersion: "v2", learningPolicyVersion: "retrieval-v1", mode: "global", revision: 0 } });
      const reviewStates = new Map<string, ReviewState>();
      const reviewRevisions = new Map<string, number>();
      const reviewTotals = new Map<string, number>();
      for (let day = 0; day < effectiveDays; day += 1) {
        const date = offsetDay(effectiveStart, day);
        const participate = kind === "STEADY_HIGH" ? day % 2 === 0 : kind === "STEADY_GENERAL" ? day % 4 === 0 : kind === "IMPROVING" ? day > effectiveDays * 0.55 && day % 2 === 0 : kind === "INTERMITTENT" ? (day % 21) < 4 : kind === "FOLLOW_UP" ? day % 13 === 0 : day >= effectiveDays - 3;
        if (!participate) continue;
        const quality: Quality = kind === "FOLLOW_UP" || kind === "INTERMITTENT" && day % 3 === 0 ? 2 : 4;
        await tx.studyDay.upsert({ where: { userId_date: { userId: student.id, date } }, create: { userId: student.id, date, createdAt: dateAt(date, 18) }, update: {} });
        const word = words[(student.index + day) % words.length]!;
        const streamItemId = randomId("stream");
        const revealOperation = randomId("reveal");
        const operationId = randomId("encounter");
        const learningRevision = session.revision + 1;
        await tx.studyStreamItem.create({ data: { id: streamItemId, sessionId: session.id, streamItemKey: `${student.index}-${day}-card`, wordId: word.id, itemKind: "LEARNING_CARD", selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", status: "ACKNOWLEDGED", leaseExpiresAt: dateAt(date, 12), credentialDigest: hash(`${student.id}:${day}:card:digest`), credentialExpiresAt: dateAt(date, 12), credentialLineage: { version: 1, parentDigest: null, issuedAt: dateAt(date, 12).toISOString(), expiresAt: dateAt(date, 12).toISOString() }, revealedAt: dateAt(date, 12), usedAt: dateAt(date, 13), feedbackAcknowledgedAt: dateAt(date, 13), operationId, clientRevision: learningRevision } });
        await tx.operationReceipt.createMany({ data: [
          { userId: student.id, operationId: revealOperation, flowVersion: "v2", actionKind: "REVEAL", requestFingerprint: hash(`${streamItemId}:reveal`), outcomeStatus: "REVEALED", outcomeReference: streamItemId },
          { userId: student.id, operationId, flowVersion: "v2", actionKind: "SELF_RATING", requestFingerprint: hash(`${streamItemId}:self-rating`), outcomeStatus: "COMMITTED", outcomeReference: streamItemId },
        ] });
        await tx.studyEncounter.create({ data: { userId: student.id, wordId: word.id, streamItemId, operationId, selfRating: quality === 4 ? "KNOWN" : "NOT_SURE", selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", requiresVerification: false, acknowledgedAt: dateAt(date, 13), createdAt: dateAt(date, 13) } });
        session.revision = learningRevision;
        if ((day + student.index) % 3 === 0) {
          const eventId = randomId("event"); const targetId = randomId("target"); const snapshotId = randomId("snapshot"); const obligationId = randomId("obligation"); const answerOperation = randomId("answer"); const feedbackOperation = randomId("feedback");
          const expectedRevision = reviewRevisions.get(word.id) ?? 0;
          await tx.evidenceObligation.create({ data: { id: obligationId, userId: student.id, wordId: word.id, kind: "EVIDENCE_OBLIGATION", status: "ANSWERED", sourceOperationId: operationId, selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", eligibleAt: dateAt(date, 14), expiresAt: dateAt(date, 23), answeredAt: dateAt(date, 15), terminalReason: "answered" } });
          await tx.objectiveEvidenceTarget.create({ data: { id: targetId, userId: student.id, wordId: word.id, purpose: "DUE_REVIEW", expectedReviewRevision: expectedRevision, policyVersion: RETRIEVAL_POLICY_VERSION, itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, status: "CONSUMED", obligationId, winningOperationId: answerOperation, winningReviewEventId: eventId, consumedAt: dateAt(date, 15) } });
          await tx.objectiveQuestionSnapshot.create({ data: { id: snapshotId, targetId, wordId: word.id, prompt: word.term, wordTerm: word.term, wordDefinition: word.definition, direction: "TERM_TO_DEFINITION", options: [{ id: "a", text: word.definition }, { id: "b", text: "其他答案" }, { id: "c", text: "未選答案" }, { id: "d", text: "示範選項" }], correctOptionId: "a", contentVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, createdAt: dateAt(date, 14) } });
          const answerRevision = session.revision + 1;
          const objectiveItemId = randomId("stream");
          await tx.studyStreamItem.create({ data: { id: objectiveItemId, sessionId: session.id, streamItemKey: `${student.index}-${day}-objective`, wordId: word.id, itemKind: "OBJECTIVE_PROBE", selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", status: "ACKNOWLEDGED", leaseExpiresAt: dateAt(date, 14), credentialDigest: hash(`${student.id}:${day}:objective:digest`), credentialExpiresAt: dateAt(date, 14), credentialLineage: { version: 1, parentDigest: null, issuedAt: dateAt(date, 14).toISOString(), expiresAt: dateAt(date, 14).toISOString() }, usedAt: dateAt(date, 15), feedbackAcknowledgedAt: dateAt(date, 16), operationId: answerOperation, clientRevision: answerRevision, objectiveEvidenceTargetId: targetId, objectiveQuestionSnapshotId: snapshotId, workObligationId: obligationId } });
          const previous = reviewStates.get(word.id) ?? createInitialState();
          const nextState = updateSM2At(previous, quality, dateAt(date, 15));
          const nextTotal = (reviewTotals.get(word.id) ?? 0) + 1;
          if (reviewRevisions.has(word.id)) await tx.review.update({ where: { userId_wordId: { userId: student.id, wordId: word.id } }, data: { ...nextState, revision: expectedRevision + 1, totalReviews: nextTotal } });
          else await tx.review.create({ data: { userId: student.id, wordId: word.id, ...nextState, revision: 1, totalReviews: nextTotal } });
          reviewStates.set(word.id, nextState); reviewRevisions.set(word.id, expectedRevision + 1); reviewTotals.set(word.id, nextTotal);
          await tx.reviewEvent.create({ data: { id: eventId, operationId: answerOperation, userId: student.id, submittedWordId: word.id, wordId: word.id, wordTerm: word.term, wordLevel: word.level, quality, evidenceKind: "OBJECTIVE_PROBE", flowVersion: "v2", qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION, probePurpose: "DUE_REVIEW", itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, objectiveEvidenceTargetId: targetId, objectiveQuestionSnapshotId: snapshotId, createdAt: dateAt(date, 15) } });
          if (quality === 2) await tx.evidenceObligation.create({ data: { id: randomId("remediation"), userId: student.id, wordId: word.id, kind: "REMEDIATION", status: "EXPIRED", sourceOperationId: answerOperation, selectionReason: "self-forgot-remediation", policyVersion: "retrieval-v1", eligibleAt: dateAt(date, 15), expiresAt: dateAt(date, 15), answeredAt: null, terminalReason: "demo-expired" } });
          await tx.operationReceipt.createMany({ data: [
            { userId: student.id, operationId: answerOperation, flowVersion: "v2", actionKind: "ANSWER", requestFingerprint: hash(`${targetId}:answer`), outcomeStatus: "COMMITTED", outcomeReference: eventId },
            { userId: student.id, operationId: feedbackOperation, flowVersion: "v2", actionKind: "FEEDBACK_ACK", requestFingerprint: hash(`${targetId}:feedback`), outcomeStatus: "COMMITTED", outcomeReference: objectiveItemId },
          ] });
          session.revision = answerRevision + 1;
        }
      }
      await tx.studySession.update({ where: { id: session.id }, data: { revision: session.revision } });
    }
    await tx.databaseMetadata.update({ where: { key: "demoAnalytics" }, data: { value: VERSION } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
  console.log(`示範資料已建立：18 個班、144 名班內學生、6 名特殊學生、${effectiveDays} 日活動。`);
}

function dateDistance(from: string, to: string) { const [fy, fm, fd] = from.split("-").map(Number); const [ty, tm, td] = to.split("-").map(Number); return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000); }

async function main() {
  const env = requireLocalEnvironment();
  if (!preview && !rebuild) fail("請指定 --preview-reset 或 --reset-and-rebuild。");
  if (preview) await previewReset(env);
  if (rebuild) { if (!confirmed) fail("破壞性示範資料重建需要 --confirm-local-demo-reset。"); await buildDemo(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "示範資料建立失敗"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
