"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ClassCode, StudentGrade } from "@/generated/prisma";
import ErrorBanner from "@/components/ErrorBanner";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import { useLocale } from "@/components/LocaleProvider";
import { networkErrorMessage, responseErrorDetails, responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/http-client";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import { formatRewardMilliPoints, REWARD_POLICY_VERSION, type RewardWeights } from "@/lib/learning-reward-policy";
import type { RewardCoverage, RewardDay, RewardQueryResult, RewardStudentTotal, RewardTimelineResult } from "@/lib/learning-reward-analytics";
import type { TeacherWorkspaceAcademicYearDto } from "@/lib/teacher-workspace";

type Role = "TEACHER" | "ADMIN";
type ExportFormat = "CSV" | "XLSX" | "DAILY_XLSX";
type ClassOption = { id: string; grade: StudentGrade; classCode: ClassCode | string; label?: string };
type AcademicYearInfo = TeacherWorkspaceAcademicYearDto;
type SubmittedRewardScope = { classIds: string[]; grade: string };
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
  format?: ExportFormat;
};

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function monthRange(today: string, offset: number) {
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: offset === 0 ? today : last.toISOString().slice(0, 10) };
}

function isLocalDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat("zh-Hant", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function scoreText(milliPoints: number | null | undefined) {
  const value = formatRewardMilliPoints(milliPoints ?? null);
  return value === null ? "—" : value.toFixed(3);
}

function classText(item: ClassOption, tc: (value: string) => string) {
  const classLabel = CLASS_LABELS[item.classCode as ClassCode];
  return classLabel ? `${tc(GRADE_LABELS[item.grade])}${tc(classLabel)}${tc("班")}` : item.label ?? `${item.grade}:${item.classCode}`;
}

function studentName(item: RewardStudentTotal) {
  return item.legalName.trim() || item.nickname.trim() || item.accountName;
}

function candidateCount(coverage: RewardCoverage) {
  return coverage.sources.encounters.candidateCount + coverage.sources.reviews.candidateCount;
}

function friendlyNote(total: RewardStudentTotal, tc: (value: string) => string) {
  if (total.eligibleDayCount === 0) return tc("此期間未在籍");
  if (total.coverage.validationGapCount > 0 || total.coverage.historyCoverage === "KNOWN_GAP") return tc("部分紀錄未能核對，分數可能受影響");
  if (total.coverage.policyExcludedCount > 0) return tc("部分活動不計入本次分數");
  if (candidateCount(total.coverage) === 0) return tc("這段期間未有可計分的學習紀錄");
  return "";
}

function reportWarning(result: RewardQueryResult, tc: (value: string) => string) {
  const coverage = result.coverageSummary.combined;
  if (coverage.validationGapCount > 0 || coverage.historyCoverage === "KNOWN_GAP") return tc("部分學生有未能計入的紀錄，分數可能受影響。請查看受影響學生旁的提示。");
  if (coverage.policyExcludedCount > 0) return tc("部分活動不計入本次分數；已按目前保存的學習紀錄計算。");
  return "";
}

function requestErrorMessage(response: Response, tc: (value: string) => string) {
  return responseErrorDetails(response, tc).then((details) => details.message);
}

function presetRangeMessage(value: "month" | "lastMonth", range: { from: string; to: string }, academicYear: AcademicYearInfo | null, today: string, tc: (value: string) => string) {
  if (!academicYear) return null;
  const effectiveEnd = academicYear.endsOn < today ? academicYear.endsOn : today;
  if (range.to >= academicYear.startsOn && range.from <= effectiveEnd) return null;
  return tc(value === "month" ? "本月不在目前學年範圍內，請選擇本學年至今或自訂日期。" : "上月不在目前學年範圍內，請選擇本學年至今或自訂日期。");
}

function downloadFilename(response: Response, fallback: string) {
  const header = response.headers.get("Content-Disposition");
  const match = header?.match(/filename="([^"]+)"/u);
  return match?.[1] ?? fallback;
}

