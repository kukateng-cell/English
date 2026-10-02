import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getStudentLearningMetrics } from "@/lib/student-metrics";

/**
 * GET /api/study/stats — 当前用户的「学习统计」概览（PLAN 核心功能 #7）。
 *
 * 返回：
 *   - totalWords     已解锁内容的词数
 *   - reviewedCount  累计复习过的词数（Review 记录数）
 *   - todayNew       今日新学词数（今天首次复习 totalReviews=1 的词）
 *   - todayReviewed  今日复习过的词数（lastReviewedAt 在今天）
 *   - learnedCount   已学词数（SM-2 repetitions >= 1，即至少答对过一次）
 *   - learnedRate    已学占比（learnedCount / totalWords，百分比）—— 首页已解锁内容口径
 *   - masteredCount  已掌握词数（SM-2 interval >= MASTERED_MIN_INTERVAL，仍只计已解锁内容）
 *   - mastery        已解锁内容掌握度（masteredCount / totalWords，百分比）
 *
 * 说明：
 *   - Review 无 createdAt 字段，用「lastReviewedAt 在今天 且 totalReviews=1」判定新学，
 *     与打卡 / 连续天数的东八区「今天」口径一致（todayStartUtc）。
 *   - 首页「已学」只在已解锁内容内用认字口径（repetitions >= 1），答对一次即增长，能即时反映学习努力；
 *     严格长期记忆口径（interval >= 22 天）仍保留在 masteredCount / mastery；排行榜／教师端查询不受此 projection 改动影响。
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const metrics = await getStudentLearningMetrics(auth.userId);

  return NextResponse.json({
    totalWords: metrics.library.unlocked.totalWords,
    reviewedCount: metrics.reviewedCount,
    todayNew: metrics.newWordCount,
    todayReviewed: metrics.reviewedWordCount,
    learnedCount: metrics.library.unlocked.learnedCount,
    learnedRate: metrics.library.unlocked.learnedRate,
    masteredCount: metrics.library.unlocked.masteredCount,
    mastery: metrics.library.unlocked.mastery,
    scope: "unlocked",
    libraryByLevel: metrics.library.byLevel,
    objectiveRecognitionCount: metrics.objectiveRecognitionCount,
    selfRatedEncounterCount: metrics.selfRatedEncounterCount,
    legacyUnknownEventCount: metrics.legacyUnknownEventCount,
  });
}
