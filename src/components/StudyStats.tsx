"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";

interface StudyStats {
  totalWords: number;
  reviewedCount: number;
  todayNew: number;
  todayReviewed: number;
  learnedCount: number;
  learnedRate: number;
  masteredCount: number;
  mastery: number;
}

/**
 * 学习统计卡片（首页已登录学生展示）。
 *
 * 数据来自 GET /api/study/stats：
 *   - 今日新学 / 今日复习
 *   - 已学词数 / 已学占比（进度条）
 * 供学生快速了解当天学习与整体进度，点击进入「今日学习」。
 */
export default function StudyStats() {
  const { tc } = useLocale();
  const [data, setData] = useState<StudyStats | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      try {
        const res = await fetch("/api/study/stats");
        if (cancelled) return;
        if (res.status === 401) return; // 未登录：静默不展示
        if (!res.ok) {
          const msg = await responseErrorMessage(res);
          throw new Error(msg);
        }
        const d = await res.json();
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 加载中 / 未登录 → 不渲染，避免首页出现空白块
  if (!data && !error) return null;

  // 拉取失败 → 渲染一个带重试按钮的轻量卡片
  if (!data) {
    return (
      <div className="mb-4 w-full rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center dark:border-[var(--border)] dark:bg-[var(--surface)]">
        <p className="mb-2 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("学习统计加载失败")}
        </p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-[13px] font-medium text-[var(--primary)] underline dark:text-[var(--primary)]"
        >
          {tc("重试")}
        </button>
      </div>
    );
  }

  // 进度条用「已学」口径（repetitions >= 1），答对一次即增长，能即时反映努力；
  // 长期记忆口径（interval >= 22 天）门槛太高，新学生会数周看到 0%，不適合做进度条。
  const pct = Math.min(100, Math.max(0, data.learnedRate));

  return (
    <Link
      href="/study"
      className="mb-4 block w-full overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-5 text-left shadow-[var(--shadow-sm)] transition hover:border-[var(--primary)]/25 active:scale-[0.99] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:shadow-[var(--shadow-sm)]"
    >
      {/* 标题行 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[14px] font-semibold text-[var(--text)] dark:text-[var(--text)]">
          📊 {tc("今日学习")}
        </span>
        <span className="text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("点击开始")} →
        </span>
      </div>

      {/* 今日新学 / 今日复习 */}
      <div className="mb-4 flex gap-3">
        <div className="flex-1 rounded-2xl bg-[var(--border-soft)] px-4 py-3 dark:bg-[var(--border-soft)]">
          <div className="text-[22px] font-bold tabular-nums text-[var(--primary)] dark:text-[var(--primary)]">
            {data.todayNew}
          </div>
          <div className="text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("今日新学")}
          </div>
        </div>
        <div className="flex-1 rounded-2xl bg-[var(--success-bg)] px-4 py-3 dark:bg-[var(--success-bg)]">
          <div className="text-[22px] font-bold tabular-nums text-[var(--success)] dark:text-[var(--success)]">
            {data.todayReviewed}
          </div>
          <div className="text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("今日复习")}
          </div>
        </div>
      </div>

      {/* 已学进度（认字口径）*/}
      <div className="mb-1.5 flex items-center justify-between text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
        <span>
          {tc("已学")} {data.learnedCount} / {data.totalWords}
        </span>
        <span className="font-semibold tabular-nums text-[var(--primary)] dark:text-[var(--primary)]">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)] dark:bg-[var(--border)]">
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Link>
  );
}
