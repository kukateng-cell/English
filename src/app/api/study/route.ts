import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma, type Word } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  updateSM2,
  gestureToQuality,
  createInitialState,
  type Quality,
} from "@/lib/sm2";
import {
  normalizeLevel,
  unitCategoryToStorage,
} from "@/lib/units";
import { computeStreak, checkInStudyDay } from "@/lib/streak";
import {
  achievementsForKeys,
  checkAchievements,
} from "@/lib/achievements";
import { checkStudyQueueRate, checkStudyRate } from "@/lib/study-limiter";
import {
  canReuseResumeSession,
  MAX_STUDY_SESSION_WORDS,
} from "@/lib/study-session";
import {
  issueStudySession,
  reuseStudySessionForResume,
  serializeStudySession,
} from "@/lib/study-session-server";
import { getClientIp } from "@/lib/login-limiter";
import { legacyOperationIdCompatibilityEndsAt } from "@/lib/production-config";
import { fetchUnitProgress } from "@/lib/unit-progress-server";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "@/lib/transaction-retry";

/**
 * Fisher–Yates 洗牌（返回新数组副本，不修改入参）。
 *
 * 用于打散单词推送顺序：保留记忆曲线要求的「到期/优先级」调度，
 * 同时让同级（同日到期、单元内同一优先级、新词批次）的词随机出现，
 * 避免固定字母序 / 固定时间序带来的机械感。
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 计算当前用户的「闯关解锁」状态。
 *
 * - unitUnlock: { [`${level}::${category}`]: unlocked } —— 仅含真实存在的单元，
 *   供单元模式精确区分「存在但锁住」(→ 403) 与「不存在」(→ 走原逻辑返回空队列)。
 * - unlockedKeys: Set<`${level}::${category}`> —— 全局模式新词过滤用，
 *   只允许从已解锁单元引入新词，避免绕过闯关直接学习后续单元。
 *
 * category 为 null 的单词统一按 "未分类" 记键，与 aggregateAllLevels 一致。
 */
async function computeUnlockInfo(
  userId: string,
  db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
): Promise<{
  unitUnlock: Record<string, boolean>;
  unlockedKeys: Set<string>;
}> {
  const aggregations = await fetchUnitProgress(userId, db);

  const unitUnlock: Record<string, boolean> = {};
  const unlockedKeys = new Set<string>();
  for (const lvl of aggregations) {
    for (const u of lvl.units) {
      const key = `${lvl.level}::${u.name}`;
      unitUnlock[key] = u.unlocked;
      if (u.unlocked) unlockedKeys.add(key);
    }
  }
  return { unitUnlock, unlockedKeys };
}

function unlockedCategoryFilters(unlockedKeys: Set<string>) {
  return [...unlockedKeys].map((key) => {
    const separator = key.indexOf("::");
    return {
      level: normalizeLevel(key.slice(0, separator)),
      category:
        key.slice(separator + 2) === "未分类"
          ? null
          : key.slice(separator + 2),
    };
  });
}

