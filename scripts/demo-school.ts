import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { DEMO_VERSION, demoId, schoolRoster, simulateStudent, type DemoStudent, type SimAction } from "../src/lib/demo-school";
import { currentAcademicYearDates } from "../src/lib/roster-domain";
import { offsetDay, todayKey } from "../src/lib/streak";
import { currentCatalogWordWhere, isEligibleOperationalObjectiveEvent } from "../src/lib/catalog/runtime";
import { buildObjectiveQuestion } from "../src/lib/learning-policy/question";
import { RETRIEVAL_POLICY_VERSION, OBJECTIVE_ITEM_CONSTRUCTION_VERSION, OBJECTIVE_QUALITY_POLICY_VERSION } from "../src/lib/learning-policy/types";
import { passwordPolicyError } from "../src/lib/password-policy";

dotenv.config({ path: ".env.local", quiet: true });
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  seed: { type: "string" }, days: { type: "string" }, "as-of": { type: "string" },
  "confirm-reset": { type: "boolean" }, "dry-run": { type: "boolean" },
} });
const command = positionals[0];
if (positionals.length !== 1 || !["init", "update", "check"].includes(command)) throw new Error("使用 demo:init、demo:update 或 demo:check。");
if (command !== "init" && (values.seed || values.days || values["confirm-reset"])) throw new Error("seed、days 及 confirm-reset 只適用於初始化。");
if (command === "check" && (values["as-of"] || values["dry-run"])) throw new Error("check 會核對已儲存的 checkpoint，不接受日期或 dry-run 選項。");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!process.env.MIGRATE_URL || !["development", "test"].includes(environment ?? "") || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) throw new Error("需要 MIGRATE_URL 及相同 development/test 環境確認。");
const target = new URL(process.env.MIGRATE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("只容許本機資料庫。");
const asOf = values["as-of"] ? new Date(values["as-of"]) : new Date();
if (!Number.isFinite(asOf.getTime()) || asOf.getTime() > Date.now() || (values["as-of"] && !/(Z|[+-]\d{2}:\d{2})$/.test(values["as-of"]))) throw new Error("as-of 必須有時區、有效且不在未來。");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });
const manifestKey = "demoSchool:manifest";
type Manifest = { version: string; seed: string; start: string; yearId: string; yearEnd: string; catalog: string; students: Array<DemoStudent & { userId: string; account: string; classId: string }> };
type Checkpoint = { count: number; asOf: string };
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const at = (v: number) => new Date(v);
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const wordsQuery = { where: currentCatalogWordWhere(), orderBy: { senseKey: "asc" as const } };
type Word = Awaited<ReturnType<typeof loadWords>>[number];
async function loadWords() { return prisma.word.findMany(wordsQuery); }
function catalogHash(words: Awaited<ReturnType<typeof loadWords>>) { return hash(JSON.stringify(words.map(w => [w.id, w.senseId, w.contentRevisionId, w.catalogRevisionId, w.level, w.category]))); }
async function guard(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demo-school-v1'))`;
  const marker = await tx.databaseMetadata.findUnique({ where: { key: "environment" } });
  if (marker?.value !== environment) throw new Error("持久資料庫環境 marker 不一致，已拒絕寫入。");
}
async function initialize(words: Word[]) {
  const seed = values.seed ?? "school-2026";
  const days = Number(values.days ?? 90);
  if (!seed.trim() || seed.length > 100 || !Number.isInteger(days) || days < 1 || days > 90) throw new Error("seed 必須 1–100 字；days 必須 1–90。");
  const year = currentAcademicYearDates(asOf);
  const start = [offsetDay(todayKey(asOf), -(days - 1)), todayKey(year.startsOn)].sort().at(-1)!;
  const roster = schoolRoster(seed);
  console.log(JSON.stringify({ target: { host: target.hostname, database: target.pathname.slice(1), schema: target.searchParams.get("schema") ?? "public" }, seed, start, asOf: asOf.toISOString(), classes: 18, students: roster.length, replaces: "本機帳戶、名冊及學習資料；保留詞庫" }));
  if (values["dry-run"]) return;
  if (!values["confirm-reset"]) throw new Error("初始化替換舊示範資料需要 --confirm-reset。");
  for (const key of ["INITIAL_ADMIN_PASSWORD", "TEST_STUDENT_PASSWORD"]) if (passwordPolicyError(process.env[key] ?? "")) throw new Error(`${key} 不符合密碼政策。`);
  const adminHash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD!, 12);
  const loginHash = await bcrypt.hash(process.env.TEST_STUDENT_PASSWORD!, 12);
  const studentHashes: string[] = [];
  for (let i = 0; i < roster.length; i += 8) studentHashes.push(...await Promise.all(roster.slice(i, i + 8).map((_, j) => i+j < 2 ? Promise.resolve(loginHash) : bcrypt.hash(randomBytes(24).toString("base64url"), 10))));
  await prisma.$transaction(async tx => {
    await guard(tx);
    await tx.$executeRaw`TRUNCATE TABLE "User", "AcademicYear", "RosterMutationState" RESTART IDENTITY CASCADE`;
    await tx.databaseMetadata.deleteMany({ where: { OR: [{ key: { startsWith: "demoSchool:" } }, { key: "demoAnalytics" }, { key: { startsWith: "studentTemporaryCredential:" } }] } });
    await tx.rosterMutationState.create({ data: { id: 1, revision: 0, calendarRevision: 0 } });
    const academic = await tx.academicYear.create({ data: { ...year, isCurrent: true, status: "CURRENT" } });
    const admin = await tx.user.create({ data: { accountName: "admin", accountNameCanonical: "admin", passwordHash: adminHash, credentialRevision: 1, role: "ADMIN", legacyName: "管理員", mustChangePassword: false } });
    const teachers = [];
    for (const [i, name] of ["王雅雯", "陳志謙", "梁慧敏", "黃文軒", "李嘉穎", "何俊賢"].entries()) {
      const account = i === 0 ? "teacher" : i === 1 ? "teacher-reset" : `teacher-school-${i+1}`;
      teachers.push(await tx.user.create({ data: { accountName: account, accountNameCanonical: account, passwordHash: adminHash, credentialRevision: 1, role: "TEACHER", legacyName: name, mustChangePassword: false, teacherProfile: { create: { legalName: name, canResetStudentPassword: i === 1 } } } }));
    }
    const classes = new Map<number, string>();
    for (const s of roster) if (!classes.has(s.classIndex)) {
      const c = await tx.schoolClass.create({ data: { academicYearId: academic.id, grade: s.grade, classCode: s.code, active: true } });
      classes.set(s.classIndex, c.id);
      await tx.teacherClassAccess.create({ data: { teacherId: teachers[Math.floor(s.classIndex / 3)].id, classId: c.id, canViewProgress: true, canResetStudentPassword: Math.floor(s.classIndex / 3) === 1, grantedById: admin.id } });
    }
    const students: Manifest["students"] = [];
    const accounts = [process.env.TEST_STUDENT_USERNAME ?? "student-test", process.env.TEST_STUDENT_WEBKIT_USERNAME ?? "student-test_webkit"];
    if (new Set(accounts).size !== 2 || accounts.some(a => !/^(student-test|__test_student__)[A-Za-z0-9._-]*$/.test(a) || a.length > 64)) throw new Error("測試登入帳戶必須不同且使用保留前綴。");
    for (const [i, s] of roster.entries()) {
      const account = i < 2 ? accounts[i] : `school-${String(s.classIndex+1).padStart(2,"0")}-${String(s.number).padStart(2,"0")}`;
      const classId = classes.get(s.classIndex)!;
      const startedAt = new Date(`${offsetDay(start, s.joinDelay)}T00:00:00+08:00`);
      const u = await tx.user.create({ data: { accountName: account, accountNameCanonical: account, passwordHash: studentHashes[i], credentialRevision: 1, legacyName: s.name, role: "STUDENT", mustChangePassword: false,
        studentProfile: { create: { legalName: s.name, nickname: s.name, nicknameNormalized: s.name.normalize("NFKC").toLowerCase(), enrollments: { create: { academicYearId: academic.id, grade: s.grade, classId, studentNumber: s.number, status: "ACTIVE", isCurrent: true, origin: "SEED", startedAt } } } } } });
      students.push({ ...s, userId: u.id, account, classId });
    }
    const manifest: Manifest = { version: DEMO_VERSION, seed, start, yearId: academic.id, yearEnd: todayKey(year.endsOn), catalog: catalogHash(words), students };
    await tx.databaseMetadata.create({ data: { key: manifestKey, value: JSON.stringify(manifest) } });
  }, { isolationLevel: "Serializable", timeout: 120000 });
}

