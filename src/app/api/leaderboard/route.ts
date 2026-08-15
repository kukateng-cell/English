import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getLeaderboard } from "@/lib/leaderboard";

/**
 * GET /api/leaderboard
 * 返回学生排行榜（客观认读连续天数 / 掌握词数 / 累计打卡三个榜单）。
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const data = await getLeaderboard(userId);
  const publicData = {
    ...data,
    me: "me",
    lists: data.lists.map((list) => ({
      ...list,
      entries: list.entries.map((entry) => Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== "userId"),
      )),
    })),
  };
  return NextResponse.json(publicData, { headers: { "Cache-Control": "no-store" } });
}
