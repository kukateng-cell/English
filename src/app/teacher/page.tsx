"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type ClassSummary = {
  classId: string;
  grade: StudentGrade;
  classCode: ClassCode;
  studentCount: number;
  activeTodayCount: number;
  activeSevenDayCount: number;
  masteredWordCount: number;
  masteryAveragePercent: number | null;
  dueStudentCount: number;
  inactiveSevenDayCount: number;
  totalWords: number;
};

export default function TeacherDashboard() {
  const { tc } = useLocale();
  const [items, setItems] = useState<ClassSummary[]>([]);
  const [grade, setGrade] = useState("");
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await rosterFetch("/api/teacher/class-summary/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: grade || undefined }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = await response.json() as { items: ClassSummary[]; unassignedStudentCount: number };
      setItems(payload.items);
      setUnassigned(payload.unassignedStudentCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("讀取班級概覽失敗"));
    } finally {
      setLoading(false);
    }
  }, [grade, tc]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const overview = useMemo(() => items.reduce((summary, item) => ({
    totalStudents: summary.totalStudents + item.studentCount,
    activeToday: summary.activeToday + item.activeTodayCount,
    activeSevenDay: summary.activeSevenDay + item.activeSevenDayCount,
    dueStudents: summary.dueStudents + item.dueStudentCount,
  }), { totalStudents: 0, activeToday: 0, activeSevenDay: 0, dueStudents: 0 }), [items]);

  const followUpItems = useMemo(() => [...items].sort((left, right) =>
    right.dueStudentCount - left.dueStudentCount ||
    right.inactiveSevenDayCount - left.inactiveSevenDayCount ||
    left.activeSevenDayCount - right.activeSevenDayCount ||
    left.grade.localeCompare(right.grade) ||
    left.classCode.localeCompare(right.classCode),
  ), [items]);

  const classLabel = (item: ClassSummary) => `${tc(GRADE_LABELS[item.grade])}${tc(CLASS_LABELS[item.classCode])}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--primary)]">{tc("教師工作台")}</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("班級概覽")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{tc("快速掌握班級近況；需要深入比較時，請前往學習分析。")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teacher/analytics" className="ui-button ui-button-primary ui-button-small">
            <Icon name="trending-up" size={17} />{tc("查看學習分析")}
          </Link>
          <Link href="/teacher/roster" className="ui-button ui-button-secondary ui-button-small">
            <Icon name="users" size={17} />{tc("查看學生")}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-[var(--text)]">
          {tc("年級")}
          <select value={grade} onChange={(event) => setGrade(event.target.value)} className="ml-2 h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm">
            <option value="">{tc("全部年級")}</option>
            {STUDENT_GRADES.map((item) => <option key={item} value={item}>{tc(GRADE_LABELS[item])}</option>)}
          </select>
        </label>
        {unassigned > 0 ? <span className="rounded-full bg-[var(--border-soft)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">{tc("未分班學生")} {unassigned}</span> : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在讀取班級概覽…")}</div> : items.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{tc("目前沒有可查看的班級")}</div> : <>
        <section aria-label={tc("概覽摘要")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="ui-card ui-card-padding"><p className="text-sm text-[var(--muted)]">{tc("學生總數")}</p><strong className="mt-2 block text-3xl font-black text-[var(--text)]">{overview.totalStudents}</strong><p className="mt-1 text-xs text-[var(--muted)]">{tc("目前獲授權班級")}</p></article>
          <article className="ui-card ui-card-padding"><p className="text-sm text-[var(--muted)]">{tc("今日活躍")}</p><strong className="mt-2 block text-3xl font-black text-[var(--primary)]">{overview.activeToday}</strong><p className="mt-1 text-xs text-[var(--muted)]">{tc("今天有學習紀錄")}</p></article>
          <article className="ui-card ui-card-padding"><p className="text-sm text-[var(--muted)]">{tc("近7日活躍")}</p><strong className="mt-2 block text-3xl font-black text-[var(--text)]">{overview.activeSevenDay}</strong><p className="mt-1 text-xs text-[var(--muted)]">{tc("最近七日有學習紀錄")}</p></article>
          <article className="ui-card ui-card-padding"><p className="text-sm text-[var(--muted)]">{tc("待複習學生")}</p><strong className="mt-2 block text-3xl font-black text-[var(--text)]">{overview.dueStudents}</strong><p className="mt-1 text-xs text-[var(--muted)]">{tc("可在學習分析查看詳情")}</p></article>
        </section>

        <section className="ui-card ui-card-padding">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--primary)]">{tc("班級摘要")}</p>
              <h2 className="mt-1 text-xl font-black text-[var(--text)]">{tc("需要跟進")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{tc("按待複習及近期未學習情況排列；這裡只作快速提示。")}</p>
            </div>
            <Link href="/teacher/analytics" className="ui-button ui-button-secondary ui-button-small">{tc("查看完整分析")}</Link>
          </div>

          <div className="mt-5 hidden border-y border-[var(--border)] py-3 text-xs font-semibold text-[var(--muted)] md:grid md:grid-cols-[minmax(150px,1.4fr)_minmax(64px,0.7fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(150px,1.2fr)] md:items-center md:gap-3">
            <span>{tc("班級")}</span><span>{tc("學生")}</span><span>{tc("近7日活躍")}</span><span>{tc("待複習")}</span><span>{tc("7日未學習")}</span><span>{tc("操作")}</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {followUpItems.map((item) => <div key={item.classId} className="grid gap-3 py-4 md:grid-cols-[minmax(150px,1.4fr)_minmax(64px,0.7fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(90px,0.9fr)_minmax(150px,1.2fr)] md:items-center md:gap-3">
              <div><p className="font-bold text-[var(--text)]">{classLabel(item)}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.masteryAveragePercent === null ? "—" : `${item.masteryAveragePercent}%`} {tc("平均掌握")}</p></div>
              <div><span className="text-xs text-[var(--muted)] md:hidden">{tc("學生")}</span><strong className="md:block">{item.studentCount}</strong></div>
              <div><span className="text-xs text-[var(--muted)] md:hidden">{tc("近7日活躍")}</span><strong className="md:block">{item.activeSevenDayCount}/{item.studentCount}</strong></div>
              <div><span className="text-xs text-[var(--muted)] md:hidden">{tc("待複習")}</span><strong className="md:block">{item.dueStudentCount}</strong></div>
              <div><span className="text-xs text-[var(--muted)] md:hidden">{tc("7日未學習")}</span><strong className="md:block">{item.inactiveSevenDayCount}</strong></div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/teacher/analytics?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-secondary ui-button-small">{tc("查看分析")}</Link>
                <Link href={`/teacher/roster?classId=${item.classId}&grade=${item.grade}`} className="ui-button ui-button-quiet ui-button-small">{tc("查看學生")}</Link>
              </div>
            </div>)}
          </div>
        </section>
      </>}
    </div>
  );
}
