"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  const { status } = useSession();
  const router = useRouter();
  const { tc } = useLocale();
  const [list, setList] = useState<AchievementStatus[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/achievements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setList(d.achievements ?? []);
        else if (!cancelled) setError(true);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  if (status === "loading" || !list) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

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

        {error && (
          <p className="mb-4 text-center text-[13px] text-[#EF6B6B]">
            {tc("加载失败，请刷新重试")}
          </p>
        )}

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
