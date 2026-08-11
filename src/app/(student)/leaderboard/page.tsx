"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import type {
  LeaderboardData,
  LeaderboardList,
  LeaderboardType,
} from "@/lib/leaderboard";

export default function LeaderboardPage() {
  const { tc } = useLocale();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [active, setActive] = useState<LeaderboardType>("streak");
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 不再依赖 useSession() 的状态判断登录：它的 "unauthenticated" 在客户端
  // 导航时可能读到过期缓存（见登录页 update() 说明），会把已登录用户误弹回
  // 登录页。改为直接拉取受保护的 API——cookie 自动随请求带上，401（未登录 /
  // 未绑定）才提示登录，已登录即可正常显示。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 重新加载时先清掉上次的错误态（IIFE 内调用，符合 set-state-in-effect 规则）。
      setError(false);
      setNeedLogin(false);
      try {
        const res = await fetch("/api/leaderboard");
        if (res.status === 401) {
          if (!cancelled) setNeedLogin(true);
          return;
        }
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
  }, [reloadKey]);

  // 未登录（未绑定）：显示登录提示，而非强制重定向到登录页造成来回跳转。
  if (needLogin) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 text-4xl">🔒</div>
        <p className="mb-4 text-[15px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("请先登录后查看排行榜")}
        </p>
        <Link
          href="/login"
          className="flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-8 text-[15px] font-semibold text-[var(--color-surface)] shadow-card active:scale-[0.98]"
        >
          {tc("前往登录")}
        </Link>
      </div>
    );
  }

  // 加载失败：显示错误 + 重试，避免一直转圈。
  if (!data && error) {
    return (
      <div className="flex min-h-full items-center justify-center px-6">
        <ErrorBanner
          message="加载失败，请检查网络后重试"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
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
          className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--border-soft)] text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.95]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="mb-5 text-center">
          <div className="mb-2 text-[36px] leading-none">🏆</div>
          <h1 className="mb-1 text-xl font-bold text-[var(--text)] dark:text-[var(--text)]">
            {tc("学习排行榜")}
          </h1>
          <p className="text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("和同学一起保持学习动力")}
          </p>
        </div>

        {/* Tab 切换 */}
        <div className="mb-4 flex gap-1 rounded-full bg-[var(--border-soft)] p-1 dark:bg-[var(--border-soft)]/40">
          {data.lists.map((l) => (
            <button
              key={l.type}
              onClick={() => setActive(l.type)}
              className={`flex-1 rounded-full px-3 py-2 text-[13px] font-medium transition ${
                active === l.type
                  ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--primary)] dark:text-[var(--muted)] dark:hover:text-[var(--primary)]"
              }`}
            >
              {tc(l.label)}
            </button>
          ))}
        </div>

        {/* 榜单 */}
        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] dark:border-[var(--border)] dark:bg-[var(--surface)]">
          {list.entries.map((e, i) => (
            <div
              key={e.userId}
              className={`flex items-center gap-3 px-4 py-3 ${
                e.isMe
                  ? "bg-[var(--warning-bg)] dark:bg-[var(--warning-bg)]"
                  : i !== list.entries.length - 1
                    ? "border-b border-[var(--border-soft)] dark:border-[var(--border)]"
                    : ""
              }`}
            >
              <div className="w-8 text-center text-[15px] font-bold tabular-nums text-[var(--text)] dark:text-[var(--text)]">
                {medal(e.rank) ?? e.rank}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[14px] font-medium ${
                    e.isMe
                      ? "text-[var(--warning)] dark:text-[var(--warning)]"
                      : "text-[var(--text)] dark:text-[var(--text)]"
                  }`}
                >
                  {e.name}
                  {e.isMe && (
                    <span className="ml-1.5 rounded-full bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)] dark:text-[var(--warning)]">
                      {tc("我")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[14px] font-semibold tabular-nums text-[var(--primary)] dark:text-[var(--primary)]">
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
