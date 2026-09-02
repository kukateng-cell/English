"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import RewardIcon, { RankMedal } from "@/components/ui/RewardIcon";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type {
  LeaderboardData,
  LeaderboardList,
  LeaderboardScope,
  LeaderboardScopeOverview,
  LeaderboardType,
} from "@/lib/leaderboard";

const SCOPE_ORDER: LeaderboardScope[] = ["class", "grade", "school"];

const METRIC_META: Record<LeaderboardType, { label: string; unit: string }> = {
  streak: { label: "客觀認讀連續天數", unit: "日" },
  words: { label: "掌握詞數", unit: "詞" },
  studyDays: { label: "累計打卡", unit: "日" },
};

function scopeLabel(
  scope: LeaderboardScope,
  overview: LeaderboardScopeOverview,
  tc: (value: string) => string,
): string {
  if (scope === "class") {
    const className = overview.grade && overview.classCode
      ? `${tc(GRADE_LABELS[overview.grade])}${tc(CLASS_LABELS[overview.classCode])}${tc("班")}`
      : tc("本班");
    return className;
  }
  if (scope === "grade" && overview.grade) return `${tc(GRADE_LABELS[overview.grade])}${tc("年級")}`;
  return tc(scope === "school" ? "全校" : "全年級");
}

function scopeShortLabel(scope: LeaderboardScope, tc: (value: string) => string): string {
  if (scope === "class") return tc("本班");
  if (scope === "grade") return tc("全年級");
  return tc("全校");
}

function metricValue(
  summary: LeaderboardScopeOverview["metrics"][LeaderboardType],
  unit: string,
  tc: (value: string) => string,
): string {
  return summary.value === null ? tc("暫無") : `${summary.value}${tc(unit)}`;
}

