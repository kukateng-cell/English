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
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
          {tc("学生进度")}
        </h1>
        <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
          {tc(`共 ${students.length} 名学生`)}
        </p>
      </div>

      {students.length === 0 ? (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-10 text-center text-[14px] text-[#7C89A5] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]">
          {tc("暂无学生数据")}
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((student, i) => (
            <motion.div
              key={student.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
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
                className="w-full cursor-pointer rounded-2xl border border-[#E7EDF8] bg-white p-4 text-left shadow-sm transition hover:border-[#2563EB]/20 dark:border-[#1E293B] dark:bg-[#111827]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[15px] font-bold text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                      {(student.name || student.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
                        {student.name || tc("未设置姓名")}
                      </p>
                      <p className="truncate text-[13px] text-[#7C89A5] dark:text-[#64748B]">
                        {student.email}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[18px] font-bold text-[#2563EB] dark:text-[#60A5FA]">{student.progress}%</p>
                    <p className="text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                      {tc(`${student.masteredWords}/${student.totalWords} 词`)}
                    </p>
                  </div>
                </div>

                {/* 总进度条 */}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EEF2F9] dark:bg-[#1E293B]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
                    style={{ width: `${student.progress}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${student.progress}%` }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                  />
                </div>

                {/* 展开详情 */}
                {expandedId === student.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-4 space-y-3 border-t border-[#E7EDF8] pt-4 dark:border-[#1E293B]"
                  >
                    <p className="text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">{tc("各等级详情")}</p>
                    {student.byLevel.map((l) => (
                      <div key={l.level} className="space-y-1">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="font-medium text-[#17213C] dark:text-[#E2E8F0]">{tc(`${l.level} 级`)}</span>
                          <span className="text-[#7C89A5] dark:text-[#64748B]">
                            {l.mastered}/{l.total} · {l.progress}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#EEF2F9] dark:bg-[#1E293B]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
                            style={{ width: `${l.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-3 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
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
                        className="flex h-9 items-center gap-1.5 rounded-xl border border-[#E7EDF8] bg-white px-3 text-[12px] font-medium text-[#2563EB] transition hover:bg-[#EEF4FF] active:scale-[0.97] disabled:opacity-50 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#60A5FA] dark:hover:bg-[#1E3A5F]"
                      >
                        {resetting ? tc("重置中...") : tc("🔑 重置密码")}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
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
            <p className="text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
              {tc(`已为「${resetTarget?.name || resetTarget?.email}」生成临时密码：`)}
            </p>
            <p className="select-all rounded-2xl bg-[#EEF4FF] px-4 py-3 text-[22px] font-bold tracking-widest text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
              {tempPassword}
            </p>
            <p className="text-[13px] leading-relaxed text-[#F59E0B] dark:text-[#FBBF24]">
              {tc("该学生下次登录将被要求修改密码，其旧会话已全部失效。")}
            </p>
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="w-full rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
            >
              {tc("完成")}
            </button>
          </div>
        ) : (
          <div className="py-4 text-center">
            {resetError ? (
              <>
                <p className="mb-4 text-[14px] text-[#EF6B6B] dark:text-[#F87171]">
                  {tc(resetError)}
                </p>
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="w-full rounded-2xl border border-[#E7EDF8] bg-white px-4 py-3 text-[14px] font-semibold text-[#7C89A5] transition hover:bg-[#F8FAFC] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]"
                >
                  {tc("关闭")}
                </button>
              </>
            ) : (
              <p className="text-[14px] text-[#7C89A5] dark:text-[#64748B]">
                {tc("正在生成临时密码...")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
