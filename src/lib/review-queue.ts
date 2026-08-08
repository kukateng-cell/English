/**
 * 客户端「待提交评测」队列（outbox）
 *
 * 解决学习提交静默失败的问题：每次评测先写入 localStorage，再由网络 flush；
 * 待网络恢复、重新进入学习页或定时器触发时自动重试。
 *
 * 每次评测都有 operationId；服务端以 (userId, operationId) 唯一键 exactly-once
 * 处理，因此「已提交但响应丢失」可安全重试。localStorage key 与条目 ownerId
 * 都按用户隔离，公用装置切换账号也不会把 A 的答案写入 B。
 */
export interface PendingReview {
  ownerId: string;
  operationId: string;
  wordId: string;
  quality: number;
  /** 入队时间戳（仅用于排查，不参与恢复判定）。 */
  ts: number;
  /** 已尝试提交次数（只供 UI/排查；绝不因超过次数而静默丢弃）。 */
  attempts: number;
  /** 永久 4xx 会转入 blocked，停止自动重送但保留给用户查看／清除。 */
  status: "pending" | "blocked";
  lastError?: string;
}

/** 单条评测成功提交后，服务端返回的数据（仅保留页面需要的字段，松散类型）。 */
export interface StudyPostResult {
  streak?: unknown;
  newlyUnlocked?: unknown;
}

const QUEUE_PREFIX = "study:review-queue:";
const ITEM_PREFIX = "study:review-item:";
const LEGACY_QUEUE_KEY = "study:review-queue";
const VERSION = 3;

interface StoredQueue {
  version: number;
  items: PendingReview[];
}

function isPendingReview(x: unknown): x is PendingReview {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.ownerId === "string" &&
    typeof r.operationId === "string" &&
    typeof r.wordId === "string" &&
    typeof r.quality === "number" &&
    typeof r.ts === "number" &&
    (r.attempts === undefined || typeof r.attempts === "number") &&
    (r.status === undefined || r.status === "pending" || r.status === "blocked")
  );
}

/** 读取指定用户的待提交队列；旧版无 owner 的全局队列不会被任何账号接管。 */
function queueKey(userId: string): string {
  return `${QUEUE_PREFIX}${encodeURIComponent(userId)}`;
}

function itemPrefix(userId: string): string {
  return `${ITEM_PREFIX}${encodeURIComponent(userId)}:`;
}

function itemKey(userId: string, operationId: string): string {
  return `${itemPrefix(userId)}${encodeURIComponent(operationId)}`;
}

function normalizePendingReview(
  row: PendingReview,
  userId: string,
): PendingReview | null {
  if (row.ownerId !== userId) return null;
  return {
    ownerId: row.ownerId,
    operationId: row.operationId,
    wordId: row.wordId,
    quality: row.quality,
    ts: row.ts,
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    status: row.status === "blocked" ? "blocked" : "pending",
    lastError: typeof row.lastError === "string" ? row.lastError : undefined,
  };
}

function writeReviewItem(userId: string, item: PendingReview): boolean {
  try {
    window.localStorage.setItem(itemKey(userId, item.operationId), JSON.stringify(item));
    return true;
  } catch {
    return false;
  }
}

function removeReviewItem(userId: string, operationId: string): boolean {
  try {
    window.localStorage.removeItem(itemKey(userId, operationId));
    return true;
  } catch {
    return false;
  }
}

