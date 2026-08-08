import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const MAX_EVENTS_PER_MINUTE = 90;
const WINDOW_MS = 60_000;
const localEvents = new Map<string, number[]>();

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

export async function checkStudyRate(userId: string): Promise<{
  ok: boolean;
  retryAfterSec?: number;
}> {
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

    const cutoff = Date.now() - WINDOW_MS;
    const active = (localEvents.get(userId) ?? []).filter((ts) => ts > cutoff);
    if (active.length >= MAX_EVENTS_PER_MINUTE) {
      localEvents.set(userId, active);
      return {
        ok: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((active[0] + WINDOW_MS - Date.now()) / 1000),
        ),
      };
    }
    active.push(Date.now());
    localEvents.set(userId, active);
    return { ok: true };
  } catch (error) {
    // 学习提交本身有认证、授权与幂等保护；限流后端短暂故障时保留可用性。
    console.error("[study-limiter] backend unavailable; allowing request", error);
    return { ok: true };
  }
}

export function resetStudyLimiterForTests(): void {
  localEvents.clear();
}
