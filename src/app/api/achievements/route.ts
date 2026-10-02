import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getAchievementStatus } from "@/lib/achievements";

/**
 * GET /api/achievements
 * 返回全部成就定义 + 当前用户的解锁状态与进度。
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const achievements = await getAchievementStatus(userId);
  return NextResponse.json({ achievements });
}
