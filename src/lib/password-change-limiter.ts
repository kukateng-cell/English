import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const USER_MAX_ATTEMPTS = 5;
const IP_MAX_ATTEMPTS = 30;
const WINDOW_MS = 15 * 60_000;
const MAX_BACKOFF_SECONDS = 60;
const localUsers = new Map<string, number[]>();
const localIps = new Map<string, number[]>();
const localFailures = new Map<
  string,
  { count: number; expiresAt: number; blockedUntil: number }
>();

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const userLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(USER_MAX_ATTEMPTS, "15 m"),
      prefix: "password-change-user",
    })
  : null;
const ipLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(IP_MAX_ATTEMPTS, "15 m"),
      prefix: "password-change-ip",
    })
  : null;

function consume(
  buckets: Map<string, number[]>,
  key: string,
  maximum: number,
) {
  const cutoff = Date.now() - WINDOW_MS;
  const active = (buckets.get(key) ?? []).filter((time) => time > cutoff);
  if (active.length >= maximum) {
    buckets.set(key, active);
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((active[0] + WINDOW_MS - Date.now()) / 1_000),
      ),
    };
  }
  active.push(Date.now());
  buckets.set(key, active);
  return { ok: true };
}

function failureCountKey(userId: string) {
  return `password-change-failures:${userId}`;
}

function backoffKey(userId: string) {
  return `password-change-backoff:${userId}`;
}

async function currentBackoffSeconds(userId: string) {
  if (redis) {
    return Math.max(0, await redis.ttl(backoffKey(userId)));
  }
  const state = localFailures.get(userId);
  if (!state || state.expiresAt <= Date.now()) {
    localFailures.delete(userId);
    return 0;
  }
  return Math.max(0, Math.ceil((state.blockedUntil - Date.now()) / 1_000));
}

export async function checkPasswordChangeLimit(userId: string, ip: string) {
  try {
    const backoff = await currentBackoffSeconds(userId);
    if (backoff > 0) {
      return {
        ok: false,
        dimension: "backoff" as const,
        retryAfterSec: backoff,
      };
    }
    if (ipLimiter && userLimiter) {
      const ipResult = await ipLimiter.limit(ip);
      if (!ipResult.success) {
        return {
          ok: false,
          dimension: "ip" as const,
          retryAfterSec: Math.max(
            1,
            Math.ceil((ipResult.reset - Date.now()) / 1_000),
          ),
        };
      }
      const userResult = await userLimiter.limit(userId);
      return userResult.success
        ? { ok: true }
        : {
            ok: false,
            dimension: "user" as const,
            retryAfterSec: Math.max(
              1,
              Math.ceil((userResult.reset - Date.now()) / 1_000),
            ),
          };
    }

    const ipResult = consume(localIps, ip, IP_MAX_ATTEMPTS);
    if (!ipResult.ok) return { ...ipResult, dimension: "ip" as const };
    const userResult = consume(localUsers, userId, USER_MAX_ATTEMPTS);
    return userResult.ok
      ? { ok: true }
      : { ...userResult, dimension: "user" as const };
  } catch (error) {
    console.error("[password-change-limiter] backend unavailable", error);
    return { ok: true };
  }
}

/** Record a failed current-password check and impose 1, 2, 4…60 second backoff. */
export async function recordPasswordChangeFailure(userId: string) {
  try {
    if (redis) {
      const key = failureCountKey(userId);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, Math.ceil(WINDOW_MS / 1_000));
      const retryAfterSec = Math.min(
        MAX_BACKOFF_SECONDS,
        2 ** Math.max(0, count - 1),
      );
      await redis.set(backoffKey(userId), "1", { ex: retryAfterSec });
      return retryAfterSec;
    }

    const now = Date.now();
    const previous = localFailures.get(userId);
    const count = previous && previous.expiresAt > now ? previous.count + 1 : 1;
    const retryAfterSec = Math.min(
      MAX_BACKOFF_SECONDS,
      2 ** Math.max(0, count - 1),
    );
    localFailures.set(userId, {
      count,
      expiresAt: now + WINDOW_MS,
      blockedUntil: now + retryAfterSec * 1_000,
    });
    return retryAfterSec;
  } catch (error) {
    console.error("[password-change-limiter] backoff backend unavailable", error);
    return 0;
  }
}

export async function resetPasswordChangeUserLimit(userId: string) {
  if (userLimiter) {
    await Promise.all([
      userLimiter.resetUsedTokens(userId),
      redis!.del(failureCountKey(userId), backoffKey(userId)),
    ]);
  } else {
    localUsers.delete(userId);
    localFailures.delete(userId);
  }
}

export function resetPasswordChangeLimiterForTests() {
  localUsers.clear();
  localIps.clear();
  localFailures.clear();
}
