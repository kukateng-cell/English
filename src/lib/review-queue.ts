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
import { rosterFetch } from "@/lib/roster-client";

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
  credentialState:
    | "valid"
    | "expired"
    | "legacy-claimed"
    | "refresh-required"
    | "blocked";
  refreshCode?: "SESSION_SUPERSEDED" | "CREDENTIAL_ALREADY_RENEWED";
  /** Original server provenance used by operation-specific recovery. */
  sourceStudySessionId?: string;
}

export interface ReviewSubmissionCredentials {
  studySessionId: string;
  nonce: string;
}

/** 单条评测成功提交后，服务端返回的数据（仅保留页面需要的字段，松散类型）。 */
export interface StudyPostResult {
  streak?: unknown;
  newlyUnlocked?: unknown;
  reconciled?: boolean;
  outcome?:
    | "applied"
    | "already-processed"
    | "credential-refresh-required";
  conflictCode?: "SESSION_SUPERSEDED" | "CREDENTIAL_ALREADY_RENEWED";
  requiresQueueReload?: boolean;
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

export interface ReviewQueueMutationEvent {
  version: 1;
  ownerId: string;
  kind:
    | "mutation-started"
    | "mutation-released"
    | "server-mutated"
    | "session-rotated"
    | "credentials-renewed";
  wordIds: string[];
  sessionIds: string[];
  revision: string;
  leaseId?: string;
  expiresAt?: number;
}

export interface ReviewQueueServerRevision {
  version: 1;
  ownerId: string;
  wordIds: string[];
  sessionIds: string[];
  revision: string;
}

export interface ReviewQueueActiveLease {
  version: 1;
  ownerId: string;
  leaseId: string;
  wordIds: string[];
  sessionIds: string[];
  expiresAt: number;
  revision: string;
}

export interface ReviewQueueMutationPlan {
  /** Rows that can POST, renew then POST, or adopt the supplied session then POST now. */
  willMutateWordIds: string[];
  /** Retryable rows which cannot mutate the server in this flush cycle. */
  passivePendingWordIds: string[];
  /** Permanently failed rows which require a queue/session revalidation. */
  blockedWordIds: string[];
  /** Earliest retry deadline among passive backoff rows. */
  nextAttemptAt: number | null;
}

export class ReviewQueueStorageError extends Error {
  constructor() {
    super("REVIEW_QUEUE_STORAGE_UNAVAILABLE");
    this.name = "ReviewQueueStorageError";
  }
}

const QUEUE_PREFIX = "study:review-queue:";
const ITEM_PREFIX = "study:review-item:";
const MUTATION_PREFIX = "study:review-mutation:";
const SERVER_REVISION_PREFIX = "study:review-server-revision:";
const ACTIVE_LEASE_PREFIX = "study:review-active-lease:";
const LEGACY_QUEUE_KEY = "study:review-queue";
const VERSION = 5;
const MAX_FLUSH_BATCH = 20;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const REVIEW_REQUEST_TIMEOUT_MS = 15_000;
const SESSION_REAUTH_ERROR = "學習 session 無效或已過期";

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
      r.credentialState === "refresh-required" ||
      r.credentialState === "blocked")
    && (r.refreshCode === undefined ||
      r.refreshCode === "SESSION_SUPERSEDED" ||
      r.refreshCode === "CREDENTIAL_ALREADY_RENEWED")
    && (r.sourceStudySessionId === undefined ||
      typeof r.sourceStudySessionId === "string")
  );
}

/** 读取指定用户的待提交队列；旧版无 owner 的全局队列不会被任何账号接管。 */
function queueKey(userId: string): string {
  return `${QUEUE_PREFIX}${encodeURIComponent(userId)}`;
}

function itemPrefix(userId: string): string {
  return `${ITEM_PREFIX}${encodeURIComponent(userId)}:`;
}

export function reviewQueueItemStoragePrefix(userId: string): string {
  return itemPrefix(userId);
}

export function reviewQueueMutationStorageKey(userId: string): string {
  return `${MUTATION_PREFIX}${encodeURIComponent(userId)}`;
}

export function reviewQueueServerRevisionStorageKey(userId: string): string {
  return `${SERVER_REVISION_PREFIX}${encodeURIComponent(userId)}`;
}

/**
 * Remove all V1 queue state for one account after server-side invalidation.
 * The scan includes per-operation rows and active leases, not just the
 * aggregate queue key, so a suspended account cannot be replayed by another
 * tab after it is restored.
 */
