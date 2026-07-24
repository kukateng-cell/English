"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";

interface Stats {
  totalUsers: number;
  totalStudents: number;
  totalTeachers: number;
  totalAdmins: number;
  totalWords: number;
  totalReviews: number;
  reviewsToday: number;
  wordsByLevel: { level: string; count: number }[];
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/stats");
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
      {/* 页面标题 */}
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          系统概览
        </h1>
        <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          全局数据一览
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="总用户数"
          value={stats?.totalUsers ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          }
          color="blue"
        />
        <StatCard
          label="总单词数"
          value={stats?.totalWords ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
          }
          color="indigo"
        />
        <StatCard
          label="总复习次数"
          value={stats?.totalReviews ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
          }
          color="green"
        />
        <StatCard
          label="今日学习"
          value={stats?.reviewsToday ?? 0}
          subtitle="次"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          }
          color="amber"
        />
      </div>

      {/* 用户角色分布 */}
      <div className="rounded-2xl border border-[#E7EDF8] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
        <h3 className="mb-4 text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
          用户角色分布
        </h3>
        <div className="space-y-3">
          <RoleBar label="学生" count={stats?.totalStudents ?? 0} total={stats?.totalUsers ?? 1} color="bg-[#2563EB]" />
          <RoleBar label="老师" count={stats?.totalTeachers ?? 0} total={stats?.totalUsers ?? 1} color="bg-[#5B6FEF]" />
          <RoleBar label="管理员" count={stats?.totalAdmins ?? 0} total={stats?.totalUsers ?? 1} color="bg-[#4F46E5]" />
        </div>
      </div>

      {/* 单词等级分布 */}
      {stats?.wordsByLevel && stats.wordsByLevel.length > 0 && (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-5 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
          <h3 className="mb-4 text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
            单词等级分布
          </h3>
          <div className="flex gap-3">
            {stats.wordsByLevel.map((l) => (
              <div key={l.level} className="flex-1 rounded-xl bg-[#EEF4FF] px-4 py-3 text-center dark:bg-[#1E3A5F]">
                <p className="text-[20px] font-bold text-[#2563EB] dark:text-[#60A5FA]">{l.count}</p>
                <p className="mt-0.5 text-[12px] font-medium text-[#7C89A5] dark:text-[#64748B]">{l.level}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷入口 */}
      <div className="flex gap-3">
        <Link
          href="/admin/users"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#E7EDF8] bg-white py-3.5 text-[14px] font-medium text-[#2563EB] transition hover:bg-[#F8FAFF] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#60A5FA] dark:hover:bg-[#1A2332]"
        >
          👥 管理用户
        </Link>
        <Link
          href="/admin/words"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#E7EDF8] bg-white py-3.5 text-[14px] font-medium text-[#2563EB] transition hover:bg-[#F8FAFF] active:scale-[0.98] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#60A5FA] dark:hover:bg-[#1A2332]"
        >
          📚 单词库
        </Link>
      </div>
    </motion.div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  icon,
  color,
}: {
  label: string;
  value: number;
  subtitle?: string;
  icon: React.ReactNode;
  color: "blue" | "indigo" | "green" | "amber";
}) {
  const colorMap = {
    blue: { bg: "bg-[#EEF4FF]", text: "text-[#2563EB]", darkBg: "dark:bg-[#1E3A5F]", darkText: "dark:text-[#60A5FA]" },
    indigo: { bg: "bg-[#EEF0FF]", text: "text-[#4F46E5]", darkBg: "dark:bg-[#1E1B4B]", darkText: "dark:text-[#A5B4FC]" },
    green: { bg: "bg-[#ECFDF5]", text: "text-[#15803D]", darkBg: "dark:bg-[#052E16]", darkText: "dark:text-[#4ADE80]" },
    amber: { bg: "bg-[#FFFBEB]", text: "text-[#B45309]", darkBg: "dark:bg-[#291800]", darkText: "dark:text-[#FBBF24]" },
  };
  const c = colorMap[color];

  return (
    <div className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm dark:border-[#1E293B] dark:bg-[#111827]">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${c.bg} ${c.text} ${c.darkBg} ${c.darkText}`}>
        {icon}
      </div>
      <p className="text-[26px] font-bold tracking-[-0.02em] text-[#17213C] dark:text-[#E2E8F0]">
        {value}
        {subtitle && <span className="ml-1 text-[14px] font-normal text-[#7C89A5]">{subtitle}</span>}
      </p>
      <p className="mt-0.5 text-[13px] text-[#7C89A5] dark:text-[#64748B]">{label}</p>
    </div>
  );
}

function RoleBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-[13px] text-[#7C89A5] dark:text-[#64748B]">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[#EEF2F9] dark:bg-[#1E293B] overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
      <span className="w-10 text-right text-[13px] font-medium text-[#17213C] dark:text-[#E2E8F0]">{count}</span>
    </div>
  );
}
