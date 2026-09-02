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
type RosterUser = { id: string; accountName: string; studentNumber: number | null; legalName: string; nickname: string | null; contactEmail: string | null; grade: StudentGrade | null; classCode: ClassCode | null; role: "STUDENT" | "TEACHER" | "ADMIN"; status: "ACTIVE" | "SUSPENDED"; revision: number; academicYearId: string | null };
type ImportPreview = { batchId: string; operationId?: string; academicYearId: string; entityType: "STUDENT" | "TEACHER"; rowCount: number; createCount: number; updateCount: number; errorCount: number; canCommit: boolean; requiresImmediateGlobalCapabilityAck?: boolean; acknowledgeImmediateGlobalCapabilityChange?: boolean; nextCursor?: string | null; rows: Array<{ rowNumber: number; action: string; accountName: string; legalName: string; errors: string[] }> };
type RotationPreview = { batchId: string; operationId?: string; eligible: Array<{ userId: string; accountName: string }>; conflicts: Array<{ userId: string; accountName: string; reason: string }> };
type ActivationPreview = { batchId?: string; operationId?: string; pendingAcknowledgement?: boolean; missingClassIds?: string[]; sourceAcademicYear?: string; targetAcademicYear?: string; sourceCount?: number; targetCount?: number; coverage?: Array<{ classId: string; grade: StudentGrade; classCode: ClassCode; viewTeacherIds: string[]; resetTeacherIds: string[]; acknowledged: boolean }> };
type MutationPreview = { batchId: string; counts?: Record<string, number>; payload?: { selectedCount?: number; excludedCount?: number }; students?: Array<{ studentId: string; accountName: string; legalName: string; sourceClassCode: ClassCode | null; disposition: string; targetClassCode: ClassCode | null }> };

const STUDENT_FIELDS = ["accountName", "studentNumber", "legalName", "nickname", "grade", "classCode", "contactEmail", "status", "mustChangePassword", "createdAt"];
const TEACHER_FIELDS = ["templateVersion", "accountName", "legalName", "contactEmail", "classAccess", "resetPasswordCapability", "status", "createdAt"];
const tabs = ["students", "teachers", "years", "imports", "promotion", "export"] as const;
type Tab = (typeof tabs)[number];
const controlClass = "h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--primary)]";
const primaryButton = "rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-bg)] disabled:opacity-50";
const secondaryButton = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text)] disabled:opacity-50";
const rosterStatusButton = "ui-button ui-button-small text-[12px]";
const suspendButton = `${rosterStatusButton} ui-button-danger`;
const restoreButton = `${rosterStatusButton} ui-button-secondary`;
const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "尚未登入，請先登入。",
  AUTH_BACKEND_UNAVAILABLE: "登入服務暫時無法使用，請稍後再試。",
  ROLE_FORBIDDEN: "你沒有權限進行這個操作。",
  RECENT_AUTH_REQUIRED: "安全驗證已過期，請重新驗證。",
  RECENT_AUTH_SESSION_INVALID: "登入狀態需要重新驗證，請重新登入。",
  ACADEMIC_YEAR_READ_ONLY: "這個學年已經結束，只能查看，不能修改。",
  ACADEMIC_YEAR_REQUIRED: "請選擇學年。",
  ACADEMIC_YEAR_NOT_FOUND: "找不到所選學年。",
  ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR: "目標學年必須是下一個學年。",
  ACADEMIC_YEAR_OVERLAP: "這個學年的日期與其他學年重疊。",
  CLASS_NOT_FOUND: "找不到所選班級。",
  CLASS_IN_USE: "這個班級仍有學生或教師使用，暫時不能停用。",
  CLASS_INVALID: "班級資料不正確，請重新選擇。",
  ROSTER_BATCH_EXPIRED: "這份名單預覽已經過期，請重新驗證。",
  ROSTER_BATCH_STALE: "名單資料已經改變，請重新預覽。",
  ROSTER_INPUT_INVALID: "名單格式不正確，請檢查後再試。",
  ROSTER_FILE_REQUIRED: "請選擇名單檔案。",
  ROSTER_FILE_EMPTY: "名單檔案沒有資料。",
  ROSTER_FILE_TOO_LARGE: "名單檔案不可超過 4 MiB。",
  ROSTER_FILE_INVALID: "名單檔案內容不正確，請檢查欄位、行數及工作表格式。",
  ROSTER_FILE_NAME_INVALID: "名單檔案名稱不正確，請重新命名後再試。",
  ROSTER_FORMAT_INVALID: "名單格式不正確，請使用 CSV 或 XLSX。",
  ROSTER_CONTENT_TYPE_INVALID: "名單檔案類型與副檔名不一致。",
  ROSTER_CONTENT_ENCODING_UNSUPPORTED: "名單上載不可使用額外壓縮編碼。",
  ROSTER_CONTENT_LENGTH_INVALID: "名單檔案大小資料不正確，請重新選擇檔案。",
  ROSTER_ENTITY_TYPE_INVALID: "名單角色不正確，請重新選擇學生或教師名單。",
  ROSTER_MODE_INVALID: "名單匯入模式不正確，請重新選擇。",
  ROSTER_ACKNOWLEDGEMENT_INVALID: "名單權限確認資料不正確，請重新預覽。",
  ROSTER_OPERATION_ID_INVALID: "名單操作識別資料不正確，請重新預覽。",
  ROSTER_HEADER_REQUIRED: "名單缺少必要欄位。",
  ROSTER_HEADER_UNKNOWN: "名單包含無法識別的欄位。",
  EXPORT_TOO_LARGE: "資料太多，暫時不能一次匯出。",
  EXPORT_INPUT_INVALID: "匯出設定不正確，請重新選擇。",
  EXPORT_RATE_LIMITED: "匯出次數過多，請稍後再試。",
  ACCESS_UPDATE_STALE: "教師權限已經改變，請重新載入後再儲存。",
  TEACHER_QUERY_STALE: "教師名單已經改變，請重新載入。",
  USER_NOT_FOUND: "找不到這個用戶。",
  RESET_TARGET_NOT_ACTIVE: "這個用戶目前不能重設密碼。",
  RESET_TARGET_ROLE_FORBIDDEN: "只能為學生或教師重設密碼。",
  ACCOUNT_OR_EMAIL_EXISTS: "帳號或聯絡電郵已經被使用。",
  NICKNAME_INVALID: "暱稱不符合規定，請重新輸入。",
  LEGAL_NAME_INVALID: "真實姓名不符合規定，請重新輸入。",
  PROMOTION_INPUT_INVALID: "升級資料不正確，請檢查後再試。",
  PROMOTION_DISPOSITION_REQUIRED: "請先為每位學生選擇安排方式。",
  YEAR_STATE_INVALID: "學年狀態不適合這個操作。",
  STALE_PREVIEW: "預覽資料已經改變，請重新預覽。",
  ROSTER_STATE_MISSING: "名單服務暫時無法使用，請稍後再試。",
};

