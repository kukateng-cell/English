import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, type Word } from "@/lib/prisma";
import {
  updateSM2,
  gestureToQuality,
  createInitialState,
  type Quality,
} from "@/lib/sm2";
import { aggregateAllLevels, levelCompare, normalizeLevel } from "@/lib/units";
import { computeStreak, checkInStudyDay } from "@/lib/streak";
import { checkAchievements } from "@/lib/achievements";

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
async function computeUnlockInfo(userId: string): Promise<{
  unitUnlock: Record<string, boolean>;
  unlockedKeys: Set<string>;
}> {
  // 一次 groupBy 同时拿到「存在的级别」与「每个单元的总词数」，
  // 替代原先「distinct level + findMany 全部 words」的全表扫描。
  const unitTotalsRows = await prisma.word.groupBy({
    by: ["level", "category"],
    _count: { _all: true },
  });
  const levels = [
    ...new Set(unitTotalsRows.map((r) => r.level as string)),
  ].sort(levelCompare);

  const unitTotals = unitTotalsRows.map((r) => ({
    level: r.level as string,
    category: r.category,
    total: r._count._all,
  }));

  // 当前用户 Review（select 一并带 word 的 level / category），按单元聚合。
  const reviewRows = await prisma.review.findMany({
    where: { userId },
    select: {
      repetitions: true,
      nextReviewDate: true,
      word: { select: { level: true, category: true } },
    },
  });
  const reviews = reviewRows.map((r) => ({
    repetitions: r.repetitions,
    nextReviewDate: r.nextReviewDate,
    level: r.word.level as string,
    category: r.word.category,
  }));

  const aggregations = aggregateAllLevels(levels, unitTotals, reviews, new Date());

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

/**
 * GET /api/study
 * - 无参数：全局「今日待复习 + 新词」队列（默认学习模式）。
 * - ?level=A1&category=Hello and Goodbye：单元练习模式，
 *   返回该单元内【全部】单词（无论是否到期），便于用户完整练习该单元。
 *   排序：未学 → 到期待复习 → 已排期（未到期），把需要关注的词放在前面。
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const level = url.searchParams.get("level");
  const unitMode = !!(category && level);

  // 计算解锁状态：单元模式用于拦截被锁单元；全局模式用于过滤新词来源。
  const { unitUnlock, unlockedKeys } = await computeUnlockInfo(userId);

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

  if (unitMode) {
    // ── 单元练习模式：取出该单元全部单词 ──
    const unitWords = await prisma.word.findMany({
      where: { level: normalizeLevel(level), category },
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

    queue = unitWords.map((w) => {
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

    // 排序：未学(0) → 到期待复习(1) → 已排期未到期(2)；
    // 同优先级内随机打散，避免单元内总是固定字母序。
    const rank = (q: (typeof queue)[number]) => {
      if (!q.reviewId) return 0; // 未学
      return q.state.nextReviewDate <= now ? 1 : 2; // 到期 / 已排期
    };
    const byRank: QueueItem[][] = [[], [], []];
    for (const q of queue) byRank[rank(q)].push(q);
    queue = byRank.flatMap((g) => shuffle(g));
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
    const reviewedWordIds = (
      await prisma.review.findMany({
        where: { userId },
        select: { wordId: true },
      })
    ).map((r) => r.wordId);

    const newWordsRaw = await prisma.word.findMany({
      where: {
        id: { notIn: reviewedWordIds },
      },
      orderBy: { term: "asc" },
    });

    // 新词只从已解锁单元中引入，避免绕过闯关解锁直接学习后续单元。
    // category 为 null 的单词按 "未分类" 记键，与 computeUnlockInfo 一致。
    // 新词从已解锁单元中随机抽取 5 个（而非固定字母序前 5 个），
    // 让每次学习的新词批次更有变化，避免总是从 A 开头的那批开始。
    const newWords = shuffle(
      newWordsRaw.filter((w) =>
        unlockedKeys.has(`${w.level}::${w.category ?? "未分类"}`),
      ),
    ).slice(0, 5);

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

  // 取干扰词池（用于「测试」阶段的选择题选项）
  // 从词库中随机窗口取 40 个，客户端每次从中随机抽 3 个作干扰项
  const queueWordIds = queue.map((q) => q.word.id);
  let pool: { id: string; term: string; definition: string }[] = [];
  try {
    const totalWords = await prisma.word.count();
    const poolSize = Math.min(40, totalWords);
    const skip =
      totalWords > poolSize
        ? Math.floor(Math.random() * (totalWords - poolSize))
        : 0;
    pool = await prisma.word.findMany({
      where: { id: { notIn: queueWordIds } },
      skip,
      take: poolSize,
      select: { id: true, term: true, definition: true },
      orderBy: { term: "asc" },
    });
  } catch {
    pool = [];
  }

  // 连续学习天数：随队列一起返回，前端用于展示 🔥 打卡徽章。
  const streak = await computeStreak(userId);

  return NextResponse.json({ queue, pool, unitMode, level, category, streak });
}

/** POST /api/study — 提交一次学习结果（认字评估手势 或 测试 quality） */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const body = await req.json();
  const { wordId, gesture, quality: qualityInput } = body as {
    wordId: string;
    gesture?: "left" | "right";
    quality?: number;
  };

  // 优先使用测试阶段直接传入的 quality（0~5），精确反映掌握程度；
  // 兼容旧的认字评估阶段（仅传 gesture）。
  let quality: Quality;
  if (
    typeof qualityInput === "number" &&
    Number.isInteger(qualityInput) &&
    qualityInput >= 0 &&
    qualityInput <= 5
  ) {
    quality = qualityInput as Quality;
  } else {
    quality = gestureToQuality(gesture ?? "left");
  }

  // 用 (userId, wordId) 这个【业务唯一约束】来查是否已存在，
  // 不依赖客户端传的 id（前端状态可能丢失/重复提交，会导致 create 撞唯一约束 500）。
  const existing = await prisma.review.findUnique({
    where: { userId_wordId: { userId, wordId } },
  });

  const prevState = existing
    ? {
        easeFactor: existing.easeFactor,
        interval: existing.interval,
        repetitions: existing.repetitions,
        nextReviewDate: existing.nextReviewDate,
        lastReviewedAt: existing.lastReviewedAt,
      }
    : createInitialState();

  const nextState = updateSM2(prevState, quality);

  // upsert 原子地处理「已存在则更新 / 不存在则创建」，彻底避免并发重复提交的约束冲突。
  await prisma.review.upsert({
    where: { userId_wordId: { userId, wordId } },
    create: {
      userId,
      wordId,
      ...nextState,
      totalReviews: 1,
    },
    update: {
      ...nextState,
      totalReviews: { increment: 1 },
    },
  });

  // 打卡：完成一次有效学习（测试答对并提交）即记为「今天学过」，用于连续学习天数。
  // upsert 幂等——同一天多次提交只保留一条打卡记录。
  await checkInStudyDay(userId);
  const streak = await computeStreak(userId);
  // 成就检查：打卡后检查并解锁可能达成的新成就（幂等），返回本次新解锁的。
  const newlyUnlocked = await checkAchievements(userId);

  return NextResponse.json({ ok: true, nextState, streak, newlyUnlocked });
}
