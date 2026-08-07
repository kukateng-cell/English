/**
 * 单元（unit）定义：单元即 word list.md 中的 `### Category` 分组。
 * 这里显式声明每个级别的单元顺序，保证 /units 页面与 API 的展示顺序一致、
 * 且符合词表的学习顺序（数据库本身不存储顺序）。
 *
 * category 名必须与 seed.ts 解析出的 Word.category 完全一致
 * （seed 用 `### Title (中文)` 中的英文标题，去掉括号）。
 *
 * 注意：这里【不】从 @/generated/prisma 直接 import Level，而是用本地
 * `as const` 字面量联合——保持 lib 层与 Prisma 生成代码解耦，便于单测
 * 与纯逻辑复用。LevelCode 与 Prisma 的 enum Level（A1/A2/B1/B2）一致，
 * 可直接赋给 where/create/update 的 level 字段。
 */

/** A1 级别全部单元（按词表顺序） */
export const A1_UNITS: string[] = [
  "Hello and Goodbye",
  "People",
  "Numbers 0 to 100",
  "Family",
  "Colors",
  "Months and Seasons",
  "Time and Date",
  "Personal Information",
  "The Body",
  "The Head and Face",
  "Opposite Adjectives",
  "House and Apartment",
  "Furniture and Home Appliances",
  "Jobs",
  "Clothes and Shoes",
  "Animals",
  "Basic Verbs",
  "Household Items",
  "Food and Ingredients",
  "Food and Drinks",
  "The Weather and Nature",
  "Useful Verbs",
  "School",
  "City",
  "Free Time Activities",
  "Countries and Nationalities",
  "Simple Verbs",
  "Transportation",
  "Directions and Continents",
  "Adverbs and Pronouns",
  "Prepositions and Determiners",
  "Describing People",
];

/** 每个级别的单元顺序；未在表中出现的单元会追加在末尾（按字母序）。 */
export const UNIT_ORDER: Record<string, string[]> = {
  A1: A1_UNITS,
  A2: [],
  B1: [],
  B2: [],
};

/**
 * 把数据库里查到的单元列表，按 UNIT_ORDER 排序；
 * 表中没有的单元追加到末尾并按字母序排列，保证结果稳定。
 */
