import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAchievementStatus } from "@/lib/achievements";

/**
 * GET /api/achievements
 * 返回全部成就定义 + 当前用户的解锁状态与进度。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const achievements = await getAchievementStatus(userId);
  return NextResponse.json({ achievements });
}
