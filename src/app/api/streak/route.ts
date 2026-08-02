import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeStreak, fetchRecentStudyDays } from "@/lib/streak";

/**
 * GET /api/streak
 * 返回当前用户的连续学习天数 + 最近 60 天的打卡日期（供打卡日历展示）。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const streak = await computeStreak(userId);
  const days = await fetchRecentStudyDays(userId, 60);

  return NextResponse.json({ streak, days });
}
