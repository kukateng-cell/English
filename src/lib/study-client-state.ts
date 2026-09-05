import { clearCheckpointsForUser } from "@/lib/checkpoint";
import { clearReviewQueueForUser } from "@/lib/review-queue";
import {
  clearStudyStreamCheckpoints,
  clearStudyStreamOutbox,
} from "@/lib/study-stream/outbox";

/**
 * Clear both learning implementations' browser-local state for one account.
 * This is deliberately account-scoped and contains no server mutation: the
 * server remains authoritative for suspension/revocation, while the browser
 * cannot retain work that could be replayed after a later restore.
 */
export function clearStudyClientState(userId: string): void {
  clearCheckpointsForUser(userId);
  clearReviewQueueForUser(userId);
  void clearStudyStreamOutbox(userId);
  clearStudyStreamCheckpoints(userId);
}

/**
 * Clear browser-local learning state at the unauthenticated boundary. A
 * server redirect can bypass the study page before it still has the revoked
 * account id, so only the known V1/V2 namespaces are scanned here.
 */
export function clearAllStudyClientState(): void {
  if (typeof window === "undefined") return;
  const prefixes = [
    "study:checkpoint:",
    "study:review-queue:",
    "study:review-item:",
    "study:review-mutation:",
    "study:review-server-revision:",
    "study:review-active-lease:",
    "english:study-stream-v2:outbox:",
    "english:study-stream-v2:checkpoint:",
  ];
  const exactKeys = new Set(["study:review-queue"]);
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))) {
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
