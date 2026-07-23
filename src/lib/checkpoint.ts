/**
 * 答题进度存档点（checkpoint）
 *
 * 用户在认字 / 测试阶段每答完一题都会写入一个存档点。若用户中途离开页面
 * （例如有急事），下次回到答题页时会自动恢复到上次的阶段与位置，无需
 * 从头再来。
 *
 * 存档范围：单个浏览器 + 单个上下文（全局队列 或 某个单元）。
 * 用 localStorage 存储，避免给数据库增加 schema 迁移负担；存档点天然
 * 跟随浏览器，符合「临时续做」的语义。
 *
 * 只存「可恢复」的进度数据（阶段、索引、统计、测试队列的词 id 顺序），
 * 完整的 WordFull 对象在恢复时由从服务端拉取的队列按 id 重建，
 * 因此存档点小巧、且不会因词库内容变动而引用失效（失效时直接丢弃）。
 */

/** 与认字评估 → 测试 → 完成 三段式一致的阶段。 */
export type Phase = "assessment" | "quiz" | "done";

/** 一份可恢复的存档点。 */
export interface Checkpoint {
  /** 结构版本号，升级字段时递增以作废旧存档。 */
  version: number;
  /** 写入时间（仅用于排查，不参与恢复判定）。 */
  ts: number;
  phase: Phase;
  /** 上下文标识：`'global'` 或 `${level}::${category}`。 */
  unitKey: string;
  /**
   * 本次从服务端拉取的队列词 id 顺序（恢复时的「指纹」）。
   * 若恢复时实际队列的指纹与存档不一致（例如换天 / 词库变化），
   * 视为过期，直接丢弃存档从头开始。
   */
  queueSignature: string[];

  // ── 认字评估阶段 ──
  currentIndex: number;
  knownWordIds: string[];
  unknownWordIds: string[];

  // ── 测试阶段 ──
  quizQueueIds: string[]; // 测试队列（含答错后重新插入的重复项，顺序敏感）
  quizIndex: number;
  quizTotal: number;
  quizAnswered: number;
  quizStats: { correct: number; wrong: number };
  quizWrongCounts: Record<string, number>;
}

const VERSION = 1;
const PREFIX = "study:checkpoint:";

function keyFor(unitKey: string): string {
  return PREFIX + unitKey;
}

/** 读取某个上下文的存档点；不存在或解析失败返回 null。 */
export function loadCheckpoint(unitKey: string): Checkpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(unitKey));
    if (!raw) return null;
    const data = JSON.parse(raw) as Checkpoint;
    if (data.version !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** 写入（覆盖）某个上下文的存档点。 */
export function saveCheckpoint(
  unitKey: string,
  cp: Omit<Checkpoint, "version" | "ts">,
): void {
  if (typeof window === "undefined") return;
  try {
    const full: Checkpoint = { ...cp, version: VERSION, ts: Date.now() };
    window.localStorage.setItem(keyFor(unitKey), JSON.stringify(full));
  } catch {
    // localStorage 满或被禁用时静默跳过 —— 存档点是增强功能，不应阻断学习。
  }
}

/** 清除某个上下文的存档点（完成 / 重新开始时调用）。 */
export function clearCheckpoint(unitKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(unitKey));
  } catch {
    // 忽略
  }
}
