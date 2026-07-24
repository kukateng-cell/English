import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export async function GET() {
  const auth = await requireRole("TEACHER", "ADMIN");
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const students = await prisma.user.findMany({
      where: { role: "STUDENT" },
      select: {
        id: true,
        name: true,
        email: true,
        reviews: {
          select: {
            interval: true,
            word: { select: { level: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const totalWords = await prisma.word.count();
    const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: true });
    const levelWordCounts: Record<string, number> = {};
    for (const l of wordsByLevel) levelWordCounts[l.level] = l._count;

    return NextResponse.json(
      students.map((s) => {
        const mastered = s.reviews.filter((r) => r.interval > 21).length;

        const byLevelRaw: Record<string, { mastered: number }> = {};
        for (const r of s.reviews) {
          const lvl = r.word.level;
          if (!byLevelRaw[lvl]) byLevelRaw[lvl] = { mastered: 0 };
          if (r.interval > 21) byLevelRaw[lvl].mastered++;
        }

        const byLevel = wordsByLevel.map((l) => ({
          level: l.level,
          mastered: byLevelRaw[l.level]?.mastered ?? 0,
          total: l._count,
          progress: l._count > 0
            ? Math.round(((byLevelRaw[l.level]?.mastered ?? 0) / l._count) * 100)
            : 0,
        }));

        return {
          id: s.id,
          name: s.name,
          email: s.email,
          totalReviews: s.reviews.length,
          masteredWords: mastered,
          totalWords,
          progress: totalWords > 0 ? Math.round((mastered / totalWords) * 100) : 0,
          byLevel,
        };
      })
    );
  } catch {
    return NextResponse.json({ error: "获取学生数据失败" }, { status: 500 });
  }
}
