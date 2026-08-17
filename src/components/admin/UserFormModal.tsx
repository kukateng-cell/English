"use client";

import { useState } from "react";
import Modal from "./Modal";
import { ROLES, DEFAULT_ROLE, type Role } from "@/lib/roles";
import { useLocale } from "@/components/LocaleProvider";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export interface UserFormData {
  email: string;
  name: string;
  contactEmail: string;
  nickname: string;
  grade: string;
  classCode: string;
  studentNumber: string;
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  password: string;
  academicYearId: string;
}

interface UserFormModalProps {
  open: boolean;
  /** 傳入则編輯模式；否则新增模式。 */
  user?: {
    id: string;
    email: string;
    name: string | null;
    contactEmail?: string | null;
    nickname?: string | null;
    grade?: string | null;
    classCode?: string | null;
    studentNumber?: number | null;
    role: string;
    status?: "ACTIVE" | "SUSPENDED";
    academicYearId?: string | null;
  } | null;
  academicYears?: Array<{ id: string; label: string; status: "PLANNED" | "CURRENT" | "CLOSED" }>;
  /** 自己的 userId，用於禁止把自己降级提示。 */
  currentUserId?: string;
  onClose: () => void;
  onSubmit: (data: UserFormData) => Promise<void>;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: ROLES.STUDENT, label: "學生" },
  { value: ROLES.TEACHER, label: "教師" },
  { value: ROLES.ADMIN, label: "管理員" },
];

function academicYearStatusLabel(status: "PLANNED" | "CURRENT" | "CLOSED") {
  if (status === "CURRENT") return "目前使用中";
  if (status === "PLANNED") return "準備中";
  return "已結束（只讀）";
}

/** 共用的輸入框樣式，与登录页风格保持一致。 */
const inputClass =
  "h-[44px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)] dark:focus:border-[var(--primary)]";

