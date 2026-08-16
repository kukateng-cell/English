"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import UserFormModal, { type UserFormData } from "@/components/admin/UserFormModal";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import CopyButton from "@/components/ui/CopyButton";
import Icon from "@/components/ui/Icon";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { ROLES, isRole, type Role } from "@/lib/roles";
import { signOut } from "next-auth/react";
import { rosterFetch } from "@/lib/roster-client";

interface UserItem {
  id: string;
  accountName?: string;
  email?: string;
  name?: string | null;
  contactEmail?: string | null;
  nickname?: string | null;
  grade?: string | null;
  classCode?: string | null;
  status?: "ACTIVE" | "SUSPENDED";
  role: string;
  academicYearId?: string | null;
  totalReviews: number;
  createdAt: string;
  legalName?: string;
  mustChangePassword?: boolean;
  classId?: string | null;
  revision?: number;
  profileRevision?: number;
}

const roleLabels: Record<Role, string> = {
  [ROLES.STUDENT]: "学生",
  [ROLES.TEACHER]: "老师",
  [ROLES.ADMIN]: "管理员",
};

const roleStyles: Record<Role, string> = {
  [ROLES.STUDENT]: "bg-[var(--border-soft)] text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]",
  [ROLES.TEACHER]: "bg-[var(--border-soft)] text-[var(--primary-2)] dark:bg-[var(--border-soft)] dark:text-[var(--primary-2)]",
  [ROLES.ADMIN]: "bg-[var(--warning-bg)] text-[var(--warning)] dark:bg-[var(--warning-bg)] dark:text-[var(--warning)]",
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string; status: "PLANNED" | "CURRENT" | "CLOSED" }>>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "SUSPENDED" | "">("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [facets, setFacets] = useState<{ roles?: { all: number; students: number; teachers: number; admins: number }; status?: { active: number; suspended: number } } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
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
  const [temporaryCredential, setTemporaryCredential] = useState<{
    accountName: string;
    password: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [usersRes, sessionRes, yearsRes] = await Promise.all([
          rosterFetch("/api/admin/users/query", { signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleFilter || undefined, status: statusFilter || undefined, academicYearId: yearFilter || undefined, grade: roleFilter === ROLES.STUDENT ? gradeFilter || undefined : undefined, classCode: roleFilter === ROLES.STUDENT ? classFilter || undefined : undefined, search: search || undefined, limit: 50 }) }),
          fetch("/api/auth/session"),
          fetch("/api/admin/academic-years"),
        ]);
        if (!usersRes.ok) {
          setError(await responseErrorMessage(usersRes));
          return;
        }
        const payload = await usersRes.json() as { items?: UserItem[]; nextCursor?: string | null; facets?: typeof facets };
        setUsers(payload.items ?? []);
        setNextCursor(payload.nextCursor ?? null);
        setFacets(payload.facets ?? null);
        // session 拉取失败不影响列表展示（仅丢失「你」徽标），静默跳过即可
        if (sessionRes.ok) {
          const me = await sessionRes.json();
          setCurrentUserId(me?.user?.id);
        }
        if (yearsRes.ok) {
          const years = await yearsRes.json() as Array<{ id: string; label: string; status: "PLANNED" | "CURRENT" | "CLOSED" }>;
          setAcademicYears(years);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(networkErrorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })(), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [reloadKey, search, roleFilter, statusFilter, gradeFilter, classFilter, yearFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const openEdit = async (user: UserItem) => {
    setDetailLoadingId(user.id);
    setError(null);
    try {
      const response = await rosterFetch(`/api/admin/users/${user.id}/detail/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const payload = await response.json().catch(() => null) as { user?: { id: string; accountName: string; role: string; status: "ACTIVE" | "SUSPENDED"; contactEmail: string | null; userRevision: number; profile: { legalName: string; nickname?: string; profileRevision?: number | null } | null }; currentEnrollment?: { academicYearId: string; grade: string; classCode: string | null } | null; } | { code?: string } | null;
      if (!response.ok || !payload || !("user" in payload) || !payload.user) throw new Error((payload && "code" in payload ? payload.code : null) ?? "讀取用戶資料失敗");
      const detail = payload.user;
      setEditing({ ...user, id: detail.id, accountName: detail.accountName, email: detail.accountName, role: detail.role, status: detail.status, contactEmail: detail.contactEmail, legalName: detail.profile?.legalName ?? "", nickname: detail.profile?.nickname ?? null, grade: payload.currentEnrollment?.grade ?? null, classCode: payload.currentEnrollment?.classCode ?? null, academicYearId: payload.currentEnrollment?.academicYearId ?? null, revision: detail.userRevision, profileRevision: detail.profile?.profileRevision ?? undefined });
      setFormKey((k) => k + 1);
      setFormOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "讀取用戶資料失敗");
    } finally { setDetailLoadingId(null); }
  };

  const resetPassword = async (user: UserItem) => {
    if (!user.accountName || !user.id || (roleOf(user) !== ROLES.STUDENT && roleOf(user) !== ROLES.TEACHER)) return;
    if (user.status === "SUSPENDED") return;
    if (!window.confirm(tc(`確定要重設「${user.legalName || user.name || user.accountName}」的密碼嗎？舊會話會立即失效。`))) return;
    setResettingId(user.id);
    try {
      const prepared = await rosterFetch(`/api/admin/users/${user.id}/password-reset/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const preparePayload = await prepared.json().catch(() => null) as { resetPrecondition?: string; code?: string } | null;
      if (!prepared.ok || !preparePayload?.resetPrecondition) throw new Error(preparePayload?.code ?? tc("無法準備重設密碼"));
      const committed = await rosterFetch(`/api/admin/users/${user.id}/password-reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetPrecondition: preparePayload.resetPrecondition }) });
      const commitPayload = await committed.json().catch(() => null) as { temporaryPassword?: string; code?: string } | null;
      if (!committed.ok || !commitPayload?.temporaryPassword) throw new Error(commitPayload?.code ?? tc("重設密碼失敗"));
      setTemporaryCredential({ accountName: user.accountName, password: commitPayload.temporaryPassword });
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("重設密碼失敗"));
    } finally { setResettingId(null); }
  };

  const handleSubmit = async (data: UserFormData) => {
    setSubmitting(true);
    try {
      if (editing) {
        const res = await rosterFetch(`/api/admin/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "UPDATE_IDENTITY",
            legalName: data.name,
            contactEmail: data.contactEmail,
            ...(data.nickname ? { nickname: data.nickname } : {}),
            expectedUserRevision: editing.revision,
            expectedProfileRevision: editing.profileRevision,
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
        if (data.status !== editing.status) {
          const statusResponse = await rosterFetch(`/api/admin/users/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation: "CHANGE_STATUS", status: data.status, expectedUserRevision: updated.revision ?? editing.revision }),
          });
          if (!statusResponse.ok) {
            const statusError = await statusResponse.json().catch(() => null) as { code?: string } | null;
            throw new Error(statusError?.code ?? "更新帳號狀態失敗");
          }
        }
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      } else {
        const res = await rosterFetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "创建失败");
        }
        const created = (await res.json()) as UserItem & {
          temporaryPassword?: string;
        };
        if (created.temporaryPassword) {
          setTemporaryCredential({
            accountName: created.accountName ?? created.email ?? "",
            password: created.temporaryPassword,
          });
        }
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
        const res = await rosterFetch(`/api/admin/users/${deleting.id}`, {
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
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
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)] dark:text-[var(--text)]">
            {tc("用户管理")}
          </h1>
          <p className="mt-1 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
            {tc(`共 ${users.length} 位用户`)}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex h-10 items-center gap-1.5 rounded-2xl bg-[var(--primary)] px-4 text-[13px] font-semibold text-[var(--color-surface)] shadow-sm transition active:scale-[0.97]"
        >
          <Icon name="plus" size={16} />
          {tc("新建")}
        </button>
      </div>

      {/* 搜索框 */}
      {temporaryCredential ? (
        <div className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)] p-4 text-[13px] text-[var(--text)]">
          <p className="font-semibold">{tc("一次性临时密码（请立即安全交给用户）")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono select-all">{temporaryCredential.accountName}　{temporaryCredential.password}</span>
            <CopyButton value={temporaryCredential.password} />
          </div>
          <button className="mt-2 text-[var(--primary)]" onClick={() => setTemporaryCredential(null)}>{tc("已保存，关闭")}</button>
        </div>
      ) : null}
      <div className="relative">
        <Icon name="search" size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)] dark:text-[var(--muted)]" />
        <input
          type="text"
          placeholder={tc("搜索用户名或邮箱...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-[44px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] pl-10 pr-4 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--text)] dark:placeholder:text-[var(--muted)] dark:focus:border-[var(--primary)]"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={tc("角色篩選")}>
        {(["", ROLES.STUDENT, ROLES.TEACHER, ROLES.ADMIN] as const).map((value) => {
          const label = value === "" ? tc("全部") : tc(roleLabels[value]);
          const count = value === "" ? facets?.roles?.all : value === ROLES.STUDENT ? facets?.roles?.students : value === ROLES.TEACHER ? facets?.roles?.teachers : facets?.roles?.admins;
          return <button key={value || "all"} type="button" role="tab" aria-selected={roleFilter === value} onClick={() => { setRoleFilter(value); if (value !== ROLES.STUDENT) { setGradeFilter(""); setClassFilter(""); setYearFilter(""); } }} className={`rounded-2xl border px-4 py-2 text-[13px] font-semibold ${roleFilter === value ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>{label}{count === undefined ? "" : ` ${count}`}</button>;
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label={tc("狀態篩選")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部狀態")}</option><option value="ACTIVE">{tc("使用中")}</option><option value="SUSPENDED">{tc("已停權")}</option></select>
        {roleFilter === ROLES.STUDENT ? <>
          <select aria-label={tc("學年篩選")} value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("目前學年")}</option>{academicYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select>
          <select aria-label={tc("年級篩選")} value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)} className="h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部年級")}</option><option value="JUNIOR_1">{tc("初一")}</option><option value="JUNIOR_2">{tc("初二")}</option><option value="JUNIOR_3">{tc("初三")}</option><option value="SENIOR_1">{tc("高一")}</option><option value="SENIOR_2">{tc("高二")}</option><option value="SENIOR_3">{tc("高三")}</option></select>
          <select aria-label={tc("班別篩選")} value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">{tc("全部班別")}</option>{[["A","甲"],["B","乙"],["C","丙"],["D","丁"],["E","戊"],["F","己"],["G","庚"],["H","辛"]].map(([code, label]) => <option key={code} value={code}>{tc(label)}</option>)}</select>
        </> : null}
      </div>

      {/* 用户列表 */}
      {users.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[14px] text-[var(--muted)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]">
          {tc("暂无用户数据")}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <div
                key={user.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)]/20 dark:border-[var(--border)] dark:bg-[var(--surface)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--border-soft)] text-[15px] font-bold text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]">
                      {(user.legalName || user.name || user.accountName || user.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-[var(--text)] dark:text-[var(--text)]">
                        {user.legalName || user.name || tc("未設姓名")}
                        {isSelf && (
                          <span className="rounded-full bg-[var(--border-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)] dark:bg-[var(--border-soft)]">
                            {tc("你")}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                        {user.accountName || user.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${roleStyles[roleOf(user)]}`}>
                      {tc(roleLabels[roleOf(user)])}
                    </span>
                    {user.status === "SUSPENDED" ? (
                      <span className="rounded-full bg-[var(--danger-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)]">
                        {tc("已暂停")}
                      </span>
                    ) : null}
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1">
                      {roleOf(user) !== ROLES.ADMIN ? <button type="button" disabled={resettingId === user.id || user.status === "SUSPENDED"} onClick={() => void resetPassword(user)} className="flex h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--primary)] transition hover:bg-[var(--border-soft)] disabled:cursor-not-allowed disabled:opacity-40" aria-label={tc("重設密碼")}>{resettingId === user.id ? tc("處理中") : tc("重設密碼")}</button> : null}
                      <button
                        onClick={() => void openEdit(user)}
                        disabled={detailLoadingId === user.id}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--border-soft)] hover:text-[var(--primary)] dark:text-[var(--muted)] dark:hover:bg-[var(--border-soft)] dark:hover:text-[var(--primary)]"
                        aria-label={tc("编辑")}
                      >
                        {detailLoadingId === user.id ? <span className="text-[11px]">{tc("讀取中")}</span> : <Icon name="edit" size={16} />}
                      </button>
                      <button
                        onClick={() => setDeleting(user)}
                        disabled={isSelf}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[var(--muted)] dark:hover:bg-[var(--danger-bg)]"
                        aria-label={tc("删除")}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
                  <span className="admin-meta-item"><Icon name="refresh" size={14} /> {user.totalReviews ?? 0} {tc("次練習")}</span>
                  <span className="admin-meta-item"><Icon name="clock" size={14} /> {new Date(user.createdAt).toLocaleDateString(dateLocale)} {tc("加入")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px] font-semibold text-[var(--primary)]"
          onClick={async () => {
            const response = await rosterFetch("/api/admin/users/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleFilter || undefined, status: statusFilter || undefined, academicYearId: yearFilter || undefined, grade: roleFilter === ROLES.STUDENT ? gradeFilter || undefined : undefined, classCode: roleFilter === ROLES.STUDENT ? classFilter || undefined : undefined, search: search || undefined, cursor: nextCursor, limit: 50 }) });
            if (!response.ok) return;
            const payload = await response.json() as { items?: UserItem[]; nextCursor?: string | null };
            setUsers((current) => [...current, ...(payload.items ?? [])]);
            setNextCursor(payload.nextCursor ?? null);
          }}
        >
          {tc("载入更多")}
        </button>
      ) : null}

      {/* 新建 / 编辑弹窗 */}
      <UserFormModal
        key={formKey}
        open={formOpen}
        user={editing ? { ...editing, email: editing.accountName ?? editing.email ?? "", name: editing.legalName ?? editing.name ?? null } : null}
        currentUserId={currentUserId}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        academicYears={academicYears}
      />
      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleting}
        title={tc("删除用户")}
        message={
          deleting
            ? tc(`確定刪除「${deleting.legalName || deleting.name || deleting.accountName || deleting.email}」嗎？該用戶的所有學習記錄將一併刪除，且無法恢復。`)
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
