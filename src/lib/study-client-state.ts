import {
  clearStudyStreamCheckpoints,
  clearStudyStreamOutbox,
} from "@/lib/study-stream/outbox";

const RETIRED_ACCOUNT_PREFIXES = [
  "study:checkpoint:",
  "study:review-queue:",
  "study:review-item:",
  "study:review-mutation:",
  "study:review-server-revision:",
  "study:review-active-lease:",
];

const RETIRED_GLOBAL_KEYS = new Set(["study:review-queue"]);

function removeRetiredAccountState(userId: string): void {
  if (typeof window === "undefined") return;
  const account = encodeURIComponent(userId);
  const prefixes = RETIRED_ACCOUNT_PREFIXES.map((prefix) => `${prefix}${account}`);
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Retired data is never rehydrated; storage failure must not block auth cleanup.
  }
}

/**
 * 清除單一帳戶的 V2 browser-local state。退役 V1 namespace 只作一次性安全清理；
 * 永遠不會解析、遷移或提交到 server endpoint。
 */
export function clearStudyClientState(userId: string): void {
  removeRetiredAccountState(userId);
  void clearStudyStreamOutbox(userId);
  clearStudyStreamCheckpoints(userId);
}

/**
 * 在 unauthenticated boundary 清除 browser-local learning state。server redirect 可能在 study
 * page 取得 revoked account id 前已經發生，因此這裡掃描已知 V2 及退役 namespace。退役 key
 * 只會丟棄，不會恢復 legacy queue。
 */
export function clearAllStudyClientState(): void {
  if (typeof window === "undefined") return;
  const prefixes = [
    ...RETIRED_ACCOUNT_PREFIXES,
    "english:study-stream-v2:outbox:",
    "english:study-stream-v2:checkpoint:",
  ];
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (RETIRED_GLOBAL_KEYS.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      if (key.startsWith("english:study-stream-v2:outbox:")) {
        void clearStudyStreamOutbox(key.slice("english:study-stream-v2:outbox:".length));
      } else window.localStorage.removeItem(key);
    }
  } catch {
    // Storage failure must not prevent the fail-closed redirect.
  }
}
