import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { normalizeLevel } from "@/lib/units";
import { fetchUnitProgress } from "@/lib/unit-progress-server";

// normalizeLevel（级别规范化）已统一到 @/lib/units（见 LEVELS / LevelCode）。

/**
 * GET /api/units?level=A1
 * 返回该级别下所有单元（即 word list 中的 `### Category`）及当前用户的完成进度，
 * 并附带「闯关解锁」状态：
 *
 * 返回结构：
 * {
 *   level: "A1",
 *   levelUnlocked: true,                 // 当前级别是否已解锁
 *   levels: ["A1","A2","B1","B2"],            // 数据库中实际存在单词的级别
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
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const url = new URL(req.url);
  const requestedLevel = normalizeLevel(url.searchParams.get("level"));

  // PostgreSQL directly aggregates totals/learned/mastered/due per unit;
  // Node receives one row per unit instead of the user's entire review set.
  const aggregations = await fetchUnitProgress(userId);
  const availableLevels = aggregations.map((aggregation) => aggregation.level);

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
