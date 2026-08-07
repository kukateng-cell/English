/**
 * 「掌握」判定 —— 排行榜「掌握词数」与教师端「已掌握词汇」共用的唯一口径。
 *
 * 语义：SM-2 间隔达到阈值（默认 22 天，等价原 interval > 21）才算真正
 * 「掌握」（记得牢、间隔久）。
 *
 * 与单元解锁的「认字」明确区分（见 units.ts 的 MASTERED_REPETITIONS）：
 *   - 认字（repetitions >= 1）：答对一次即算，门槛低，用于单元闯关解锁（认字率 80%）；
 *   - 掌握（本模块，interval >= MASTERED_MIN_INTERVAL）：间隔够久才算，门槛高，
 *     用于排行榜 / 教师端统计真实掌握量。
 *
 * 排行榜与教师端共用本模块，保证「掌握词数 / 已掌握词汇 / 平均进度」在任何时刻一致，
 * 避免两端数字对不上的问题。
 */

/** 判定「掌握」所需的最小 SM-2 间隔（天）。 */
export const MASTERED_MIN_INTERVAL = 22;

/** 某条 Review 是否算「已掌握」：SM-2 interval >= MASTERED_MIN_INTERVAL。 */
export function isMasteredByInterval(interval: number): boolean {
  return interval >= MASTERED_MIN_INTERVAL;
}