async function responseMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { code?: string; error?: string } | null;
  return (payload?.code && ADMIN_ERROR_MESSAGES[payload.code]) || payload?.error || "操作未能完成，請稍後再試。";
}

function yearStatusLabel(status: AcademicYearStatus) {
  if (status === "CURRENT") return "目前使用中";
  if (status === "PLANNED") return "準備中";
  return "已結束（只讀）";
}

function dispositionLabel(value: string) {
  switch (value) {
    case "PROMOTE": return "正常升班";
    case "REPEAT": return "留級";
    case "HOLD_UNASSIGNED": return "暫不分班";
    case "GRADUATE": return "畢業";
    case "LEAVE": return "離校";
    case "MANUAL": return "手動安排";
    default: return "待處理";
  }
}

function exportFieldLabel(field: string) {
  const labels: Record<string, string> = {
    accountName: "帳號",
    studentNumber: "學號",
    legalName: "真實姓名",
    nickname: "暱稱",
    grade: "年級",
    classCode: "班別",
    contactEmail: "聯絡電郵",
    status: "帳號狀態",
    mustChangePassword: "下次登入需更改密碼",
    createdAt: "建立日期",
    templateVersion: "名單格式",
    classAccess: "可查看班級",
    resetPasswordCapability: "可重設學生密碼",
  };
  return labels[field] ?? field;
}

function importActionLabel(action: string) {
  const labels: Record<string, string> = {
    CREATE: "新增",
    UPDATE: "更新",
    UNCHANGED: "沒有改變",
    ERROR: "有錯誤",
  };
  return labels[action] ?? "待處理";
}

