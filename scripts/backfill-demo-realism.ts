/**
 * 示範資料真實化補寫（一次性工具，只用於虛構示範庫）。
 *
 * 背景：雲端示範庫由本機 demo:school 匯入後沒有再更新，導致
 *  - 全部 Review 集中在 A1，A2／B1／B2 從未解鎖；
 *  - 不少學生「長期掌握」為 0；
 *  - UserAchievement 幾乎全空（/achievements 0 / 9）；
 *  - 最近兩日 ReviewEvent 近乎中斷，活動圖表出現斷崖。
 *
 * 本腳本只補寫 Review 狀態、ReviewEvent、StudyDay 及 UserAchievement，
 * 不改 schema、不改學習政策、不建立 objective target／snapshot。
 *
 * 用法：
 *   MIGRATE_URL=... node --import tsx scripts/backfill-demo-realism.ts            # dry-run
 *   MIGRATE_URL=... node --import tsx scripts/backfill-demo-realism.ts --apply    # 本機寫入
 *   MIGRATE_URL=... node --import tsx scripts/backfill-demo-realism.ts --apply --confirm-cloud
 */
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import { updateSM2At, type Quality, type ReviewState } from "../src/lib/sm2";
import { currentCatalogWordWhere } from "../src/lib/catalog/runtime";
import { CATALOG_CATEGORIES } from "../src/lib/catalog/taxonomy";
import {
  OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
  OBJECTIVE_QUALITY_POLICY_VERSION,
} from "../src/lib/learning-policy/types";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env.supabase", quiet: true });

// ── 參數與安全檢查 ────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmCloud = args.has("--confirm-cloud");
const activityOnly = args.has("--activity-only");
const seed = process.env.BACKFILL_SEED ?? "demo-realism-v1";
const asOf = new Date();
const HISTORY_START = "2026-09-01";
const TZ_MS = 8 * 3600_000;

const migrateUrl = process.env.MIGRATE_URL ?? "";
if (!migrateUrl) throw new Error("需要 MIGRATE_URL。");
const environment = process.env.DATABASE_ENVIRONMENT;
if (!["development", "test"].includes(environment ?? "")) throw new Error("需要 DATABASE_ENVIRONMENT=development|test。");
if (process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) throw new Error("CONFIRM_DATABASE_ENVIRONMENT 必須與 DATABASE_ENVIRONMENT 相同。");
const host = new URL(migrateUrl).hostname;
const isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(host);
if (!isLocal && apply && !confirmCloud) throw new Error(`目標不是本機（${host}）；如確定要寫入雲端示範庫，請加 --confirm-cloud。`);
if (!apply) console.log("DRY-RUN：只計算，不寫入。加 --apply 才會執行。");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: migrateUrl }) });