/**
 * GET /api/study
 * - 无参数：全局「今日待复习 + 新词」队列（默认学习模式）。
 * - ?level=A1&category=Hello and Goodbye：单元练习模式，
 *   返回该单元内【全部】单词（无论是否到期），便于用户完整练习该单元。
 *   排序：未学 → 到期待复习 → 已排期（未到期），把需要关注的词放在前面。
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const queueRate = await checkStudyQueueRate(
    userId,
    getClientIp(req.headers),
  );
  if (!queueRate.ok) {
    return NextResponse.json(
      { error: "学习队列载入过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(queueRate.retryAfterSec ?? 60) },
      },
    );
  }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const level = url.searchParams.get("level");
  const unitMode = !!(category && level);
  // 单元列表把数据库 NULL category 显示为「未分类」；查询时必须映射回 NULL。
  const unitCategoryValue = unitCategoryToStorage(category);
  const resumeRaw = url.searchParams.get("resumeIds");
  const resumeSessionIdRaw = url.searchParams.get("resumeSessionId");
  let resumeIds: string[] | null = null;
  let resumeSourceSessionId: string | null = null;
  if (resumeRaw !== null || resumeSessionIdRaw !== null) {
    const parsed = resumeRaw?.split(",").filter(Boolean) ?? [];
    if (
      resumeRaw === null ||
      resumeSessionIdRaw === null ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(resumeSessionIdRaw) ||
      parsed.length === 0 ||
      parsed.length > MAX_STUDY_SESSION_WORDS ||
      new Set(parsed).size !== parsed.length ||
      parsed.some((id) => id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id))
    ) {
      return NextResponse.json({ error: "恢复凭证无效" }, { status: 400 });
    }
    const previousSession = await prisma.studySession.findFirst({
      where: { id: resumeSessionIdRaw, userId },
      select: {
        expiresAt: true,
        retiredAt: true,
        items: {
          select: {
            wordId: true,
            usedAt: true,
            renewedAt: true,
            operationId: true,
          },
        },
      },
    });
    if (canReuseResumeSession(previousSession, parsed)) {
      resumeIds = parsed;
      resumeSourceSessionId = resumeSessionIdRaw;
    }
  }

  // 计算解锁状态：单元模式用于拦截被锁单元；全局模式用于过滤新词来源。
  const { unitUnlock, unlockedKeys } = await computeUnlockInfo(userId);
  const unlockedCats = unlockedCategoryFilters(unlockedKeys);

  if (unitMode) {
    // 守卫：通过 URL 直接访问被锁单元时拦截。
    // 单元「存在但未解锁」→ 403；单元「不存在」→ 放行（走原逻辑返回空队列）。
    const key = `${normalizeLevel(level)}::${category}`;
    if (key in unitUnlock && unitUnlock[key] === false) {
      return NextResponse.json(
        { error: "locked", message: "请先完成前面的单元，解锁后再来挑战吧！" },
        { status: 403 },
      );
    }
  }

  // 队列项：word 为 Prisma 完整 Word（原生 string[] / Json），state 为 SM-2 状态快照。
  type QueueItem = {
    reviewId: string | null;
    word: Word;
    state: {
      easeFactor: number;
      interval: number;
      repetitions: number;
      nextReviewDate: Date;
      lastReviewedAt: Date | null;
    };
  };
  let queue: QueueItem[] = [];
  let resumedSession = false;

  // 恢复中的 session 必须沿用最初固定的词集合。一次成功 POST 会马上改变
  // due/new/未掌握筛选结果，所以不能用重新计算出的动态队列来验证 checkpoint。
  // 服务端按当前权限重新验证这些 id：单元模式只能恢复该单元；全局模式容许
  // 既有 Review 或目前已解锁的新词。任何词被删除/移组时便放弃恢复并重算。
  if (resumeIds) {
    const resumeWords = await prisma.word.findMany({
      where: {
        id: { in: resumeIds },
        ...(unitMode
          ? { level: normalizeLevel(level), category: unitCategoryValue }
          : {
              // 与正常 global GET / POST 权限一致：到期复习可以来自后来
              // 重新锁上的单元；只有从未学过的新词才要求目前已解锁。
              OR: [
                { reviews: { some: { userId } } },
                ...unlockedCats,
              ],
            }),
      },
    });
    if (resumeWords.length === resumeIds.length) {
      resumedSession = true;
      const wordMap = new Map(resumeWords.map((word) => [word.id, word]));
      const reviews = await prisma.review.findMany({
        where: { userId, wordId: { in: resumeIds } },
      });
      const reviewMap = new Map(reviews.map((review) => [review.wordId, review]));
      queue = resumeIds.map((id) => {
        const word = wordMap.get(id)!;
        const review = reviewMap.get(id);
        return {
          reviewId: review?.id ?? null,
          word,
          state: review
            ? {
                easeFactor: review.easeFactor,
                interval: review.interval,
                repetitions: review.repetitions,
                nextReviewDate: review.nextReviewDate,
                lastReviewedAt: review.lastReviewedAt,
              }
            : createInitialState(),
        };
      });
    }
  }

  if (queue.length > 0) {
    // 固定 session queue 已在上面按 checkpoint 顺序恢复，无需再抽样或洗牌。
  } else if (unitMode) {
    // ── 单元练习模式：取出该单元全部单词 ──
    const unitWords = await prisma.word.findMany({
      where: { level: normalizeLevel(level), category: unitCategoryValue },
      orderBy: { term: "asc" },
    });
    const unitWordIds = unitWords.map((w) => w.id);
    const reviewMap = new Map(
      (
        await prisma.review.findMany({
          where: { userId, wordId: { in: unitWordIds } },
        })
      ).map((r) => [r.wordId, r]),
    );
    const now = new Date();

    const allItems = unitWords.map((w) => {
      const r = reviewMap.get(w.id);
      const state = r
        ? {
            easeFactor: r.easeFactor,
            interval: r.interval,
            repetitions: r.repetitions,
            nextReviewDate: r.nextReviewDate,
            lastReviewedAt: r.lastReviewedAt,
          }
        : createInitialState();
      return { reviewId: r?.id ?? null, word: w, state };
    });

    // ── 精准重做：优先做「未掌握」的词，只补少量已掌握词作点缀 ──
    // 「未掌握」= repetitions < 1：包括从没做对的词，以及做错后被 SM-2 打回
    // （quality < 3 → repetitions 重置为 0）的词。这正是用户想补救的「错题」。
    //
    // 分两种场景：
    //   - 首次学习：单元词几乎都是未掌握（repetitions = 0）→ 全部进队列，
    //     行为与改造前一致，不会让学生「只做一部分就结束」。
    //   - 重做 / 补救：已有部分掌握 → 只把未掌握的词放进队列，
    //     再从已掌握的词里随机抽一小批（与未掌握数等量、上限 10）做巩固，
    //     让学生不必重做整个单元，只针对错题 + 少量复习。
    const MASTERED_REPETITIONS = 1;
    const REVIEW_SUPPLEMENT_CAP = 10;
    const notMastered = allItems.filter(
      (it) => it.state.repetitions < MASTERED_REPETITIONS,
    );
    const mastered = allItems.filter(
      (it) => it.state.repetitions >= MASTERED_REPETITIONS,
    );

    if (notMastered.length === 0) {
      // 单元已全部掌握（例如纯复习）：给已掌握词排序后全部返回，保持原行为。
      queue = allItems;
    } else if (mastered.length === 0) {
      // 没有任何已掌握词（首次学习）：全部进队列。
      queue = allItems;
    } else {
      // 重做 / 补救场景：主队列 = 未掌握词；从已掌握词随机补一小批巩固。
      const supplement = shuffle(mastered)
        .slice(0, Math.min(notMastered.length, REVIEW_SUPPLEMENT_CAP));
      queue = [...notMastered, ...supplement];
    }

    // 排序：未学(0) → 到期待复习(1) → 已排期未到期(2)；
    // 同优先级内随机打散，避免单元内总是固定字母序。
    const rank = (q: (typeof queue)[number]) => {
      if (!q.reviewId) return 0; // 未学
      return q.state.nextReviewDate <= now ? 1 : 2; // 到期 / 已排期
    };
    const byRank: QueueItem[][] = [[], [], []];
    for (const q of queue) byRank[rank(q)].push(q);
    queue = byRank
      .flatMap((g) => shuffle(g))
      .slice(0, MAX_STUDY_SESSION_WORDS);
  } else {
    // ── 默认全局模式：到期待复习 + 新词 ──
    // 1. 取出到期的 Review（待复习单词）。
    //    多取一批（60）以便在内存中按「到期日」分组随机：既保留记忆曲线
    //    「最早到期先复习」的调度，又让同一天到期的词随机出现，避免固定时间序。
    const DUE_FETCH_LIMIT = 60;
    const dueReviews = await prisma.review.findMany({
      where: {
        userId,
        nextReviewDate: { lte: new Date() },
      },
      include: { word: true },
      orderBy: { nextReviewDate: "asc" },
      take: DUE_FETCH_LIMIT,
    });
    // 按到期日（YYYY-MM-DD）分组，组内洗牌，再按日期升序展平，最后取 20。
    const dueByDay = new Map<string, typeof dueReviews>();
    for (const r of dueReviews) {
      const day = r.nextReviewDate.toISOString().slice(0, 10);
      const list = dueByDay.get(day) ?? [];
      list.push(r);
      dueByDay.set(day, list);
    }
    const dueSorted = [...dueByDay.keys()]
      .sort()
      .flatMap((day) => shuffle(dueByDay.get(day)!))
      .slice(0, 20);

    // 2. 取新词（没有 Review 记录的单词）
    // 新词只从已解锁单元中引入，避免绕过闯关解锁直接学习后续单元。
    // 查询直接下推到 DB：按已解锁的 (level, category) 组合过滤，避免全表拉取
    // 数千个未复习词再在内存过滤。category 为 null 的单词按 "未分类" 记键，
    // 与 computeUnlockInfo 一致。
    let newWords: Word[] = [];
    if (unlockedCats.length > 0) {
      const newWordsRaw = await prisma.word.findMany({
        where: {
          reviews: { none: { userId } },
          OR: unlockedCats.map((c) => ({
            level: c.level,
            category: c.category,
          })),
        },
        orderBy: { term: "asc" },
        take: 100,
      });
      // 已解锁单元内随机抽 5 个，让每次学习的新词批次更有变化。
      newWords = shuffle(newWordsRaw).slice(0, 5);
    }

    queue = [
      ...dueSorted.map((r) => ({
        reviewId: r.id,
        word: r.word,
        state: {
          easeFactor: r.easeFactor,
          interval: r.interval,
          repetitions: r.repetitions,
          nextReviewDate: r.nextReviewDate,
          lastReviewedAt: r.lastReviewedAt,
        },
      })),
      ...newWords.map((w) => ({
        reviewId: null,
        word: w,
        state: createInitialState(),
      })),
    ];
  }

  // 干扰词同样只可来自已解锁单元，避免响应泄露未解锁内容与可提交的 wordId。
  const queueWordIds = queue.map((q) => q.word.id);
  let pool: { id: string; term: string; definition: string }[] = [];
  if (unlockedCats.length > 0) {
    const candidates = await prisma.word.findMany({
      where: {
        id: { notIn: queueWordIds },
        OR: unlockedCats,
      },
      select: { id: true, term: true, definition: true },
      take: 200,
    });
    pool = shuffle(candidates).slice(0, 40);
  }

  // 连续学习天数：随队列一起返回，前端用于展示 🔥 打卡徽章。
  const streak = await computeStreak(userId);

  // Resume may only reuse the exact locked source; it must never mint a fresh
  // unbound session after a concurrent submission consumed that source.
  const studySession =
    resumedSession && resumeSourceSessionId
      ? await reuseStudySessionForResume(
          userId,
          resumeSourceSessionId,
          queueWordIds,
        )
      : await issueStudySession(userId, queueWordIds);
  if (resumedSession && !studySession) {
    return NextResponse.json(
      { error: "恢复 session 已改变，请重新载入学习队列" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    queue,
    pool,
    unitMode,
    level,
    category,
    streak,
    resumedSession,
    studySession: serializeStudySession(studySession),
  });
}

/** POST /api/study — 提交一次学习结果（认字评估手势 或 测试 quality） */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const wordId = typeof input.wordId === "string" ? input.wordId.trim() : "";
  const suppliedOperationId =
    typeof input.operationId === "string" ? input.operationId.trim() : "";
  const studySessionId =
    typeof input.studySessionId === "string" ? input.studySessionId.trim() : "";
  const nonce = typeof input.nonce === "string" ? input.nonce.trim() : "";
  if (!wordId || wordId.length > 128) {
    return NextResponse.json({ error: "wordId 无效" }, { status: 400 });
  }
  const compatibilityEndsAt = legacyOperationIdCompatibilityEndsAt(
    process.env.STUDY_OPERATION_ID_COMPAT_UNTIL,
  );
  const allowLegacyOperationId =
    !suppliedOperationId && compatibilityEndsAt !== null;
  if (
    (suppliedOperationId &&
      !/^[A-Za-z0-9:_-]{8,200}$/.test(suppliedOperationId)) ||
    (!suppliedOperationId && !allowLegacyOperationId)
  ) {
    return NextResponse.json({ error: "operationId 无效" }, { status: 400 });
  }
  const validStudySession =
    studySessionId.length >= 8 &&
    studySessionId.length <= 128 &&
    nonce.length >= 8 &&
    nonce.length <= 128;
  if (!validStudySession) {
    return NextResponse.json({ error: "学习 session 无效或已过期" }, { status: 400 });
  }

  const hasQuality = Object.prototype.hasOwnProperty.call(input, "quality");
  const hasGesture = Object.prototype.hasOwnProperty.call(input, "gesture");
  if (hasQuality === hasGesture) {
    return NextResponse.json(
      { error: "必须且只能提供 quality 或 gesture" },
      { status: 400 },
    );
  }

  // 优先使用测试阶段直接传入的 quality（0~5），精确反映掌握程度；
  // 兼容旧的认字评估阶段（仅传 gesture）。
  let quality: Quality;
  if (hasQuality) {
    if (
      typeof input.quality !== "number" ||
      !Number.isInteger(input.quality) ||
      input.quality < 0 ||
      input.quality > 5
    ) {
      return NextResponse.json({ error: "quality 无效" }, { status: 400 });
    }
    quality = input.quality as Quality;
  } else {
    if (input.gesture !== "left" && input.gesture !== "right") {
      return NextResponse.json({ error: "gesture 无效" }, { status: 400 });
    }
    quality = gestureToQuality(input.gesture);
  }

  // Session/nonce authorization 永远开启。兼容窗口最多只允许 server 暂时代为
  // 生成 operation ID，而且必须有 30 分钟内自动失效的绝对截止时间。
  if (!suppliedOperationId) {
    console.warn(
      `[study-compat] generated operationId user=${userId} cutoff=${new Date(
        compatibilityEndsAt!,
      ).toISOString()}`,
    );
  }
  const legacyReplayAfter = suppliedOperationId
    ? undefined
    : new Date(Date.now() - 10 * 60_000);
  const operationId = suppliedOperationId || `legacy-v1:${randomUUID()}`;

  // 已完成 operation 的安全 replay 不消耗写入 rate limit。仍会核对完整
  // fingerprint；transaction 内保留第二次检查，防止 preflight 后的竞态。
  const processed = suppliedOperationId
    ? await prisma.reviewEvent.findUnique({
        where: { userId_operationId: { userId, operationId } },
      })
    : await prisma.reviewEvent.findFirst({
        where: {
          userId,
          submittedWordId: wordId,
          isHistorical: false,
          createdAt: { gte: legacyReplayAfter },
          OR: [
            { operationId: { startsWith: "legacy-v1:" }, quality },
            {
              operationId: { startsWith: "cutover:" },
              eventKind: "LEGACY_BRIDGE",
            },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
  if (processed) {
    const unknownTombstone =
      processed.wordId === null &&
      processed.submittedWordId.startsWith("unknown:");
    const legacyBridgeReplay =
      !suppliedOperationId &&
      processed.operationId.startsWith("cutover:") &&
      processed.eventKind === "LEGACY_BRIDGE";
    if (
      (!unknownTombstone && processed.submittedWordId !== wordId) ||
      (!legacyBridgeReplay && processed.quality !== quality)
    ) {
      return NextResponse.json(
        { error: "operationId 已用于不同的学习记录" },
        { status: 409 },
      );
    }
    const review = unknownTombstone
      ? null
      : await prisma.review.findUnique({
          where: {
            userId_wordId: { userId, wordId: processed.submittedWordId },
          },
        });
    const streak = await computeStreak(userId);
    return NextResponse.json({
      ok: true,
      nextState: review ? reviewStateFromRow(review) : null,
      newlyUnlocked: achievementsForKeys(processed.newlyUnlockedKeys),
      duplicate: true,
      streak,
    });
  }

  const rate = await checkStudyRate(userId);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "学习提交过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSec ?? 60) },
      },
    );
  }

  let result;
  try {
    result = await applyReviewEvent({
      userId,
      wordId,
      quality,
      operationId,
      studySessionId,
      nonce,
      legacyReplayAfter,
    });
  } catch (error) {
    if (error instanceof StudyRequestError) {
      return NextResponse.json(
        { error: error.message, ...error.details },
        { status: error.status },
      );
    }
    throw error;
  }
  const streak = await computeStreak(userId);

  return NextResponse.json({ ok: true, ...result, streak });
}

