import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  describeBackendFailure,
  requiresDistributedRateLimitBackend,
} from "@/lib/production-config";

const MAX_EVENTS_PER_MINUTE = 90;
const DEFAULT_MAX_QUEUE_LOADS_PER_USER_PER_MINUTE = 60;
const DEFAULT_MAX_QUEUE_LOADS_PER_IP_PER_MINUTE = 120;
const e2eQueueLimit = Number(process.env.E2E_STUDY_QUEUE_LOAD_LIMIT);
const validE2eQueueLimit =
  process.env.ENABLE_TEST_ROUTES === "1" &&
  Number.isSafeInteger(e2eQueueLimit) &&
  e2eQueueLimit >= DEFAULT_MAX_QUEUE_LOADS_PER_IP_PER_MINUTE &&
  e2eQueueLimit <= 1_000;
const MAX_QUEUE_LOADS_PER_USER_PER_MINUTE =
  validE2eQueueLimit
    ? e2eQueueLimit
    : DEFAULT_MAX_QUEUE_LOADS_PER_USER_PER_MINUTE;
const MAX_QUEUE_LOADS_PER_IP_PER_MINUTE = validE2eQueueLimit
  ? e2eQueueLimit
  : DEFAULT_MAX_QUEUE_LOADS_PER_IP_PER_MINUTE;
const MAX_CREDENTIAL_RENEWALS_PER_USER_PER_MINUTE = 30;
const MAX_CREDENTIAL_RENEWALS_PER_IP_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
const localEvents = new Map<string, number[]>();
const localQueueUsers = new Map<string, number[]>();
const localQueueIps = new Map<string, number[]>();
const localCredentialUsers = new Map<string, number[]>();
const localCredentialIps = new Map<string, number[]>();

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const distributedLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_EVENTS_PER_MINUTE, "1 m"),
      prefix: "study-user",
    })
  : null;

const distributedQueueUserLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        MAX_QUEUE_LOADS_PER_USER_PER_MINUTE,
        "1 m",
      ),
      prefix: "study-queue-user",
    })
  : null;

const distributedQueueIpLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        MAX_QUEUE_LOADS_PER_IP_PER_MINUTE,
        "1 m",
      ),
      prefix: "study-queue-ip",
    })
  : null;

const distributedCredentialUserLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        MAX_CREDENTIAL_RENEWALS_PER_USER_PER_MINUTE,
        "1 m",
      ),
      prefix: "study-credentials-user",
    })
  : null;

const distributedCredentialIpLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        MAX_CREDENTIAL_RENEWALS_PER_IP_PER_MINUTE,
        "1 m",
      ),
      prefix: "study-credentials-ip",
    })
  : null;

function unavailableInProduction(): { ok: false; retryAfterSec: number } | null {
  return requiresDistributedRateLimitBackend() && !redis
    ? { ok: false, retryAfterSec: 60 }
    : null;
}

function backendFailureInProduction(): { ok: false; retryAfterSec: number } | null {
  return requiresDistributedRateLimitBackend()
    ? { ok: false, retryAfterSec: 60 }
    : null;
}

function consumeLocalWindow(
  buckets: Map<string, number[]>,
  key: string,
  maximum: number,
): { ok: boolean; retryAfterSec?: number } {
  const cutoff = Date.now() - WINDOW_MS;
  const active = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (active.length >= maximum) {
    buckets.set(key, active);
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((active[0] + WINDOW_MS - Date.now()) / 1000),
      ),
    };
  }
  active.push(Date.now());
  buckets.set(key, active);
  return { ok: true };
}

export async function checkStudyRate(userId: string): Promise<{
  ok: boolean;
  retryAfterSec?: number;
}> {
  const unavailable = unavailableInProduction();
  if (unavailable) return unavailable;
  try {
    if (distributedLimiter) {
      const result = await distributedLimiter.limit(userId);
      return result.success
        ? { ok: true }
        : {
            ok: false,
            retryAfterSec: Math.max(
              1,
              Math.ceil((result.reset - Date.now()) / 1000),
            ),
          };
    }

    return consumeLocalWindow(localEvents, userId, MAX_EVENTS_PER_MINUTE);
  } catch (error) {
    const failure = backendFailureInProduction();
    console.error(
      `[study-limiter] backend unavailable; ${failure ? "failing closed" : "using local fallback"}`,
      { errorType: describeBackendFailure(error) },
    );
    return failure ?? { ok: true };
  }
}

