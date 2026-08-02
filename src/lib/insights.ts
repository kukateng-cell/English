/**
 * 学生留存画像：批量计算连续天数 / 今日打卡 / 累计打卡 / 成就数 / 最近打卡，
 * 供老师端（学生进度）与管理端（概览）使用。
 *
 * 学生数量小，一次性全量读取 StudyDay / UserAchievement 在内存聚合。
 */
import { prisma } from "@/lib/prisma";
import { todayKey, offsetDay } from "@/lib/streak";
import { countStreak } from "@/lib/leaderboard";

/** 每个学生的留存画像。 */
export interface StudentInsight {
  /** 连续学习天数（今天或昨天起算）。 */
  streak: number;
  /** 今天是否已打卡。 */
  studiedToday: boolean;
  /** 累计打卡天数。 */
  cumulativeDays: number;
  /** 已解锁成就数。 */
  achievementCount: number;
  /** 最近一次打卡日期（YYYY-MM-DD）。 */
  lastStudyDate: string | null;
  /** 最近 30 天打卡日期（升序，供打卡日历展示）。 */
  days: string[];
}

/**
 * 批量计算【所有学生】的留存画像，返回 Map<userId, StudentInsight>。
 * 对没有任何打卡记录的学生不返回条目（调用方按 0 处理）。
 */
export async function getStudentInsights(): Promise<Map<string, StudentInsight>> {
  const [studyDays, achievements] = await Promise.all([
    prisma.studyDay.findMany({ select: { userId: true, date: true } }),
    prisma.userAchievement.groupBy({ by: ["userId"], _count: true }),
  ]);

  // 按用户聚合打卡日期
  const datesByUser = new Map<string, Set<string>>();
  for (const s of studyDays) {
    const set = datesByUser.get(s.userId) ?? new Set<string>();
    set.add(s.date);
    datesByUser.set(s.userId, set);
  }
  const achievementCount = new Map(
    achievements.map((a) => [a.userId, a._count]),
  );

  const today = todayKey();
  const since30 = offsetDay(today, -29);
  const result = new Map<string, StudentInsight>();
  for (const [userId, dates] of datesByUser) {
    const sorted = [...dates].sort();
    result.set(userId, {
      streak: countStreak(dates),
      studiedToday: dates.has(today),
      cumulativeDays: dates.size,
      achievementCount: achievementCount.get(userId) ?? 0,
      lastStudyDate: sorted.length ? sorted[sorted.length - 1] : null,
      days: sorted.filter((d) => d >= since30),
    });
  }
  return result;
}

/**
 * 最近 n 天「每日打卡人数」趋势（管理端概览用）。
 * 返回 [{ date, count }] 按日期升序，含当天（可能为 0）。
 */
export async function getDailyActiveTrend(
  n: number,
): Promise<{ date: string; count: number }[]> {
  const today = todayKey();
  const since = offsetDay(today, -(n - 1));
  const rows = await prisma.studyDay.findMany({
    where: { date: { gte: since } },
    select: { date: true },
  });
  const countByDate = new Map<string, number>();
  for (const r of rows) {
    countByDate.set(r.date, (countByDate.get(r.date) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = offsetDay(today, -i);
    out.push({ date: d, count: countByDate.get(d) ?? 0 });
  }
  return out;
}
