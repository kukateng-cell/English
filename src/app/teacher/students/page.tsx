"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import Modal from "@/components/admin/Modal";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { useLocale } from "@/components/LocaleProvider";

interface StudentItem {
  id: string;
  name: string | null;
  email: string;
  totalReviews: number;
  masteredWords: number;
  totalWords: number;
  progress: number;
  byLevel: { level: string; mastered: number; total: number; progress: number }[];
}

export default function TeacherStudentsPage() {
  const { tc } = useLocale();
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 重置学生密码：resetTarget 记录当前操作的学生，tempPassword 展示生成的临时密码。
  const [resetTarget, setResetTarget] = useState<StudentItem | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/teacher/students");
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        setStudents(await res.json());
      } catch (e) {
        setError(networkErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  /** 重置某学生密码：调用 API 生成临时密码并展示。 */
  const resetPassword = async (student: StudentItem) => {
    setResetTarget(student);
    setTempPassword(null);
    setResetError(null);
    setResetting(true);
    try {
      const res = await fetch(
        `/api/teacher/students/${student.id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResetError(data?.error ?? "重置失败，请稍后重试");
      } else {
        setTempPassword(data?.temporaryPassword ?? "");
      }
    } catch {
      setResetError("网络错误，请稍后重试");
    } finally {
      setResetting(false);
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
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)] dark:text-[var(--text)]">
          {tc("学生进度")}
        </h1>
        <p className="mt-1 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
          {tc(`共 ${students.length} 名学生`)}
        </p>
      </div>

      {students.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[14px] text-[var(--muted)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]">
          {tc("暂无学生数据")}
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((student) => (
            <div
              key={student.id}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedId(expandedId === student.id ? null : student.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(expandedId === student.id ? null : student.id);
                  }
                }}
                className="w-full cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm transition hover:border-[var(--primary)]/20 dark:border-[var(--border)] dark:bg-[var(--surface)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--border-soft)] text-[15px] font-bold text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]">
                      {(student.name || student.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-[var(--text)] dark:text-[var(--text)]">
                        {student.name || tc("未设置姓名")}
                      </p>
                      <p className="truncate text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                        {student.email}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[18px] font-bold text-[var(--primary)] dark:text-[var(--primary)]">{student.progress}%</p>
                    <p className="text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
                      {tc(`${student.masteredWords}/${student.totalWords} 词`)}
                    </p>
                  </div>
                </div>

                {/* 总进度条 */}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border-soft)] dark:bg-[var(--border)]">
                  <motion.div
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${student.progress}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${student.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>

                {/* 展开详情 */}
                {expandedId === student.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-4 space-y-3 border-t border-[var(--border)] pt-4 dark:border-[var(--border)]"
                  >
                    <p className="text-[13px] font-medium text-[var(--muted)] dark:text-[var(--muted)]">{tc("各等级详情")}</p>
                    {student.byLevel.map((l) => (
                      <div key={l.level} className="space-y-1">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="font-medium text-[var(--text)] dark:text-[var(--text)]">{tc(`${l.level} 级`)}</span>
                          <span className="text-[var(--muted)] dark:text-[var(--muted)]">
                            {l.mastered}/{l.total} · {l.progress}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-soft)] dark:bg-[var(--border)]">
                          <div
                            className="h-full rounded-full bg-[var(--primary)]"
                            style={{ width: `${l.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-3 text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">
                      <span>{tc(`📝 共复习 ${student.totalReviews} 次`)}</span>
                    </div>
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void resetPassword(student);
                        }}
                        disabled={resetting}
                        className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--primary)] transition hover:bg-[var(--border-soft)] active:scale-[0.97] disabled:opacity-50 dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--primary)] dark:hover:bg-[var(--border-soft)]"
                      >
                        {resetting ? tc("重置中...") : tc("🔑 重置密码")}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 重置密码结果弹窗 */}
      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={tc("重置密码")}
      >
        {tempPassword !== null ? (
          <div className="space-y-4 text-center">
            <p className="text-[14px] leading-relaxed text-[var(--muted)] dark:text-[var(--muted)]">
              {tc(`已为「${resetTarget?.name || resetTarget?.email}」生成临时密码：`)}
            </p>
            <p className="select-all rounded-2xl bg-[var(--border-soft)] px-4 py-3 text-[22px] font-bold tracking-widest text-[var(--primary)] dark:bg-[var(--border-soft)] dark:text-[var(--primary)]">
              {tempPassword}
            </p>
            <p className="text-[13px] leading-relaxed text-[var(--warning)] dark:text-[var(--warning)]">
              {tc("该学生下次登录将被要求修改密码，其旧会话已全部失效。")}
            </p>
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="w-full rounded-2xl bg-[var(--primary)] px-4 py-3 text-[15px] font-semibold text-[var(--color-surface)] shadow-sm transition active:scale-[0.98]"
            >
              {tc("完成")}
            </button>
          </div>
        ) : (
          <div className="py-4 text-center">
            {resetError ? (
              <>
                <p className="mb-4 text-[14px] text-[var(--danger)] dark:text-[var(--danger)]">
                  {tc(resetError)}
                </p>
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] font-semibold text-[var(--muted)] transition hover:bg-[var(--border-soft)] dark:border-[var(--border)] dark:bg-[var(--surface)] dark:text-[var(--muted)]"
                >
                  {tc("关闭")}
                </button>
              </>
            ) : (
              <p className="text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
                {tc("正在生成临时密码...")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
