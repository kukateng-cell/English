/**
 * 成就系统：定义 + 解锁检查 + 状态查询。
 *
 * 设计：成就「定义」以代码常量形式集中于此（key 唯一），
 * 用户解锁记录存 UserAchievement 表。这样新增成就只需改这里，不用改表。
 */
import { prisma, type Prisma } from "@/lib/prisma";
import { computeStreak } from "@/lib/streak";
import type { RewardIconName } from "@/lib/reward-icons";

/** 成就定义。type 决定用哪个进度数据源。 */
export interface AchievementDef {
  key: string;
  /** EMM Style 02 icon key rendered by the student UI. */
  icon: AchievementIcon;
  /** 简体标题（前端经 tc() 转繁简）。 */
  title: string;
  description: string;
  /** 进度来源：复习词数 / 连续天数 / 累计打卡天数 */
  type: "reviews" | "streak" | "studyDays";
  /** 达成目标值。 */
  target: number;
}

export type AchievementIcon = RewardIconName;

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_study", icon: "seedling", title: "初次學習", description: "完成第一次學習", type: "reviews", target: 1 },
  { key: "review_10", icon: "book", title: "小試牛刀", description: "累計複習 10 個詞", type: "reviews", target: 10 },
  { key: "review_50", icon: "word-stack", title: "漸入佳境", description: "累計複習 50 個詞", type: "reviews", target: 50 },
  { key: "review_100", icon: "medal", title: "百詞斬", description: "累計複習 100 個詞", type: "reviews", target: 100 },
  { key: "streak_3", icon: "flame", title: "連學 3 天", description: "連續學習 3 天", type: "streak", target: 3 },
  { key: "streak_7", icon: "bolt", title: "連學 7 天", description: "連續學習 7 天", type: "streak", target: 7 },
  { key: "streak_30", icon: "star", title: "連學 30 天", description: "連續學習 30 天", type: "streak", target: 30 },
  { key: "study_7", icon: "calendar-check", title: "堅持一週", description: "累計打卡 7 天", type: "studyDays", target: 7 },
  { key: "study_30", icon: "trophy", title: "月度堅持", description: "累計打卡 30 天", type: "studyDays", target: 30 },
];

type AchievementDb = Pick<
  Prisma.TransactionClient,
  "review" | "studyDay" | "userAchievement"
>;

const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function achievementsForKeys(keys: string[]): AchievementDef[] {
  return keys
    .map((key) => ACHIEVEMENT_BY_KEY.get(key))
    .filter((a): a is AchievementDef => Boolean(a));
}

/** 用户成就的展示状态。 */
export interface AchievementStatus extends AchievementDef {
  unlocked: boolean;
  unlockedAt: string | null;
  /** 当前进度值（与 target 比较）。 */
  progress: number;
}

/** 取用户的进度数据（复习词数 / 连续天数 / 累计打卡天数）。 */
async function getUserProgress(userId: string, db: AchievementDb): Promise<{
  reviews: number;
  streak: number;
  studyDays: number;
}> {
  // A Prisma interactive transaction is backed by one pg client. Running
  // these reads concurrently makes pg@9 queue overlapping client.query calls
  // and can produce nondeterministic warnings during the V2 action path.
  const reviews = await db.review.count({ where: { userId } });
  const studyDays = await db.studyDay.count({ where: { userId } });
  const streakInfo = await computeStreak(userId, db);
  return { reviews, streak: streakInfo.count, studyDays };
}

function valueFor(a: AchievementDef, p: {
  reviews: number;
  streak: number;
  studyDays: number;
}): number {
  return a.type === "reviews" ? p.reviews
    : a.type === "streak" ? p.streak
    : p.studyDays;
}

/**
 * 检查并解锁新成就。
 * 在学习打卡后调用；幂等（已解锁的不会重复写入）。
 * 返回本次【新解锁】的成就定义列表（供前端即时弹提示）。
 */
export async function checkAchievements(
  userId: string,
  db: AchievementDb = prisma,
): Promise<AchievementDef[]> {
  const progress = await getUserProgress(userId, db);
  const unlocked = await db.userAchievement.findMany({
    where: { userId },
    select: { key: true },
  });
  const unlockedSet = new Set(unlocked.map((u) => u.key));

  const eligible = ACHIEVEMENTS.filter(
    (a) => !unlockedSet.has(a.key) && valueFor(a, progress) >= a.target,
  );
  if (eligible.length > 0) {
    // PostgreSQL 的 skipDuplicates 会在唯一键竞争时忽略已由另一请求写入的项。
    // 学习 API 还会把本函数放在 Serializable transaction 内，确保通知结果一致。
    const inserted = await db.userAchievement.createManyAndReturn({
      data: eligible.map((a) => ({ userId, key: a.key })),
      skipDuplicates: true,
      select: { key: true },
    });
    return achievementsForKeys(inserted.map((row) => row.key));
  }
  return [];
}

/** 获取用户全部成就的状态（含进度），供成就页面展示。 */
export async function getAchievementStatus(
  userId: string,
): Promise<AchievementStatus[]> {
  const progress = await getUserProgress(userId, prisma);
  const unlocked = await prisma.userAchievement.findMany({
    where: { userId },
    select: { key: true, unlockedAt: true },
  });
  const unlockedMap = new Map(unlocked.map((u) => [u.key, u]));

  return ACHIEVEMENTS.map((a) => {
    const u = unlockedMap.get(a.key);
    return {
      ...a,
      unlocked: !!u,
      unlockedAt: u ? u.unlockedAt.toISOString() : null,
      progress: valueFor(a, progress),
    };
  });
}
