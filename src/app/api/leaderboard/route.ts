import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getClientIp } from "@/lib/login-limiter";
import { checkStudyQueueRate } from "@/lib/study-limiter";
import {
  getWeeklyLeaderboard,
  isLeaderboardScope,
  LeaderboardScopeUnavailableError,
  WeeklyLeaderboardCursorError,
  WeeklyLeaderboardForbiddenError,
  WeeklyLeaderboardUnavailableError,
  type LeaderboardView,
} from "@/lib/leaderboard";
import { ROLES } from "@/lib/roles";

/** GET /api/leaderboard?scope=class|grade|school&view=summary|all&cursor=... */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  if (auth.role !== ROLES.STUDENT) return NextResponse.json({ error: "LEADERBOARD_STUDENT_ONLY" }, { status: 403 });
  const rate = await checkStudyQueueRate(auth.userId, getClientIp(request.headers));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "排行榜請求過於頻繁，請稍後再試" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } },
    );
  }

  const params = new URL(request.url).searchParams;
  const allowedParams = new Set(["scope", "view", "cursor"]);
  for (const key of new Set(params.keys())) {
    if (!allowedParams.has(key) || params.getAll(key).length > 1) {
      return NextResponse.json({ error: "LEADERBOARD_QUERY_INVALID" }, { status: 400 });
    }
  }
  const rawScope = params.get("scope");
  if (rawScope !== null && !isLeaderboardScope(rawScope)) {
    return NextResponse.json({ error: "LEADERBOARD_SCOPE_INVALID" }, { status: 400 });
  }
  const rawView = params.get("view");
  if (rawView !== null && rawView !== "summary" && rawView !== "all") {
    return NextResponse.json({ error: "LEADERBOARD_VIEW_INVALID" }, { status: 400 });
  }
  const cursor = params.get("cursor") ?? undefined;
  if (params.has("cursor") && !cursor) return NextResponse.json({ error: "LEADERBOARD_CURSOR_INVALID" }, { status: 400 });
  if (cursor && rawView !== "all") return NextResponse.json({ error: "LEADERBOARD_CURSOR_REQUIRES_ALL" }, { status: 400 });

  try {
    const data = await getWeeklyLeaderboard({
      userId: auth.userId,
      scope: rawScope ?? undefined,
      view: (rawView as LeaderboardView | null) ?? "summary",
      cursor,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LeaderboardScopeUnavailableError) {
      return NextResponse.json({ error: error.message, scope: error.scope, reason: error.reason }, { status: 422 });
    }
    if (error instanceof WeeklyLeaderboardCursorError) {
      return NextResponse.json({ error: error.message }, { status: error.stale ? 409 : 400 });
    }
    if (error instanceof WeeklyLeaderboardForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WeeklyLeaderboardUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[leaderboard] weekly read failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "LEADERBOARD_UNAVAILABLE" }, { status: 503 });
  }
}
