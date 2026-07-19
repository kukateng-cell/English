import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateSM2, gestureToQuality, createInitialState } from "@/lib/sm2";

/** GET /api/study — 获取待学习的单词列表 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  // 1. 取出到期的 Review（待复习单词）
  const dueReviews = await prisma.review.findMany({
    where: {
      userId,
      nextReviewDate: { lte: new Date() },
    },
    include: { word: true },
    orderBy: { nextReviewDate: "asc" },
    take: 20,
  });

  // 2. 取新词（没有 Review 记录的单词）
  const reviewedWordIds = (
    await prisma.review.findMany({
      where: { userId },
      select: { wordId: true },
    })
  ).map((r) => r.wordId);

  const newWords = await prisma.word.findMany({
    where: {
      id: { notIn: reviewedWordIds },
    },
    take: 5,
    orderBy: { term: "asc" },
  });

  // 为新词创建初始 Review
  const newReviews = newWords.map((w) => ({
    userId,
    wordId: w.id,
    ...createInitialState(),
    totalReviews: 0,
    word: w,
  }));

  // 合并：到期的在前，新词在后
  const queue = [
    ...dueReviews.map((r) => ({
      reviewId: r.id,
      word: r.word,
      state: {
        easeFactor: r.easeFactor,
        interval: r.interval,
        repetitions: r.repetitions,
        nextReviewDate: r.nextReviewDate,
        lastReviewedAt: r.lastReviewedAt,
      },
    })),
    ...newReviews.map((r) => ({
      reviewId: null,
      word: r.word,
      state: {
        easeFactor: r.easeFactor,
        interval: r.interval,
        repetitions: r.repetitions,
        nextReviewDate: r.nextReviewDate,
        lastReviewedAt: r.lastReviewedAt,
      },
    })),
  ];

  return NextResponse.json({ queue });
}

/** POST /api/study — 提交一次滑动结果 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const body = await req.json();
  const { wordId, gesture, reviewId } = body as {
    wordId: string;
    gesture: "left" | "right";
    reviewId: string | null;
  };

  const quality = gestureToQuality(gesture);

  const existing = reviewId
    ? await prisma.review.findUnique({ where: { id: reviewId } })
    : null;

  const prevState = existing
    ? {
        easeFactor: existing.easeFactor,
        interval: existing.interval,
        repetitions: existing.repetitions,
        nextReviewDate: existing.nextReviewDate,
        lastReviewedAt: existing.lastReviewedAt,
      }
    : createInitialState();

  const nextState = updateSM2(prevState, quality);

  if (existing) {
    await prisma.review.update({
      where: { id: reviewId! },
      data: {
        ...nextState,
        totalReviews: { increment: 1 },
      },
    });
  } else {
    await prisma.review.create({
      data: {
        userId,
        wordId,
        ...nextState,
        totalReviews: 1,
      },
    });
  }

  return NextResponse.json({ ok: true, nextState });
}
