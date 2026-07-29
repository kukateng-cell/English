"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { useLocale } from "@/components/LocaleProvider";

interface TeacherStats {
  totalStudents: number;
  activeToday: number;
  totalWordsMastered: number;
  avgProgress: number;
  byLevel: { level: string; mastered: number; total: number }[];
  recentActivity: { name: string; email: string; level: string; progress: number }[];
}

export default function TeacherDashboard() {
  const { tc } = useLocale();
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/teacher/stats");
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        setStats(await res.json());
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
      {/* 标题 */}
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          {tc("班级概览")}
        </h1>
        <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          {tc("掌握学生的学习动态")}
        </p>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
          </div>
          <p className="text-[26px] font-bold text-[#17213C] dark:text-[#E2E8F0]">{stats?.totalStudents ?? 0}</p>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">{tc("学生总数")}</p>
        </div>
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#ECFDF5] text-[#15803D] dark:bg-[#052E16] dark:text-[#4ADE80]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          </div>
          <p className="text-[26px] font-bold text-[#17213C] dark:text-[#E2E8F0]">{stats?.activeToday ?? 0}</p>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">{tc("今日活跃")}</p>
        </div>
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF0FF] text-[#4F46E5] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
          </div>
          <p className="text-[26px] font-bold text-[#17213C] dark:text-[#E2E8F0]">{stats?.totalWordsMastered ?? 0}</p>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">{tc("已掌握词汇")}</p>
        </div>
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#B45309] dark:bg-[#291800] dark:text-[#FBBF24]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
          </div>
          <p className="text-[26px] font-bold text-[#17213C] dark:text-[#E2E8F0]">{stats?.avgProgress ?? 0}%</p>
          <p className="text-[13px] text-[#7C89A5] dark:text-[#64748B]">{tc("平均进度")}</p>
        </div>
      </div>

      {/* 各等级掌握情况 */}
      {stats?.byLevel && stats.byLevel.length > 0 && (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <h3 className="mb-4 text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
            {tc("各等级掌握情况")}
          </h3>
          <div className="space-y-3">
            {stats.byLevel.map((l) => {
              const pct = l.total > 0 ? Math.round((l.mastered / l.total) * 100) : 0;
              return (
                <div key={l.level} className="flex items-center gap-3">
                  <span className="w-10 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{l.level}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#EEF2F9] dark:bg-[#1E293B] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
                      style={{ width: `${pct}%` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <span className="text-[13px] font-medium text-[#17213C] dark:text-[#E2E8F0]">
                    {l.mastered}/{l.total}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 快捷入口 */}
      <Link
        href="/teacher/students"
        className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98]"
      >
        {tc("📋 查看学生详细进度 →")}
      </Link>

      {/* 最近活跃 */}
      {stats?.recentActivity && stats.recentActivity.length > 0 && (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <h3 className="mb-4 text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
            {tc("最近活跃学生")}
          </h3>
          <div className="space-y-2">
            {stats.recentActivity.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEF4FF] text-[12px] font-bold text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                    {s.name?.charAt(0) || s.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-[#17213C] dark:text-[#E2E8F0]">{s.name || s.email}</p>
                    <p className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">{tc(`${s.level} 级`)}</p>
                  </div>
                </div>
                <span className="text-[14px] font-semibold text-[#2563EB] dark:text-[#60A5FA]">{s.progress}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
