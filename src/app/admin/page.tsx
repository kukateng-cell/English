"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon, { type IconName } from "@/components/ui/Icon";
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
  const { tc } = useLocale();

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/stats");
        if (!res.ok) {
          setError(await responseErrorMessage(res, tc));
          return;
        }
        setStats(await res.json());
      } catch (e) {
        setError(tc(networkErrorMessage(e)));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey, tc]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
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
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)] dark:text-[var(--text)]">
          {tc("系统概览")}
        </h1>
        <p className="mt-1 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("全局数据一览")}
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label={tc("总用户数")}
          value={stats?.totalUsers ?? 0}
          icon={<Icon name="users" size={20} />}
          color="blue"
        />
        <StatCard
          label={tc("总单词数")}
          value={stats?.totalWords ?? 0}
          icon={<Icon name="book" size={20} />}
          color="indigo"
        />
        <StatCard
          label={tc("总复习次数")}
          value={stats?.totalReviews ?? 0}
          icon={<Icon name="refresh" size={20} />}
          color="green"
        />
        <StatCard
          label={tc("今日学习")}
          value={stats?.reviewsToday ?? 0}
          subtitle={tc("次")}
          icon={<Icon name="clock" size={20} />}
          color="amber"
        />
      </div>

      {/* 用户角色分布 */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm dark:border-[var(--border)] dark:bg-[var(--surface)]">
        <h3 className="mb-4 text-[15px] font-semibold text-[var(--text)] dark:text-[var(--text)]">
          {tc("用户角色分布")}
        </h3>
        <div className="admin-role-metrics">
          <RoleMetric label={tc("学生")} count={stats?.totalStudents ?? 0} total={stats?.totalUsers ?? 0} icon="users" tone="primary" />
          <RoleMetric label={tc("老师")} count={stats?.totalTeachers ?? 0} total={stats?.totalUsers ?? 0} icon="user" tone="secondary" />
          <RoleMetric label={tc("管理员")} count={stats?.totalAdmins ?? 0} total={stats?.totalUsers ?? 0} icon="shield" tone="warning" />
        </div>
      </div>

      {/* 单词等级分布 */}
      {stats?.wordsByLevel && stats.wordsByLevel.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm dark:border-[var(--border)] dark:bg-[var(--surface)]">
          <h3 className="mb-4 text-[15px] font-semibold text-[var(--text)] dark:text-[var(--text)]">
            {tc("单词等级分布")}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.wordsByLevel.map((l) => (
              <div key={l.level} className="rounded-xl bg-[var(--border-soft)] px-4 py-3 text-center dark:bg-[var(--border-soft)]">
                <p className="text-[20px] font-bold text-[var(--primary)] dark:text-[var(--primary)]">{l.count}</p>
                <p className="mt-0.5 text-[12px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">{l.level}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷入口 */}
      <div className="flex gap-3">
        <Link
          href="/admin/users"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-3.5 text-[14px] font-medium text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.98] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--primary)] dark:hover:bg-[var(--border-soft)]"
        >
          <Icon name="users" size={18} /> {tc("管理用户")}
        </Link>
        <Link
          href="/admin/words"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-3.5 text-[14px] font-medium text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.98] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--primary)] dark:hover:bg-[var(--border-soft)]"
        >
          <Icon name="book" size={18} /> {tc("单词库")}
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
    blue: { bg: "bg-[var(--border-soft)]", text: "text-[var(--primary)]", darkBg: "dark:bg-[var(--border-soft)]", darkText: "dark:text-[var(--primary)]" },
    indigo: { bg: "bg-[var(--border-soft)]", text: "text-[var(--primary-2)]", darkBg: "dark:bg-[var(--border-soft)]", darkText: "dark:text-[var(--primary-2)]" },
    green: { bg: "bg-[var(--success-bg)]", text: "text-[var(--success)]", darkBg: "dark:bg-[var(--success-bg)]", darkText: "dark:text-[var(--success)]" },
    amber: { bg: "bg-[var(--warning-bg)]", text: "text-[var(--warning)]", darkBg: "dark:bg-[var(--warning-bg)]", darkText: "dark:text-[var(--warning)]" },
  };
  const c = colorMap[color];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm dark:border-[var(--border)] dark:bg-[var(--surface)]">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${c.bg} ${c.text} ${c.darkBg} ${c.darkText}`}>
        {icon}
      </div>
      <p className="text-[26px] font-bold tracking-[-0.02em] text-[var(--text)] dark:text-[var(--text)]">
        {value}
        {subtitle && <span className="ml-1 text-[14px] font-normal text-[var(--muted)]">{subtitle}</span>}
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">{label}</p>
    </div>
  );
}

function RoleMetric({
  label,
  count,
  total,
  icon,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  icon: IconName;
  tone: "primary" | "secondary" | "warning";
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  const pctLabel = count > 0 && percentage < 1 ? "<1%" : `${Math.round(percentage)}%`;
  return (
    <div className="admin-role-metric">
      <span className={`admin-role-metric-icon is-${tone}`}><Icon name={icon} size={18} /></span>
      <div className="admin-role-metric-copy">
        <span>{label}</span>
        <strong>{count}</strong>
      </div>
      <small>{pctLabel}</small>
    </div>
  );
}
