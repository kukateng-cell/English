import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { describeBackendFailure, requiresDistributedRateLimitBackend } from "@/lib/production-config";

const WINDOW_MS = 15 * 60_000;
const TARGET_WINDOW_MS = 60 * 60_000;
const LIMITS = { teacher: 20, session: 10, ip: 60, target: 3 } as const;

type Bucket = keyof typeof LIMITS;
type Result = { ok: true } | { ok: false; dimension: Bucket | "backend"; retryAfterSec: number };

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (Boolean(url) !== Boolean(token)) throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together");
const redis = url && token ? new Redis({ url, token }) : null;
const productionRequired = requiresDistributedRateLimitBackend();

const upstash = redis ? {
  teacher: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.teacher, "15 m"), prefix: "teacher-reset-teacher" }),
  session: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.session, "15 m"), prefix: "teacher-reset-session" }),
  ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.ip, "15 m"), prefix: "teacher-reset-ip" }),
  target: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(LIMITS.target, "1 h"), prefix: "teacher-reset-target" }),
} : null;
const local = new Map<string, number[]>();

function localLimit(bucket: Bucket, key: string): Result {
  const window = bucket === "target" ? TARGET_WINDOW_MS : WINDOW_MS;
  const mapKey = `${bucket}:${key}`;
  const active = (local.get(mapKey) ?? []).filter((value) => value > Date.now() - window);
  if (active.length >= LIMITS[bucket]) return { ok: false, dimension: bucket, retryAfterSec: Math.max(1, Math.ceil((active[0] + window - Date.now()) / 1_000)) };
  active.push(Date.now());
  local.set(mapKey, active);
  return { ok: true };
}

export async function consumeTeacherResetLimits(input: { teacherId: string; sessionJti: string; ip: string; targetId: string }): Promise<Result> {
  if (productionRequired && !upstash) return { ok: false, dimension: "backend", retryAfterSec: 60 };
  try {
    if (!upstash) {
      for (const [bucket, key] of [["teacher", input.teacherId], ["session", input.sessionJti], ["ip", input.ip], ["target", input.targetId]] as const) {
        const result = localLimit(bucket, key);
        if (!result.ok) return result;
      }
      return { ok: true };
    }
    for (const [bucket, key] of [["teacher", input.teacherId], ["session", input.sessionJti], ["ip", input.ip], ["target", input.targetId]] as const) {
      const result = await upstash[bucket].limit(key);
      if (!result.success) return { ok: false, dimension: bucket, retryAfterSec: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)) };
    }
    return { ok: true };
  } catch (error) {
    console.error("[teacher-reset-limiter] backend error", { errorType: describeBackendFailure(error) });
    return productionRequired ? { ok: false, dimension: "backend", retryAfterSec: 60 } : { ok: true };
  }
}

export function resetTeacherResetLimiterForTests() {
  local.clear();
}
