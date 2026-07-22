import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, Prisma } from "@/lib/prisma";
import { sortUnits } from "@/lib/units";

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

/** 「掌握」判定：连续答对至少 1 次（SM-2 repetitions >= 1）。 */
const MASTERED_REPETITIONS = 1;

/**
 * GET /api/units?level=A1
 * 返回该级别下所有单元（即 word list 中的 `### Category`）及当前用户的完成进度。
 *
 * 返回结构：
 * {
 *   level: "A1",
 *   levels: ["A1","A2","B1"],            // 数据库中实际存在单词的级别
 *   units: [
 *     { name, total, learned, mastered, due, progress }
 *   ]
 * }
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  // 字符串形式：用于排序 / 返回给前端；查询时用 levelWhere() 包一层以适配两种 schema。
  const level = (url.searchParams.get("level") ?? "A1").toUpperCase();

  // 数据库中实际有单词的级别（用于前端级别切换 tab）
  const levelRows = await prisma.word.findMany({
    distinct: ["level"],
    select: { level: true },
  });
  const availableLevels = levelRows
    .map((r) => r.level)
    .sort() as string[];

  // 该级别全部单词（仅取必要字段）
  const words = await prisma.word.findMany({
    where: { level: levelWhere(level) },
    select: { id: true, category: true },
  });

  // 当前用户在该级别单词上的 Review 记录
  const reviews = await prisma.review.findMany({
    where: { userId, word: { level: levelWhere(level) } },
    select: { wordId: true, repetitions: true, nextReviewDate: true },
  });
  const reviewByWord = new Map(reviews.map((r) => [r.wordId, r]));

  const now = new Date();

  // 按 category 聚合
  const agg = new Map<
    string,
    { total: number; learned: number; mastered: number; due: number }
  >();
  for (const w of words) {
    const cat = w.category ?? "未分类";
    if (!agg.has(cat)) {
      agg.set(cat, { total: 0, learned: 0, mastered: 0, due: 0 });
    }
    const u = agg.get(cat)!;
    u.total += 1;
    const r = reviewByWord.get(w.id);
    if (r) {
      u.learned += 1;
      if (r.repetitions >= MASTERED_REPETITIONS) u.mastered += 1;
      if (new Date(r.nextReviewDate) <= now) u.due += 1;
    }
  }

  // 按词表顺序排序
  const orderedNames = sortUnits(level, [...agg.keys()]);

  const units = orderedNames.map((name) => {
    const s = agg.get(name)!;
    return {
      name,
      total: s.total,
      learned: s.learned,
      mastered: s.mastered,
      due: s.due,
      progress: s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0,
    };
  });

  return NextResponse.json({ level, levels: availableLevels, units });
}