function importErrorLabel(error: string) {
  const replacements: Array<[string, string]> = [
    ["STUDENT_NUMBER_CONFLICT", "同一學年同一班別的學號已被使用，請改用其他學號"],
    ["MERGE 必須提供真實姓名", "合併資料時必須填寫真實姓名"],
    ["MERGE 必須提供暱稱", "合併資料時必須填寫暱稱"],
    ["檔案內聯絡電郵重複", "名單中的聯絡電郵重複"],
    ["聯絡電郵已被其他帳號使用", "聯絡電郵已經被其他帳號使用"],
    ["templateVersion 必須為 teacher-roster-v2", "教師名單格式不正確，請下載最新範本"],
    ["LEGACY_RESET_SCOPE_UNSUPPORTED", "舊格式不支援重設密碼權限，請下載最新教師範本"],
    ["帳號已經存在；僅新增模式不會覆蓋", "帳號已經存在；僅新增模式不會覆蓋"],
  ];
  return replacements.reduce((value, [from, to]) => value.replace(from, to), error)
    .replace(/^無法識別班級權限/, "無法識別班級")
    .replace(/所選學年不存在教師權限班級/, "所選學年不存在這個班級");
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
  const sheet = workbook.addWorksheet("臨時密碼");
  sheet.columns = [
    { header: "學生證號", key: "accountName", style: { numFmt: "@" } },
    { header: "真實姓名", key: "legalName", style: { numFmt: "@" } },
    { header: "一次性密碼", key: "temporaryPassword", style: { numFmt: "@" } },
  ];
  const safeText = (value: string) => /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  for (const row of rows) sheet.addRow({ accountName: safeText(String(row.accountName)), legalName: safeText(String(row.legalName)), temporaryPassword: safeText(String(row.temporaryPassword)) });
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "一次性密碼.xlsx");
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
  const [rosterSort, setRosterSort] = useState<"ACCOUNT_ASC" | "STUDENT_NUMBER_ASC">("STUDENT_NUMBER_ASC");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetClass, setTargetClass] = useState("");
  const [importType, setImportType] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [importTemplateFormat, setImportTemplateFormat] = useState<"csv" | "xlsx">("csv");
  const [mergeMode, setMergeMode] = useState(false);
  const [ackImmediateGlobalReset, setAckImmediateGlobalReset] = useState(false);
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
    const userResponse = await rosterFetch("/api/admin/users/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "STUDENT", academicYearId: yearId, search: search.trim() || undefined, grade: filterGrade || undefined, classCode: filterClass || undefined, sort: rosterSort, limit: 100 }) });
    const classResponse = await fetch(`/api/admin/classes?academicYearId=${encodeURIComponent(yearId)}`);
    if (!userResponse.ok) throw new Error(await responseMessage(userResponse));
    if (!classResponse.ok) throw new Error(await responseMessage(classResponse));
    const userPayload = await userResponse.json() as { items?: RosterUser[]; nextCursor?: string | null } | RosterUser[];
    const rows = Array.isArray(userPayload) ? userPayload : userPayload.items ?? [];
    setUsers(rows);
    setNextUserCursor(Array.isArray(userPayload) ? null : userPayload.nextCursor ?? null);
    setClasses(await classResponse.json() as SchoolClass[]);
  }, [yearId, search, filterGrade, filterClass, rosterSort]);
  async function loadMoreUsers() {
    if (!yearId || !nextUserCursor) return;
    const response = await rosterFetch("/api/admin/users/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "STUDENT", academicYearId: yearId, search: search.trim() || undefined, grade: filterGrade || undefined, classCode: filterClass || undefined, sort: rosterSort, cursor: nextUserCursor, limit: 100 }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as { items?: RosterUser[]; nextCursor?: string | null };
    setUsers((current) => [...current, ...(payload.items ?? [])]);
    setNextUserCursor(payload.nextCursor ?? null);
  }
  useEffect(() => {
    let active = true;
    async function syncYears() {
      try { await loadYears(); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "讀取學年失敗"); }
    }
    void syncYears();
    return () => { active = false; };
  }, [loadYears]);
  useEffect(() => {
    let active = true;
    async function syncData() {
      try { await loadData(); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "讀取名單失敗"); }
    }
    void syncData();
    return () => { active = false; };
  }, [loadData]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); } finally { setBusy(false); }
  }

  async function previewImport() {
    const file = fileRef.current?.files?.[0];
    if (!file || !yearId) throw new Error("請選擇學年及 CSV/XLSX 名單");
    const contentType = file.name.toLowerCase().endsWith(".csv")
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const response = await rosterFetch("/api/admin/roster/import/preview", {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Roster-File-Name": encodeURIComponent(file.name),
        "X-Roster-Academic-Year-Id": yearId,
        "X-Roster-Entity-Type": importType,
        "X-Roster-Mode": mergeMode ? "MERGE" : "CREATE_ONLY",
        "X-Roster-Acknowledge-Immediate-Global-Capability-Change": String(ackImmediateGlobalReset),
        "X-Roster-Operation-Id": crypto.randomUUID(),
      },
      body: file,
    });
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
    setCredentials(payload.credentials ?? []); setLastImportBatchId(importPreview.batchId); setImportPreview(null); setMessage(`已匯入 ${payload.summary?.rowCount ?? 0} 行；臨時密碼只會顯示今次。`); await loadData();
  }
  async function previewRotation() {
    if (!lastImportBatchId) throw new Error("沒有可重新產生密碼的最近匯入批次");
    const response = await rosterFetch(`/api/admin/roster/import/${lastImportBatchId}/rotate-credentials/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setRotationPreview(await response.json() as RotationPreview);
  }
  async function commitRotation() {
    if (!rotationPreview) return;
    const response = await rosterFetch(`/api/admin/roster/import/${rotationPreview.batchId}/rotate-credentials/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: rotationPreview.operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = await response.json() as { credentials?: Array<{ accountName: string; legalName: string; temporaryPassword: string }> };
    setCredentials(payload.credentials ?? []); setRotationPreview(null); setMessage("符合條件的未改密帳號已重新產生臨時密碼。");
  }
  async function downloadTemplate() {
    const response = await fetch(`/api/admin/roster/import/templates/${importType}/${importTemplateFormat}`);
    if (!response.ok) throw new Error(await responseMessage(response));
    downloadBlob(await response.blob(), `${importType === "TEACHER" ? "教師" : "學生"}-名單範本.${importTemplateFormat}`);
  }
  async function previewBulk() {
    if (!yearId || !selected.size) throw new Error("請選擇學生");
    const response = await rosterFetch("/api/admin/roster/students/bulk-class/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYearId: yearId, mode: "explicit", studentIds: [...selected], classCode: targetClass || null, excludedIds: [], operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setBulkPreview(await response.json() as MutationPreview); setTab("students");
  }
  async function commitBulk() {
    if (!bulkPreview) return;
    const response = await rosterFetch("/api/admin/roster/students/bulk-class/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectionBatchId: bulkPreview.batchId, operationId: (bulkPreview as MutationPreview & { operationId?: string }).operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setMessage("批量轉班已完成。"); setBulkPreview(null); setSelected(new Set()); await loadData();
  }
  async function previewPromotion() {
    if (!yearId || !promotionTargetYear) throw new Error("請選擇原學年及目標學年");
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
    setMessage("升級計劃已儲存至目標學年，須在啟用學年前完成學年啟用。"); setPromotionPreview(null); await loadData();
  }
  async function setStatus(user: RosterUser, status: "ACTIVE" | "SUSPENDED") {
    const response = await rosterFetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "CHANGE_STATUS", status, expectedUserRevision: user.revision }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    const updated = await response.json().catch(() => null) as { status?: RosterUser["status"] } | null;
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: updated?.status ?? status, revision: item.revision + 1 } : item));
    setMessage(status === "ACTIVE" ? "帳號已恢復。" : "帳號已停權。");
    await loadData();
  }
  async function createYear() {
    if (!newYearLabel) throw new Error("請輸入學年，例如 2026-2027");
    const response = await rosterFetch("/api/admin/academic-years", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: newYearLabel }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setNewYearLabel(""); setMessage("新學年已建立。"); await loadYears();
  }
  async function createClass() {
    if (!yearId) throw new Error("請選擇學年");
    const response = await rosterFetch("/api/admin/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ academicYearId: yearId, grade: newClassGrade, classCode: newClassCode }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setMessage("班級已建立。"); await loadData();
  }
  async function toggleClass(schoolClass: SchoolClass) {
    const response = await rosterFetch(`/api/admin/classes/${schoolClass.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !schoolClass.active, revision: schoolClass.revision }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    await loadData();
  }
  async function previewActivation() {
    if (!yearId || !activationTargetYear) throw new Error("請選擇原學年及目標學年");
    const response = await rosterFetch(`/api/admin/academic-years/${yearId}/activation/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetAcademicYearId: activationTargetYear, acknowledgedClassIds: [...activationAcknowledged], operationId: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setActivationPreview(await response.json() as ActivationPreview);
  }
  async function commitActivation() {
    if (!activationPreview?.batchId) throw new Error("請先確認每個班級的教師查看權限");
    const response = await rosterFetch(`/api/admin/academic-years/${yearId}/activation/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: activationPreview.batchId, operationId: activationPreview.operationId }) });
    if (!response.ok) throw new Error(await responseMessage(response));
    setActivationPreview(null); setMessage("學年已啟用。"); await loadYears(); await loadData();
  }
  async function exportRoster() {
    if (!yearId || !exportFields.length) throw new Error("請選擇學年及至少一欄");
    const body = { entityType: exportType, academicYearId: yearId, format: exportFormat, fields: exportFields, filters: { grade: filterGrade || undefined, classCode: filterClass || undefined, search: search || undefined } };
    const previewResponse = await rosterFetch("/api/admin/roster/export/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!previewResponse.ok) throw new Error(await responseMessage(previewResponse));
    const count = (await previewResponse.json() as { count: number }).count;
    if (!window.confirm(`將下載 ${count} 行；繼續？`)) return;
    const response = await rosterFetch("/api/admin/roster/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await responseMessage(response));
    downloadBlob(await response.blob(), `${exportType.toLowerCase()}-roster.${exportFormat.toLowerCase()}`); setMessage("名單已匯出。");
  }

  const tabLabels: Record<Tab, string> = { students: "學生名冊", teachers: "教師名冊", years: "學年及班級", imports: "匯入", promotion: "升級", export: "匯出" };
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
      if (!input.getAttribute("aria-label")) input.setAttribute("aria-label", input.getAttribute("placeholder") ?? tc("輸入內容"));
    });
    const selectLabels: Record<Tab, string[]> = {
      students: [],
      teachers: ["選擇教師"],
      years: ["新學年年級", "新學年班別", "選擇目標學年"],
      imports: ["名單類型", "匯入範本格式"],
      promotion: ["升級年級", "選擇目標學年"],
      export: ["匯出類型", "匯出格式"],
    };
    root.querySelectorAll<HTMLSelectElement>("select:not([aria-label])").forEach((select, index) => {
      const label = selectLabels[tab][index];
      if (label) select.setAttribute("aria-label", tc(label));
    });
    root.querySelectorAll<HTMLInputElement>('input[type="file"]:not([aria-label])').forEach((input) => input.setAttribute("aria-label", tc("上載 CSV 或 XLSX 名單")));
    const panel = root.querySelector<HTMLElement>("section");
    if (panel) {
      panel.id = `roster-panel-${tab}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `roster-tab-${tab}`);
      panel.tabIndex = -1;
    }
  }, [tab, tc]);

  return <div data-roster-page className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">{tc("學校名冊")}</p><h1 className="mt-1 text-[24px] font-bold text-[var(--text)]">{tc("班級、學生與教師")}</h1><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("所有操作只作用於你所選的學年。")}</p></div><Link href="/admin/users" className={secondaryButton}>{tc("逐個新增／編輯帳號")}</Link></div>
    {error ? <div aria-live="assertive"><ErrorBanner message={error} /></div> : null}{message ? <div role="status" aria-live="polite" className="rounded-2xl bg-[var(--border-soft)] p-4 text-[13px] text-[var(--primary)]">{tc(message)}</div> : null}
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={tc("名冊管理區段")}>{tabs.map((item, index) => <button key={item} id={`roster-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`roster-panel-${item}`} tabIndex={tab === item ? 0 : -1} className={tab === item ? primaryButton : secondaryButton} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{tc(tabLabels[item])}</button>)}</div>
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"><label className="text-[13px] text-[var(--muted)]">{tc("指定學年")}</label><select aria-label={tc("指定學年")} className={controlClass} value={yearId} onChange={(event) => setYearId(event.target.value)}>{years.map((year) => <option key={year.id} value={year.id}>{year.label} · {tc(yearStatusLabel(year.status))}</option>)}</select>{currentYear ? <span className="text-[12px] text-[var(--muted)]">{currentYear.status === "CLOSED" ? tc("歷史只讀") : tc("可以編輯")}</span> : null}</div>
    {tab === "students" && nextUserCursor ? <button className={secondaryButton} disabled={busy} onClick={() => void run(loadMoreUsers)}>{tc("載入更多學生")}</button> : null}

    {tab === "students" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold text-[var(--text)]">{tc("學生名冊")}</h2><div className="mt-3 flex flex-wrap gap-2"><input className={controlClass} placeholder={tc("搜尋帳號／姓名／暱稱")} value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label={tc("年級篩選")} value={filterGrade} onChange={(event) => setFilterGrade(event.target.value)} className={controlClass}><option value="">{tc("所有年級")}</option>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select aria-label={tc("班別篩選")} value={filterClass} onChange={(event) => setFilterClass(event.target.value)} className={controlClass}><option value="">{tc("所有班別")}</option>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(CLASS_LABELS[code])}</option>)}</select><select aria-label={tc("學生排序")} value={rosterSort} onChange={(event) => setRosterSort(event.target.value as typeof rosterSort)} className={controlClass}><option value="STUDENT_NUMBER_ASC">{tc("按學號排序")}</option><option value="ACCOUNT_ASC">{tc("按帳號排序")}</option></select><button className={secondaryButton} onClick={() => setSelected(new Set(students.map((student) => student.id)))}>{tc(`全選本頁 ${students.length} 人`)}</button><button className={secondaryButton} onClick={() => setSelected(new Set())}>{tc("清除選擇")}</button></div><div className="mt-3 space-y-2 md:hidden">{students.map((student) => <article key={student.id} className="rounded-2xl border border-[var(--border)] p-3 text-[12px]"><div className="flex items-start justify-between gap-3"><label className="flex items-center gap-2 font-semibold"><input aria-label={student.accountName} type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })} /><span>{student.accountName}</span></label><button type="button" data-testid="roster-status-toggle" aria-label={tc(student.status === "ACTIVE" ? "停權學生" : "恢復學生")} className={student.status === "ACTIVE" ? suspendButton : restoreButton} disabled={busy} onClick={() => void run(() => setStatus(student, student.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"))}>{student.status === "ACTIVE" ? tc("停權") : tc("恢復")}</button></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2"><div><dt className="text-[var(--muted)]">{tc("學號")}</dt><dd>{student.studentNumber ?? tc("未設定")}</dd></div><div><dt className="text-[var(--muted)]">{tc("真實姓名")}</dt><dd>{student.legalName}</dd></div><div><dt className="text-[var(--muted)]">{tc("暱稱")}</dt><dd>{student.nickname ?? "—"}</dd></div><div><dt className="text-[var(--muted)]">{tc("年級")}</dt><dd>{student.grade ? tc(GRADE_LABELS[student.grade]) : tc("未分配")}</dd></div><div><dt className="text-[var(--muted)]">{tc("班別")}</dt><dd>{student.classCode ? tc(CLASS_LABELS[student.classCode]) : tc("未分班")}</dd></div><div><dt className="text-[var(--muted)]">{tc("狀態")}</dt><dd>{student.status === "ACTIVE" ? tc("使用中") : tc("已停權")}</dd></div></dl></article>)}</div><div className="mt-3 hidden max-h-[28rem] overflow-auto md:block"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr><th></th><th>{tc("學生證")}</th><th>{tc("學號")}</th><th>{tc("真實姓名")}</th><th>{tc("暱稱")}</th><th>{tc("年級")}</th><th>{tc("班別")}</th><th>{tc("狀態")}</th><th>{tc("操作")}</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t border-[var(--border)]"><td className="py-2"><input aria-label={student.accountName} type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })} /></td><td>{student.accountName}</td><td>{student.studentNumber ?? tc("未設定")}</td><td>{student.legalName}</td><td>{student.nickname ?? "—"}</td><td>{student.grade ? tc(GRADE_LABELS[student.grade]) : tc("未分配")}</td><td>{student.classCode ? tc(CLASS_LABELS[student.classCode]) : tc("未分班")}</td><td>{student.status === "ACTIVE" ? tc("使用中") : tc("已停權")}</td><td><button type="button" data-testid="roster-status-toggle" aria-label={tc(student.status === "ACTIVE" ? "停權學生" : "恢復學生")} className={student.status === "ACTIVE" ? suspendButton : restoreButton} disabled={busy} onClick={() => void run(() => setStatus(student, student.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"))}>{student.status === "ACTIVE" ? tc("停權") : tc("恢復")}</button></td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-[13px] text-[var(--muted)]">{tc(`已選 ${selected.size} 人`)}</span><select aria-label={tc("目標班別")} value={targetClass} onChange={(event) => setTargetClass(event.target.value)} className={controlClass}><option value="">{tc("轉為未分班")}</option>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(`${CLASS_LABELS[code]}班`)}</option>)}</select><button className={primaryButton} disabled={busy || !selected.size || currentYear?.status !== "CURRENT"} onClick={() => void run(previewBulk)}>{tc("預覽批量轉班")}</button></div>{bulkPreview ? <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><p className="text-[13px]">{tc(`已選 ${bulkPreview.payload?.selectedCount ?? 0} 人；確認後才會寫入。`)}</p><button className={`${primaryButton} mt-3`} onClick={() => void run(commitBulk)}>{tc("確認批量轉班")}</button></div> : null}</section> : null}

    {tab === "teachers" ? <AdminTeacherAccessEditor yearId={yearId} onMessage={setMessage} /> : null}

    {tab === "years" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold text-[var(--text)]">{tc("學年及班級設定")}</h2><div className="mt-3 flex flex-wrap gap-2"><input className={controlClass} placeholder="2026-2027" value={newYearLabel} onChange={(event) => setNewYearLabel(event.target.value)} /><button className={primaryButton} onClick={() => void run(createYear)}>{tc("建立新學年")}</button></div><div className="mt-4 flex flex-wrap gap-2"><select className={controlClass} value={newClassGrade} onChange={(event) => setNewClassGrade(event.target.value as StudentGrade)}>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select className={controlClass} value={newClassCode} onChange={(event) => setNewClassCode(event.target.value as ClassCode)}>{CLASS_CODES.map((code) => <option key={code} value={code}>{tc(CLASS_LABELS[code])}</option>)}</select><button className={primaryButton} disabled={!yearId || currentYear?.status === "CLOSED"} onClick={() => void run(createClass)}>{tc("建立班級")}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{classes.map((schoolClass) => <div key={schoolClass.id} className="rounded-2xl border border-[var(--border)] p-3 text-[12px]"><div className="font-semibold">{tc(GRADE_LABELS[schoolClass.grade])}{tc(`${CLASS_LABELS[schoolClass.classCode]}班`)}</div><div className="mt-1 text-[var(--muted)]">{schoolClass.active ? tc("啟用") : tc("已停用")}</div><button className="mt-2 text-[var(--primary)] disabled:opacity-50" disabled={currentYear?.status === "CLOSED"} onClick={() => void run(() => toggleClass(schoolClass))}>{schoolClass.active ? tc("停用") : tc("重新啟用")}</button></div>)}</div><div className="mt-6 rounded-2xl border border-[var(--border)] p-4"><h3 className="font-semibold">{tc("啟用新學年")}</h3><div className="mt-3 flex flex-wrap gap-2"><select className={controlClass} value={activationTargetYear} onChange={(event) => { setActivationTargetYear(event.target.value); setActivationPreview(null); }}><option value="">{tc("選擇目標學年")}</option>{plannedYears.filter((year) => year.id !== yearId).map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select><button className={primaryButton} disabled={busy || currentYear?.status !== "CURRENT"} onClick={() => void run(previewActivation)}>{tc("預覽啟用")}</button></div>{activationPreview?.coverage ? <div className="mt-3 space-y-2 text-[12px]"><p>{tc(`目前學年 ${activationPreview.sourceCount ?? 0} 人；目標學年 ${activationPreview.targetCount ?? 0} 人`)}</p>{activationPreview.coverage.map((item) => <label key={item.classId} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-2"><input type="checkbox" checked={activationAcknowledged.has(item.classId)} onChange={(event) => setActivationAcknowledged((current) => { const next = new Set(current); if (event.target.checked) next.add(item.classId); else next.delete(item.classId); return next; })} disabled={item.viewTeacherIds.length > 0} /><span>{tc(GRADE_LABELS[item.grade])}{tc(`${CLASS_LABELS[item.classCode]}班`)} · {item.viewTeacherIds.length ? tc(`${item.viewTeacherIds.length} 位可查看教師`) : tc("沒有可查看教師，需確認")}</span></label>)}<div className="flex gap-2"><button className={secondaryButton} onClick={() => void run(previewActivation)}>{tc("按確認重新預覽")}</button>{activationPreview.batchId ? <button className={primaryButton} onClick={() => void run(commitActivation)}>{tc("確認啟用")}</button> : null}</div></div> : null}</div></section> : null}

    {tab === "imports" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("學生／教師 CSV、XLSX 匯入")}</h2><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("先預覽；所有錯誤修正後才可提交。暫存資料 30 分鐘後失效。")}</p><div className="mt-4 flex flex-wrap gap-2"><select value={importType} onChange={(event) => { setImportType(event.target.value as "STUDENT" | "TEACHER"); setImportPreview(null); }} className={controlClass}><option value="STUDENT">{tc("學生名單")}</option><option value="TEACHER">{tc("教師名單")}</option></select><input ref={fileRef} type="file" accept=".csv,.xlsx" className={`${controlClass} max-w-full pt-2`} /><label className="flex items-center gap-2 px-2 text-[13px] text-[var(--muted)]"><input type="checkbox" checked={mergeMode} onChange={(event) => setMergeMode(event.target.checked)} />{tc("合併現有同角色帳號")}</label>{importType === "TEACHER" && currentYear?.status === "PLANNED" ? <label className="flex items-center gap-2 px-2 text-[13px] text-[var(--muted)]"><input type="checkbox" checked={ackImmediateGlobalReset} onChange={(event) => setAckImmediateGlobalReset(event.target.checked)} />{tc("確認教師的全部班級重設權限會即時影響目前班級")}</label> : null}<select value={importTemplateFormat} onChange={(event) => setImportTemplateFormat(event.target.value as "csv" | "xlsx")} className={controlClass} aria-label={tc("範本格式")}><option value="csv">CSV</option><option value="xlsx">XLSX</option></select><button className={secondaryButton} onClick={() => void run(downloadTemplate)}>{tc(importType === "TEACHER" ? "下載教師名單範本" : "下載學生名單範本")}</button><button className={primaryButton} disabled={busy || currentYear?.status === "CLOSED"} onClick={() => void run(previewImport)}>{tc("驗證及預覽")}</button></div>{importPreview ? <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><p className="text-[13px]">{tc(`共 ${importPreview.rowCount} 行：新增 ${importPreview.createCount}、更新 ${importPreview.updateCount}、錯誤 ${importPreview.errorCount}`)}</p>{importPreview.requiresImmediateGlobalCapabilityAck ? <p className="mt-2 text-[13px] text-[var(--warning)]">{tc("此預覽包含會即時影響目前班級的教師全域重設能力變更；請勾選確認後重新預覽。")}</p> : null}<div className="mt-3 max-h-64 overflow-auto text-[12px]"><table className="w-full text-left"><thead><tr><th>{tc("行號")}</th><th>{tc("帳號")}</th><th>{tc("姓名")}</th><th>{tc("結果")}</th></tr></thead><tbody>{importPreview.rows.map((row) => <tr key={row.rowNumber} className="border-t border-[var(--border)]"><td className="py-2">{row.rowNumber}</td><td>{row.accountName}</td><td>{row.legalName}</td><td className={row.errors.length ? "text-[var(--danger)]" : "text-[var(--primary)]"}>{row.errors.length ? row.errors.map(importErrorLabel).join("；") : tc(importActionLabel(row.action))}</td></tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap gap-3"><button className={primaryButton} disabled={busy || !importPreview.canCommit} onClick={() => void run(commitImport)}>{tc("確認並匯入")}</button>{importPreview.nextCursor ? <button className={secondaryButton} disabled={busy} onClick={() => void run(loadMoreImportRows)}>{tc("載入更多預覽行")}</button> : null}<button className="text-[13px] text-[var(--muted)]" onClick={() => void run(async () => { const response = await rosterFetch(`/api/admin/roster/import/${importPreview.batchId}/cancel`, { method: "POST" }); if (!response.ok) throw new Error(await responseMessage(response)); setImportPreview(null); })}>{tc("取消暫存")}</button></div></div> : null}{lastImportBatchId ? <div className="mt-3 rounded-2xl border border-[var(--border)] p-3 text-[12px]"><p>{tc("如一次性密碼遺失，可在 24 小時內重新預覽未改密帳號。")}</p><button className={`${secondaryButton} mt-2`} onClick={() => void run(previewRotation)}>{tc("預覽重新產生密碼")}</button>{rotationPreview ? <><span className="ml-2">{tc(`符合條件 ${rotationPreview.eligible.length} 人；衝突 ${rotationPreview.conflicts.length} 人`)}</span><button className={`${primaryButton} ml-2`} onClick={() => void run(commitRotation)}>{tc("確認重新產生")}</button></> : null}</div> : null}{credentials ? <div className="mt-4 rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning-bg)] p-4"><p className="font-semibold text-[var(--warning)]">{tc("一次性臨時密碼：關閉後不可再次取得。")}</p><div className="mt-2 max-h-48 overflow-auto font-mono text-[12px]">{credentials.map((item) => <div key={item.accountName}>{item.accountName}　{item.legalName}　{item.temporaryPassword}</div>)}</div><button className={`${secondaryButton} mt-3`} onClick={() => void run(() => downloadCredentialXlsx(credentials))}>{tc("下載 Excel（XLSX）報告")}</button><button className="ml-3 text-[13px] text-[var(--warning)]" onClick={() => setCredentials(null)}>{tc("儲存並關閉")}</button></div> : null}</section> : null}

    {tab === "promotion" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("全級升級及剔除名單")}</h2><div className="mt-3 flex flex-wrap gap-2"><select className={controlClass} value={promotionGrade} onChange={(event) => setPromotionGrade(event.target.value as StudentGrade)}>{STUDENT_GRADES.map((grade) => <option key={grade} value={grade}>{tc(GRADE_LABELS[grade])}</option>)}</select><select className={controlClass} value={promotionTargetYear} onChange={(event) => setPromotionTargetYear(event.target.value)}><option value="">{tc("選擇目標學年")}</option>{plannedYears.filter((year) => year.id !== yearId).map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select><button className={primaryButton} disabled={busy} onClick={() => void run(previewPromotion)}>{tc("預覽升級")}</button></div>{promotionPreview?.students ? <div className="mt-4"><p className="text-[13px] text-[var(--muted)]">{tc(`共 ${promotionPreview.students.length} 人；未升班的學生會列在剔除名單中。`)}</p><div className="mt-2 max-h-64 overflow-auto">{promotionPreview.students.map((student) => <label key={student.studentId} className="flex items-center gap-3 border-t border-[var(--border)] py-2 text-[12px]"><input type="checkbox" checked={!excludedPromotion.has(student.studentId)} onChange={() => setExcludedPromotion((current) => { const next = new Set(current); if (next.has(student.studentId)) next.delete(student.studentId); else next.add(student.studentId); return next; })} /><span className="font-mono">{student.accountName}</span><span>{student.legalName}</span><span>{tc(dispositionLabel(student.disposition))}</span><span>{student.targetClassCode ? tc(`${CLASS_LABELS[student.targetClassCode]}班`) : tc("未分班")}</span></label>)}</div><button className={`${primaryButton} mt-3`} disabled={busy} onClick={() => void run(commitPromotion)}>{tc("儲存升級名單")}</button></div> : null}</section> : null}

    {tab === "export" ? <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-[17px] font-bold">{tc("匯出目前名單")}</h2><p className="mt-1 text-[13px] text-[var(--muted)]">{tc("匯出目前系統整理出的全部資料；超過 5,000 行會整體拒絕。")}</p><div className="mt-3 flex flex-wrap gap-2"><select value={exportType} onChange={(event) => { const next = event.target.value as "STUDENT" | "TEACHER"; setExportType(next); setExportFields(next === "STUDENT" ? STUDENT_FIELDS : TEACHER_FIELDS); }} className={controlClass}><option value="STUDENT">{tc("學生")}</option><option value="TEACHER">{tc("教師")}</option></select><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "CSV" | "XLSX")} className={controlClass}><option value="XLSX">XLSX</option><option value="CSV">CSV</option></select><button className={primaryButton} disabled={busy || !exportFields.length} onClick={() => void run(exportRoster)}>{tc("預覽並下載")}</button></div><div className="mt-3 flex flex-wrap gap-3">{(exportType === "STUDENT" ? STUDENT_FIELDS : TEACHER_FIELDS).map((field) => <label key={field} className="text-[12px] text-[var(--muted)]"><input className="mr-1" type="checkbox" checked={exportFields.includes(field)} onChange={() => setExportFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} />{tc(exportFieldLabel(field))}</label>)}</div></section> : null}
  </div>;
}
