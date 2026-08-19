import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { todayStartUtc } from "@/lib/streak";
import { currentCatalogReviewEventWhere, withCurrentCatalogWord } from "@/lib/catalog/runtime";

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const [totalUsers, totalWords, totalReviews, usersByRole, wordsByLevel, reviewsToday] =
      await Promise.all([
        prisma.user.count(),
        prisma.word.count({ where: withCurrentCatalogWord() }),
        prisma.reviewEvent.count({ where: currentCatalogReviewEventWhere() }),
        prisma.user.groupBy({ by: ["role"], _count: true }),
        prisma.word.groupBy({ by: ["level"], where: withCurrentCatalogWord(), _count: true }),
        prisma.reviewEvent.count({
          where: { AND: [currentCatalogReviewEventWhere(), { createdAt: { gte: todayStartUtc() } }] },
        }),
      ]);

    const roleMap: Record<string, number> = {};
    for (const r of usersByRole) roleMap[r.role] = r._count;

    return NextResponse.json({
      totalUsers,
      totalStudents: roleMap[ROLES.STUDENT] ?? 0,
      totalTeachers: roleMap[ROLES.TEACHER] ?? 0,
      totalAdmins: roleMap[ROLES.ADMIN] ?? 0,
      totalWords,
      totalReviews,
      reviewsToday,
      wordsByLevel: wordsByLevel.map((w) => ({ level: w.level, count: w._count })),
    });
  } catch {
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
