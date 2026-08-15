"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type ClassSummary = { classId: string; grade: StudentGrade; classCode: ClassCode; studentCount: number; activeTodayCount: number; activeSevenDayCount: number; masteredWordCount: number; masteryAveragePercent: number | null; dueStudentCount: number; inactiveSevenDayCount: number; totalWords: number };

export default function TeacherDashboard() {
  const { tc } = useLocale();
  const [items, setItems] = useState<ClassSummary[]>([]);
  const [grade, setGrade] = useState("");
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const response = await rosterFetch("/api/teacher/class-summary/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade: grade || undefined }) }); if (!response.ok) throw new Error(await responseErrorMessage(response)); const payload = await response.json() as { items: ClassSummary[]; unassignedStudentCount: number }; setItems(payload.items); setUnassigned(payload.unassignedStudentCount); } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取班級概覽失敗")); } finally { setLoading(false); }
  }, [grade, tc]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  return <div className="space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-[var(--primary)]">{tc("教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("班級概覽")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("按目前班級比較活躍度、掌握及到期複習；數字只作教學跟進參考。")}</p></div><div className="flex gap-2"><Link href="/teacher/roster" className="ui-button ui-button-primary ui-button-small"><Icon name="users" size={17} />{tc("學生名冊")}</Link><Link href="/teacher/progress" className="ui-button ui-button-secondary ui-button-small"><Icon name="book" size={17} />{tc("學生進度")}</Link></div></header><div className="flex flex-wrap items-center gap-3"><label className="text-sm font-semibold text-[var(--text)]">{tc("年級")}<select value={grade} onChange={(event) => setGrade(event.target.value)} className="ml-2 h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((item) => <option key={item} value={item}>{tc(GRADE_LABELS[item])}</option>)}</select></label>{unassigned > 0 ? <span className="rounded-full bg-[var(--border-soft)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{tc("未分班學生")} {unassigned}</span> : null}</div>{error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}{loading ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在讀取班級概覽…")}</div> : items.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{tc("目前沒有可查看的班級")}</div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.classId} className="ui-card ui-card-padding"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-[var(--primary)]">{tc(GRADE_LABELS[item.grade])}</p><h2 className="mt-1 text-2xl font-black text-[var(--text)]">{tc(CLASS_LABELS[item.classCode])}{tc("班")}</h2></div><span className="rounded-full bg-[var(--border-soft)] px-2.5 py-1 text-xs font-bold text-[var(--muted)]">{item.studentCount} {tc("人")}</span></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><span className="block text-xs text-[var(--muted)]">{tc("今日活躍")}</span><strong className="text-lg text-[var(--text)]">{item.activeTodayCount}</strong></div><div><span className="block text-xs text-[var(--muted)]">{tc("近7日活躍")}</span><strong className="text-lg text-[var(--text)]">{item.activeSevenDayCount}</strong></div><div><span className="block text-xs text-[var(--muted)]">{tc("平均掌握")}</span><strong className="text-lg text-[var(--primary)]">{item.masteryAveragePercent === null ? "—" : `${item.masteryAveragePercent}%`}</strong></div><div><span className="block text-xs text-[var(--muted)]">{tc("到期學生")}</span><strong className="text-lg text-[var(--text)]">{item.dueStudentCount}</strong></div></div><p className="mt-4 text-xs text-[var(--muted)]">{tc("近7日沒有學習紀錄")} {item.inactiveSevenDayCount} · {tc("已掌握詞")} {item.masteredWordCount}</p><div className="mt-4 flex gap-2"><Link href={`/teacher/roster?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small flex-1">{tc("開啟名冊")}</Link><Link href={`/teacher/progress?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small flex-1">{tc("查看進度")}</Link></div></article>)}</div>}</div>;
}
