"use client";

import { useState } from "react";
import Modal from "./Modal";
import { ROLES, DEFAULT_ROLE, type Role } from "@/lib/roles";
import { useLocale } from "@/components/LocaleProvider";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export interface UserFormData {
  email: string;
  name: string;
  role: Role;
  password: string;
}

interface UserFormModalProps {
  open: boolean;
  /** 传入则编辑模式；否则新建模式。 */
  user?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  } | null;
  /** 自己的 userId，用于禁止把自己降级提示。 */
  currentUserId?: string;
  onClose: () => void;
  onSubmit: (data: UserFormData) => Promise<void>;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: ROLES.STUDENT, label: "学生" },
  { value: ROLES.TEACHER, label: "老师" },
  { value: ROLES.ADMIN, label: "管理员" },
];

/** 共用的输入框样式，与登录页风格保持一致。 */
const inputClass =
  "h-[44px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)] dark:focus:border-[var(--primary)]";

export default function UserFormModal({
  open,
  user,
  currentUserId,
  onClose,
  onSubmit,
}: UserFormModalProps) {
  const isEdit = !!user;
  // 用 lazy initializer 从 props 取初值；父组件通过 key 在每次打开时强制 remount，
  // 从而避免在 effect 里 setState（react-hooks/set-state-in-effect）。
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(
    (user?.role as Role) ?? DEFAULT_ROLE
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { tc } = useLocale();

  const isSelf = user?.id === currentUserId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("账号不能为空");
      return;
    }
    if (!isEdit && password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (isEdit && password && password.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        email: email.trim(),
        name: name.trim(),
        role,
        password,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? tc("编辑用户") : tc("新建用户")}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("账号")}
          </label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="如 student01"
            disabled={isEdit}
            className={inputClass}
          />
          {isEdit && (
            <p className="mt-1 text-[11px] text-[var(--muted)] dark:text-[var(--muted)]">
              {tc("账号名创建后不可修改")}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("姓名（可选）")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tc("显示名称")}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {tc("角色")}
          </label>
          <div className="flex gap-2">
            {ROLE_OPTIONS.map((opt) => {
              const disabled = isSelf && opt.value !== ROLES.ADMIN;
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
          {isSelf && (
            <p className="mt-1.5 text-[11px] text-[var(--warning)] dark:text-[var(--warning)]">
              {tc("不能修改自己的管理员角色")}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">
            {isEdit ? tc("新密码（留空则不修改）") : tc("密码")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              isEdit ? "••••••••" : tc(`至少 ${MIN_PASSWORD_LENGTH} 位`)
            }
            className={inputClass}
          />
        </div>

        {error && (
          <div className="rounded-2xl bg-[var(--danger-bg)] px-4 py-2.5 text-[13px] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
            {tc(error)}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-[15px] font-semibold text-[var(--color-surface)] shadow-sm transition disabled:opacity-50"
        >
          {loading ? tc("保存中...") : isEdit ? tc("保存修改") : tc("创建用户")}
        </button>
      </form>
    </Modal>
  );
}
