"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import Modal from "@/components/admin/Modal";
import CopyButton from "@/components/ui/CopyButton";
import Icon from "@/components/ui/Icon";
import TeacherFilters, { type TeacherClassOption } from "@/components/teacher/TeacherFilters";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorDetails, responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type WorkspaceView = "roster" | "progress";
type RosterItem = { id: string; accountName: string; studentNumber: number | null; legalName: string; nickname: string; grade: StudentGrade | null; classId: string | null; classCode: ClassCode | null; status: "ACTIVE" | "SUSPENDED"; canResetStudentPassword: boolean; resetPrecondition: string | null };
type ProgressItem = { id: string; accountName: string; studentNumber: number | null; legalName: string; nickname: string; grade: StudentGrade | null; classId: string | null; classCode: ClassCode | null; masteredWords: number; totalWords: number; masteryPercent: number | null; effectiveObjectiveProbeCount: number; effectiveReviewEventCount: number; lastActivityAt: string | null; dueReviewCount: number; byLevel: Array<{ level: string; mastered: number; total: number; progress: number }> };
type ComparisonItem = { id: string; accountName: string; studentNumber: number | null; legalName: string; nickname: string; learningEncounterCount: number; effectiveReviewCount: number; objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string }; currentMastery: { masteredWordCount: number; wordCount: number; percent: number | null } };

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function offsetDate(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export default function TeacherStudentsWorkspace({ initialView }: { initialView: WorkspaceView }) {
  const { tc } = useLocale();
  const params = useSearchParams();
  const [view, setView] = useState<WorkspaceView>(() => params.get("tab") === "progress" ? "progress" : initialView);
  const [classes, setClasses] = useState<TeacherClassOption[]>([]);
  const [rosterItems, setRosterItems] = useState<RosterItem[]>([]);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [grade, setGrade] = useState(() => params.get("grade") ?? "");
  const [classId, setClassId] = useState(() => params.get("classId") ?? "");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"STUDENT_NUMBER_ASC" | "ACCOUNT_ASC">("STUDENT_NUMBER_ASC");
  const today = localDateKey();
  const [fromDate, setFromDate] = useState(() => offsetDate(today, -29));
  const [toDate, setToDate] = useState(today);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonItem[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [rosterCursor, setRosterCursor] = useState<string | null>(null);
  const [progressCursor, setProgressCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetRequiresRecentAuth, setResetRequiresRecentAuth] = useState(false);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [reset, setReset] = useState<{ student: RosterItem; password?: string; error?: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"CSV" | "XLSX">("XLSX");
  const [exportGranularity, setExportGranularity] = useState<"DAY" | "WEEK" | "MONTH">("DAY");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [pendingExport, setPendingExport] = useState<"STUDENTS" | "CLASSES" | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const handlePopState = () => setView(window.location.pathname.includes("/progress") ? "progress" : "roster");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
      const endpoint = view === "roster" ? "/api/teacher/roster/query" : "/api/teacher/progress/query";
      const response = await rosterFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade: grade || undefined, classId: classId || undefined, search: search || undefined, sort, cursor: nextCursor || undefined, limit: 50 }), signal: controller.signal });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      if (view === "roster") {
        const payload = await response.json() as { items: RosterItem[]; nextCursor: string | null; resetRequiresRecentAuth?: boolean };
        setRosterItems((current) => append ? [...current, ...payload.items] : payload.items);
        setRosterCursor(payload.nextCursor);
        setResetRequiresRecentAuth(payload.resetRequiresRecentAuth === true);
      } else {
        const payload = await response.json() as { items: ProgressItem[]; nextCursor: string | null };
        setProgressItems((current) => append ? [...current, ...payload.items] : payload.items);
        setProgressCursor(payload.nextCursor);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : tc(view === "roster" ? "讀取學生名冊失敗" : "讀取學生進度失敗"));
    } finally {
      if (requestController.current === controller) { setLoading(false); setLoadingMore(false); }
    }
  }, [classId, grade, search, sort, tc, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => () => requestController.current?.abort(), []);

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
    if (view !== "progress" || !selectedIds.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadComparison(selectedIds, controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadComparison, selectedIds, view]);

  function resetComparison() {
    setSelectedIds([]); setComparison([]); setComparisonError(null);
  }

  function changeGrade(value: string) { resetComparison(); setGrade(value); setClassId(""); }
  function changeClass(value: string) { resetComparison(); setClassId(value); }
  function changeSearch(value: string) { resetComparison(); setSearch(value); }

  async function exportReport(scope: "STUDENTS" | "CLASSES") {
    setExporting(true); setError(null); setExportMessage(null);
    try {
      if (!classId && !(scope === "STUDENTS" && selectedIds.length) && typeof window !== "undefined" && !window.confirm(tc(scope === "CLASSES" ? "未選取班級，將匯出目前年級篩選內的全部班級資料。" : "未指定班級，將匯出目前年級篩選內的全部學生資料。"))) return;
      const selectedStudentIds = scope === "STUDENTS" && selectedIds.length ? selectedIds : undefined;
      const response = await rosterFetch("/api/learning-analytics/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, format: exportFormat, range: { fromDate, toDate }, grade: grade || undefined, classIds: classId ? [classId] : undefined, studentIds: selectedStudentIds, search: scope === "STUDENTS" && !selectedStudentIds ? search.trim() || undefined : undefined, comparisonGranularity: exportGranularity }) });
      if (!response.ok) {
        const details = await responseErrorDetails(response, tc);
        if (details.code === "RECENT_AUTH_REQUIRED") { setPendingExport(scope); setRecentAuthOpen(true); return; }
        throw new Error(details.message);
      }
      const rowCount = response.headers.get("X-Export-Row-Count");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${scope.toLowerCase()}-learning-analytics.${exportFormat.toLowerCase()}`; anchor.click(); URL.revokeObjectURL(url);
      setExportMessage(rowCount ? tc(`已匯出 ${rowCount} 筆${scope === "CLASSES" ? "班級" : "學生"}資料。`) : tc("報告已匯出。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("匯出報告失敗")); } finally { setExporting(false); }
  }

  function selectView(next: WorkspaceView) {
    if (next === view) return;
    setView(next);
    setError(null);
    setLoading(true);
    if (next === "roster") setRosterItems([]); else setProgressItems([]);
    resetComparison();
    const query = new URLSearchParams();
    if (grade) query.set("grade", grade);
    if (classId) query.set("classId", classId);
    const target = next === "roster" ? "/teacher/roster" : "/teacher/progress";
    window.history.pushState({}, "", `${target}${query.toString() ? `?${query.toString()}` : ""}`);
  }

  function toggleSelected(id: string) {
    if (selectedIds.includes(id) && selectedIds.length === 1) {
      setSelectedIds([]); setComparison([]); setComparisonError(null); return;
    }
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 8 ? [...current, id] : current);
  }

  async function resetPassword(student: RosterItem) {
    if (!student.canResetStudentPassword || !student.resetPrecondition || !window.confirm(tc("確定要重設這位學生的密碼嗎？舊會話會立即失效。"))) return;
    setResetting(true); setReset({ student });
    try {
      const response = await rosterFetch(`/api/teacher/students/${student.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetPrecondition: student.resetPrecondition }) });
      const details = response.ok ? null : await responseErrorDetails(response, tc);
      const payload = response.ok ? await response.json().catch(() => null) as { temporaryPassword?: string } | null : null;
      if (!response.ok) {
        if (details?.code === "RESET_PRECONDITION_INVALID" || details?.code === "RESET_CREDENTIAL_STALE") await load();
        setReset({ student, error: details?.message ?? tc("重設密碼失敗") });
      } else setReset({ student, password: payload?.temporaryPassword ?? "" });
    } catch (cause) {
      setReset({ student, error: cause instanceof Error ? cause.message : tc("重設密碼失敗") });
    } finally { setResetting(false); }
  }

  const rosterItemsVisible = view === "roster" ? rosterItems : [];
  const progressItemsVisible = view === "progress" ? progressItems : [];
  const cursor = view === "roster" ? rosterCursor : progressCursor;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm font-bold text-[var(--primary)]">{tc("教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學生")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc(view === "roster" ? "查看學生資料、班別及可用操作。" : "查看學習進度、待複習內容及最近活動。")}</p></div>
      </header>

      <div role="tablist" aria-label={tc("學生工作區") as string} className="flex w-fit max-w-full gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5">
        <button type="button" role="tab" aria-selected={view === "roster"} className={`ui-button ui-button-small ${view === "roster" ? "ui-button-primary" : "ui-button-secondary"}`} onClick={() => selectView("roster")}><Icon name="users" size={16} />{tc("學生名冊")}</button>
        <button type="button" role="tab" aria-selected={view === "progress"} className={`ui-button ui-button-small ${view === "progress" ? "ui-button-primary" : "ui-button-secondary"}`} onClick={() => selectView("progress")}><Icon name="trending-up" size={16} />{tc("學生進度")}</button>
      </div>

      <TeacherFilters classes={classes} grade={grade} classId={classId} search={search} onGradeChange={changeGrade} onClassChange={changeClass} onSearchChange={changeSearch} />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <span className="text-xs font-semibold text-[var(--muted)]">{tc("排序")}</span>
        <select aria-label={tc("學生排序")} value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setRosterCursor(null); setProgressCursor(null); }} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"><option value="STUDENT_NUMBER_ASC">{tc("按學號")}</option><option value="ACCOUNT_ASC">{tc("按帳號")}</option></select>
        <span className="text-xs text-[var(--muted)]">{tc("未設定學號會排在最後")}</span>
      </div>

      {view === "progress" ? <section className="ui-card ui-card-padding flex flex-wrap items-end gap-3">
        <div><p className="text-sm font-semibold text-[var(--text)]">{tc("分析期間")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("比較最多八名學生；活動與目前掌握分開顯示。")}</p></div>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("開始日期")}<input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("結束日期")}<input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
        <span className="rounded-full bg-[var(--border-soft)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{tc("已選比較")} {selectedIds.length}/8</span>
        <select aria-label={tc("報告時間單位")} value={exportGranularity} onChange={(event) => setExportGranularity(event.target.value as typeof exportGranularity)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs"><option value="DAY">{tc("每日")}</option><option value="WEEK">{tc("每週")}</option><option value="MONTH">{tc("每月")}</option></select><select aria-label={tc("報告格式")} value={exportFormat} onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs"><option value="XLSX">XLSX</option><option value="CSV">CSV</option></select><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={exporting} onClick={() => void exportReport("STUDENTS")}>{exporting ? tc("匯出中…") : tc("匯出學生報告")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={exporting} onClick={() => void exportReport("CLASSES")}>{exporting ? tc("匯出中…") : tc("匯出班級報告")}</button>
        {selectedIds.length ? <button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={resetComparison}>{tc("清除比較")}</button> : null}
      </section> : null}

      {view === "roster" && resetRequiresRecentAuth ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]"><span>{tc("目前可以查看學生名冊；如要重設學生密碼，請先重新驗證身份。")}</span><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => setRecentAuthOpen(true)}>{tc("重新驗證")}</button></div> : null}
      {exportMessage ? <p className="text-sm font-semibold text-[var(--success)]" role="status" aria-live="polite">{exportMessage}</p> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc(view === "roster" ? "正在讀取學生名冊…" : "正在讀取學生進度…")}</div> : view === "roster" && rosterItemsVisible.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{search || grade || classId ? tc("找不到符合條件的學生") : tc("目前沒有可查看的學生")}</div> : view === "progress" && progressItemsVisible.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{tc("目前沒有可查看的學生")}</div> : view === "roster" ? <>
        <div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] md:block"><table className="w-full table-fixed text-left text-sm"><colgroup><col className="w-[20%]" /><col className="w-[10%]" /><col className="w-[20%]" /><col className="w-[18%]" /><col className="w-[14%]" /><col className="w-[18%]" /></colgroup><caption className="sr-only">{tc("學生名冊")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="px-3 py-3">{tc("學生證")}</th><th className="px-3 py-3 whitespace-nowrap">{tc("學號")}</th><th className="px-3 py-3">{tc("真名")}</th><th className="px-3 py-3">{tc("暱稱")}</th><th className="px-3 py-3 whitespace-nowrap">{tc("年級／班別")}</th><th className="px-3 py-3">{tc("操作")}</th></tr></thead><tbody>{rosterItemsVisible.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-3 py-4 break-words font-semibold text-[var(--text)]">{item.accountName}</td><td className="px-3 py-4 whitespace-nowrap text-[var(--muted)]">{item.studentNumber ?? tc("未設定")}</td><td className="px-3 py-4 break-words">{item.legalName}</td><td className="px-3 py-4 break-words text-[var(--muted)]">{item.nickname || "—"}</td><td className="px-3 py-4 whitespace-nowrap text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</td><td className="px-3 py-4 align-top"><div className="flex flex-wrap gap-2"><Link href={`/teacher/students/${item.id}?from=roster`} className="ui-button ui-button-secondary ui-button-small">{tc("查看詳情")}</Link>{item.canResetStudentPassword ? <button type="button" disabled={resetting} onClick={() => void resetPassword(item)} className="ui-button ui-button-primary ui-button-small"><Icon name="lock" size={15} />{tc("重設密碼")}</button> : null}</div></td></tr>)}</tbody></table></div>
        <div className="grid gap-3 md:hidden">{rosterItemsVisible.map((item) => <article key={item.id} className="ui-card ui-card-padding"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--text)]">{item.legalName}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName} · {item.nickname || tc("未設定暱稱")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("學號")}：{item.studentNumber ?? tc("未設定")}</p><p className="mt-2 text-xs text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</p></div><Link href={`/teacher/students/${item.id}?from=roster`} aria-label={tc("查看學生詳情")} className="ui-button ui-button-secondary ui-button-small"><Icon name="arrow-right" size={16} /></Link></div>{item.canResetStudentPassword ? <button type="button" disabled={resetting} onClick={() => void resetPassword(item)} className="ui-button ui-button-primary ui-button-small mt-4 w-full"><Icon name="lock" size={15} />{tc("重設密碼")}</button> : null}</article>)}</div>
      </> : <>
        <div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] md:block"><table className="w-full table-fixed text-left text-sm"><colgroup><col className="w-[7%]" /><col className="w-[20%]" /><col className="w-[9%]" /><col className="w-[13%]" /><col className="w-[15%]" /><col className="w-[16%]" /><col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[5%]" /></colgroup><caption className="sr-only">{tc("學生進度")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="whitespace-nowrap px-2 py-3">{tc("比較")}</th><th className="whitespace-nowrap px-2 py-3">{tc("學生")}</th><th className="whitespace-nowrap px-2 py-3">{tc("學號")}</th><th className="whitespace-nowrap px-2 py-3">{tc("年級／班別")}</th><th className="whitespace-nowrap px-2 py-3">{tc("掌握")}</th><th className="px-2 py-3">{tc("客觀評測／有效評測")}</th><th className="whitespace-nowrap px-2 py-3">{tc("待複習詞")}</th><th className="whitespace-nowrap px-2 py-3">{tc("最近學習")}</th><th className="whitespace-nowrap px-2 py-3">{tc("詳情")}</th></tr></thead><tbody>{progressItemsVisible.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-2 py-4"><input type="checkbox" aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`} checked={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-[var(--primary)]" /></td><td className="px-2 py-4 break-words"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="break-words text-xs text-[var(--muted)]">{item.accountName} · {item.legalName}</p></td><td className="whitespace-nowrap px-2 py-4 text-[var(--muted)]">{item.studentNumber ?? tc("未設定")}</td><td className="whitespace-nowrap px-2 py-4 text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</td><td className="whitespace-nowrap px-2 py-4"><strong className="text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong><span className="ml-2 text-xs text-[var(--muted)]">{item.masteredWords}/{item.totalWords}</span></td><td className="break-words px-2 py-4 text-[var(--muted)]">{item.effectiveObjectiveProbeCount} / {item.effectiveReviewEventCount}</td><td className="whitespace-nowrap px-2 py-4 text-[var(--muted)]">{item.dueReviewCount}</td><td className="whitespace-nowrap px-2 py-4 text-[var(--muted)]">{item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</td><td className="px-2 py-4 align-top"><Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small whitespace-nowrap">{tc("查看")}</Link></td></tr>)}</tbody></table></div>
        <div className="grid gap-3 md:hidden">{progressItemsVisible.map((item) => <article key={item.id} className="ui-card ui-card-padding"><div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" aria-label={`${tc("選取比較")} ${item.nickname || item.legalName}`} checked={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && selectedIds.length >= 8} onChange={() => toggleSelected(item.id)} className="h-4 w-4 accent-[var(--primary)]" />{tc("比較")}</label><strong className="text-xl text-[var(--primary)]">{item.masteryPercent === null ? "—" : `${item.masteryPercent}%`}</strong></div><div className="mt-2"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName} · {item.grade ? `${tc(GRADE_LABELS[item.grade])}${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("學號")}：{item.studentNumber ?? tc("未設定")}</p></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]"><span>{tc("掌握")} {item.masteredWords}/{item.totalWords}</span><span>{tc("待複習詞")} {item.dueReviewCount}</span><span className="col-span-2">{tc("最近學習")} {item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : "—"}</span></div><Link href={`/teacher/students/${item.id}?from=progress`} className="ui-button ui-button-secondary ui-button-small mt-4 w-full">{tc("查看學生詳情")}</Link></article>)}</div>
      </>}
      {cursor ? <div className="flex justify-center"><button type="button" className="ui-button ui-button-secondary" disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? tc("正在讀取…") : tc("載入更多")}</button></div> : null}

      {view === "progress" && selectedIds.length ? <section className="ui-card ui-card-padding"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-[var(--primary)]">{tc("學生比較")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{fromDate} 至 {toDate}</h2></div>{comparisonLoading ? <span className="text-xs text-[var(--muted)]">{tc("正在更新比較…")}</span> : null}</div>{comparisonError ? <p className="mt-3 text-sm text-[var(--danger)]">{comparisonError}</p> : comparison.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{comparison.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</h3><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName}</p><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-[var(--muted)]">{tc("練習")}</dt><dd className="font-semibold">{item.learningEncounterCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("有效評測")}</dt><dd className="font-semibold">{item.effectiveReviewCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("客觀答題")}</dt><dd className="font-semibold">{item.objective.correctCount}/{item.objective.eligibleAttemptCount}</dd></div><div><dt className="text-xs text-[var(--muted)]">{tc("目前掌握")}</dt><dd className="font-semibold text-[var(--primary)]">{item.currentMastery.percent === null ? "—" : `${item.currentMastery.percent}%`}</dd></div></dl></article>)}</div> : <p className="mt-3 text-sm text-[var(--muted)]">{tc("未有符合目前篩選的比較資料")}</p>}<p className="mt-3 text-xs text-[var(--muted)]">{tc("比較只顯示獲授權學生；客觀數字保留正確數及有效嘗試分母。")}</p></section> : null}

      <Modal open={Boolean(reset)} onClose={() => setReset(null)} title={tc("重設學生密碼")}>{reset?.password ? <div className="space-y-4 text-center"><p className="text-sm text-[var(--muted)]">{tc("請只向學生展示這次產生的臨時密碼：")}</p><div className="flex flex-wrap items-center justify-center gap-2"><p className="select-all rounded-xl bg-[var(--border-soft)] px-4 py-3 text-2xl font-black tracking-widest text-[var(--primary)]">{reset.password}</p><CopyButton value={reset.password} /></div><p className="text-xs text-[var(--warning)]">{tc("學生下次登入時必須修改密碼，舊會話已失效。")}</p><button type="button" className="ui-button ui-button-primary w-full" onClick={() => setReset(null)}>{tc("完成")}</button></div> : <div className="space-y-4 text-center"><p className="text-sm text-[var(--danger)]">{reset?.error ?? tc("正在產生臨時密碼…")}</p><button type="button" className="ui-button ui-button-secondary w-full" onClick={() => setReset(null)}>{tc("關閉")}</button></div>}</Modal>
      <RecentAuthDialog open={recentAuthOpen} onClose={() => { setRecentAuthOpen(false); setPendingExport(null); }} onSuccess={() => { setRecentAuthOpen(false); const pending = pendingExport; setPendingExport(null); void load(); if (pending) void exportReport(pending); }} />
    </div>
  );
}