export function clearReviewQueueForUser(userId: string): void {
  if (typeof window === "undefined") return;
  const exactKeys = new Set([
    queueKey(userId),
    reviewQueueMutationStorageKey(userId),
    reviewQueueServerRevisionStorageKey(userId),
  ]);
  const prefixes = [itemPrefix(userId), reviewQueueActiveLeaseStoragePrefix(userId)];
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))) {
        keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // The caller still redirects/fails closed when browser storage is blocked.
  }
}

export function reviewQueueActiveLeaseStoragePrefix(userId: string): string {
  return `${ACTIVE_LEASE_PREFIX}${encodeURIComponent(userId)}:`;
}

export function reviewQueueActiveLeaseStorageKey(
  userId: string,
  leaseId: string,
): string {
  return `${reviewQueueActiveLeaseStoragePrefix(userId)}${encodeURIComponent(leaseId)}`;
}

export function parseReviewQueueActiveLease(
  userId: string,
  raw: string | null,
): ReviewQueueActiveLease | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== 1 ||
      value.ownerId !== userId ||
      typeof value.leaseId !== "string" ||
      !Array.isArray(value.wordIds) ||
      !value.wordIds.every((wordId) => typeof wordId === "string") ||
      !Array.isArray(value.sessionIds) ||
      !value.sessionIds.every((sessionId) => typeof sessionId === "string") ||
      typeof value.expiresAt !== "number" ||
      typeof value.revision !== "string"
    ) return null;
    return value as unknown as ReviewQueueActiveLease;
  } catch {
    return null;
  }
}

export function loadActiveReviewLeases(userId: string): ReviewQueueActiveLease[] {
  if (typeof window === "undefined") return [];
  const prefix = reviewQueueActiveLeaseStoragePrefix(userId);
  const active: ReviewQueueActiveLease[] = [];
  const expiredKeys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const lease = parseReviewQueueActiveLease(
      userId,
      window.localStorage.getItem(key),
    );
    if (!lease || lease.expiresAt <= Date.now()) expiredKeys.push(key);
    else active.push(lease);
  }
  for (const key of expiredKeys) window.localStorage.removeItem(key);
  return active;
}

function publishReviewQueueActiveLease(
  userId: string,
  leaseId: string,
  wordIds: string[],
  sessionIds: string[],
): boolean {
  try {
    const lease: ReviewQueueActiveLease = {
      version: 1,
      ownerId: userId,
      leaseId,
      wordIds: [...new Set(wordIds)],
      sessionIds: [...new Set(sessionIds)],
      expiresAt: Date.now() + REVIEW_REQUEST_TIMEOUT_MS + 5_000,
      revision: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    window.localStorage.setItem(
      reviewQueueActiveLeaseStorageKey(userId, leaseId),
      JSON.stringify(lease),
    );
    return true;
  } catch {
    return false;
  }
}

function releaseReviewQueueActiveLease(userId: string, leaseId: string): boolean {
  try {
    window.localStorage.removeItem(
      reviewQueueActiveLeaseStorageKey(userId, leaseId),
    );
    return true;
  } catch {
    return false;
  }
}

export function parseReviewQueueServerRevision(
  userId: string,
  raw: string | null,
): ReviewQueueServerRevision | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== 1 ||
      value.ownerId !== userId ||
      !Array.isArray(value.wordIds) ||
      !value.wordIds.every((wordId) => typeof wordId === "string") ||
      !Array.isArray(value.sessionIds) ||
      !value.sessionIds.every((sessionId) => typeof sessionId === "string") ||
      typeof value.revision !== "string"
    ) {
      return null;
    }
    return value as unknown as ReviewQueueServerRevision;
  } catch {
    return null;
  }
}

function publishReviewQueueServerRevision(
  userId: string,
  wordIds: string[],
  sessionIds: string[],
): boolean {
  try {
    const revision: ReviewQueueServerRevision = {
      version: 1,
      ownerId: userId,
      wordIds: [...new Set(wordIds)],
      sessionIds: [...new Set(sessionIds)],
      revision: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    window.localStorage.setItem(
      reviewQueueServerRevisionStorageKey(userId),
      JSON.stringify(revision),
    );
    return true;
  } catch {
    return false;
  }
}

export function parseReviewQueueMutationEvent(
  userId: string,
  raw: string | null,
): ReviewQueueMutationEvent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== 1 ||
      value.ownerId !== userId ||
      (value.kind !== "mutation-started" &&
        value.kind !== "mutation-released" &&
        value.kind !== "server-mutated" &&
        value.kind !== "session-rotated" &&
        value.kind !== "credentials-renewed") ||
      !Array.isArray(value.wordIds) ||
      !value.wordIds.every((wordId) => typeof wordId === "string") ||
      !Array.isArray(value.sessionIds) ||
      !value.sessionIds.every((sessionId) => typeof sessionId === "string") ||
      typeof value.revision !== "string" ||
      (value.leaseId !== undefined && typeof value.leaseId !== "string") ||
      (value.expiresAt !== undefined && typeof value.expiresAt !== "number")
    ) {
      return null;
    }
    return value as unknown as ReviewQueueMutationEvent;
  } catch {
    return null;
  }
}

