import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getStudentInsights } from "@/lib/insights";

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    // totalReviews：用 DB 侧的 _count 下推，避免把 Review 行读进内存。
    const students = await prisma.user.findMany({
      where: { role: ROLES.STUDENT },
      select: {
        id: true,
        name: true,
        email: true,
        _count: { select: { reviews: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const totalWords = await prisma.word.count();
    const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: true });
    const levelWordCounts: Record<string, number> = {};
    for (const l of wordsByLevel) levelWordCounts[l.level] = l._count;

    // 留存画像（连续天数 / 今日打卡 / 成就数 / 最近 30 天打卡）
    const insights = await getStudentInsights();

    // 只取「已掌握」(interval > 21) 的 Review 行，where 下推到 DB；
    // 这里只传输满足条件的子集（而非全部 Review），再在内存按 (学生, 级别) 聚合。
    const masteredRows = await prisma.review.findMany({
      where: { user: { role: ROLES.STUDENT }, interval: { gt: 21 } },
      select: {
        userId: true,
        word: { select: { level: true } },
      },
    });

    // 按 (userId) 与 (userId, level) 聚合「已掌握」数量
    const masteredByUser = new Map<string, number>();
    const masteredByUserLevel = new Map<string, number>();
    for (const r of masteredRows) {
      masteredByUser.set(r.userId, (masteredByUser.get(r.userId) ?? 0) + 1);
      const lvl = r.word.level as string;
      const key = `${r.userId}::${lvl}`;
      masteredByUserLevel.set(key, (masteredByUserLevel.get(key) ?? 0) + 1);
    }

    return NextResponse.json(
      students.map((s) => {
        const mastered = masteredByUser.get(s.id) ?? 0;

        const byLevel = wordsByLevel.map((l) => {
          const lvlMastered =
            masteredByUserLevel.get(`${s.id}::${l.level as string}`) ?? 0;
          return {
            level: l.level,
            mastered: lvlMastered,
            total: l._count,
            progress: l._count > 0 ? Math.round((lvlMastered / l._count) * 100) : 0,
          };
        });

        return {
          id: s.id,
          name: s.name,
          email: s.email,
          totalReviews: s._count.reviews,
          masteredWords: mastered,
          totalWords,
          progress: totalWords > 0 ? Math.round((mastered / totalWords) * 100) : 0,
          byLevel,
          ...(insights.get(s.id) ?? {
            streak: 0,
            studiedToday: false,
            cumulativeDays: 0,
            achievementCount: 0,
            lastStudyDate: null,
            days: [],
          }),
        };
      })
    );
  } catch {
    return NextResponse.json({ error: "获取学生数据失败" }, { status: 500 });
  }
}
