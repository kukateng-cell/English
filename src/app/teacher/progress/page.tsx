"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import TeacherFilters, { type TeacherClassOption } from "@/components/teacher/TeacherFilters";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type Item = { id: string; accountName: string; legalName: string; nickname: string; grade: StudentGrade | null; classId: string | null; classCode: ClassCode | null; masteredWords: number; totalWords: number; masteryPercent: number | null; effectiveObjectiveProbeCount: number; effectiveReviewEventCount: number; lastActivityAt: string | null; dueReviewCount: number; byLevel: Array<{ level: string; mastered: number; total: number; progress: number }> };
type ComparisonItem = { id: string; accountName: string; legalName: string; nickname: string; learningEncounterCount: number; effectiveReviewCount: number; objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string }; currentMastery: { masteredWordCount: number; wordCount: number; percent: number | null }; };

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function offsetDate(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export default function TeacherProgressPage() {
  const { tc } = useLocale();
  const params = useSearchParams();
  const [classes, setClasses] = useState<TeacherClassOption[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [grade, setGrade] = useState(() => params.get("grade") ?? "");
  const [classId, setClassId] = useState(() => params.get("classId") ?? "");
  const [search, setSearch] = useState("");
  const today = localDateKey();
  const [fromDate, setFromDate] = useState(() => offsetDate(today, -29));
  const [toDate, setToDate] = useState(today);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonItem[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const load = useCallback(async (nextCursor: string | null = null, append = false) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const classResponse = await fetch("/api/teacher/classes", { signal: controller.signal });
      if (!classResponse.ok) throw new Error(await responseErrorMessage(classResponse));
      setClasses((await classResponse.json() as { items: TeacherClassOption[] }).items);
      const response = await rosterFetch("/api/teacher/progress/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade: grade || undefined, classId: classId || undefined, search: search || undefined, cursor: nextCursor || undefined, limit: 50 }), signal: controller.signal });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = await response.json() as { items: Item[]; nextCursor: string | null };
      setItems((current) => append ? [...current, ...payload.items] : payload.items); setCursor(payload.nextCursor);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : tc("讀取學生進度失敗"));
    }
    finally { if (requestController.current === controller) { setLoading(false); setLoadingMore(false); } }
  }, [classId, grade, search, tc]);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

  const loadComparison = useCallback(async (ids: string[], signal: AbortSignal) => {
    setComparisonLoading(true); setComparisonError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/students/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range: { fromDate, toDate }, grade: grade || undefined, classFilter: classId ? { kind: "CLASS", classId } : undefined, compareStudentIds: ids, limit: 50, sort: "ACCOUNT_ASC" }),
        signal,
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = await response.json() as { comparison: ComparisonItem[] };
      setComparison(payload.comparison);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setComparisonError(cause instanceof Error ? cause.message : tc("讀取比較資料失敗"));
    } finally { setComparisonLoading(false); }
  }, [classId, fromDate, grade, tc, toDate]);

  useEffect(() => {
    if (!selectedIds.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadComparison(selectedIds, controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadComparison, selectedIds]);

  function resetComparison() {
    setSelectedIds([]); setComparison([]); setComparisonError(null);
  }

  function changeGrade(value: string) { resetComparison(); setGrade(value); }
  function changeClass(value: string) { resetComparison(); setClassId(value); }
  function changeSearch(value: string) { resetComparison(); setSearch(value); }

  function toggleSelected(id: string) {
    if (selectedIds.includes(id) && selectedIds.length === 1) {
      setSelectedIds([]); setComparison([]); setComparisonError(null); return;
    }
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 8 ? [...current, id] : current);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-[var(--primary)]">{tc("教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學生進度")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("以一致口徑查看學習進度、到期複習及最近活動。")}</p></div><Link href="/teacher/roster" className="ui-button ui-button-secondary ui-button-small"><Icon name="users" size={17} />{tc("學生名冊")}</Link></header>
      <TeacherFilters classes={classes} grade={grade} classId={classId} search={search} onGradeChange={changeGrade} onClassChange={changeClass} onSearchChange={changeSearch} />
      <section className="ui-card ui-card-padding flex flex-wrap items-end gap-3">
        <div><p className="text-sm font-semibold text-[var(--text)]">{tc("分析期間")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("比較最多八名學生；活動與目前掌握分開顯示。")}</p></div>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("開始日期")}<input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("結束日期")}<input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
        <span className="rounded-full bg-[var(--border-soft)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{tc("已選比較")} {selectedIds.length}/8</span>
        {selectedIds.length ? <button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={resetComparison}>{tc("清除比較")}</button> : null}
      </section>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在讀取進度…")}</div> : items.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{tc("目前沒有可查看的學生")}</div> : <>
        <div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] md:block"><table className="w-full text-left text-sm"><caption className="sr-only">{tc("學生進度")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="w-12 px-4 py-3">{tc("比較")}</th><th className="px-4 py-3">{tc("學生")}</th><th className="px-4 py-3">{tc("年級／班別")}</th><th className="px-4 py-3">{tc("掌握")}</th><th className="px-4 py-3">{tc("客觀評測／有效評測")}</th><th className="px-4 py-3">{tc("到期複習")}</th><th className="px-4 py-3">{tc("最近學習")}</th><th className="px-4 py-3 text-right">{tc("詳情")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-4"><input type="checkbox" aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`} checked={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-[var(--primary)]" /></td><td className="px-4 py-4"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="text-xs text-[var(--muted)]">{item.accountName} · {item.legalName}</p></td><td className="px-4 py-4 text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</td><td className="px-4 py-4"><strong className="text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong><span className="ml-2 text-xs text-[var(--muted)]">{item.masteredWords}/{item.totalWords}</span></td><td className="px-4 py-4 text-[var(--muted)]">{item.effectiveObjectiveProbeCount} / {item.effectiveReviewEventCount}</td><td className="px-4 py-4 text-[var(--muted)]">{item.dueReviewCount}</td><td className="px-4 py-4 text-[var(--muted)]">{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</td><td className="px-4 py-4 text-right"><Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small">{tc("查看")}</Link></td></tr>)}</tbody></table></div>
        <div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="ui-card ui-card-padding"><div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`} checked={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-[var(--primary)]" />{tc("比較")}</label><strong className="text-xl text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong></div><div className="mt-2"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName} · {item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</p></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]"><span>{tc("掌握")} {item.masteredWords}/{item.totalWords}</span><span>{tc("到期")} {item.dueReviewCount}</span><span className="col-span-2">{tc("最近學習")} {item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</span></div><Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small mt-4 w-full">{tc("查看學生詳情")}</Link></article>)}</div>
        {cursor ? <div className="flex justify-center"><button type="button" className="ui-button ui-button-secondary" disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? tc("正在讀取…") : tc("載入更多")}</button></div> : null}
      </>}
      {selectedIds.length ? <section className="ui-card ui-card-padding"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-[var(--primary)]">{tc("學生比較")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{fromDate} 至 {toDate}</h2></div>{comparisonLoading ? <span className="text-xs text-[var(--muted)]">{tc("正在更新比較…")}</span> : null}</div>{comparisonError ? <p className="mt-3 text-sm text-[var(--danger)]">{comparisonError}</p> : comparison.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{comparison.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</h3><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-[var(--muted)]">{tc("練習")}</dt><dd className="font-semibold">{item.learningEncounterCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("有效評測")}</dt><dd className="font-semibold">{item.effectiveReviewCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("客觀答題")}</dt><dd className="font-semibold">{item.objective.correctCount}/{item.objective.eligibleAttemptCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("目前掌握")}</dt><dd className="font-semibold text-[var(--primary)]">{item.currentMastery.percent === null ? "—" : `${item.currentMastery.percent}%`}</dd></div></dl></article>)}</div> : <p className="mt-3 text-sm text-[var(--muted)]">{tc("未有符合目前篩選的比較資料")}</p>}<p className="mt-3 text-xs text-[var(--muted)]">{tc("比較只顯示獲授權學生；客觀數字保留正確數及有效嘗試分母。")}</p></section> : null}
    </div>
  );
}
