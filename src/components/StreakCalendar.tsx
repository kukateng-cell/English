"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import type { StreakInfo } from "@/lib/streak";

/**
 * 打卡日历（当月视图）。
 *
 * 从 GET /api/streak 拉取连续天数 + 最近 60 天打卡日期，
 * 以月历形式展示：已打卡的日期 indigo 高亮，今天描边提示。
 * 用于学习完成画面，激励学生保持连续学习。
 */

const TIME_ZONE = "Asia/Shanghai";
const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

interface CalendarCell {
  key: string; // YYYY-MM-DD（null = 前导空白格）
  day: number | null;
  isToday: boolean;
}

/** 取某 Date 在 Asia/Shanghai 时区下的 年/月/日。 */
function localYMD(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: +get("year"), m: +get("month"), day: +get("day") };
}

function keyOf(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 生成当月日历格子（周日开头，首日前的空白格为 null）。 */
function buildMonthGrid(now: Date): {
  cells: CalendarCell[];
  monthLabel: string;
  studiedThisMonth: number;
} {
  const { y, m, day: today } = localYMD(now);
  // 用 UTC 构造纯日历日期，避免本地时区干扰
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=周日
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: "", day: null, isToday: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: keyOf(y, m, d), day: d, isToday: d === today });
  }
  return { cells, monthLabel: `${y}年${m}月`, studiedThisMonth: 0 };
}

export interface StreakData {
  streak: StreakInfo;
  days: string[];
}

export default function StreakCalendar({
  previewData,
}: {
  /** 预览模式：直接使用传入数据（离线演示用），不发起请求。 */
  previewData?: StreakData;
}) {
  const { tc } = useLocale();
  const [data, setData] = useState<StreakData | null>(null);

  // 挂载时拉取打卡数据（独立 API，不影响 /api/study 的主流程）
  useEffect(() => {
    if (previewData) return;
    let cancelled = false;
    fetch("/api/streak")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewData]);

  const effective = previewData ?? data;

  const daysSet = useMemo(() => new Set(effective?.days ?? []), [effective]);
  const grid = useMemo(() => {
    const g = buildMonthGrid(new Date());
    g.studiedThisMonth = g.cells.filter(
      (c) => c.day !== null && daysSet.has(c.key),
    ).length;
    return g;
  }, [daysSet]);

  const streak = effective?.streak;
  if (!streak) return null; // 未加载完成 / 无数据时先不渲染

  return (
    <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left dark:border-[var(--border)] dark:bg-[var(--surface)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-bold text-[var(--text)] dark:text-[var(--text)]">
          {tc("连续学习")}
        </span>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="flex items-center gap-1 font-semibold text-[var(--primary)]">
            <Icon name="flame" size={15} /> {streak.count} {tc("天")}
          </span>
          <span className="text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("本月")} {grid.studiedThisMonth} {tc("天")}
          </span>
        </div>
      </div>

      <div className="mb-2 text-center text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
        {grid.monthLabel}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEK_LABELS.map((w) => (
          <div
            key={w}
            className="text-center text-[11px] font-medium text-[var(--muted)] dark:text-[var(--muted)]"
          >
            {w}
          </div>
        ))}
        {grid.cells.map((c, i) =>
          c.day === null ? (
            <div key={`blank-${i}`} />
          ) : (
            <div
              key={c.key}
              className={[
                "flex aspect-square items-center justify-center rounded-xl text-[13px] tabular-nums",
                daysSet.has(c.key)
                  ? "bg-[var(--primary)] font-semibold text-[var(--color-surface)] shadow-sm"
                  : c.isToday
                    ? "bg-[var(--border-soft)] font-bold text-[var(--primary)] ring-2 ring-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)] dark:ring-[var(--primary)]"
                    : "bg-[var(--border-soft)] text-[var(--muted)] dark:bg-[var(--border)] dark:text-[var(--muted)]",
              ].join(" ")}
              title={c.key}
            >
              {daysSet.has(c.key) ? "✓" : c.day}
            </div>
          ),
        )}
      </div>

      {!streak.studiedToday && streak.count > 0 && (
        <p className="mt-3 flex items-center justify-center gap-1 text-center text-[12px] text-[var(--primary)]">
          {tc("今天还没打卡，学一个词就能续上")} <Icon name="flame" size={14} />
        </p>
      )}
    </div>
  );
}
