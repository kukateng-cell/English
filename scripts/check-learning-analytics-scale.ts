/**
 * Isolated analytics scale/performance check.
 *
 * This command creates a disposable PostgreSQL schema, applies the current
 * migrations, builds a Traditional-Chinese synthetic roster (48 classes /
 * 500 students / 180 days), measures the four analytics shapes, and drops
 * the schema in a finally block. It never touches the normal local schema.
 */
import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
  type Level,
  type Role,
  type StudentGrade,
} from "../src/generated/prisma";

dotenv.config({ path: ".env.local" });
dotenv.config();

const sourceUrlString = process.env.MIGRATE_URL;
if (!sourceUrlString) throw new Error("隔離 scale check 必須明確設定 MIGRATE_URL。");
const sourceUrl = new URL(sourceUrlString);
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)) {
  throw new Error("scale check 只容許 localhost PostgreSQL。");
}
const environment = process.env.DATABASE_ENVIRONMENT;
if (environment !== "development" && environment !== "test") {
  throw new Error("scale check 必須設定 DATABASE_ENVIRONMENT=development 或 test。");
}
if (process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error(`請同時設定 CONFIRM_DATABASE_ENVIRONMENT=${environment}。`);
}

const schemaName = `codex_analytics_scale_${randomBytes(8).toString("hex")}`;
const adminUrl = new URL(sourceUrl);
adminUrl.searchParams.delete("schema");
const temporaryUrl = new URL(sourceUrl);
temporaryUrl.searchParams.set("schema", schemaName);
const runtimeSchemaUrl = new URL(temporaryUrl);
runtimeSchemaUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });

const CLASS_CODES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const GRADES: StudentGrade[] = ["JUNIOR_1", "JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"];
const LEVELS: Level[] = ["A1", "A2", "B1", "B2"];
const BATCH_SIZE = 2_000;

function todayKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function offsetDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function dateAt(key: string, hour: number): Date {
  return new Date(`${key}T${String(hour).padStart(2, "0")}:00:00+08:00`);
}

