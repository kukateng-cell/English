import { prisma, type Prisma } from "@/lib/prisma";
import { computeStreak, todayStartUtc } from "@/lib/streak";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { MASTERED_REPETITIONS } from "@/lib/units";
import { fetchUnitProgress } from "@/lib/unit-progress-server";
import { normalizeLevel } from "@/lib/units";

export type WordReviewSnapshot = {
  repetitions: number;
  interval: number;
  nextReviewDate: Date;
  lastReviewedAt: Date | null;
};

export type StudentWordStatus = "unseen" | "learning" | "due" | "mastered";

export function classifyStudentWord(
  review: WordReviewSnapshot | null,
  now = new Date(),
): { learned: boolean; mastered: boolean; status: StudentWordStatus } {
  if (!review) return { learned: false, mastered: false, status: "unseen" };
  const learned = review.repetitions >= MASTERED_REPETITIONS;
  const mastered = review.interval >= MASTERED_MIN_INTERVAL;
  if (mastered) return { learned, mastered, status: "mastered" };
  if (review.nextReviewDate <= now) return { learned, mastered, status: "due" };
  return { learned, mastered, status: "learning" };
}

export function capNextSession(dueBacklogCount: number, availableNewCount: number) {
  const dueCount = Math.min(20, Math.max(0, dueBacklogCount));
  const newCount = Math.min(5, Math.max(0, availableNewCount));
  return { dueCount, newCount, total: dueCount + newCount };
}

export function unlockedWordFilters(
  progress: Awaited<ReturnType<typeof fetchUnitProgress>>,
): Prisma.WordWhereInput[] {
  return progress.flatMap((level) =>
    level.units
      .filter((unit) => unit.unlocked)
      .map((unit) => ({
        level: normalizeLevel(level.level),
        category: unit.name === "未分类" ? null : unit.name,
      })),
  );
}

export async function getStudentVisibleWordFilters(userId: string) {
  return unlockedWordFilters(await fetchUnitProgress(userId));
}

export interface StudentDashboardResponse {
  nextSession: {
    dueBacklogCount: number;
    dueCount: number;
    availableNewCount: number;
    newCount: number;
    total: number;
  };
  today: {
    reviewedWordCount: number;
    newWordCount: number;
    reviewEventCount: number;
  };
  library: {
    totalWords: number;
    learnedCount: number;
    learnedRate: number;
    masteredCount: number;
    mastery: number;
  };
  streak: {
    count: number;
    studiedToday: boolean;
  };
}

export interface StudentLearningMetrics {
  totalWords: number;
  reviewedCount: number;
  reviewedWordCount: number;
  newWordCount: number;
  reviewEventCount: number;
  learnedCount: number;
  learnedRate: number;
  masteredCount: number;
  mastery: number;
}

/** Shared library/today aggregation used by the legacy stats API and the new
 * dashboard/insights responses so the labels cannot drift apart. */
export async function getStudentLearningMetrics(
  userId: string,
  now = new Date(),
): Promise<StudentLearningMetrics> {
  const todayStart = todayStartUtc(now);
  const [
    totalWords,
    reviewedCount,
    reviewedWordCount,
    newWordCount,
    reviewEventCount,
    learnedCount,
    masteredCount,
  ] = await Promise.all([
    prisma.word.count(),
    prisma.review.count({ where: { userId } }),
    prisma.review.count({ where: { userId, lastReviewedAt: { gte: todayStart } } }),
    prisma.review.count({ where: { userId, totalReviews: 1, lastReviewedAt: { gte: todayStart } } }),
    prisma.reviewEvent.count({ where: { userId, eventKind: "REVIEW", isHistorical: false, createdAt: { gte: todayStart } } }),
    prisma.review.count({ where: { userId, repetitions: { gte: MASTERED_REPETITIONS } } }),
    prisma.review.count({ where: { userId, interval: { gte: MASTERED_MIN_INTERVAL } } }),
  ]);
  return {
    totalWords,
    reviewedCount,
    reviewedWordCount,
    newWordCount,
    reviewEventCount,
    learnedCount,
    learnedRate: totalWords > 0 ? Math.round((learnedCount / totalWords) * 100) : 0,
    masteredCount,
    mastery: totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0,
  };
}

/**
 * Dashboard-only aggregation. It intentionally does not call GET /api/study
 * and never issues a study session or consumes a queue-rate token.
 */
export async function getStudentDashboard(
  userId: string,
  now = new Date(),
): Promise<StudentDashboardResponse> {
  const visibleFilters = await getStudentVisibleWordFilters(userId);
  const newWordWhere: Prisma.WordWhereInput = visibleFilters.length
    ? { reviews: { none: { userId } }, OR: visibleFilters }
    : { id: "__no_unlocked_words__" };

  const [metrics, dueBacklogCount, availableNewCount, streak] = await Promise.all([
    getStudentLearningMetrics(userId, now),
    prisma.review.count({ where: { userId, nextReviewDate: { lte: now } } }),
    prisma.word.count({ where: newWordWhere }),
    computeStreak(userId),
  ]);
  const capped = capNextSession(dueBacklogCount, availableNewCount);
  return {
    nextSession: {
      dueBacklogCount,
      dueCount: capped.dueCount,
      availableNewCount,
      newCount: capped.newCount,
      total: capped.total,
    },
    today: {
      reviewedWordCount: metrics.reviewedWordCount,
      newWordCount: metrics.newWordCount,
      reviewEventCount: metrics.reviewEventCount,
    },
    library: {
      totalWords: metrics.totalWords,
      learnedCount: metrics.learnedCount,
      learnedRate: metrics.learnedRate,
      masteredCount: metrics.masteredCount,
      mastery: metrics.mastery,
    },
    streak: { count: streak.count, studiedToday: streak.studiedToday },
  };
}
