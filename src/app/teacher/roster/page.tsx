"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import Modal from "@/components/admin/Modal";
import Icon from "@/components/ui/Icon";
import TeacherFilters, { type TeacherClassOption } from "@/components/teacher/TeacherFilters";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS } from "@/lib/roster-domain";
import type { ClassCode, StudentGrade } from "@/generated/prisma";

type Item = { id: string; accountName: string; legalName: string; nickname: string; grade: StudentGrade | null; classId: string | null; classCode: ClassCode | null; status: "ACTIVE" | "SUSPENDED"; canResetStudentPassword: boolean; resetPrecondition: string | null };
type Payload = { items: Item[]; nextCursor: string | null; viewMode: "TEACHER" | "ADMIN"; scope: { academicYearId: string } };

export default function TeacherRosterPage() {
  const { tc } = useLocale();
  const params = useSearchParams();
  const [classes, setClasses] = useState<TeacherClassOption[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [grade, setGrade] = useState(() => params.get("grade") ?? "");
  const [classId, setClassId] = useState(() => params.get("classId") ?? "");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ student: Item; password?: string; error?: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async (nextCursor: string | null = null, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/teacher/classes");
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const classPayload = await response.json() as { items: TeacherClassOption[] };
      setClasses(classPayload.items);
      const rosterResponse = await rosterFetch("/api/teacher/roster/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade: grade || undefined, classId: classId || undefined, search: search || undefined, cursor: nextCursor || undefined, limit: 50 }) });
      if (!rosterResponse.ok) throw new Error(await responseErrorMessage(rosterResponse));
      const payload = await rosterResponse.json() as Payload;
      setItems((current) => append ? [...current, ...payload.items] : payload.items);
      setCursor(payload.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("讀取學生名冊失敗"));
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [classId, grade, search, tc]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

  async function resetPassword(student: Item) {
    if (!student.canResetStudentPassword || !student.resetPrecondition || !window.confirm(tc("確定要重設這位學生的密碼嗎？舊會話會立即失效。"))) return;
    setResetting(true); setReset({ student });
    try {
      const response = await rosterFetch(`/api/teacher/students/${student.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetPrecondition: student.resetPrecondition }) });
      const payload = await response.json().catch(() => null) as { temporaryPassword?: string; code?: string } | null;
      if (!response.ok) {
        if (payload?.code === "RESET_PRECONDITION_INVALID" || payload?.code === "RESET_CREDENTIAL_STALE") await load();
        setReset({ student, error: payload?.code === "RESET_PRECONDITION_UNAVAILABLE" ? tc("目前無法安全產生重設確認，請稍後再試。") : payload?.code ?? tc("重設密碼失敗") });
      }
      else setReset({ student, password: payload?.temporaryPassword ?? "" });
    } catch (cause) {
      setReset({ student, error: cause instanceof Error ? cause.message : tc("重設密碼失敗") });
    } finally { setResetting(false); }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm font-bold text-[var(--primary)]">{tc("教師工作台")}</p><h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text)]">{tc("學生名冊")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("查找學生資料及可用操作；只顯示你有權限查看的目前班級。")}</p></div>
        <Link href="/teacher/progress" className="ui-button ui-button-secondary ui-button-small"><Icon name="trending-up" size={17} />{tc("查看學生進度")}</Link>
      </header>
      <TeacherFilters classes={classes} grade={grade} classId={classId} search={search} onGradeChange={setGrade} onClassChange={setClassId} onSearchChange={setSearch} />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <div className="ui-card ui-card-padding text-sm text-[var(--muted)]">{tc("正在讀取名冊…")}</div> : items.length === 0 ? <div className="ui-card ui-card-padding text-center text-sm text-[var(--muted)]">{search || grade || classId ? tc("找不到符合條件的學生") : tc("目前沒有可查看的學生")}</div> : <>
        <div className="hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] md:block">
          <table className="w-full text-left text-sm"><caption className="sr-only">{tc("學生名冊")}</caption><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3">{tc("學生證")}</th><th className="px-4 py-3">{tc("真名")}</th><th className="px-4 py-3">{tc("暱稱")}</th><th className="px-4 py-3">{tc("年級／班別")}</th><th className="px-4 py-3 text-right">{tc("操作")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-4 font-semibold text-[var(--text)]">{item.accountName}</td><td className="px-4 py-4">{item.legalName}</td><td className="px-4 py-4 text-[var(--muted)]">{item.nickname || "—"}</td><td className="px-4 py-4 text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])} · ${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</td><td className="px-4 py-4 text-right"><div className="flex justify-end gap-2"><Link href={`/teacher/students/${item.id}?from=roster`} className="ui-button ui-button-secondary ui-button-small">{tc("查看詳情")}</Link>{item.canResetStudentPassword ? <button type="button" disabled={resetting} onClick={() => void resetPassword(item)} className="ui-button ui-button-primary ui-button-small"><Icon name="lock" size={15} />{tc("重設密碼")}</button> : null}</div></td></tr>)}</tbody></table>
        </div>
        <div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="ui-card ui-card-padding"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[var(--text)]">{item.legalName}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.accountName} · {item.nickname || tc("未設定暱稱")}</p><p className="mt-2 text-xs text-[var(--muted)]">{item.grade ? `${tc(GRADE_LABELS[item.grade])} · ${item.classCode ? tc(CLASS_LABELS[item.classCode]) : tc("未分班")}` : tc("未分配")}</p></div><Link href={`/teacher/students/${item.id}?from=roster`} aria-label={tc("查看學生詳情")} className="ui-button ui-button-secondary ui-button-small"><Icon name="arrow-right" size={16} /></Link></div>{item.canResetStudentPassword ? <button type="button" disabled={resetting} onClick={() => void resetPassword(item)} className="ui-button ui-button-primary ui-button-small mt-4 w-full"><Icon name="lock" size={15} />{tc("重設密碼")}</button> : null}</article>)}</div>
        {cursor ? <div className="flex justify-center"><button type="button" className="ui-button ui-button-secondary" disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? tc("正在讀取…") : tc("載入更多")}</button></div> : null}
      </>}
      <Modal open={Boolean(reset)} onClose={() => setReset(null)} title={tc("重設學生密碼")}>{reset?.password ? <div className="space-y-4 text-center"><p className="text-sm text-[var(--muted)]">{tc("請只向學生展示這次產生的臨時密碼：")}</p><p className="select-all rounded-xl bg-[var(--border-soft)] px-4 py-3 text-2xl font-black tracking-widest text-[var(--primary)]">{reset.password}</p><p className="text-xs text-[var(--warning)]">{tc("學生下次登入時必須修改密碼，舊會話已失效。")}</p><button type="button" className="ui-button ui-button-primary w-full" onClick={() => setReset(null)}>{tc("完成")}</button></div> : <div className="space-y-4 text-center"><p className="text-sm text-[var(--danger)]">{reset?.error ?? tc("正在產生臨時密碼…")}</p><button type="button" className="ui-button ui-button-secondary w-full" onClick={() => setReset(null)}>{tc("關閉")}</button></div>}</Modal>
    </div>
  );
}
