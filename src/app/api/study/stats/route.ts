import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayStartUtc } from "@/lib/streak";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";

/**
 * GET /api/study/stats — 当前用户的「学习统计」概览（PLAN 核心功能 #7）。
 *
 * 返回：
 *   - totalWords     词库总词数
 *   - reviewedCount  累计复习过的词数（Review 记录数）
 *   - todayNew       今日新学词数（今天首次复习 totalReviews=1 的词）
 *   - todayReviewed  今日复习过的词数（lastReviewedAt 在今天）
 *   - masteredCount  已掌握词数（SM-2 interval >= MASTERED_MIN_INTERVAL，与排行榜同口径）
 *   - mastery        总体掌握度（masteredCount / totalWords，百分比）
 *
 * 说明：
 *   - Review 无 createdAt 字段，用「lastReviewedAt 在今天 且 totalReviews=1」判定新学，
 *     与打卡 / 连续天数的东八区「今天」口径一致（todayStartUtc）。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const todayStart = todayStartUtc();
  const [totalWords, reviewedCount, todayReviewed, masteredCount, todayNew] =
    await Promise.all([
      prisma.word.count(),
      prisma.review.count({ where: { userId } }),
      prisma.review.count({
        where: { userId, lastReviewedAt: { gte: todayStart } },
      }),
      prisma.review.count({
        where: { userId, interval: { gte: MASTERED_MIN_INTERVAL } },
      }),
      prisma.review.count({
        where: {
          userId,
          totalReviews: 1,
          lastReviewedAt: { gte: todayStart },
        },
      }),
    ]);

  return NextResponse.json({
    totalWords,
    reviewedCount,
    todayNew,
    todayReviewed,
    masteredCount,
    mastery: totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0,
  });
}
