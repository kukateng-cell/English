import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, Prisma } from "@/lib/prisma";
import {
  updateSM2,
  gestureToQuality,
  createInitialState,
  type Quality,
} from "@/lib/sm2";
import { aggregateAllLevels, levelCompare } from "@/lib/units";

/**
 * 构造「按级别过滤」的查询条件，兼容两种 schema：
 *   - Postgres (prisma/schema.prisma): Word.level 是 enum Level { A1 A2 B1 }
 *   - SQLite  (prisma/schema.sqlite.prisma): Word.level 是 String
 * 用 Prisma.WordWhereInput["level"] 让 TS 自动适配当前生成的 client，
 * 避免在两种 schema 之间出现类型冲突。非法值回退为 A1。
 */
function levelWhere(s: string): Prisma.WordWhereInput["level"] {
  const v = s.toUpperCase();
  return (v === "A2" || v === "B1" ? v : "A1") as Prisma.WordWhereInput["level"];
}

/** 把级别字符串规范化为大写；非法值回退为 A1。仅用于拼解锁 key。 */
function normalizeLevel(s: string | null): string {
  const v = (s ?? "A1").toUpperCase();
  return v === "A2" || v === "B1" || v === "B2" ? v : "A1";
}

type WordRow = {
  id: string;
  term: string;
  phonetic?: string | null;
  pos?: string | null;
  definition: string;
  level: string;
  category?: string | null;
  // Postgres: Json/String[] 原生类型；SQLite 预览版: JSON 字符串
  examples?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
  imageUrl?: string | null;
};

/**
 * 兼容 SQLite 预览：把 JSON 字符串字段解析回数组/对象。
 * Postgres 原生数组/Json 不会被字符串包装，解析时原样返回。
 */
function normalizeWord<T extends WordRow>(w: T) {
  const parseArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string") {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const parseJson = (v: unknown) => {
    if (v == null) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    }
    return v;
  };
  return {
    ...w,
    examples: parseJson(w.examples),
    synonyms: parseArr(w.synonyms),
    antonyms: parseArr(w.antonyms),
  };
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

  let queue: {
    reviewId: string | null;
    word: ReturnType<typeof normalizeWord<WordRow>>;
    state: {
      easeFactor: number;
      interval: number;
      repetitions: number;
      nextReviewDate: Date;
      lastReviewedAt: Date | null;
    };
  }[] = [];

  if (unitMode) {
    // ── 单元练习模式：取出该单元全部单词 ──
    const unitWords = await prisma.word.findMany({
      where: { level: levelWhere(level), category },
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
      return { reviewId: r?.id ?? null, word: normalizeWord(w as WordRow), state };
    });

    // 排序：未学(0) → 到期待复习(1) → 已排期未到期(2)
    queue.sort((a, b) => {
      const rank = (q: (typeof queue)[number]) => {
        if (!q.reviewId) return 0; // 未学
        return q.state.nextReviewDate <= now ? 1 : 2; // 到期 / 已排期
      };
      return rank(a) - rank(b);
    });
  } else {
    // ── 默认全局模式：到期待复习 + 新词 ──
    // 1. 取出到期的 Review（待复习单词）
    const dueReviews = await prisma.review.findMany({
      where: {
        userId,
        nextReviewDate: { lte: new Date() },
      },
      include: { word: true },
      orderBy: { nextReviewDate: "asc" },
      take: 20,
    });

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
    const newWords = newWordsRaw
      .filter((w) =>
        unlockedKeys.has(`${w.level}::${w.category ?? "未分类"}`),
      )
      .slice(0, 5);

    queue = [
      ...dueReviews.map((r) => ({
        reviewId: r.id,
        word: normalizeWord(r.word as WordRow),
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
        word: normalizeWord(w as WordRow),
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

  return NextResponse.json({ queue, pool, unitMode, level, category });
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

  return NextResponse.json({ ok: true, nextState });
}
