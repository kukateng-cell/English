import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    // 只在 DB 侧统计「已掌握」数量（interval > 21），用 _count + where 下推，
    // 避免把每个学生的全部 Review 行读进内存再 filter。
    const students = await prisma.user.findMany({
      where: { role: ROLES.STUDENT },
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: { reviews: { where: { interval: { gt: 21 } } } },
        },
      },
    });

    const totalWords = await prisma.word.count();
    const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: true });

    const levelWordCounts: Record<string, number> = {};
    for (const l of wordsByLevel) levelWordCounts[l.level] = l._count;

    // 每个学生的掌握情况（mastered 已由 DB 聚合得出，无需内存过滤）
    const studentStats = students.map((s) => {
      const masteredCount = s._count.reviews;
      return {
        name: s.name,
        email: s.email,
        mastered: masteredCount,
        progress: totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0,
      };
    });

    const totalMastered = studentStats.reduce((sum, s) => sum + s.mastered, 0);

    // 最近活跃（按复习记录排序）
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
      if (r.interval > 21) recentMap.get(key)!.mastered++;
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
      activeToday: recentActivity.length,
      totalWordsMastered: totalMastered,
      avgProgress: students.length > 0
        ? Math.round(studentStats.reduce((s, st) => s + st.progress, 0) / students.length)
        : 0,
      byLevel: wordsByLevel.map((l) => ({
        level: l.level,
        mastered: 0,
        total: l._count,
      })),
      recentActivity,
    });
  } catch {
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
