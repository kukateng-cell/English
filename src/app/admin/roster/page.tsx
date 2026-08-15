"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import ExcelJS from "exceljs";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import AdminTeacherAccessEditor from "@/components/admin/AdminTeacherAccessEditor";
import { CLASS_CODES, CLASS_LABELS, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import { rosterFetch } from "@/lib/roster-client";
import type { AcademicYearStatus, ClassCode, StudentGrade } from "@/generated/prisma";

type Year = { id: string; label: string; startsOn: string; endsOn: string; status: AcademicYearStatus; revision: number };
type SchoolClass = { id: string; academicYearId: string; grade: StudentGrade; classCode: ClassCode; active: boolean; revision: number; _count?: { enrollments: number; teacherAccess: number } };
type RosterUser = { id: string; accountName: string; legalName: string; nickname: string | null; contactEmail: string | null; grade: StudentGrade | null; classCode: ClassCode | null; role: "STUDENT" | "TEACHER" | "ADMIN"; status: "ACTIVE" | "SUSPENDED"; revision: number; academicYearId: string | null };
type ImportPreview = { batchId: string; operationId?: string; academicYearId: string; entityType: "STUDENT" | "TEACHER"; rowCount: number; createCount: number; updateCount: number; errorCount: number; canCommit: boolean; nextCursor?: string | null; rows: Array<{ rowNumber: number; action: string; accountName: string; legalName: string; errors: string[] }> };
type RotationPreview = { batchId: string; operationId?: string; eligible: Array<{ userId: string; accountName: string }>; conflicts: Array<{ userId: string; accountName: string; reason: string }> };
type ActivationPreview = { batchId?: string; operationId?: string; pendingAcknowledgement?: boolean; missingClassIds?: string[]; sourceAcademicYear?: string; targetAcademicYear?: string; sourceCount?: number; targetCount?: number; coverage?: Array<{ classId: string; grade: StudentGrade; classCode: ClassCode; viewTeacherIds: string[]; resetTeacherIds: string[]; acknowledged: boolean }> };
type MutationPreview = { batchId: string; counts?: Record<string, number>; payload?: { selectedCount?: number; excludedCount?: number }; students?: Array<{ studentId: string; accountName: string; legalName: string; sourceClassCode: ClassCode | null; disposition: string; targetClassCode: ClassCode | null }> };

const STUDENT_FIELDS = ["accountName", "legalName", "nickname", "grade", "classCode", "contactEmail", "status", "mustChangePassword", "createdAt"];
const TEACHER_FIELDS = ["templateVersion", "accountName", "legalName", "contactEmail", "classAccess", "resetPasswordCapability", "status", "createdAt"];
const tabs = ["students", "teachers", "years", "imports", "promotion", "export"] as const;
type Tab = (typeof tabs)[number];
const controlClass = "h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--primary)]";
const primaryButton = "rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-bg)] disabled:opacity-50";
const secondaryButton = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text)] disabled:opacity-50";
const rosterStatusButton = "ui-button ui-button-small text-[12px]";
const suspendButton = `${rosterStatusButton} ui-button-danger`;
const restoreButton = `${rosterStatusButton} ui-button-secondary`;

async function responseMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { code?: string; error?: string } | null;
  return payload?.code ?? payload?.error ?? `请求失败 (${response.status})`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadCredentialXlsx(rows: Array<{ accountName: string; legalName: string; temporaryPassword: string }>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Credentials");
  sheet.columns = ["accountName", "legalName", "temporaryPassword"].map((header) => ({ header, key: header, style: { numFmt: "@" } }));
  const safeText = (value: string) => /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  for (const row of rows) sheet.addRow({ accountName: safeText(String(row.accountName)), legalName: safeText(String(row.legalName)), temporaryPassword: safeText(String(row.temporaryPassword)) });
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "one-time-credentials.xlsx");
}