async function writeActions(tx: Prisma.TransactionClient, student: Manifest["students"][number], model: ReturnType<typeof simulateStudent>, from: number, words: Word[]) {
  const userId = student.userId;
  const byId = new Map(words.map(w => [w.id, w]));
  const added = model.actions.slice(from);
  const sessionActions = new Map<string, SimAction[]>();
  for (const a of model.actions) { const list = sessionActions.get(a.sessionKey) ?? []; list.push(a); sessionActions.set(a.sessionKey, list); }
  for (const key of new Set(added.map(a => a.sessionKey))) {
    const list = sessionActions.get(key)!;
    const data = { revision: list.reduce((n,a) => n + (a.kind === "LEARNING_CARD" ? 1 : 2), 0), retiredAt: at(list.at(-1)!.end), expiresAt: at(list.at(-1)!.end) };
    await tx.studySession.upsert({ where: { id: demoId(`${userId}:${key}`) }, create: { id: demoId(`${userId}:${key}`), userId, queueFingerprint: hash(key), flowVersion: "v2", mode: "global", catalogReadMode: "SENSE_V1", learningPolicyVersion: RETRIEVAL_POLICY_VERSION, createdAt: at(list[0].start), ...data }, update: data });
  }
  // Persist terminal and legitimately pending work; never invent an early expiry.
  for (const w of model.work) {
    const word = byId.get(w.wordId)!;
    const data = { status: w.status, answeredAt: w.answeredAt ? at(w.answeredAt) : null, terminalReason: w.status === "EXPIRED" ? "age-limit" : null, activeKey: w.status === "PENDING" ? `${userId}:${w.wordId}:${w.kind}` : null };
    await tx.evidenceObligation.upsert({ where: { id: w.id }, create: { id: w.id, userId, wordId: w.wordId, senseId: word.senseId, kind: w.kind, sourceOperationId: w.sourceOperationId, selectionReason: "demo-policy-admission", policyVersion: RETRIEVAL_POLICY_VERSION, eligibleAt: at(w.eligibleAt), expiresAt: at(w.expiresAt), admittedAt: at(w.admittedAt), createdAt: at(w.admittedAt), ...data }, update: data });
  }
  const items: Prisma.StudyStreamItemCreateManyInput[] = [], encounters: Prisma.StudyEncounterCreateManyInput[] = [], events: Prisma.ReviewEventCreateManyInput[] = [], receipts: Prisma.OperationReceiptCreateManyInput[] = [];
  const targets: Prisma.ObjectiveEvidenceTargetCreateManyInput[] = [], snapshots: Prisma.ObjectiveQuestionSnapshotCreateManyInput[] = [];
  const revisions = new Map<string, number>();
  for (const a of model.actions) {
    const prior = revisions.get(a.sessionKey) ?? 0;
    revisions.set(a.sessionKey, prior + (a.kind === "LEARNING_CARD" ? 1 : 2));
    if (!added.includes(a)) continue;
    const w = byId.get(a.wordId)!;
    const sessionId = demoId(`${userId}:${a.sessionKey}`);
    const targetId = `${a.id}:target`, snapshotId = `${a.id}:snapshot`, eventId = `${a.id}:event`;
    const objective = a.kind === "OBJECTIVE_PROBE";
    const item = { id: a.id, sessionId, streamItemKey: a.id, wordId: w.id, senseId: w.senseId, itemKind: a.kind, selectionReason: a.reason, selectionOverrideReason: a.override, policyVersion: RETRIEVAL_POLICY_VERSION, status: "ACKNOWLEDGED", createdAt: at(a.start), leaseExpiresAt: at(a.end), credentialDigest: hash(a.id), credentialExpiresAt: at(a.end), credentialLineage: json({ version: 1, parentDigest: null, issuedAt: at(a.start).toISOString(), expiresAt: at(a.end).toISOString() }), revealedAt: objective ? null : at(a.reveal), usedAt: at(a.answer), feedbackAcknowledgedAt: at(a.end), operationId: `${a.id}:answer`, clientRevision: prior + 1, workObligationId: a.workId ?? null };
    items.push({ ...item, feedbackAcknowledgedAt: at(objective ? a.end : a.answer), objectiveEvidenceTargetId: objective ? targetId : null, objectiveQuestionSnapshotId: objective ? snapshotId : null });
    if (objective) {
      const q = buildObjectiveQuestion({ ...w, curatedDistractorsZh: w.distractorZh, curatedDistractorsEn: w.distractorEn }, [], a.id);
      if (!q) throw new Error(`詞條無法出題：${w.senseKey}`);
      targets.push({ id: targetId, userId, wordId: w.id, senseId: w.senseId, purpose: a.purpose!, expectedReviewRevision: a.before?.revision ?? 0, policyVersion: RETRIEVAL_POLICY_VERSION, itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, status: "CONSUMED", obligationId: a.workId, winningOperationId: `${a.id}:answer`, winningReviewEventId: eventId, consumedAt: at(a.answer), createdAt: at(a.start) });
      snapshots.push({ id: snapshotId, targetId, wordId: w.id, senseId: w.senseId, contentRevisionId: w.contentRevisionId, catalogRevisionId: w.catalogRevisionId, prompt: q.prompt, wordTerm: q.wordTerm, wordDefinition: q.wordDefinition, direction: q.direction, options: json(q.options), correctOptionId: q.correctOptionId, contentVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, createdAt: at(a.start) });
      events.push({ id: eventId, operationId: `${a.id}:answer`, userId, submittedWordId: w.id, wordId: w.id, senseId: w.senseId, submittedSenseId: w.senseId, senseKey: w.senseKey, contentRevisionId: w.contentRevisionId, catalogRevisionId: w.catalogRevisionId, wordTerm: w.term, wordLevel: w.level, quality: a.correct ? 4 : 2, evidenceKind: "OBJECTIVE_PROBE", flowVersion: "v2", qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION, probePurpose: a.purpose, itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION, objectiveEvidenceTargetId: targetId, objectiveQuestionSnapshotId: snapshotId, createdAt: at(a.answer) });
    } else encounters.push({ userId, wordId: w.id, senseId: w.senseId, streamItemId: a.id, operationId: `${a.id}:answer`, selfRating: a.selfRating, selectionReason: a.reason, policyVersion: RETRIEVAL_POLICY_VERSION, requiresVerification: Boolean(a.admittedWorkId), evidenceObligationId: a.admittedWorkId, createdAt: at(a.answer), acknowledgedAt: at(a.answer) });
    receipts.push({ userId, operationId: `${a.id}:answer`, flowVersion: "v2", actionKind: objective ? "ANSWER" : "SELF_RATING", requestFingerprint: hash(`${a.id}:answer`), outcomeStatus: "COMMITTED", outcomeReference: objective ? eventId : a.id, createdAt: at(a.answer) }, { userId, operationId: `${a.id}:${objective ? "feedback" : "reveal"}`, flowVersion: "v2", actionKind: objective ? "FEEDBACK_ACK" : "REVEAL", requestFingerprint: hash(`${a.id}:secondary`), outcomeStatus: objective ? "COMMITTED" : "REVEALED", outcomeReference: a.id, createdAt: at(objective ? a.end : a.reveal) });
  }
  await tx.objectiveEvidenceTarget.createMany({ data: targets });
  await tx.objectiveQuestionSnapshot.createMany({ data: snapshots });
  await tx.studyStreamItem.createMany({ data: items });
  await tx.studyEncounter.createMany({ data: encounters });
  await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
  for (const wordId of new Set(added.filter(a => a.after).map(a => a.wordId))) {
    const r = model.reviews.get(wordId)!;
    const data = { ...r, totalReviews: r.revision, senseId: byId.get(wordId)!.senseId };
    await tx.review.upsert({ where: { userId_wordId: { userId, wordId } }, create: { userId, wordId, ...data }, update: data });
  }
  await tx.reviewEvent.createMany({ data: events });
  await tx.operationReceipt.createMany({ data: receipts });
  const days = new Map<string, Date>();
  for (const a of added) { const d = todayKey(at(a.answer)); if (!days.has(d)) days.set(d, at(a.answer)); }
  await tx.studyDay.createMany({ data: [...days].map(([date, createdAt]) => ({ userId, date, createdAt })), skipDuplicates: true });
}

