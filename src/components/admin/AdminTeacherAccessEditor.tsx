"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorMessage } from "@/lib/api-error";
import { CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import type { AcademicYearStatus, ClassCode, StudentGrade } from "@/generated/prisma";

type Year = { id: string; label: string; status: AcademicYearStatus; revision: number };
type Teacher = { id: string; accountName: string; legalName: string; status: "ACTIVE" | "SUSPENDED"; accessRevision: number; canResetStudentPassword: boolean };
type SchoolClass = { id: string; grade: StudentGrade; classCode: ClassCode; active: boolean; revision: number };
type Snapshot = { accessRevision: number; canResetStudentPassword: boolean; academicYear: Year; classes: SchoolClass[]; selectedClassIds: string[]; currentImpact: { classCount: number; studentCount: number } };

export default function AdminTeacherAccessEditor({ yearId, onMessage }: { yearId: string; onMessage: (message: string) => void }) {
  const { tc } = useLocale();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherStatus, setTeacherStatus] = useState("");
  const [teacherCursor, setTeacherCursor] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [grade, setGrade] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [globalReset, setGlobalReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeachers = useCallback(async (nextCursor: string | null = null, append = false) => {
    const response = await rosterFetch("/api/admin/roster/teachers/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search: teacherSearch || undefined, status: teacherStatus || undefined, cursor: nextCursor || undefined, limit: 50 }) });
    if (!response.ok) throw new Error(await responseErrorMessage(response));
    const payload = await response.json() as { items: Teacher[]; nextCursor: string | null };
    setTeachers((current) => append ? [...current, ...payload.items] : payload.items); setTeacherCursor(payload.nextCursor);
  }, [teacherSearch, teacherStatus]);
  const loadSnapshot = useCallback(async (id: string) => {
    setError(null); setTeacherId(id); if (!id) { setSnapshot(null); return; }
    const response = await fetch(`/api/admin/roster/teachers/${id}/access-settings?academicYearId=${encodeURIComponent(yearId)}`);
    if (!response.ok) throw new Error(await responseErrorMessage(response));
    const payload = await response.json() as Snapshot;
    setSnapshot(payload); setSelected(new Set(payload.selectedClassIds)); setGlobalReset(payload.canResetStudentPassword);
  }, [yearId]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadTeachers().catch((cause) => setError(cause instanceof Error ? cause.message : tc("讀取教師失敗"))); }, 180); return () => window.clearTimeout(timer); }, [loadTeachers, tc]);
  useEffect(() => {
    if (!teacherId) return;
    let active = true;
    const timer = window.setTimeout(() => { void loadSnapshot(teacherId).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : tc("讀取權限失敗")); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [teacherId, loadSnapshot, tc]);
  const visibleClasses = useMemo(() => (snapshot?.classes ?? []).filter((item) => !grade || item.grade === grade).filter((item) => !classSearch || `${item.grade} ${item.classCode}`.toLowerCase().includes(classSearch.toLowerCase())).filter((item) => !selectedOnly || selected.has(item.id)), [classSearch, grade, selected, selectedOnly, snapshot]);
  async function save() {
    if (!snapshot || !teacherId) return;
    setSaving(true); setError(null);
    try {
      const response = await rosterFetch(`/api/admin/roster/teachers/${teacherId}/access-settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessRevision: snapshot.accessRevision, globalCapabilities: { canResetStudentPassword: globalReset, acknowledgeImmediateEffect: true }, classAccess: snapshot.academicYear.status === "CLOSED" ? null : { academicYearId: snapshot.academicYear.id, classIds: [...selected] } }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = await response.json() as { accessRevision: number; currentImpact: Snapshot["currentImpact"] };
      setSnapshot((current) => current ? { ...current, accessRevision: payload.accessRevision, canResetStudentPassword: globalReset, selectedClassIds: [...selected], currentImpact: payload.currentImpact } : current);
      onMessage(tc("教師權限已原子更新。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("更新教師權限失敗")); }
    finally { setSaving(false); }
  }
  return <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold text-[var(--text)]">{tc("教師權限")}</h2><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("reset 是教師帳號級能力；班級選擇只決定可查看哪些學生及進度。")}</p>{error ? <p className="mt-3 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}<div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]"><input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder={tc("搜尋教師姓名或帳號")} value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} /><select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={teacherStatus} onChange={(event) => setTeacherStatus(event.target.value)}><option value="">{tc("全部狀態")}</option><option value="ACTIVE">{tc("使用中")}</option><option value="SUSPENDED">{tc("已停權")}</option></select></div><div className="mt-3 flex flex-wrap gap-2">{teachers.map((teacher) => <button type="button" key={teacher.id} onClick={() => void loadSnapshot(teacher.id).catch((cause) => setError(cause instanceof Error ? cause.message : tc("讀取權限失敗")))} className={`rounded-xl border px-3 py-2 text-left text-xs ${teacherId === teacher.id ? "border-[var(--primary)] bg-[var(--border-soft)]" : "border-[var(--border)]"}`}><strong className="block text-[var(--text)]">{teacher.legalName}</strong><span className="text-[var(--muted)]">{teacher.accountName} · {teacher.status === "ACTIVE" ? tc("使用中") : tc("已停權")}</span></button>)}{teacherCursor ? <button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => void loadTeachers(teacherCursor, true)}>{tc("載入更多教師")}</button> : null}</div>{snapshot ? <><div className="mt-5 rounded-2xl border border-[var(--border)] p-4"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={globalReset} onChange={(event) => setGlobalReset(event.target.checked)} /><span><strong className="block text-sm text-[var(--text)]">{tc("可重設獲授權班級學生密碼")}</strong><small className="mt-1 block text-xs text-[var(--muted)]">{tc("開啟後立即適用於這位教師所有目前獲授權的班級；不會變成全校權限。")}</small></span></label><p className="mt-3 text-xs text-[var(--muted)]">{tc("目前影響")}：{snapshot.currentImpact.classCount} {tc("個班")} · {snapshot.currentImpact.studentCount} {tc("名學生")}</p></div><div className="mt-4 flex flex-wrap gap-2"><select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={grade} onChange={(event) => setGrade(event.target.value)}><option value="">{tc("全部年級")}</option>{STUDENT_GRADES.map((item) => <option key={item} value={item}>{tc(GRADE_LABELS[item])}</option>)}</select><input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder={tc("搜尋班別")} value={classSearch} onChange={(event) => setClassSearch(event.target.value)} /><label className="flex items-center gap-2 px-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} />{tc("只看已選")}</label><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => setSelected((current) => new Set([...current, ...visibleClasses.map((item) => item.id)]))}>{tc("全選目前篩選")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => setSelected((current) => { const next = new Set(current); visibleClasses.forEach((item) => next.delete(item.id)); return next; })}>{tc("清除目前篩選")}</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visibleClasses.map((item) => <label key={item.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span>{tc(GRADE_LABELS[item.grade])} · {tc(CLASS_LABELS[item.classCode])}{item.active ? "" : ` · ${tc("已停用")}`}</span></label>)}</div><div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4"><span className="text-xs text-[var(--muted)]">{tc("已選")} {selected.size} {tc("個班")}</span><button type="button" className="ui-button ui-button-primary" disabled={saving} onClick={() => void save()}>{saving ? tc("保存中…") : tc("保存全部權限")}</button></div></> : <p className="mt-5 rounded-xl bg-[var(--border-soft)] p-4 text-sm text-[var(--muted)]">{tc("先選擇一位教師，再管理 reset 能力及班級 scope。")}</p>}</section>;
}
