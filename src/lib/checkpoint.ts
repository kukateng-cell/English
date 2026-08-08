/**
 * 答题进度存档点（checkpoint）
 *
 * 学习流程为「逐词」推进：每个词先做认字评估，随即立刻测试，答对后再
 * 推送下一个词。用户每完成一步都会写入存档点；若中途离开页面（例如有
 * 急事），下次回到答题页时可从「下一个未做的词」继续，无需从头再来。
 *
 * 测试中的词并未完成，因此会记录 quiz target 与答错次数；恢复时继续该词，
 * 不会把未写入 Review 的词误当成已完成。
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
export type Phase = "assess" | "quiz" | "done";

/** 一份可恢复的存档点。 */
export interface Checkpoint {
  /** 结构版本号，升级字段时递增以作废旧存档。 */
  version: number;
  /** 防止公用浏览器切换账号时跨用户恢复。 */
  ownerId: string;
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
  /** phase=quiz 时当前测试目标及已答错次数。 */
  quizTargetId: string | null;
  quizWrongCount: number;
  /**
   * 尚未完成测试的「不认识」词 id（延后测试队列）。
   * 恢复进度时据此重建 pendingQuizzes，避免恢复后这些词被静默跳过、
   * 既不测试也无 SM-2 记录。
   */
  pendingQuizIds: string[];
}

const VERSION = 4;
const PREFIX = "study:checkpoint:";

function keyFor(userId: string, unitKey: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}:${unitKey}`;
}

function isWordIdArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (id) =>
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 128 &&
        /^[A-Za-z0-9_-]+$/.test(id),
    )
  );
}

/** localStorage is untrusted/mutable; validate every field used by restoreProgress. */
function isCheckpoint(
  value: unknown,
  userId: string,
  unitKey: string,
): value is Checkpoint {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  const stats = data.quizStats as Record<string, unknown> | null;
  if (
    data.version !== VERSION ||
    data.ownerId !== userId ||
    data.unitKey !== unitKey ||
    typeof data.ts !== "number" ||
    !Number.isFinite(data.ts) ||
    (data.phase !== "assess" &&
      data.phase !== "quiz" &&
      data.phase !== "done") ||
    !Number.isInteger(data.currentIndex) ||
    (data.currentIndex as number) < 0 ||
    !isWordIdArray(data.queueSignature) ||
    new Set(data.queueSignature).size !== data.queueSignature.length ||
    (data.currentIndex as number) > data.queueSignature.length ||
    !isWordIdArray(data.knownWordIds) ||
    !isWordIdArray(data.unknownWordIds) ||
    !isWordIdArray(data.pendingQuizIds) ||
    (data.quizTargetId !== null && typeof data.quizTargetId !== "string") ||
    !Number.isInteger(data.quizWrongCount) ||
    (data.quizWrongCount as number) < 0 ||
    typeof stats !== "object" ||
    stats === null ||
    !Number.isInteger(stats.correct) ||
    (stats.correct as number) < 0 ||
    !Number.isInteger(stats.wrong) ||
    (stats.wrong as number) < 0
  ) {
    return false;
  }
  const queueIds = data.queueSignature as string[];
  const knownIds = data.knownWordIds as string[];
  const unknownIds = data.unknownWordIds as string[];
  const pendingIds = data.pendingQuizIds as string[];
  const queueSet = new Set(queueIds);
  const knownSet = new Set(knownIds);
  const targetId = data.quizTargetId as string | null;
  if (
    queueIds.length === 0 ||
    new Set(knownIds).size !== knownIds.length ||
    new Set(unknownIds).size !== unknownIds.length ||
    new Set(pendingIds).size !== pendingIds.length ||
    [...knownIds, ...unknownIds, ...pendingIds].some(
      (id) => !queueSet.has(id),
    ) ||
    unknownIds.some((id) => knownSet.has(id)) ||
    (targetId !== null &&
      (!isWordIdArray([targetId]) || !queueSet.has(targetId))) ||
    (data.phase === "quiz" && targetId === null) ||
    (data.phase !== "quiz" && targetId !== null) ||
    (targetId !== null && pendingIds.includes(targetId)) ||
    (data.phase === "done" &&
      (pendingIds.length !== 0 || data.currentIndex !== queueIds.length)) ||
    (data.phase !== "done" && (data.currentIndex as number) >= queueIds.length)
  ) {
    return false;
  }
  return true;
}

/** 读取某个上下文的存档点；不存在或解析失败返回 null。 */
export function loadCheckpoint(
  userId: string,
  unitKey: string,
): Checkpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId, unitKey));
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!isCheckpoint(data, userId, unitKey)) {
      window.localStorage.removeItem(keyFor(userId, unitKey));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** 写入（覆盖）某个上下文的存档点。 */
export function saveCheckpoint(
  userId: string,
  unitKey: string,
  cp: Omit<Checkpoint, "version" | "ts" | "ownerId">,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const full: Checkpoint = {
      ...cp,
      ownerId: userId,
      version: VERSION,
      ts: Date.now(),
    };
    window.localStorage.setItem(
      keyFor(userId, unitKey),
      JSON.stringify(full),
    );
    return true;
  } catch {
    // 不可留下较旧 checkpoint，否则 outbox 已落地但重开后会再答同一词。
    try {
      window.localStorage.removeItem(keyFor(userId, unitKey));
    } catch {
      // 存储完全不可用；outbox 入队会阻止页面推进并显示明确错误。
    }
    return false;
  }
}

/** 清除某个上下文的存档点（完成 / 重新开始时调用）。 */
export function clearCheckpoint(userId: string, unitKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId, unitKey));
  } catch {
    // 忽略
  }
}
