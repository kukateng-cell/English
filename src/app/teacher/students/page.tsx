"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import ErrorBanner from "@/components/ErrorBanner";
import StreakBadge from "@/components/StreakBadge";
import StreakCalendar from "@/components/StreakCalendar";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { useLocale } from "@/components/LocaleProvider";
import { todayKey } from "@/lib/streak";

interface StudentItem {
  id: string;
  name: string | null;
  email: string;
  totalReviews: number;
  masteredWords: number;
  totalWords: number;
  progress: number;
  // 留存画像（来自 /api/teacher/students 的 insights）
  streak: number;
  studiedToday: boolean;
  cumulativeDays: number;
  achievementCount: number;
  lastStudyDate: string | null;
  days: string[];
  byLevel: { level: string; mastered: number; total: number; progress: number }[];
}

type SortKey = "default" | "streak" | "today" | "progress";

export default function TeacherStudentsPage() {
  const { tc } = useLocale();
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("default");

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

  // 排序（默认保持班级顺序；同分时按连续天数/累计天数进一步排序）
  const sorted = useMemo(() => {
    const arr = [...students];
    if (sortKey === "streak") {
      arr.sort(
        (a, b) => b.streak - a.streak || b.cumulativeDays - a.cumulativeDays,
      );
    } else if (sortKey === "today") {
      arr.sort(
        (a, b) =>
          Number(b.studiedToday) - Number(a.studiedToday) || b.streak - a.streak,
      );
    } else if (sortKey === "progress") {
      arr.sort((a, b) => b.progress - a.progress);
    }
    return arr;
  }, [students, sortKey]);

  // 流失预警：无连续（streak=0）且最近打卡距今 >= 3 天
  const isAtRisk = (s: StudentItem) => {
    if (s.streak > 0 || !s.lastStudyDate) return false;
    const [y, m, d] = s.lastStudyDate.split("-").map(Number);
    const [ty, tm, td] = todayKey().split("-").map(Number);
    const diff = Math.round(
      (Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000,
    );
    return diff >= 3;
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

      {/* 排序切换 */}
      <div className="flex gap-1 rounded-full bg-[#EEF4FF] p-1 dark:bg-[#1E3A5F]/40">
        {(
          [
            { key: "default", label: "默认" },
            { key: "streak", label: "🔥 连续" },
            { key: "today", label: "今日" },
            { key: "progress", label: "进度" },
          ] as { key: SortKey; label: string }[]
        ).map((o) => (
          <button
            key={o.key}
            onClick={() => setSortKey(o.key)}
            className={`flex-1 rounded-full px-3 py-2 text-[13px] font-medium transition ${
              sortKey === o.key
                ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow"
                : "text-[#7C89A5] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:text-[#60A5FA]"
            }`}
          >
            {tc(o.label)}
          </button>
        ))}
      </div>

      {students.length === 0 ? (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-10 text-center text-[14px] text-[#7C89A5] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]">
          {tc("暂无学生数据")}
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((student, i) => (
            <motion.div
              key={student.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                onClick={() => setExpandedId(expandedId === student.id ? null : student.id)}
                className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition dark:bg-[#111827] ${
                  isAtRisk(student)
                    ? "border-[#FECACA] dark:border-[#7F1D1D]"
                    : "border-[#E7EDF8] hover:border-[#2563EB]/20 dark:border-[#1E293B]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[15px] font-bold text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
                      {(student.name || student.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
                          {student.name || tc("未设置姓名")}
                        </p>
                        {isAtRisk(student) && (
                          <span className="shrink-0 rounded-full bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#EF4444] dark:bg-[#2D0B0B] dark:text-[#F87171]">
                            ⚠️ {tc("需关注")}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[13px] text-[#7C89A5] dark:text-[#64748B]">
                        {student.email}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StreakBadge
                          streak={{
                            count: student.streak,
                            studiedToday: student.studiedToday,
                            lastDate: student.lastStudyDate,
                          }}
                        />
                        {student.studiedToday && (
                          <span className="flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-semibold text-[#15803D] dark:bg-[#052E16] dark:text-[#4ADE80]">
                            ● {tc("今日已学")}
                          </span>
                        )}
                      </div>
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

                {/* 留存统计 */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                  <span>🗓️ {tc(`累计 ${student.cumulativeDays} 天`)}</span>
                  <span>🎖 {tc(`${student.achievementCount} 个成就`)}</span>
                  {student.lastStudyDate && (
                    <span>{tc(`最近学习 ${student.lastStudyDate}`)}</span>
                  )}
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

                    {/* 打卡日历 */}
                    <div>
                      <p className="mb-2 text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
                        {tc("打卡日历")}
                      </p>
                      <StreakCalendar
                        data={{
                          streak: {
                            count: student.streak,
                            studiedToday: student.studiedToday,
                            lastDate: student.lastStudyDate,
                          },
                          days: student.days ?? [],
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
