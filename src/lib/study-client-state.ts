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
 * Clear V2 browser-local state for one account. Retired V1 namespaces are
 * scrubbed as a one-way security cleanup; they are never parsed, migrated or
 * submitted to a server endpoint.
 */
export function clearStudyClientState(userId: string): void {
  removeRetiredAccountState(userId);
  void clearStudyStreamOutbox(userId);
  clearStudyStreamCheckpoints(userId);
}

/**
 * Clear browser-local learning state at the unauthenticated boundary. A
 * server redirect can bypass the study page before it still has the revoked
 * account id, so known V2 and retired namespaces are scanned here. Retired
 * keys are discarded only; no legacy queue is resumed.
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