export function loadPendingReviews(userId: string): PendingReview[] {
  if (typeof window === "undefined") return [];
  const itemsByOperation = new Map<string, PendingReview>();
  // 旧 mutable-array 格式损坏时，不可连带遮蔽已经迁移好的 per-operation keys。
  try {
    const raw = window.localStorage.getItem(queueKey(userId));
    if (raw) {
      try {
        // v2/v3 stored one mutable array. Migrate each operation to its own key so
        // different tabs can enqueue without a read-modify-write lost update.
        const parsed = JSON.parse(raw) as Partial<StoredQueue>;
        if (parsed.version === VERSION || parsed.version === 2) {
          const scoped = Array.isArray(parsed.items)
            ? parsed.items
                .filter(isPendingReview)
                .map((row) => normalizePendingReview(row, userId))
                .filter((row): row is PendingReview => row !== null)
            : [];
          let migrated = true;
          for (const row of scoped) {
            itemsByOperation.set(row.operationId, row);
            if (!writeReviewItem(userId, row)) migrated = false;
          }
          if (migrated) window.localStorage.removeItem(queueKey(userId));
        }
      } catch {
        // Ignore only the corrupt legacy blob; valid per-operation rows still load.
      }
    }

    const prefix = itemPrefix(userId);
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const itemRaw = window.localStorage.getItem(key);
      if (!itemRaw) continue;
      try {
        const parsed = JSON.parse(itemRaw) as unknown;
        if (!isPendingReview(parsed)) continue;
        const normalized = normalizePendingReview(parsed, userId);
        if (normalized) itemsByOperation.set(normalized.operationId, normalized);
      } catch {
        // One corrupt operation must not hide later valid operations in the scan.
      }
    }
  } catch {
    // Return every valid row collected before the storage/parse failure.
  }
  return [...itemsByOperation.values()].sort(
    (a, b) => a.ts - b.ts || a.operationId.localeCompare(b.operationId),
  );
}

/** 当前队列长度（用于 UI 显示「待同步 N 条」）。 */
export function pendingReviewCount(userId: string): number {
  return loadPendingReviews(userId).filter((r) => r.status === "pending").length;
}

export function blockedReviewCount(userId: string): number {
  return loadPendingReviews(userId).filter((r) => r.status === "blocked").length;
}

export function blockedReviewMessage(userId: string): string | null {
  return (
    loadPendingReviews(userId).find((r) => r.status === "blocked")
      ?.lastError ?? null
  );
}

/** 用户确认后移除无法自动重试的永久失败项目。 */
export function discardBlockedReviews(userId: string): void {
  for (const item of loadPendingReviews(userId)) {
    if (item.status === "blocked") {
      removeReviewItem(userId, item.operationId);
    }
  }
}

export function discardPendingReview(
  userId: string,
  operationId: string,
): void {
  removeReviewItem(userId, operationId);
}

interface LegacyReview {
  wordId: string;
  quality: number;
  ts: number;
}

function loadLegacyReviews(): LegacyReview[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as
      | { items?: unknown[] }
      | unknown[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.wordId !== "string" ||
        typeof row.quality !== "number" ||
        !Number.isInteger(row.quality) ||
        row.quality < 0 ||
        row.quality > 5
      ) {
        return [];
      }
      return [{
        wordId: row.wordId,
        quality: row.quality,
        ts: typeof row.ts === "number" ? row.ts : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

/** 旧版全局 queue 无 owner；只能在用户明确确认后归属当前账号。 */
export function legacyReviewCount(): number {
  return loadLegacyReviews().length;
}

export function claimLegacyReviews(userId: string): number {
  const legacy = loadLegacyReviews();
  for (const [index, item] of legacy.entries()) {
    enqueuePendingReview(
      userId,
      stableLegacyOperationId(userId, item, index),
      item.wordId,
      item.quality,
    );
  }
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LEGACY_QUEUE_KEY);
  }
  return pendingReviewCount(userId);
}

function stableLegacyOperationId(
  userId: string,
  item: LegacyReview,
  index: number,
): string {
  const source = `${userId}:${item.wordId}:${item.quality}:${item.ts}:${index}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-claim:${(hash >>> 0).toString(16).padStart(8, "0")}:${index}`;
}

export function discardLegacyReviews(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LEGACY_QUEUE_KEY);
  }
}

/**
 * 入队一条待提交评测。只按 operationId 去重；同词多次评测是有次序的独立事件，
 * 不可互相覆盖。
 * 返回入队后的队列长度，供调用方更新 UI。
 */
export function enqueuePendingReview(
  userId: string,
  operationId: string,
  wordId: string,
  quality: number,
): number {
  const item: PendingReview = {
    ownerId: userId,
    operationId,
    wordId,
    quality,
    ts: Date.now(),
    attempts: 0,
    status: "pending",
  };
  if (!writeReviewItem(userId, item)) {
    throw new Error("REVIEW_QUEUE_STORAGE_UNAVAILABLE");
  }
  return pendingReviewCount(userId);
}