export default function UserFormModal({
  open,
  user,
  currentUserId,
  onClose,
  onSubmit,
  academicYears = [],
}: UserFormModalProps) {
  const isEdit = !!user;
  // 用 lazy initializer 从 props 取初值；父组件通过 key 在每次打开时强制 remount，
  // 从而避免在 effect 里 setState（react-hooks/set-state-in-effect）。
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [contactEmail, setContactEmail] = useState(user?.contactEmail ?? "");
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [grade, setGrade] = useState(user?.grade ?? "");
  const [classCode, setClassCode] = useState(user?.classCode ?? "");
  const [studentNumber, setStudentNumber] = useState(user?.studentNumber === null || user?.studentNumber === undefined ? "" : String(user.studentNumber));
  const [role, setRole] = useState<Role>(
    (user?.role as Role) ?? DEFAULT_ROLE
  );
  const [status, setStatus] = useState<"ACTIVE" | "SUSPENDED">(
    user?.status ?? "ACTIVE",
  );
  const [password, setPassword] = useState("");
  const [academicYearId, setAcademicYearId] = useState(user?.academicYearId ?? academicYears.find((year) => year.status === "CURRENT")?.id ?? academicYears.find((year) => year.status === "PLANNED")?.id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { tc } = useLocale();

  const isSelf = user?.id === currentUserId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("帳號不能為空");
      return;
    }
    if (!isEdit && password && password.length < MIN_PASSWORD_LENGTH) {
      setError(`密碼至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (role !== ROLES.ADMIN && !name.trim()) {
      setError("真實姓名不能為空");
      return;
    }
    if (!isEdit && role === ROLES.STUDENT && !nickname.trim()) {
      setError("暱稱不能為空");
      return;
    }
    if (!isEdit && role === ROLES.STUDENT && !grade) {
      setError("學生年級不能為空");
      return;
    }
    if (!isEdit && role === ROLES.STUDENT && !academicYearId) {
      setError("學生所屬學年不能為空");
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        email: email.trim(),
        name: name.trim(),
        contactEmail: contactEmail.trim(),
        nickname: nickname.trim(),
        grade,
        classCode,
        studentNumber,
        role,
        status,
        password: isEdit ? "" : password,
        academicYearId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? tc("編輯用戶") : tc("新增用戶")}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="user-form-account" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("帳號")}
          </label>
          <input
            id="user-form-account"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="如 student01"
            disabled={isEdit}
            className={inputClass}
          />
          {isEdit && (
            <p className="mt-1 text-[11px] text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("帳號名稱建立後不可修改")}
            </p>
          )}
        </div>

        {isEdit ? (
          <div>
            <label htmlFor="user-form-status" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">
              {tc("帳號狀態")}
            </label>
            <select
              id="user-form-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "ACTIVE" | "SUSPENDED")
              }
              disabled={isSelf}
              className={inputClass}
            >
              <option value="ACTIVE">{tc("啟用")}</option>
                <option value="SUSPENDED">{tc("停權")}</option>
            </select>
            {isSelf ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {tc("不能停權自己的管理員帳號")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label htmlFor="user-form-legal-name" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc(role === ROLES.ADMIN ? "姓名（可選）" : "真實姓名")}
          </label>
          <input
            id="user-form-legal-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tc("顯示名稱")}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="user-form-contact-email" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">
            {tc("聯絡電郵（可選）")}
          </label>
          <input
            id="user-form-contact-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="student@example.com"
            className={inputClass}
          />
        </div>

        {role === ROLES.STUDENT ? (
          <>
            <div>
              <label htmlFor="user-form-nickname" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">{tc("公開暱稱")}</label>
              <input id="user-form-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={tc("排行榜顯示名稱")} className={inputClass} />
            </div>
            {!isEdit ? (
              <>
              <div className="mb-3">
                <label htmlFor="user-form-academic-year" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">{tc("指定學年")}</label>
                <select id="user-form-academic-year" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} className={inputClass}>
                  <option value="">{tc("請選擇")}</option>
                  {academicYears.map((year) => <option key={year.id} value={year.id} disabled={year.status === "CLOSED"}>{year.label} · {tc(academicYearStatusLabel(year.status))}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="user-form-grade" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">{tc("年級")}</label>
                  <select id="user-form-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass}>
                    <option value="">{tc("請選擇")}</option>
                    <option value="JUNIOR_1">{tc("初一")}</option><option value="JUNIOR_2">{tc("初二")}</option><option value="JUNIOR_3">{tc("初三")}</option>
                    <option value="SENIOR_1">{tc("高一")}</option><option value="SENIOR_2">{tc("高二")}</option><option value="SENIOR_3">{tc("高三")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="user-form-class-code" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">{tc("班別（可留空）")}</label>
                  <select id="user-form-class-code" value={classCode} onChange={(e) => setClassCode(e.target.value)} className={inputClass}>
                    <option value="">{tc("未分班")}</option>
                    {[["A","甲"],["B","乙"],["C","丙"],["D","丁"],["E","戊"],["F","己"],["G","庚"],["H","辛"]].map(([value,label]) => <option key={value} value={value}>{tc(label)}</option>)}
                  </select>
                </div>
              </div>
              </>
            ) : null}
            <div>
              <label htmlFor="user-form-student-number" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)]">{tc("學號（可留空）")}</label>
              <input id="user-form-student-number" inputMode="numeric" pattern="[0-9]*" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} placeholder={tc("例如 1、2、3")} className={inputClass} />
            </div>
          </>
        ) : null}

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("角色")}
          </span>
          <div className="flex gap-2">
            {ROLE_OPTIONS.map((opt) => {
              const disabled = isEdit;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRole(opt.value)}
                  className={`flex-1 rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition disabled:opacity-40 ${
                    role === opt.value
                      ? "bg-[var(--primary)] text-[var(--color-surface)] shadow-sm"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)]/30 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]"
                  }`}
                >
                  {tc(opt.label)}
                </button>
              );
            })}
          </div>
          {isEdit && (
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              {tc("帳號建立後不能直接轉換角色")}
            </p>
          )}
        </div>

        {!isEdit ? <div>
          <label htmlFor="user-form-password" className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("密碼（留空自動產生）")}
          </label>
          <input
            id="user-form-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tc("留空則產生一次性隨機密碼")}
            className={inputClass}
          />
        </div> : null}

        {error && (
          <div id="user-form-error" role="alert" aria-live="assertive" className="rounded-2xl bg-[var(--danger-bg)] px-4 py-2.5 text-[13px] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
            {tc(error)}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-[15px] font-semibold text-[var(--color-surface)] shadow-sm transition disabled:opacity-50"
        >
          {loading ? tc("儲存中…") : isEdit ? tc("儲存修改") : tc("建立用戶")}
        </button>
      </form>
    </Modal>
  );
}