function publishReviewQueueMutation(
  userId: string,
  kind: ReviewQueueMutationEvent["kind"],
  wordIds: string[],
  sessionIds: string[],
  leaseId?: string,
): boolean {
  try {
    const event: ReviewQueueMutationEvent = {
      version: 1,
      ownerId: userId,
      kind,
      wordIds: [...new Set(wordIds)],
      sessionIds: [...new Set(sessionIds)],
      revision: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(leaseId ? { leaseId } : {}),
      ...(leaseId && kind !== "mutation-released"
        ? { expiresAt: Date.now() + REVIEW_REQUEST_TIMEOUT_MS + 5_000 }
        : {}),
    };
    window.localStorage.setItem(
      reviewQueueMutationStorageKey(userId),
      JSON.stringify(event),
    );
    return true;
  } catch {
    return false;
  }
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
            row.credentialState === "legacy-claimed" ||
            row.credentialState === "refresh-required"
          ? row.credentialState
          : row.studySessionId && row.nonce
            ? "valid"
            : row.studySessionId
              ? "expired"
              : "legacy-claimed",
    refreshCode:
      row.refreshCode === "SESSION_SUPERSEDED" ||
      row.refreshCode === "CREDENTIAL_ALREADY_RENEWED"
        ? row.refreshCode
        : undefined,
    sourceStudySessionId:
      typeof row.sourceStudySessionId === "string"
        ? row.sourceStudySessionId
        : undefined,
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
    const request = { ...init, signal: controller.signal };
    // This queue only runs in a browser. Keep the direct-fetch branch for the
    // pure Node unit harness, which has no document or cookie-authenticated
    // session; browser traffic must use the shared double-submit CSRF client.
    return await (typeof document === "undefined"
      ? fetch(input, request)
      : rosterFetch(input, request));
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

/**
 * Classify every durable row before a caller starts network work. This is the
 * single preflight used by the study page's reconciliation barrier: a missing
 * nonce does not imply passivity because expired rows can renew and legacy
 * rows can adopt a nonce from the active session in the same flush cycle.
 */
export function planReviewQueueMutation(
  userId: string,
  activeSession?: {
    studySessionId: string;
    nonces: Record<string, string>;
  } | null,
): ReviewQueueMutationPlan {
  const now = Date.now();
  const willMutateWordIds = new Set<string>();
  const passivePendingWordIds = new Set<string>();
  const blockedWordIds = new Set<string>();
  let nextAttemptAt: number | null = null;
  const rows = loadPendingReviews(userId);
  const assignedActiveSessionWords = new Set(
    rows
      .filter(
        (item) =>
          item.status === "pending" &&
          item.studySessionId === activeSession?.studySessionId &&
          Boolean(item.nonce),
      )
      .map((item) => item.wordId),
  );

  for (const item of rows) {
    if (item.status === "blocked") {
      blockedWordIds.add(item.wordId);
      continue;
    }
    if (item.nextAttemptAt && item.nextAttemptAt > now) {
      passivePendingWordIds.add(item.wordId);
      nextAttemptAt =
        nextAttemptAt === null
          ? item.nextAttemptAt
          : Math.min(nextAttemptAt, item.nextAttemptAt);
      continue;
    }
    const canPost = Boolean(item.studySessionId && item.nonce);
    const canRenew =
      item.credentialState === "expired" &&
      Boolean(item.studySessionId) &&
      !item.nonce;
    const canRecover =
      item.credentialState === "refresh-required" &&
      Boolean(item.sourceStudySessionId ?? item.studySessionId) &&
      !item.nonce;
    const canAdopt = Boolean(
      item.credentialState === "legacy-claimed" &&
        activeSession?.nonces[item.wordId] &&
        !assignedActiveSessionWords.has(item.wordId),
    );
    if (canPost || canRenew || canRecover || canAdopt) {
      willMutateWordIds.add(item.wordId);
      if (canAdopt) assignedActiveSessionWords.add(item.wordId);
    } else {
      passivePendingWordIds.add(item.wordId);
    }
  }

  return {
    willMutateWordIds: [...willMutateWordIds],
    passivePendingWordIds: [...passivePendingWordIds],
    blockedWordIds: [...blockedWordIds],
    nextAttemptAt,
  };
}

/** 用户确认后移除无法自动重试的永久失败项目。 */
export function discardBlockedReviews(userId: string): void {
  for (const item of loadPendingReviews(userId)) {
    if (item.status === "blocked") {
      if (!removeReviewItem(userId, item.operationId)) {
        throw new ReviewQueueStorageError();
      }
    }
  }
}

export function discardPendingReview(
  userId: string,
  operationId: string,
): void {
  if (!removeReviewItem(userId, operationId)) {
    throw new ReviewQueueStorageError();
  }
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
    try {
      window.localStorage.removeItem(LEGACY_QUEUE_KEY);
    } catch {
      throw new ReviewQueueStorageError();
    }
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
    try {
      window.localStorage.removeItem(LEGACY_QUEUE_KEY);
    } catch {
      throw new ReviewQueueStorageError();
    }
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
      refreshCode: undefined,
      sourceStudySessionId: undefined,
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
  const rows = loadPendingReviews(userId);
  for (const item of rows) {
    if (
      item.status === "pending" &&
      item.studySessionId === previousSessionId &&
      nonces[item.wordId] &&
      !assignedWords.has(item.wordId)
    ) {
      assignedWords.add(item.wordId);
    }
  }
  // Publish retirement before overwriting any local credential. If a later
  // row write fails, every other tab has still invalidated the old session.
  if (!publishReviewQueueMutation(
    userId,
    "session-rotated",
    assignedWords.size > 0 ? [...assignedWords] : Object.keys(nonces),
    [previousSessionId, studySessionId],
  )) {
    throw new ReviewQueueStorageError();
  }
  assignedWords.clear();
  let storageAvailable = true;
  for (const item of rows) {
    if (
      item.status !== "pending" ||
      item.studySessionId !== previousSessionId ||
      !nonces[item.wordId] ||
      assignedWords.has(item.wordId)
    ) {
      continue;
    }
    assignedWords.add(item.wordId);
    if (!writeReviewItem(userId, {
      ...item,
      studySessionId,
      nonce: nonces[item.wordId],
      credentialState: "valid",
      refreshCode: undefined,
      sourceStudySessionId: undefined,
      lastError: undefined,
    })) {
      storageAvailable = false;
    }
  }
  if (!storageAvailable) {
    throw new ReviewQueueStorageError();
  }
  return pendingReviewCount(userId);
}

/** After the current server queue had one chance to adopt imported legacy
 * rows, make only those genuine imports visibly non-retryable. Current-client
 * answers awaiting operation-specific recovery must never enter this path. */
export function finalizeLegacyCredentialClaims(
  userId: string,
): LegacyFinalizationResult {
  let storageAvailable = true;
  for (const item of loadPendingReviews(userId)) {
    if (
      item.status !== "pending" ||
      item.credentialState !== "legacy-claimed" ||
      !item.operationId.startsWith("legacy-claim:")
    ) {
      continue;
    }
    if (!writeReviewItem(userId, {
      ...item,
      status: "blocked",
      credentialState: "blocked",
      lastError: "舊版待同步記錄缺少伺服器來源憑證，無法安全恢復",
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
  onBeforeRequest?: () => void,
  leaseId?: string,
  onlyOperationId?: string,
): Promise<{ remaining: number; mutatedWordIds: string[] }> {
  const now = Date.now();
  const queue = loadPendingReviews(userId)
    .filter(
      (r) =>
        r.status === "pending" &&
        (!onlyOperationId || r.operationId === onlyOperationId) &&
        Boolean(r.studySessionId && r.nonce) &&
        (!r.nextAttemptAt || r.nextAttemptAt <= now),
    )
    .slice(0, MAX_FLUSH_BATCH);
  if (queue.length === 0) {
    return { remaining: pendingReviewCount(userId), mutatedWordIds: [] };
  }

  const succeededOperations = new Set<string>();
  const failedOperations = new Map<
    string,
    {
      permanent: boolean;
      message?: string;
      nextAttemptAt?: number;
      clearSessionNonce?: boolean;
      refreshFromFreshSession?:
        | "SESSION_SUPERSEDED"
        | "CREDENTIAL_ALREADY_RENEWED";
    }
  >();
  let networkDown = false;

  for (const item of queue) {
    if (networkDown) break;

    let ok = false;
    let result: StudyPostResult | null = null;
    try {
      onBeforeRequest?.();
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
        const payload = (await res.json().catch(() => null)) as
          | StudyPostResult
          | null;
        result = { ...(payload ?? {}), outcome: "applied" };
      } else {
        const payload = (await res.json().catch(() => null)) as
          | { error?: unknown; code?: unknown; requiresQueueReload?: unknown }
          | null;
        const message =
          typeof payload?.error === "string"
            ? payload.error.slice(0, 200)
            : `HTTP ${res.status}`;
        const sessionRejected =
          res.status === 403 && message === SESSION_REAUTH_ERROR;
        const alreadyProcessed =
          res.status === 409 &&
          payload?.code === "REVIEW_ALREADY_PROCESSED" &&
          payload.requiresQueueReload === true;
        const credentialRefreshCode =
          res.status === 409 &&
          (payload?.code === "SESSION_SUPERSEDED" ||
            payload?.code === "CREDENTIAL_ALREADY_RENEWED") &&
          payload.requiresQueueReload === true
            ? payload.code
            : null;
        if (alreadyProcessed) {
          ok = true;
          result = {
            reconciled: true,
            outcome: "already-processed",
            requiresQueueReload: true,
          };
        } else if (credentialRefreshCode) {
          failedOperations.set(item.operationId, {
            permanent: false,
            message,
            clearSessionNonce: true,
            refreshFromFreshSession: credentialRefreshCode,
          });
          // A superseded credential says nothing about whether this answer was
          // applied. Preserve the operation and stop using the stale session;
          // a fresh queue/session must rebind it before another POST.
          networkDown = true;
        } else {
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
  let storageAvailable = true;
  const queueByOperation = new Map(
    queue.map((item) => [item.operationId, item]),
  );
  const succeededItems = [...succeededOperations]
    .map((operationId) => queueByOperation.get(operationId))
    .filter((item): item is PendingReview => Boolean(item));
  if (succeededItems.length > 0) {
    const wordIds = succeededItems.map((item) => item.wordId);
    const sessionIds = succeededItems.flatMap((item) =>
      item.studySessionId ? [item.studySessionId] : [],
    );
    if (!publishReviewQueueServerRevision(userId, wordIds, sessionIds)) {
      storageAvailable = false;
    }
    if (
      storageAvailable &&
      !publishReviewQueueMutation(
        userId,
        "server-mutated",
        wordIds,
        sessionIds,
        leaseId,
      )
    ) {
      storageAvailable = false;
    }
  }
  // The cross-tab commit marker must become durable before rows disappear.
  // If marker storage fails, retain the outbox operations: operationId makes
  // their replay safe, while deleting them would let another tab reuse a
  // consumed queue/session nonce without ever seeing server-mutated.
  if (storageAvailable) {
    for (const operationId of succeededOperations) {
      if (!removeReviewItem(userId, operationId)) storageAvailable = false;
    }
  }
  const latest = new Map(
    loadPendingReviews(userId).map((item) => [item.operationId, item]),
  );
  for (const [operationId, failure] of failedOperations) {
    const item = latest.get(operationId);
    if (!item) continue;
    if (!writeReviewItem(userId, {
      ...item,
      attempts: item.attempts + 1,
      status: failure.permanent ? "blocked" : item.status,
      credentialState: failure.permanent
        ? "blocked"
        : failure.refreshFromFreshSession
          ? "refresh-required"
        : failure.clearSessionNonce
          ? "expired"
          : item.credentialState,
      lastError: failure.message ?? item.lastError,
      nextAttemptAt:
        failure.permanent || failure.clearSessionNonce
          ? undefined
          : failure.nextAttemptAt,
      nonce: failure.clearSessionNonce ? undefined : item.nonce,
      refreshCode: failure.refreshFromFreshSession ?? item.refreshCode,
      sourceStudySessionId: failure.refreshFromFreshSession
        ? item.studySessionId
        : item.sourceStudySessionId,
    })) {
      storageAvailable = false;
    }
  }
  if (!storageAvailable) throw new ReviewQueueStorageError();
  for (const [operationId, failure] of failedOperations) {
    if (!failure.refreshFromFreshSession) continue;
    const item = queueByOperation.get(operationId);
    if (!item) continue;
    onDone?.(item.wordId, {
      outcome: "credential-refresh-required",
      conflictCode: failure.refreshFromFreshSession,
      requiresQueueReload: true,
    });
  }
  return {
    remaining: pendingReviewCount(userId),
    mutatedWordIds: succeededItems.map((item) => item.wordId),
  };
}

async function reauthorizeRejectedReviews(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
  onBeforeRequest?: () => void,
  leaseId?: string,
): Promise<"none" | "renewed" | "reconciled" | "refresh-required"> {
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
  if (!previousSessionId) return "none";
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
  if (operations.length === 0) return "none";

  const markBlocked = (message: string) => {
    for (const operation of operations) {
      const current = loadPendingReviews(userId).find(
        (item) => item.operationId === operation.operationId,
      );
      if (!current) continue;
      if (!writeReviewItem(userId, {
        ...current,
        status: "blocked",
        credentialState: "blocked",
        lastError: message,
        nextAttemptAt: undefined,
      })) {
        throw new ReviewQueueStorageError();
      }
    }
  };

  const markRetry = (message?: string, retryAfter?: number) => {
    for (const operation of operations) {
      const current = loadPendingReviews(userId).find(
        (item) => item.operationId === operation.operationId,
      );
      if (!current) continue;
      if (!writeReviewItem(userId, {
        ...current,
        attempts: current.attempts + 1,
        lastError: message ?? current.lastError,
        nextAttemptAt: Date.now() + backoffMs(current, retryAfter),
      })) {
        throw new ReviewQueueStorageError();
      }
    }
  };

  try {
    onBeforeRequest?.();
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
        | { error?: unknown; code?: unknown; requiresQueueReload?: unknown }
        | null;
      const message =
        typeof payload?.error === "string"
          ? payload.error.slice(0, 200)
          : `HTTP ${response.status}`;
      const alreadyProcessed =
        response.status === 409 &&
        payload?.code === "REVIEW_ALREADY_PROCESSED" &&
        payload.requiresQueueReload === true;
      if (alreadyProcessed) {
        const wordIds = operations.map((operation) => operation.wordId);
        if (
          !publishReviewQueueServerRevision(userId, wordIds, [previousSessionId]) ||
          !publishReviewQueueMutation(
            userId,
            "server-mutated",
            wordIds,
            [previousSessionId],
            leaseId,
          )
        ) {
          throw new ReviewQueueStorageError();
        }
        for (const operation of operations) {
          if (!removeReviewItem(userId, operation.operationId)) {
            throw new ReviewQueueStorageError();
          }
          onDone?.(operation.wordId, {
            reconciled: true,
            outcome: "already-processed",
            requiresQueueReload: true,
          });
        }
        return "reconciled";
      }
      const credentialRefreshCode =
        response.status === 409 &&
        (payload?.code === "SESSION_SUPERSEDED" ||
          payload?.code === "CREDENTIAL_ALREADY_RENEWED") &&
        payload.requiresQueueReload === true
          ? payload.code
          : null;
      if (credentialRefreshCode) {
        for (const operation of operations) {
          const current = loadPendingReviews(userId).find(
            (item) => item.operationId === operation.operationId,
          );
          if (!current) continue;
          if (!writeReviewItem(userId, {
            ...current,
            credentialState: "refresh-required",
            nonce: undefined,
            refreshCode: credentialRefreshCode,
            sourceStudySessionId:
              current.sourceStudySessionId ?? current.studySessionId,
            lastError: message,
            nextAttemptAt: undefined,
          })) {
            throw new ReviewQueueStorageError();
          }
          onDone?.(operation.wordId, {
            outcome: "credential-refresh-required",
            conflictCode: credentialRefreshCode,
            requiresQueueReload: true,
          });
        }
        return "refresh-required";
      }
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![401, 408, 422, 429].includes(response.status)
      ) {
        markBlocked(message);
      } else {
        markRetry(message, retryAfterMs(response));
      }
      return "none";
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
      markRetry("續期回應無效，請稍後重試");
      return "none";
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
      markRetry("續期回應無效，請稍後重試");
      return "none";
    }
    if (
      !publishReviewQueueMutation(
        userId,
        "credentials-renewed",
        operations.map((operation) => operation.wordId),
        [previousSessionId, session.id],
      )
    ) {
      throw new ReviewQueueStorageError();
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
        refreshCode: undefined,
        sourceStudySessionId: undefined,
        lastError: undefined,
        nextAttemptAt: undefined,
      })) {
        throw new ReviewQueueStorageError();
      }
    }
    return "renewed";
  } catch (error) {
    if (error instanceof ReviewQueueStorageError) throw error;
    markRetry("網絡錯誤，請稍後重試");
    return "none";
  }
}

async function recoverRefreshRequiredReview(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
  onBeforeRequest?: () => void,
  leaseId?: string,
): Promise<"none" | "recovered" | "reconciled"> {
  const now = Date.now();
  const operation = loadPendingReviews(userId).find(
    (item) =>
      item.status === "pending" &&
      item.credentialState === "refresh-required" &&
      Boolean(item.sourceStudySessionId ?? item.studySessionId) &&
      !item.nonce &&
      (!item.nextAttemptAt || item.nextAttemptAt <= now),
  );
  if (!operation) return "none";
  const previousSessionId =
    operation.sourceStudySessionId ?? operation.studySessionId!;
  const markRetry = (message: string, retryAfter?: number) => {
    const current = loadPendingReviews(userId).find(
      (item) => item.operationId === operation.operationId,
    );
    if (!current) return;
    if (!writeReviewItem(userId, {
      ...current,
      attempts: current.attempts + 1,
      lastError: message,
      nextAttemptAt: Date.now() + backoffMs(current, retryAfter),
    })) {
      throw new ReviewQueueStorageError();
    }
  };

  try {
    onBeforeRequest?.();
    const response = await fetchReviewRequest("/api/study/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "recover",
        previousSessionId,
        operations: [{
          operationId: operation.operationId,
          wordId: operation.wordId,
          quality: operation.quality,
        }],
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; code?: unknown; requiresQueueReload?: unknown }
        | null;
      const message = typeof payload?.error === "string"
        ? payload.error.slice(0, 200)
        : `HTTP ${response.status}`;
      if (
        response.status === 409 &&
        payload?.code === "REVIEW_ALREADY_PROCESSED"
      ) {
        if (
          !publishReviewQueueServerRevision(
            userId,
            [operation.wordId],
            [previousSessionId],
          ) ||
          !publishReviewQueueMutation(
            userId,
            "server-mutated",
            [operation.wordId],
            [previousSessionId],
            leaseId,
          ) ||
          !removeReviewItem(userId, operation.operationId)
        ) {
          throw new ReviewQueueStorageError();
        }
        onDone?.(operation.wordId, {
          reconciled: true,
          outcome: "already-processed",
          requiresQueueReload: true,
        });
        return "reconciled";
      }
      const permanentCodes = new Set([
        "SOURCE_SESSION_GONE",
        "WORD_NOT_IN_SOURCE_SESSION",
        "CREDENTIAL_RECOVERY_UNAVAILABLE",
        "OPERATION_FINGERPRINT_MISMATCH",
      ]);
      if (
        response.status === 403 ||
        response.status === 404 ||
        (typeof payload?.code === "string" && permanentCodes.has(payload.code))
      ) {
        const current = loadPendingReviews(userId).find(
          (item) => item.operationId === operation.operationId,
        );
        if (current && !writeReviewItem(userId, {
          ...current,
          status: "blocked",
          credentialState: "blocked",
          attempts: current.attempts + 1,
          lastError: message,
          nextAttemptAt: undefined,
        })) {
          throw new ReviewQueueStorageError();
        }
        return "none";
      }
      // RECOVERY_BUSY, rate limits, and server failures retain the exact
      // operation for a later ownership-safe retry.
      markRetry(message, retryAfterMs(response));
      return "none";
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          studySession?: { id?: unknown } | null;
          credentials?: unknown;
        }
      | null;
    const sessionId = payload?.studySession?.id;
    const credential = Array.isArray(payload?.credentials)
      ? payload.credentials.find((value) => {
          if (typeof value !== "object" || value === null) return false;
          const row = value as Record<string, unknown>;
          return row.operationId === operation.operationId &&
            row.wordId === operation.wordId &&
            typeof row.nonce === "string";
        }) as Record<string, unknown> | undefined
      : undefined;
    if (typeof sessionId !== "string" || typeof credential?.nonce !== "string") {
      markRetry("恢復憑證回應無效，請稍後重試");
      return "none";
    }
    if (!publishReviewQueueMutation(
      userId,
      "credentials-renewed",
      [operation.wordId],
      [previousSessionId, sessionId],
    )) {
      throw new ReviewQueueStorageError();
    }
    const current = loadPendingReviews(userId).find(
      (item) => item.operationId === operation.operationId,
    );
    if (current && !writeReviewItem(userId, {
      ...current,
      studySessionId: sessionId,
      nonce: credential.nonce,
      credentialState: "valid",
      refreshCode: undefined,
      sourceStudySessionId: undefined,
      lastError: undefined,
      nextAttemptAt: undefined,
    })) {
      throw new ReviewQueueStorageError();
    }
    return "recovered";
  } catch (error) {
    if (error instanceof ReviewQueueStorageError) throw error;
    markRetry("網絡錯誤，請稍後重試");
    return "none";
  }
}

const localFlushes = new Map<string, Promise<number>>();

async function withReviewQueueLock(
  userId: string,
  run: () => Promise<number>,
): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(`study-review-queue:${userId}`, () =>
      run(),
    );
  }
  // Safari/older browsers without Web Locks still need a page-level mutex;
  // every explicit caller is chained so newly enqueued work gets a later scan.
  const active = localFlushes.get(userId);
  const queued = active ? active.catch(() => 0).then(run) : run();
  const tracked = queued.finally(() => {
    if (localFlushes.get(userId) === tracked) localFlushes.delete(userId);
  });
  localFlushes.set(userId, tracked);
  return tracked;
}