function hash(value: string): string {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return `scale-${(result >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

async function createInChunks<T>(createMany: (data: T[]) => Promise<unknown>, rows: T[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await createMany(rows.slice(offset, offset + BATCH_SIZE));
  }
}

function runMigrations(): void {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString(), MIGRATE_URL: temporaryUrl.toString() },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`隔離 schema migration 失敗（${result.status ?? "unknown"}）。`);
}

async function buildFixture(prisma: PrismaClient, fromDate: string, toDate: string): Promise<{ adminId: string; classIds: string[]; studentIds: string[]; days: number; reviewEvents: number; encounters: number }> {
  const yearId = "scale-year-2026";
  await prisma.rosterMutationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 0, calendarRevision: 0 }, update: { revision: 0, calendarRevision: 0 } });
  await prisma.databaseMetadata.upsert({ where: { key: "environment" }, create: { key: "environment", value: environment! }, update: { value: environment! } });
  await prisma.databaseMetadata.upsert({ where: { key: "scaleAnalytics" }, create: { key: "scaleAnalytics", value: "READY" }, update: { value: "READY" } });
  // New roster writers read status; keep the legacy isCurrent projection false
  // because the migration's historical partial index is still present in the
  // temporary schema and is not part of this analytics measurement.
  await prisma.academicYear.create({ data: { id: yearId, label: "2026-2027", startsOn: new Date("2026-01-01T00:00:00+08:00"), endsOn: new Date("2026-12-31T00:00:00+08:00"), isCurrent: false, status: "CURRENT", revision: 1 } });

  const classRows: Prisma.SchoolClassCreateManyInput[] = [];
  const classIds: string[] = [];
  for (const [gradeIndex, grade] of GRADES.entries()) {
    for (const [codeIndex, classCode] of CLASS_CODES.entries()) {
      const id = `scale-class-${gradeIndex + 1}-${codeIndex + 1}`;
      classIds.push(id);
      classRows.push({ id, academicYearId: yearId, grade, classCode, active: true, revision: 1 });
    }
  }
  await prisma.schoolClass.createMany({ data: classRows });

  const wordRows: Prisma.WordCreateManyInput[] = Array.from({ length: 24 }, (_, index) => ({
    id: `scale-word-${String(index + 1).padStart(2, "0")}`,
    term: `scale-word-${String(index + 1).padStart(2, "0")}`,
    definition: `示範詞義${index + 1}`,
    level: LEVELS[index % LEVELS.length]!,
    synonyms: [],
    antonyms: [],
  }));
  await prisma.word.createMany({ data: wordRows });

  const adminId = "scale-admin";
  const teacherId = "scale-teacher";
  const userRows: Prisma.UserCreateManyInput[] = [
    { id: adminId, accountName: "scale-admin", accountNameCanonical: "scale-admin", passwordHash: "scale-test-hash", legacyName: "示範管理員", role: "ADMIN", status: "ACTIVE", mustChangePassword: false, credentialRevision: 1 },
    { id: teacherId, accountName: "scale-teacher", accountNameCanonical: "scale-teacher", passwordHash: "scale-test-hash", legacyName: "示範教師", role: "TEACHER", status: "ACTIVE", mustChangePassword: false, credentialRevision: 1 },
  ];
  const studentIds: string[] = [];
  for (let index = 0; index < 500; index += 1) {
    const id = `scale-student-${String(index + 1).padStart(3, "0")}`;
    studentIds.push(id);
    userRows.push({ id, accountName: id, accountNameCanonical: id, passwordHash: "scale-test-hash", legacyName: `示範學生${String(index + 1).padStart(3, "0")}`, role: "STUDENT", status: "ACTIVE", mustChangePassword: false, credentialRevision: 1 });
  }
  await createInChunks((data) => prisma.user.createMany({ data }), userRows);
  await prisma.teacherProfile.create({ data: { userId: teacherId, legalName: "示範教師", canResetStudentPassword: true } });
  const profiles: Prisma.StudentProfileCreateManyInput[] = studentIds.map((id, index) => ({ userId: id, legalName: `示範學生${String(index + 1).padStart(3, "0")}`, nickname: `學習者${String(index + 1).padStart(3, "0")}`, nicknameNormalized: `學習者${String(index + 1).padStart(3, "0")}`.normalize("NFKC").toLowerCase() }));
  await createInChunks((data) => prisma.studentProfile.createMany({ data }), profiles);
  const enrollments: Prisma.StudentEnrollmentCreateManyInput[] = studentIds.map((studentId, index) => {
    const gradeIndex = Math.min(GRADES.length - 1, Math.floor(index / 84));
    return { studentId, academicYearId: yearId, grade: GRADES[gradeIndex]!, classId: classIds[gradeIndex * CLASS_CODES.length + (index % CLASS_CODES.length)]!, isCurrent: true, status: "ACTIVE", origin: "SEED", startedAt: new Date("2026-01-01T00:00:00+08:00") };
  });
  await createInChunks((data) => prisma.studentEnrollment.createMany({ data }), enrollments);
  await prisma.teacherClassAccess.createMany({ data: classIds.map((classId) => ({ teacherId, classId, canViewProgress: true, canResetStudentPassword: true, grantedById: adminId })) });

  const sessions: Prisma.StudySessionCreateManyInput[] = studentIds.map((userId) => ({ id: `scale-session-${userId.slice(-3)}`, userId, queueFingerprint: hash(`queue:${userId}`), expiresAt: dateAt(offsetDay(toDate, 1), 12), retiredAt: dateAt(offsetDay(toDate, 1), 12), flowVersion: "v2", learningPolicyVersion: "retrieval-v1", mode: "global", revision: 0 }));
  await createInChunks((data) => prisma.studySession.createMany({ data }), sessions);

  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  for (const [studentIndex, userId] of studentIds.entries()) {
    for (let wordIndex = 0; wordIndex < 8; wordIndex += 1) {
      const lastDate = offsetDay(toDate, -((studentIndex + wordIndex) % 45));
      const word = wordRows[(studentIndex + wordIndex) % wordRows.length]!;
      reviewRows.push({ id: `scale-review-${studentIndex + 1}-${wordIndex + 1}`, userId, wordId: word.id!, easeFactor: 2.2 + ((studentIndex + wordIndex) % 5) / 10, interval: 1 + ((studentIndex + wordIndex) % 40), repetitions: 1 + ((studentIndex + wordIndex) % 6), nextReviewDate: dateAt(offsetDay(lastDate, 3 + ((studentIndex + wordIndex) % 12)), 8), lastReviewedAt: dateAt(lastDate, 15), totalReviews: 2 + ((studentIndex + wordIndex) % 8), revision: 1 });
    }
  }
  await createInChunks((data) => prisma.review.createMany({ data }), reviewRows);

  const dayRows: Prisma.StudyDayCreateManyInput[] = [];
  const streamRows: Prisma.StudyStreamItemCreateManyInput[] = [];
  const encounterRows: Prisma.StudyEncounterCreateManyInput[] = [];
  const eventRows: Prisma.ReviewEventCreateManyInput[] = [];
  let encounterCount = 0;
  for (const [studentIndex, userId] of studentIds.entries()) {
    const sessionId = `scale-session-${userId.slice(-3)}`;
    for (let dayIndex = 0; dayIndex < 180; dayIndex += 1) {
      const date = offsetDay(fromDate, dayIndex);
      if ((studentIndex + dayIndex) % 5 !== 0) dayRows.push({ id: `scale-day-${studentIndex + 1}-${dayIndex + 1}`, userId, date, createdAt: dateAt(date, 18) });
      if ((studentIndex + dayIndex) % 3 !== 0) continue;
      const word = wordRows[(studentIndex + dayIndex) % wordRows.length]!;
      const streamId = `scale-stream-${studentIndex + 1}-${dayIndex + 1}`;
      const operationId = `scale-encounter-${studentIndex + 1}-${dayIndex + 1}`;
      const wordId = word.id!;
      streamRows.push({ id: streamId, sessionId, streamItemKey: `${studentIndex + 1}-${dayIndex + 1}`, wordId, itemKind: "LEARNING_CARD", selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", status: "ACKNOWLEDGED", leaseExpiresAt: dateAt(date, 12), credentialDigest: hash(`digest:${streamId}`), credentialExpiresAt: dateAt(date, 12), credentialLineage: { version: 1, parentDigest: null }, revealedAt: dateAt(date, 12), usedAt: dateAt(date, 13), feedbackAcknowledgedAt: dateAt(date, 13), operationId, clientRevision: 2, createdAt: dateAt(date, 12) });
      encounterRows.push({ id: `scale-encounter-row-${studentIndex + 1}-${dayIndex + 1}`, userId, wordId, streamItemId: streamId, operationId, selfRating: (studentIndex + dayIndex) % 4 === 0 ? "NOT_SURE" : "KNOWN", selectionReason: "DUE_REVIEW", policyVersion: "retrieval-v1", requiresVerification: false, createdAt: dateAt(date, 13), acknowledgedAt: dateAt(date, 13) });
      eventRows.push({ id: `scale-event-${studentIndex + 1}-${dayIndex + 1}`, operationId: `scale-review-${studentIndex + 1}-${dayIndex + 1}`, userId, submittedWordId: wordId, wordId, wordTerm: word.term!, wordLevel: word.level!, eventKind: "REVIEW", quality: (studentIndex + dayIndex) % 4 === 0 ? 2 : 4, isHistorical: false, evidenceKind: null, flowVersion: "v2", createdAt: dateAt(date, 15) });
      encounterCount += 1;
    }
  }
  await createInChunks((data) => prisma.studyDay.createMany({ data }), dayRows);
  await createInChunks((data) => prisma.studyStreamItem.createMany({ data }), streamRows);
  await createInChunks((data) => prisma.studyEncounter.createMany({ data }), encounterRows);
  await createInChunks((data) => prisma.reviewEvent.createMany({ data }), eventRows);
  return { adminId, classIds, studentIds, days: dayRows.length, reviewEvents: eventRows.length, encounters: encounterCount };
}

type Measurement = { name: string; p95Ms: number; maxBytes: number; roundTrips: number; samples: number[] };

type ExplainPlan = {
  "QUERY PLAN"?: Array<{
    "Planning Time"?: number;
    "Execution Time"?: number;
    Plan?: { "Node Type"?: string };
  }>;
};

async function explainAnalyticsQueries(input: { runtimeUrl: string; yearId: string; studentIds: string[]; fromDate: string; toDate: string }): Promise<Array<{ name: string; planningMs: number; executionMs: number; nodeType: string }>> {
  const client = new pg.Client({ connectionString: input.runtimeUrl });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '30000ms'");
    const from = dateAt(input.fromDate, 0);
    const to = dateAt(offsetDay(input.toDate, 1), 0);
    const queries: Array<{ name: string; sql: string; values: unknown[] }> = [
      {
        name: "members",
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT u."id", e."grade", e."classId"
          FROM "User" u
          JOIN "StudentProfile" p ON p."userId" = u."id"
          JOIN "StudentEnrollment" e ON e."studentId" = p."userId"
          WHERE u."role" = 'STUDENT'::"Role"
            AND u."status" = 'ACTIVE'::"AccountStatus"
            AND e."academicYearId" = $1
            AND e."status" = 'ACTIVE'::"EnrollmentStatus"`,
        values: [input.yearId],
      },
      {
        name: "review-events",
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT "userId", "createdAt"
          FROM "ReviewEvent"
          WHERE "userId" = ANY($1::text[])
            AND "eventKind" = 'REVIEW'::"ReviewEventKind"
            AND "createdAt" >= $2 AND "createdAt" <= $3`,
        values: [input.studentIds, from, to],
      },
      {
        name: "encounters",
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT "userId", "acknowledgedAt"
          FROM "StudyEncounter"
          WHERE "userId" = ANY($1::text[])
            AND "acknowledgedAt" >= $2 AND "acknowledgedAt" < $3`,
        values: [input.studentIds, from, to],
      },
      {
        name: "study-days",
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT "userId", "date"
          FROM "StudyDay"
          WHERE "userId" = ANY($1::text[])
            AND "date" >= $2 AND "date" <= $3`,
        values: [input.studentIds, input.fromDate, input.toDate],
      },
      {
        name: "reviews",
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT "userId", "interval", "nextReviewDate"
          FROM "Review"
          WHERE "userId" = ANY($1::text[])`,
        values: [input.studentIds],
      },
    ];
    const measurements: Array<{ name: string; planningMs: number; executionMs: number; nodeType: string }> = [];
    for (const query of queries) {
      const result = await client.query(query.sql, query.values) as unknown as { rows: ExplainPlan[] };
      const plan = result.rows[0]?.["QUERY PLAN"]?.[0];
      if (!plan || typeof plan["Execution Time"] !== "number" || typeof plan["Planning Time"] !== "number") throw new Error(`EXPLAIN ${query.name} 無有效時間資料。`);
      measurements.push({ name: query.name, planningMs: Math.round(plan["Planning Time"] * 100) / 100, executionMs: Math.round(plan["Execution Time"] * 100) / 100, nodeType: plan.Plan?.["Node Type"] ?? "unknown" });
    }
    return measurements;
  } finally {
    await client.end();
  }
}

