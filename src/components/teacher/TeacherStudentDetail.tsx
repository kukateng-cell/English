"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import MetricDefinitionsHelp from "@/components/analytics/MetricDefinitionsHelp";
import Modal from "@/components/admin/Modal";
import CopyButton from "@/components/ui/CopyButton";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorDetails, responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type Student = {
  id: string;
  accountName: string;
  studentNumber: number | null;
  legalName: string;
  nickname: string;
  grade: StudentGrade | null;
  classCode: ClassCode | null;
  canResetStudentPassword: boolean;
  resetRequiresRecentAuth?: boolean;
  resetPrecondition: string | null;
  masteredWords: number;
  totalWords: number;
  masteryPercent: number | null;
  dueReviewCount: number;
  effectiveObjectiveProbeCount: number;
  effectiveReviewEventCount: number;
  todayLearningEncounterCount: number;
  lastActivityAt: string | null;
  byLevel: Array<{ level: string; mastered: number; total: number; progress: number }>;
};

type AnalyticsTimeline = {
  summary: {
    learningEncounterCount: number;
    effectiveReviewCount: number;
    objective: {
      eligibleAttemptCount: number;
      correctCount: number;
      accuracyPercent: number | null;
      accuracyDisplayStatus: string;
    };
    activeDayCount: number;
    eligibleDayCount: number;
  };
  timeline: Array<{
    date: string;
    eligible: boolean;
    learningEncounterCount: number;
    effectiveReviewCount: number;
    objectiveAttemptCount: number;
    objectiveCorrectCount: number;
    objectiveAccuracy: number | null;
    accuracyDisplayStatus: string;
  }>;
};

