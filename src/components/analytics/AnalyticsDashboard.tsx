"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";

type Role = "TEACHER" | "ADMIN";
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
  medianLearningEncounters: number | null;
  effectiveReviewCount: number;
  reviewsPerEligibleMember: number | null;
  objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string };
  mastery: { meanPercent: number | null; medianPercent: number | null };
  due: { studentCount: number; rate: number | null };
};
type ClassPayload = AnalyticsEnvelope & {
  items: ClassRow[];
  timeline: Array<{ date: string; classes: Array<{ classId: string; activeRate: number | null; objective: { accuracyPercent: number | null }; mastery: { meanPercent: number | null } }> }>;
  unassignedSummary: ClassRow | null;
};
type StudentItem = {
  id: string;
  accountName: string;
  legalName: string;
  nickname: string;
  grade: StudentGrade | null;
  classId: string | null;
  classCode: ClassCode | null;
  learningEncounterCount: number;
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

function dateKey(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function offset(key: string, days: number) { const [y, m, d] = key.split("-").map(Number); const date = new Date(Date.UTC(y, m - 1, d + days)); return date.toISOString().slice(0, 10); }

export default function AnalyticsDashboard({ role }: { role: Role }) {
  const { tc } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = useMemo(() => dateKey(new Date()), []);
  const requestedStudentClassId = role === "ADMIN" ? searchParams.get("classId") ?? "" : "";
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [fromDate, setFromDate] = useState(() => offset(today, -29));
  const [toDate, setToDate] = useState(today);
  const [grade, setGrade] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [payload, setPayload] = useState<ClassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentItems, setStudentItems] = useState<StudentItem[]>([]);
  const [studentCursor, setStudentCursor] = useState<string | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentLoadingMore, setStudentLoadingMore] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const studentRequestController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/classes/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range: { fromDate, toDate }, grade: grade || undefined, classIds: selected.length ? selected : undefined }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const next = await response.json() as ClassPayload;
      setPayload(next); setClasses((current) => selected.length ? current : next.items); if (!selected.length && next.items.length === 1) setSelected([next.items[0]!.classId]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取學習分析失敗")); } finally { setLoading(false); }
  }, [fromDate, toDate, grade, selected, tc]);

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
        body: JSON.stringify({ range: { fromDate, toDate }, classFilter: { kind: "CLASS", classId: requestedStudentClassId }, search: studentSearch.trim() || undefined, cursor: nextCursor || undefined, limit: 50, sort: "ACCOUNT_ASC" }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
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
  }, [fromDate, requestedStudentClassId, role, studentSearch, tc, toDate]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 160); return () => window.clearTimeout(timer); }, [load]);
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
  function toggleClass(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 6 ? [...current, id] : current); }
  function chooseGrade(value: string) {
    setGrade(value); setSelected([]);
    if (role === "ADMIN" && requestedStudentClassId) router.replace("/admin/analytics", { scroll: false });
  }
  function clearStudentView() { router.replace("/admin/analytics", { scroll: false }); }

  const studentClass = classes.find((item) => item.classId === requestedStudentClassId) ?? null;
  const studentClassLabel = studentClass ? `${tc(GRADE_LABELS[studentClass.grade])} · ${tc(CLASS_LABELS[studentClass.classCode])}${tc("班")}` : tc("所選班級");

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-[var(--primary)]">{tc(role === "ADMIN" ? "管理工作台" : "教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學習分析")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("按目前班級成員計算；活動期間與目前掌握狀態分開顯示。")}</p></div><div className="flex gap-2"><Link href={role === "ADMIN" ? "/admin/users" : "/teacher/roster"} className="ui-button ui-button-secondary ui-button-small"><Icon name="users" size={16} />{tc("查看名單")}</Link></div></header>
    <section className="ui-card ui-card-padding space-y-4"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[var(--text)]">{tc("日期範圍")}</span>{(["7", "30", "90", "custom"] as const).map((value) => <button key={value} type="button" onClick={() => choosePreset(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${preset === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>{value === "custom" ? tc("自訂") : `${value}${tc("日")}`}</button>)}<select aria-label={tc("年級")} value={grade} onChange={(event) => chooseGrade(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((value) => <option key={value} value={value}>{tc(GRADE_LABELS[value])}</option>)}</select></div>{preset === "custom" ? <div className="flex flex-wrap gap-2"><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /><span className="self-center text-[var(--muted)]">至</span><input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></div> : null}<p className="text-xs text-[var(--muted)]">{payload ? `${tc("實際分析")}: ${payload.effectiveRange.from} 至 ${payload.effectiveRange.to}${payload.effectiveRange.rangeClamped ? ` · ${tc("已按目前學年調整")}` : ""}` : tc("載入中…")}</p></section>
    {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
    {loading && !payload ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在載入分析…")}</div> : payload ? <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]">{tc("口徑提示")}：{tc("按目前班級成員計算")} · {payload.academicYear.label} · {payload.cohortBasis}</div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{classes.map((item) => <article key={item.classId} className={`ui-card ui-card-padding flex h-full cursor-pointer flex-col transition ${selected.includes(item.classId) ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/15" : ""}`} onClick={() => toggleClass(item.classId)}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc(GRADE_LABELS[item.grade])}</p><h2 className="mt-1 text-2xl font-black text-[var(--text)]">{tc(CLASS_LABELS[item.classCode])}{tc("班")}</h2></div><span className="rounded-full bg-[var(--border-soft)] px-2.5 py-1 text-xs font-bold text-[var(--muted)]">{item.currentMemberCount}{tc("人")}</span></div><div className="mt-4 grid min-h-[144px] grid-cols-2 grid-rows-2 gap-3 text-sm"><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("活躍率")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--text)]">{item.activeRate === null ? "—" : `${item.activeRate}%`}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("客觀正確率")}</span><strong className="block whitespace-nowrap text-base leading-tight text-[var(--text)]">{accuracyLabel(item, tc)}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("平均掌握")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--primary)]">{item.mastery.meanPercent === null ? "—" : `${item.mastery.meanPercent}%`}</strong></div><div className="min-w-0"><span className="block text-xs text-[var(--muted)]">{tc("到期學生")}</span><strong className="block whitespace-nowrap text-lg leading-tight text-[var(--text)]">{item.due.studentCount}</strong></div></div><Link onClick={(event) => event.stopPropagation()} href={role === "ADMIN" ? `/admin/analytics?classId=${item.classId}#admin-analytics-students` : `/teacher/progress?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small mt-auto w-full">{tc("查看學生")}</Link></article>)}</section>
      {role === "ADMIN" && requestedStudentClassId ? <section id="admin-analytics-students" className="scroll-mt-6 ui-card ui-card-padding space-y-4" aria-labelledby="admin-analytics-students-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc("管理員視角")}</p><h2 id="admin-analytics-students-title" className="mt-1 text-xl font-black text-[var(--text)]">{studentClassLabel}{tc("學生")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{tc("只顯示目前學年、目前班級成員。")}</p></div><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={clearStudentView}>{tc("返回班級分析")}</button></div><label className="grid max-w-xl gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("搜尋學生")}<div className="relative"><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder={tc("學生證、真名或暱稱")} className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-10 text-sm outline-none focus:border-[var(--primary)]" /><Icon name="search" size={18} className="pointer-events-none absolute left-3 top-3 text-[var(--muted)]" /></div></label>{studentError ? <ErrorBanner message={studentError} onRetry={() => void loadStudents()} /> : null}{studentLoading && !studentItems.length ? <p className="text-sm text-[var(--muted)]" aria-live="polite">{tc("正在讀取學生名單…")}</p> : studentItems.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">{tc("目前沒有符合條件的學生")}</p> : <><div className="overflow-x-auto rounded-2xl border border-[var(--border)]"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">{studentClassLabel}{tc("學生名單")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3">{tc("學生")}</th><th className="px-4 py-3">{tc("帳號")}</th><th className="px-4 py-3">{tc("掌握")}</th><th className="px-4 py-3">{tc("練習／有效評測")}</th><th className="px-4 py-3">{tc("客觀正確率")}</th><th className="px-4 py-3">{tc("到期")}</th><th className="px-4 py-3">{tc("最近學習")}</th></tr></thead><tbody>{studentItems.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-4"><p className="font-bold text-[var(--text)]">{item.nickname || item.legalName}</p><p className="text-xs text-[var(--muted)]">{item.legalName}</p></td><td className="px-4 py-4 text-[var(--muted)]">{item.accountName}</td><td className="px-4 py-4"><strong className="text-[var(--primary)]">{item.currentMastery.percent === null ? "—" : `${item.currentMastery.percent}%`}</strong><span className="ml-2 text-xs text-[var(--muted)]">{item.currentMastery.masteredWordCount}/{item.currentMastery.wordCount}</span></td><td className="px-4 py-4 text-[var(--muted)]">{item.learningEncounterCount} / {item.effectiveReviewCount}</td><td className="px-4 py-4 text-[var(--muted)]">{studentAccuracyLabel(item)}</td><td className="px-4 py-4 text-[var(--muted)]">{item.dueReviewCount}</td><td className="px-4 py-4 text-[var(--muted)]">{item.lastStudyAt ? new Date(item.lastStudyAt).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>{studentCursor ? <div className="flex justify-center"><button type="button" className="ui-button ui-button-secondary" disabled={studentLoadingMore} onClick={() => void loadStudents(studentCursor, true)}>{studentLoadingMore ? tc("正在讀取…") : tc("載入更多")}</button></div> : null}</>}</section> : null}
      {role === "ADMIN" && payload.unassignedSummary ? <section className="ui-card ui-card-padding"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc("管理員視角")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{tc("未分班學生")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{payload.unassignedSummary.currentMemberCount}{tc("人")} · {tc("只顯示目前學年成員")}</p></div><div className="text-right text-sm text-[var(--muted)]"><p>{tc("活躍率")} {payload.unassignedSummary.activeRate === null ? "—" : `${payload.unassignedSummary.activeRate}%`}</p><p>{tc("客觀正確率")} {accuracyLabel(payload.unassignedSummary, tc)}</p></div></div></section> : null}
      {selected.length > 0 ? <section className="ui-card ui-card-padding"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[var(--text)]">{tc("選取班級比較")} ({selected.length}/6)</h2><button type="button" className="text-xs font-semibold text-[var(--primary)]" onClick={() => setSelected([])}>{tc("清除選取")}</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="py-2">{tc("日期")}</th>{selected.map((id) => <th key={id} className="py-2">{classes.find((item) => item.classId === id)?.classCode ? tc(CLASS_LABELS[classes.find((item) => item.classId === id)!.classCode]) : id}</th>)}</tr></thead><tbody>{payload.timeline.slice(-14).map((row) => <tr key={row.date} className="border-b border-[var(--border)] last:border-0"><td className="py-2 text-[var(--muted)]">{row.date}</td>{selected.map((id) => { const metric = row.classes.find((item) => item.classId === id); return <td key={id} className="py-2">{metric?.activeRate === null || metric?.activeRate === undefined ? "—" : `${metric.activeRate}%`}</td>; })}</tr>)}</tbody></table></div><p className="mt-3 text-xs text-[var(--muted)]">{tc("每日活躍率；其他指標同時保留分子及分母。")}</p></section> : null}
    </> : null}
  </div>;
}