/**
 * 尽量把队列里待提交的评测 flush 到服务端。
 *
 * 逐条提交（复用幂等的 POST /api/study）：
 * - 成功（HTTP 2xx）：从队列移除，并通过 onDone 回传最新 streak / 成就。
 * - 网络错误（fetch throw）：判定为断网，立即停止本轮，剩余条目原样保留。
 * - 非 2xx：标记失败并保留；401/422 暂停本轮，其他错误继续下一条。
 *
 * @returns flush 后仍留在队列里的条数。
 */
async function flushPendingReviewsUnlocked(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
): Promise<number> {
  const queue = loadPendingReviews(userId).filter((r) => r.status === "pending");
  if (queue.length === 0) return 0;

  const succeededOperations = new Set<string>();
  const failedOperations = new Map<
    string,
    { permanent: boolean; message?: string }
  >();
  let networkDown = false;

  for (const item of queue) {
    if (networkDown) break;

    let ok = false;
    let result: StudyPostResult | null = null;
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: item.operationId,
          wordId: item.wordId,
          quality: item.quality,
        }),
      });
      if (res.ok) {
        ok = true;
        result = (await res.json().catch(() => null)) as StudyPostResult | null;
      } else {
        const payload = (await res.json().catch(() => null)) as
          | { error?: unknown }
          | null;
        const message =
          typeof payload?.error === "string"
            ? payload.error.slice(0, 200)
            : `HTTP ${res.status}`;
        const permanent =
          res.status >= 400 &&
          res.status < 500 &&
          ![401, 408, 422, 429].includes(res.status);
        failedOperations.set(item.operationId, { permanent, message });
        // 未登入／尚未完成强制改密时，后续条目也不可能成功；保留原队列等状态恢复。
        if (res.status === 401 || res.status === 422) networkDown = true;
      }
    } catch {
      // fetch 抛错 = 断网 / DNS 失败：本条失败且停止本轮，避免连续打失败请求。
      failedOperations.set(item.operationId, { permanent: false });
      networkDown = true;
    }

    if (ok) {
      succeededOperations.add(item.operationId);
      onDone?.(item.wordId, result ?? {});
    }
  }

  // 每个 operation 独立存储：只删除成功 key、只更新本轮失败 key。期间由其他
  // tab 新增的 key 不会被整份 snapshot 覆盖。
  for (const operationId of succeededOperations) {
    removeReviewItem(userId, operationId);
  }
  const latest = new Map(
    loadPendingReviews(userId).map((item) => [item.operationId, item]),
  );
  for (const [operationId, failure] of failedOperations) {
    const item = latest.get(operationId);
    if (!item) continue;
    writeReviewItem(userId, {
      ...item,
      attempts: item.attempts + 1,
      status: failure.permanent ? "blocked" : item.status,
      lastError: failure.message ?? item.lastError,
    });
  }
  return pendingReviewCount(userId);
}

const localFlushes = new Map<string, Promise<number>>();

export async function flushPendingReviews(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
): Promise<number> {
  // 多个页面生命周期事件／浏览器分页面可同时触发 flush。Web Locks 可用时
  // 将同一用户的 flush 串行化；服务端 operationId 幂等仍是最后防线。
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`study-review-queue:${userId}`, () =>
      flushPendingReviewsUnlocked(userId, onDone),
    );
  }
  // Safari/older browsers without Web Locks still need a page-level mutex;
  // otherwise every quick answer starts another flush over the same operations.
  // Every explicit call is chained: an item enqueued while the active scan is
  // in-flight is therefore picked up by the trailing scan instead of waiting 30s.
  const active = localFlushes.get(userId);
  const run = () => flushPendingReviewsUnlocked(userId, onDone);
  const queued = active ? active.catch(() => 0).then(run) : run();
  const tracked = queued.finally(() => {
    if (localFlushes.get(userId) === tracked) localFlushes.delete(userId);
  });
  localFlushes.set(userId, tracked);
  return tracked;
}
