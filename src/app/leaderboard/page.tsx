"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";
import LeaderboardView from "@/components/LeaderboardView";
import type { LeaderboardData } from "@/lib/leaderboard";

export default function LeaderboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const { tc } = useLocale();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
        else if (!cancelled) setError(true);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  if (status === "loading" || !data) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  return (
    <div className="flex min-h-full flex-col px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mb-2 text-[36px] leading-none">🏆</div>
          <h1 className="mb-1 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
            {tc("学习排行榜")}
          </h1>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">
            {tc("和同学一起保持学习动力")}
          </p>
        </div>

        {error && (
          <p className="mb-4 text-center text-[13px] text-[#EF6B6B]">
            {tc("加载失败，请刷新重试")}
          </p>
        )}

        <LeaderboardView data={data} />
      </div>
    </div>
  );
}
