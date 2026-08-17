"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import MetricDefinitionsHelp from "@/components/analytics/MetricDefinitionsHelp";
import Icon from "@/components/ui/Icon";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorDetails, responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import { MAX_ANALYTICS_CLASS_SELECTION } from "@/lib/learning-analytics-contract";

type Role = "TEACHER" | "ADMIN";
type ComparisonGranularity = "DAY" | "WEEK" | "MONTH";
type ComparisonDisplayMode = "BAR" | "NUMBER";
type AnalyticsEnvelope = {
  academicYear: { label: string };
  requestedRange: { fromDate: string; toDate: string };
  effectiveRange: { from: string; to: string; rangeClamped: boolean; calendarWarning?: string };
  cohortBasis: string;
};
type ClassRow = {
  classId: string;
  grade: StudentGrade;
  classCode: ClassCode;
  currentMemberCount: number;
  eligibleMemberCount: number;
  activeStudentCount: number;
  activeRate: number | null;
  medianStudyDays: number | null;
  learningEncounterCount: number;
  todayLearningEncounterCount: number | null;
  medianLearningEncounters: number | null;
  effectiveReviewCount: number;
  reviewsPerEligibleMember: number | null;
  objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string };
  mastery: { meanPercent: number | null; medianPercent: number | null };
  due: { studentCount: number; rate: number | null };
};
type ClassPayload = AnalyticsEnvelope & {
  comparisonGranularity: ComparisonGranularity;
  items: ClassRow[];
  timeline: Array<{ periodStart: string; periodEnd: string; classes: Array<{ classId: string; eligibleStudentCount: number; activeStudentCount: number; activeRate: number | null; objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string }; mastery: { meanPercent: number | null } }> }>;
  unassignedSummary: ClassRow | null;
};
type StudentItem = {
  id: string;
  accountName: string;
  studentNumber: number | null;
  legalName: string;
  nickname: string;
  grade: StudentGrade | null;
  classId: string | null;
  classCode: ClassCode | null;
  learningEncounterCount: number;
  todayLearningEncounterCount: number | null;
  effectiveReviewCount: number;
  evaluatedDistinctWordCount: number;
  encounteredDistinctWordCount: number;
  objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string };
  currentMastery: { masteredWordCount: number; wordCount: number; percent: number | null };
  dueReviewCount: number;
  lastStudyAt: string | null;
};
type StudentPayload = AnalyticsEnvelope & { items: StudentItem[]; nextCursor: string | null };

function accuracyLabel(row: ClassRow, tc: (value: string) => string) {
  const value = row.objective.accuracyPercent === null ? "—" : `${row.objective.accuracyPercent}%`;
  return `${value} (${row.objective.correctCount}/${row.objective.eligibleAttemptCount})${row.objective.accuracyDisplayStatus === "SMALL_SAMPLE" ? ` · ${tc("樣本較少")}` : ""}`;
}

function studentAccuracyLabel(item: StudentItem) {
  const value = item.objective.accuracyPercent === null ? "—" : `${item.objective.accuracyPercent}%`;
  return `${value} (${item.objective.correctCount}/${item.objective.eligibleAttemptCount})`;
}

function classLabel(item: ClassRow, tc: (value: string) => string) {
  return `${tc(GRADE_LABELS[item.grade])}${tc(CLASS_LABELS[item.classCode])}`;
}

