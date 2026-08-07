"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import type { AchievementStatus } from "@/lib/achievements";

/** 成就徽章卡片：解锁=彩色，未解锁=灰色（显示进度）。 */
export function AchievementCard({ a }: { a: AchievementStatus }) {
  const { tc } = useLocale();
  const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border p-4 text-center transition ${
        a.unlocked
          ? "border-transparent bg-gradient-to-br from-[#FF7A45] to-[#FFB020] text-white shadow-[0_8px_20px_rgba(255,122,69,0.25)]"
          : "border-[#E7EDF8] bg-white dark:border-[#1E293B] dark:bg-[#0F172A]"
      }`}
    >
      <div className={`mb-2 text-[28px] leading-none ${a.unlocked ? "" : "opacity-40 grayscale"}`}>
        {a.icon}
      </div>
      <div className={`mb-1 text-[14px] font-bold ${a.unlocked ? "text-white" : "text-[#17213C] dark:text-[#E2E8F0]"}`}>
        {tc(a.title)}
      </div>
      <div className={`mb-3 text-[11px] leading-snug ${a.unlocked ? "text-white/90" : "text-[#7C89A5] dark:text-[#64748B]"}`}>
        {tc(a.description)}
      </div>
      {a.unlocked ? (
        <div className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">
          ✓ {tc("已达成")}
        </div>
      ) : (
        <div className="w-full">
          <div className="mb-1 text-[11px] tabular-nums text-[#94A3B8] dark:text-[#64748B]">
            {Math.min(a.progress, a.target)} / {a.target}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#E7EDF8] dark:bg-[#1E293B]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
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
        <div className="mb-3 text-4xl">🔒</div>
        <p className="mb-4 text-[15px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("请先登录后查看成就")}
        </p>
        <Link
          href="/login"
          className="flex h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-8 text-[15px] font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.18)] active:scale-[0.98]"
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
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
          className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB] transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:text-[#60A5FA] dark:hover:bg-[#1E40AF]/30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        {/* 标题 + 总进度 */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-[36px] leading-none">🏆</div>
          <h1 className="mb-1 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
            {tc("我的成就")}
          </h1>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">
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
