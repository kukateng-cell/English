/**
 * 单元（unit）定义：单元即 word list.md 中的 `### Category` 分组。
 * 这里显式声明每个级别的单元顺序，保证 /units 页面与 API 的展示顺序一致、
 * 且符合词表的学习顺序（数据库本身不存储顺序）。
 *
 * category 名必须与 seed.ts 解析出的 Word.category 完全一致
 * （seed 用 `### Title (中文)` 中的英文标题，去掉括号）。
 *
 * 注意：这里【不】定义 Level 类型——Prisma 在 Postgres schema 下把
 * Word.level 定义为 `enum Level { A1 A2 B1 }`（见 prisma/schema.prisma），
 * 而在 SQLite 预览 schema 下是 `String`。为避免类型冲突，本文件只用
 * 原生 string 作为级别键，API 层查询时再把 string 转成 Prisma 的 Level。
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
