"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
import RewardIcon, { RankMedal } from "@/components/ui/RewardIcon";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { LeaderboardScope, WeeklyLeaderboardData, WeeklyLeaderboardEntry } from "@/lib/leaderboard";

const SCOPE_ORDER: LeaderboardScope[] = ["class", "grade", "school"];

function scoreText(milliPoints: number | null) {
  if (milliPoints === null) return "—";
  return (milliPoints / 1000).toFixed(3).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function scopeShortLabel(scope: LeaderboardScope, tc: (value: string) => string) {
  if (scope === "class") return tc("本班");
  if (scope === "grade") return tc("全年級");
  return tc("全校");
}

function scopeLabel(data: WeeklyLeaderboardData, tc: (value: string) => string) {
  if (data.scope === "class" && data.scopeContext.classCode) {
    return `${tc(GRADE_LABELS[data.scopeContext.grade])}${tc(CLASS_LABELS[data.scopeContext.classCode])}${tc("班")}`;
  }
  if (data.scope === "grade") return `${tc(GRADE_LABELS[data.scopeContext.grade])}${tc("年級")}`;
  return scopeShortLabel(data.scope, tc);
}

function rankText(rank: number | null, tc: (value: string) => string) {
  return rank === null ? tc("本週尚未上榜") : `${tc("第")}${rank}${tc("名")}`;
}

function medalTone(rank: number | null) {
  if (rank === 1) return "text-[#d89b24]";
  if (rank === 2) return "text-[#8795a7]";
  return "text-[#b9784c]";
}

function uniqueEntries(entries: WeeklyLeaderboardEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.entryKey)) return false;
    seen.add(entry.entryKey);
    return true;
  });
}