function scoreCard(label: string, value: string, emphasis = false) {
  return <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 ${emphasis ? "ring-1 ring-[var(--primary)]/30" : ""}`}><p className="text-xs text-[var(--muted)]">{label}</p><strong className={`mt-1 block tabular-nums text-xl ${emphasis ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{value}</strong></div>;
}

function RewardTimelineTable({ timeline, tc }: { timeline: RewardTimelineResult; tc: (value: string) => string }) {
  const pageSize = 31;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(timeline.days.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageDays = timeline.days.slice(safePage * pageSize, (safePage + 1) * pageSize);
  return <div>
    <div className="mb-4"><h3 className="text-base font-bold text-[var(--text)]">{studentName(timeline.student)}{tc("的每日分數")}</h3><div className="mt-3 grid gap-2 sm:grid-cols-3">{scoreCard(tc("累積投入分"), scoreText(timeline.student.scores?.effortMilliPoints))}{scoreCard(tc("累積成效分"), scoreText(timeline.student.scores?.outcomeMilliPoints))}{scoreCard(tc("累積總分"), scoreText(timeline.student.scores?.weightedMilliPoints), true)}</div></div>
    <p className="mb-3 text-xs text-[var(--muted)]">{tc("每日分數按當日投入／成效計算；未在籍日期以空值顯示。")}</p>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">{pageCount > 1 ? <><span>{tc("每日分數頁")} {safePage + 1}/{pageCount}</span><span className="flex gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{tc("上一頁")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={safePage + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>{tc("下一頁")}</button></span></> : <span>{tc("每日分數")}</span>}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"><tr><th scope="col" className="py-2">{tc("日期")}</th><th scope="col" className="px-2 py-2">{tc("當日投入分")}</th><th scope="col" className="px-2 py-2">{tc("當日成效分")}</th><th scope="col" className="px-2 py-2">{tc("當日總分")}</th></tr></thead><tbody>{pageDays.map((day: RewardDay) => <tr key={day.date} className="border-b border-[var(--border)] last:border-0"><td className="py-2 tabular-nums">{day.date}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.scores?.effortMilliPoints)}</td><td className="px-2 py-2 tabular-nums">{scoreText(day.scores?.outcomeMilliPoints)}</td><td className="px-2 py-2 font-semibold tabular-nums text-[var(--primary)]">{scoreText(day.scores?.weightedMilliPoints)}</td></tr>)}</tbody></table></div>
  </div>;
}

function RewardStudentResults({ items, expandedStudentId, timeline, timelineLoading, timelineError, openTimeline, disabled, tc }: { items: RewardStudentTotal[]; expandedStudentId: string | null; timeline: RewardTimelineResult | null; timelineLoading: boolean; timelineError: string | null; openTimeline: (studentId: string) => void; disabled?: boolean; tc: (value: string) => string }) {
  return <>
    <div className="mt-4 hidden overflow-x-auto xl:block">
      <table className="w-full min-w-[780px] text-left text-sm"><caption className="sr-only">{tc("學生累積分")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th scope="col" className="py-2">{tc("班級")}</th><th scope="col" className="px-3 py-2">{tc("學號")}</th><th scope="col" className="px-3 py-2">{tc("姓名")}</th><th scope="col" className="px-3 py-2">{tc("累積投入分")}</th><th scope="col" className="px-3 py-2">{tc("累積成效分")}</th><th scope="col" className="px-3 py-2">{tc("累積總分")}</th></tr></thead><tbody>{items.map((item) => { const expanded = expandedStudentId === item.studentId; const timelineId = `reward-timeline-${encodeURIComponent(item.studentId)}`; return <Fragment key={item.studentId}><tr className="border-b border-[var(--border)] last:border-0"><td className="py-3 text-[var(--muted)]">{item.classLabel}</td><td className="px-3 py-3 tabular-nums text-[var(--muted)]">{item.studentNumber ?? "—"}</td><td className="px-3 py-3"><button type="button" disabled={disabled} aria-expanded={expanded} aria-controls={timelineId} className="text-left font-semibold text-[var(--text)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60" onClick={() => openTimeline(item.studentId)}>{studentName(item)}<small className="mt-0.5 block text-xs font-normal text-[var(--muted)]">{item.accountName}{friendlyNote(item, tc) ? ` · ${friendlyNote(item, tc)}` : ""}</small></button></td><td className="px-3 py-3 tabular-nums">{scoreText(item.scores?.effortMilliPoints)}</td><td className="px-3 py-3 tabular-nums">{scoreText(item.scores?.outcomeMilliPoints)}</td><td className="px-3 py-3 font-bold tabular-nums text-[var(--primary)]">{scoreText(item.scores?.weightedMilliPoints)}</td></tr>{expanded ? <tr id={timelineId}><td colSpan={6} role="region" aria-label={tc("學生每日分數")} className="border-b border-[var(--border)] bg-[var(--surface)] p-3">{timelineLoading ? <p className="text-sm text-[var(--muted)]" role="status">{tc("正在載入每日分數…")}</p> : timelineError ? <p className="text-sm text-[var(--danger)]">{timelineError}</p> : timeline?.student.studentId === expandedStudentId ? <RewardTimelineTable timeline={timeline} tc={tc} /> : <p className="text-sm text-[var(--muted)]">{tc("未有每日分數。")}</p>}</td></tr> : null}</Fragment>; })}</tbody></table>
    </div>
    <div className="grid gap-3 xl:hidden">{items.map((item) => { const expanded = expandedStudentId === item.studentId; const timelineId = `reward-timeline-mobile-${encodeURIComponent(item.studentId)}`; return <article key={item.studentId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><button type="button" disabled={disabled} aria-expanded={expanded} aria-controls={timelineId} className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60" onClick={() => openTimeline(item.studentId)}><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--text)]">{studentName(item)}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.classLabel} · {item.studentNumber ?? "—"} · {item.accountName}</p></div><div className="text-right"><span className="block text-xs text-[var(--muted)]">{tc("累積總分")}</span><strong className="tabular-nums text-xl text-[var(--primary)]">{scoreText(item.scores?.weightedMilliPoints)}</strong></div></div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--muted)]">{tc("累積投入分")}</dt><dd className="mt-1 font-semibold tabular-nums text-[var(--text)]">{scoreText(item.scores?.effortMilliPoints)}</dd></div><div><dt className="text-[var(--muted)]">{tc("累積成效分")}</dt><dd className="mt-1 font-semibold tabular-nums text-[var(--text)]">{scoreText(item.scores?.outcomeMilliPoints)}</dd></div></dl>{friendlyNote(item, tc) ? <p className="mt-3 text-xs text-[var(--warning)]">{friendlyNote(item, tc)}</p> : null}</button>{expanded ? <div id={timelineId} role="region" aria-label={tc("學生每日分數")} className="mt-3 border-t border-[var(--border)] pt-3">{timelineLoading ? <p className="text-sm text-[var(--muted)]" role="status">{tc("正在載入每日分數…")}</p> : timelineError ? <p className="text-sm text-[var(--danger)]">{timelineError}</p> : timeline?.student.studentId === expandedStudentId ? <RewardTimelineTable timeline={timeline} tc={tc} /> : <p className="text-sm text-[var(--muted)]">{tc("未有每日分數。")}</p>}</div> : null}</article>; })}</div>
  </>;
}

export default function LearningRewardPanel({ role, onBack }: { role: Role; onBack?: () => void }) {
  const { tc } = useLocale();
  const searchParams = useSearchParams();
  const tcRef = useRef(tc);
  useEffect(() => { tcRef.current = tc; }, [tc]);
  const today = useMemo(() => localDateKey(), []);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [academicYear, setAcademicYear] = useState<AcademicYearInfo | null>(null);
  const [unassignedStudentCount, setUnassignedStudentCount] = useState(0);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [classesRetry, setClassesRetry] = useState(0);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [preset, setPreset] = useState<"month" | "lastMonth" | "year" | "custom">("year");
  const [grade, setGrade] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [weights, setWeights] = useState<RewardWeights>({ effort: 50, outcome: 50 });
  const [result, setResult] = useState<RewardQueryResult | null>(null);
  const [timeline, setTimeline] = useState<RewardTimelineResult | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(true);
  const [submittedScope, setSubmittedScope] = useState<SubmittedRewardScope | null>(null);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const queryAbortRef = useRef<AbortController | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const queryGenerationRef = useRef(0);
  const timelineGenerationRef = useRef(0);
  const exportGenerationRef = useRef(0);
  const rangeInitializedRef = useRef(false);
  const rangeEditedRef = useRef(false);
  const initialQueryRef = useRef(false);
  const contextCheckedRef = useRef(false);
  const contextClassIds = useMemo(() => searchParams.getAll("classId").filter((value) => value.trim()), [searchParams]);
  const contextGrade = searchParams.get("grade") ?? "";

  const invalidateRequests = useCallback(() => {
    queryGenerationRef.current += 1;
    timelineGenerationRef.current += 1;
    exportGenerationRef.current += 1;
    queryAbortRef.current?.abort();
    timelineAbortRef.current?.abort();
    exportAbortRef.current?.abort();
  }, []);

  const markFiltersChanged = useCallback(() => {
    invalidateRequests();
    setDirty(true); setTimeline(null); setTimelineError(null); setExpandedStudentId(null); setLoading(false); setTimelineLoading(false); setExporting(null); setExportMessage(null); setRecentAuthOpen(false); setPendingExport(null); setError(null);
  }, [invalidateRequests]);

  const visibleClasses = useMemo(() => classes.filter((item) => !grade || item.grade === grade), [classes, grade]);

  const selectedClassLabel = useMemo(() => selectedClassIds.length === 0
    ? `${tc("全部授權班級")}${role === "ADMIN" && !grade && unassignedStudentCount > 0 ? ` · ${tc("未分班")} ${unassignedStudentCount}` : ""}`
    : selectedClassIds.map((id) => {
      const item = classes.find((candidate) => candidate.id === id);
      return item ? classText(item, tc) : id;
    }).join("、"), [classes, grade, role, selectedClassIds, tc, unassignedStudentCount]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingClasses(true); setClassesError(null);
      try {
        const response = await fetch("/api/teacher/classes", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(await responseErrorMessage(response, tcRef.current));
        const payload = await response.json() as ClassesPayload;
        if (!active) return;
        const nextClasses = payload.items ?? [];
        setClasses(nextClasses); setUnassignedStudentCount(payload.unassignedStudentCount ?? 0);
        if (!contextCheckedRef.current) {
          const validGrade = !contextGrade || STUDENT_GRADES.includes(contextGrade as StudentGrade);
          const requestedClasses = contextClassIds.map((id) => nextClasses.find((item) => item.id === id)).filter((item): item is ClassOption => Boolean(item));
          const validClasses = requestedClasses.length === contextClassIds.length && requestedClasses.every((item) => !contextGrade || item.grade === contextGrade);
          if (!validGrade || !validClasses) {
            setContextError(tcRef.current("連結中的班級或年級條件已失效，請從工作臺重新開啟學生累積分。"));
          } else {
            if (contextGrade) setGrade(contextGrade);
            if (contextClassIds.length) setSelectedClassIds(contextClassIds);
            else if (!rangeEditedRef.current) {
              const contextClasses = contextGrade ? nextClasses.filter((item) => item.grade === contextGrade) : nextClasses;
              if (contextClasses.length === 1) setSelectedClassIds([contextClasses[0]!.id]);
            }
          }
          contextCheckedRef.current = true;
        }
        if (payload.academicYear) {
          setAcademicYear(payload.academicYear);
          if (!rangeInitializedRef.current) {
            rangeInitializedRef.current = true;
            if (!rangeEditedRef.current && isLocalDateKey(payload.academicYear.startsOn) && isLocalDateKey(payload.academicYear.endsOn)) {
              setFromDate(payload.academicYear.startsOn); setToDate(payload.academicYear.endsOn < today ? payload.academicYear.endsOn : today);
            }
          }
        }
      } catch (cause) {
        if (active) setClassesError(cause instanceof Error ? cause.message : tcRef.current("讀取班級資料失敗"));
      } finally { if (active) setLoadingClasses(false); }
    })();
    return () => { active = false; };
  }, [classesRetry, contextClassIds, contextGrade, today]);

  useEffect(() => () => invalidateRequests(), [invalidateRequests]);

  const makeRequest = useCallback((extra: Partial<RewardRequestBody> = {}): RewardRequestBody => ({
    range: { fromDate, toDate }, ...(grade ? { grade } : {}), ...(selectedClassIds.length ? { classIds: selectedClassIds } : {}), ...(studentSearch.trim() ? { search: studentSearch.trim() } : {}), weights, policyVersion: REWARD_POLICY_VERSION, ...extra,
  }), [fromDate, grade, selectedClassIds, studentSearch, toDate, weights]);

  const runQuery = useCallback(async (cursor?: string, append = false) => {
    if (contextError) { setError(contextError); return; }
    if (!fromDate || !toDate || fromDate > toDate) { setError(tc("日期範圍不正確，請重新選擇")); return; }
    if (preset !== "custom" && preset !== "year") {
      const presetError = presetRangeMessage(preset, { from: fromDate, to: toDate }, academicYear, today, tc);
      if (presetError) { setError(presetError); return; }
    }
    queryAbortRef.current?.abort(); timelineAbortRef.current?.abort(); exportAbortRef.current?.abort(); timelineGenerationRef.current += 1; exportGenerationRef.current += 1;
    const controller = new AbortController(); queryAbortRef.current = controller; const generation = ++queryGenerationRef.current;
    setLoading(true); setError(null); setExportMessage(null); setExporting(null); setRecentAuthOpen(false); setPendingExport(null); setTimeline(null); setTimelineError(null); setTimelineLoading(false); setExpandedStudentId(null);
    try {
      const extra = cursor && result ? { cursor, asOf: result.asOf, scopeToken: result.scopeToken, limit: 50 } : { limit: 50 };
      const response = await rosterFetch("/api/learning-analytics/rewards/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest(extra)), signal: controller.signal });
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      if (!response.ok) throw new Error(await requestErrorMessage(response, tc));
      const next = await response.json() as RewardQueryResult;
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      setResult((current) => append && current ? { ...next, items: [...current.items, ...next.items] } : next);
      if (!append) setSubmittedScope({ classIds: [...selectedClassIds], grade });
      setDirty(false);
    } catch (cause) {
      if (controller.signal.aborted || generation !== queryGenerationRef.current) return;
      setError(cause instanceof TypeError ? networkErrorMessage(cause) : cause instanceof Error ? cause.message : tc("讀取學生累積分失敗"));
    } finally { if (generation === queryGenerationRef.current) setLoading(false); if (queryAbortRef.current === controller) queryAbortRef.current = null; }
  }, [academicYear, contextError, fromDate, grade, makeRequest, preset, result, selectedClassIds, tc, today, toDate]);

  useEffect(() => {
    if (loadingClasses || !academicYear || contextError || !contextCheckedRef.current || initialQueryRef.current) return;
    initialQueryRef.current = true; void runQuery();
  }, [academicYear, contextError, loadingClasses, runQuery]);

  const openTimeline = useCallback(async (studentId: string) => {
    if (!result || dirty || loading) return;
    timelineAbortRef.current?.abort(); const generation = ++timelineGenerationRef.current;
    if (expandedStudentId === studentId) { setExpandedStudentId(null); setTimeline(null); setTimelineError(null); setTimelineLoading(false); return; }
    const controller = new AbortController(); timelineAbortRef.current = controller; setExpandedStudentId(studentId); setTimeline(null); setTimelineError(null); setTimelineLoading(true); setError(null);
    try {
      const response = await rosterFetch(`/api/learning-analytics/rewards/students/${encodeURIComponent(studentId)}/timeline/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest({ asOf: result.asOf, scopeToken: result.scopeToken })), signal: controller.signal });
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      if (!response.ok) throw new Error(await requestErrorMessage(response, tc));
      const next = await response.json() as RewardTimelineResult;
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      setTimeline(next);
    } catch (cause) {
      if (controller.signal.aborted || generation !== timelineGenerationRef.current) return;
      setTimeline(null); setTimelineError(cause instanceof TypeError ? networkErrorMessage(cause) : cause instanceof Error ? cause.message : tc("讀取每日分數失敗"));
    } finally { if (generation === timelineGenerationRef.current) setTimelineLoading(false); if (timelineAbortRef.current === controller) timelineAbortRef.current = null; }
  }, [dirty, expandedStudentId, loading, makeRequest, result, tc]);

  const exportReport = useCallback(async (format: ExportFormat) => {
    if (!result || dirty) return;
    exportAbortRef.current?.abort(); const controller = new AbortController(); exportAbortRef.current = controller; const generation = ++exportGenerationRef.current;
    setExporting(format); setError(null); setExportMessage(null);
    try {
      const response = await rosterFetch("/api/learning-analytics/rewards/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(makeRequest({ asOf: result.asOf, scopeToken: result.scopeToken, format })), signal: controller.signal });
      if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      if (!response.ok) { const details = await responseErrorDetails(response, tc); if (details.code === "RECENT_AUTH_REQUIRED") { setPendingExport(format); setRecentAuthOpen(true); return; } throw new Error(details.message); }
      const blob = await response.blob(); if (controller.signal.aborted || generation !== exportGenerationRef.current) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = downloadFilename(response, `${format === "DAILY_XLSX" ? "learning-reward-daily" : "learning-reward"}-${fromDate}-${toDate}-${weights.effort}-${weights.outcome}.${format === "CSV" ? "csv" : "xlsx"}`); anchor.click(); URL.revokeObjectURL(url);
      setExportMessage(tc(`已匯出 ${result.totalStudentCount} 名學生的${format === "DAILY_XLSX" ? "每日分數" : "累積分"}`));
    } catch (cause) { if (controller.signal.aborted || generation !== exportGenerationRef.current) return; setError(cause instanceof TypeError ? networkErrorMessage(cause) : cause instanceof Error ? cause.message : tc("匯出學生累積分失敗")); }
    finally { if (generation === exportGenerationRef.current) setExporting(null); if (exportAbortRef.current === controller) exportAbortRef.current = null; }
  }, [dirty, fromDate, makeRequest, result, tc, toDate, weights]);

  function changeRange(nextFrom: string, nextTo: string) { rangeEditedRef.current = true; setPreset("custom"); setFromDate(nextFrom); setToDate(nextTo); markFiltersChanged(); }
  function choosePreset(value: "month" | "lastMonth" | "year") {
    const range = value === "year" && academicYear ? { from: academicYear.startsOn, to: academicYear.endsOn < today ? academicYear.endsOn : today } : monthRange(today, value === "lastMonth" ? -1 : 0);
    rangeEditedRef.current = true; setPreset(value); setFromDate(range.from); setToDate(range.to); markFiltersChanged();
    if (value !== "year") setError(presetRangeMessage(value, range, academicYear, today, tc));
  }
  function changeGrade(value: string) { setGrade(value); setSelectedClassIds([]); markFiltersChanged(); }
  function changeWeights(effort: number) { const nextEffort = Math.min(100, Math.max(0, Math.round(effort))); setWeights({ effort: nextEffort, outcome: 100 - nextEffort }); markFiltersChanged(); }
  function changeClasses(values: string[]) { setSelectedClassIds(values); markFiltersChanged(); }

  const warning = result ? reportWarning(result, tc) : "";
  const exportDisabled = !result || dirty || loading || exporting !== null || Boolean(contextError);
  const submittedClassLabel = submittedScope
    ? submittedScope.classIds.length === 0
      ? tc("全部授權班級")
      : submittedScope.classIds.map((id) => {
        const item = classes.find((candidate) => candidate.id === id);
        return item ? classText(item, tc) : id;
      }).join("、")
    : selectedClassLabel;
  const submittedGradeLabel = submittedScope?.grade ? tc(GRADE_LABELS[submittedScope.grade as StudentGrade]) : tc("全部年級");

  return <div className="space-y-5">
    <header className="analytics-page-header flex flex-wrap items-end justify-between gap-3"><div>{onBack ? <button type="button" className="mb-2 text-sm font-semibold text-[var(--primary)]" onClick={onBack}>← {tc("返回學習分析")}</button> : null}<h1 className="text-3xl font-black tracking-tight text-[var(--text)]">{tc("學生累積分")}</h1><p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{tc("選擇班級和日期，查看及下載學生累積成果。")}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc(`總分按投入 ${weights.effort}%、成效 ${weights.outcome}% 計算；調整權重只改總分，前兩項分數不變。`)}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-primary ui-button-small" disabled={exportDisabled} onClick={() => void exportReport("XLSX")}>{exporting === "XLSX" ? tc("匯出中…") : tc("匯出學生累積分（Excel）")}</button><details className="relative"><summary className="ui-button ui-button-secondary ui-button-small cursor-pointer list-none">{tc("其他格式")}</summary><div className="absolute right-0 z-20 mt-2 grid min-w-[190px] gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"><button type="button" className="rounded-lg px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--border-soft)] disabled:opacity-50" disabled={exportDisabled} onClick={() => void exportReport("CSV")}>{exporting === "CSV" ? tc("匯出中…") : tc("CSV（學生摘要）")}</button><button type="button" className="rounded-lg px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--border-soft)] disabled:opacity-50" disabled={exportDisabled} onClick={() => void exportReport("DAILY_XLSX")}>{exporting === "DAILY_XLSX" ? tc("匯出中…") : tc("每日分數（Excel）")}</button></div></details></div></header>
    <section className="ui-card ui-card-padding space-y-4" aria-labelledby="reward-filter-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reward-filter-title" className="text-lg font-bold text-[var(--text)]">{tc("報告條件")}</h2>
        <span className="text-xs text-[var(--muted)]">{academicYear ? `${academicYear.label} · ${selectedClassLabel}` : tc("正在載入學年…")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tc("日期快選")}>
        <span className="text-sm font-semibold text-[var(--text)]">{tc("日期")}</span>
        {([ ["month", "本月"], ["lastMonth", "上月"], ["year", "本學年至今"] ] as const).map(([value, label]) => <button key={value} type="button" className={`rounded-xl px-3 py-2 text-xs font-semibold ${preset === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`} onClick={() => choosePreset(value)}>{tc(label)}</button>)}
        <button type="button" className={`rounded-xl px-3 py-2 text-xs font-semibold ${preset === "custom" ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`} onClick={() => setPreset("custom")}>{tc("自訂日期")}</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("開始日期")}<input aria-label={tc("開始日期")} type="date" value={fromDate} max={toDate} onChange={(event) => changeRange(event.target.value, toDate)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("結束日期")}<input aria-label={tc("結束日期")} type="date" value={toDate} min={fromDate} onChange={(event) => changeRange(fromDate, event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("年級")}<select aria-label={tc("年級")} value={grade} onChange={(event) => changeGrade(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((value) => <option key={value} value={value}>{tc(GRADE_LABELS[value])}</option>)}</select></label>
        <div className="grid gap-1.5 text-sm font-semibold text-[var(--text)]"><span>{tc("班級")}</span><details className="relative"><summary aria-label={tc("班級選擇器")} className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-normal"><span className="truncate">{selectedClassLabel}</span><span aria-hidden="true">⌄</span></summary><div className="absolute left-0 right-0 z-20 mt-2 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"><button type="button" className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selectedClassIds.length === 0 ? "bg-[var(--border-soft)] font-semibold text-[var(--primary)]" : "text-[var(--text)] hover:bg-[var(--border-soft)]"}`} onClick={() => changeClasses([])}>{tc("全部授權班級")}</button>{visibleClasses.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-normal text-[var(--text)] hover:bg-[var(--border-soft)]"><input type="checkbox" checked={selectedClassIds.includes(item.id)} onChange={(event) => changeClasses(event.target.checked ? [...selectedClassIds, item.id] : selectedClassIds.filter((id) => id !== item.id))} />{classText(item, tc)}</label>)}</div></details></div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)]"><label className="grid gap-1.5 text-sm font-semibold text-[var(--text)]">{tc("搜尋學生")}<input type="search" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); markFiltersChanged(); }} placeholder={tc("姓名、帳戶或學號")} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label><div className="flex items-end"><button type="button" className="ui-button ui-button-primary w-full" disabled={loading || loadingClasses || Boolean(contextError) || !fromDate || !toDate} onClick={() => void runQuery()}>{loading ? tc("更新中…") : tc("更新結果")}</button></div></div>
      <details className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] p-3"><summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">{tc("計分設定")}</summary><div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_110px_110px] md:items-end"><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("投入／成效權重")}<input aria-label={tc("投入權重滑桿")} type="range" min="0" max="100" step="5" value={weights.effort} onChange={(event) => changeWeights(Number(event.target.value))} /></label><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("投入")}<input type="number" min="0" max="100" step="5" value={weights.effort} onChange={(event) => changeWeights(Number(event.target.value))} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label><label className="grid gap-1 text-sm font-semibold text-[var(--text)]">{tc("成效")}<input type="number" min="0" max="100" step="5" value={weights.outcome} onChange={(event) => changeWeights(100 - Number(event.target.value))} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" /></label></div><p className="mt-2 text-xs text-[var(--muted)]">{tc("每日投入最多計 20 次活動；每日成效最多計 5 個首次答對詞義。投入 15 分、成效 8 分，各佔 50%，總分為 11.5 分。")}</p></details>
      {dirty && result ? <p className="text-xs font-semibold text-[var(--warning)]" role="status">{tc("條件已更改，請按「更新結果」；更新前不能匯出。")}</p> : null}
    </section>
    {contextError ? <ErrorBanner message={contextError} onRetry={() => window.location.assign(role === "ADMIN" ? "/admin/rewards" : "/teacher/rewards")} /> : classesError ? <ErrorBanner message={classesError} onRetry={() => { contextCheckedRef.current = false; setClassesError(null); setClassesRetry((value) => value + 1); }} /> : error ? <ErrorBanner message={error} onRetry={() => void runQuery()} /> : null}{exportMessage ? <p className="text-sm font-semibold text-[var(--success)]" role="status" aria-live="polite">{exportMessage}</p> : null}{loadingClasses || (loading && !result) ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]" role="status">{loadingClasses ? tc("正在載入班級及學年…") : tc("正在更新學生累積分…")}</div> : null}
    {result ? <><section className="rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] px-4 py-3 text-sm text-[var(--muted)]"><div className="flex flex-wrap gap-x-4 gap-y-1"><span>{tc("期間")}：{result.effectiveRange.from} 至 {result.effectiveRange.to}</span><span>{tc("年級")}：{submittedGradeLabel}</span><span>{tc("班級")}：{submittedClassLabel}</span><span>{tc("學生數")}：{result.totalStudentCount}</span><span>{tc("權重")}：{result.policy.weights.effort}%／{result.policy.weights.outcome}%</span><span>{tc("資料截點")}：{formatAsOf(result.asOf)}</span></div>{result.effectiveRange.rangeClamped ? <p className="mt-1 text-xs">{tc("日期已按目前學年及今天調整。")}</p> : null}</section>{dirty ? <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"><strong>{tc("條件已更改")}</strong><p className="mt-1 text-xs">{tc("目前表格仍是上一次成功更新的結果；請按「更新結果」後再匯出。")}</p></div> : warning ? <div className="rounded-2xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"><strong>{tc("資料提示")}</strong><p className="mt-1 text-xs">{warning}</p></div> : null}<section className="ui-card ui-card-padding" aria-labelledby="reward-students-title"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="reward-students-title" className="text-lg font-bold text-[var(--text)]">{tc("學生累積分")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{tc("投入分、成效分是加權前的累積結果；總分按目前權重計算。點姓名可查看每日分數。")}</p></div>{result.nextCursor ? <button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={loading || dirty} onClick={() => void runQuery(result.nextCursor!, true)}>{loading ? tc("載入中…") : tc("載入更多")}</button> : null}</div><RewardStudentResults items={result.items} expandedStudentId={expandedStudentId} timeline={timeline} timelineLoading={timelineLoading} timelineError={timelineError} openTimeline={(studentId) => void openTimeline(studentId)} disabled={dirty || loading} tc={tc} />{result.items.length === 0 ? <p className="py-10 text-center text-sm text-[var(--muted)]">{tc("目前範圍沒有在籍學生。")}</p> : null}</section></> : null}
    <RecentAuthDialog open={recentAuthOpen} onClose={() => { setRecentAuthOpen(false); setPendingExport(null); }} onSuccess={() => { setRecentAuthOpen(false); const pending = pendingExport; setPendingExport(null); if (pending) void exportReport(pending); }} />
  </div>;
}