async function measure(name: string, run: () => Promise<unknown>, getRoundTrips: () => number): Promise<Measurement> {
  await run();
  const samples: number[] = [];
  let maxBytes = 0;
  let roundTrips = 0;
  for (let index = 0; index < 20; index += 1) {
    const beforeQueries = getRoundTrips();
    const before = performance.now();
    const value = await run();
    samples.push(performance.now() - before);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(value), "utf8"));
    roundTrips = Math.max(roundTrips, getRoundTrips() - beforeQueries);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { name, p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]! * 100) / 100, maxBytes, roundTrips, samples: samples.map((value) => Math.round(value * 100) / 100) };
}

function assertBudget(measurement: Measurement, maxMs: number, maxBytes: number, maxRoundTrips: number): void {
  if (measurement.p95Ms > maxMs) throw new Error(`${measurement.name} p95 ${measurement.p95Ms}ms 超過 ${maxMs}ms budget。`);
  if (measurement.maxBytes > maxBytes) throw new Error(`${measurement.name} response ${measurement.maxBytes} bytes 超過 ${maxBytes} bytes budget。`);
  if (measurement.roundTrips > maxRoundTrips) throw new Error(`${measurement.name} round trips ${measurement.roundTrips} 超過 ${maxRoundTrips} budget。`);
}

