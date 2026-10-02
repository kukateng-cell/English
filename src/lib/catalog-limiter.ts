import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { describeBackendFailure, requiresDistributedRateLimitBackend } from "@/lib/production-config";

const WINDOW_MS = 15 * 60_000;
const USER_LIMIT = 60;
const IP_LIMIT = 120;
const local = new Map<string, number[]>();

export type CatalogLimitResult = { ok: true } | { ok: false; retryAfterSec: number; backendUnavailable: boolean };

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for catalog limiter");
  return "development-only-catalog-limiter-secret";
}

function key(scope: "user" | "ip", value: string): string {
  return `${scope}:${createHmac("sha256", secret()).update(`catalog-governance-v2\u0000${scope}\u0000${value}`, "utf8").digest("hex")}`;
}

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (Boolean(url) !== Boolean(token)) throw new Error("Upstash URL and token must be configured together");
  return url && token ? new Redis({ url, token }) : null;
}

export async function consumeCatalogGovernanceLimit(actorId: string, ip: string): Promise<CatalogLimitResult> {
  const productionRequired = requiresDistributedRateLimitBackend();
  try {
    const redis = redisClient();
    const buckets = [{ pseudonym: key("user", actorId), limit: USER_LIMIT }, { pseudonym: key("ip", ip), limit: IP_LIMIT }];
    if (redis) {
      for (const bucket of buckets) {
        const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(bucket.limit, "15 m"), prefix: "catalog-governance-v2" });
        const result = await limiter.limit(bucket.pseudonym);
        if (!result.success) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)), backendUnavailable: false };
      }
      return { ok: true };
    }
    if (productionRequired) return { ok: false, retryAfterSec: 60, backendUnavailable: true };
    const now = Date.now();
    for (const bucket of buckets) {
      const entries = (local.get(bucket.pseudonym) ?? []).filter((timestamp) => timestamp > now - WINDOW_MS);
      if (entries.length >= bucket.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entries[0]! + WINDOW_MS - now) / 1_000)), backendUnavailable: false };
      entries.push(now);
      local.set(bucket.pseudonym, entries);
    }
    return { ok: true };
  } catch (error) {
    console.error("[catalog-limiter] backend error", { errorType: describeBackendFailure(error) });
    return productionRequired ? { ok: false, retryAfterSec: 60, backendUnavailable: true } : { ok: true };
  }
}

export function resetCatalogLimiterForTests(): void {
  local.clear();
}
