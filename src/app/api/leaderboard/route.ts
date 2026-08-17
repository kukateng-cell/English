import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import {
  getLeaderboard,
  isLeaderboardScope,
  LeaderboardScopeUnavailableError,
} from "@/lib/leaderboard";

/**
 * GET /api/leaderboard?scope=class|grade|school
 * 返回所選學生排行榜，以及本班／全年級／全校的個人排名概覽。
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const userId = auth.userId;

  const rawScope = new URL(request.url).searchParams.get("scope");
  if (rawScope !== null && !isLeaderboardScope(rawScope)) {
    return NextResponse.json({ error: "LEADERBOARD_SCOPE_INVALID" }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof getLeaderboard>>;
  try {
    data = await getLeaderboard(userId, rawScope ?? undefined);
  } catch (error) {
    if (error instanceof LeaderboardScopeUnavailableError) {
      return NextResponse.json(
        { error: error.message, scope: error.scope, reason: error.reason },
        { status: 422 },
      );
    }
    throw error;
  }

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
  return NextResponse.json(publicData, { headers: { "Cache-Control": "private, no-store" } });
}