/**
 * Flush only the newly-created answer operation. Historical backlog stays
 * under the page reconciliation controller instead of being swept by a leaf
 * QuizCard helper with no knowledge of the current queue generation.
 */
export function flushPendingReviewOperation(
  userId: string,
  operationId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
  onWillMutate?: (plan: ReviewQueueMutationPlan) => void,
): Promise<number> {
  return withReviewQueueLock(userId, async () => {
    const plan = planReviewQueueMutation(userId);
    onWillMutate?.(plan);
    const target = loadPendingReviews(userId).find(
      (item) => item.operationId === operationId,
    );
    const canPostTarget = Boolean(
      target &&
      target.status === "pending" &&
      target.studySessionId &&
      target.nonce &&
      (!target.nextAttemptAt || target.nextAttemptAt <= Date.now()),
    );
    if (!target || !canPostTarget) return pendingReviewCount(userId);
    const leaseId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const heartbeat = () => {
      if (!publishReviewQueueActiveLease(
        userId,
        leaseId,
        [target.wordId],
        target.studySessionId ? [target.studySessionId] : [],
      )) {
        throw new ReviewQueueStorageError();
      }
    };
    heartbeat();
    try {
      const outcome = await flushPendingReviewsUnlocked(
        userId,
        onDone,
        heartbeat,
        leaseId,
        operationId,
      );
      return outcome.remaining;
    } finally {
      if (!releaseReviewQueueActiveLease(userId, leaseId)) {
        throw new ReviewQueueStorageError();
      }
    }
  });
}

