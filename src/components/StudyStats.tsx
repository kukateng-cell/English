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
  masteredCount: number;
  mastery: number;
}

/**
 * 学习统计卡片（首页已登录学生展示）。
 *
 * 数据来自 GET /api/study/stats：
 *   - 今日新学 / 今日复习
 *   - 已掌握词数 / 总体掌握度（进度条）
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
      <div className="mb-4 w-full rounded-[22px] border border-[#E7EDF8] bg-white p-5 text-center dark:border-[#1E293B] dark:bg-[#111827]">
        <p className="mb-2 text-[13px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("学习统计加载失败")}
        </p>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-[13px] font-medium text-[#2563EB] underline dark:text-[#60A5FA]"
        >
          {tc("重试")}
        </button>
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, data.mastery));

  return (
    <Link
      href="/study"
      className="mb-4 block w-full overflow-hidden rounded-[22px] border border-[#E7EDF8] bg-white p-5 text-left shadow-[0_4px_16px_rgba(38,65,140,0.04)] transition hover:border-[#2563EB]/25 active:scale-[0.99] dark:border-[#1E293B] dark:bg-[#111827] dark:shadow-none"
    >
      {/* 标题行 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[14px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
          📊 {tc("今日学习")}
        </span>
        <span className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("点击开始")} →
        </span>
      </div>

      {/* 今日新学 / 今日复习 */}
      <div className="mb-4 flex gap-3">
        <div className="flex-1 rounded-2xl bg-[#EEF4FF] px-4 py-3 dark:bg-[#1E3A5F]">
          <div className="text-[22px] font-bold tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
            {data.todayNew}
          </div>
          <div className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">
            {tc("今日新学")}
          </div>
        </div>
        <div className="flex-1 rounded-2xl bg-[#F0FDF4] px-4 py-3 dark:bg-[#052E16]">
          <div className="text-[22px] font-bold tabular-nums text-[#22C55E] dark:text-[#4ADE80]">
            {data.todayReviewed}
          </div>
          <div className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">
            {tc("今日复习")}
          </div>
        </div>
      </div>

      {/* 掌握度 */}
      <div className="mb-1.5 flex items-center justify-between text-[12px] text-[#7C89A5] dark:text-[#64748B]">
        <span>
          {tc("已掌握")} {data.masteredCount} / {data.totalWords}
        </span>
        <span className="font-semibold tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#E7EDF8] dark:bg-[#1E293B]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Link>
  );
}
