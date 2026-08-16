import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { describeBackendFailure, requiresDistributedRateLimitBackend } from "@/lib/production-config";
import type { PasswordResetAudience } from "@/lib/password-reset-precondition";

const WINDOW_MS = 15 * 60_000;
const TARGET_WINDOW_MS = 60 * 60_000;

type Bucket = "actor" | "session" | "ip" | "target";
export type PasswordResetLimitResult =
  | { ok: true }
  | { ok: false; dimension: Bucket | "backend"; retryAfterSec: number };

type Policy = {
  namespace: string;
  actor: number;
  session: number;
  ip: number;
  target: number;
  errorCode: "ADMIN_RESET_RATE_LIMITED" | "TEACHER_RESET_RATE_LIMITED";
};

const POLICIES: Record<PasswordResetAudience, Policy> = {
  ADMIN_USER_RESET: {
    namespace: "admin-user-reset-v2",
    actor: 30,
    session: 20,
    ip: 60,
    target: 3,
    errorCode: "ADMIN_RESET_RATE_LIMITED",
  },
  TEACHER_STUDENT_RESET: {
    namespace: "teacher-student-reset-v2",
    actor: 20,
    session: 10,
    ip: 60,
    target: 3,
    errorCode: "TEACHER_RESET_RATE_LIMITED",
  },
};

type LocalEntry = { at: number };
const local = new Map<string, LocalEntry[]>();

function keySecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for password reset limiter");
  return "development-only-password-reset-limiter-secret";
}

function pseudonymize(audience: PasswordResetAudience, bucket: Bucket, value: string) {
  return createHmac("sha256", keySecret())
    .update(`password-reset-rate-limit:${audience}:${bucket}:v1:`)
    .update(value)
    .digest("hex");
}

function policyFor(audience: PasswordResetAudience) {
  return POLICIES[audience];
}

function localConsume(audience: PasswordResetAudience, bucket: Bucket, value: string): PasswordResetLimitResult {
  const policy = policyFor(audience);
  const limit = policy[bucket];
  const window = bucket === "target" ? TARGET_WINDOW_MS : WINDOW_MS;
  const key = `${policy.namespace}:${bucket}:${pseudonymize(audience, bucket, value)}`;
  const cutoff = Date.now() - window;
  const entries = (local.get(key) ?? []).filter((entry) => entry.at > cutoff);
  if (entries.length >= limit) {
    return {
      ok: false,
      dimension: bucket,
      retryAfterSec: Math.max(1, Math.ceil((entries[0]!.at + window - Date.now()) / 1_000)),
    };
  }
  entries.push({ at: Date.now() });
  local.set(key, entries);
  return { ok: true };
}

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (Boolean(url) !== Boolean(token)) throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together");
  return url && token ? new Redis({ url, token }) : null;
}

export async function consumePasswordResetLimits(input: {
  audience: PasswordResetAudience;
  actorId: string;
  sessionJti: string;
  ip: string;
  targetId: string;
}): Promise<PasswordResetLimitResult> {
  const policy = policyFor(input.audience);
  const productionRequired = requiresDistributedRateLimitBackend();
  try {
    const redis = redisClient();
    if (!redis) {
      if (productionRequired) return { ok: false, dimension: "backend", retryAfterSec: 60 };
      for (const [bucket, value] of [
        ["actor", input.actorId],
        ["session", input.sessionJti],
        ["ip", input.ip],
        ["target", input.targetId],
      ] as const) {
        const result = localConsume(input.audience, bucket, value);
        if (!result.ok) return result;
      }
      return { ok: true };
    }
    const limiters = {
      actor: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(policy.actor, "15 m"), prefix: `${policy.namespace}-actor` }),
      session: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(policy.session, "15 m"), prefix: `${policy.namespace}-session` }),
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(policy.ip, "15 m"), prefix: `${policy.namespace}-ip` }),
      target: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(policy.target, "1 h"), prefix: `${policy.namespace}-target` }),
    } satisfies Record<Bucket, Ratelimit>;
    for (const [bucket, value] of [
      ["actor", input.actorId],
      ["session", input.sessionJti],
      ["ip", input.ip],
      ["target", input.targetId],
    ] as const) {
      const result = await limiters[bucket].limit(pseudonymize(input.audience, bucket, value));
      if (!result.success) return { ok: false, dimension: bucket, retryAfterSec: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)) };
    }
    return { ok: true };
  } catch (error) {
    console.error("[password-reset-limiter] backend error", { errorType: describeBackendFailure(error), audience: input.audience });
    return productionRequired ? { ok: false, dimension: "backend", retryAfterSec: 60 } : { ok: true };
  }
}

export function passwordResetLimitErrorCode(audience: PasswordResetAudience) {
  return policyFor(audience).errorCode;
}

export function resetPasswordResetLimiterForTests() {
  local.clear();
}
