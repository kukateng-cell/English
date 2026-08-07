import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { todayStartUtc } from "@/lib/streak";

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    // ── 1. 学生基础数据（含 totalReviews 计数） ──
    const students = await prisma.user.findMany({
      where: { role: ROLES.STUDENT },
      select: {
        id: true,
        name: true,
        email: true,
        _count: { select: { reviews: true } },
      },
    });

    // ── 2. 单词总数 & 等级分布 ──
    const totalWords = await prisma.word.count();
    const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: true });

    // ── 3. 已掌握词汇（interval >= MASTERED_MIN_INTERVAL），
    //      与 /api/teacher/students 及排行榜共用同一判定（见 lib/mastered.ts），
    //      保证「已掌握 / 掌握词数 / 平均进度」在任意时刻一致。
    const masteredRows = await prisma.review.findMany({
      where: { user: { role: ROLES.STUDENT }, interval: { gte: MASTERED_MIN_INTERVAL } },
      select: {
        userId: true,
        word: { select: { level: true } },
      },
    });

    // 按 userId 聚合「已掌握」总数
    const masteredByUser = new Map<string, number>();
    // 按 (userId, level) 聚合「已掌握」数
    const masteredByUserLevel = new Map<string, number>();
    for (const r of masteredRows) {
      masteredByUser.set(r.userId, (masteredByUser.get(r.userId) ?? 0) + 1);
      const lvl = r.word.level as string;
      const key = `${r.userId}::${lvl}`;
      masteredByUserLevel.set(key, (masteredByUserLevel.get(key) ?? 0) + 1);
    }

    // ── 4. 各等级已掌握总数（所有学生汇总） ──
    const masteredByLevel = new Map<string, number>();
    for (const r of masteredRows) {
      const lvl = r.word.level as string;
      masteredByLevel.set(lvl, (masteredByLevel.get(lvl) ?? 0) + 1);
    }

    const byLevel = wordsByLevel.map((l) => ({
      level: l.level,
      mastered: masteredByLevel.get(l.level) ?? 0,
      total: l._count,
    }));

    // ── 5. 今日活跃学生数（当天有 lastReviewedAt 的学生） ──
    // 用东八区「今天 0 点」作起点，与打卡/连续天数逻辑保持一致。
    const todayStart = todayStartUtc();
    const activeToday = await prisma.review.groupBy({
      by: ["userId"],
      where: {
        lastReviewedAt: { gte: todayStart },
        user: { role: ROLES.STUDENT },
      },
    });

    // ── 6. 汇总统计 ──
    const totalMastered = [...masteredByUser.values()].reduce((s, v) => s + v, 0);
    const studentStats = students.map((s) => {
      const mastered = masteredByUser.get(s.id) ?? 0;
      return {
        progress: totalWords > 0 ? Math.round((mastered / totalWords) * 100) : 0,
      };
    });
    const avgProgress =
      students.length > 0
        ? Math.round(studentStats.reduce((s, st) => s + st.progress, 0) / students.length)
        : 0;

    // ── 7. 最近活跃学生（最近有复习记录的） ──
    const recentReviews = await prisma.review.findMany({
      where: {
        user: { role: ROLES.STUDENT },
        lastReviewedAt: { not: null },
      },
      select: {
        user: { select: { name: true, email: true } },
        interval: true,
      },
      orderBy: { lastReviewedAt: "desc" },
      take: 30,
    });

    const recentMap = new Map<string, { name: string | null; email: string; mastered: number }>();
    for (const r of recentReviews) {
      const key = r.user.email;
      if (!recentMap.has(key)) {
        recentMap.set(key, { name: r.user.name, email: r.user.email, mastered: 0 });
      }
      if (isMasteredByInterval(r.interval)) recentMap.get(key)!.mastered++;
    }

    const recentActivity = [...recentMap.values()]
      .slice(0, 10)
      .map((s) => ({
        name: s.name || s.email,
        email: s.email,
        level: "—",
        progress: totalWords > 0 ? Math.round((s.mastered / totalWords) * 100) : 0,
      }));

    return NextResponse.json({
      totalStudents: students.length,
      activeToday: activeToday.length,
      totalWordsMastered: totalMastered,
      avgProgress,
      byLevel,
      recentActivity,
    });
  } catch {
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
