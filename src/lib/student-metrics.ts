import { prisma, type Prisma } from "@/lib/prisma";
import { computeStreak, todayStartUtc } from "@/lib/streak";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { LEVELS, MASTERED_REPETITIONS, normalizeLevel, type LevelCode } from "@/lib/units";
import { fetchUnitProgress } from "@/lib/unit-progress-server";
import {
  currentCatalogReviewEventWhere,
  currentCatalogSenseWhere,
  eligibleOperationalObjectiveEventWhere,
  withCurrentCatalogWord,
} from "@/lib/catalog/runtime";

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
        AND: [
          withCurrentCatalogWord(),
          {
            level: normalizeLevel(level.level),
            category: unit.name === "未分类" ? null : unit.name,
          },
        ],
      })),
  );
}

export async function getStudentVisibleWordFilters(userId: string) {
  return unlockedWordFilters(await fetchUnitProgress(userId));
}

export interface LibraryProgress {
  totalWords: number;
  learnedCount: number;
  learnedRate: number;
  masteredCount: number;
  mastery: number;
}

export interface LibraryLevelProgress extends LibraryProgress {
  level: LevelCode;
  unlocked: boolean;
}

export function calculateLibraryProgress(
  totalWords: number,
  learnedCount: number,
  masteredCount: number,
): LibraryProgress {
  return {
    totalWords,
    learnedCount,
    learnedRate: totalWords > 0 ? Math.round((learnedCount / totalWords) * 100) : 0,
    masteredCount,
    mastery: totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0,
  };
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
    objectiveRecognitionCount: number;
    selfRatedEncounterCount: number;
    legacyUnknownEventCount: number;
  };
  library: {
    totalWords: number;
    learnedCount: number;
    learnedRate: number;
    masteredCount: number;
    mastery: number;
    scope: "unlocked";
  };
  libraryByLevel: LibraryLevelProgress[];
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
  objectiveRecognitionCount: number;
  selfRatedEncounterCount: number;
  legacyUnknownEventCount: number;
  learnedCount: number;
  learnedRate: number;
  masteredCount: number;
  mastery: number;
  library: {
    all: LibraryProgress;
    unlocked: LibraryProgress;
    byLevel: LibraryLevelProgress[];
  };
}

interface StudentLearningMetricsOptions {
  visibleFilters?: Prisma.WordWhereInput[];
}

/** Shared library/today aggregation used by the legacy stats API and the new
 * dashboard/insights responses so the labels cannot drift apart. */