// ── 工具函式 ────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const shanghaiKey = (d: Date) => new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
const keyToUtcMidnight = (key: string) => new Date(`${key}T00:00:00+08:00`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hashInt(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const shortHash = (input: string) => createHash("sha256").update(input).digest("hex").slice(0, 16);
function rngFor(key: string): () => number {
  let a = hashInt(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];
function shuffle<T>(r: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
function atSh(key: string, hour: number, minute = 0): Date {
  return new Date(`${key}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
}
const keyOfDate = (d: Date) => shanghaiKey(d);

// ── 載入資料 ────────────────────────────────────────────────────
async function main() {
type WordRow = {
  id: string;
  senseId: string | null;
  senseKey: string | null;
  contentRevisionId: string | null;
  catalogRevisionId: string | null;
  term: string;
  level: string;
  category: string | null;
};
type StudentRow = { id: string; accountName: string; classId: string | null };
type ReviewRow = {
  userId: string;
  wordId: string;
  senseId: string | null;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
  totalReviews: number;
  revision: number;
};

const words = (await prisma.word.findMany({
  where: currentCatalogWordWhere(),
  select: {
    id: true,
    senseId: true,
    senseKey: true,
    contentRevisionId: true,
    catalogRevisionId: true,
    term: true,
    level: true,
    category: true,
  },
})) as WordRow[];
if (words.length === 0) throw new Error("詞庫為空。");

const students = (await prisma.user.findMany({
  where: { role: "STUDENT", status: "ACTIVE" },
  select: {
    id: true,
    accountName: true,
    studentProfile: { select: { enrollments: { where: { isCurrent: true }, select: { classId: true } } } },
  },
})).map<StudentRow>((s) => ({ id: s.id, accountName: s.accountName, classId: s.studentProfile?.enrollments[0]?.classId ?? null }));

const reviewRows = (await prisma.review.findMany({
  select: {
    userId: true,
    wordId: true,
    senseId: true,
    easeFactor: true,
    interval: true,
    repetitions: true,
    nextReviewDate: true,
    lastReviewedAt: true,
    totalReviews: true,
    revision: true,
  },
})) as ReviewRow[];
const reviewsByUser = new Map<string, ReviewRow[]>();
for (const row of reviewRows) {
  const list = reviewsByUser.get(row.userId) ?? [];
  list.push(row);
  reviewsByUser.set(row.userId, list);
}

const studyDaysByUser = new Map<string, Set<string>>();
for (const row of await prisma.studyDay.findMany({ select: { userId: true, date: true } })) {
  const set = studyDaysByUser.get(row.userId) ?? new Set<string>();
  set.add(row.date);
  studyDaysByUser.set(row.userId, set);
}

// 既有事件（只用於推算成就解鎖日期）
const existingEventDates: Array<{ userId: string; wordId: string | null; createdAt: Date }> = await prisma.reviewEvent.findMany({
  where: { eventKind: "REVIEW", isHistorical: false },
  select: { userId: true, wordId: true, createdAt: true },
});

// ── 詞庫分組 ────────────────────────────────────────────────────
const LEVELS = ["A1", "A2", "B1", "B2"] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_INDEX = new Map(LEVELS.map((l, i) => [l, i] as const));
const categoryOrder = new Map<string, number>(CATALOG_CATEGORIES.map((c, i) => [c, i] as const));
const unitName = (category: string | null) => category ?? "未分類";

type Unit = { name: string; words: WordRow[]; level: Level };
const unitsByLevel = new Map<Level, Unit[]>();
for (const level of LEVELS) unitsByLevel.set(level, []);
const unitIndex = new Map<string, Unit>();
for (const word of words) {
  const level = (LEVELS.includes(word.level as Level) ? word.level : "A1") as Level;
  const name = unitName(word.category);
  const key = `${level}::${name}`;
  let unit = unitIndex.get(key);
  if (!unit) {
    unit = { name, words: [], level };
    unitIndex.set(key, unit);
    unitsByLevel.get(level)!.push(unit);
  }
  unit.words.push(word);
}
for (const list of unitsByLevel.values()) {
  list.sort((a, b) => (categoryOrder.get(a.name) ?? 999) - (categoryOrder.get(b.name) ?? 999) || a.name.localeCompare(b.name));
}
const neededLearned = (total: number) => Math.ceil(total * 0.8);

// ── 分層 ────────────────────────────────────────────────────────
type Tier = "INACTIVE" | "A1" | "A2" | "B1" | "B2";
const score = (s: StudentRow) => (reviewsByUser.get(s.id)?.length ?? 0) + (studyDaysByUser.get(s.id)?.size ?? 0) * 2;
const ranked = [...students].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
const tierOf = new Map<string, Tier>();
const perClassElevated = new Map<string, number>();
const quotas: Array<{ tier: Tier; count: number; perClass: number }> = [
  { tier: "B2", count: 2, perClass: 1 },
  { tier: "B1", count: 6, perClass: 1 },
  { tier: "A2", count: 16, perClass: 2 },
];
for (const quota of quotas) {
  let taken = 0;
  for (const student of ranked) {
    if (taken >= quota.count) break;
    if (tierOf.has(student.id)) continue;
    if ((reviewsByUser.get(student.id)?.length ?? 0) < 40) continue;
    const classKey = student.classId ?? student.id;
    if ((perClassElevated.get(classKey) ?? 0) >= quota.perClass) continue;
    tierOf.set(student.id, quota.tier);
    perClassElevated.set(classKey, (perClassElevated.get(classKey) ?? 0) + 1);
    taken += 1;
  }
  if (taken < quota.count) console.warn(`注意：${quota.tier} 只分配到 ${taken}/${quota.count} 名學生（活動量不足或同班上限）。`);
}
for (const student of students) {
  if (tierOf.has(student.id)) continue;
  tierOf.set(student.id, (reviewsByUser.get(student.id)?.length ?? 0) === 0 ? "INACTIVE" : "A1");
}

// ── 每名學生的補寫計劃 ──────────────────────────────────────────
type PlannedEvent = { userId: string; wordId: string | null; quality: Quality; at: Date; operationId: string };
type PlannedReview = {
  userId: string;
  wordId: string;
  senseId: string | null;
  state: ReviewState;
  revision: number;
  totalReviews: number;
  isNew: boolean;
};
type Plan = {
  student: StudentRow;
  tier: Tier;
  reviews: PlannedReview[];
  events: PlannedEvent[];
  studyDays: Map<string, Date>;
};

const wordById = new Map(words.map((w) => [w.id, w]));

// ── --activity-only：只補最近兩日活動（可重複執行） ─────────────
if (activityOnly) {
  await (async function runActivityOnly() {
    const existingDayCounts = new Map<string, number>();
    for (const event of existingEventDates) {
      const key = shanghaiKey(event.createdAt);
      existingDayCounts.set(key, (existingDayCounts.get(key) ?? 0) + 1);
    }
    const targets: Array<[string, number]> = [
      [shanghaiKey(addDays(asOf, -1)), 1900],
      [shanghaiKey(asOf), 1100],
    ];
    const events: PlannedEvent[] = [];
    const updates: Array<{ userId: string; wordId: string; lastReviewedAt: Date; nextReviewDate: Date }> = [];
    const days = new Map<string, { userId: string; date: string; createdAt: Date }>();
    for (const [dayKey, target] of targets) {
      let need = Math.max(0, target - (existingDayCounts.get(dayKey) ?? 0));
      const dayStart = atSh(dayKey, 7, 0).getTime();
      const dayEnd = Math.min(atSh(dayKey, 22, 0).getTime(), asOf.getTime());
      if (dayEnd <= dayStart || need === 0) continue;
      let guard = 0;
      while (need > 0 && guard < 80000) {
        guard += 1;
        const row = reviewRows[Math.floor(rngFor(`${seed}:activity:${dayKey}:${guard}`)() * reviewRows.length)];
        const at = new Date(dayStart + rngFor(`${seed}:activityAt:${dayKey}:${guard}`)() * (dayEnd - dayStart));
        events.push({ userId: row.userId, wordId: row.wordId, quality: 4, at, operationId: `demo-activity:${shortHash(`${row.userId}:${row.wordId}:${dayKey}:${guard}`)}` });
        updates.push({ userId: row.userId, wordId: row.wordId, lastReviewedAt: at, nextReviewDate: new Date(at.getTime() + Math.max(1, row.interval) * DAY_MS) });
        const key = `${row.userId}:${dayKey}`;
        if (!days.has(key)) days.set(key, { userId: row.userId, date: dayKey, createdAt: at });
        need -= 1;
      }
      if (need > 0) console.warn(`注意：${dayKey} 仍缺 ${need} 筆活動。`);
    }
    const todayStart = atSh(shanghaiKey(asOf), 0, 0);
    if (!apply) {
      console.log(JSON.stringify({ activityOnly: true, dryRun: true, events: events.length, updates: updates.length, targets: targets.map(([key, target]) => ({ key, target, existing: existingDayCounts.get(key) ?? 0 })) }, null, 2));
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
      for (const batch of chunk(events, 500)) {
        await tx.reviewEvent.createMany({
          data: batch.map((event) => {
            const word = event.wordId ? wordById.get(event.wordId) : undefined;
            return {
              operationId: event.operationId,
              userId: event.userId,
              submittedWordId: event.wordId ?? "",
              wordId: event.wordId,
              senseId: word?.senseId ?? null,
              submittedSenseId: word?.senseId ?? null,
              senseKey: word?.senseKey ?? null,
              contentRevisionId: word?.contentRevisionId ?? null,
              catalogRevisionId: word?.catalogRevisionId ?? null,
              wordTerm: word?.term ?? "unknown",
              wordLevel: (word?.level ?? "A1") as "A1" | "A2" | "B1" | "B2",
              eventKind: "REVIEW" as const,
              quality: event.quality,
              evidenceKind: "OBJECTIVE_PROBE",
              flowVersion: "v2",
              qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
              itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
              probePurpose: "DUE_REVIEW",
              isHistorical: false,
              createdAt: event.at,
            };
          }),
          skipDuplicates: true,
        });
      }
      for (const update of updates) {
        await tx.review.updateMany({
          where: { userId: update.userId, wordId: update.wordId },
          data: { lastReviewedAt: update.lastReviewedAt, nextReviewDate: update.nextReviewDate },
        });
      }
      if (days.size > 0) {
        await tx.studyDay.createMany({ data: [...days.values()], skipDuplicates: true });
      }
      // 補寫曾把大量 Review 的 lastReviewedAt 設為今日，但沒有對應事件；
      // 移離今日，避免「今日複習詞數」與活動圖表嚴重不一致。
      await tx.$executeRaw`
        UPDATE "Review" AS r
        SET "lastReviewedAt" = r."lastReviewedAt" - interval '2 days',
            "nextReviewDate" = (r."lastReviewedAt" - interval '2 days') + make_interval(days => GREATEST(r."interval", 1))
        WHERE r."lastReviewedAt" >= ${todayStart}
          AND NOT EXISTS (
            SELECT 1 FROM "ReviewEvent" AS e
            WHERE e."userId" = r."userId" AND e."wordId" = r."wordId" AND e."createdAt" >= ${todayStart}
          )
      `;
      await tx.$executeRaw`
        INSERT INTO "ReviewEvent" (
          "id", "operationId", "userId", "submittedWordId", "wordId", "senseId", "submittedSenseId",
          "senseKey", "contentRevisionId", "catalogRevisionId", "wordTerm", "wordLevel",
          "eventKind", "quality", "evidenceKind", "flowVersion", "qualityPolicyVersion",
          "itemConstructionVersion", "probePurpose", "isHistorical", "createdAt"
        )
        SELECT
          'fill_' || md5(random()::text || clock_timestamp()::text || d."userId" || d.date),
          'demo-studyday:' || d."userId" || ':' || d.date,
          d."userId", r."wordId", r."wordId", r."senseId", r."senseId",
          w."senseKey", w."contentRevisionId", w."catalogRevisionId", w.term, w.level,
          'REVIEW', 4, 'OBJECTIVE_PROBE', 'v2', ${OBJECTIVE_QUALITY_POLICY_VERSION},
          ${OBJECTIVE_ITEM_CONSTRUCTION_VERSION}, 'OPERATIONAL_DIAGNOSTIC', false,
          LEAST((d.date::date + time '01:30'), (now() AT TIME ZONE 'UTC') - interval '1 minute')
        FROM "StudyDay" d
        JOIN LATERAL (
          SELECT review.* FROM "Review" review
          WHERE review."userId" = d."userId" AND review."senseId" IS NOT NULL
          ORDER BY review."wordId" LIMIT 1
        ) r ON true
        JOIN "Word" w ON w.id = r."wordId"
        WHERE NOT EXISTS (
          SELECT 1 FROM "ReviewEvent" e
          WHERE e."userId" = d."userId"
            AND to_char(e."createdAt" + interval '8 hours', 'YYYY-MM-DD') = d.date
        )
        ON CONFLICT ("userId", "operationId") DO NOTHING
      `;
    }, { timeout: 600000 });
    console.log(JSON.stringify({ activityOnly: true, events: events.length, targets: targets.map(([key, target]) => ({ key, target, existing: existingDayCounts.get(key) ?? 0 })) }, null, 2));
  })();
  await prisma.$disconnect();
  process.exit(0);
}

/** 依複習次數推算最終 SM-2 狀態（不建立逐次事件，控制示範庫容量）。 */
const SUCCESS_INTERVALS = [1, 6, 15, 39];
function successSpan(count: number): number {
  let span = 0;
  for (let i = 0; i < count - 1; i += 1) span += SUCCESS_INTERVALS[Math.min(i, SUCCESS_INTERVALS.length - 1)];
  return span;
}
function planReviewState(count: number, r: () => number, asOfDate: Date): { state: ReviewState; lastAt: Date } {
  const historyStart = keyToUtcMidnight(HISTORY_START);
  let n = clamp(Math.round(count), 1, 4);
  let span = successSpan(n);
  let finalInterval = SUCCESS_INTERVALS[n - 1] ?? 1;
  let dueOffset: number;
  if (r() < 0.15) dueOffset = -(1 + Math.floor(r() * Math.min(7, Math.max(1, finalInterval))));
  else dueOffset = Math.floor(r() * (finalInterval + 1));
  while (n > 1) {
    const firstAt = asOfDate.getTime() + (dueOffset - finalInterval - span) * DAY_MS;
    if (firstAt >= historyStart.getTime()) break;
    n -= 1;
    span = successSpan(n);
    finalInterval = SUCCESS_INTERVALS[n - 1] ?? 1;
    dueOffset = clamp(dueOffset, 0, finalInterval);
  }
  const lastAt = new Date(asOfDate.getTime() + (dueOffset - finalInterval) * DAY_MS);
  const state: ReviewState = {
    easeFactor: 2.5,
    interval: finalInterval,
    repetitions: n,
    nextReviewDate: new Date(asOfDate.getTime() + dueOffset * DAY_MS),
    lastReviewedAt: lastAt,
  };
  return { state, lastAt };
}

function ensureUnitLearned(
  unit: Unit,
  learnedIds: Set<string>,
  reviewMap: Map<string, ReviewRow>,
  plan: Plan,
  r: () => number,
): number {
  const need = neededLearned(unit.words.length);
  const learned = unit.words.filter((w) => learnedIds.has(w.id)).length;
  if (learned >= need) return 0;
  const candidates = shuffle(r, unit.words.filter((w) => !learnedIds.has(w.id)));
  const missing = need - learned;
  for (const word of candidates.slice(0, missing)) {
    const isNew = !reviewMap.has(word.id);
    const reviewCount = isNew ? (r() < 0.15 ? 1 : 2 + Math.floor(r() * 3)) : 1;
    const { state, lastAt } = planReviewState(reviewCount, r, asOf);
    const existing = reviewMap.get(word.id);
    plan.reviews.push({
      userId: plan.student.id,
      wordId: word.id,
      senseId: word.senseId,
      state,
      revision: (existing?.revision ?? 0) + reviewCount,
      totalReviews: (existing?.totalReviews ?? 0) + reviewCount,
      isNew,
    });
    const key = keyOfDate(lastAt);
    if (!plan.studyDays.has(key)) plan.studyDays.set(key, lastAt);
    learnedIds.add(word.id);
  }
  return missing;
}

/** 補齊某級別「全部」單元至 80%。 */
function ensureLevelComplete(level: Level, plan: Plan, learnedIds: Set<string>, reviewMap: Map<string, ReviewRow>, r: () => number): void {
  for (const unit of unitsByLevel.get(level) ?? []) ensureUnitLearned(unit, learnedIds, reviewMap, plan, r);
}
/** 補齊某級別首 n 個非空單元至 80%。 */
function ensureFirstUnits(level: Level, n: number, plan: Plan, learnedIds: Set<string>, reviewMap: Map<string, ReviewRow>, r: () => number): void {
  for (const unit of (unitsByLevel.get(level) ?? []).slice(0, n)) ensureUnitLearned(unit, learnedIds, reviewMap, plan, r);
}

const plans: Plan[] = [];
for (const student of students) {
  const tier = tierOf.get(student.id)!;
  const existingReviews = reviewsByUser.get(student.id) ?? [];
  const reviewMap = new Map(existingReviews.map((row) => [row.wordId, row] as const));
  const learnedIds = new Set(existingReviews.filter((row) => row.repetitions >= 1).map((row) => row.wordId));
  const r = rngFor(`${seed}:${student.id}`);
  const plan: Plan = {
    student,
    tier,
    reviews: [],
    events: [],
    studyDays: new Map([...(studyDaysByUser.get(student.id) ?? new Set<string>())].map((date) => [date, keyToUtcMidnight(date)])),
  };

  if (tier === "INACTIVE") {
    const start = unitsByLevel.get("A1")![0];
    const count = 4 + Math.floor(r() * 5);
    for (const word of shuffle(r, start.words).slice(0, count)) {
      const { state, lastAt } = planReviewState(2 + Math.floor(r() * 2), r, asOf);
      plan.reviews.push({ userId: student.id, wordId: word.id, senseId: word.senseId, state, revision: state.repetitions, totalReviews: state.repetitions, isNew: true });
      const key = keyOfDate(lastAt);
      if (!plan.studyDays.has(key)) plan.studyDays.set(key, lastAt);
      learnedIds.add(word.id);
    }
  } else if (tier === "B2") {
    ensureLevelComplete("A1", plan, learnedIds, reviewMap, r);
    ensureLevelComplete("A2", plan, learnedIds, reviewMap, r);
    ensureLevelComplete("B1", plan, learnedIds, reviewMap, r);
    ensureFirstUnits("B2", 3, plan, learnedIds, reviewMap, r);
  } else if (tier === "B1") {
    ensureLevelComplete("A1", plan, learnedIds, reviewMap, r);
    ensureLevelComplete("A2", plan, learnedIds, reviewMap, r);
    ensureFirstUnits("B1", 3, plan, learnedIds, reviewMap, r);
  } else if (tier === "A2") {
    ensureLevelComplete("A1", plan, learnedIds, reviewMap, r);
    ensureFirstUnits("A2", 3, plan, learnedIds, reviewMap, r);
  } else {
    const reviews = existingReviews.length;
    const unitTarget = reviews < 10 ? 1 : reviews < 25 ? 2 : reviews < 50 ? 3 : reviews < 80 ? 5 : 8;
    ensureFirstUnits("A1", unitTarget, plan, learnedIds, reviewMap, r);
  }

  plans.push(plan);
}

// --limit N：只處理前 N 名學生，用於小規模試跑（重跑時因 skipDuplicates 保持冪等）。
let limited = false;
const limitIndex = process.argv.indexOf("--limit");
if (limitIndex !== -1) {
  const n = Number(process.argv[limitIndex + 1]);
  if (Number.isFinite(n) && n > 0) {
    plans.length = Math.min(plans.length, Math.floor(n));
    limited = true;
  }
}

// ── 解鎖與掌握度計算 ────────────────────────────────────────────
function learnedIdsAfter(plan: Plan): Set<string> {
  const learned = new Set((reviewsByUser.get(plan.student.id) ?? []).filter((row) => row.repetitions >= 1).map((row) => row.wordId));
  for (const item of plan.reviews) learned.add(item.wordId);
  return learned;
}
function learnedCountFor(unit: Unit, learned: Set<string>): number {
  return unit.words.reduce((count, word) => count + (learned.has(word.id) ? 1 : 0), 0);
}
function unlockedUnits(plan: Plan, level: Level, learned: Set<string>): Set<string> {
  const set = new Set<string>();
  let previousComplete = true;
  for (const unit of unitsByLevel.get(level) ?? []) {
    if (!previousComplete) break;
    set.add(unit.name);
    previousComplete = learnedCountFor(unit, learned) >= neededLearned(unit.words.length);
  }
  return set;
}
function levelIsUnlocked(plan: Plan, level: Level, learned: Set<string>): boolean {
  const idx = LEVEL_INDEX.get(level)!;
  for (let i = 0; i < idx; i += 1) {
    const previous = LEVELS[i];
    const units = unitsByLevel.get(previous) ?? [];
    if (!units.every((unit) => learnedCountFor(unit, learned) >= neededLearned(unit.words.length))) return false;
  }
  return true;
}

const masteryFraction: Record<Tier, Partial<Record<Level, number>>> = {
  INACTIVE: { A1: 0.15 },
  A1: { A1: 0.22 },
  A2: { A1: 0.45, A2: 0.1 },
  B1: { A1: 0.55, A2: 0.35, B1: 0.1 },
  B2: { A1: 0.6, A2: 0.45, B1: 0.3, B2: 0.08 },
};
let masteryUpdates = 0;
for (const plan of plans) {
  const existingReviews = reviewsByUser.get(plan.student.id) ?? [];
  const reviewMap = new Map(existingReviews.map((row) => [row.wordId, row] as const));
  const learnedIds = learnedIdsAfter(plan);
  const plannedByWord = new Map(plan.reviews.map((item) => [item.wordId, item] as const));
  const r = rngFor(`${seed}:mastery:${plan.student.id}`);
  const fractions = masteryFraction[plan.tier];

  for (const level of LEVELS) {
    const fraction = fractions[level];
    if (!fraction) continue;
    if (!levelIsUnlocked(plan, level, learnedIds)) continue;
    const unlockedNames = unlockedUnits(plan, level, learnedIds);
    const scope = (unitsByLevel.get(level) ?? []).filter((unit) => unlockedNames.has(unit.name)).flatMap((unit) => unit.words);
    const learnedScope = scope.filter((word) => learnedIds.has(word.id));
    if (learnedScope.length === 0) continue;
    const target = Math.min(learnedScope.length, Math.max(1, Math.round(learnedScope.length * (fraction + (r() - 0.5) * 0.06))));
    const existingMastered = learnedScope.filter((word) => {
      const planned = plannedByWord.get(word.id);
      if (planned) return planned.state.interval >= 22;
      return (reviewMap.get(word.id)?.interval ?? 0) >= 22;
    }).length;
    if (existingMastered >= target) continue;

    const candidates = shuffle(r, learnedScope.filter((word) => {
      const planned = plannedByWord.get(word.id);
      if (planned) return planned.state.interval < 22;
      return (reviewMap.get(word.id)?.interval ?? 0) < 22;
    }));
    for (const word of candidates.slice(0, target - existingMastered)) {
      const planned = plannedByWord.get(word.id);
      const interval = 22 + Math.floor(r() * 39); // 22–60 天
      const dueOffset = 3 + Math.floor(r() * 40); // 3–42 天後到期
      const nextReviewDate = new Date(asOf.getTime() + dueOffset * DAY_MS);
      const lastReviewedAt = new Date(nextReviewDate.getTime() - interval * DAY_MS);
      const state: ReviewState = {
        easeFactor: 2.5,
        interval,
        repetitions: Math.max(4, planned?.state.repetitions ?? reviewMap.get(word.id)?.repetitions ?? 0),
        nextReviewDate,
        lastReviewedAt,
      };
      if (planned) {
        planned.state = state;
      } else {
        const existing = reviewMap.get(word.id)!;
        plan.reviews.push({
          userId: plan.student.id,
          wordId: word.id,
          senseId: existing.senseId,
          state,
          revision: existing.revision,
          totalReviews: existing.totalReviews,
          isNew: false,
        });
      }
      masteryUpdates += 1;
    }
  }
}

// ── 邏輯驗證：解鎖級別與掌握度分佈 ────────────────────────────
const unlockedCounts: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };
const tierMastery = new Map<Tier, { students: number; total: number; zero: number; min: number; max: number }>();
for (const plan of plans) {
  const learned = learnedIdsAfter(plan);
  const existingReviews = reviewsByUser.get(plan.student.id) ?? [];
  const reviewMap = new Map(existingReviews.map((row) => [row.wordId, row] as const));
  const plannedState = new Map(plan.reviews.map((item) => [item.wordId, item.state] as const));
  const stateOf = (wordId: string): ReviewState | undefined => plannedState.get(wordId) ?? reviewMap.get(wordId);
  let masteredInUnlocked = 0;
  for (const level of LEVELS) {
    if (!levelIsUnlocked(plan, level, learned)) continue;
    unlockedCounts[level] += 1;
    const names = unlockedUnits(plan, level, learned);
    for (const unit of unitsByLevel.get(level) ?? []) {
      if (!names.has(unit.name)) continue;
      for (const word of unit.words) if ((stateOf(word.id)?.interval ?? 0) >= 22) masteredInUnlocked += 1;
    }
  }
  const stats = tierMastery.get(plan.tier) ?? { students: 0, total: 0, zero: 0, min: Number.MAX_SAFE_INTEGER, max: 0 };
  stats.students += 1;
  stats.total += masteredInUnlocked;
  if (masteredInUnlocked === 0) stats.zero += 1;
  stats.min = Math.min(stats.min, masteredInUnlocked);
  stats.max = Math.max(stats.max, masteredInUnlocked);
  tierMastery.set(plan.tier, stats);
}

// ── 最近兩日活動（避免活動圖表斷崖） ────────────────────────────
// 只補少量逐次事件；其餘補寫以 Review 狀態表達，避免 ReviewEvent 表大幅膨脹。
const existingDayCounts = new Map<string, number>();
for (const event of existingEventDates) {
  const key = shanghaiKey(event.createdAt);
  existingDayCounts.set(key, (existingDayCounts.get(key) ?? 0) + 1);
}
const recentTargets: Array<[string, number]> = [
  [shanghaiKey(addDays(asOf, -1)), 1900],
  [shanghaiKey(asOf), 1100],
];
const plansWithReviews = plans.filter((plan) => plan.reviews.length > 0);
for (const [dayKey, target] of recentTargets) {
  let need = Math.max(0, target - (existingDayCounts.get(dayKey) ?? 0));
  if (need === 0) continue;
  const dayStart = atSh(dayKey, 7, 0).getTime();
  const dayEnd = Math.min(atSh(dayKey, 22, 0).getTime(), asOf.getTime());
  if (dayEnd <= dayStart) continue;
  let guard = 0;
  while (need > 0 && guard < 20000) {
    guard += 1;
    const plan = pick(rngFor(`${seed}:recent:${dayKey}:${guard}`), plansWithReviews);
    const entry = pick(rngFor(`${seed}:recentWord:${dayKey}:${guard}`), plan.reviews);
    const at = new Date(dayStart + rngFor(`${seed}:recentAt:${dayKey}:${guard}`)() * (dayEnd - dayStart));
    if ((entry.state.lastReviewedAt?.getTime() ?? 0) > at.getTime()) continue;
    entry.state = updateSM2At(entry.state, 4, at);
    plan.events.push({
      userId: plan.student.id,
      wordId: entry.wordId,
      quality: 4,
      at,
      operationId: `demo-realism:recent:${shortHash(`${plan.student.id}:${dayKey}:${guard}`)}`,
    });
    if (!plan.studyDays.has(dayKey)) plan.studyDays.set(dayKey, at);
    need -= 1;
  }
}

// ── 每日事件分佈（dry-run 用） ─────────────────────────────────
const plannedEventCounts = new Map<string, number>();
for (const plan of plans) for (const event of plan.events) {
  const key = keyOfDate(event.at);
  plannedEventCounts.set(key, (plannedEventCounts.get(key) ?? 0) + 1);
}

// ── 輸出統計（dry-run） ─────────────────────────────────────────
const tierCounts: Record<string, number> = {};
for (const plan of plans) tierCounts[plan.tier] = (tierCounts[plan.tier] ?? 0) + 1;
const newReviews = plans.reduce((n, plan) => n + plan.reviews.filter((item) => item.isNew).length, 0);
const updatedReviews = plans.reduce((n, plan) => n + plan.reviews.filter((item) => !item.isNew).length, 0);
const newEvents = plans.reduce((n, plan) => n + plan.events.length, 0);
const newStudyDays = plans.reduce((n, plan) => n + [...plan.studyDays.keys()].filter((key) => !(studyDaysByUser.get(plan.student.id)?.has(key) ?? false)).length, 0);

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  target: { host, database: new URL(migrateUrl).pathname.slice(1) },
  asOf: asOf.toISOString(),
  seed,
  students: plans.length,
  tiers: tierCounts,
  newReviews,
  updatedReviews,
  masteryUpdates,
  newEvents,
  newStudyDays,
  unlockedStudents: unlockedCounts,
  tierMastery: [...tierMastery.entries()].map(([tier, stats]) => ({
    tier,
    students: stats.students,
    avgMasteredInUnlocked: Math.round(stats.total / Math.max(1, stats.students)),
    zeroMastered: stats.zero,
    min: stats.min === Number.MAX_SAFE_INTEGER ? 0 : stats.min,
    max: stats.max,
  })),
  eventDays: [...plannedEventCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14),
}, null, 2));

if (!apply) {
  await prisma.$disconnect();
  process.exit(0);
}

// ── 寫入 ────────────────────────────────────────────────────────
const digest = (input: string) => createHash("sha256").update(input).digest("hex");

for (const [index, plan] of plans.entries()) {
  if (plan.reviews.length === 0 && plan.events.length === 0) continue;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
    const toCreate = plan.reviews.filter((item) => item.isNew);
    const toUpdate = plan.reviews.filter((item) => !item.isNew);
    for (const batch of chunk(toCreate, 500)) {
      await tx.review.createMany({
        data: batch.map((item) => ({
          userId: item.userId,
          wordId: item.wordId,
          senseId: item.senseId,
          easeFactor: item.state.easeFactor,
          interval: item.state.interval,
          repetitions: item.state.repetitions,
          nextReviewDate: item.state.nextReviewDate,
          lastReviewedAt: item.state.lastReviewedAt,
          totalReviews: item.totalReviews,
          revision: item.revision,
        })),
        skipDuplicates: true,
      });
    }
    for (const item of toUpdate) {
      await tx.review.updateMany({
        where: { userId: item.userId, wordId: item.wordId },
        data: {
          easeFactor: item.state.easeFactor,
          interval: item.state.interval,
          repetitions: item.state.repetitions,
          nextReviewDate: item.state.nextReviewDate,
          lastReviewedAt: item.state.lastReviewedAt,
        },
      });
    }
    for (const batch of chunk(plan.events, 500)) {
      await tx.reviewEvent.createMany({
        data: batch.map((event) => {
          const word = event.wordId ? wordById.get(event.wordId) : undefined;
          return {
            operationId: event.operationId,
            userId: event.userId,
            submittedWordId: event.wordId ?? "",
            wordId: event.wordId,
            senseId: word?.senseId ?? null,
            submittedSenseId: word?.senseId ?? null,
            senseKey: word?.senseKey ?? null,
            contentRevisionId: word?.contentRevisionId ?? null,
            catalogRevisionId: word?.catalogRevisionId ?? null,
            wordTerm: word?.term ?? "unknown",
            wordLevel: (word?.level ?? "A1") as "A1" | "A2" | "B1" | "B2",
            eventKind: "REVIEW" as const,
            quality: event.quality,
            evidenceKind: "OBJECTIVE_PROBE",
            flowVersion: "v2",
            qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
            itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
            probePurpose: "DUE_REVIEW",
            isHistorical: false,
            createdAt: event.at,
          };
        }),
        skipDuplicates: true,
      });
    }
    const days = [...plan.studyDays.entries()].filter(([key]) => !(studyDaysByUser.get(plan.student.id)?.has(key) ?? false));
    if (days.length > 0) {
      await tx.studyDay.createMany({
        data: days.map(([date, createdAt]) => ({ userId: plan.student.id, date, createdAt })),
        skipDuplicates: true,
      });
    }
  }, { timeout: 120000 });
  if ((index + 1) % 50 === 0) console.log(`寫入進度：${index + 1}/${plans.length}`);
}

// ── 成就回填 ────────────────────────────────────────────────────
type AchievementDef = { key: string; type: "reviews" | "streak" | "studyDays"; target: number };
const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_study", type: "reviews", target: 1 },
  { key: "review_10", type: "reviews", target: 10 },
  { key: "review_50", type: "reviews", target: 50 },
  { key: "review_100", type: "reviews", target: 100 },
  { key: "streak_3", type: "streak", target: 3 },
  { key: "streak_7", type: "streak", target: 7 },
  { key: "streak_30", type: "streak", target: 30 },
  { key: "study_7", type: "studyDays", target: 7 },
  { key: "study_30", type: "studyDays", target: 30 },
];

const finalStudyDays = new Map<string, Set<string>>();
for (const student of students) {
  finalStudyDays.set(student.id, new Set(studyDaysByUser.get(student.id) ?? []));
}
for (const plan of plans) {
  const set = finalStudyDays.get(plan.student.id)!;
  for (const key of plan.studyDays.keys()) set.add(key);
}
const firstEventByWord = new Map<string, string>(); // `${userId}:${wordId}` → earliest date key
for (const event of existingEventDates) {
  if (!event.wordId) continue;
  const key = `${event.userId}:${event.wordId}`;
  const day = shanghaiKey(event.createdAt);
  const current = firstEventByWord.get(key);
  if (!current || day < current) firstEventByWord.set(key, day);
}
for (const plan of plans) {
  for (const event of plan.events) {
    if (!event.wordId) continue;
    const key = `${event.userId}:${event.wordId}`;
    const day = shanghaiKey(event.at);
    const current = firstEventByWord.get(key);
    if (!current || day < current) firstEventByWord.set(key, day);
  }
  for (const item of plan.reviews) {
    const key = `${plan.student.id}:${item.wordId}`;
    if (firstEventByWord.has(key)) continue;
    firstEventByWord.set(key, shanghaiKey(item.state.lastReviewedAt ?? asOf));
  }
}
for (const row of reviewRows) {
  const key = `${row.userId}:${row.wordId}`;
  if (firstEventByWord.has(key)) continue;
  firstEventByWord.set(key, shanghaiKey(row.lastReviewedAt ?? row.nextReviewDate));
}

const existingAchievements = await prisma.userAchievement.findMany({ select: { userId: true, key: true } });
const existingAchievementSet = new Set(existingAchievements.map((row) => `${row.userId}:${row.key}`));

const finalReviewCount = new Map<string, number>();
for (const student of students) finalReviewCount.set(student.id, reviewsByUser.get(student.id)?.length ?? 0);
for (const plan of plans) {
  finalReviewCount.set(plan.student.id, (finalReviewCount.get(plan.student.id) ?? 0) + plan.reviews.filter((item) => item.isNew).length);
}

function streakUnlockDate(dates: string[], target: number): string | null {
  const sorted = [...dates].sort();
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    if (previous) {
      const prevTime = Date.parse(`${previous}T00:00:00Z`);
      const curTime = Date.parse(`${date}T00:00:00Z`);
      run = Math.round((curTime - prevTime) / DAY_MS) === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    previous = date;
    if (run >= target) return date;
  }
  return null;
}

const achievementRows: Array<{ userId: string; key: string; unlockedAt: Date }> = [];
const achievementStudents = limited ? plans.map((plan) => plan.student) : students;
for (const student of achievementStudents) {
  const dates = [...(finalStudyDays.get(student.id) ?? [])].sort();
  const reviewDays = dates; // 沒有事件時以學習日代替
  for (const def of ACHIEVEMENTS) {
    if (existingAchievementSet.has(`${student.id}:${def.key}`)) continue;
    let unlockedDay: string | null = null;
    if (def.type === "reviews") {
      if ((finalReviewCount.get(student.id) ?? 0) >= def.target) {
        const days = [...new Set(
          [...firstEventByWord.entries()]
            .filter(([key]) => key.startsWith(`${student.id}:`))
            .map(([, day]) => day),
        )].sort();
        unlockedDay = days[def.target - 1] ?? days.at(-1) ?? reviewDays.at(-1) ?? null;
      }
    } else if (def.type === "streak") {
      unlockedDay = streakUnlockDate(dates, def.target);
    } else {
      unlockedDay = dates[def.target - 1] ?? null;
    }
    if (!unlockedDay) continue;
    const r = rngFor(`${seed}:achievement:${student.id}:${def.key}`);
    const unlockedAt = atSh(unlockedDay, 8 + Math.floor(r() * 13), Math.floor(r() * 60));
    achievementRows.push({ userId: student.id, key: def.key, unlockedAt: unlockedAt > asOf ? asOf : unlockedAt });
  }
}

for (const batch of chunk(achievementRows, 1000)) {
  await prisma.userAchievement.createMany({ data: batch, skipDuplicates: true });
}

// 每個 StudyDay 至少要有一筆對應事件，否則排行榜 reward coverage 會報
// history gap（KNOWN_GAP → 待核對）。補寫事件標記為 OPERATIONAL_DIAGNOSTIC，
// 不計入排行榜分數，但仍計入活動圖表。
const filledStudyDayEvents = await prisma.$executeRaw`
  INSERT INTO "ReviewEvent" (
    "id", "operationId", "userId", "submittedWordId", "wordId", "senseId", "submittedSenseId",
    "senseKey", "contentRevisionId", "catalogRevisionId", "wordTerm", "wordLevel",
    "eventKind", "quality", "evidenceKind", "flowVersion", "qualityPolicyVersion",
    "itemConstructionVersion", "probePurpose", "isHistorical", "createdAt"
  )
  SELECT
    'fill_' || md5(random()::text || clock_timestamp()::text || d."userId" || d.date),
    'demo-studyday:' || d."userId" || ':' || d.date,
    d."userId", r."wordId", r."wordId", r."senseId", r."senseId",
    w."senseKey", w."contentRevisionId", w."catalogRevisionId", w.term, w.level,
    'REVIEW', 4, 'OBJECTIVE_PROBE', 'v2', ${OBJECTIVE_QUALITY_POLICY_VERSION},
    ${OBJECTIVE_ITEM_CONSTRUCTION_VERSION}, 'OPERATIONAL_DIAGNOSTIC', false,
    LEAST((d.date::date + time '01:30'), (now() AT TIME ZONE 'UTC') - interval '1 minute')
  FROM "StudyDay" d
  JOIN LATERAL (
    SELECT review.* FROM "Review" review
    WHERE review."userId" = d."userId" AND review."senseId" IS NOT NULL
    ORDER BY review."wordId" LIMIT 1
  ) r ON true
  JOIN "Word" w ON w.id = r."wordId"
  WHERE NOT EXISTS (
    SELECT 1 FROM "ReviewEvent" e
    WHERE e."userId" = d."userId"
      AND to_char(e."createdAt" + interval '8 hours', 'YYYY-MM-DD') = d.date
  )
  ON CONFLICT ("userId", "operationId") DO NOTHING
`;

console.log(JSON.stringify({ written: true, achievements: achievementRows.length, filledStudyDayEvents, digest: digest(seed) }, null, 2));
await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "補寫失敗");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
