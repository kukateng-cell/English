import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { prisma, Prisma } from "@/lib/prisma";
import { fetchRecentStudyDays, offsetDay, todayKey, todayStartUtc } from "@/lib/streak";
import { getStudentDashboard } from "@/lib/student-metrics";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.STUDENT);
  if (!auth.ok) return errorResponse(auth.message, auth.status);
  const rawDays = new URL(req.url).searchParams.get("days") ?? "7";
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 60) return errorResponse("日期范围无效");
  const today = todayKey();
  const sinceDay = offsetDay(today, -(days - 1));
  const since = new Date(`${sinceDay}T00:00:00+08:00`);
  const [dashboard, studyDays, activityRows, recentRows] = await Promise.all([
    getStudentDashboard(auth.userId),
    fetchRecentStudyDays(auth.userId, Math.max(days, 30)),
    prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
      SELECT ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date::text AS day,
             COUNT(*)::integer AS count
      FROM "ReviewEvent"
      WHERE "userId" = ${auth.userId}
        AND "eventKind" = 'REVIEW'
        AND "isHistorical" = false
        AND "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.reviewEvent.findMany({
      where: { userId: auth.userId, eventKind: "REVIEW", isHistorical: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, wordId: true, wordTerm: true, createdAt: true },
    }),
  ]);
  const wordIds = recentRows.flatMap((row) => row.wordId ? [row.wordId] : []);
  const reviews = await prisma.review.findMany({ where: { userId: auth.userId, wordId: { in: wordIds } }, select: { wordId: true, nextReviewDate: true } });
  const nextReviewByWord = new Map(reviews.map((review) => [review.wordId, review.nextReviewDate.toISOString()]));
  const countByDay = new Map(activityRows.map((row) => [row.day, row.count]));
  const activity = Array.from({ length: days }, (_, index) => {
    const day = offsetDay(sinceDay, index);
    return { day, count: countByDay.get(day) ?? 0 };
  });
  const response = NextResponse.json({
    days,
    today: dashboard.today,
    library: dashboard.library,
    streak: dashboard.streak,
    activity,
    studyDays,
    recent: recentRows.map((row) => ({ id: row.id, wordId: row.wordId, term: row.wordTerm, reviewedAt: row.createdAt.toISOString(), nextReviewAt: row.wordId ? nextReviewByWord.get(row.wordId) ?? null : null })),
    todayStart: todayStartUtc().toISOString(),
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