class StudyRequestError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StudyRequestError";
  }
}

function reviewStateFromRow(row: {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
}) {
  return {
    easeFactor: row.easeFactor,
    interval: row.interval,
    repetitions: row.repetitions,
    nextReviewDate: row.nextReviewDate,
    lastReviewedAt: row.lastReviewedAt,
  };
}

export async function applyReviewEvent(input: {
  userId: string;
  wordId: string;
  quality: Quality;
  operationId: string;
  studySessionId?: string;
  nonce?: string;
  legacyReplayAfter?: Date;
}) {
  const MAX_TRANSACTION_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const globalReceipt = await tx.operationReceipt.findUnique({
            where: {
              userId_operationId: {
                userId: input.userId,
                operationId: input.operationId,
              },
            },
            select: { flowVersion: true },
          });
          if (globalReceipt && globalReceipt.flowVersion !== "v1") {
            throw new StudyRequestError(409, "operationId 已用于不同的学习流程");
          }
          let processed = await tx.reviewEvent.findUnique({
            where: {
              userId_operationId: {
                userId: input.userId,
                operationId: input.operationId,
              },
            },
          });
          if (!processed && input.legacyReplayAfter) {
            processed = await tx.reviewEvent.findFirst({
              where: {
                userId: input.userId,
                submittedWordId: input.wordId,
                isHistorical: false,
                createdAt: { gte: input.legacyReplayAfter },
                OR: [
                  {
                    operationId: { startsWith: "legacy-v1:" },
                    quality: input.quality,
                  },
                  {
                    operationId: { startsWith: "cutover:" },
                    eventKind: "LEGACY_BRIDGE",
                  },
                ],
              },
              orderBy: { createdAt: "desc" },
            });
          }
          if (processed) {
            const unknownTombstone =
              processed.wordId === null &&
              processed.submittedWordId.startsWith("unknown:");
            const legacyBridgeReplay =
              Boolean(input.legacyReplayAfter) &&
              processed.operationId.startsWith("cutover:") &&
              processed.eventKind === "LEGACY_BRIDGE";
            if (
              (!unknownTombstone &&
                processed.submittedWordId !== input.wordId) ||
                (!legacyBridgeReplay && processed.quality !== input.quality)
            ) {
              throw new StudyRequestError(
                409,
                "operationId 已用于不同的学习记录",
              );
            }
            const review = unknownTombstone
              ? null
              : await tx.review.findUnique({
                  where: {
                    userId_wordId: {
                      userId: input.userId,
                      wordId: processed.submittedWordId,
                    },
                  },
                });
            return {
              nextState: review ? reviewStateFromRow(review) : null,
              newlyUnlocked: achievementsForKeys(
                processed.newlyUnlockedKeys,
              ),
              duplicate: true,
            };
          }

          const word = await tx.word.findUnique({
            where: { id: input.wordId },
            select: { term: true, level: true, category: true },
          });
          if (!word) throw new StudyRequestError(404, "单词不存在");

          // The HTTP route always supplies both values. The optional shape keeps
          // the migration/idempotency checker able to exercise the ledger in
          // isolation without manufacturing browser sessions.
          if (input.studySessionId || input.nonce) {
            if (!input.studySessionId || !input.nonce) {
              throw new StudyRequestError(403, "学习 session 无效或已过期");
            }
            const sessionItem = await tx.studySessionItem.findUnique({
              where: {
                sessionId_wordId: {
                  sessionId: input.studySessionId,
                  wordId: input.wordId,
                },
              },
              include: {
                session: {
                  select: { userId: true, expiresAt: true, retiredAt: true },
                },
              },
            });
            if (
              !sessionItem ||
              sessionItem.session.userId !== input.userId ||
              sessionItem.nonce !== input.nonce
            ) {
              throw new StudyRequestError(403, "学习 session 无效或已过期");
            }
            if (sessionItem.usedAt) {
              const currentReview = await tx.review.findUnique({
                where: {
                  userId_wordId: {
                    userId: input.userId,
                    wordId: input.wordId,
                  },
                },
              });
              throw new StudyRequestError(409, "该学习题目已经提交", {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: input.wordId,
                requiresQueueReload: true,
                currentReviewState: currentReview
                  ? reviewStateFromRow(currentReview)
                  : null,
              });
            }
            if (
              sessionItem.session.retiredAt !== null ||
              sessionItem.renewedAt !== null
            ) {
              throw new StudyRequestError(
                409,
                "学习 session 已由较新的凭证取代",
                {
                  code: "SESSION_SUPERSEDED",
                  wordId: input.wordId,
                  requiresQueueReload: true,
                },
              );
            }
            if (
              sessionItem.session.expiresAt <= new Date() ||
              (sessionItem.operationId !== null &&
                sessionItem.operationId !== input.operationId)
            ) {
              throw new StudyRequestError(403, "学习 session 无效或已过期");
            }
            const consumed = await tx.studySessionItem.updateMany({
              where: { id: sessionItem.id, usedAt: null },
              data: { usedAt: new Date() },
            });
            if (consumed.count !== 1) {
              const currentReview = await tx.review.findUnique({
                where: {
                  userId_wordId: {
                    userId: input.userId,
                    wordId: input.wordId,
                  },
                },
              });
              throw new StudyRequestError(409, "该学习题目已经提交", {
                code: "REVIEW_ALREADY_PROCESSED",
                wordId: input.wordId,
                requiresQueueReload: true,
                currentReviewState: currentReview
                  ? reviewStateFromRow(currentReview)
                  : null,
              });
            }
          }

          const existing = await tx.review.findUnique({
            where: {
              userId_wordId: {
                userId: input.userId,
                wordId: input.wordId,
              },
            },
          });
          if (!existing) {
            // 授权读取与状态写入在同一个 Serializable transaction 内；并发请求
            // 改变前置单元掌握状态时，本交易会冲突重试并重新计算解锁。
            const unlockInfo = await computeUnlockInfo(input.userId, tx);
            const unitKey = `${word.level}::${word.category ?? "未分类"}`;
            if (unlockInfo.unitUnlock[unitKey] !== true) {
              throw new StudyRequestError(403, "该单元尚未解锁");
            }
          }
          const previousState = existing
            ? reviewStateFromRow(existing)
            : createInitialState();
          const nextState = updateSM2(previousState, input.quality);

          // 告知 cutover trigger 这是一笔会由 v2 代码显式写 ledger 的交易。
          await tx.$executeRaw`SELECT set_config('app.review_event_writer', 'v2', true)`;
          await tx.review.upsert({
            where: {
              userId_wordId: {
                userId: input.userId,
                wordId: input.wordId,
              },
            },
            create: {
              userId: input.userId,
              wordId: input.wordId,
              ...nextState,
              totalReviews: 1,
            },
            update: {
              ...nextState,
              totalReviews: { increment: 1 },
            },
          });

          await checkInStudyDay(input.userId, tx);
          const newlyUnlocked = await checkAchievements(input.userId, tx);
          const event = await tx.reviewEvent.create({
            data: {
              userId: input.userId,
              submittedWordId: input.wordId,
              wordId: input.wordId,
              wordTerm: word.term,
              wordLevel: word.level,
              operationId: input.operationId,
              eventKind: "REVIEW",
              quality: input.quality,
              newlyUnlockedKeys: newlyUnlocked.map((a) => a.key),
            },
          });
          await tx.operationReceipt.create({
            data: {
              userId: input.userId,
              operationId: input.operationId,
              flowVersion: "v1",
              actionKind: "REVIEW",
              requestFingerprint: createHash("sha256")
                .update(JSON.stringify({
                  flowVersion: "v1",
                  actionKind: "REVIEW",
                  wordId: input.wordId,
                  quality: input.quality,
                  studySessionId: input.studySessionId ?? null,
                  nonce: input.nonce ?? null,
                }))
                .digest("hex"),
              outcomeStatus: "SCORED",
              outcomeReference: event.id,
              response: {
                nextState: {
                  ...nextState,
                  nextReviewDate: nextState.nextReviewDate.toISOString(),
                  lastReviewedAt: nextState.lastReviewedAt?.toISOString() ?? null,
                },
                newlyUnlocked: newlyUnlocked.map((achievement) => achievement.key),
              },
            },
          });

          return { nextState, newlyUnlocked, duplicate: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable =
        isRetryableTransactionConflict(error) ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002");
      if (!retryable || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      await waitForTransactionRetry(attempt - 1);
    }
  }
  throw new Error("Review transaction retry exhausted");
}
