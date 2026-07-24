"use client";

import { useState } from "react";
import Modal from "./Modal";

export interface UserFormData {
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER" | "ADMIN";
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

const ROLE_OPTIONS: { value: UserFormData["role"]; label: string }[] = [
  { value: "STUDENT", label: "学生" },
  { value: "TEACHER", label: "老师" },
  { value: "ADMIN", label: "管理员" },
];

/** 共用的输入框样式，与登录页风格保持一致。 */
const inputClass =
  "h-[44px] w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 text-[14px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#0B1220] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA]";

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
  const [role, setRole] = useState<UserFormData["role"]>(
    (user?.role as UserFormData["role"]) ?? "STUDENT"
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isSelf = user?.id === currentUserId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("账号不能为空");
      return;
    }
    if (!isEdit && password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (isEdit && password && password.length < 6) {
      setError("新密码至少 6 位");
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
      title={isEdit ? "编辑用户" : "新建用户"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            账号
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
            <p className="mt-1 text-[11px] text-[#BFCBE3] dark:text-[#475569]">
              账号名创建后不可修改
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            姓名（可选）
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="显示名称"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            角色
          </label>
          <div className="flex gap-2">
            {ROLE_OPTIONS.map((opt) => {
              const disabled = isSelf && opt.value !== "ADMIN";
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRole(opt.value)}
                  className={`flex-1 rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition disabled:opacity-40 ${
                    role === opt.value
                      ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow-sm"
                      : "border border-[#E7EDF8] bg-white text-[#7C89A5] hover:border-[#2563EB]/30 dark:border-[#1E293B] dark:bg-[#0B1220] dark:text-[#64748B]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {isSelf && (
            <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              不能修改自己的管理员角色
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            {isEdit ? "新密码（留空则不修改）" : "密码"}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "••••••" : "至少 6 位"}
            className={inputClass}
          />
        </div>

        {error && (
          <div className="rounded-2xl bg-red-50 px-4 py-2.5 text-[13px] text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:from-[#1D4ED8] hover:to-[#4F46E5] disabled:opacity-50"
        >
          {loading ? "保存中..." : isEdit ? "保存修改" : "创建用户"}
        </button>
      </form>
    </Modal>
  );
}
