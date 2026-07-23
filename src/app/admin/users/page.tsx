"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  totalReviews: number;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  STUDENT: "学生",
  TEACHER: "老师",
  ADMIN: "管理员",
};

const roleStyles: Record<string, string> = {
  STUDENT: "bg-[#EEF4FF] text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]",
  TEACHER: "bg-[#EEF0FF] text-[#4F46E5] dark:bg-[#1E1B4B] dark:text-[#A5B4FC]",
  ADMIN: "bg-[#FEF3C7] text-[#B45309] dark:bg-[#291800] dark:text-[#FBBF24]",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (res.ok) setUsers(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[#17213C] dark:text-[#E2E8F0]">
            用户管理
          </h1>
          <p className="mt-1 text-[14px] text-[#7C89A5] dark:text-[#64748B]">
            共 {users.length} 位用户
          </p>
        </div>
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
          placeholder="搜索用户名或邮箱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-[44px] w-full rounded-2xl border border-[#E7EDF8] bg-white pl-10 pr-4 text-[14px] text-[#17213C] outline-none transition placeholder:text-[#BFCBE3] focus:border-[#2563EB] focus:ring-[3px] focus:ring-[#2563EB]/8 dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#E2E8F0] dark:placeholder:text-[#475569] dark:focus:border-[#60A5FA]"
        />
      </div>

      {/* 用户列表 */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E7EDF8] bg-white p-10 text-center text-[14px] text-[#7C89A5] dark:border-[#1E293B] dark:bg-[#111827] dark:text-[#64748B]">
          暂无用户数据
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((user, i) => (
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
                    <p className="truncate text-[15px] font-semibold text-[#17213C] dark:text-[#E2E8F0]">
                      {user.name || "未设置姓名"}
                    </p>
                    <p className="truncate text-[13px] text-[#7C89A5] dark:text-[#64748B]">
                      {user.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${roleStyles[user.role] || ""}`}>
                    {roleLabels[user.role] || user.role}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[12px] text-[#7C89A5] dark:text-[#64748B]">
                <span>📝 {user.totalReviews} 次复习</span>
                <span>🕐 {new Date(user.createdAt).toLocaleDateString("zh-CN")} 加入</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
