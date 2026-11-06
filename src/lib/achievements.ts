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
  /** 繁體標題（前端經 tc() 轉繁簡）。 */
  title: string;
  description: string;
  /** 進度來源：複習詞數 / 首次學習紀錄 / 連續天數 / 累計打卡天數 */
  type: "reviews" | "firstStudy" | "streak" | "studyDays";
  /** 达成目标值。 */
  target: number;
}

export type AchievementIcon = RewardIconName;

export const ACHIEVEMENTS: AchievementDef[] = [
  // 初次學習以「是否已有任何學習紀錄」判定：字卡自評會留下 StudyEncounter，
  // 客觀認讀題會留下 Review；兩者都代表學生已踏出第一步，不應因未遇到客觀題而顯示 0 / 1。
  { key: "first_study", icon: "seedling", title: "初次學習", description: "完成第一次學習", type: "firstStudy", target: 1 },
  { key: "review_10", icon: "book", title: "小試牛刀", description: "累計複習 10 個詞", type: "reviews", target: 10 },
  { key: "review_50", icon: "word-stack", title: "漸入佳境", description: "累計複習 50 個詞", type: "reviews", target: 50 },
  { key: "review_100", icon: "medal", title: "百詞斬", description: "累計複習 100 個詞", type: "reviews", target: 100 },
  { key: "streak_3", icon: "flame", title: "連學 3 天", description: "連續學習 3 天", type: "streak", target: 3 },
  { key: "streak_7", icon: "bolt", title: "連學 7 天", description: "連續學習 7 天", type: "streak", target: 7 },
  { key: "streak_30", icon: "star", title: "連學 30 天", description: "連續學習 30 天", type: "streak", target: 30 },
  { key: "study_7", icon: "calendar-check", title: "堅持一週", description: "累計打卡 7 天", type: "studyDays", target: 7 },
  { key: "study_30", icon: "trophy", title: "月度堅持", description: "累計打卡 30 天", type: "studyDays", target: 30 },
];

export type AchievementDb = Pick<
  Prisma.TransactionClient,
  "review" | "studyDay" | "studyEncounter" | "userAchievement"
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

/** 用户的进度数据（复习词数 / 首次学习纪录 / 连续天数 / 累计打卡天数）。 */
export interface AchievementProgress {
  reviews: number;
  /** 字卡自評留下的學習紀錄數量；客觀認讀題只會建立 Review，不會建立 StudyEncounter。 */
  encounters: number;
  streak: number;
  studyDays: number;
}

async function getUserProgress(userId: string, db: AchievementDb): Promise<AchievementProgress> {
  // A Prisma interactive transaction is backed by one pg client. Running
  // these reads concurrently makes pg@9 queue overlapping client.query calls
  // and can produce nondeterministic warnings during the V2 action path.
  const reviews = await db.review.count({ where: { userId } });
  const encounters = await db.studyEncounter.count({ where: { userId } });
  const studyDays = await db.studyDay.count({ where: { userId } });
  const streakInfo = await computeStreak(userId, db);
  return { reviews, encounters, streak: streakInfo.count, studyDays };
}

/**
 * 依成就類型換算目前進度值。
 *
 * 「初次學習」不直接使用 Review 數量：Review 只在客觀認讀題作答後才建立，
 * 只完成字卡自評的學生雖然已有 StudyEncounter，卻會被誤判為未學習。
 * 因此只要存在任何一種學習紀錄（字卡 encounter 或認讀題 Review）即視為已達成。
 */
export function achievementProgressValue(a: AchievementDef, p: AchievementProgress): number {
  switch (a.type) {
    case "reviews":
      return p.reviews;
    case "firstStudy":
      return p.reviews > 0 || p.encounters > 0 ? 1 : 0;
    case "streak":
      return p.streak;
    case "studyDays":
      return p.studyDays;
  }
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
    (a) => !unlockedSet.has(a.key) && achievementProgressValue(a, progress) >= a.target,
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
      progress: achievementProgressValue(a, progress),
    };
  });
}