export async function getStudentLearningMetrics(
  userId: string,
  now = new Date(),
  options: StudentLearningMetricsOptions = {},
): Promise<StudentLearningMetrics> {
  const visibleFilters = options.visibleFilters ?? await getStudentVisibleWordFilters(userId);
  const unlockedWordWhere: Prisma.WordWhereInput = visibleFilters.length
    ? { OR: visibleFilters }
    : { id: "__no_unlocked_words__" };
  const todayStart = todayStartUtc(now);
  const [
    totalWords,
    reviewedCount,
    reviewedWordCount,
    newWordCount,
    reviewEventCount,
    objectiveRecognitionCount,
    selfRatedEncounterCount,
    legacyUnknownEventCount,
    learnedCount,
    masteredCount,
    unlockedTotalWords,
    unlockedLearnedCount,
    unlockedMasteredCount,
    levelWordRows,
    levelReviewRows,
  ] = await Promise.all([
    prisma.word.count({ where: withCurrentCatalogWord() }),
    prisma.review.count({ where: { userId, word: withCurrentCatalogWord() } }),
    prisma.review.count({ where: { userId, lastReviewedAt: { gte: todayStart }, word: withCurrentCatalogWord() } }),
    prisma.review.count({ where: { userId, totalReviews: 1, lastReviewedAt: { gte: todayStart }, word: withCurrentCatalogWord() } }),
    prisma.reviewEvent.count({ where: { AND: [currentCatalogReviewEventWhere(), { userId, createdAt: { gte: todayStart } }] } }),
    prisma.reviewEvent.count({ where: { AND: [eligibleOperationalObjectiveEventWhere(), { userId, createdAt: { gte: todayStart } }] } }),
    prisma.studyEncounter.count({ where: { userId, senseId: { not: null }, sense: currentCatalogSenseWhere(), createdAt: { gte: todayStart } } }),
    prisma.reviewEvent.count({ where: { AND: [currentCatalogReviewEventWhere(), { userId, evidenceKind: "LEGACY_UNKNOWN", createdAt: { gte: todayStart } }] } }),
    prisma.review.count({ where: { userId, repetitions: { gte: MASTERED_REPETITIONS }, word: withCurrentCatalogWord() } }),
    prisma.review.count({ where: { userId, interval: { gte: MASTERED_MIN_INTERVAL }, word: withCurrentCatalogWord() } }),
    prisma.word.count({ where: unlockedWordWhere }),
    prisma.review.count({ where: { userId, repetitions: { gte: MASTERED_REPETITIONS }, word: unlockedWordWhere } }),
    prisma.review.count({ where: { userId, interval: { gte: MASTERED_MIN_INTERVAL }, word: unlockedWordWhere } }),
    prisma.word.findMany({ where: withCurrentCatalogWord(), select: { level: true } }),
    prisma.review.findMany({
      where: { userId, word: withCurrentCatalogWord() },
      select: { repetitions: true, interval: true, word: { select: { level: true } } },
    }),
  ]);

  const unlockedLevels = new Set(
    visibleFilters
      .map((filter) => filter.level)
      .filter((level) => typeof level === "string")
      .map((level) => normalizeLevel(level)),
  );
  const levelTotals = new Map<LevelCode, { totalWords: number; learnedCount: number; masteredCount: number }>(
    LEVELS.map((level) => [level, { totalWords: 0, learnedCount: 0, masteredCount: 0 }]),
  );
  for (const row of levelWordRows) {
    const stats = levelTotals.get(normalizeLevel(row.level));
    if (stats) stats.totalWords += 1;
  }
  for (const row of levelReviewRows) {
    const stats = levelTotals.get(normalizeLevel(row.word.level));
    if (!stats) continue;
    if (row.repetitions >= MASTERED_REPETITIONS) stats.learnedCount += 1;
    if (row.interval >= MASTERED_MIN_INTERVAL) stats.masteredCount += 1;
  }
  const libraryByLevel = LEVELS.map((level) => {
    const stats = levelTotals.get(level) ?? { totalWords: 0, learnedCount: 0, masteredCount: 0 };
    return {
      level,
      unlocked: unlockedLevels.has(level),
      ...calculateLibraryProgress(stats.totalWords, stats.learnedCount, stats.masteredCount),
    };
  });
  const library = {
    all: calculateLibraryProgress(totalWords, learnedCount, masteredCount),
    unlocked: calculateLibraryProgress(unlockedTotalWords, unlockedLearnedCount, unlockedMasteredCount),
    byLevel: libraryByLevel,
  };
  return {
    totalWords,
    reviewedCount,
    reviewedWordCount,
    newWordCount,
    reviewEventCount,
    objectiveRecognitionCount,
    selfRatedEncounterCount,
    legacyUnknownEventCount,
    learnedCount,
    learnedRate: library.all.learnedRate,
    masteredCount,
    mastery: library.all.mastery,
    library,
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
    getStudentLearningMetrics(userId, now, { visibleFilters }),
    prisma.review.count({ where: { userId, nextReviewDate: { lte: now }, word: withCurrentCatalogWord() } }),
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
      objectiveRecognitionCount: metrics.objectiveRecognitionCount,
      selfRatedEncounterCount: metrics.selfRatedEncounterCount,
      legacyUnknownEventCount: metrics.legacyUnknownEventCount,
    },
    library: {
      ...metrics.library.unlocked,
      scope: "unlocked",
    },
    libraryByLevel: metrics.library.byLevel,
    streak: { count: streak.count, studiedToday: streak.studiedToday },
  };
}
