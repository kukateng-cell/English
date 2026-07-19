/**
 * SM-2 间隔重复算法 — 严格按 Wozniak (1994) 论文实现
 * 参考：PLAN.md 第四章 4.1 节
 */

export interface ReviewState {
  easeFactor: number; // 难度系数，初始 2.5
  interval: number; // 当前间隔（天）
  repetitions: number; // 连续答对次数
  nextReviewDate: Date; // 下次到期日
  lastReviewedAt: Date | null;
}

/** quality 评级：0(全忘) → 5(完全掌握) */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** 手势映射到质量评级（按计划书） */
export function gestureToQuality(gesture: "left" | "right"): Quality {
  return gesture === "left" ? 2 : 5;
}

/** 创建初始状态 */
export function createInitialState(): ReviewState {
  return {
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReviewDate: new Date(), // 立即可学
    lastReviewedAt: null,
  };
}

/**
 * SM-2 核心更新函数
 * 严格按 Wozniak (1994) 公式：
 * - quality < 3 → 重置为 interval=1, repetitions=0
 * - quality >= 3 → 按 easFactor 推进 interval
 */
export function updateSM2(
  state: ReviewState,
  quality: Quality
): ReviewState {
  let { easeFactor, interval, repetitions } = state;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    easeFactor,
    interval,
    repetitions,
    nextReviewDate,
    lastReviewedAt: new Date(),
  };
}

/** 判断单词今日是否到期（需要复习） */
export function isDue(state: ReviewState): boolean {
  return new Date() >= state.nextReviewDate;
}
