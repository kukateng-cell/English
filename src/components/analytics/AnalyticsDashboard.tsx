"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";

type Role = "TEACHER" | "ADMIN";
type ClassRow = { classId: string; grade: StudentGrade; classCode: ClassCode; currentMemberCount: number; eligibleMemberCount: number; activeStudentCount: number; activeRate: number | null; medianStudyDays: number | null; learningEncounterCount: number; medianLearningEncounters: number | null; effectiveReviewCount: number; reviewsPerEligibleMember: number | null; objective: { correctCount: number; eligibleAttemptCount: number; accuracyPercent: number | null; accuracyDisplayStatus: string }; mastery: { meanPercent: number | null; medianPercent: number | null }; due: { studentCount: number; rate: number | null } };
type ClassPayload = { academicYear: { label: string }; requestedRange: { fromDate: string; toDate: string }; effectiveRange: { from: string; to: string; rangeClamped: boolean; calendarWarning?: string }; cohortBasis: string; items: ClassRow[]; timeline: Array<{ date: string; classes: Array<{ classId: string; activeRate: number | null; objective: { accuracyPercent: number | null }; mastery: { meanPercent: number | null } }> }>; unassignedSummary: ClassRow | null };

function dateKey(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function offset(key: string, days: number) { const [y, m, d] = key.split("-").map(Number); const date = new Date(Date.UTC(y, m - 1, d + days)); return date.toISOString().slice(0, 10); }

export default function AnalyticsDashboard({ role }: { role: Role }) {
  const { tc } = useLocale();
  const today = useMemo(() => dateKey(new Date()), []);
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [fromDate, setFromDate] = useState(() => offset(today, -29));
  const [toDate, setToDate] = useState(today);
  const [grade, setGrade] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [payload, setPayload] = useState<ClassPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/classes/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range: { fromDate, toDate }, grade: grade || undefined, classIds: selected.length ? selected : undefined }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const next = await response.json() as ClassPayload;
      setPayload(next); setClasses((current) => selected.length ? current : next.items); if (!selected.length && next.items.length === 1) setSelected([next.items[0]!.classId]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取學習分析失敗")); } finally { setLoading(false); }
  }, [fromDate, toDate, grade, selected, tc]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 160); return () => window.clearTimeout(timer); }, [load]);
  function choosePreset(value: typeof preset) { setPreset(value); if (value !== "custom") { const days = Number(value); setFromDate(offset(toDate, -(days - 1))); } }
  function toggleClass(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 6 ? [...current, id] : current); }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-[var(--primary)]">{tc(role === "ADMIN" ? "管理工作台" : "教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學習分析")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("按目前班級成員計算；活動期間與目前掌握狀態分開顯示。")}</p></div><div className="flex gap-2"><Link href={role === "ADMIN" ? "/admin/users" : "/teacher/roster"} className="ui-button ui-button-secondary ui-button-small"><Icon name="users" size={16} />{tc("查看名單")}</Link></div></header>
    <section className="ui-card ui-card-padding space-y-4"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[var(--text)]">{tc("日期範圍")}</span>{(["7", "30", "90", "custom"] as const).map((value) => <button key={value} type="button" onClick={() => choosePreset(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${preset === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>{value === "custom" ? tc("自訂") : `${value}${tc("日")}`}</button>)}<select aria-label={tc("年級")} value={grade} onChange={(event) => { setGrade(event.target.value); setSelected([]); }} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((value) => <option key={value} value={value}>{tc(GRADE_LABELS[value])}</option>)}</select></div>{preset === "custom" ? <div className="flex flex-wrap gap-2"><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /><span className="self-center text-[var(--muted)]">至</span><input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></div> : null}<p className="text-xs text-[var(--muted)]">{payload ? `${tc("實際分析")}: ${payload.effectiveRange.from} 至 ${payload.effectiveRange.to}${payload.effectiveRange.rangeClamped ? ` · ${tc("已按目前學年調整")}` : ""}` : tc("載入中…")}</p></section>
    {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
    {loading && !payload ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在載入分析…")}</div> : payload ? <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]">{tc("口徑提示")}：{tc("按目前班級成員計算")} · {payload.academicYear.label} · {payload.cohortBasis}</div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{classes.map((item) => <article key={item.classId} className={`ui-card ui-card-padding cursor-pointer transition ${selected.includes(item.classId) ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/15" : ""}`} onClick={() => toggleClass(item.classId)}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc(GRADE_LABELS[item.grade])}</p><h2 className="mt-1 text-2xl font-black text-[var(--text)]">{tc(CLASS_LABELS[item.classCode])}{tc("班")}</h2></div><span className="rounded-full bg-[var(--border-soft)] px-2.5 py-1 text-xs font-bold text-[var(--muted)]">{item.currentMemberCount}{tc("人")}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="block text-xs text-[var(--muted)]">{tc("活躍率")}</span><strong className="text-lg text-[var(--text)]">{item.activeRate === null ? "—" : `${item.activeRate}%`}</strong></div><div><span className="block text-xs text-[var(--muted)]">{tc("客觀正確率")}</span><strong className="text-lg text-[var(--text)]">{item.objective.accuracyPercent === null ? "—" : `${item.objective.accuracyPercent}%`}</strong><span className="ml-1 text-[10px] text-[var(--muted)]">{item.objective.correctCount}/{item.objective.eligibleAttemptCount}</span></div><div><span className="block text-xs text-[var(--muted)]">{tc("平均掌握")}</span><strong className="text-lg text-[var(--primary)]">{item.mastery.meanPercent === null ? "—" : `${item.mastery.meanPercent}%`}</strong></div><div><span className="block text-xs text-[var(--muted)]">{tc("到期學生")}</span><strong className="text-lg text-[var(--text)]">{item.due.studentCount}</strong></div></div><Link onClick={(event) => event.stopPropagation()} href={role === "ADMIN" ? `/admin/analytics?classId=${item.classId}` : `/teacher/progress?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small mt-4 w-full">{tc("查看學生")}</Link></article>)}</section>
      {selected.length > 0 ? <section className="ui-card ui-card-padding"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[var(--text)]">{tc("選取班級比較")} ({selected.length}/6)</h2><button type="button" className="text-xs font-semibold text-[var(--primary)]" onClick={() => setSelected([])}>{tc("清除選取")}</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="py-2">{tc("日期")}</th>{selected.map((id) => <th key={id} className="py-2">{classes.find((item) => item.classId === id)?.classCode ? tc(CLASS_LABELS[classes.find((item) => item.classId === id)!.classCode]) : id}</th>)}</tr></thead><tbody>{payload.timeline.slice(-14).map((row) => <tr key={row.date} className="border-b border-[var(--border)] last:border-0"><td className="py-2 text-[var(--muted)]">{row.date}</td>{selected.map((id) => { const metric = row.classes.find((item) => item.classId === id); return <td key={id} className="py-2">{metric?.activeRate === null || metric?.activeRate === undefined ? "—" : `${metric.activeRate}%`}</td>; })}</tr>)}</tbody></table></div><p className="mt-3 text-xs text-[var(--muted)]">{tc("每日活躍率；其他指標同時保留分子及分母。")}</p></section> : null}
    </> : null}
  </div>;
}