export async function flushPendingReviews(
  userId: string,
  onDone?: (wordId: string, data: StudyPostResult) => void,
  onWillMutate?: (plan: ReviewQueueMutationPlan) => void,
): Promise<number> {
  const run = async () => {
    const leaseId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let leaseActive = false;
    const announcedWordIds = new Set<string>();
    const announcedSessionIds = new Set<string>();
    const heartbeat = () => {
      if (!leaseActive) return;
      if (!publishReviewQueueActiveLease(
        userId,
        leaseId,
        [...announcedWordIds],
        [...announcedSessionIds],
      )) {
        throw new ReviewQueueStorageError();
      }
    };
    const announcePlan = (plan: ReviewQueueMutationPlan) => {
      if (plan.willMutateWordIds.length === 0) return;
      const sessions = loadPendingReviews(userId)
        .filter((item) => plan.willMutateWordIds.includes(item.wordId))
        .flatMap((item) => item.studySessionId ? [item.studySessionId] : []);
      plan.willMutateWordIds.forEach((wordId) => announcedWordIds.add(wordId));
      sessions.forEach((sessionId) => announcedSessionIds.add(sessionId));
      leaseActive = true;
      heartbeat();
      onWillMutate?.(plan);
    };
    try {
      announcePlan(planReviewQueueMutation(userId));
      await flushPendingReviewsUnlocked(
        userId,
        onDone,
        heartbeat,
        leaseId,
      );
      const renewal = await reauthorizeRejectedReviews(
        userId,
        onDone,
        heartbeat,
        leaseId,
      );
      if (renewal === "reconciled") {
        return pendingReviewCount(userId);
      }
      if (renewal === "refresh-required") {
        return pendingReviewCount(userId);
      }
      if (renewal === "renewed") {
        // Renewal can turn a credential-less row into an immediately executable
        // POST. Re-plan while still holding the same queue lock, before request 2.
        announcePlan(planReviewQueueMutation(userId));
        const second = await flushPendingReviewsUnlocked(
          userId,
          onDone,
          heartbeat,
          leaseId,
        );
        return second.remaining;
      }
      const recovery = await recoverRefreshRequiredReview(
        userId,
        onDone,
        heartbeat,
        leaseId,
      );
      if (recovery === "reconciled") return pendingReviewCount(userId);
      if (recovery !== "recovered") return pendingReviewCount(userId);
      announcePlan(planReviewQueueMutation(userId));
      const recovered = await flushPendingReviewsUnlocked(
        userId,
        onDone,
        heartbeat,
        leaseId,
      );
      return recovered.remaining;
    } finally {
      if (
        leaseActive &&
        !releaseReviewQueueActiveLease(userId, leaseId)
      ) {
        throw new ReviewQueueStorageError();
      }
    }
  };
  // 多个页面生命周期事件／浏览器分页面可同时触发 flush。Web Locks 可用时
  // 将同一用户的 flush 串行化；服务端 operationId 幂等仍是最后防线。
  return withReviewQueueLock(userId, run);
}
