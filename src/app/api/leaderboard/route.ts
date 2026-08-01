import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getLeaderboard } from "@/lib/leaderboard";

/**
 * GET /api/leaderboard
 * 返回学生排行榜（连续天数 / 掌握词数 / 累计打卡三个榜单）。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const data = await getLeaderboard(userId);
  return NextResponse.json(data);
}
