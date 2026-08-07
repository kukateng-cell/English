/**
 * 客户端「待提交评测」队列（outbox）
 *
 * 解决学习提交静默失败的问题：当 POST /api/study 因断网 / 5xx 等原因失败时，
 * 把该次评测（wordId + quality）暂存到 localStorage，待网络恢复、重新进入
 * 学习页、或定时器触发时自动重试提交，确保学习数据不再被静默丢弃。
 *
 * 安全性：服务端 POST 是幂等的（按 (userId, wordId) upsert，打卡 upsert 幂等），
 * 因此重试同一条评测不会产生脏数据。唯一非严格幂等的是 `totalReviews:
 * { increment: 1 }`，但本队列按 wordId 去重（同词只保留最新一条），且仅在
 * 「提交失败」时才重试，重复 increment 的概率与影响都极小，远好于「整条
 * 评测丢失」。极端情况下（服务端已写入但响应丢失），可能多计一次 totalReviews。
 */
export interface PendingReview {
  wordId: string;
  quality: number;
  /** 入队时间戳（仅用于排查，不参与恢复判定）。 */
  ts: number;
  /** 已尝试提交次数；超过上限的「毒丸」条目会被丢弃，避免永久阻塞队列。 */
  attempts: number;
}

/** 单条评测成功提交后，服务端返回的数据（仅保留页面需要的字段，松散类型）。 */
export interface StudyPostResult {
  streak?: unknown;
  newlyUnlocked?: unknown;
}

const QUEUE_KEY = "study:review-queue";
const VERSION = 1;
/** 单条评测最多重试次数，超过即丢弃（避免永久无法成功的条目阻塞队列）。 */
const MAX_ATTEMPTS = 6;

interface StoredQueue {
  version: number;
  items: PendingReview[];
}

function isPendingReview(x: unknown): x is PendingReview {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.wordId === "string" &&
    typeof r.quality === "number" &&
    typeof r.ts === "number" &&
    (r.attempts === undefined || typeof r.attempts === "number")
  );
}

/** 读取当前待提交队列（兼容旧版裸数组 / 缺 attempts 字段的存档）。 */
export function loadPendingReviews(): PendingReview[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredQueue> | PendingReview[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.filter(isPendingReview).map((r) => ({
      wordId: r.wordId,
      quality: r.quality,
      ts: r.ts,
      attempts: typeof r.attempts === "number" ? r.attempts : 0,
    }));
  } catch {
    return [];
  }
}

function persist(queue: PendingReview[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredQueue = { version: VERSION, items: queue };
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 满或被禁用 —— 忽略，不阻断学习。
  }
}

/** 当前队列长度（用于 UI 显示「待同步 N 条」）。 */
export function pendingReviewCount(): number {
  return loadPendingReviews().length;
}

/**
 * 入队一条待提交评测。按 wordId 去重（同词多次评测以最新 quality 为准）。
 * 返回入队后的队列长度，供调用方更新 UI。
 */
export function enqueuePendingReview(wordId: string, quality: number): number {
  const queue = loadPendingReviews().filter((r) => r.wordId !== wordId);
  queue.push({ wordId, quality, ts: Date.now(), attempts: 0 });
  persist(queue);
  return queue.length;
}

/**
 * 尽量把队列里待提交的评测 flush 到服务端。
 *
 * 逐条提交（复用幂等的 POST /api/study）：
 * - 成功（HTTP 2xx）：从队列移除，并通过 onDone 回传最新 streak / 成就。
 * - 网络错误（fetch throw）：判定为断网，立即停止本轮，剩余条目原样保留。
 * - 非 2xx：标记失败、attempts+1，继续尝试下一条（避免单条「毒丸」阻塞）；
 *   超过 MAX_ATTEMPTS 的条目丢弃。
 *
 * @returns flush 后仍留在队列里的条数。
 */
export async function flushPendingReviews(
  onDone?: (wordId: string, data: StudyPostResult) => void,
): Promise<number> {
  const queue = loadPendingReviews();
  if (queue.length === 0) return 0;

  const succeededIds = new Set<string>();
  const failedIds = new Set<string>();
  let networkDown = false;

  for (const item of queue) {
    if (networkDown) break;

    let ok = false;
    let result: StudyPostResult | null = null;
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: item.wordId, quality: item.quality }),
      });
      if (res.ok) {
        ok = true;
        result = (await res.json().catch(() => null)) as StudyPostResult | null;
      } else {
        failedIds.add(item.wordId);
      }
    } catch {
      // fetch 抛错 = 断网 / DNS 失败：本条失败且停止本轮，避免连续打失败请求。
      failedIds.add(item.wordId);
      networkDown = true;
    }

    if (ok) {
      succeededIds.add(item.wordId);
      onDone?.(item.wordId, result ?? {});
    }
  }

  // 重建队列：成功的移除；失败的 attempts+1 且超上限丢弃；未尝试的原样保留。
  const remaining = queue
    .filter((r) => !succeededIds.has(r.wordId))
    .map((r) =>
      failedIds.has(r.wordId) ? { ...r, attempts: r.attempts + 1 } : r,
    )
    .filter((r) => r.attempts < MAX_ATTEMPTS);
  persist(remaining);
  return remaining.length;
}
