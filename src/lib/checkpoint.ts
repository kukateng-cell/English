/**
 * 答题进度存档点（checkpoint）
 *
 * 学习流程为「逐词」推进：每个词先做认字评估，随即立刻测试，答对后再
 * 推送下一个词。用户每完成一步都会写入存档点；若中途离开页面（例如有
 * 急事），下次回到答题页时可从「下一个未做的词」继续，无需从头再来。
 *
 * 重要：存档点只记录「已完成词的边界」，不记录某个词进行到一半的状态。
 * 因此用户若在某个词的测试中途离开，回来时不会被强制回到「上次那个
 * 还没测完的词」，而是直接从下一个新词开始。
 *
 * 存档范围：单个浏览器 + 单个上下文（全局队列 或 某个单元）。
 * 用 localStorage 存储，避免给数据库增加 schema 迁移负担；存档点天然
 * 跟随浏览器，符合「临时续做」的语义。
 *
 * 只存「可恢复」的进度数据（下一个词的下标、已分类词 id、累计统计），
 * 完整的 WordFull 对象在恢复时由从服务端拉取的队列按 id 重建，
 * 因此存档点小巧、且不会因词库内容变动而引用失效（失效时直接丢弃）。
 */

/** 阶段：仍在逐词学习中，或已全部完成。 */
export type Phase = "assess" | "done";

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
   * 本次从服务端拉取的队列词 id 集合（恢复时的「指纹」）。
   * 若恢复时实际队列的词集合与存档不一致（例如换天 / 词库变化），
   * 视为过期，直接丢弃存档从头开始。
   */
  queueSignature: string[];

  /**
   * 下一个要学习的词下标。恢复时始终从该词的「认字评估」步开始，
   * 不恢复某个词进行到一半的测试状态。
   */
  currentIndex: number;
  /** 已完成词中标记为「认识」的词 id（用于完成页统计）。 */
  knownWordIds: string[];
  /** 已完成词中标记为「不认识」的词 id（用于完成页统计）。 */
  unknownWordIds: string[];
  /** 累计测试统计。 */
  quizStats: { correct: number; wrong: number };
}

const VERSION = 2;
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
