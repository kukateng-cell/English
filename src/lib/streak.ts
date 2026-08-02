/**
 * 连续学习天数（streak）逻辑。
 *
 * 打卡数据存 StudyDay 表：每用户每天一条，date 为本地日期字符串
 * （固定 Asia/Shanghai 时区，YYYY-MM-DD），避免服务器/用户时区差异导致的跨日错乱。
 *
 * streak 语义（Duolingo 式）：
 * - 今天已打卡：从今天往前连续数；
 * - 今天未打卡但昨天打卡：显示「截至昨天」的连续天数（今天打卡即可 +1）；
 * - 断签（今天、昨天都未打卡）：count = 0。
 */
import { prisma } from "@/lib/prisma";

/** 统一用东八区（Asia/Shanghai）计算「本地日期」，与目标用户（中文学生）一致。 */
const TIME_ZONE = "Asia/Shanghai";

/** 取给定 Date 在 Asia/Shanghai 时区下的日期 key（YYYY-MM-DD）。 */
export function todayKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 纯日历日期的 UTC 格式化（date key 本质是纯日期，用 UTC 构造避免本地时区干扰）。 */
function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** date key 向前/向后偏移 n 天（n 为负表示过去）。 */
export function offsetDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return formatUtcDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** 为用户打今天的卡（幂等：同一天只记一条）。 */
export async function checkInStudyDay(userId: string): Promise<void> {
  const date = todayKey();
  await prisma.studyDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date },
    update: {},
  });
}

export interface StreakInfo {
  /** 当前连续学习天数（今天未打卡且昨天打了时，为截至昨天的连续天数）。 */
  count: number;
  /** 今天是否已打卡。 */
  studiedToday: boolean;
  /** 最近一次打卡日期（YYYY-MM-DD），无打卡记录时为 null。 */
  lastDate: string | null;
}

/** 计算某用户的连续学习天数。 */
export async function computeStreak(userId: string): Promise<StreakInfo> {
  const days = await prisma.studyDay.findMany({
    where: { userId },
    select: { date: true },
  });
  const dates = new Set(days.map((d) => d.date));
  const today = todayKey();
  const yesterday = offsetDay(today, -1);

  let cursor: string;
  if (dates.has(today)) {
    cursor = today;
  } else if (dates.has(yesterday)) {
    cursor = yesterday;
  } else {
    return { count: 0, studiedToday: false, lastDate: null };
  }

  let count = 0;
  let last = cursor;
  while (dates.has(cursor)) {
    count++;
    last = cursor;
    cursor = offsetDay(cursor, -1);
  }
  return { count, studiedToday: dates.has(today), lastDate: last };
}

/** 取某用户最近 n 天的打卡日期（按日期升序），供打卡日历展示。 */
export async function fetchRecentStudyDays(
  userId: string,
  n: number,
): Promise<string[]> {
  const since = offsetDay(todayKey(), -(n - 1));
  const rows = await prisma.studyDay.findMany({
    where: { userId, date: { gte: since } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.date);
}
