"use client";

import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type {
  LeaderboardData,
  LeaderboardList,
  LeaderboardType,
} from "@/lib/leaderboard";

/**
 * 排行榜视图：Tab 切换三个榜单 + 榜单列表。
 * 供学生端（/leaderboard）与老师端（/teacher/leaderboard）共用。
 */
export default function LeaderboardView({ data }: { data: LeaderboardData }) {
  const { tc } = useLocale();
  const [active, setActive] = useState<LeaderboardType>("streak");
  const list: LeaderboardList =
    data.lists.find((l) => l.type === active) ?? data.lists[0];
  const medal = (rank: number) =>
    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <div className="space-y-4">
      {/* Tab 切换 */}
      <div className="flex gap-1 rounded-full bg-[#EEF4FF] p-1 dark:bg-[#1E3A5F]/40">
        {data.lists.map((l) => (
          <button
            key={l.type}
            onClick={() => setActive(l.type)}
            className={`flex-1 rounded-full px-3 py-2 text-[13px] font-medium transition ${
              active === l.type
                ? "bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] text-white shadow"
                : "text-[#7C89A5] hover:text-[#2563EB] dark:text-[#64748B] dark:hover:text-[#60A5FA]"
            }`}
          >
            {tc(l.label)}
          </button>
        ))}
      </div>

      {/* 榜单 */}
      <div className="overflow-hidden rounded-3xl border border-[#E7EDF8] bg-white dark:border-[#1E293B] dark:bg-[#0F172A]">
        {list.entries.map((e, i) => (
          <div
            key={e.userId}
            className={`flex items-center gap-3 px-4 py-3 ${
              e.isMe
                ? "bg-[#FFF7E6] dark:bg-[#2A1E00]"
                : i !== list.entries.length - 1
                  ? "border-b border-[#F1F5F9] dark:border-[#1E293B]"
                  : ""
            }`}
          >
            <div className="w-8 text-center text-[15px] font-bold tabular-nums text-[#17213C] dark:text-[#E2E8F0]">
              {medal(e.rank) ?? e.rank}
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-[14px] font-medium ${
                  e.isMe
                    ? "text-[#F59E0B] dark:text-[#FBBF24]"
                    : "text-[#17213C] dark:text-[#E2E8F0]"
                }`}
              >
                {e.name}
                {e.isMe && (
                  <span className="ml-1.5 rounded-full bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#F59E0B] dark:text-[#FBBF24]">
                    {tc("我")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 text-[14px] font-semibold tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
              <span>{list.icon}</span>
              <span>{e.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
