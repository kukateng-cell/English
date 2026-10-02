"use client";

import { useLocale } from "@/components/LocaleProvider";
import RewardIcon from "@/components/ui/RewardIcon";
import type { StreakInfo } from "@/lib/streak";

/**
 * 连续学习天数徽章（N 天）。
 *
 * 状态样式：
 * - 今天已打卡：indigo 实心高亮；
 * - 今天未打卡但昨天有连续（count > 0）：淡 indigo 提示；
 * - 无连续（count = 0）：灰色。
 */
export default function StreakBadge({ streak }: { streak: StreakInfo }) {
  const { tc } = useLocale();
  const { count, studiedToday } = streak;

  const styles =
    studiedToday
      ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
      : count > 0
        ? "bg-[var(--border-soft)] text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]"
        : "bg-[var(--border-soft)] text-[var(--muted)] dark:bg-[var(--border)] dark:text-[var(--muted)]";

  return (
    <div
      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${styles}`}
      title={tc("連續學習天數")}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center"><RewardIcon name="flame" size={17} /></span>
      <span>{count}</span>
      <span className="font-normal opacity-90">{tc("天")}</span>
    </div>
  );
}
