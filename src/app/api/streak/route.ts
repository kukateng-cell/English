import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { computeStreak, fetchRecentStudyDays } from "@/lib/streak";

/**
 * GET /api/streak
 * 返回当前用户的连续学习天数 + 最近 60 天的打卡日期（供打卡日历展示）。
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const streak = await computeStreak(userId);
  const days = await fetchRecentStudyDays(userId, 60);

  return NextResponse.json({ streak, days });
}
