import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, Prisma } from "@/lib/prisma";
import { updateSM2, gestureToQuality, createInitialState } from "@/lib/sm2";

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

    const newWords = await prisma.word.findMany({
      where: {
        id: { notIn: reviewedWordIds },
      },
      take: 5,
      orderBy: { term: "asc" },
    });

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

/** POST /api/study — 提交一次滑动结果 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const body = await req.json();
  const { wordId, gesture } = body as {
    wordId: string;
    gesture: "left" | "right";
  };

  const quality = gestureToQuality(gesture);

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
