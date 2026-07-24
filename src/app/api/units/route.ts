import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aggregateAllLevels, levelCompare } from "@/lib/units";

/**
 * 把前端传入的级别字符串规范化为大写，非法值回退为 A1。
 * 注意：查询时不再用 levelWhere() 包一层——aggregateAllLevels 直接基于
 * 全量单词做聚合，省去与两种 schema 的枚举/字符串类型纠缠。
 */
function normalizeLevel(s: string | null): string {
  const v = (s ?? "A1").toUpperCase();
  return v === "A2" || v === "B1" || v === "B2" ? v : "A1";
}

/**
 * GET /api/units?level=A1
 * 返回该级别下所有单元（即 word list 中的 `### Category`）及当前用户的完成进度，
 * 并附带「闯关解锁」状态：
 *
 * 返回结构：
 * {
 *   level: "A1",
 *   levelUnlocked: true,                 // 当前级别是否已解锁
 *   levels: ["A1","A2","B1"],            // 数据库中实际存在单词的级别（向后兼容）
 *   levelStatus: [                       // 各级别解锁/完成状态（级别切换 tab 用）
 *     { level, unlocked, completed, progress }
 *   ],
 *   units: [
 *     { name, total, learned, mastered, due, progress, completed, unlocked }
 *   ]
 * }
 *
 * 解锁规则见 src/lib/units.ts。
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const requestedLevel = normalizeLevel(url.searchParams.get("level"));

  // 一次 groupBy 同时拿到「存在的级别」与「每个 (level, category) 单元的总词数」，
  // 替代原先「distinct level + findMany 全部 words」的全表扫描。
  const unitTotalsRows = await prisma.word.groupBy({
    by: ["level", "category"],
    _count: { _all: true },
  });
  const availableLevels = [
    ...new Set(unitTotalsRows.map((r) => r.level as string)),
  ].sort(levelCompare);

  const unitTotals = unitTotalsRows.map((r) => ({
    level: r.level as string,
    category: r.category,
    total: r._count._all,
  }));

  // 当前用户全部 Review 记录（select 一并带上所属单词的 level / category，
  // 以便按单元聚合 learned/mastered/due，无需再读全表 Word）。
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

  const now = new Date();

  // 一次性聚合所有级别，并计算解锁状态
  const aggregations = aggregateAllLevels(
    availableLevels,
    unitTotals,
    reviews,
    now,
  );

  // 找到当前请求的级别（若不存在则回退到第一个可用级别）
  let current =
    aggregations.find((a) => a.level === requestedLevel) ?? aggregations[0];

  // 若请求的级别根本不存在（无数据），构造一个空的占位结果
  if (!current) {
    current = {
      level: requestedLevel,
      unlocked: false,
      completed: false,
      progress: 0,
      units: [],
    };
  }

  return NextResponse.json({
    level: current.level,
    levelUnlocked: current.unlocked,
    levels: availableLevels,
    levelStatus: aggregations.map((a) => ({
      level: a.level,
      unlocked: a.unlocked,
      completed: a.completed,
      progress: a.progress,
    })),
    units: current.units,
  });
}
