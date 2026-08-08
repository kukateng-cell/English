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
import { prisma, type Prisma } from "@/lib/prisma";

type StreakDb = Pick<Prisma.TransactionClient, "studyDay"> &
  Partial<Pick<Prisma.TransactionClient, "$queryRaw">>;

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
export async function checkInStudyDay(
  userId: string,
  db: StreakDb = prisma,
): Promise<void> {
  const date = todayKey();
  await db.studyDay.upsert({
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
export async function computeStreak(
  userId: string,
  db: StreakDb = prisma,
): Promise<StreakInfo> {
  const latest = await db.studyDay.findFirst({
    where: { userId },
    select: { date: true },
    orderBy: { date: "desc" },
  });
  const lastDate = latest?.date ?? null;
  const today = todayKey();
  const yesterday = offsetDay(today, -1);

  const cursor = lastDate === today ? today : lastDate === yesterday ? yesterday : null;
  if (!cursor) {
    return { count: 0, studiedToday: false, lastDate };
  }

  // StudyDay.date is an indexed YYYY-MM-DD string. The recursive query only
  // follows the contiguous prefix ending today/yesterday, instead of loading
  // the user's entire history into Node on every review/achievement update.
  const rows = db.$queryRaw
    ? await db.$queryRaw<Array<{ date: string }>>`
        WITH RECURSIVE streak(date) AS (
          SELECT "date"
          FROM "StudyDay"
          WHERE "userId" = ${userId} AND "date" = ${cursor}
          UNION ALL
          SELECT day."date"
          FROM "StudyDay" AS day
          JOIN streak AS previous
            ON day."userId" = ${userId}
           AND day."date" = to_char(
             to_date(previous.date, 'YYYY-MM-DD') - INTERVAL '1 day',
             'YYYY-MM-DD'
           )
        )
        SELECT date FROM streak
      `
    : await db.studyDay.findMany({
        where: { userId },
        select: { date: true },
      });

  return {
    count: rows.length,
    studiedToday: lastDate === today,
    lastDate,
  };
}

/** 取某用户最近 n 天的打卡日期（按日期升序），供打卡日历展示。 */
export async function fetchRecentStudyDays(
  userId: string,
  n: number,
  db: StreakDb = prisma,
): Promise<string[]> {
  const since = offsetDay(todayKey(), -(n - 1));
  const rows = await db.studyDay.findMany({
    where: { userId, date: { gte: since } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.date);
}

/**
 * 东八区「今天 00:00」对应的 UTC 时刻。
 *
 * 用于「今日活跃 / 今日学习」这类按天统计的查询起点：统一用东八区，
 * 避免服务端（如 Vercel 的 UTC 时区）与目标用户（中文学生）时区不一致，
 * 导致「今日」统计与其它打卡/连续天数逻辑差 8 小时。
 */
export function todayStartUtc(d: Date = new Date()): Date {
  const key = todayKey(d); // YYYY-MM-DD（Asia/Shanghai）
  // "YYYY-MM-DDT00:00:00+08:00" 由 JS 正确解析为对应的 UTC 时刻。
  return new Date(`${key}T00:00:00+08:00`);
}
