import {
  parseStudyStreamAction,
  type StudyStreamActionInput,
} from "@/lib/study-stream/contracts";

const STORAGE_PREFIX = "english:study-stream-v2:outbox:";
export const STUDY_STREAM_OUTBOX_MAX_ROWS = 20;

export type StudyStreamQueuedAction = {
  action: StudyStreamActionInput;
  status: "pending" | "blocked";
  attempts: number;
  lastError: string | null;
  updatedAt: number;
};

export class StudyStreamOutboxCorruptError extends Error {
  constructor() {
    super("STUDY_STREAM_OUTBOX_CORRUPT");
    this.name = "StudyStreamOutboxCorruptError";
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function studyStreamOutboxStorageKey(userId: string): string {
  return storageKey(userId);
}

function read(userId: string): StudyStreamQueuedAction[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > STUDY_STREAM_OUTBOX_MAX_ROWS) {
      throw new StudyStreamOutboxCorruptError();
    }
    const rows: StudyStreamQueuedAction[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) throw new StudyStreamOutboxCorruptError();
      const candidate = entry as Record<string, unknown>;
      const parsed = parseStudyStreamAction(candidate.action);
      if (
        !parsed.ok ||
        (candidate.status !== "pending" && candidate.status !== "blocked") ||
        typeof candidate.attempts !== "number" ||
        !Number.isSafeInteger(candidate.attempts) ||
        candidate.attempts < 0 ||
        (candidate.lastError !== null && typeof candidate.lastError !== "string") ||
        typeof candidate.updatedAt !== "number" ||
        !Number.isFinite(candidate.updatedAt)
      ) throw new StudyStreamOutboxCorruptError();
      rows.push({
        action: parsed.value,
        status: candidate.status,
        attempts: candidate.attempts,
        lastError: candidate.lastError,
        updatedAt: candidate.updatedAt,
      });
    }
    return rows;
  } catch {
    throw new StudyStreamOutboxCorruptError();
  }
}

function write(userId: string, rows: StudyStreamQueuedAction[]): void {
  if (typeof window === "undefined") throw new Error("STUDY_STREAM_STORAGE_UNAVAILABLE");
  if (rows.length > STUDY_STREAM_OUTBOX_MAX_ROWS) {
    throw new Error("STUDY_STREAM_OUTBOX_CAPACITY");
  }
  window.localStorage.setItem(storageKey(userId), JSON.stringify(rows));
}

export function loadStudyStreamOutbox(userId: string): StudyStreamQueuedAction[] {
  return read(userId);
}

export function enqueueStudyStreamAction(
  userId: string,
  action: StudyStreamActionInput,
): { ok: true } | { ok: false; error: string } {
  try {
    const rows = read(userId);
    if (!rows.some((row) => row.action.operationId === action.operationId)) {
      if (rows.length >= STUDY_STREAM_OUTBOX_MAX_ROWS) {
        return { ok: false, error: "待同步学习操作已达安全上限；请先恢复同步后再继续学习" };
      }
      rows.push({ action, status: "pending", attempts: 0, lastError: null, updatedAt: Date.now() });
      write(userId, rows);
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "浏览器无法保存待同步学习操作，请允许网站存储后重试" };
  }
}

export function removeStudyStreamAction(userId: string, operationId: string): void {
  write(userId, read(userId).filter((row) => row.action.operationId !== operationId));
}

export function updateStudyStreamAction(
  userId: string,
  operationId: string,
  patch: Pick<StudyStreamActionInput, "studySessionId" | "streamItemId" | "itemCredential" | "clientKnownRevision">,
): void {
  const rows = read(userId).map((row) => row.action.operationId === operationId
    ? { ...row, action: { ...row.action, ...patch }, updatedAt: Date.now() }
    : row);
  write(userId, rows);
}

export function markStudyStreamActionBlocked(
  userId: string,
  operationId: string,
  error: string,
): void {
  const rows = read(userId).map((row) => row.action.operationId === operationId
    ? { ...row, status: "blocked" as const, attempts: row.attempts + 1, lastError: error, updatedAt: Date.now() }
    : row);
  write(userId, rows);
}

export function resetStudyStreamAction(userId: string, operationId: string): void {
  const rows = read(userId).map((row) => row.action.operationId === operationId
    ? { ...row, status: "pending" as const, lastError: null, updatedAt: Date.now() }
    : row);
  write(userId, rows);
}

export function studyStreamOutboxCount(userId: string): number {
  return read(userId).length;
}

export interface StudyStreamCheckpoint {
  version: 1;
  sessionId: string;
  streamItemId: string | null;
  clientRevision: number;
  phase: "learning-card" | "objective-probe" | "feedback" | "sync-blocked";
  updatedAt: number;
}

function checkpointKey(userId: string, scopeKey: string): string {
  return `english:study-stream-v2:checkpoint:${userId}:${scopeKey}`;
}

export function studyStreamCheckpointStorageKey(userId: string, scopeKey: string): string {
  return checkpointKey(userId, scopeKey);
}

export function loadStudyStreamCheckpoint(userId: string, scopeKey: string): StudyStreamCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(checkpointKey(userId, scopeKey));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<StudyStreamCheckpoint>;
    if (
      candidate.version !== 1 || typeof candidate.sessionId !== "string" ||
      (candidate.streamItemId !== null && typeof candidate.streamItemId !== "string") ||
      typeof candidate.clientRevision !== "number" ||
      !Number.isSafeInteger(candidate.clientRevision) ||
      candidate.clientRevision < 0 ||
      (candidate.phase !== "learning-card" && candidate.phase !== "objective-probe" &&
        candidate.phase !== "feedback" && candidate.phase !== "sync-blocked") ||
      typeof candidate.updatedAt !== "number" || !Number.isFinite(candidate.updatedAt)
    ) return null;
    return candidate as StudyStreamCheckpoint;
  } catch {
    return null;
  }
}

export function saveStudyStreamCheckpoint(
  userId: string,
  scopeKey: string,
  checkpoint: Omit<StudyStreamCheckpoint, "version" | "updatedAt">,
): { ok: true } | { ok: false; error: string } {
  try {
    if (typeof window === "undefined") throw new Error("storage unavailable");
    const key = checkpointKey(userId, scopeKey);
    const serialized = JSON.stringify({
      ...checkpoint,
      version: 1,
      updatedAt: Date.now(),
    });
    const previous = window.localStorage.getItem(key);
    let previousCheckpoint: Partial<StudyStreamCheckpoint> | null = null;
    if (previous) {
      try {
        previousCheckpoint = JSON.parse(previous) as Partial<StudyStreamCheckpoint>;
      } catch {
        // Replace a corrupt checkpoint with the new authoritative pointer.
      }
    }
    if (
      previousCheckpoint &&
      previousCheckpoint.version === 1 &&
      previousCheckpoint.sessionId === checkpoint.sessionId &&
      previousCheckpoint.streamItemId === checkpoint.streamItemId &&
      previousCheckpoint.clientRevision === checkpoint.clientRevision &&
      previousCheckpoint.phase === checkpoint.phase
    ) return { ok: true };
    window.localStorage.setItem(key, serialized);
    return { ok: true };
  } catch {
    return { ok: false, error: "浏览器无法保存学习续接点，请允许网站存储后重试" };
  }
}

export function clearStudyStreamCheckpoint(userId: string, scopeKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(checkpointKey(userId, scopeKey));
}
