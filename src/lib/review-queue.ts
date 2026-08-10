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
  /** 永久 4xx（session 失效除外）会转入 blocked，停止自动重送但保留给用户查看／清除。 */
  status: "pending" | "blocked";
  lastError?: string;
  /** 暂时性错误的下一次允许提交时间，避免 429/5xx 时连续轰炸服务端。 */
  nextAttemptAt?: number;
  /** 由 GET /api/study 发出的 server-side submission credentials。 */
  studySessionId?: string;
  nonce?: string;
  credentialState: "valid" | "expired" | "legacy-claimed" | "blocked";
}

export interface ReviewSubmissionCredentials {
  studySessionId: string;
  nonce: string;
}

/** 单条评测成功提交后，服务端返回的数据（仅保留页面需要的字段，松散类型）。 */
export interface StudyPostResult {
  streak?: unknown;
  newlyUnlocked?: unknown;
}

export interface CredentialAttachmentResult {
  pendingCount: number;
  adoptedWordIds: string[];
  storageAvailable: boolean;
}

export interface LegacyFinalizationResult {
  blockedCount: number;
  storageAvailable: boolean;
}

export class ReviewQueueStorageError extends Error {
  constructor() {
    super("REVIEW_QUEUE_STORAGE_UNAVAILABLE");
    this.name = "ReviewQueueStorageError";
  }
}

const QUEUE_PREFIX = "study:review-queue:";
const ITEM_PREFIX = "study:review-item:";
const LEGACY_QUEUE_KEY = "study:review-queue";
const VERSION = 5;
const MAX_FLUSH_BATCH = 20;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const REVIEW_REQUEST_TIMEOUT_MS = 15_000;
const SESSION_REAUTH_ERROR = "学习 session 无效或已过期";

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
    (r.status === undefined || r.status === "pending" || r.status === "blocked") &&
    (r.nextAttemptAt === undefined || typeof r.nextAttemptAt === "number") &&
    (r.studySessionId === undefined || typeof r.studySessionId === "string") &&
    (r.nonce === undefined || typeof r.nonce === "string") &&
    (r.credentialState === undefined ||
      r.credentialState === "valid" ||
      r.credentialState === "expired" ||
      r.credentialState === "legacy-claimed" ||
      r.credentialState === "blocked")
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
    nextAttemptAt:
      typeof row.nextAttemptAt === "number" ? row.nextAttemptAt : undefined,
    studySessionId:
      typeof row.studySessionId === "string" ? row.studySessionId : undefined,
    nonce: typeof row.nonce === "string" ? row.nonce : undefined,
    credentialState:
      row.status === "blocked"
        ? "blocked"
        : row.credentialState === "valid" ||
            row.credentialState === "expired" ||
            row.credentialState === "legacy-claimed"
          ? row.credentialState
          : row.studySessionId && row.nonce
            ? "valid"
            : row.studySessionId
              ? "expired"
              : "legacy-claimed",
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

async function fetchReviewRequest(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REVIEW_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000));
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, timestamp - Date.now()));
}

function backoffMs(item: PendingReview, retryAfter?: number) {
  if (retryAfter !== undefined) return retryAfter;
  const base = Math.min(
    MAX_RETRY_DELAY_MS,
    1_000 * 2 ** Math.min(item.attempts, 8),
  );
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * jitter));
}