export default function LeaderboardPage() {
  const { tc } = useLocale();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [activeMetric, setActiveMetric] = useState<LeaderboardType>("streak");
  const [requestedScope, setRequestedScope] = useState<LeaderboardScope | null>(null);
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 首次不帶 scope，由 server 按學生可用 context 選擇最窄範圍；之後切換
  // scope 才把 enum 傳回 API。client 永遠不傳 classId／grade／academicYearId。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      setNeedLogin(false);
      const query = requestedScope ? `?scope=${encodeURIComponent(requestedScope)}` : "";
      try {
        const res = await fetch(`/api/leaderboard${query}`);
        if (res.status === 401) {
          if (!cancelled) setNeedLogin(true);
          return;
        }
        if (!res.ok) {
          if (!cancelled && (res.status === 400 || res.status === 422)) setRequestedScope(null);
          if (!cancelled) setError(true);
          return;
        }
        const payload = await res.json() as LeaderboardData;
        if (cancelled) return;
        if (payload) setData(payload);
        else setError(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, requestedScope]);

  if (needLogin) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--border-soft)] text-[var(--primary)]">
          <Icon name="lock" size={24} />
        </div>
        <p className="mb-4 text-[15px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc("請先登入後查看排行榜")}
        </p>
        <Link
          href="/login"
          className="flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-8 text-[15px] font-semibold text-[var(--color-surface)] shadow-card active:scale-[0.98]"
        >
          {tc("前往登入")}
        </Link>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="flex min-h-full items-center justify-center px-6">
        <ErrorBanner
          message="載入失敗，請檢查網絡後重試"
          onRetry={() => setReloadKey((key) => key + 1)}
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

  const activeScope = data.scope;
  const activeOverview = data.overview[activeScope];
  const list: LeaderboardList =
    data.lists.find((item) => item.type === activeMetric) ?? data.lists[0];
  const scopeLoading = requestedScope !== null && requestedScope !== data.scope;
  const medalTone = (rank: number) =>
    rank === 1 ? "text-[var(--warning)]" : rank === 2 ? "text-[var(--muted)]" : "text-[var(--primary)]";

  const activeMetricSummary = activeOverview.metrics[activeMetric];

  return (
    <div data-testid="leaderboard-page" className="flex min-h-full flex-col px-0 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          href="/"
          aria-label={tc("返回")}
          className="study-header-icon study-header-back mb-5"
        >
          <Icon name="chevron-left" size={26} />
        </Link>

        <div className="mb-6 text-center lg:mb-8">
          <div className="student-reward-hero-icon mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--border)] bg-[var(--border-soft)] text-[var(--primary)] shadow-[var(--shadow-sm)]">
            <RewardIcon name="trophy" size={38} />
          </div>
          <h1 className="mb-1 text-xl font-bold text-[var(--text)] dark:text-[var(--text)] sm:text-2xl">
            {tc("學習排行榜")}
          </h1>
          <p className="text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("和同學一起保持學習動力")}
          </p>
        </div>

        {error && (
          <div role="alert" aria-live="assertive" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-bg)] px-4 py-3 text-[12px] text-[var(--danger)]">
            <span>{tc("排行榜範圍暫時無法載入，請重試")}</span>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="shrink-0 rounded-xl border border-[var(--danger)]/30 px-3 py-1.5 font-semibold">
              {tc("重試")}
            </button>
          </div>
        )}

        <section
          data-testid="leaderboard-overview"
          aria-labelledby="leaderboard-overview-title"
          className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] dark:border-[var(--border)] dark:bg-[var(--surface)] sm:mb-6 sm:p-5 lg:p-6"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id="leaderboard-overview-title" className="text-[16px] font-bold text-[var(--text)]">
                {tc("我的排行榜概覽")}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
                {data.context.academicYearLabel
                  ? `${data.context.academicYearLabel} · ${tc("排名會按目前學年班籍計算")}`
                  : tc("排名會按目前可用的學生資料計算")}
              </p>
            </div>
            <RewardIcon name="medal" size={22} className="shrink-0 text-[var(--primary)]" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {SCOPE_ORDER.map((scope) => {
              const overview = data.overview[scope];
              return (
                <div
                  key={scope}
                  className={`min-w-0 rounded-2xl border p-3 sm:p-4 ${
                    scope === activeScope
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                      : "border-[var(--border-soft)] bg-[var(--border-soft)]/35"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-bold text-[var(--text)]">
                          {scopeShortLabel(scope, tc)}
                        </span>
                        {scope !== "school" && overview.available && (
                          <span className="truncate text-[11px] text-[var(--muted)]">
                            {scopeLabel(scope, overview, tc)}
                          </span>
                        )}
                        {scope === activeScope && (
                          <span className="rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                            {tc("目前查看")}
                          </span>
                        )}
                      </div>
                    </div>
                    {overview.available ? (
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">
                        {overview.participantCount}{tc("人")}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">{tc("未提供")}</span>
                    )}
                  </div>

                  {overview.available ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                      {data.lists.map((item) => {
                        const summary = overview.metrics[item.type];
                        const meta = METRIC_META[item.type];
                        return (
                          <div key={item.type} className="min-w-0 rounded-xl bg-[var(--surface)] px-2.5 py-2 dark:bg-[var(--surface)]">
                            <div className="mb-1 flex items-center gap-1 text-[var(--muted)]">
                              <RewardIcon name={item.icon} size={15} />
                              <span className="truncate text-[10px]">{tc(meta.label)}</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-[15px] font-bold tabular-nums text-[var(--primary)] sm:text-[16px]">
                                {summary.rank === null ? "—" : tc(`第 ${summary.rank} 名`)}
                              </span>
                            </div>
                            <span className="text-[10px] tabular-nums text-[var(--muted)]">
                              {metricValue(summary, meta.unit, tc)} / {overview.participantCount}{tc("人")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[12px] leading-5 text-[var(--muted)]">
                      {overview.unavailableReason === "NO_CLASS"
                        ? tc("你目前未分配班級，暫時無法查看本班排名")
                        : tc("目前沒有可用的班籍資料")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section
          data-testid="leaderboard-detail"
          aria-labelledby="leaderboard-detail-title"
          aria-busy={scopeLoading}
          className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] dark:border-[var(--border)] dark:bg-[var(--surface)] sm:p-5 lg:p-6"
        >
          <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5">
            <div>
              <h2 id="leaderboard-detail-title" className="text-[16px] font-bold text-[var(--text)]">
                {tc("詳細排行榜")}
              </h2>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {scopeLabel(activeScope, activeOverview, tc)} · {activeOverview.participantCount}{tc("人")}
              </p>
            </div>
            {scopeLoading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)] lg:items-start">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {tc("排行榜範圍")}
                </p>
                <div role="tablist" aria-label={tc("排行榜範圍")} className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--border-soft)] p-1 dark:bg-[var(--border-soft)]/40">
                  {SCOPE_ORDER.map((scope) => {
                    const overview = data.overview[scope];
                    const isActive = scope === activeScope;
                    return (
                      <button
                        key={scope}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        disabled={!overview.available || scopeLoading}
                        onClick={() => {
                          setError(false);
                          setRequestedScope(scope);
                        }}
                        className={`min-w-0 rounded-xl px-2 py-2 text-[12px] font-semibold transition ${
                          isActive
                            ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                            : "text-[var(--muted)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-[var(--muted)] dark:hover:text-[var(--primary)]"
                        }`}
                      >
                        {scopeShortLabel(scope, tc)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {tc("排行榜項目")}
                </p>
                <div role="tablist" aria-label={tc("排行榜項目")} className="grid grid-cols-1 gap-1 rounded-2xl bg-[var(--border-soft)] p-1 dark:bg-[var(--border-soft)]/40 sm:grid-cols-3 lg:grid-cols-1">
                  {data.lists.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      role="tab"
                      aria-selected={activeMetric === item.type}
                      onClick={() => setActiveMetric(item.type)}
                      className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium transition lg:justify-start ${
                        activeMetric === item.type
                          ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                          : "text-[var(--muted)] hover:text-[var(--primary)] dark:text-[var(--muted)] dark:hover:text-[var(--primary)]"
                      }`}
                    >
                      <RewardIcon name={item.icon} size={15} />
                      <span className="truncate">{tc(item.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[var(--text)]">
                    {tc(list.label)}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--muted)]">
                    {scopeLabel(activeScope, activeOverview, tc)} · {activeOverview.participantCount}{tc("人")}
                  </p>
                </div>
                <div className="shrink-0 rounded-2xl bg-[var(--border-soft)] px-3 py-2 text-right">
                  <span className="block text-[10px] text-[var(--muted)]">{tc("我的排名")}</span>
                  <strong className="block text-[16px] tabular-nums text-[var(--primary)]">
                    {activeMetricSummary.rank === null ? "—" : tc(`第 ${activeMetricSummary.rank} 名`)}
                  </strong>
                  <span className="block text-[10px] tabular-nums text-[var(--muted)]">
                    {metricValue(activeMetricSummary, METRIC_META[activeMetric].unit, tc)}
                  </span>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] dark:border-[var(--border)] dark:bg-[var(--surface)]">
                {list.entries.length ? list.entries.map((entry, index) => (
                  <div
                    key={`${entry.rank}:${entry.name}:${index}`}
                    className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
                      entry.isMe
                        ? "bg-[var(--border-soft)] dark:bg-[var(--border-soft)]"
                        : index !== list.entries.length - 1
                          ? "border-b border-[var(--border-soft)] dark:border-[var(--border)]"
                          : ""
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[15px] font-bold tabular-nums text-[var(--text)]">
                      {entry.rank === 1 || entry.rank === 2 || entry.rank === 3 ? (
                        <>
                          <RankMedal rank={entry.rank} size={30} className={medalTone(entry.rank)} />
                          <span className="sr-only">{tc(`第 ${entry.rank} 名`)}</span>
                        </>
                      ) : entry.rank}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[14px] font-medium ${
                          entry.isMe
                            ? "text-[var(--primary)] dark:text-[var(--primary)]"
                            : "text-[var(--text)] dark:text-[var(--text)]"
                        }`}
                      >
                        {entry.name}
                        {entry.isMe && (
                          <span className="ml-1.5 rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)] dark:text-[var(--primary)]">
                            {tc("我")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex min-w-[72px] items-center justify-end gap-1.5 text-[14px] font-semibold tabular-nums text-[var(--primary)]">
                      <span className="student-reward-stat-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-[var(--border-soft)]">
                        <RewardIcon name={list.icon} size={19} />
                      </span>
                      <span>{entry.value}</span>
                    </div>
                  </div>
                )) : (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                    {tc("目前沒有可顯示的排行榜資料")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