export function sortUnits(level: string, names: string[]): string[] {
  const order = UNIT_ORDER[level] ?? [];
  const indexed = new Map(order.map((n, i) => [n, i]));
  return [...new Set(names)].sort((a, b) => {
    const ia = indexed.has(a) ? indexed.get(a)! : Number.MAX_SAFE_INTEGER;
    const ib = indexed.has(b) ? indexed.get(b)! : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

// ────────────────────────────────────────────────────────────────
// 闯关解锁（Progressive Unlock）
//
// 规则：
//   1. 一个单元「已完成」= 认字数（mastered）达到该单元总词数的 80% 或以上。
//   2. 同一级别内，单元按 UNIT_ORDER 顺序解锁：第 1 个单元默认开放；
//      后续单元只有在前一个单元「已完成」后才解锁。
//   3. 级别之间同样按顺序解锁：A1 默认开放；A2 只有在 A1 的全部单元都「已完成」
//      后才解锁；B1 依此类推。
// ────────────────────────────────────────────────────────────────

/** 「掌握」判定：连续答对至少 1 次（SM-2 repetitions >= 1）。 */
export const MASTERED_REPETITIONS = 1;

/** 一个单元「已完成」所需的认字比例（mastered / total）。 */
export const UNIT_COMPLETION_RATIO = 0.8;

/** 级别顺序（用于解锁判定与排序）。未列出的级别排在已知级别之后。 */
export const LEVEL_ORDER: string[] = ["A1", "A2", "B1", "B2"];

/**
 * 所有合法的级别（与 prisma/schema.prisma 的 enum Level 保持一致）。
 *
 * 这里用本地 `as const` 字面量联合而非从 @/generated/prisma 导入 Level：
 * lib 层尽量不依赖生成代码，便于单测与纯逻辑复用。LevelCode 与 Prisma
 * 的 enum Level 完全一致，可直接赋给 where/create/update 的 level 字段。
 */
export const LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type LevelCode = (typeof LEVELS)[number];

/**
 * 把任意输入规范化为合法级别字面量；空值/非法值回退为 A1。
 *
 * 返回 LevelCode（字面量联合），可直接赋给 Prisma 的 where/create/update
 * 的 level 字段，无需 `as Level`、`as unknown as Level` 或
 * `as Prisma.WordXxxInput["level"]` 这类强转。
 */
export function normalizeLevel(s: unknown): LevelCode {
  const v = String(s ?? "A1").toUpperCase();
  if (v === "A1" || v === "A2" || v === "B1" || v === "B2") return v;
  return "A1";
}

/**
 * 同 normalizeLevel，但当输入为空（null/undefined/空串）时返回 null，
 * 用于 PATCH 语义：「未传 level」= 不更新该字段。
 */
export function normalizeLevelOrNull(s: unknown): LevelCode | null {
  if (s == null || s === "") return null;
  return normalizeLevel(s);
}

/** 单元是否「已完成」：总词数 > 0 且 认字数占比 >= 80%。 */
export function isUnitCompleted(total: number, mastered: number): boolean {
  // 空单元（0 词）直接视为已完成，避免「0 词单元永远无法完成」导致
  // 后续单元 / 下一级别被永久锁死（闯关解锁死锁）。
  if (total <= 0) return true;
  return mastered / total >= UNIT_COMPLETION_RATIO;
}

/** 级别排序比较器：按 LEVEL_ORDER，未列出者排后并按字母序。 */
export function levelCompare(a: string, b: string): number {
  const ia = LEVEL_ORDER.indexOf(a);
  const ib = LEVEL_ORDER.indexOf(b);
  const ra = ia === -1 ? LEVEL_ORDER.length : ia;
  const rb = ib === -1 ? LEVEL_ORDER.length : ib;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

/** 单个单元在聚合后的进度统计（不含解锁标记）。 */
export interface UnitStat {
  total: number;
  learned: number;
  mastered: number;
  due: number;
}

/** 给前端展示用的、带解锁/完成标记的单元。 */
export interface AggregatedUnit extends UnitStat {
  name: string;
  progress: number; // mastered / total * 100，已四舍五入
  completed: boolean;
  unlocked: boolean;
}

/** 一个级别的聚合结果。 */
export interface LevelAggregation {
  level: string;
  unlocked: boolean; // 该级别整体是否解锁
  completed: boolean; // 该级别全部单元是否都已完成
  progress: number; // 整级别 mastered / total * 100
  units: AggregatedUnit[];
}

/** computeUnlocks 所需的、按级别分组的有序单元统计。 */
interface LeveledUnitStats {
  [level: string]: { name: string; stat: UnitStat }[];
}

/**
 * 根据每个级别内【有序】单元的认字统计，推算各单元与各级别的解锁状态。
 *
 * - 第一级别恒解锁；其后级别需前一级别「全部单元已完成」。
 * - 每级别第一个单元在该级别解锁时即开放；其后单元需前一单元「已完成」。
 *
 * 返回：
 *   - levelUnlock: { [level]: boolean }
 *   - unitUnlock:  { [`${level}::${name}`]: boolean }
 */
export function computeUnlocks(stats: LeveledUnitStats): {
  levelUnlock: Record<string, boolean>;
  unitUnlock: Record<string, boolean>;
} {
  const sortedLevels = Object.keys(stats).sort(levelCompare);
  const levelUnlock: Record<string, boolean> = {};
  const unitUnlock: Record<string, boolean> = {};

  let prevLevelFullyCompleted = true; // 第一个级别恒解锁
  for (const lvl of sortedLevels) {
    const units = stats[lvl] ?? [];
    const levelUnlocked = prevLevelFullyCompleted;
    levelUnlock[lvl] = levelUnlocked;

    if (!levelUnlocked) {
      // 级别未解锁 → 其内所有单元都锁住
      for (const u of units) {
        unitUnlock[`${lvl}::${u.name}`] = false;
      }
    } else {
      let prevUnitCompleted = true; // 该级别第一个单元直接开放
      for (const u of units) {
        unitUnlock[`${lvl}::${u.name}`] = prevUnitCompleted;
        prevUnitCompleted = isUnitCompleted(u.stat.total, u.stat.mastered);
      }
    }

    // 本级别是否「全部单元已完成」（用于解锁下一级别）。
    // 注意：必须基于真实数据，而非解锁标记，确保解锁判定稳健。
    prevLevelFullyCompleted =
      units.length > 0 &&
      units.every((u) => isUnitCompleted(u.stat.total, u.stat.mastered));
  }

  return { levelUnlock, unitUnlock };
}

/**
 * 一次性聚合【所有级别】的单元进度，并计算解锁状态。
 *
 * 入参为「裸」的数据库行（routes 负责 Prisma 查询），本函数与 Prisma 解耦，
 * 因此 /api/units 与 /api/study 可共用同一套聚合 + 解锁逻辑。
 *
 * 为了把聚合尽量下推到数据库，本函数不再接受「全表 Word 列表」：
 *   - 单元总词数（total）由 routes 用 `Word.groupBy({ by: ["level","category"] })`
 *     算好后作为 unitTotals 传入；
 *   - 学过/掌握/待复习（learned/mastered/due）由 routes 取当前用户 Review
 *     （select 时一并带上所属单词的 level / category）后传入。
 * 这样避免了「读全表 words + 全部 reviews 再在内存里 filter/group」的开销。
 *
 * @param levels      需要聚合的级别列表（一般 = 数据库中存在单词的级别）
 * @param unitTotals  每个 (level, category) 单元的总词数（来自 Word.groupBy）
 * @param reviews     当前用户的 Review 记录，每条已带上所属单词的 level / category
 * @param now         「现在」时间（用于判定 due）
 */
export function aggregateAllLevels(
  levels: string[],
  unitTotals: { level: string; category: string | null; total: number }[],
  reviews: {
    repetitions: number;
    nextReviewDate: Date;
    level: string;
    category: string | null;
  }[],
  now: Date,
): LevelAggregation[] {
  // 按 (level, category) 聚合：
  //   - total 来自 unitTotals（DB groupBy 下推）；
  //   - learned/mastered/due 来自 reviews（每用户，且已带 word 的 level/category）。
  const agg = new Map<string, Map<string, UnitStat>>();
  const ensureUnit = (lvl: string, cat: string) => {
    if (!agg.has(lvl)) agg.set(lvl, new Map());
    const lvlMap = agg.get(lvl)!;
    if (!lvlMap.has(cat)) lvlMap.set(cat, { total: 0, learned: 0, mastered: 0, due: 0 });
    return lvlMap.get(cat)!;
  };

  for (const u of unitTotals) {
    ensureUnit(u.level, u.category ?? "未分类").total += u.total;
  }
  for (const r of reviews) {
    const s = ensureUnit(r.level, r.category ?? "未分类");
    s.learned += 1;
    if (r.repetitions >= MASTERED_REPETITIONS) s.mastered += 1;
    if (new Date(r.nextReviewDate) <= now) s.due += 1;
  }

  // 给 computeUnlocks 准备有序统计结构
  const stats: LeveledUnitStats = {};
  for (const lvl of levels) {
    const lvlMap = agg.get(lvl);
    const names = lvlMap ? [...lvlMap.keys()] : [];
    const ordered = sortUnits(lvl, names);
    stats[lvl] = ordered.map((name) => ({
      name,
      stat: lvlMap!.get(name)!,
    }));
  }

  const { levelUnlock, unitUnlock } = computeUnlocks(stats);

  // 组装最终结构
  return levels.map((level) => {
    const lvlMap = agg.get(level);
    const names = lvlMap ? [...lvlMap.keys()] : [];
    const ordered = sortUnits(level, names);

    const units: AggregatedUnit[] = ordered.map((name) => {
      const s = lvlMap!.get(name)!;
      return {
        name,
        total: s.total,
        learned: s.learned,
        mastered: s.mastered,
        due: s.due,
        progress: s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0,
        completed: isUnitCompleted(s.total, s.mastered),
        unlocked: !!unitUnlock[`${level}::${name}`],
      };
    });

    const grandTotal = units.reduce((a, u) => a + u.total, 0);
    const grandMastered = units.reduce((a, u) => a + u.mastered, 0);

    return {
      level,
      unlocked: !!levelUnlock[level],
      completed: units.length > 0 && units.every((u) => u.completed),
      progress: grandTotal > 0 ? Math.round((grandMastered / grandTotal) * 100) : 0,
      units,
    };
  });
}