export default function TeacherStudentDetail({ studentId, from }: { studentId: string; from: string }) {
  const { tc } = useLocale();
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ password?: string; error?: string } | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsTimeline | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [studentRefreshVersion, setStudentRefreshVersion] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`/api/teacher/students/${studentId}`);
        if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
        const payload = await response.json() as { student: Student };
        setStudent(payload.student);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : tc("讀取學生資料失敗"));
      }
    })();
  }, [studentId, studentRefreshVersion, tc]);

  useEffect(() => {
    (async () => {
      try {
        const response = await rosterFetch(`/api/learning-analytics/students/${studentId}/timeline/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) throw new Error(await responseErrorMessage(response));
        const payload = await response.json() as AnalyticsTimeline;
        setAnalytics(payload);
      } catch (cause) {
        setAnalyticsError(cause instanceof Error ? cause.message : tc("讀取學習趨勢失敗"));
      }
    })();
  }, [studentId, tc]);

  async function resetPassword() {
    if (!student?.canResetStudentPassword || !student.resetPrecondition || !window.confirm(tc("確定要重設這位學生的密碼嗎？"))) return;
    setBusy(true);
    setReset(null);
    try {
      const response = await rosterFetch(`/api/teacher/students/${student.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPrecondition: student.resetPrecondition }),
      });
      const details = response.ok ? null : await responseErrorDetails(response, tc);
      const payload = response.ok ? await response.json().catch(() => null) as { temporaryPassword?: string } | null : null;
      setReset(response.ok ? { password: payload?.temporaryPassword ?? "" } : { error: details?.message ?? tc("重設密碼失敗") });
    } catch (cause) {
      setReset({ error: cause instanceof Error ? cause.message : tc("重設密碼失敗") });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!student) return <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在讀取學生資料…")}</div>;

  const backHref = from === "progress" ? "/teacher/progress" : "/teacher/roster";
  const classLabel = student.grade
    ? `${tc(GRADE_LABELS[student.grade])}${student.classCode ? tc(CLASS_LABELS[student.classCode]) : tc("未分班")}`
    : tc("未分配");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={backHref} className="ui-button ui-button-quiet ui-button-small"><Icon name="arrow-left" size={16} />{tc("返回")}</Link>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--text)]">{student.nickname || student.legalName}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{classLabel}</p>
        </div>
        {student.canResetStudentPassword ? <button type="button" disabled={busy} onClick={() => void resetPassword()} className="ui-button ui-button-primary"><Icon name="lock" size={17} />{tc("重設學生密碼")}</button> : null}
      </header>

      {student.resetRequiresRecentAuth ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]"><span>{tc("目前可以查看學生資料；如要重設學生密碼，請先重新驗證身份。")}</span><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => setRecentAuthOpen(true)}>{tc("重新驗證")}</button></div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("真名")}</span><strong className="mt-2 block text-lg text-[var(--text)]">{student.legalName}</strong></div>
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("登入帳號（學生證）")}</span><strong className="mt-2 block text-lg text-[var(--text)]">{student.accountName}</strong></div>
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("學號")}</span><strong className="mt-2 block text-lg text-[var(--text)]">{student.studentNumber ?? tc("未設定")}</strong></div>
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("掌握詞數")}</span><strong className="mt-2 block text-lg text-[var(--primary)]">{student.masteredWords}/{student.totalWords}</strong></div>
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("今日認字")}</span><strong className="mt-2 block text-lg text-[var(--primary)]">{student.todayLearningEncounterCount}{tc("次")}</strong></div>
        <div className="ui-card ui-card-padding"><span className="text-xs text-[var(--muted)]">{tc("待複習詞")}</span><strong className="mt-2 block text-lg text-[var(--primary)]">{student.dueReviewCount}</strong></div>
      </section>

      <section className="ui-card ui-card-padding">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-bold text-[var(--primary)]">{tc("學習摘要")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{student.masteryPercent === null ? "—" : `${student.masteryPercent}%`}</h2></div>
          <p className="text-right text-xs text-[var(--muted)]">{tc("客觀測驗")} {student.effectiveObjectiveProbeCount}<br />{tc("已計入測驗")} {student.effectiveReviewEventCount}<br />{tc("最近學習")} {student.lastActivityAt ? new Date(student.lastActivityAt).toLocaleDateString() : "—"}</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">{student.byLevel.map((level) => <div key={level.level}><div className="flex justify-between text-xs text-[var(--muted)]"><span>{level.level}</span><span>{level.mastered}/{level.total} · {level.progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border-soft)]"><div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${level.progress}%` }} /></div></div>)}</div>
      </section>

      {analyticsError ? <ErrorBanner message={analyticsError} /> : null}
      {analytics ? <section className="ui-card ui-card-padding">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm font-bold text-[var(--primary)]">{tc("期間學習趨勢")}</p><h2 className="mt-1 text-xl font-black text-[var(--text)]">{analytics.summary.activeDayCount}/{analytics.summary.eligibleDayCount} {tc("學習日")}</h2></div>
          <MetricDefinitionsHelp context="trend" />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">{tc("每日認字、已計入測驗及客觀測驗分開計算。")}</p>
        <p className="mt-3 text-right text-xs text-[var(--muted)]">{tc("認字練習")} {analytics.summary.learningEncounterCount} · {tc("已計入測驗")} {analytics.summary.effectiveReviewCount}<br />{tc("客觀測驗")} {analytics.summary.objective.correctCount}/{analytics.summary.objective.eligibleAttemptCount} · {analytics.summary.objective.accuracyPercent === null ? "—" : `${analytics.summary.objective.accuracyPercent}%`}</p>
        <p className="teacher-table-hint">{tc("欄位較多；手機上可左右滑動查看完整資料。")}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] table-fixed text-left text-sm">
            <colgroup><col className="w-[27%]" /><col className="w-[16%]" /><col className="w-[18%]" /><col className="w-[22%]" /><col className="w-[17%]" /></colgroup>
            <caption className="sr-only">{tc("學生每日學習趨勢")}</caption>
            <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="whitespace-nowrap py-2">{tc("日期")}</th><th className="whitespace-nowrap py-2">{tc("認字練習")}</th><th className="whitespace-nowrap py-2">{tc("已計入")}</th><th className="whitespace-nowrap py-2">{tc("答對／作答")}</th><th className="whitespace-nowrap py-2">{tc("正確率")}</th></tr></thead>
            <tbody>{analytics.timeline.map((row) => <tr key={row.date} className="border-b border-[var(--border)] last:border-0"><td className={`py-2 ${row.eligible ? "text-[var(--text)]" : "text-[var(--muted)]"}`}>{row.date}</td><td className="py-2 tabular-nums">{row.learningEncounterCount}</td><td className="py-2 tabular-nums">{row.effectiveReviewCount}</td><td className="py-2 tabular-nums">{row.objectiveCorrectCount}/{row.objectiveAttemptCount}</td><td className="py-2 tabular-nums">{row.objectiveAccuracy === null ? "—" : `${row.objectiveAccuracy}%`}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">{tc("按目前在籍學生計算；只計入已完成的學習活動和測驗。")}</p>
      </section> : null}

      <Modal open={reset !== null} onClose={() => setReset(null)} title={tc("重設學生密碼")}><div className="space-y-4 text-center">{reset?.password ? <><p className="text-sm text-[var(--muted)]">{tc("臨時密碼")}</p><div className="flex flex-wrap items-center justify-center gap-2"><p className="select-all rounded-xl bg-[var(--border-soft)] px-4 py-3 text-2xl font-black tracking-widest text-[var(--primary)]">{reset.password}</p><CopyButton value={reset.password} /></div></> : <p className="text-sm text-[var(--danger)]">{reset?.error}</p>}<button type="button" className="ui-button ui-button-primary w-full" onClick={() => setReset(null)}>{tc("關閉")}</button></div></Modal>
      <RecentAuthDialog open={recentAuthOpen} onClose={() => setRecentAuthOpen(false)} onSuccess={() => { setRecentAuthOpen(false); setStudentRefreshVersion((version) => version + 1); }} />
    </div>
  );
}
