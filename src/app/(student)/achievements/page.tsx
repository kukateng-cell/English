"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import RewardIcon from "@/components/ui/RewardIcon";
import type { AchievementStatus } from "@/lib/achievements";

/** 成就徽章卡片：解锁=彩色，未解锁=灰色（显示进度）。 */
export function AchievementCard({ a }: { a: AchievementStatus }) {
  const { tc } = useLocale();
  const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border p-4 text-center transition ${
        a.unlocked
          ? "border-transparent bg-[var(--primary)] text-[var(--color-surface)] shadow-card"
          : "border-[var(--border)] bg-[var(--surface)] dark:border-[var(--border)] dark:bg-[var(--surface)]"
      }`}
    >
      <div className={`student-reward-achievement-icon mb-2 flex h-12 w-12 items-center justify-center rounded-2xl ${a.unlocked ? "bg-[var(--surface)]/20 text-[var(--color-surface)]" : "bg-[var(--border-soft)] text-[var(--primary)] opacity-60"}`}>
        <RewardIcon name={a.icon} size={29} />
      </div>
      <div className={`mb-1 text-[14px] font-bold ${a.unlocked ? "text-[var(--color-surface)]" : "text-[var(--text)]"}`}>
        {tc(a.title)}
      </div>
      <div className={`mb-3 text-[11px] leading-snug ${a.unlocked ? "text-[var(--color-surface)]/90" : "text-[var(--muted)]"}`}>
        {tc(a.description)}
      </div>
      {a.unlocked ? (
        <div className="flex items-center gap-1 rounded-full bg-[var(--surface)]/20 px-2.5 py-0.5 text-[11px] font-semibold">
          <Icon name="check" size={13} /> {tc("已达成")}
        </div>
      ) : (
        <div className="w-full">
          <div className="mb-1 text-[11px] tabular-nums text-[var(--muted)]">
            {Math.min(a.progress, a.target)} / {a.target}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)] dark:bg-[var(--border)]">
            <div
            className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AchievementsPage() {
  const { tc } = useLocale();
  const [list, setList] = useState<AchievementStatus[] | null>(null);
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
        const res = await fetch("/api/achievements");
        if (res.status === 401) {
          if (!cancelled) setNeedLogin(true);
          return;
        }
        const d = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (d) setList(d.achievements ?? []);
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
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--border-soft)] text-[var(--primary)]">
          <Icon name="lock" size={24} />
        </div>
        <p className="mb-4 text-[15px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("请先登录后查看成就")}
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
  if (!list && error) {
    return (
      <div className="flex min-h-full items-center justify-center px-6">
        <ErrorBanner
          message="加载失败，请检查网络后重试"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
      </div>
    );
  }

  const unlockedCount = list.filter((a) => a.unlocked).length;

  return (
    <div className="flex min-h-full flex-col px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* 返回首页 */}
        <Link
          href="/"
          aria-label={tc("返回")}
          className="study-header-icon study-header-back mb-5"
        >
          <Icon name="chevron-left" size={26} />
        </Link>
        {/* 标题 + 总进度 */}
        <div className="mb-6 text-center">
          <div className="student-reward-hero-icon mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--border)] bg-[var(--border-soft)] text-[var(--primary)] shadow-[var(--shadow-sm)]">
            <RewardIcon name="star" size={38} />
          </div>
          <h1 className="mb-1 text-xl font-bold text-[var(--text)] dark:text-[var(--text)]">
            {tc("我的成就")}
          </h1>
          <p className="text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("已解锁")} {unlockedCount} / {list.length}
          </p>
        </div>

        {/* 成就网格 */}
        <div className="grid grid-cols-2 gap-3">
          {list.map((a) => (
            <AchievementCard key={a.key} a={a} />
          ))}
        </div>
      </div>
    </div>
  );
}
