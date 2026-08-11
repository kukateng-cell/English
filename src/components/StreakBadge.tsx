"use client";

import { useLocale } from "@/components/LocaleProvider";
import type { StreakInfo } from "@/lib/streak";

/**
 * 连续学习天数徽章（🔥 N 天）。
 *
 * 状态样式：
 * - 今天已打卡：火焰实心高亮（橙黄渐变）；
 * - 今天未打卡但昨天有连续（count > 0）：浅黄提示「还没断，今天学可 +1」；
 * - 无连续（count = 0）：灰色。
 */
export default function StreakBadge({ streak }: { streak: StreakInfo }) {
  const { tc } = useLocale();
  const { count, studiedToday } = streak;

  const styles =
    studiedToday
      ? "bg-[var(--warning)] text-[var(--color-surface)] shadow-sm"
      : count > 0
        ? "bg-[var(--warning-bg)] text-[var(--warning)] dark:bg-[var(--warning-bg)] dark:text-[var(--warning)]"
        : "bg-[var(--border-soft)] text-[var(--muted)] dark:bg-[var(--border)] dark:text-[var(--muted)]";

  return (
    <div
      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${styles}`}
      title={tc("连续学习天数")}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 23c-4.97 0-9-3.58-9-8 0-3.31 2.02-5.73 3.5-7.5C7.5 6 8.5 4.5 8.5 3c1.5 2 2.5 3.5 2.5 5 0-.5 1-4 1-6 .5 2 1 4.5 1 6 .5-1 1-2 1.5-2.5C16 7 17 9 17 11c0 4-2 5-2 5 3.5-.5 6-3 6-7 0-1.5-.5-3-1-4 .5 1.5 1 3.5 1 5 0 5.42-4.03 9-9 9z" />
      </svg>
      <span>{count}</span>
      <span className="font-normal opacity-90">{tc("天")}</span>
    </div>
  );
}