export function loadPendingReviews(userId: string): PendingReview[] {
  if (typeof window === "undefined") return [];
  const itemsByOperation = new Map<string, PendingReview>();
  try {
    // Read current per-operation rows first. A previous migration may have
    // written them before failing to remove the old mutable-array blob; the
    // stale blob must never overwrite a newer retry/credential state.
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

    // 旧 mutable-array 格式损坏时，不可连带遮蔽已经迁移好的 per-operation keys。
    const raw = window.localStorage.getItem(queueKey(userId));
    if (raw) {
      try {
        // v2/v3/v4 stored one mutable array. Migrate each operation to its own key so
        // different tabs can enqueue without a read-modify-write lost update.
        const parsed = JSON.parse(raw) as Partial<StoredQueue>;
        if (
          parsed.version === VERSION ||
          parsed.version === 4 ||
          parsed.version === 3 ||
          parsed.version === 2
        ) {
          const scoped = Array.isArray(parsed.items)
            ? parsed.items
                .filter(isPendingReview)
                .map((row) => normalizePendingReview(row, userId))
                .filter((row): row is PendingReview => row !== null)
            : [];
          let migrated = true;
          for (const row of scoped) {
            if (itemsByOperation.has(row.operationId)) continue;
            itemsByOperation.set(row.operationId, row);
            if (!writeReviewItem(userId, row)) migrated = false;
          }
          if (migrated) window.localStorage.removeItem(queueKey(userId));
        }
      } catch {
        // Ignore only the corrupt legacy blob; valid per-operation rows still load.
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
  credentials?: ReviewSubmissionCredentials,
): number {
  const item: PendingReview = {
    ownerId: userId,
    operationId,
    wordId,
    quality,
    ts: Date.now(),
    attempts: 0,
    status: "pending",
    nextAttemptAt: undefined,
    studySessionId: credentials?.studySessionId,
    nonce: credentials?.nonce,
    credentialState: credentials ? "valid" : "legacy-claimed",
  };
  if (!writeReviewItem(userId, item)) {
    throw new ReviewQueueStorageError();
  }
  return pendingReviewCount(userId);
}

/**
 * Rebind legacy outbox rows to the current server-issued session when their
 * word is present in the freshly loaded queue. Rows not in that queue remain
 * pending and visible; they are never sent without a valid nonce and never
 * silently discarded.
 */
export function attachStudySessionCredentials(
  userId: string,
  studySessionId: string,
  nonces: Record<string, string>,
): CredentialAttachmentResult {
  const pending = loadPendingReviews(userId);
  const adoptedWordIds: string[] = [];
  let storageAvailable = true;
  // Reserve words that already have a credential in this session before
  // binding legacy rows. Otherwise an older credential-less row can steal the
  // nonce from a newer answer that was just enqueued by the current page.
  const assignedWords = new Set(
    pending
      .filter(
        (item) =>
          item.status === "pending" &&
          item.studySessionId === studySessionId &&
          Boolean(item.nonce),
      )
      .map((item) => item.wordId),
  );
  for (const item of pending) {
    if (item.status !== "pending" || item.credentialState !== "legacy-claimed") continue;
    const nonce = nonces[item.wordId];
    if (!nonce) continue;
    // A session-invalid response clears only the nonce, leaving the rejected
    // session id as a tombstone. Do not immediately rebind it to the same
    // expired session; the next fresh GET will provide a different id.
    if (
      item.studySessionId === studySessionId &&
      !item.nonce &&
      item.lastError === SESSION_REAUTH_ERROR
    ) {
      continue;
    }
    // A session issues one nonce per word. Rebind only one legacy operation
    // per word; later repeated operations wait for a fresh session instead of
    // racing on, or reusing, the same one-time nonce.
    if (assignedWords.has(item.wordId)) continue;
    assignedWords.add(item.wordId);
    if (item.studySessionId === studySessionId && item.nonce === nonce) {
      continue;
    }
    const written = writeReviewItem(userId, {
      ...item,
      studySessionId,
      nonce,
      credentialState: "valid",
      nextAttemptAt: undefined,
      lastError: undefined,
    });
    if (written) adoptedWordIds.push(item.wordId);
    else storageAvailable = false;
  }
  return {
    pendingCount: pendingReviewCount(userId),
    adoptedWordIds,
    storageAvailable,
  };
}

/** Rebind one pending operation per word when an atomic session rotation returns. */
export function rebindStudySessionCredentials(
  userId: string,
  previousSessionId: string,
  studySessionId: string,
  nonces: Record<string, string>,
): number {
  const assignedWords = new Set<string>();
  for (const item of loadPendingReviews(userId)) {
    if (
      item.status !== "pending" ||
      item.studySessionId !== previousSessionId ||
      !nonces[item.wordId] ||
      assignedWords.has(item.wordId)
    ) {
      continue;
    }
    assignedWords.add(item.wordId);
    writeReviewItem(userId, {
      ...item,
      studySessionId,
      nonce: nonces[item.wordId],
      credentialState: "valid",
      lastError: undefined,
      nextAttemptAt: undefined,
    });
  }
  return pendingReviewCount(userId);
}

/** After the current server queue had one chance to adopt legacy rows, make
 * every remaining credential-less legacy operation visibly non-retryable. */
export function finalizeLegacyCredentialClaims(
  userId: string,
): LegacyFinalizationResult {
  let storageAvailable = true;
  for (const item of loadPendingReviews(userId)) {
    if (item.status !== "pending" || item.credentialState !== "legacy-claimed") {
      continue;
    }
    if (!writeReviewItem(userId, {
      ...item,
      status: "blocked",
      credentialState: "blocked",
      lastError: "旧版待同步记录缺少服务器来源凭证，无法安全恢复",
      nextAttemptAt: undefined,
    })) {
      storageAvailable = false;
    }
  }
  return {
    blockedCount: blockedReviewCount(userId),
    storageAvailable,
  };
}

/**
 * 尽量把队列里待提交的评测 flush 到服务端。
 *
 * 逐条提交（复用幂等的 POST /api/study）：
 * - 成功（HTTP 2xx）：从队列移除，并通过 onDone 回传最新 streak / 成就。
 * - 网络错误（fetch throw）：判定为断网，立即停止本轮，剩余条目原样保留。
 * - 429/408/5xx：标记失败、设置退避时间并立即停止本轮，避免继续轰炸服务端。
 * - 其他非 2xx：永久 4xx 转 blocked；session 失效会清除旧 nonce，等待新 session；
 *   其他可恢复错误保留并按指数退避重试。
 *
 * @returns flush 后仍留在队列里的条数。
 */
async function flushPendingReviewsUnlocked(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
): Promise<number> {
  const now = Date.now();
  const queue = loadPendingReviews(userId)
    .filter(
      (r) =>
        r.status === "pending" &&
        Boolean(r.studySessionId && r.nonce) &&
        (!r.nextAttemptAt || r.nextAttemptAt <= now),
    )
    .slice(0, MAX_FLUSH_BATCH);
  if (queue.length === 0) return pendingReviewCount(userId);

  const succeededOperations = new Set<string>();
  const failedOperations = new Map<
    string,
    {
      permanent: boolean;
      message?: string;
      nextAttemptAt?: number;
      clearSessionNonce?: boolean;
    }
  >();
  let networkDown = false;

  for (const item of queue) {
    if (networkDown) break;

    let ok = false;
    let result: StudyPostResult | null = null;
    try {
      const res = await fetchReviewRequest("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: item.operationId,
          wordId: item.wordId,
          quality: item.quality,
          studySessionId: item.studySessionId,
          nonce: item.nonce,
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
        const sessionRejected =
          res.status === 403 && message === SESSION_REAUTH_ERROR;
        const permanent =
          res.status >= 400 &&
          res.status < 500 &&
          ![401, 408, 422, 429].includes(res.status) &&
          !sessionRejected;
        const stopBatch =
          res.status === 401 ||
          res.status === 408 ||
          res.status === 422 ||
          res.status === 429 ||
          sessionRejected ||
          res.status >= 500;
        failedOperations.set(item.operationId, {
          permanent,
          message,
          clearSessionNonce: sessionRejected,
          nextAttemptAt: permanent
            ? undefined
            : Date.now() + backoffMs(item, retryAfterMs(res)),
        });
        // 未登入、尚未完成强制改密、限流或服务端错误时，后续条目也不应继续发送。
        if (stopBatch) networkDown = true;
      }
    } catch {
      // fetch 抛错 = 断网 / DNS 失败：本条失败且停止本轮，避免连续打失败请求。
      failedOperations.set(item.operationId, {
        permanent: false,
        nextAttemptAt: Date.now() + backoffMs(item),
      });
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
      credentialState: failure.permanent
        ? "blocked"
        : failure.clearSessionNonce
          ? "expired"
          : item.credentialState,
      lastError: failure.message ?? item.lastError,
      nextAttemptAt:
        failure.permanent || failure.clearSessionNonce
          ? undefined
          : failure.nextAttemptAt,
      nonce: failure.clearSessionNonce ? undefined : item.nonce,
    });
  }
  return pendingReviewCount(userId);
}

async function reauthorizeRejectedReviews(userId: string): Promise<boolean> {
  const now = Date.now();
  const candidates = loadPendingReviews(userId).filter(
    (item) =>
      item.status === "pending" &&
      item.credentialState === "expired" &&
      Boolean(item.studySessionId) &&
      !item.nonce &&
      (!item.nextAttemptAt || item.nextAttemptAt <= now),
  );
  const previousSessionId = candidates[0]?.studySessionId;
  if (!previousSessionId) return false;
  const assignedWords = new Set<string>();
  const operations = candidates
    .filter((item) => item.studySessionId === previousSessionId)
    .filter((item) => {
      if (assignedWords.has(item.wordId)) return false;
      assignedWords.add(item.wordId);
      return true;
    })
    // Renew one operation at a time. If the server committed a prior renewal
    // but browser storage failed, the next call can replay that exact one
    // without mixing it with untouched items and turning the whole batch 409.
    .slice(0, 1);
  if (operations.length === 0) return false;

  const markBlocked = (message: string) => {
    for (const operation of operations) {
      const current = loadPendingReviews(userId).find(
        (item) => item.operationId === operation.operationId,
      );
      if (!current) continue;
      writeReviewItem(userId, {
        ...current,
        status: "blocked",
        credentialState: "blocked",
        lastError: message,
        nextAttemptAt: undefined,
      });
    }
  };

  const markRetry = (message?: string, retryAfter?: number) => {
    for (const operation of operations) {
      const current = loadPendingReviews(userId).find(
        (item) => item.operationId === operation.operationId,
      );
      if (!current) continue;
      writeReviewItem(userId, {
        ...current,
        attempts: current.attempts + 1,
        lastError: message ?? current.lastError,
        nextAttemptAt: Date.now() + backoffMs(current, retryAfter),
      });
    }
  };

  try {
    const response = await fetchReviewRequest("/api/study/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        previousSessionId,
        operations: operations.map(({ operationId, wordId }) => ({
          operationId,
          wordId,
        })),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      const message =
        typeof payload?.error === "string"
          ? payload.error.slice(0, 200)
          : `HTTP ${response.status}`;
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![401, 408, 422, 429].includes(response.status)
      ) {
        markBlocked(message);
      } else {
        markRetry(message, retryAfterMs(response));
      }
      return false;
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          studySession?: {
            id?: unknown;
          } | null;
          credentials?: unknown;
        }
      | null;
    const session = payload?.studySession;
    if (
      !session ||
      typeof session.id !== "string" ||
      !Array.isArray(payload?.credentials)
    ) {
      markRetry("续期响应无效，请稍后重试");
      return false;
    }
    const renewedCredentials = new Map<
      string,
      { wordId: string; nonce: string }
    >();
    for (const value of payload.credentials) {
      if (typeof value !== "object" || value === null) continue;
      const row = value as Record<string, unknown>;
      if (
        typeof row.operationId !== "string" ||
        typeof row.wordId !== "string" ||
        typeof row.nonce !== "string"
      ) {
        continue;
      }
      renewedCredentials.set(row.operationId, {
        wordId: row.wordId,
        nonce: row.nonce,
      });
    }
    if (
      !operations.every(
        (operation) =>
          renewedCredentials.get(operation.operationId)?.wordId ===
          operation.wordId,
      )
    ) {
      markRetry("续期响应无效，请稍后重试");
      return false;
    }
    for (const operation of operations) {
      const renewed = renewedCredentials.get(operation.operationId)!;
      const current = loadPendingReviews(userId).find(
        (item) => item.operationId === operation.operationId,
      );
      if (!current || current.status !== "pending") continue;
      if (!writeReviewItem(userId, {
        ...current,
        studySessionId: session.id,
        nonce: renewed.nonce,
        credentialState: "valid",
        lastError: undefined,
        nextAttemptAt: undefined,
      })) {
        throw new ReviewQueueStorageError();
      }
    }
    return true;
  } catch (error) {
    if (error instanceof ReviewQueueStorageError) throw error;
    markRetry("网络错误，请稍后重试");
    return false;
  }
}

const localFlushes = new Map<string, Promise<number>>();

export async function flushPendingReviews(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
): Promise<number> {
  const run = async () => {
    await flushPendingReviewsUnlocked(userId, onDone);
    if (!(await reauthorizeRejectedReviews(userId))) {
      return pendingReviewCount(userId);
    }
    // Exactly one automatic retry after obtaining a fresh server credential.
    // A second rejection stays pending until the next explicit flush cycle.
    return flushPendingReviewsUnlocked(userId, onDone);
  };
  // 多个页面生命周期事件／浏览器分页面可同时触发 flush。Web Locks 可用时
  // 将同一用户的 flush 串行化；服务端 operationId 幂等仍是最后防线。
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`study-review-queue:${userId}`, () =>
      run(),
    );
  }
  // Safari/older browsers without Web Locks still need a page-level mutex;
  // otherwise every quick answer starts another flush over the same operations.
  // Every explicit call is chained: an item enqueued while the active scan is
  // in-flight is therefore picked up by the trailing scan instead of waiting 30s.
  const active = localFlushes.get(userId);
  const queued = active ? active.catch(() => 0).then(run) : run();
  const tracked = queued.finally(() => {
    if (localFlushes.get(userId) === tracked) localFlushes.delete(userId);
  });
  localFlushes.set(userId, tracked);
  return tracked;
}
