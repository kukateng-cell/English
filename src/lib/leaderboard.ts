/**
 * 排行榜：三个榜单（连续天数 / 掌握词数 / 累计打卡），基于现有数据实时计算。
 *
 * 数据量小（学生数十人），直接全量读取 StudyDay / Review 在内存聚合，
 * 不做快照表，保持简单且实时。
 */
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import { todayKey, offsetDay } from "@/lib/streak";

export type LeaderboardType = "streak" | "words" | "studyDays";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  value: number;
  isMe: boolean;
}

export interface LeaderboardList {
  type: LeaderboardType;
  /** 简体标题（前端经 tc() 转换）。 */
  label: string;
  icon: string;
  entries: LeaderboardEntry[];
}

export interface LeaderboardData {
  lists: LeaderboardList[];
  me: string;
}

const TOP_N = 20;

/** 纯函数：从打卡日期集合计算连续天数（Duolingo 式，今天/昨天起点）。 */
export function countStreak(dates: Set<string>): number {
  const today = todayKey();
  const yesterday = offsetDay(today, -1);
  let cursor: string | null = null;
  if (dates.has(today)) cursor = today;
  else if (dates.has(yesterday)) cursor = yesterday;
  else return 0;
  let count = 0;
  while (dates.has(cursor)) {
    count++;
    cursor = offsetDay(cursor, -1);
  }
  return count;
}

/** 标准竞赛排名：相同分值并列名次（1,1,3,...）。 */
function rankEntries(
  values: { userId: string; name: string; value: number }[],
  me: string,
): LeaderboardEntry[] {
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const entries: LeaderboardEntry[] = [];
  let prevValue: number | null = null;
  let prevRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const rank = v.value === prevValue ? prevRank : i + 1;
    prevValue = v.value;
    prevRank = rank;
    entries.push({ rank, userId: v.userId, name: v.name, value: v.value, isMe: v.userId === me });
  }
  return entries;
}

/** 截断到 TOP_N，并确保当前用户一定在列表内（不在则追加）。 */
function trimToTop(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  if (entries.length <= TOP_N) return entries;
  const top = entries.slice(0, TOP_N);
  if (top.some((e) => e.isMe)) return top;
  const meEntry = entries.find((e) => e.isMe);
  return meEntry ? [...top, meEntry] : top;
}

export async function getLeaderboard(
  userId: string,
): Promise<LeaderboardData> {
  const users = await prisma.user.findMany({
    where: { role: ROLES.STUDENT },
    select: { id: true, name: true, email: true },
  });
  const displayName = (u: { name: string | null; email: string }) =>
    u.name || u.email;

  // 全量取 StudyDay / Review，在内存聚合
  const [studyDays, reviews] = await Promise.all([
    prisma.studyDay.findMany({ select: { userId: true, date: true } }),
    prisma.review.findMany({ select: { userId: true, repetitions: true } }),
  ]);

  // 按用户聚合打卡日期
  const datesByUser = new Map<string, Set<string>>();
  for (const s of studyDays) {
    const set = datesByUser.get(s.userId) ?? new Set<string>();
    set.add(s.date);
    datesByUser.set(s.userId, set);
  }
  // 按用户统计掌握词数（repetitions >= 1）与累计打卡天数
  const wordsByUser = new Map<string, number>();
  for (const r of reviews) {
    if (r.repetitions >= 1) {
      wordsByUser.set(r.userId, (wordsByUser.get(r.userId) ?? 0) + 1);
    }
  }

  const streakValues = users.map((u) => ({
    userId: u.id,
    name: displayName(u),
    value: countStreak(datesByUser.get(u.id) ?? new Set()),
  }));
  const wordsValues = users.map((u) => ({
    userId: u.id,
    name: displayName(u),
    value: wordsByUser.get(u.id) ?? 0,
  }));
  const studyDaysValues = users.map((u) => ({
    userId: u.id,
    name: displayName(u),
    value: datesByUser.get(u.id)?.size ?? 0,
  }));

  const lists: LeaderboardList[] = [
    {
      type: "streak",
      label: "连续天数",
      icon: "🔥",
      entries: trimToTop(rankEntries(streakValues, userId)),
    },
    {
      type: "words",
      label: "掌握词数",
      icon: "📚",
      entries: trimToTop(rankEntries(wordsValues, userId)),
    },
    {
      type: "studyDays",
      label: "累计打卡",
      icon: "🗓️",
      entries: trimToTop(rankEntries(studyDaysValues, userId)),
    },
  ];

  return { lists, me: userId };
}
