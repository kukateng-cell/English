"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import type {
  LeaderboardData,
  LeaderboardList,
  LeaderboardType,
} from "@/lib/leaderboard";

export default function LeaderboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const { tc } = useLocale();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [active, setActive] = useState<LeaderboardType>("streak");
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      // 重新加载时先清掉上次的错误态（IIFE 内调用，符合 set-state-in-effect 规则）。
      setError(false);
      try {
        const res = await fetch("/api/leaderboard");
        const d = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (d) setData(d);
        else setError(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, router, reloadKey]);

  if (status === "unauthenticated") return null;

  // 加载失败：显示错误 + 重试，避免一直转圈。
  if ((status === "loading" || !data) && error) {
    return (
      <div className="flex min-h-full items-center justify-center px-6">
        <ErrorBanner
          message="加载失败，请检查网络后重试"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  if (status === "loading" || !data) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }

  const list: LeaderboardList =
    data.lists.find((l) => l.type === active) ?? data.lists[0];
  // 前三名奖牌
  const medal = (rank: number) =>
    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <div className="flex min-h-full flex-col px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* 返回首页 */}
        <Link
          href="/"
          aria-label={tc("返回")}
          className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB] transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:text-[#60A5FA] dark:hover:bg-[#1E40AF]/30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="mb-5 text-center">
          <div className="mb-2 text-[36px] leading-none">🏆</div>
          <h1 className="mb-1 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
            {tc("学习排行榜")}
          </h1>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">
            {tc("和同学一起保持学习动力")}
          </p>
        </div>

        {/* Tab 切换 */}
        <div className="mb-4 flex gap-1 rounded-full bg-[#EEF4FF] p-1 dark:bg-[#1E3A5F]/40">
          {data.lists.map((l) => (
            <button
              key={l.type}
              onClick={() => setActive(l.type)}
              className={`flex-1 rounded-full px-3 py-2 text-[13px] font-medium transition ${
                active === l.type
                  ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow"
                  : "text-[#7C89A5] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:text-[#60A5FA]"
              }`}
            >
              {tc(l.label)}
            </button>
          ))}
        </div>

        {/* 榜单 */}
        <div className="overflow-hidden rounded-3xl border border-[#E7EDF8] bg-white dark:border-[#1E293B] dark:bg-[#0F172A]">
          {list.entries.map((e, i) => (
            <div
              key={e.userId}
              className={`flex items-center gap-3 px-4 py-3 ${
                e.isMe
                  ? "bg-[#FFF7E6] dark:bg-[#2A1E00]"
                  : i !== list.entries.length - 1
                    ? "border-b border-[#F1F5F9] dark:border-[#1E293B]"
                    : ""
              }`}
            >
              <div className="w-8 text-center text-[15px] font-bold tabular-nums text-[#17213C] dark:text-[#E2E8F0]">
                {medal(e.rank) ?? e.rank}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[14px] font-medium ${
                    e.isMe
                      ? "text-[#F59E0B] dark:text-[#FBBF24]"
                      : "text-[#17213C] dark:text-[#E2E8F0]"
                  }`}
                >
                  {e.name}
                  {e.isMe && (
                    <span className="ml-1.5 rounded-full bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#F59E0B] dark:text-[#FBBF24]">
                      {tc("我")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[14px] font-semibold tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
                <span>{list.icon}</span>
                <span>{e.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
