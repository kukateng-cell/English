import dotenv from "dotenv";
import fs from "node:fs";
import * as OpenCC from "opencc-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

dotenv.config({ path: ".env.local" });
dotenv.config();

if (!process.env.MIGRATE_URL) throw new Error("檢查示範資料必須顯式設定 MIGRATE_URL。");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

function fail(message: string): never { throw new Error(message); }

async function main() {
  const marker = await prisma.databaseMetadata.findUnique({ where: { key: "demoAnalytics" } });
  if (marker?.value !== "demo-analytics-v3-csv-sense") fail("示範資料 READY 標記不存在。");
  const year = await prisma.academicYear.findFirst({ where: { status: "CURRENT" }, select: { id: true } });
  if (!year) fail("找不到 CURRENT 學年。");
  const classes = await prisma.schoolClass.findMany({ where: { academicYearId: year.id, active: true }, select: { id: true, grade: true, classCode: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } });
  if (classes.length !== 18 || classes.some((row) => row._count.enrollments !== 8)) fail("18 班或每班 8 名 ACTIVE 學生驗證失敗。");
  const [catalogRows, catalogSenses, students, teachers, events, encounters, days, openTargets, openObligations, liveSessions, liveItems, learningItems, objectiveTargets, remediationObligations, receipts, requiredAccounts] = await Promise.all([
    prisma.word.count({ where: { senseId: { not: null } } }),
    prisma.wordSense.count({ where: { wordProjection: { isNot: null } } }),
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.user.count({ where: { role: "TEACHER" } }),
    prisma.reviewEvent.count({ where: { flowVersion: "v2", senseId: { not: null }, isHistorical: false } }),
    prisma.studyEncounter.count({ where: { senseId: { not: null } } }),
    prisma.studyDay.count(),
    prisma.objectiveEvidenceTarget.count({ where: { status: "OPEN" } }),
    prisma.evidenceObligation.count({ where: { status: { in: ["PENDING", "LEASED"] } } }),
    prisma.studySession.count({ where: { retiredAt: null } }),
    prisma.studyStreamItem.count({ where: { status: { in: ["LEASED", "ANSWERED"] } } }),
    prisma.studyStreamItem.count({ where: { itemKind: "LEARNING_CARD", status: "ACKNOWLEDGED" } }),
    prisma.objectiveEvidenceTarget.findMany({ select: { id: true, status: true, purpose: true, policyVersion: true, itemConstructionVersion: true, senseId: true, obligationId: true, winningOperationId: true, winningReviewEventId: true, obligation: { select: { status: true } }, questionSnapshot: { select: { id: true, senseId: true, direction: true, options: true, correctOptionId: true } }, streamItems: { select: { id: true, status: true, senseId: true, objectiveEvidenceTargetId: true, objectiveQuestionSnapshotId: true, workObligationId: true, clientRevision: true } }, reviewEvents: { select: { id: true, operationId: true, senseId: true } } } }),
    prisma.evidenceObligation.count({ where: { kind: "REMEDIATION", status: { notIn: ["ANSWERED", "EXPIRED"] } } }),
    prisma.operationReceipt.groupBy({ by: ["actionKind"], _count: { _all: true } }),
    prisma.user.findMany({ where: { accountName: { in: ["admin", "teacher", "teacher-reset", "teacher-analytics-3", "teacher-analytics-4", "student-test", "student-test_webkit"] } }, select: { accountName: true, role: true, status: true } }),
  ]);
  if (catalogRows < 5000 || catalogRows !== catalogSenses || students !== 150 || teachers < 4 || events === 0 || encounters === 0 || days === 0) fail("CSV sense catalog、示範帳號或學習 ledger 數量不符合預期。");
  const requiredAccountNames = new Set(requiredAccounts.map((row) => row.accountName));
  if (["admin", "teacher", "teacher-reset", "teacher-analytics-3", "teacher-analytics-4", "student-test", "student-test_webkit"].some((accountName) => !requiredAccountNames.has(accountName))) fail("標準本機測試帳號未完整建立。");
  if (openTargets || openObligations || liveSessions || liveItems) fail("示範資料仍有可續接的學習狀態。");
  if (learningItems !== encounters) fail("Learning Card 與 StudyEncounter 未能一一對應。");
  for (const target of objectiveTargets) {
    const stream = target.streamItems.length === 1 ? target.streamItems[0] : null;
    const winner = target.reviewEvents.filter((event) => event.id === target.winningReviewEventId && event.operationId === target.winningOperationId);
    const options = target.questionSnapshot?.options;
    const validOptions = Array.isArray(options) && options.length === 4 && typeof target.questionSnapshot?.correctOptionId === "string";
    const directionValid = target.questionSnapshot?.direction === "en-zh" || target.questionSnapshot?.direction === "zh-en";
    const obligationValid = target.purpose === "DUE_REVIEW"
      ? target.obligationId === null && target.obligation === null
      : target.purpose === "EVIDENCE_OBLIGATION" && Boolean(target.obligationId) && target.obligation?.status === "ANSWERED";
    const streamObligationValid = target.purpose === "DUE_REVIEW"
      ? stream?.workObligationId === null
      : stream?.workObligationId === target.obligationId;
    if (target.status !== "CONSUMED" || target.policyVersion !== "retrieval-v1" || target.itemConstructionVersion !== "retrieval-v1-mcq-curated-v2" || !target.senseId || !obligationValid || !target.questionSnapshot || target.questionSnapshot.senseId !== target.senseId || !directionValid || !validOptions || !target.winningOperationId || !target.winningReviewEventId || winner.length !== 1 || winner[0]?.senseId !== target.senseId || !stream || !stream.senseId || stream.senseId !== target.senseId || stream.status !== "ACKNOWLEDGED" || stream.objectiveEvidenceTargetId !== target.id || stream.objectiveQuestionSnapshotId !== target.questionSnapshot.id || !streamObligationValid || (stream.clientRevision ?? 0) < 2) fail("Objective V2 target／obligation／snapshot／winner／stream lineage不完整。");
  }
  if (remediationObligations !== 0) fail("示範資料仍有未完成的 remediation obligation。");
  const receiptCounts = new Map(receipts.map((row) => [row.actionKind, row._count._all]));
  if ((receiptCounts.get("REVEAL") ?? 0) !== learningItems || (receiptCounts.get("SELF_RATING") ?? 0) !== learningItems || (receiptCounts.get("ANSWER") ?? 0) !== objectiveTargets.length || (receiptCounts.get("FEEDBACK_ACK") ?? 0) !== objectiveTargets.length) fail("四種 V2 durable action receipts 數量不完整。");

  const [progressionRows, progressionEvents, rosterRows] = await Promise.all([
    prisma.review.findMany({ where: { senseId: { not: null } }, select: { userId: true, interval: true, word: { select: { level: true } } } }),
    prisma.reviewEvent.findMany({ where: { flowVersion: "v2", senseId: { not: null }, isHistorical: false }, select: { userId: true, wordLevel: true, createdAt: true } }),
    prisma.studentEnrollment.findMany({ where: { academicYearId: year.id, status: "ACTIVE", classId: { not: null } }, select: { studentId: true, classId: true } }),
  ]);
  const levelOrder = ["A1", "A2", "B1", "B2"] as const;
  const progressByUser = new Map<string, Map<string, { reviewed: number; mastered: number }>>();
  for (const row of progressionRows) {
    const byLevel = progressByUser.get(row.userId) ?? new Map<string, { reviewed: number; mastered: number }>();
    const summary = byLevel.get(row.word.level) ?? { reviewed: 0, mastered: 0 };
    summary.reviewed += 1;
    if (row.interval >= 22) summary.mastered += 1;
    byLevel.set(row.word.level, summary);
    progressByUser.set(row.userId, byLevel);
  }
  const firstEventByLevel = new Map<string, Map<string, Date>>();
  const lastEventByLevel = new Map<string, Map<string, Date>>();
  for (const event of progressionEvents) {
    const firstByLevel = firstEventByLevel.get(event.userId) ?? new Map<string, Date>();
    const lastByLevel = lastEventByLevel.get(event.userId) ?? new Map<string, Date>();
    const first = firstByLevel.get(event.wordLevel);
    const last = lastByLevel.get(event.wordLevel);
    if (!first || event.createdAt < first) firstByLevel.set(event.wordLevel, event.createdAt);
    if (!last || event.createdAt > last) lastByLevel.set(event.wordLevel, event.createdAt);
    firstEventByLevel.set(event.userId, firstByLevel);
    lastEventByLevel.set(event.userId, lastByLevel);
  }
  for (const [userId, firstByLevel] of firstEventByLevel) {
    const lastByLevel = lastEventByLevel.get(userId)!;
    for (let levelIndex = 1; levelIndex < levelOrder.length; levelIndex += 1) {
      const firstHigher = firstByLevel.get(levelOrder[levelIndex]!);
      if (!firstHigher) continue;
      const lastLower = levelOrder.slice(0, levelIndex).map((level) => lastByLevel.get(level)).filter((date): date is Date => Boolean(date)).sort((left, right) => right.getTime() - left.getTime())[0];
      if (lastLower && firstHigher < lastLower) fail("示範 Objective event chronology 違反 A1 → A2 → B1 → B2 順序。");
    }
  }
  let masteredA2Students = 0;
  let masteredB1Students = 0;
  let masteredB2Students = 0;
  const rosterMasteredCounts: number[] = [];
  const classMasteredTotals = new Map<string, number>();
  for (const roster of rosterRows) {
    const byLevel = progressByUser.get(roster.studentId) ?? new Map<string, { reviewed: number; mastered: number }>();
    const masteredCount = [...byLevel.values()].reduce((total, summary) => total + summary.mastered, 0);
    rosterMasteredCounts.push(masteredCount);
    classMasteredTotals.set(roster.classId!, (classMasteredTotals.get(roster.classId!) ?? 0) + masteredCount);
    if ((byLevel.get("A2")?.mastered ?? 0) > 0) masteredA2Students += 1;
    if ((byLevel.get("B1")?.mastered ?? 0) > 0) masteredB1Students += 1;
    if ((byLevel.get("B2")?.mastered ?? 0) > 0) masteredB2Students += 1;
    for (let levelIndex = 1; levelIndex < levelOrder.length; levelIndex += 1) {
      const current = byLevel.get(levelOrder[levelIndex]!);
      if (!current?.reviewed) continue;
      for (let lowerIndex = 0; lowerIndex < levelIndex; lowerIndex += 1) {
        const lower = byLevel.get(levelOrder[lowerIndex]!);
        if (!lower || lower.reviewed === 0 || lower.mastered !== lower.reviewed) fail("示範學生在完成較低級別前已經開始較高級別，A1 → A2 → B1 順序驗證失敗。");
      }
    }
  }
  if (!masteredA2Students || !masteredB1Students || !masteredB2Students) fail("示範資料沒有同時覆蓋 A2、B1 及 B2 的已掌握進度。");
  if (new Set(rosterMasteredCounts).size < 4 || new Set(classMasteredTotals.values()).size < 3) fail("示範資料的學生／班級掌握詞數差異不足。");

  const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
  for (const sourceFile of ["prisma/seed.ts", "scripts/seed-demo-analytics.ts"]) {
    const source = fs.readFileSync(sourceFile, "utf8").normalize("NFC");
    if (toTraditional(source) !== source) fail(`示範資料來源含有簡體文字：${sourceFile}`);
  }
  const visible = await prisma.user.findMany({ select: { legacyName: true, studentProfile: { select: { legalName: true, nickname: true } }, teacherProfile: { select: { legalName: true } } } });
  const text = visible.flatMap((row) => [row.legacyName, row.studentProfile?.legalName, row.studentProfile?.nickname, row.teacherProfile?.legalName].filter((value): value is string => Boolean(value))).join("\n");
  if (toTraditional(text) !== text) fail("示範資料含有簡體可見文字。");
  console.log(JSON.stringify({ ready: true, classes: classes.length, students, teachers, events, encounters, days }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "示範資料驗證失敗"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
