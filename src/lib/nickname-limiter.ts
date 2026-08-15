import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { requiresDistributedRateLimitBackend } from "@/lib/production-config";

const WINDOW_MS = 60 * 60_000;
const MAX_CHANGES = 5;
const local = new Map<string, number[]>();
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;
const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_CHANGES, "1 h"),
      prefix: "nickname-change-user",
    })
  : null;

export async function checkNicknameChangeRate(userId: string) {
  if (requiresDistributedRateLimitBackend() && !limiter) {
    return { ok: false, retryAfterSec: 60 };
  }
  if (limiter) {
    try {
      const result = await limiter.limit(userId);
      return result.success
        ? { ok: true }
        : {
            ok: false,
            retryAfterSec: Math.max(
              1,
              Math.ceil((result.reset - Date.now()) / 1_000),
            ),
          };
    } catch {
      return requiresDistributedRateLimitBackend()
        ? { ok: false, retryAfterSec: 60 }
        : { ok: true };
    }
  }
  const cutoff = Date.now() - WINDOW_MS;
  const active = (local.get(userId) ?? []).filter((time) => time > cutoff);
  if (active.length >= MAX_CHANGES) {
    local.set(userId, active);
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((active[0] + WINDOW_MS - Date.now()) / 1_000),
      ),
    };
  }
  active.push(Date.now());
  local.set(userId, active);
  return { ok: true };
}

export function resetNicknameLimiterForTests() {
  local.clear();
}