export async function checkStudyQueueRate(
  userId: string,
  ip: string,
): Promise<{ ok: boolean; retryAfterSec?: number; dimension?: "user" | "ip" }> {
  const unavailable = unavailableInProduction();
  if (unavailable) return unavailable;
  try {
    if (distributedQueueIpLimiter && distributedQueueUserLimiter) {
      const ipResult = await distributedQueueIpLimiter.limit(ip);
      if (!ipResult.success) {
        return {
          ok: false,
          dimension: "ip",
          retryAfterSec: Math.max(
            1,
            Math.ceil((ipResult.reset - Date.now()) / 1000),
          ),
        };
      }
      const userResult = await distributedQueueUserLimiter.limit(userId);
      return userResult.success
        ? { ok: true }
        : {
            ok: false,
            dimension: "user",
            retryAfterSec: Math.max(
              1,
              Math.ceil((userResult.reset - Date.now()) / 1000),
            ),
          };
    }

    const ipResult = consumeLocalWindow(
      localQueueIps,
      ip,
      MAX_QUEUE_LOADS_PER_IP_PER_MINUTE,
    );
    if (!ipResult.ok) return { ...ipResult, dimension: "ip" };
    const userResult = consumeLocalWindow(
      localQueueUsers,
      userId,
      MAX_QUEUE_LOADS_PER_USER_PER_MINUTE,
    );
    return userResult.ok
      ? { ok: true }
      : { ...userResult, dimension: "user" };
  } catch (error) {
    const failure = backendFailureInProduction();
    console.error(
      `[study-queue-limiter] backend unavailable; ${failure ? "failing closed" : "using local fallback"}`,
      { errorType: describeBackendFailure(error) },
    );
    return failure ?? { ok: true };
  }
}

export async function checkStudyCredentialRate(
  userId: string,
  ip: string,
): Promise<{ ok: boolean; retryAfterSec?: number; dimension?: "user" | "ip" }> {
  const unavailable = unavailableInProduction();
  if (unavailable) return unavailable;
  try {
    if (distributedCredentialIpLimiter && distributedCredentialUserLimiter) {
      const ipResult = await distributedCredentialIpLimiter.limit(ip);
      if (!ipResult.success) {
        return {
          ok: false,
          dimension: "ip",
          retryAfterSec: Math.max(
            1,
            Math.ceil((ipResult.reset - Date.now()) / 1000),
          ),
        };
      }
      const userResult = await distributedCredentialUserLimiter.limit(userId);
      return userResult.success
        ? { ok: true }
        : {
            ok: false,
            dimension: "user",
            retryAfterSec: Math.max(
              1,
              Math.ceil((userResult.reset - Date.now()) / 1000),
            ),
          };
    }
    const ipResult = consumeLocalWindow(
      localCredentialIps,
      ip,
      MAX_CREDENTIAL_RENEWALS_PER_IP_PER_MINUTE,
    );
    if (!ipResult.ok) return { ...ipResult, dimension: "ip" };
    const userResult = consumeLocalWindow(
      localCredentialUsers,
      userId,
      MAX_CREDENTIAL_RENEWALS_PER_USER_PER_MINUTE,
    );
    return userResult.ok
      ? { ok: true }
      : { ...userResult, dimension: "user" };
  } catch (error) {
    const failure = backendFailureInProduction();
    console.error(
      `[study-credential-limiter] backend unavailable; ${failure ? "failing closed" : "using local fallback"}`,
      { errorType: describeBackendFailure(error) },
    );
    return failure ?? { ok: true };
  }
}

export function resetStudyLimiterForTests(): void {
  localEvents.clear();
  localQueueUsers.clear();
  localQueueIps.clear();
  localCredentialUsers.clear();
  localCredentialIps.clear();
}
