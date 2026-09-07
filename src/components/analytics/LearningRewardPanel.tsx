"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import ErrorBanner from "@/components/ErrorBanner";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorDetails, responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import { formatRewardMilliPoints, REWARD_POLICY_VERSION, type RewardWeights } from "@/lib/learning-reward-policy";
import type { RewardCoverage, RewardDay, RewardQueryResult, RewardStudentTotal, RewardTimelineResult } from "@/lib/learning-reward-analytics";
import type { TeacherWorkspaceAcademicYearDto } from "@/lib/teacher-workspace";

type Role = "TEACHER" | "ADMIN";
type ClassOption = { id: string; grade: StudentGrade; classCode: ClassCode | string; label?: string };
type AcademicYearInfo = TeacherWorkspaceAcademicYearDto;
type ClassesPayload = { items: ClassOption[]; academicYear?: AcademicYearInfo; unassignedStudentCount?: number };

type RewardRequestBody = {
  range: { fromDate: string; toDate: string };
  grade?: string;
  classIds?: string[];
  weights: RewardWeights;
  policyVersion: typeof REWARD_POLICY_VERSION;
  limit?: number;
  cursor?: string;
  asOf?: string;
  scopeToken?: string;
  search?: string;
  format?: "CSV" | "XLSX";
};

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isLocalDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat("zh-Hant", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function scoreText(milliPoints: number | null | undefined) {
  const value = formatRewardMilliPoints(milliPoints ?? null);
  return value === null ? "—" : value.toFixed(3);
}

function countText(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

function classText(item: ClassOption, tc: (value: string) => string) {
  const classLabel = CLASS_LABELS[item.classCode as ClassCode];
  return classLabel ? `${tc(GRADE_LABELS[item.grade])}${tc(classLabel)}${tc("班")}` : item.label ?? `${item.grade}:${item.classCode}`;
}

function coverageText(coverage: RewardCoverage, tc: (value: string) => string) {
  const candidateCount = coverage.sources.encounters.candidateCount + coverage.sources.reviews.candidateCount;
  const labels: string[] = [];
  if (candidateCount === 0) labels.push(tc("目前未有可計紀錄"));
  if (coverage.policyExcludedCount > 0) labels.push(tc("有非本政策活動"));
  if (coverage.validationGapCount > 0) labels.push(tc("待核對"));
  if (coverage.historyCoverage === "KNOWN_GAP") labels.push(tc("歷史有缺口"));
  if (coverage.historyCoverage === "NOT_GUARANTEED") labels.push(tc("未保證完整歷史"));
  if (coverage.warningCodes.includes("ENROLLMENT_STARTED_AT_MISSING")) labels.push(tc("入籍日期未記錄"));
  if (labels.length === 0 && coverage.warningCodes.length > 0) labels.push(`${tc("有提示")} (${coverage.warningCodes.length})`);
  return labels.length > 0 ? labels.join("；") : tc("已核對");
}

function accuracyText(status: RewardStudentTotal["accuracyStatus"], tc: (value: string) => string) {
  if (status === "NO_DATA") return tc("未有客觀作答");
  if (status === "SMALL_SAMPLE") return tc("樣本較少");
  return tc("已有作答資料");
}

function levelText(total: RewardStudentTotal) {
  return (["A1", "A2", "B1", "B2"] as const).map((level) => {
    const counts = total.levelCounts[level];
    return [level, counts.correct + "/" + counts.attempts].join(" ");
  }).join(" · ");
}

function requestErrorMessage(response: Response, tc: (value: string) => string) {
  return responseErrorDetails(response, tc).then((details) => details.message);
}

export default function LearningRewardPanel({ role, onBack }: { role: Role; onBack: () => void }) {
  const { tc } = useLocale();
  const tcRef = useRef(tc);
  useEffect(() => { tcRef.current = tc; }, [tc]);
  const today = useMemo(() => localDateKey(), []);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [academicYear, setAcademicYear] = useState<AcademicYearInfo | null>(null);
  const [unassignedStudentCount, setUnassignedStudentCount] = useState(0);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [grade, setGrade] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [weights, setWeights] = useState<RewardWeights>({ effort: 50, outcome: 50 });
  const [result, setResult] = useState<RewardQueryResult | null>(null);
  const [timeline, setTimeline] = useState<RewardTimelineResult | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [exporting, setExporting] = useState<"CSV" | "XLSX" | null>(null);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<"CSV" | "XLSX" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(true);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const queryAbortRef = useRef<AbortController | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const queryGenerationRef = useRef(0);
  const timelineGenerationRef = useRef(0);
  const exportGenerationRef = useRef(0);
  const rangeInitializedRef = useRef(false);
  const rangeEditedRef = useRef(false);

  const invalidateRequests = useCallback(() => {
    queryGenerationRef.current += 1;
    timelineGenerationRef.current += 1;
    exportGenerationRef.current += 1;
    queryAbortRef.current?.abort();
    timelineAbortRef.current?.abort();
    exportAbortRef.current?.abort();
  }, []);

  function markFiltersChanged() {
    invalidateRequests();
    setDirty(true); setResult(null); setTimeline(null); setExpandedStudentId(null); setLoading(false); setTimelineLoading(false); setExporting(null);
  }

  const visibleClasses = useMemo(() => classes.filter((item) => !grade || item.grade === grade), [classes, grade]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingClasses(true);
      try {
        const response = await fetch("/api/teacher/classes", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(await responseErrorMessage(response, tcRef.current));
        const payload = await response.json() as ClassesPayload;
        if (!active) return;
        setClasses(payload.items ?? []);
        setUnassignedStudentCount(payload.unassignedStudentCount ?? 0);
        if (payload.academicYear) {
          setAcademicYear(payload.academicYear);
          if (!rangeInitializedRef.current) {
            rangeInitializedRef.current = true;
            const startsOn = payload.academicYear.startsOn;
            const endsOn = payload.academicYear.endsOn;
            if (!rangeEditedRef.current && isLocalDateKey(startsOn) && isLocalDateKey(endsOn)) {
              setFromDate(startsOn);
              setToDate(endsOn < today ? endsOn : today);
            }
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : tcRef.current("讀取班級資料失敗"));
      } finally {
        if (active) setLoadingClasses(false);
      }
    })();
    return () => { active = false; };
  }, [today]);

  useEffect(() => () => {
    invalidateRequests();
  }, [invalidateRequests]);

  function changeRange(nextFrom: string, nextTo: string) {
    rangeEditedRef.current = true;
    setFromDate(nextFrom); setToDate(nextTo); markFiltersChanged();
  }

  function changeGrade(value: string) {
    setGrade(value); setSelectedClassIds([]); markFiltersChanged();
  }

  function changeWeights(effort: number) {
    const nextEffort = Math.min(100, Math.max(0, Math.round(effort)));
    setWeights({ effort: nextEffort, outcome: 100 - nextEffort });
    markFiltersChanged();
  }

  function toggleClass(id: string) {
    setSelectedClassIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    markFiltersChanged();
  }

  function changeClass(id: string) {
    setSelectedClassIds(id ? [id] : []);
    markFiltersChanged();
  }

  const makeRequest = useCallback((extra: Partial<RewardRequestBody> = {}): RewardRequestBody => ({
    range: { fromDate, toDate },
    ...(grade ? { grade } : {}),
    ...(selectedClassIds.length ? { classIds: selectedClassIds } : {}),
    ...(studentSearch.trim() ? { search: studentSearch.trim() } : {}),
    weights,
    policyVersion: REWARD_POLICY_VERSION,
    ...extra,
  }), [fromDate, grade, selectedClassIds, studentSearch, toDate, weights]);

  const runQuery = useCallback(async (cursor?: string, append = false) => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setError(tc("日期範圍不正確，請重新選擇"));
      return;
    }
    queryAbortRef.current?.abort();
    const controller = new AbortController();
    queryAbortRef.current = controller;
    const generation = ++queryGenerationRef.current;
    setLoading(true); setError(null);
    try {
      const extra = cursor && result ? { cursor, asOf: result.asOf, scopeToken: result.scopeToken, limit: 50 } : { limit: 50 };
      const response = await rosterFetch("/api/learning-analytics/rewards/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest(extra)), signal: controller.signal });
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      if (!response.ok) throw new Error(await requestErrorMessage(response, tc));
      const next = await response.json() as RewardQueryResult;
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      setResult((current) => append && current ? { ...next, items: [...current.items, ...next.items] } : next);
      setTimeline(null); setExpandedStudentId(null); setDirty(false);
    } catch (cause) {
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : tc("計算學習累積分失敗"));
    } finally {
      if (generation === queryGenerationRef.current) setLoading(false);
      if (queryAbortRef.current === controller) queryAbortRef.current = null;
    }
  }, [fromDate, makeRequest, result, tc, toDate]);

  const openTimeline = useCallback(async (studentId: string) => {
    if (!result) return;
    timelineAbortRef.current?.abort();
    const generation = ++timelineGenerationRef.current;
    if (expandedStudentId === studentId) { setExpandedStudentId(null); setTimeline(null); setTimelineLoading(false); return; }
    const controller = new AbortController();
    timelineAbortRef.current = controller;
    setExpandedStudentId(studentId); setTimeline(null); setTimelineLoading(true); setError(null);
    try {
      const response = await rosterFetch(`/api/learning-analytics/rewards/students/${encodeURIComponent(studentId)}/timeline/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest({ asOf: result.asOf, scopeToken: result.scopeToken })), signal: controller.signal });
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      if (!response.ok) throw new Error(await requestErrorMessage(response, tc));
      const next = await response.json() as RewardTimelineResult;
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      setTimeline(next);
    } catch (cause) {
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      setTimeline(null);
      setError(cause instanceof Error ? cause.message : tc("讀取學生每日明細失敗"));
    } finally {
      if (generation === timelineGenerationRef.current) setTimelineLoading(false);
      if (timelineAbortRef.current === controller) timelineAbortRef.current = null;
    }
  }, [expandedStudentId, makeRequest, result, tc]);

  async function exportReport(format: "CSV" | "XLSX") {
    if (!result) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    const generation = ++exportGenerationRef.current;
    setExporting(format); setError(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/rewards/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest({ asOf: result.asOf, scopeToken: result.scopeToken, format })), signal: controller.signal });
      if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      if (!response.ok) {
        const details = await responseErrorDetails(response, tc);
        if (details.code === "RECENT_AUTH_REQUIRED") { setPendingExport(format); setRecentAuthOpen(true); return; }
        throw new Error(details.message);
      }
      const blob = await response.blob();
      if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `learning-reward-${fromDate}-${toDate}-${format.toLowerCase()}.${format === "CSV" ? "csv" : "xlsx"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : tc("匯出學習累積分失敗"));
    } finally {
      if (generation === exportGenerationRef.current) setExporting(null);
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  }

  const selectedClassLabel = selectedClassIds.length === 0
    ? `${tc("全部班別")}${role === "ADMIN" && !grade && unassignedStudentCount > 0 ? ` · ${tc("未分班")} ${unassignedStudentCount}` : ""}`
    : selectedClassIds.map((id) => { const item = classes.find((candidate) => candidate.id === id); return item ? classText(item, tc) : id; }).join("、");

  return <div className="space-y-5">
    <header className="analytics-page-header flex flex-wrap items-end justify-between gap-3">
      <div><button type="button" className="mb-2 text-sm font-semibold text-[var(--primary)]" onClick={onBack}>← {tc("返回學習分析")}</button><h1 className="text-3xl font-black tracking-tight text-[var(--text)]">{tc("學習累積分")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc(role === "ADMIN" ? "管理員報告：按目前在籍學生及可核對的學習紀錄計算。" : "按目前在籍學生及可核對的學習紀錄計算；每個本地日分別計入投入與成效。")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("分數只作教師獎勵參考，不代表能力、掌握度或排名；客觀正確率獨立顯示。")}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={!result || exporting !== null} onClick={() => void exportReport("CSV")}>{exporting === "CSV" ? tc("匯出中…") : tc("匯出 CSV")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={!result || exporting !== null} onClick={() => void exportReport("XLSX")}>{exporting === "XLSX" ? tc("匯出中…") : tc("匯出 Excel")}</button></div>
    </header>

    <section className="ui-card ui-card-padding space-y-4" aria-labelledby="reward-filter-title">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="reward-filter-title" className="text-lg font-bold text-[var(--text)]">{tc("報告條件")}</h2><span className="text-xs text-[var(--muted)]">{academicYear ? `${academicYear.label} · ${tc("時區")} Asia/Shanghai` : tc("正在載入學年…")}</span></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("開始日期")}<input type="date" value={fromDate} max={toDate} onChange={(event) => changeRange(event.target.value, toDate)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("結束日期")}<input type="date" value={toDate} min={fromDate} max={today} onChange={(event) => changeRange(fromDate, event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("年級")}<select value={grade} onChange={(event) => changeGrade(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((value) => <option key={value} value={value}>{tc(GRADE_LABELS[value])}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("班別")}<select value={selectedClassIds.length === 1 ? selectedClassIds[0] : ""} onChange={(event) => changeClass(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{selectedClassIds.length > 1 ? tc("多個班別") : tc("全部班別")}</option>{visibleClasses.map((item) => <option key={item.id} value={item.id}>{classText(item, tc)}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("搜尋學生")}<input type="search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); markFiltersChanged(); }} placeholder={tc("姓名、帳戶或學號")} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
      </div>
      {visibleClasses.length > 1 ? <div className="flex flex-wrap gap-2" aria-label={tc("班別多選")}>{visibleClasses.map((item) => <button key={item.id} type="button" aria-pressed={selectedClassIds.includes(item.id)} onClick={() => toggleClass(item.id)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selectedClassIds.includes(item.id) ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`}>{classText(item, tc)}</button>)}</div> : null}
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] p-3 md:grid-cols-[minmax(0,1fr)_120px_120px_120px] md:items-end"><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("投入／成效權重")}<input aria-label={tc("投入權重滑桿")} type="range" min="0" max="100" step="5" value={weights.effort} onChange={(event) => changeWeights(Number(event.target.value))} /></label><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("投入")}<input type="number" min="0" max="100" step="5" value={weights.effort} onChange={(event) => changeWeights(Number(event.target.value))} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("成效")}<input type="number" min="0" max="100" step="5" value={weights.outcome} onChange={(event) => changeWeights(100 - Number(event.target.value))} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label><p className="text-xs text-[var(--muted)]">{tc("合計")}：<strong>{weights.effort + weights.outcome}%</strong></p></div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><span>{tc("快速設定")}</span>{([70, 50, 30] as const).map((effort) => <button key={effort} type="button" className={`rounded-lg border px-2.5 py-1.5 font-semibold ${weights.effort === effort ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)]"}`} onClick={() => changeWeights(effort)}>{effort}/{100 - effort}</button>)}</div>
      <p className="text-xs text-[var(--muted)]">{tc("每日投入最多計 20 次活動；每日首次成功詞義最多計 5 個。原始數量及封頂後數量會同時保留。")}</p>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className="ui-button ui-button-primary" disabled={loading || loadingClasses || !fromDate || !toDate} onClick={() => void runQuery()}>{loading ? tc("計算中…") : tc("計算累積分")}</button>{dirty && result ? <span className="text-xs text-[var(--muted)]">{tc("條件已更改，請重新計算")}</span> : null}<span className="text-xs text-[var(--muted)]">{selectedClassLabel}</span></div>
    </section>

    {error ? <ErrorBanner message={error} onRetry={() => void runQuery()} /> : null}
    {result ? <>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]"><div className="flex flex-wrap gap-x-4 gap-y-1"><span>{tc("有效期間")}：{result.effectiveRange.from} 至 {result.effectiveRange.to}</span><span>{tc("學生數")}：{result.totalStudentCount}</span><span>{tc("權重")}：{result.policy.weights.effort}/{result.policy.weights.outcome}</span><span>{tc("資料截點")}：{formatAsOf(result.asOf)}（Asia/Shanghai）</span></div>{result.effectiveRange.rangeClamped ? <p className="mt-1 text-xs">{tc("日期已按目前學年及今天調整。")}</p> : null}</section>
      {result.coverageSummary.studentsWithValidationGaps > 0 || result.coverageSummary.studentsWithKnownHistoryGaps > 0 || result.coverageSummary.studentsWithPolicyExclusions > 0 ? <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"><strong>{tc("資料覆蓋提示")}</strong><p className="mt-1 text-xs">{tc("部分學生的紀錄含政策排除、歷史缺口或未能完整核對的來源；報告沒有把未知資料當成零分，請查看學生明細及匯出檔的 coverage 欄位。")}</p></div> : null}
      <section className="ui-card ui-card-padding" aria-labelledby="reward-students-title">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="reward-students-title" className="text-lg font-bold text-[var(--text)]">{tc("學生累積分")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{tc("點選學生可查看每日分數、封頂及資料覆蓋。分數保留三位小數。")}</p></div>{result.nextCursor ? <button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={loading} onClick={() => void runQuery(result.nextCursor!, true)}>{loading ? tc("載入中…") : tc("載入更多")}</button> : null}</div>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[1440px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th scope="col" className="py-2">{tc("學生")}</th><th scope="col" className="px-3 py-2">{tc("合資格／活躍日")}</th><th scope="col" className="px-3 py-2">{tc("投入（原始／計入）")}</th><th scope="col" className="px-3 py-2">{tc("成效（原始／計入）")}</th><th scope="col" className="px-3 py-2">{tc("累積分")}</th><th scope="col" className="px-3 py-2">{tc("作答／答對")}</th><th scope="col" className="px-3 py-2">{tc("正確率／樣本")}</th><th scope="col" className="px-3 py-2">{tc("程度（答對／作答）")}</th><th scope="col" className="px-3 py-2">{tc("資料狀態")}</th></tr></thead>
            <tbody>{result.items.map((item) => { const timelineId = "reward-timeline-" + encodeURIComponent(item.studentId); const expanded = expandedStudentId === item.studentId; return <Fragment key={item.studentId}><tr className="border-b border-[var(--border)] last:border-0"><td className="py-3"><button type="button" aria-expanded={expanded} aria-controls={timelineId} className="text-left font-semibold text-[var(--text)] hover:text-[var(--primary)]" onClick={() => void openTimeline(item.studentId)}>{item.studentNumber === null ? "" : String(item.studentNumber) + " · "}{item.nickname || item.legalName || item.accountName}<small className="mt-0.5 block text-xs font-normal text-[var(--muted)]">{item.classLabel}</small></button></td><td className="px-3 py-3 tabular-nums">{item.eligibleDayCount} / {item.activeDayCount}</td><td className="px-3 py-3 tabular-nums">{item.effortActivityCount} / {item.creditedEffortActivityCount}</td><td className="px-3 py-3 tabular-nums">{item.firstCorrectSenseDayCount} / {item.creditedFirstCorrectSenseDayCount}</td><td className="px-3 py-3 font-bold tabular-nums text-[var(--primary)]">{scoreText(item.scores?.weightedMilliPoints)}</td><td className="px-3 py-3 tabular-nums">{item.objectiveAttemptCount} / {item.objectiveCorrectCount}</td><td className="px-3 py-3 tabular-nums">{item.objectiveAccuracyPercent === null ? "—" : String(item.objectiveAccuracyPercent) + "%"}<small className="mt-0.5 block text-xs font-normal text-[var(--muted)]">{accuracyText(item.accuracyStatus, tc)}</small></td><td className="px-3 py-3 text-xs tabular-nums">{levelText(item)}</td><td className="px-3 py-3 text-xs text-[var(--muted)]">{coverageText(item.coverage, tc)}</td></tr>{expanded ? <tr id={timelineId}><td colSpan={9} role="region" aria-label={tc("學生每日明細")} className="border-b border-[var(--border)] bg-[var(--surface)] p-3">{timelineLoading ? <p className="text-sm text-[var(--muted)]" role="status">{tc("正在載入每日明細…")}</p> : timeline?.student.studentId === item.studentId ? <RewardTimelineTable key={item.studentId} timeline={timeline} tc={tc} /> : <p className="text-sm text-[var(--muted)]">{tc("未有每日明細。")}</p>}</td></tr> : null}</Fragment>; })}</tbody>
          </table>
          {result.items.length === 0 ? <p className="py-10 text-center text-sm text-[var(--muted)]">{tc("目前範圍沒有在籍學生。")}</p> : null}
        </div>
      </section>
    </> : !loading && !loadingClasses ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("設定條件後按「計算累積分」。")}</div> : null}
    <RecentAuthDialog open={recentAuthOpen} onClose={() => { setRecentAuthOpen(false); setPendingExport(null); }} onSuccess={() => { setRecentAuthOpen(false); const pending = pendingExport; setPendingExport(null); if (pending) void exportReport(pending); }} />
  </div>;
}

function levelSummary(day: RewardDay) {
  return (["A1", "A2", "B1", "B2"] as const).map((level) => {
    const counts = day.levelCounts?.[level];
    return [level, counts ? counts.correct + "/" + counts.attempts : "—"].join(" ");
  }).join(" · ");
}

function RewardTimelineTable({ timeline, tc }: { timeline: RewardTimelineResult; tc: (value: string) => string }) {
  const pageSize = 31;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(timeline.days.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageDays = timeline.days.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return <div>
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      <span>{tc("學生")}: {timeline.student.nickname || timeline.student.legalName || timeline.student.accountName}</span>
      <span>{tc("合資格／活躍日")}: {timeline.student.eligibleDayCount} / {timeline.student.activeDayCount}</span>
      <span>{tc("原始／計入投入")}: {timeline.student.effortActivityCount} / {timeline.student.creditedEffortActivityCount}</span>
      <span>{tc("原始／計入首次答對詞義")}: {timeline.student.firstCorrectSenseDayCount} / {timeline.student.creditedFirstCorrectSenseDayCount}</span>
      <span>{tc("投入封頂日")}: {timeline.student.effortCapDays} ({timeline.student.effortCapDayPercent === null ? "—" : String(timeline.student.effortCapDayPercent) + "%"})</span>
      <span>{tc("成效封頂日")}: {timeline.student.outcomeCapDays} ({timeline.student.outcomeCapDayPercent === null ? "—" : String(timeline.student.outcomeCapDayPercent) + "%"})</span>
      <span>{tc("程度（答對／作答）")}: {levelText(timeline.student)}</span>
    </div>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
      {pageCount > 1 ? <><span>{tc("每日明細頁")} {safePage + 1}/{pageCount}</span><span className="flex gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{tc("上一頁")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={safePage + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>{tc("下一頁")}</button></span></> : <span>{tc("每日明細")}</span>}
    </div>
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full min-w-[1360px] text-left text-xs">
        <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"><tr><th scope="col" className="py-2">{tc("日期")}</th><th scope="col" className="px-2 py-2">{tc("認字卡")}</th><th scope="col" className="px-2 py-2">{tc("客觀題")}</th><th scope="col" className="px-2 py-2">{tc("答對")}</th><th scope="col" className="px-2 py-2">{tc("首次答對詞義（原始／計入）")}</th><th scope="col" className="px-2 py-2">{tc("程度（答對／作答）")}</th><th scope="col" className="px-2 py-2">{tc("投入（原始／計入）")}</th><th scope="col" className="px-2 py-2">{tc("投入分")}</th><th scope="col" className="px-2 py-2">{tc("成效分")}</th><th scope="col" className="px-2 py-2">{tc("當日加權分")}</th><th scope="col" className="px-2 py-2">{tc("投入累積")}</th><th scope="col" className="px-2 py-2">{tc("成效累積")}</th><th scope="col" className="px-2 py-2">{tc("加權累積")}</th><th scope="col" className="px-2 py-2">{tc("正確率／樣本")}</th><th scope="col" className="px-2 py-2">{tc("狀態")}</th></tr></thead>
        <tbody>{pageDays.map((day: RewardDay) => <tr key={day.date} className="border-b border-[var(--border)] last:border-0"><td className="py-2 tabular-nums">{day.date}</td><td className="px-2 py-2">{countText(day.learningCardCount)}</td><td className="px-2 py-2">{countText(day.objectiveAttemptCount)}</td><td className="px-2 py-2">{countText(day.objectiveCorrectCount)}</td><td className="px-2 py-2">{countText(day.firstCorrectSenseCount)} / {countText(day.creditedFirstCorrectSenseCount)}</td><td className="px-2 py-2 whitespace-nowrap">{levelSummary(day)}</td><td className="px-2 py-2">{countText(day.effortActivityCount)} / {countText(day.creditedEffortActivityCount)}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.scores?.effortMilliPoints)}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.scores?.outcomeMilliPoints)}</td><td className="px-2 py-2 font-semibold tabular-nums text-[var(--primary)]">{scoreText(day.scores?.weightedMilliPoints)}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.cumulative?.effortMilliPoints)}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.cumulative?.outcomeMilliPoints)}</td><td className="px-2 py-2 font-semibold tabular-nums text-[var(--primary)]">{scoreText(day.cumulative?.weightedMilliPoints)}</td><td className="px-2 py-2 tabular-nums">{day.objectiveAccuracyPercent === null ? "—" : String(day.objectiveAccuracyPercent) + "%"}<small className="mt-0.5 block text-[var(--muted)]">{accuracyText(day.accuracyStatus, tc)}</small></td><td className="px-2 py-2 text-[var(--muted)]">{day.eligible ? coverageText(day.coverage, tc) : tc("未在籍／入籍前")}</td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}
