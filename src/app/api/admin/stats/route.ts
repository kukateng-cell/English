import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export async function GET() {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const [totalUsers, totalWords, totalReviews, usersByRole, wordsByLevel, reviewsToday] =
      await Promise.all([
        prisma.user.count(),
        prisma.word.count(),
        prisma.review.count(),
        prisma.user.groupBy({ by: ["role"], _count: true }),
        prisma.word.groupBy({ by: ["level"], _count: true }),
        prisma.review.count({
          where: {
            lastReviewedAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

    const roleMap: Record<string, number> = {};
    for (const r of usersByRole) roleMap[r.role] = r._count;

    return NextResponse.json({
      totalUsers,
      totalStudents: roleMap["STUDENT"] ?? 0,
      totalTeachers: roleMap["TEACHER"] ?? 0,
      totalAdmins: roleMap["ADMIN"] ?? 0,
      totalWords,
      totalReviews,
      reviewsToday,
      wordsByLevel: wordsByLevel.map((w) => ({ level: w.level, count: w._count })),
    });
  } catch {
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
