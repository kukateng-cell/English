"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import UserFormModal, { type UserFormData } from "@/components/admin/UserFormModal";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { ROLES, isRole, type Role } from "@/lib/roles";
import { signOut } from "next-auth/react";

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  totalReviews: number;
  createdAt: string;
}

const roleLabels: Record<Role, string> = {
  [ROLES.STUDENT]: "学生",
  [ROLES.TEACHER]: "老师",
  [ROLES.ADMIN]: "管理员",
};

const roleStyles: Record<Role, string> = {
  [ROLES.STUDENT]: "bg-[#EEF4FF] text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]",
  [ROLES.TEACHER]: "bg-[#EEF0FF] text-[#4F46E5] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]",
  [ROLES.ADMIN]: "bg-[#FEF3C7] text-[#B45309] dark:bg-[#291800] dark:text-[#FBBF24]",
};

/** API 返回的 role 是 string；转成 Role 后再查表，非法值回退原值。 */
function roleOf(user: UserItem): Role {
  return isRole(user.role) ? user.role : ROLES.STUDENT;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const { tc, locale } = useLocale();
  // 依语言选择日期 locale（繁体用 zh-TW，简体用 zh-CN）
  const dateLocale = locale === "zh-Hant" ? "zh-TW" : "zh-CN";

  // 弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState<UserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 删除失败的错误文案（在确认弹窗内展示，不静默失败）
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 每次「打开」表单时自增，作为 Modal 的 key 强制 remount，让表单从最新 props 重新初始化。
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [usersRes, sessionRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/auth/session"),
        ]);
        if (!usersRes.ok) {
          setError(await responseErrorMessage(usersRes));
          return;
        }
        setUsers(await usersRes.json());
        // session 拉取失败不影响列表展示（仅丢失「你」徽标），静默跳过即可
        if (sessionRes.ok) {
          const me = await sessionRes.json();
          setCurrentUserId(me?.user?.id);
        }
      } catch (e) {
        setError(networkErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(search.toLowerCase()))
  );

  const openCreate = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const openEdit = (user: UserItem) => {
    setEditing(user);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const handleSubmit = async (data: UserFormData) => {
    setSubmitting(true);
    try {
      if (editing) {
        const res = await fetch(`/api/admin/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            role: data.role,
            ...(data.password ? { password: data.password } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "更新失败");
        }
        const updated = (await res.json()) as UserItem & {
          sessionInvalidated?: boolean;
        };
        if (updated.sessionInvalidated) {
          await signOut({ callbackUrl: "/login" });
          return;
        }
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      } else {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "创建失败");
        }
        const created: UserItem = await res.json();
        setUsers((prev) => [created, ...prev]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/users/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "删除失败");
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "删除失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* 页面标题 + 新建按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
            {tc("用户管理")}
          </h1>
          <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
            {tc(`共 ${users.length} 位用户`)}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex h-10 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:from-[#1D4ED8] hover:to-[#4F46E5] active:scale-[0.97]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {tc("新建")}
        </button>
      </div>

      {/* 搜索框 */}
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#BFCBE3] dark:text-[#475569]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder={tc("搜索用户名或邮箱...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-[44px] w-full rounded-2xl border border-[#E7EDF8] bg-white pl-10 pr-4 text-[14px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA]"
        />
      </div>

      {/* 用户列表 */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-10 text-center text-[14px] text-[#7C89A5] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]">
          {tc("暂无用户数据")}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((user, i) => {
            const isSelf = user.id === currentUserId;
            return (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="rounded-2xl border border-[#E7EDF8] bg-white p-4 shadow-sm transition hover:border-[#2563EB]/20 dark:border-[#1E293B] dark:bg-[#111827]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[15px] font-bold text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                      {(user.name || user.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
                        {user.name || tc("未设置姓名")}
                        {isSelf && (
                          <span className="rounded-full bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] font-medium text-[#2563EB] dark:bg-[#1E3A5F]">
                            {tc("你")}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[13px] text-[#7C89A5] dark:text-[#64748B]">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${roleStyles[roleOf(user)]}`}>
                      {tc(roleLabels[roleOf(user)])}
                    </span>
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(user)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7C89A5] transition hover:bg-[#EEF4FF] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:bg-[#1E3A5F] dark:hover:text-[#60A5FA]"
                        aria-label={tc("编辑")}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleting(user)}
                        disabled={isSelf}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7C89A5] transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#64748B] dark:hover:bg-red-950/40"
                        aria-label={tc("删除")}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                  <span>📝 {user.totalReviews} {tc("次复习")}</span>
                  <span>🕐 {new Date(user.createdAt).toLocaleDateString(dateLocale)} {tc("加入")}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 新建 / 编辑弹窗 */}
      <UserFormModal
        key={formKey}
        open={formOpen}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />
      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleting}
        title={tc("删除用户")}
        message={
          deleting
            ? tc(`确定删除「${deleting.name || deleting.email}」吗？该用户的所有学习记录将一并删除，且无法恢复。`)
            : ""
        }
        confirmText={tc("删除")}
        destructive
        loading={submitting}
        error={deleteError}
        onConfirm={handleDelete}
        onClose={() => {
          setDeleteError(null);
          setDeleting(null);
        }}
      />
    </motion.div>
  );
}