export default function LeaderboardPage() {
  const { tc } = useLocale();
  const [data, setData] = useState<WeeklyLeaderboardData | null>(null);
  const [requestedScope, setRequestedScope] = useState<LeaderboardScope | null>(null);
  const [view, setView] = useState<"summary" | "all">("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [entries, setEntries] = useState<WeeklyLeaderboardEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      setNeedLogin(false);
      const params = new URLSearchParams();
      if (requestedScope) params.set("scope", requestedScope);
      if (view === "all") params.set("view", "all");
      if (cursor) params.set("cursor", cursor);
      try {
        const query = params.toString();
        const response = await fetch(`/api/leaderboard${query ? `?${query}` : ""}`, { signal: controller.signal });
        if (response.status === 401) {
          if (!cancelled) setNeedLogin(true);
          return;
        }
        if (!response.ok) {
          if (!cancelled) setError(response.status === 422 ? tc("這個排行榜範圍目前未能使用") : tc("排行榜暫時無法載入，請重試"));
          return;
        }
        const payload = await response.json() as WeeklyLeaderboardData;
        if (cancelled) return;
        setData(payload);
        setEntries(cursor && view === "all" ? (current) => [...current, ...payload.page.entries] : payload.page.entries);
      } catch (cause) {
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) setError(tc("排行榜暫時無法載入，請重試"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cursor, reloadKey, requestedScope, tc, view]);

  const visibleSummaryEntries = useMemo(() => data ? uniqueEntries([...data.topEntries, ...data.nearbyEntries]) : [], [data]);
  const renderedEntries = view === "all" ? entries : visibleSummaryEntries;
  const activeScope = data?.scope ?? requestedScope ?? "class";
  const availability = data ? {
    class: data.scopeContext.classCode !== null,
    grade: true,
    school: true,
  } : { class: true, grade: true, school: true };

  const selectScope = (scope: LeaderboardScope) => {
    if (scope === activeScope && view === "summary") return;
    setRequestedScope(scope);
    setView("summary");
    setCursor(null);
    setData(null);
    setEntries([]);
  };

  const openAll = () => {
    setView("all");
    setCursor(null);
    setEntries([]);
  };

  const loadMore = () => {
    if (data?.page.nextCursor) setCursor(data.page.nextCursor);
  };

  const showMyPosition = () => {
    if (!data?.page.myPageCursor) return;
    if (view !== "all") {
      setView("all");
      setCursor(data.page.myPageCursor);
      setEntries([]);
      return;
    }
    const currentMe = listRef.current?.querySelector<HTMLElement>("[data-me='true']");
    if (currentMe) {
      currentMe.focus();
      currentMe.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setCursor(data.page.myPageCursor);
    setEntries([]);
  };

  if (needLogin) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--border-soft)] text-[var(--primary)]"><Icon name="lock" size={24} /></div>
        <p className="mb-4 text-[15px] text-[var(--muted)]">{tc("請先登入後查看排行榜")}</p>
        <Link href="/login" className="flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] px-8 text-[15px] font-semibold text-[var(--color-surface)]">{tc("前往登入")}</Link>
      </div>
    );
  }

  if (!data && error) {
    return <div className="flex min-h-full items-center justify-center px-6"><ErrorBanner message={error} onRetry={() => setReloadKey((key) => key + 1)} /></div>;
  }

  return (
    <div data-testid="leaderboard-page" className="min-h-full px-0 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label={tc("返回")} className="study-header-icon study-header-back mb-5"><Icon name="chevron-left" size={26} /></Link>

        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
          <div>
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--border)] bg-[var(--border-soft)] text-[var(--primary)] shadow-[var(--shadow-sm)] student-reward-hero-icon"><RewardIcon name="trophy" size={38} /></div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">{tc("每週挑戰")}</p>
            <h1 className="text-2xl font-bold text-[var(--text)] sm:text-3xl">{tc("學習排行榜")}</h1>
            <p className="mt-2 text-[13px] text-[var(--muted)]">{tc("同本班同學一起保持學習動力")}</p>
          </div>
          {data && <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left shadow-[var(--shadow-sm)] sm:text-right"><p className="text-[11px] text-[var(--muted)]">{tc("本週日期")}</p><p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--text)]">{data.week.start} – {data.week.effectiveTo}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{data.week.daysRemaining}{tc("日後結束")}</p></div>}
        </header>

        {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-bg)] px-4 py-3 text-[12px] text-[var(--danger)]"><span>{error}</span><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="rounded-xl border border-[var(--danger)]/30 px-3 py-1.5 font-semibold">{tc("重試")}</button></div>}

        {data && <>
          {data.notice === "PARTIAL_COVERAGE" && <div role="status" className="mb-4 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-bg)] px-4 py-3 text-[12px] text-[var(--warning)]">{tc("部分紀錄核對中，排名可能更新")}</div>}
          <section data-testid="leaderboard-overview" aria-labelledby="leaderboard-overview-title" className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5 lg:p-6">
            <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id="leaderboard-overview-title" className="text-[17px] font-bold text-[var(--text)]">{tc("我的排行榜概覽")}</h2><p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{tc("每週重新計分；已取得的分數會保留到本週結束")}</p></div><RewardIcon name="medal" size={24} className="shrink-0 text-[var(--primary)]" /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-[var(--primary)]/8 p-4 sm:col-span-2"><p className="text-[11px] font-semibold text-[var(--muted)]">{scopeLabel(data, tc)}</p><div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2"><div><strong className="block text-3xl font-bold tabular-nums text-[var(--primary)]">{rankText(data.personal.rank, tc)}</strong><span className="text-[12px] text-[var(--muted)]">{tc("目前位置")}</span></div><div><strong className="block text-3xl font-bold tabular-nums text-[var(--text)]">{scoreText(data.personal.scoreMilliPoints)}</strong><span className="text-[12px] text-[var(--muted)]">{tc("本週分")}</span></div></div>{data.personal.gapToNext !== null && <p className="mt-3 text-[12px] text-[var(--primary)]">{tc("距離前一名目前差")} {scoreText(data.personal.gapToNextMilliPoints)} {tc("分")}</p>}{data.personal.rankingState === "PENDING_REVIEW" && <p className="mt-3 text-[12px] text-[var(--warning)]">{tc("部分紀錄待核對，排名可能更新")}</p>}</div>
              <div className="rounded-2xl border border-[var(--border-soft)] p-4"><p className="text-[11px] font-semibold text-[var(--muted)]">{tc("本週目標")}</p><strong className="mt-2 block text-2xl font-bold tabular-nums text-[var(--text)]">{data.personal.goal.completedDays}/{data.personal.goal.targetDays} {tc("日")}</strong><p className="mt-1 text-[12px] text-[var(--muted)]">{data.personal.goal.reached ? tc("目標已達成，繼續保持") : tc("再學習幾日就達標")}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border-soft)]"><div className="h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${data.personal.goal.targetDays ? Math.min(100, data.personal.goal.completedDays / data.personal.goal.targetDays * 100) : 0}%` }} /></div></div>
            </div>
          </section>

          <section className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5 lg:p-6" aria-labelledby="leaderboard-controls-title">
            <div className="mb-3 flex items-center justify-between gap-3"><div><h2 id="leaderboard-controls-title" className="text-[16px] font-bold text-[var(--text)]">{tc("排行榜範圍")}</h2><p className="mt-1 text-[12px] text-[var(--muted)]">{data.participantCount}{tc("人參加")}</p></div>{loading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" aria-label={tc("載入中")} />}</div>
            <div role="tablist" aria-label={tc("排行榜範圍")} className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--border-soft)] p-1">
              {SCOPE_ORDER.map((scope) => <button key={scope} type="button" role="tab" aria-selected={activeScope === scope} disabled={!availability[scope]} onClick={() => selectScope(scope)} className={`min-w-0 rounded-xl px-2 py-2.5 text-[12px] font-semibold transition ${activeScope === scope ? "bg-[var(--surface)] text-[var(--primary)] shadow-[var(--shadow-sm)]" : "text-[var(--muted)] hover:text-[var(--text)]"} disabled:cursor-not-allowed disabled:opacity-45`}>{scopeShortLabel(scope, tc)}</button>)}
            </div>
          </section>

          <section data-testid="leaderboard-detail" aria-labelledby="leaderboard-detail-title" className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)] lg:items-start">
            <div className="min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5 lg:p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 id="leaderboard-detail-title" className="text-[18px] font-bold text-[var(--text)]">{scopeLabel(data, tc)}</h2><p className="mt-1 text-[12px] text-[var(--muted)]">{data.rankedCount}{tc("人已上榜")} · {data.unrankedCount}{tc("人尚未開始")}</p></div><button type="button" onClick={view === "all" ? showMyPosition : openAll} className="rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] font-semibold text-[var(--primary)]">{view === "all" ? tc("返回我的位置") : tc("查看完整榜單")}</button></div>
              <div ref={listRef} className="overflow-hidden rounded-2xl border border-[var(--border)]" aria-live="polite">
                {loading && !renderedEntries.length ? <div className="px-4 py-12 text-center text-[13px] text-[var(--muted)]">{tc("排行榜載入中…")}</div> : renderedEntries.length ? renderedEntries.map((entry) => <RankingRow key={entry.entryKey} entry={entry} tc={tc} />) : <div className="px-4 py-12 text-center text-[13px] text-[var(--muted)]">{tc("本週尚未有人上榜，完成一次學習就會出現")}</div>}
              </div>
              {view === "all" && data.page.nextCursor && <button type="button" onClick={loadMore} disabled={loading} className="mt-4 w-full rounded-2xl border border-[var(--border)] px-4 py-3 text-[13px] font-semibold text-[var(--primary)] disabled:opacity-50">{loading ? tc("載入中…") : tc("載入更多同學")}</button>}
            </div>

            <aside className="min-w-0 space-y-5">
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"><h2 className="text-[16px] font-bold text-[var(--text)]">{tc("本週學習日")}</h2><div className="mt-4 grid grid-cols-7 gap-1.5">{data.personal.dailyProgress.map((day) => <div key={day.date} className="text-center"><div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-xl text-[11px] font-semibold ${day.active ? "bg-[var(--primary)] text-[var(--color-surface)]" : "bg-[var(--border-soft)] text-[var(--muted)]"}`} title={`${day.date} ${scoreText(day.scoreMilliPoints)}${tc("分")}`}>{day.date.slice(-2)}</div><span className="mt-1 block text-[9px] text-[var(--muted)]">{day.date.slice(5, 7)}/{day.date.slice(-2)}</span></div>)}</div><Link href="/study" className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-[var(--primary)] text-[13px] font-semibold text-[var(--color-surface)]">{tc("繼續學習")}</Link></section>
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"><details><summary className="cursor-pointer text-[15px] font-bold text-[var(--text)]">{tc("點樣計分？")}</summary><div className="mt-3 space-y-2 text-[12px] leading-5 text-[var(--muted)]"><p>{tc("投入佔70%，客觀認讀成果佔30%；每日最多計20次活動及5個成功詞義。")}</p><p>{tc("完成一張卡會得到投入分；同日首次客觀答對一個詞義會增加成果分。例如一張卡約0.35分，一個首次成功詞義約0.95分。")}</p><p>{tc("重送不會重複計；同分會並列。分數只代表本週合資格學習活動，不是英語能力分數。")}</p></div></details></section>
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5"><h2 className="text-[15px] font-bold text-[var(--text)]">{tc("我的累積成果")}</h2><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-[var(--border-soft)] p-3"><strong className="block text-xl tabular-nums text-[var(--text)]">{data.cumulative.studyDays}</strong><span className="text-[11px] text-[var(--muted)]">{tc("累計學習日")}</span></div><div className="rounded-2xl bg-[var(--border-soft)] p-3"><strong className="block text-xl tabular-nums text-[var(--text)]">{data.cumulative.masteredWords}</strong><span className="text-[11px] text-[var(--muted)]">{tc("目前掌握詞")}</span></div></div></section>
            </aside>
          </section>
        </>}
        {!data && loading && <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-[13px] text-[var(--muted)]">{tc("排行榜載入中…")}</div>}
      </div>
    </div>
  );
}

