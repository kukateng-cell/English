"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import LeaderboardView from "@/components/LeaderboardView";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { useLocale } from "@/components/LocaleProvider";
import type { LeaderboardData } from "@/lib/leaderboard";

/** 老师端·班级排行榜（复用 /api/leaderboard + LeaderboardView）。 */
export default function TeacherLeaderboardPage() {
  const { tc } = useLocale();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/leaderboard");
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        setData(await res.json());
      } catch (e) {
        setError(networkErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          {tc("班级排行榜")}
        </h1>
        <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("看谁最积极，激励学生保持学习")}
        </p>
      </div>
      {data && <LeaderboardView data={data} />}
    </motion.div>
  );
}