export default function AdminRosterPage() {
  const { tc } = useLocale();
  const [tab, setTab] = useState<Tab>("students");
  const [years, setYears] = useState<Year[]>([]);
  const [yearId, setYearId] = useState("");
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [nextUserCursor, setNextUserCursor] = useState<string | null>(null);
  const [filterGrade, setFilterGrade] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetClass, setTargetClass] = useState("");
  const [importType, setImportType] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [importTemplateFormat, setImportTemplateFormat] = useState<"csv" | "xlsx">("csv");
  const [mergeMode, setMergeMode] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [lastImportBatchId, setLastImportBatchId] = useState<string | null>(null);
  const [rotationPreview, setRotationPreview] = useState<RotationPreview | null>(null);
  const [credentials, setCredentials] = useState<Array<{ accountName: string; legalName: string; temporaryPassword: string }> | null>(null);
  const [promotionGrade, setPromotionGrade] = useState<StudentGrade>("JUNIOR_1");
  const [promotionTargetYear, setPromotionTargetYear] = useState("");
  const [promotionPreview, setPromotionPreview] = useState<MutationPreview | null>(null);
  const [excludedPromotion, setExcludedPromotion] = useState<Set<string>>(new Set());
  const [bulkPreview, setBulkPreview] = useState<MutationPreview | null>(null);
  const [exportType, setExportType] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [exportFormat, setExportFormat] = useState<"CSV" | "XLSX">("XLSX");
  const [exportFields, setExportFields] = useState<string[]>(STUDENT_FIELDS);
  const [newYearLabel, setNewYearLabel] = useState("");
  const [newClassGrade, setNewClassGrade] = useState<StudentGrade>("JUNIOR_1");
  const [newClassCode, setNewClassCode] = useState<ClassCode>("A");
  const [activationTargetYear, setActivationTargetYear] = useState("");
  const [activationAcknowledged, setActivationAcknowledged] = useState<Set<string>>(new Set());
  const [activationPreview, setActivationPreview] = useState<ActivationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentYear = useMemo(() => years.find((year) => year.id === yearId) ?? null, [years, yearId]);
  const students = useMemo(() => users.filter((user) => user.role === "STUDENT" && (!filterGrade || user.grade === filterGrade) && (!filterClass || user.classCode === filterClass) && (!search || `${user.accountName} ${user.legalName} ${user.nickname ?? ""}`.toLowerCase().includes(search.toLowerCase()))), [users, filterGrade, filterClass, search]);
  const plannedYears = years.filter((year) => year.status === "PLANNED");

  const loadYears = useCallback(async () => {
    const response = await fetch("/api/admin/academic-years");
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as Year[];
    setYears(payload);
    setYearId((current) => current && payload.some((year) => year.id === current) ? current : payload.find((year) => year.status === "CURRENT")?.id ?? payload[0]?.id ?? "");
  }, []);
  const loadData = useCallback(async () => {
    if (!yearId) return;
    const query = new URLSearchParams({ academicYearId: yearId, limit: "100" });
    if (search.trim()) query.set("search", search.trim());
    if (filterGrade) query.set("grade", filterGrade);
    if (filterClass) query.set("classCode", filterClass);
    const [userResponse, classResponse] = await Promise.all([fetch(`/api/admin/users?${query.toString()}`), fetch(`/api/admin/classes?academicYearId=${encodeURIComponent(yearId)}`)]);
    if (!userResponse.ok) throw new Error(await responseMessage(userResponse));
    if (!classResponse.ok) throw new Error(await responseMessage(classResponse));
    const userPayload = await userResponse.json() as { items?: RosterUser[]; nextCursor?: string | null } | RosterUser[];
    setUsers(Array.isArray(userPayload) ? userPayload : userPayload.items ?? []);
    setNextUserCursor(Array.isArray(userPayload) ? null : userPayload.nextCursor ?? null);
    setClasses(await classResponse.json() as SchoolClass[]);
  }, [yearId, search, filterGrade, filterClass]);
  async function loadMoreUsers() {
    if (!yearId || !nextUserCursor) return;
    const query = new URLSearchParams({ academicYearId: yearId, limit: "100", cursor: nextUserCursor });
    if (search.trim()) query.set("search", search.trim());
    if (filterGrade) query.set("grade", filterGrade);
    if (filterClass) query.set("classCode", filterClass);
    const response = await fetch(`/api/admin/users?${query.toString()}`);
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as { items?: RosterUser[]; nextCursor?: string | null };
    setUsers((current) => [...current, ...(payload.items ?? [])]);
    setNextUserCursor(payload.nextCursor ?? null);
  }
  useEffect(() => {
    let active = true;
    async function syncYears() {
      try { await loadYears(); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "读取学年失败"); }
    }
    void syncYears();
    return () => { active = false; };
  }, [loadYears]);
  useEffect(() => {
    let active = true;
    async function syncData() {
      try { await loadData(); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "读取名单失败"); }
    }
    void syncData();
    return () => { active = false; };
  }, [loadData]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } finally { setBusy(false); }
  }

  async function previewImport() {
    const file = fileRef.current?.files?.[0];
    if (!file || !yearId) throw new Error("请选择学年及 CSV/XLSX 名单");
    const form = new FormData(); form.set("file", file); form.set("academicYearId", yearId); form.set("entityType", importType); form.set("mode", mergeMode ? "MERGE" : "CREATE_ONLY"); form.set("operationId", crypto.randomUUID());
    const response = await rosterFetch("/api/admin/roster/import/preview", { method: "POST", body: form });
    if (!response.ok) throw new Error(await responseMessage(response));
    setImportPreview(await response.json() as ImportPreview); setCredentials(null);
  }
  async function loadMoreImportRows() {
    if (!importPreview?.nextCursor) return;
    const response = await fetch(`/api/admin/roster/import/${importPreview.batchId}?limit=50&cursor=${encodeURIComponent(importPreview.nextCursor)}`);
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as ImportPreview;
    setImportPreview((current) => current ? { ...current, rows: [...current.rows, ...payload.rows], nextCursor: payload.nextCursor } : current);
  }
  async function commitImport() {
    if (!importPreview) return;
    const response = await rosterFetch(`/api/admin/roster/import/${importPreview.batchId}/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: (importPreview as ImportPreview & { operationId?: string }).operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as { credentials?: Array<{ accountName: string; legalName: string; temporaryPassword: string }>; summary?: { rowCount?: number } };
    setCredentials(payload.credentials ?? []); setLastImportBatchId(importPreview.batchId); setImportPreview(null); setMessage(`已汇入 ${payload.summary?.rowCount ?? 0} 行；临时密码只会显示今次。`); await loadData();
  }
  async function previewRotation() {
    if (!lastImportBatchId) throw new Error("没有可重新产生密码的最近汇入批次");
    const response = await rosterFetch(`/api/admin/roster/import/${lastImportBatchId}/rotate-credentials/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setRotationPreview(await response.json() as RotationPreview);
  }
  async function commitRotation() {
    if (!rotationPreview) return;
    const response = await rosterFetch(`/api/admin/roster/import/${rotationPreview.batchId}/rotate-credentials/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: rotationPreview.operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as { credentials?: Array<{ accountName: string; legalName: string; temporaryPassword: string }> };
    setCredentials(payload.credentials ?? []); setRotationPreview(null); setMessage("符合条件的未改密账号已重新产生临时密码。");
  }
  async function downloadTemplate() {
    const response = await fetch(`/api/admin/roster/import/templates/${importType}/${importTemplateFormat}`);
    if (!response.ok) throw new Error(await responseMessage(response));
    downloadBlob(await response.blob(), `${importType.toLowerCase()}-roster-v1-template.${importTemplateFormat}`);
  }
  async function previewBulk() {
    if (!yearId || !selected.size) throw new Error("请选择学生");
    const response = await rosterFetch("/api/admin/roster/students/bulk-class/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYearId: yearId, mode: "explicit", studentIds: [...selected], classCode: targetClass || null, excludedIds: [], operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setBulkPreview(await response.json() as MutationPreview); setTab("students");
  }
  async function commitBulk() {
    if (!bulkPreview) return;
    const response = await rosterFetch("/api/admin/roster/students/bulk-class/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectionBatchId: bulkPreview.batchId, operationId: (bulkPreview as MutationPreview & { operationId?: string }).operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setMessage("批量转班已完成。"); setBulkPreview(null); setSelected(new Set()); await loadData();
  }
  async function previewPromotion() {
    if (!yearId || !promotionTargetYear) throw new Error("请选择 source／target 学年");
    const response = await rosterFetch("/api/admin/roster/students/promote/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceAcademicYearId: yearId, targetAcademicYearId: promotionTargetYear, sourceGrade: promotionGrade, excludedStudentIds: [], classMapping: {}, operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as MutationPreview; setPromotionPreview(payload); setExcludedPromotion(new Set());
  }
  async function commitPromotion() {
    if (!promotionPreview) return;
    // Exclusions are a reviewed disposition change. Re-preview the complete
    // source set so the server, rather than the browser, owns the final plan.
    let batchId = promotionPreview.batchId;
    let operationId = (promotionPreview as MutationPreview & { operationId?: string }).operationId;
    if (excludedPromotion.size) {
      const previewResponse = await rosterFetch("/api/admin/roster/students/promote/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceAcademicYearId: yearId, targetAcademicYearId: promotionTargetYear, sourceGrade: promotionGrade, excludedStudentIds: [...excludedPromotion], dispositions: Object.fromEntries([...excludedPromotion].map((id) => [id, "HOLD_UNASSIGNED"])), classMapping: {}, operationId: crypto.randomUUID() }) });
      if (!previewResponse.ok) throw new Error(await responseMessage(previewResponse));
      const reviewed = await previewResponse.json() as MutationPreview & { operationId?: string };
      batchId = reviewed.batchId; operationId = reviewed.operationId;
    }
    const response = await rosterFetch("/api/admin/roster/students/promote/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setMessage("升级计划已保存至目标学年，须在启用学年前完成 activation。"); setPromotionPreview(null); await loadData();
  }
  async function setStatus(user: RosterUser, status: "ACTIVE" | "SUSPENDED") {
    const response = await rosterFetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, revision: user.revision }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const updated = await response.json().catch(() => null) as { status?: RosterUser["status"] } | null;
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: updated?.status ?? status, revision: item.revision + 1 } : item));
    setMessage(status === "ACTIVE" ? "账号已恢复。" : "账号已停权。");
    await loadData();
  }
  async function createYear() {
    if (!newYearLabel) throw new Error("请输入学年，例如 2026-2027");
    const response = await rosterFetch("/api/admin/academic-years", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: newYearLabel }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setNewYearLabel(""); setMessage("PLANNED 学年已建立。 "); await loadYears();
  }
  async function createClass() {
    if (!yearId) throw new Error("请选择学年");
    const response = await rosterFetch("/api/admin/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYearId: yearId, grade: newClassGrade, classCode: newClassCode }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setMessage("班级已建立。 "); await loadData();
  }
  async function toggleClass(schoolClass: SchoolClass) {
    const response = await rosterFetch(`/api/admin/classes/${schoolClass.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !schoolClass.active, revision: schoolClass.revision }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    await loadData();
  }
  async function previewActivation() {
    if (!yearId || !activationTargetYear) throw new Error("请选择 source／target 学年");
    const response = await rosterFetch(`/api/admin/academic-years/${yearId}/activation/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetAcademicYearId: activationTargetYear, acknowledgedClassIds: [...activationAcknowledged], operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setActivationPreview(await response.json() as ActivationPreview);
  }
  async function commitActivation() {
    if (!activationPreview?.batchId) throw new Error("请先完成 coverage acknowledgement");
    const response = await rosterFetch(`/api/admin/academic-years/${yearId}/activation/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: activationPreview.batchId, operationId: activationPreview.operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setActivationPreview(null); setMessage("学年已原子启用。 "); await loadYears(); await loadData();
  }
  async function exportRoster() {
    if (!yearId || !exportFields.length) throw new Error("请选择学年及至少一栏");
    const body = { entityType: exportType, academicYearId: yearId, format: exportFormat, fields: exportFields, filters: { grade: filterGrade || undefined, classCode: filterClass || undefined, search: search || undefined } };
    const previewResponse = await rosterFetch("/api/admin/roster/export/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!previewResponse.ok) throw new Error(await responseMessage(previewResponse));
    const count = (await previewResponse.json() as { count: number }).count;
    if (!window.confirm(`将下载 ${count} 行；继续？`)) return;
    const response = await rosterFetch("/api/admin/roster/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await responseMessage(response));
    downloadBlob(await response.blob(), `${exportType.toLowerCase()}-roster.${exportFormat.toLowerCase()}`); setMessage("名单已汇出。 ");
  }

  const tabLabels: Record<Tab, string> = { students: "学生名册", teachers: "教师名册", years: "学年及班级", imports: "汇入", promotion: "升级", export: "汇出" };
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    setTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`roster-tab-${nextTab}`)?.focus());
  }

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-roster-page]");
    if (!root) return;
    root.querySelectorAll<HTMLInputElement>("input[placeholder]").forEach((input) => {
      if (!input.getAttribute("aria-label")) input.setAttribute("aria-label", input.getAttribute("placeholder") ?? tc("输入内容"));
    });
    const selectLabels: Record<Tab, string[]> = {
      students: [],
      teachers: ["选择教师"],
      years: ["新学年年级", "新学年班别", "选择目标 PLANNED 学年"],
      imports: ["名单类型", "导入模板格式"],
      promotion: ["升级年级", "选择目标 PLANNED 学年"],
      export: ["汇出类型", "汇出格式"],
    };
    root.querySelectorAll<HTMLSelectElement>("select:not([aria-label])").forEach((select, index) => {
      const label = selectLabels[tab][index];
      if (label) select.setAttribute("aria-label", tc(label));
    });
    root.querySelectorAll<HTMLInputElement>('input[type="file"]:not([aria-label])').forEach((input) => input.setAttribute("aria-label", tc("上传 CSV 或 XLSX 名单")));
    const panel = root.querySelector<HTMLElement>("section");
    if (panel) {
      panel.id = `roster-panel-${tab}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `roster-tab-${tab}`);
      panel.tabIndex = -1;
    }
  }, [tab, tc]);

  return <div data-roster-page className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">{tc("学校名册")}</p><h1 className="mt-1 text-[24px] font-bold text-[var(--text)]">{tc("班级、学生与教师")}</h1><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("所有 mutation 只作用于明确选择的学年。")}</p></div><Link href="/admin/users" className={secondaryButton}>{tc("逐个新增／编辑账号")}</Link></div>
    {error ? <div aria-live="assertive"><ErrorBanner message={error} /></div> : null}{message ? <div role="status" aria-live="polite" className="rounded-2xl bg-[var(--border-soft)] p-4 text-[13px] text-[var(--primary)]">{tc(message)}</div> : null}
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={tc("名册管理区段")}>{tabs.map((item, index) => <button key={item} id={`roster-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`roster-panel-${item}`} tabIndex={tab === item ? 0 : -1} className={tab === item ? primaryButton : secondaryButton} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{tc(tabLabels[item])}</button>)}</div>
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"><label className="text-[13px] text-[var(--muted)]">{tc("作用学年")}</label><select aria-label={tc("作用学年")} className={controlClass} value={yearId} onChange={(event) => setYearId(event.target.value)}>{years.map((year) => <option key={year.id} value={year.id}>{year.label} · {year.status}</option>)}</select>{currentYear ? <span className="text-[12px] text-[var(--muted)]">{currentYear.status === "CLOSED" ? tc("历史只读") : tc("可编辑")}</span> : null}</div>
    {tab === "students" && nextUserCursor ? <button className={secondaryButton} disabled={busy} onClick={() => void run(loadMoreUsers)}>{tc("载入更多学生／教师")}</button> : null}

    {tab === "students" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold text-[var(--text)]">{tc("学生名册")}</h2><div className="mt-3 flex flex-wrap gap-2"><input className={controlClass} placeholder={tc("搜寻账号／姓名／昵称")} value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label={tc("年级筛选")} value={filterGrade} onChange={(event) => setFilterGrade(event.target.value)} className={controlClass}><option value="">{tc("所有年级")}</option>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select aria-label={tc("班别筛选")} value={filterClass} onChange={(event) => setFilterClass(event.target.value)} className={controlClass}><option value="">{tc("所有班别")}</option>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(CLASS_LABELS[code])}</option>)}</select><button className={secondaryButton} onClick={() => setSelected(new Set(students.map((student) => student.id)))}>{tc(`全选本页 ${students.length} 人`)}</button><button className={secondaryButton} onClick={() => setSelected(new Set())}>{tc("清除选择")}</button></div><div className="mt-3 space-y-2 md:hidden">{students.map((student) => <article key={student.id} className="rounded-2xl border border-[var(--border)] p-3 text-[12px]"><div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 font-semibold"><input aria-label={student.accountName} type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })} /><span>{student.accountName}</span></label><button type="button" data-testid="roster-status-toggle" aria-label={tc(student.status === "ACTIVE" ? "停权学生" : "恢复学生")} className={student.status === "ACTIVE" ? suspendButton : restoreButton} disabled={busy} onClick={() => void run(() => setStatus(student, student.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"))}>{student.status === "ACTIVE" ? tc("停权") : tc("恢复")}</button></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2"><div><dt className="text-[var(--muted)]">{tc("真实姓名")}</dt><dd>{student.legalName}</dd></div><div><dt className="text-[var(--muted)]">{tc("昵称")}</dt><dd>{student.nickname ?? "—"}</dd></div><div><dt className="text-[var(--muted)]">{tc("年级")}</dt><dd>{student.grade ? tc(GRADE_LABELS[student.grade]) : tc("未分配")}</dd></div><div><dt className="text-[var(--muted)]">{tc("班别")}</dt><dd>{student.classCode ? tc(CLASS_LABELS[student.classCode]) : tc("未分班")}</dd></div><div><dt className="text-[var(--muted)]">{tc("状态")}</dt><dd>{student.status === "ACTIVE" ? tc("使用中") : tc("已停权")}</dd></div></dl></article>)}</div><div className="mt-3 hidden max-h-[28rem] overflow-auto md:block"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr><th></th><th>{tc("学生证")}</th><th>{tc("真实姓名")}</th><th>{tc("昵称")}</th><th>{tc("年级")}</th><th>{tc("班别")}</th><th>{tc("状态")}</th><th>{tc("操作")}</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t border-[var(--border)]"><td className="py-2"><input aria-label={student.accountName} type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })} /></td><td>{student.accountName}</td><td>{student.legalName}</td><td>{student.nickname ?? "—"}</td><td>{student.grade ? tc(GRADE_LABELS[student.grade]) : tc("未分配")}</td><td>{student.classCode ? tc(CLASS_LABELS[student.classCode]) : tc("未分班")}</td><td>{student.status === "ACTIVE" ? tc("使用中") : tc("已停权")}</td><td><button type="button" data-testid="roster-status-toggle" aria-label={tc(student.status === "ACTIVE" ? "停权学生" : "恢复学生")} className={student.status === "ACTIVE" ? suspendButton : restoreButton} disabled={busy} onClick={() => void run(() => setStatus(student, student.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"))}>{student.status === "ACTIVE" ? tc("停权") : tc("恢复")}</button></td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-[13px] text-[var(--muted)]">{tc(`已选 ${selected.size} 人`)}</span><select aria-label={tc("目标班别")} value={targetClass} onChange={(event) => setTargetClass(event.target.value)} className={controlClass}><option value="">{tc("转为未分班")}</option>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(`${CLASS_LABELS[code]}班`)}</option>)}</select><button className={primaryButton} disabled={busy || !selected.size || currentYear?.status !== "CURRENT"} onClick={() => void run(previewBulk)}>{tc("预览批量转班")}</button></div>{bulkPreview ? <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><p className="text-[13px]">{tc(`已选 ${bulkPreview.payload?.selectedCount ?? 0} 人；确认后才会写入。`)}</p><button className={`${primaryButton} mt-3`} onClick={() => void run(commitBulk)}>{tc("确认批量转班")}</button></div> : null}</section> : null}

    {tab === "teachers" ? <AdminTeacherAccessEditor yearId={yearId} onMessage={setMessage} /> : null}

    {tab === "years" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold text-[var(--text)]">{tc("学年及班级设定")}</h2><div className="mt-3 flex flex-wrap gap-2"><input className={controlClass} placeholder="2026-2027" value={newYearLabel} onChange={(event) => setNewYearLabel(event.target.value)} /><button className={primaryButton} onClick={() => void run(createYear)}>{tc("建立 PLANNED 学年")}</button></div><div className="mt-4 flex flex-wrap gap-2"><select className={controlClass} value={newClassGrade} onChange={(event) => setNewClassGrade(event.target.value as StudentGrade)}>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select className={controlClass} value={newClassCode} onChange={(event) => setNewClassCode(event.target.value as ClassCode)}>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(CLASS_LABELS[code])}</option>)}</select><button className={primaryButton} disabled={!yearId || currentYear?.status === "CLOSED"} onClick={() => void run(createClass)}>{tc("建立班级")}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{classes.map((schoolClass) => <div key={schoolClass.id} className="rounded-2xl border border-[var(--border)] p-3 text-[12px]"><div className="font-semibold">{tc(GRADE_LABELS[schoolClass.grade])}{tc(`${CLASS_LABELS[schoolClass.classCode]}班`)}</div><div className="mt-1 text-[var(--muted)]">{schoolClass.active ? tc("启用") : tc("已停用")}</div><button className="mt-2 text-[var(--primary)] disabled:opacity-50" disabled={currentYear?.status === "CLOSED"} onClick={() => void run(() => toggleClass(schoolClass))}>{schoolClass.active ? tc("停用") : tc("重新启用")}</button></div>)}</div><div className="mt-6 rounded-2xl border border-[var(--border)] p-4"><h3 className="font-semibold">{tc("学年启用")}</h3><div className="mt-3 flex flex-wrap gap-2"><select className={controlClass} value={activationTargetYear} onChange={(event) => { setActivationTargetYear(event.target.value); setActivationPreview(null); }}><option value="">{tc("选择目标 PLANNED 学年")}</option>{plannedYears.filter((year) => year.id !== yearId).map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select><button className={primaryButton} disabled={busy || currentYear?.status !== "CURRENT"} onClick={() => void run(previewActivation)}>{tc("预览启用")}</button></div>{activationPreview?.coverage ? <div className="mt-3 space-y-2 text-[12px]"><p>{tc(`source ${activationPreview.sourceCount ?? 0} 人；target ${activationPreview.targetCount ?? 0} 人`)}</p>{activationPreview.coverage.map((item) => <label key={item.classId} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-2"><input type="checkbox" checked={activationAcknowledged.has(item.classId)} onChange={(event) => setActivationAcknowledged((current) => { const next = new Set(current); if (event.target.checked) next.add(item.classId); else next.delete(item.classId); return next; })} disabled={item.viewTeacherIds.length > 0} /><span>{tc(GRADE_LABELS[item.grade])}{tc(`${CLASS_LABELS[item.classCode]}班`)} · {item.viewTeacherIds.length ? tc(`${item.viewTeacherIds.length} 位可查看教师`) : tc("没有可查看教师，需确认")}</span></label>)}<div className="flex gap-2"><button className={secondaryButton} onClick={() => void run(previewActivation)}>{tc("按确认重新预览")}</button>{activationPreview.batchId ? <button className={primaryButton} onClick={() => void run(commitActivation)}>{tc("确认启用")}</button> : null}</div></div> : null}</div></section> : null}

    {tab === "imports" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("学生／教师 CSV、XLSX 汇入")}</h2><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("先预览；所有错误修正后才可提交。暂存资料 30 分钟后失效。")}</p><div className="mt-4 flex flex-wrap gap-2"><select value={importType} onChange={(event) => { setImportType(event.target.value as "STUDENT" | "TEACHER"); setImportPreview(null); }} className={controlClass}><option value="STUDENT">{tc("学生名单")}</option><option value="TEACHER">{tc("教师名单")}</option></select><input ref={fileRef} type="file" accept=".csv,.xlsx" className={`${controlClass} max-w-full pt-2`} /><label className="flex items-center gap-2 px-2 text-[13px] text-[var(--muted)]"><input type="checkbox" checked={mergeMode} onChange={(event) => setMergeMode(event.target.checked)} />{tc("MERGE 现有同角色账号")}</label><select value={importTemplateFormat} onChange={(event) => setImportTemplateFormat(event.target.value as "csv" | "xlsx")} className={controlClass} aria-label={tc("模板格式")}><option value="csv">CSV</option><option value="xlsx">XLSX</option></select><button className={secondaryButton} onClick={() => void run(downloadTemplate)}>{tc("下载 v1 模板")}</button><button className={primaryButton} disabled={busy || currentYear?.status === "CLOSED"} onClick={() => void run(previewImport)}>{tc("验证及预览")}</button></div>{importPreview ? <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><p className="text-[13px]">{tc(`共 ${importPreview.rowCount} 行：新建 ${importPreview.createCount}、更新 ${importPreview.updateCount}、错误 ${importPreview.errorCount}`)}</p><div className="mt-3 max-h-64 overflow-auto text-[12px]"><table className="w-full text-left"><thead><tr><th>{tc("原始行")}</th><th>{tc("账号")}</th><th>{tc("姓名")}</th><th>{tc("动作／错误")}</th></tr></thead><tbody>{importPreview.rows.map((row) => <tr key={row.rowNumber} className="border-t border-[var(--border)]"><td className="py-2">{row.rowNumber}</td><td>{row.accountName}</td><td>{row.legalName}</td><td className={row.errors.length ? "text-[var(--danger)]" : "text-[var(--primary)]"}>{row.errors.join("；") || row.action}</td></tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap gap-3"><button className={primaryButton} disabled={busy || !importPreview.canCommit} onClick={() => void run(commitImport)}>{tc("确认并汇入")}</button>{importPreview.nextCursor ? <button className={secondaryButton} disabled={busy} onClick={() => void run(loadMoreImportRows)}>{tc("载入更多预览行")}</button> : null}<button className="text-[13px] text-[var(--muted)]" onClick={() => void run(async () => { const response = await rosterFetch(`/api/admin/roster/import/${importPreview.batchId}/cancel`, { method: "POST" }); if (!response.ok) throw new Error(await responseMessage(response)); setImportPreview(null); })}>{tc("取消暂存")}</button></div></div> : null}{lastImportBatchId ? <div className="mt-3 rounded-2xl border border-[var(--border)] p-3 text-[12px]"><p>{tc("如一次性密码遗失，可在 24 小时内重新预览未改密账号。")}</p><button className={`${secondaryButton} mt-2`} onClick={() => void run(previewRotation)}>{tc("预览重新产生密码")}</button>{rotationPreview ? <><span className="ml-2">{tc(`符合条件 ${rotationPreview.eligible.length} 人；冲突 ${rotationPreview.conflicts.length} 人`)}</span><button className={`${primaryButton} ml-2`} onClick={() => void run(commitRotation)}>{tc("确认重新产生")}</button></> : null}</div> : null}{credentials ? <div className="mt-4 rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning-bg)] p-4"><p className="font-semibold text-[var(--warning)]">{tc("一次性临时密码：关闭后不可再次取得。")}</p><div className="mt-2 max-h-48 overflow-auto font-mono text-[12px]">{credentials.map((item) => <div key={item.accountName}>{item.accountName}　{item.legalName}　{item.temporaryPassword}</div>)}</div><button className={`${secondaryButton} mt-3`} onClick={() => void run(() => downloadCredentialXlsx(credentials))}>{tc("下载 typed XLSX 报告")}</button><button className="ml-3 text-[13px] text-[var(--warning)]" onClick={() => setCredentials(null)}>{tc("保存並關閉")}</button></div> : null}</section> : null}

    {tab === "promotion" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("全级升级与 exclusions")}</h2><div className="mt-3 flex flex-wrap gap-2"><select className={controlClass} value={promotionGrade} onChange={(event) => setPromotionGrade(event.target.value as StudentGrade)}>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select className={controlClass} value={promotionTargetYear} onChange={(event) => setPromotionTargetYear(event.target.value)}><option value="">{tc("选择目标 PLANNED 学年")}</option>{plannedYears.filter((year) => year.id !== yearId).map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select><button className={primaryButton} disabled={busy} onClick={() => void run(previewPromotion)}>{tc("预览升级")}</button></div>{promotionPreview?.students ? <div className="mt-4"><p className="text-[13px] text-[var(--muted)]">{tc(`共 ${promotionPreview.students.length} 人；剔除者必须另定 disposition。`)}</p><div className="mt-2 max-h-64 overflow-auto">{promotionPreview.students.map((student) => <label key={student.studentId} className="flex items-center gap-3 border-t border-[var(--border)] py-2 text-[12px]"><input type="checkbox" checked={!excludedPromotion.has(student.studentId)} onChange={() => setExcludedPromotion((current) => { const next = new Set(current); if (next.has(student.studentId)) next.delete(student.studentId); else next.add(student.studentId); return next; })} /><span className="font-mono">{student.accountName}</span><span>{student.legalName}</span><span>{student.disposition}</span><span>{student.targetClassCode ? tc(`${CLASS_LABELS[student.targetClassCode]}班`) : tc("未分班")}</span></label>)}</div><button className={`${primaryButton} mt-3`} disabled={busy} onClick={() => void run(commitPromotion)}>{tc("保存升级 planned roster")}</button></div> : null}</section> : null}

    {tab === "export" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("汇出目前名单")}</h2><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("汇出作用于全部 server-resolved rows；超过 5,000 行会整体拒绝。")}</p><div className="mt-3 flex flex-wrap gap-2"><select value={exportType} onChange={(event) => { const next = event.target.value as "STUDENT" | "TEACHER"; setExportType(next); setExportFields(next === "STUDENT" ? STUDENT_FIELDS : TEACHER_FIELDS); }} className={controlClass}><option value="STUDENT">{tc("学生")}</option><option value="TEACHER">{tc("教师")}</option></select><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "CSV" | "XLSX")} className={controlClass}><option value="XLSX">XLSX</option><option value="CSV">CSV</option></select><button className={primaryButton} disabled={busy || !exportFields.length} onClick={() => void run(exportRoster)}>{tc("预览并下载")}</button></div><div className="mt-3 flex flex-wrap gap-3">{(exportType === "STUDENT" ? STUDENT_FIELDS : TEACHER_FIELDS).map((field) => <label key={field} className="text-[12px] text-[var(--muted)]"><input className="mr-1" type="checkbox" checked={exportFields.includes(field)} onChange={() => setExportFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} />{field}</label>)}</div></section> : null}
  </div>;
}
