import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { fetchRecentStudyDays, offsetDay, todayKey, todayStartUtc } from "@/lib/streak";
import { getStudentDashboard } from "@/lib/student-metrics";
import { currentCatalogReviewEventWhere, withCurrentCatalogWord } from "@/lib/catalog/runtime";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) return errorResponse(auth.message, auth.status);
  const rawDays = new URL(req.url).searchParams.get("days") ?? "7";
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 60) return errorResponse("日期範圍無效");
  const today = todayKey();
  const sinceDay = offsetDay(today, -(days - 1));
  const since = new Date(`${sinceDay}T00:00:00+08:00`);
  const [dashboard, studyDays, activityEvents, recentRows] = await Promise.all([
    getStudentDashboard(auth.userId),
    fetchRecentStudyDays(auth.userId, Math.max(days, 30)),
    prisma.reviewEvent.findMany({ where: { AND: [currentCatalogReviewEventWhere(), { userId: auth.userId, createdAt: { gte: since } }] }, select: { createdAt: true } }),
    prisma.reviewEvent.findMany({
      where: { AND: [currentCatalogReviewEventWhere(), { userId: auth.userId, createdAt: { gte: since } }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, wordId: true, wordTerm: true, createdAt: true },
    }),
  ]);
  const countByDay = new Map<string, number>();
  for (const event of activityEvents) {
    const day = todayKey(event.createdAt);
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }
  const wordIds = recentRows.flatMap((row) => row.wordId ? [row.wordId] : []);
  const reviews = await prisma.review.findMany({ where: { userId: auth.userId, wordId: { in: wordIds }, word: withCurrentCatalogWord() }, select: { wordId: true, nextReviewDate: true } });
  const nextReviewByWord = new Map(reviews.map((review) => [review.wordId, review.nextReviewDate.toISOString()]));
  const activity = Array.from({ length: days }, (_, index) => {
    const day = offsetDay(sinceDay, index);
    return { day, count: countByDay.get(day) ?? 0 };
  });
  const response = NextResponse.json({
    days,
    today: dashboard.today,
    library: dashboard.library,
    libraryByLevel: dashboard.libraryByLevel,
    streak: dashboard.streak,
    activity,
    studyDays,
    recent: recentRows.map((row) => ({ id: row.id, wordId: row.wordId, term: row.wordTerm, reviewedAt: row.createdAt.toISOString(), nextReviewAt: row.wordId ? nextReviewByWord.get(row.wordId) ?? null : null })),
    todayStart: todayStartUtc().toISOString(),
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