async function main(): Promise<void> {
  await admin.connect();
  let schemaCreated = false;
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    schemaCreated = true;
    runMigrations();
    process.env.DATABASE_URL = runtimeSchemaUrl.toString();
    process.env.NEXTAUTH_SECRET ??= "scale-check-development-secret";
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeSchemaUrl.toString() }, { schema: schemaName }) });
    const today = todayKey();
    const fromDate = offsetDay(today, -179);
    const toDate = today;
    const fixture = await buildFixture(prisma, fromDate, toDate);
    console.error(`scale fixture READY：500 名學生、48 個班、${fixture.days} 日打卡、${fixture.encounters} 次 encounter、${fixture.reviewEvents} 條 ReviewEvent`);
    const explain = await explainAnalyticsQueries({ runtimeUrl: runtimeSchemaUrl.toString(), yearId: "scale-year-2026", studentIds: fixture.studentIds, fromDate, toDate });
    console.error(`EXPLAIN ANALYZE 完成：${explain.map((row) => `${row.name}=${row.executionMs}ms/${row.nodeType}`).join("、")}`);

    // Count actual SQL statements issued by the analytics connection. Prisma's
    // pg adapter uses pg Client.prototype.query, so this includes transaction
    // and recheck statements rather than an estimate from application code.
    let queryCount = 0;
    const originalQuery = pg.Client.prototype.query;
    pg.Client.prototype.query = function patchedQuery(this: pg.Client, ...args: Parameters<typeof originalQuery>) {
      queryCount += 1;
      return originalQuery.apply(this, args);
    } as typeof originalQuery;
    try {
      const analytics = await import("../src/lib/learning-analytics");
      const base = { fromDate, toDate, limit: 50, sort: "ACCOUNT_ASC" as const };
      const role: Role = "ADMIN";
      console.error("開始量度 48 班 summary…");
      const summary = await measure("48-class summary", () => analytics.queryLearningAnalyticsClasses({ userId: fixture.adminId, role, query: base }), () => queryCount);
      console.error("開始量度 6 班 comparison…");
      const comparison = await measure("6-class comparison", () => analytics.queryLearningAnalyticsClasses({ userId: fixture.adminId, role, query: { ...base, classIds: fixture.classIds.slice(0, 6) } }), () => queryCount);
      console.error("開始量度 500 人 student list…");
      const students = await measure("500-user student list", () => analytics.queryLearningAnalyticsStudents({ userId: fixture.adminId, role, query: base }), () => queryCount);
      console.error("開始量度 8 人 comparison…");
      const studentComparison = await measure("8-user student comparison", () => analytics.queryLearningAnalyticsStudents({ userId: fixture.adminId, role, query: { ...base, compareStudentIds: fixture.studentIds.slice(0, 8) } }), () => queryCount);
      console.error("開始量度 1 人 timeline…");
      const oneStudent = await measure("1-user timeline", () => analytics.queryLearningAnalyticsTimeline({ userId: fixture.adminId, role, studentId: fixture.studentIds[0]!, query: base }), () => queryCount);
      // The driver-level count includes BEGIN/COMMIT and Prisma's nested
      // relation statements. Keep it as an observed diagnostic; the service
      // budget is asserted against the measured 24-statement upper bound.
      assertBudget(summary, 1_500, 256 * 1024, 24);
      assertBudget(comparison, 2_000, 256 * 1024, 24);
      assertBudget(students, 1_500, 256 * 1024, 24);
      assertBudget(studentComparison, 1_500, 256 * 1024, 24);
      assertBudget(oneStudent, 1_000, 128 * 1024, 24);
      console.log(JSON.stringify({ ready: true, schema: schemaName, fixture, range: { fromDate, toDate }, explain, measurements: [summary, comparison, students, studentComparison, oneStudent] }, null, 2));
    } finally {
      pg.Client.prototype.query = originalQuery;
      await prisma.$disconnect();
    }
  } finally {
    if (schemaCreated) await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "隔離 scale check 失敗");
  process.exitCode = 1;
});
