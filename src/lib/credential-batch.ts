import { Worker } from "node:worker_threads";
import { BCRYPT_COST } from "@/lib/password-credentials";
import { generateTemporaryPassword } from "@/lib/temporary-password";

export type PreparedCredential = { userId?: string; accountName: string; temporaryPassword: string; passwordHash: string };

const MAX_HASH_WORKERS = 8;

/**
 * bcryptjs is deliberately retained for the same portable bcrypt cost-12
 * primitive used by every password writer.  Its async API yields to the event
 * loop but does not parallelise CPU work, so a 500-row roster would otherwise
 * spend more than two minutes hashing on the local eight-core fixture.  Keep
 * the bounded worker pool here (server-only module) so the hash work is still
 * outside the database transaction without lowering the cost or logging a
 * password.  The worker receives only short-lived request-memory values and
 * returns hashes; it never writes to the database or emits logs.
 */
const HASH_WORKER_SOURCE = `
  const { parentPort, workerData } = require("node:worker_threads");
  const bcrypt = require("bcryptjs");
  try {
    const hashes = workerData.jobs.map((job) => bcrypt.hashSync(job.temporaryPassword, workerData.cost));
    parentPort.postMessage({ ok: true, hashes });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "credential hash worker failed",
    });
  }
`;

type WorkerMessage = { ok: true; hashes: string[] } | { ok: false; error: string };

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; hashes?: unknown; error?: unknown };
  if (candidate.ok === true) return Array.isArray(candidate.hashes) && candidate.hashes.every((hash) => typeof hash === "string");
  return candidate.ok === false && typeof candidate.error === "string";
}

async function hashCredentialsInWorkers(items: Array<{ temporaryPassword: string }>): Promise<string[]> {
  if (items.length === 0) return [];
  const workerCount = Math.min(MAX_HASH_WORKERS, items.length);
  const hashes = new Array<string>(items.length);
  const runningWorkers: Worker[] = [];
  const terminateAll = () => Promise.allSettled(runningWorkers.map((worker) => worker.terminate()));
  await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => {
    const start = Math.floor(items.length * workerIndex / workerCount);
    const end = Math.floor(items.length * (workerIndex + 1) / workerCount);
    const jobs = items.slice(start, end);
    return new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(HASH_WORKER_SOURCE, {
          eval: true,
          workerData: { jobs, cost: BCRYPT_COST },
        });
      } catch (error) {
        void terminateAll();
        reject(error instanceof Error ? error : new Error("credential hash worker failed"));
        return;
      }
      runningWorkers.push(worker);
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        void terminateAll();
        reject(error instanceof Error ? error : new Error("credential hash worker failed"));
      };
      worker.once("error", fail);
      worker.once("message", (message: unknown) => {
        if (!isWorkerMessage(message)) {
          fail(new Error("credential hash worker returned invalid output"));
          return;
        }
        if (!message.ok) {
          fail(new Error(message.error));
          return;
        }
        if (message.hashes.length !== jobs.length) {
          fail(new Error("credential hash worker returned an invalid count"));
          return;
        }
        message.hashes.forEach((hash, offset) => { hashes[start + offset] = hash; });
        settled = true;
        resolve();
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) fail(new Error(`credential hash worker exited with code ${code}`));
      });
    });
  }));
  return hashes;
}

export async function prepareCredentials(accountNames: string[], userIds?: string[]): Promise<PreparedCredential[]> {
  const output = accountNames.map((accountName, index) => ({
    userId: userIds?.[index],
    accountName,
    temporaryPassword: generateTemporaryPassword(),
    passwordHash: "",
  }));
  const hashes = await hashCredentialsInWorkers(output);
  return output.map((credential, index) => ({ ...credential, passwordHash: hashes[index] }));
}