function dateKey(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function offset(key: string, days: number) { const [y, m, d] = key.split("-").map(Number); const date = new Date(Date.UTC(y, m - 1, d + days)); return date.toISOString().slice(0, 10); }
function percentText(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${value}%`; }
function percentWidth(value: number | null | undefined) { return value === null || value === undefined ? 0 : Math.min(100, Math.max(0, value)); }

export default function AnalyticsDashboard({ role }: { role: Role }) {
  const { tc } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = useMemo(() => dateKey(new Date()), []);
  const requestedStudentClassId = role === "ADMIN" ? searchParams.get("classId") ?? "" : "";
  const requestedTeacherClassId = role === "TEACHER" ? searchParams.get("classId") ?? "" : "";
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [fromDate, setFromDate] = useState(() => offset(today, -29));
  const [toDate, setToDate] = useState(today);
  const [grade, setGrade] = useState(() => searchParams.get("grade") ?? "");
  const [comparisonGranularity, setComparisonGranularity] = useState<ComparisonGranularity>("DAY");
  const [comparisonDisplayMode, setComparisonDisplayMode] = useState<ComparisonDisplayMode>("BAR");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const teacherClassFilterApplied = useRef<string | null>(null);
  const [payload, setPayload] = useState<ClassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentSort, setStudentSort] = useState<"STUDENT_NUMBER_ASC" | "ACCOUNT_ASC">("STUDENT_NUMBER_ASC");
  const [studentItems, setStudentItems] = useState<StudentItem[]>([]);
  const [studentCursor, setStudentCursor] = useState<string | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentLoadingMore, setStudentLoadingMore] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"CSV" | "XLSX">("XLSX");
  const [exporting, setExporting] = useState<"STUDENTS" | "CLASSES" | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<"STUDENTS" | "CLASSES" | null>(null);
  const studentRequestController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/classes/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range: { fromDate, toDate }, grade: grade || undefined, classIds: selected.length ? selected : undefined, comparisonGranularity }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const next = await response.json() as ClassPayload;
      setPayload(next); setClasses((current) => selected.length ? current : next.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取學習分析失敗")); } finally { setLoading(false); }
  }, [comparisonGranularity, fromDate, toDate, grade, selected, tc]);

  const loadStudents = useCallback(async (nextCursor: string | null = null, append = false) => {
    if (role !== "ADMIN" || !requestedStudentClassId) return;
    studentRequestController.current?.abort();
    const controller = new AbortController();
    studentRequestController.current = controller;
    if (append) setStudentLoadingMore(true); else setStudentLoading(true);
    setStudentError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/students/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range: { fromDate, toDate }, classFilter: { kind: "CLASS", classId: requestedStudentClassId }, search: studentSearch.trim() || undefined, cursor: nextCursor || undefined, limit: 50, sort: studentSort }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const next = await response.json() as StudentPayload;
      setStudentItems((current) => append ? [...current, ...next.items] : next.items);
      setStudentCursor(next.nextCursor ?? null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setStudentError(cause instanceof Error ? cause.message : tc("讀取學生名單失敗"));
    } finally {
      if (studentRequestController.current === controller) {
        setStudentLoading(false);
        setStudentLoadingMore(false);
      }
    }
  }, [fromDate, requestedStudentClassId, role, studentSearch, studentSort, tc, toDate]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 160); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (role !== "TEACHER") return;
    if (!requestedTeacherClassId) {
      teacherClassFilterApplied.current = null;
      return;
    }
    if (teacherClassFilterApplied.current === requestedTeacherClassId || !payload) return;
    const requested = payload.items.find((item) => item.classId === requestedTeacherClassId && (!grade || item.grade === grade));
    teacherClassFilterApplied.current = requestedTeacherClassId;
    if (!requested) return;
    const timer = window.setTimeout(() => setSelected([requested.classId]), 0);
    return () => window.clearTimeout(timer);
  }, [grade, payload, requestedTeacherClassId, role]);
  useEffect(() => {
    studentRequestController.current?.abort();
  }, [requestedStudentClassId]);
  useEffect(() => {
    if (role !== "ADMIN" || !requestedStudentClassId) return;
    const timer = window.setTimeout(() => void loadStudents(), 180);
    return () => { window.clearTimeout(timer); studentRequestController.current?.abort(); };
  }, [loadStudents, role, requestedStudentClassId]);
  useEffect(() => {
    if (role !== "ADMIN" || !requestedStudentClassId) return;
    const timer = window.setTimeout(() => document.getElementById("admin-analytics-students")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => window.clearTimeout(timer);
  }, [role, requestedStudentClassId]);
  useEffect(() => () => studentRequestController.current?.abort(), []);

  function choosePreset(value: typeof preset) { setPreset(value); if (value !== "custom") { const days = Number(value); setFromDate(offset(toDate, -(days - 1))); } }
  function toggleClass(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < MAX_ANALYTICS_CLASS_SELECTION ? [...current, id] : current); }
  function selectAllClasses() {
    if (classes.length > MAX_ANALYTICS_CLASS_SELECTION) {
      setSelected([]);
      setError(tc(`目前篩選有超過 ${MAX_ANALYTICS_CLASS_SELECTION} 個班級，請先按年級篩選後再選取。`));
      return;
    }
    setSelected(classes.map((item) => item.classId));
  }
  function chooseGrade(value: string) {
    setGrade(value); setSelected([]);
    if (role === "ADMIN" && requestedStudentClassId) router.replace("/admin/analytics", { scroll: false });
    if (role === "TEACHER" && requestedTeacherClassId) router.replace(value ? `/teacher/analytics?grade=${encodeURIComponent(value)}` : "/teacher/analytics", { scroll: false });
  }
  function clearStudentView() { router.replace("/admin/analytics", { scroll: false }); }
  async function exportReport(scope: "STUDENTS" | "CLASSES") {
    setExporting(scope); setError(null); setExportMessage(null);
    try {
      const effectiveClassIds = scope === "STUDENTS"
        ? (requestedStudentClassId ? [requestedStudentClassId] : (selected.length ? selected : undefined))
        : (selected.length ? selected : undefined);
      if (!effectiveClassIds && typeof window !== "undefined" && !window.confirm(tc(scope === "CLASSES" ? "未選取班級，將匯出目前年級篩選內的全部班級資料。" : "未指定班級，將匯出目前年級篩選內的全部學生資料。"))) return;
      const response = await rosterFetch("/api/learning-analytics/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, format: exportFormat, range: { fromDate, toDate }, grade: grade || undefined, classIds: effectiveClassIds, search: scope === "STUDENTS" && requestedStudentClassId ? studentSearch.trim() || undefined : undefined, comparisonGranularity }) });
      if (!response.ok) {
        const details = await responseErrorDetails(response, tc);
        if (details.code === "RECENT_AUTH_REQUIRED") { setPendingExport(scope); setRecentAuthOpen(true); return; }
        throw new Error(details.message);
      }
      const rowCount = response.headers.get("X-Export-Row-Count");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${scope.toLowerCase()}-learning-analytics.${exportFormat.toLowerCase()}`; anchor.click(); URL.revokeObjectURL(url);
      setExportMessage(rowCount ? tc(`已匯出 ${rowCount} 筆${scope === "CLASSES" ? "班級" : "學生"}資料。`) : tc("報告已匯出。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("匯出報告失敗")); } finally { setExporting(null); }
  }
  function periodLabel(period: { periodStart: string; periodEnd: string }) {
    if (comparisonGranularity === "DAY") return period.periodStart;
    if (comparisonGranularity === "MONTH") return period.periodStart.slice(0, 7);
    return `${period.periodStart} 至 ${period.periodEnd}`;
  }

  const studentClass = classes.find((item) => item.classId === requestedStudentClassId) ?? null;
  const studentClassLabel = studentClass ? `${tc(GRADE_LABELS[studentClass.grade])} · ${tc(CLASS_LABELS[studentClass.classCode])}${tc("班")}` : tc("所選班級");

  return <div className="space-y-5">
    <header className="analytics-page-header flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-[var(--primary)]">{tc(role === "ADMIN" ? "管理工作台" : "教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學習分析")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("按目前在籍學生統計；期間活動和目前掌握程度分開顯示。")}</p></div><div className="analytics-page-header-actions flex flex-wrap items-center gap-2"><select aria-label={tc("報告格式")} value={exportFormat} onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)} className="h-9 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"><option value="XLSX">{tc("Excel（XLSX）")}</option><option value="CSV">{tc("CSV")}</option></select><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={Boolean(exporting)} onClick={() => void exportReport("STUDENTS")}>{exporting === "STUDENTS" ? tc("匯出中…") : tc("匯出學生報告")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={Boolean(exporting)} onClick={() => void exportReport("CLASSES")}>{exporting === "CLASSES" ? tc("匯出中…") : tc("匯出班級報告")}</button><Link href={role === "ADMIN" ? "/admin/users" : "/teacher/roster"} className="ui-button ui-button-secondary ui-button-small"><Icon name="clipboard" size={16} />{tc("查看名單")}</Link></div></header>
    <section className="ui-card ui-card-padding space-y-4" aria-labelledby="analytics-date-range-title"><div className="flex flex-wrap items-center gap-2"><span id="analytics-date-range-title" className="text-sm font-semibold text-[var(--text)]">{tc("活動日期範圍")}</span>{(["7", "30", "90", "custom"] as const).map((value) => <button key={value} type="button" onClick={() => choosePreset(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${preset === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>{value === "custom" ? tc("自訂") : `${value}${tc("日")}`}</button>)}<select aria-label={tc("年級")} value={grade} onChange={(event) => chooseGrade(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((value) => <option key={value} value={value}>{tc(GRADE_LABELS[value])}</option>)}</select></div>{preset === "custom" ? <div className="flex flex-wrap gap-2"><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /><span className="self-center text-[var(--muted)]">至</span><input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></div> : null}<p className="text-xs text-[var(--muted)]">{payload ? `${tc("期間活動分析")}: ${payload.effectiveRange.from} 至 ${payload.effectiveRange.to}${payload.effectiveRange.rangeClamped ? ` · ${tc("已按目前學年調整")}` : ""}` : tc("載入中…")}</p><p className="text-xs text-[var(--muted)]">{tc("下方班級卡片會按這段期間顯示活躍、評測及待複習情況。")}</p></section>
    {exportMessage ? <p className="text-sm font-semibold text-[var(--success)]" role="status" aria-live="polite">{exportMessage}</p> : null}
    {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
    {loading && !payload ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在載入分析…")}</div> : payload ? <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]">{tc("統計方式")}：{tc("按目前在籍學生統計")} · {payload.academicYear.label} · {tc("報告可按學生或班級匯出")}</div>
      <section aria-labelledby="analytics-period-classes-title" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="analytics-period-classes-title" className="text-lg font-bold text-[var(--text)]">{tc("期間班級表現")}</h2><p id="analytics-class-selection-hint" className="mt-1 text-sm text-[var(--muted)]">{tc("按一下班級卡片即可加入比較；已選班級會以紫色框標示。卡片內數據按上方日期範圍計算。")}</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={selectAllClasses} disabled={!classes.length || selected.length === classes.length}>{tc("全選目前篩選")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => setSelected([])} disabled={!selected.length}>{tc("清除選取")}</button></div></div><div aria-describedby="analytics-class-selection-hint" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{classes.map((item) => { const isSelected = selected.includes(item.classId); return <article key={item.classId} role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${classLabel(item, tc)}${tc("班級")}`} className={`ui-card ui-card-padding flex h-full cursor-pointer flex-col transition ${isSelected ? "border-[var(--primary)] bg-[var(--border-soft)] ring-2 ring-[var(--primary)]/30 shadow-lg" : "hover:border-[var(--primary)]/60"}`} onClick={() => toggleClass(item.classId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleClass(item.classId); } }}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc(GRADE_LABELS[item.grade])}</p><h2 className="mt-1 text-2xl font-black text-[var(--text)]">{tc(CLASS_LABELS[item.classCode])}{tc("班")}</h2></div><div className="flex items-center gap-2">{isSelected ? <span className="rounded-full bg-[var(--primary)] px-2.5 py-1 text-xs font-bold text-white">{tc("已選取")}</span> : null}<span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--muted)]">{item.currentMemberCount}{tc("人")}</span></div></div><div className="mt-4 grid min-h-[144px] grid-cols-2 grid-rows-2 gap-3 text-sm"><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("活躍率")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--text)]">{item.activeRate === null ? "—" : `${item.activeRate}%`}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("客觀正確率")}</span><strong className="block whitespace-nowrap text-base leading-tight text-[var(--text)]">{accuracyLabel(item, tc)}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("平均掌握")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--primary)]">{item.mastery.meanPercent === null ? "—" : `${item.mastery.meanPercent}%`}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("待複習學生")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--text)]">{item.due.studentCount}</strong></div></div><div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--border-soft)] px-3 py-2 text-sm"><span className="text-[var(--muted)]">{tc("今日認字")}</span><strong className="text-[var(--primary)]">{item.todayLearningEncounterCount === null ? "—" : `${item.todayLearningEncounterCount}${tc("次")}`}</strong></div><Link onClick={(event) => event.stopPropagation()} href={role === "ADMIN" ? `/admin/analytics?classId=${item.classId}#admin-analytics-students` : `/teacher/progress?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small mt-3 w-full">{tc("查看學生")}</Link></article>; })}</div></section>
      {role === "ADMIN" && requestedStudentClassId ? <section id="admin-analytics-students" className="scroll-mt-6 ui-card ui-card-padding space-y-4" aria-labelledby="admin-analytics-students-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc("管理員視角")}</p><h2 id="admin-analytics-students-title" className="mt-1 text-xl font-black text-[var(--text)]">{studentClassLabel}{tc("學生")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{tc("只顯示目前學年、目前班級成員。")}</p></div><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={clearStudentView}>{tc("返回班級分析")}</button></div><label className="grid max-w-xl gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("搜尋學生")}<div className="relative"><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder={tc("登入帳號、姓名或暱稱")} className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-10 text-sm outline-none focus:border-[var(--primary)]" /><Icon name="search" size={18} className="pointer-events-none absolute left-3 top-3 text-[var(--muted)]" /></div></label><label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("排序")}<select value={studentSort} onChange={(event) => { setStudentSort(event.target.value as typeof studentSort); setStudentCursor(null); }} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="STUDENT_NUMBER_ASC">{tc("按學號")}</option><option value="ACCOUNT_ASC">{tc("按帳號")}</option></select></label>{studentError ? <ErrorBanner message={studentError} onRetry={() => void loadStudents()} /> : null}{studentLoading && !studentItems.length ? <p className="text-sm text-[var(--muted)]" aria-live="polite">{tc("正在讀取學生名單…")}</p> : studentItems.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">{tc("目前沒有符合條件的學生")}</p> : <><p className="teacher-table-hint">{tc("欄位較多；桌面版可左右滑動查看完整資料。")}</p><div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] lg:block"><table className="w-full min-w-[900px] text-left text-sm"><caption className="sr-only">{studentClassLabel}{tc("學生名單")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3">{tc("學號")}</th><th className="px-4 py-3">{tc("學生")}</th><th className="px-4 py-3">{tc("登入帳號")}</th><th className="px-4 py-3">{tc("掌握")}</th><th className="px-4 py-3">{tc("今日認字")}</th><th className="px-4 py-3">{tc("已計入測驗")}</th><th className="px-4 py-3">{tc("測驗答對率")}</th><th className="px-4 py-3">{tc("待複習詞")}</th><th className="px-4 py-3">{tc("最近學習")}</th></tr></thead><tbody>{studentItems.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-4 font-semibold text-[var(--primary)]">{item.studentNumber ?? tc("未設定")}</td><td className="px-4 py-4"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="text-xs text-[var(--muted)]">{item.legalName}</p></td><td className="px-4 py-4 text-[var(--muted)]">{item.accountName}</td><td className="px-4 py-4"><strong className="text-[var(--primary)]">{item.currentMastery.percent === null ? "—" : `${item.currentMastery.percent}%`}</strong><span className="ml-2 text-xs text-[var(--muted)]">{item.currentMastery.masteredWordCount}/{item.currentMastery.wordCount}</span></td><td className="px-4 py-4 text-[var(--primary)]">{item.todayLearningEncounterCount === null ? "—" : `${item.todayLearningEncounterCount}${tc("次")}`}</td><td className="px-4 py-4 text-[var(--muted)]">{item.effectiveReviewCount}</td><td className="px-4 py-4 text-[var(--muted)]">{studentAccuracyLabel(item)}</td><td className="px-4 py-4 text-[var(--muted)]">{item.dueReviewCount}</td><td className="px-4 py-4 text-[var(--muted)]">{item.lastStudyAt ? new Date(item.lastStudyAt).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div><div className="grid gap-3 lg:hidden">{studentItems.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="min-w-0"><p className="break-words font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="mt-1 break-words text-xs text-[var(--muted)]">{tc("登入帳號")}：{item.accountName}</p></div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--muted)]">{tc("學號")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.studentNumber ?? tc("未設定")}</dd></div><div><dt className="text-[var(--muted)]">{tc("掌握")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.currentMastery.percent === null ? "—" : `${item.currentMastery.percent}%`}</dd></div><div><dt className="text-[var(--muted)]">{tc("今日認字")}</dt><dd className="mt-1 font-semibold text-[var(--primary)]">{item.todayLearningEncounterCount === null ? "—" : `${item.todayLearningEncounterCount}${tc("次")}`}</dd></div><div><dt className="text-[var(--muted)]">{tc("已計入測驗")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.effectiveReviewCount}</dd></div><div><dt className="text-[var(--muted)]">{tc("測驗答對率")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{studentAccuracyLabel(item)}</dd></div><div><dt className="text-[var(--muted)]">{tc("待複習詞")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.dueReviewCount}</dd></div><div><dt className="text-[var(--muted)]">{tc("最近學習")}</dt><dd className="mt-1 font-semibold text-[var(--text)]">{item.lastStudyAt ? new Date(item.lastStudyAt).toLocaleDateString() : "—"}</dd></div></dl></article>)}</div>{studentCursor ? <div className="flex justify-center"><button type="button" className="ui-button ui-button-secondary" disabled={studentLoadingMore} onClick={() => void loadStudents(studentCursor, true)}>{studentLoadingMore ? tc("正在讀取…") : tc("載入更多")}</button></div> : null}</>}</section> : null}
      {role === "ADMIN" && payload.unassignedSummary ? <section className="ui-card ui-card-padding"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc("管理員視角")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{tc("未分班學生")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{payload.unassignedSummary.currentMemberCount}{tc("人")} · {tc("只顯示目前學年成員")}</p></div><div className="text-right text-sm text-[var(--muted)]"><p>{tc("活躍率")} {payload.unassignedSummary.activeRate === null ? "—" : `${payload.unassignedSummary.activeRate}%`}</p><p>{tc("客觀正確率")} {accuracyLabel(payload.unassignedSummary, tc)}</p></div></div></section> : null}
      <section className="ui-card ui-card-padding">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">{tc("選取班級比較")} <span className="text-sm font-semibold text-[var(--muted)]">{tc("已選")} {selected.length}{tc("個班級")}</span></h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{selected.length ? tc("可選擇日、週或月，表格會涵蓋目前日期範圍。") : tc("尚未選取班級；請先按上方班級卡片或使用全選。")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tc("比較時間")}>{([ ["DAY", "日"], ["WEEK", "週"], ["MONTH", "月"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={comparisonGranularity === value} onClick={() => setComparisonGranularity(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${comparisonGranularity === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]/60"}`}>{tc(label)}</button>)}</div>
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--border-soft)] p-1" role="group" aria-label={tc("顯示方式")}>
              {([ ["BAR", "百分比圖"], ["NUMBER", "數值"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={comparisonDisplayMode === value} onClick={() => setComparisonDisplayMode(value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${comparisonDisplayMode === value ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>{tc(label)}</button>)}
            </div>
            <MetricDefinitionsHelp context="analytics" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--muted)]" aria-label={tc("比較圖例")}>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />{tc("活躍率")}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />{tc("正確率")}</span>
          <span>{tc("每格顯示同一時段的兩項指標")}</span>
        </div>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-sm" style={{ minWidth: `${Math.max(760, 220 + Math.max(selected.length, 1) * 180)}px` }}>
            <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="min-w-[150px] whitespace-nowrap py-2">{comparisonGranularity === "DAY" ? tc("日期") : tc("比較時段")}</th>{selected.map((id) => { const item = classes.find((candidate) => candidate.classId === id); return <th key={id} className="whitespace-nowrap px-3 py-2"><span className="block">{item ? classLabel(item, tc) : id}</span><span className="mt-1 flex items-center justify-start gap-2 text-left text-[10px] font-normal"><span className="text-[var(--primary)]">{tc("活躍")}</span><span className="text-[var(--success)]">{tc("正確")}</span></span></th>; })}</tr></thead>
            <tbody>
              {selected.length === 0 ? <tr><td colSpan={1} className="py-10 text-center text-sm text-[var(--muted)]">{tc("選取班級後，這裡會顯示比較結果。")}</td></tr> : payload.timeline.length === 0 ? <tr><td colSpan={selected.length + 1} className="py-10 text-center text-sm text-[var(--muted)]">{tc("目前日期範圍沒有可比較的資料。")}</td></tr> : payload.timeline.map((row) => <tr key={`${row.periodStart}-${row.periodEnd}`} className="border-b border-[var(--border)] last:border-0"><td className="whitespace-nowrap py-2 text-[var(--muted)]">{periodLabel(row)}</td>{selected.map((id) => { const metric = row.classes.find((item) => item.classId === id); const activeText = percentText(metric?.activeRate); const accuracyText = percentText(metric?.objective.accuracyPercent); const ariaLabel = metric ? `${periodLabel(row)}，${classLabel(classes.find((item) => item.classId === id) ?? { grade: "JUNIOR_1", classCode: "A" } as ClassRow, tc)}：${tc("活躍率")} ${activeText}；${tc("正確率")} ${accuracyText}（${metric.objective.correctCount}/${metric.objective.eligibleAttemptCount}）` : undefined; return <td key={id} aria-label={ariaLabel} className="px-3 py-2 align-top">{comparisonDisplayMode === "BAR" ? <div className="min-w-[160px] space-y-1.5"><div className="flex items-center gap-1.5"><span className="sr-only">{tc("活躍率")}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border-soft)]"><span aria-hidden="true" className="block h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${percentWidth(metric?.activeRate)}%` }} /></div><span className="w-11 whitespace-nowrap text-right text-xs font-semibold text-[var(--primary)]">{activeText}</span></div><div className="flex items-center gap-1.5"><span className="sr-only">{tc("正確率")}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border-soft)]"><span aria-hidden="true" className="block h-full rounded-full bg-[var(--success)] transition-[width]" style={{ width: `${percentWidth(metric?.objective.accuracyPercent)}%` }} /></div><span className="w-11 whitespace-nowrap text-right text-xs font-semibold text-[var(--success)]">{accuracyText}</span></div></div> : <div className="min-w-[160px] space-y-1"><div className="flex items-center justify-between gap-3"><span className="sr-only">{tc("活躍率")}</span><strong className="whitespace-nowrap text-sm text-[var(--primary)]">{activeText}</strong></div><div className="flex items-center justify-between gap-3"><span className="sr-only">{tc("正確率")}</span><strong className="whitespace-nowrap text-sm text-[var(--success)]">{accuracyText}</strong></div><span className="block text-[10px] text-[var(--muted)]">{metric ? `${metric.objective.correctCount}/${metric.objective.eligibleAttemptCount} ${tc("答對／評測")}` : "—"}</span></div>}</td>; })}</tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">{comparisonDisplayMode === "BAR" ? tc("百分比圖以資料條顯示高低；切換至數值可查看正確及評測分子分母。") : tc("數值模式會清楚標示活躍率、正確率及答對／評測數。")}</p>
      </section>
    </> : null}
    <RecentAuthDialog open={recentAuthOpen} onClose={() => { setRecentAuthOpen(false); setPendingExport(null); }} onSuccess={() => { setRecentAuthOpen(false); const pending = pendingExport; setPendingExport(null); if (pending) void exportReport(pending); }} />
  </div>;
}