function RankingRow({ entry, tc }: { entry: WeeklyLeaderboardEntry; tc: (value: string) => string }) {
  const isRanked = entry.rank !== null;
  return <div data-me={entry.isMe ? "true" : "false"} tabIndex={entry.isMe ? -1 : undefined} className={`flex items-center gap-3 border-b border-[var(--border-soft)] px-3 py-3 last:border-0 sm:px-4 ${entry.isMe ? "bg-[var(--primary)]/8" : ""}`}>
    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[14px] font-bold tabular-nums text-[var(--text)]">{entry.rank === 1 || entry.rank === 2 || entry.rank === 3 ? <><RankMedal rank={entry.rank === 1 ? 1 : entry.rank === 2 ? 2 : 3} size={30} className={medalTone(entry.rank)} /><span className="sr-only">{rankText(entry.rank, tc)}</span></> : entry.rank ?? "—"}</div>
    <div className="min-w-0 flex-1"><p className={`truncate text-[14px] font-semibold ${entry.isMe ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{entry.nickname}{entry.isMe && <span className="ml-1.5 rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] text-[var(--primary)]">{tc("我")}</span>}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{entry.isTied && isRanked ? tc("並列") : entry.rankingState === "PENDING_REVIEW" ? tc("待核對") : !isRanked ? tc("尚未上榜") : ""}</p></div>
    <div className="flex min-w-[78px] items-center justify-end gap-1.5 text-[15px] font-bold tabular-nums text-[var(--primary)]"><span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[var(--border-soft)]"><RewardIcon name="trophy" size={17} /></span>{scoreText(entry.scoreMilliPoints)}<span className="text-[10px] font-medium">{tc("分")}</span></div>
  </div>;
}