async function main() {
  const words = await loadWords();
  if (!words.length) throw new Error("先建立 READY 詞庫。");
  await prisma.$transaction(guard);
  if (command === "init") { await initialize(words); if (values["dry-run"]) return; }
  const raw = await prisma.databaseMetadata.findUnique({ where: { key: manifestKey } });
  if (!raw) throw new Error("先執行 demo:init。");
  const manifest = JSON.parse(raw.value) as Manifest;
  if (manifest.version !== DEMO_VERSION || manifest.catalog !== catalogHash(words)) throw new Error("模擬版本／詞庫有變，拒絕改寫歷史；需要重新初始化。");
  if (todayKey(asOf) > manifest.yearEnd || todayKey(asOf) < manifest.start) throw new Error("日期不在示範學年／開始日期範圍；跨學年需另行初始化。");
  const reward = command === "check" ? await import("../src/lib/learning-reward-analytics") : null;
  let appended = 0, total = 0, objectiveTotal = 0, checkedAsOf: string | undefined;
  for (const [index, student] of manifest.students.entries()) {
    const checkpointKey = `demoSchool:student:${student.userId}`;
    await prisma.$transaction(async tx => {
      await guard(tx);
      if ((await tx.databaseMetadata.findUniqueOrThrow({ where: { key: manifestKey } })).value !== raw.value) throw new Error("初始化已改變 manifest，請重跑。");
      const record = await tx.databaseMetadata.findUnique({ where: { key: checkpointKey } });
      if (command === "check") assert.ok(record, "尚有學生未完成初始化；執行 demo:update 續跑。");
      const cp: Checkpoint = record ? JSON.parse(record.value) as Checkpoint : { count: 0, asOf: `${manifest.start}T00:00:00+08:00` };
      if (command === "check") {
        checkedAsOf ??= cp.asOf;
        assert.equal(cp.asOf, checkedAsOf, "尚未完成全校更新；執行 demo:update 續跑。");
        assert.ok(new Date(cp.asOf).getTime() <= Date.now());
      }
      const until = command === "check" ? new Date(cp.asOf) : asOf;
      if (until < new Date(cp.asOf)) throw new Error("不能倒退更新時間。");
      const user = await tx.user.findUniqueOrThrow({ where: { id: student.userId }, include: { studentProfile: { include: { enrollments: true } } } });
      assert.equal(user.accountName, student.account); assert.equal(user.status, "ACTIVE");
      assert.equal(user.studentProfile?.legalName, student.name);
      const enrollment = user.studentProfile?.enrollments.find(e => e.isCurrent);
      assert.equal(enrollment?.classId, student.classId); assert.equal(enrollment?.studentNumber, student.number);
      assert.equal(enrollment?.grade, student.grade); assert.equal(enrollment?.academicYearId, manifest.yearId);
      const itemCount = await tx.studyStreamItem.count({ where: { session: { userId: student.userId } } });
      assert.equal(itemCount, cp.count, `${student.account} 有手動學習／checkpoint 衝突，未覆寫`);
      if (command === "update" && record && until.getTime() === new Date(cp.asOf).getTime()) { total += cp.count; return; }
      const model = simulateStudent(manifest.seed, student, words, manifest.start, until);
      const previousActions = model.actions.filter(a => a.end <= new Date(cp.asOf).getTime());
      assert.equal(previousActions.length, cp.count);
      const previousReviews = new Map(previousActions.filter(a => a.after).map(a => [a.wordId, a.after!]));
      const actualReviews = await tx.review.findMany({ where: { userId: student.userId } });
      assert.equal(actualReviews.length, previousReviews.size);
      for (const row of actualReviews) {
        const expected = previousReviews.get(row.wordId)!;
        assert.ok(expected);
        for (const field of ["revision", "totalReviews", "repetitions", "interval", "easeFactor"] as const) assert.equal(row[field], field === "totalReviews" ? expected.revision : expected[field]);
        assert.equal(row.nextReviewDate.getTime(), expected.nextReviewDate.getTime());
        assert.equal(row.lastReviewedAt?.getTime(), expected.lastReviewedAt?.getTime());
      }
      total += model.actions.length;
      if (command === "check") {
        const probeCount = model.actions.filter(a => a.kind === "OBJECTIVE_PROBE").length;
        objectiveTotal += probeCount;
        assert.equal(await tx.reviewEvent.count({ where: { userId: student.userId } }), probeCount);
        const scored = await tx.reviewEvent.findMany({ where: { userId: student.userId }, include: { objectiveEvidenceTarget: { include: { questionSnapshot: true, obligation: true } } } });
        for (const event of scored) assert.ok(isEligibleOperationalObjectiveEvent(event), `報表不接受 ${event.id}`);
        assert.equal(await tx.studyEncounter.count({ where: { userId: student.userId } }), cp.count - probeCount);
        assert.equal(await tx.operationReceipt.count({ where: { userId: student.userId } }), cp.count * 2);
        assert.equal(await tx.studyDay.count({ where: { userId: student.userId } }), new Set(model.actions.map(a => todayKey(at(a.answer)))).size);
        const actual = await tx.studyStreamItem.findMany({ where: { session: { userId: student.userId } }, include: { objectiveEvidenceTarget: true, objectiveQuestionSnapshot: true } });
        const expected = new Map(model.actions.map(a => [a.id, a]));
        for (const row of actual) {
          const a = expected.get(row.id)!; assert.ok(a); assert.equal(row.usedAt?.getTime(), a.answer); assert.equal(row.createdAt.getTime(), a.start);
          assert.equal(row.status, "ACKNOWLEDGED");
          if (a.kind === "LEARNING_CARD") { assert.equal(row.feedbackAcknowledgedAt?.getTime(), a.answer); assert.equal(row.revealedAt?.getTime(), a.reveal); }
          if (a.kind === "OBJECTIVE_PROBE") { assert.equal(row.objectiveEvidenceTarget?.winningOperationId, `${a.id}:answer`); assert.equal(row.objectiveEvidenceTarget?.obligationId ?? undefined, a.workId); assert.ok(row.objectiveQuestionSnapshot); }
        }
        const actualWork = await tx.evidenceObligation.findMany({ where: { userId: student.userId } });
        assert.equal(actualWork.length, model.work.length);
        for (const w of actualWork) {
          const expectedWork = model.work.find(m => m.id === w.id)!; assert.ok(expectedWork);
          assert.equal(w.status, expectedWork.status);
          assert.equal(w.eligibleAt.getTime(), expectedWork.eligibleAt);
          assert.equal(w.expiresAt.getTime(), expectedWork.expiresAt);
          assert.equal(w.answeredAt?.getTime(), expectedWork.answeredAt);
        }
        if (reward) {
          const to = todayKey(until);
          const activity = await reward.loadRewardActivityForMembers(tx, { memberIds: [student.userId], from: manifest.start, to, asOf: until });
          const report = reward.buildStudentReward({ member: { id: student.userId, accountName: student.account, studentNumber: student.number, legalName: student.name, nickname: student.name, grade: student.grade, classId: student.classId, classCode: student.code, startedAt: enrollment!.startedAt }, activity,
            range: { requestedFrom: manifest.start, requestedTo: to, from: manifest.start, to, rangeClamped: false, timezone: "Asia/Shanghai" }, weights: { effort: 50, outcome: 50 } });
          assert.equal(report.total.coverage.validationGapCount, 0);
          assert.equal(report.total.coverage.studyDayMismatchCount, 0);
          assert.equal(report.total.coverage.sources.reviews.included, probeCount);
          assert.equal(report.total.coverage.sources.encounters.included, cp.count - probeCount);
        }
      } else if (!values["dry-run"] && (!record || until.toISOString() !== new Date(cp.asOf).toISOString())) {
        await writeActions(tx, student, model, cp.count, words);
        await tx.databaseMetadata.upsert({ where: { key: checkpointKey }, create: { key: checkpointKey, value: JSON.stringify({ count: model.actions.length, asOf: until.toISOString() }) }, update: { value: JSON.stringify({ count: model.actions.length, asOf: until.toISOString() }) } });
      }
      appended += model.actions.length - cp.count;
    }, { isolationLevel: "Serializable", timeout: 120000 });
    if ((index+1) % 50 === 0) console.log(`${command}: ${index+1}/${manifest.students.length} 名學生完成`);
  }
  console.log(JSON.stringify({ ready: true, command, dryRun: Boolean(values["dry-run"]), students: manifest.students.length, classes: 18, actions: total, ...(command === "check" ? { objectives: objectiveTotal, encounters: total-objectiveTotal, reportValidationGaps: 0 } : {}), appended, start: manifest.start, asOf: checkedAsOf ?? asOf.toISOString() }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "示範資料處理失敗"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
