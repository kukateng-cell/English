/**
 * 登录限流（分布式，基于 Upstash Redis + @upstash/ratelimit）。
 *
 * 防御目标：
 *  - 暴力破解：对单个账号高频试密码 → 账号维度限流。
 *  - 密码喷洒：用同一密码扫一批账号（每人试 1~2 次，规避账号维度）
 *    → IP 维度限流，单个 IP 累计请求到阈值即拒。
 *
 * 限流策略：滑动窗口（sliding window）。
 *  - 账号维度：同一 Email 每 1 分钟最多 5 次登录尝试。
 *  - IP    维度：同一 IP   每 1 分钟最多 120 次预认证尝试（校园/NAT 友好）。
 *  - 任一维度耗尽即拒绝（并返回距下次可重试的秒数）。
 *
 * 为什么用「每次尝试都计数」而非「只记失败」：
 *  - 这是 @upstash/ratelimit 的惯用法（limit() 原子地「检查 + 消费」一个令牌）。
 *  - 对「所有」登录尝试限流，可顺带防御账号枚举 / 高频探测，比只记失败更稳。
 *  - 合法用户 1 分钟内登录 5 次极少触发；窗口 60s 自动滚动清零，体验友好。
 *
 * 分布式必要性：
 *  - 旧的内存 Map 仅在单进程内有效；Next.js serverless / 多实例部署时
 *    各副本计数不共享，攻击者请求被负载均衡分散即可绕过。
 *  - Upstash Redis 通过 REST API 共享计数，所有副本读写同一窗口状态。
 *
 * 故障策略：production runtime 的后端（Redis）调用抛错时 fail-closed 并记录错误；
 * 只有 local／明确 browser-test runtime 才允许使用单实例 memory fallback。
 *
 * 本地开发：未配置 UPSTASH_REDIS_REST_URL / TOKEN 时，自动降级为
 *  单实例内存滑动窗口（语义一致，仅限本地/单副本，会打印一次警告）。
 * production release gate 会拒绝缺少任一变量，runtime guard 亦避免多实例静默降级。
 */

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  describeBackendFailure,
  requiresDistributedRateLimitBackend,
} from "@/lib/production-config";

/** 单账号保持严格；共享校园/NAT IP 使用较宽的预认证防洪门槛。 */
const ACCOUNT_MAX_ATTEMPTS = 5;
const IP_MAX_ATTEMPTS = 120;

/** Upstash 滑动窗口时长（@upstash/ratelimit 接受的 Duration 字符串）。 */
const WINDOW = "1 m";
/** 内存回退实现使用的窗口时长（毫秒），需与 WINDOW 保持一致。 */
const WINDOW_MS = 60 * 1000;

/** Redis 中限流键的统一前缀，便于在 Upstash 控制台辨识与清理。 */
const KEY_PREFIX = "login";

/**
 * login-status 查询端点专属限流桶的前缀，与登录尝试桶隔离。
 * 独立桶确保「查询锁定状态」不会消耗登录尝试配额。
 */
const STATUS_KEY_PREFIX = "login-status";

/**
 * login-status 端点每窗口允许的查询次数（IP 维度）。
 * 查询是轻量只读操作，阈值比登录尝试（5 次）宽松，但仍足以拦截探针攻击。
 */
const STATUS_MAX = 20;

type Dimension = "account" | "ip" | "session";

interface LimitResult {
  ok: boolean;
  /** 被限流时，距下次可重试的剩余秒数（向上取整，至少 1）。 */
  retryAfterSec?: number;
  /** 命中限流的维度，便于排查。 */
  dimension?: Dimension;
  /** Production Redis/configuration failure, distinct from a consumed quota. */
  backendUnavailable?: boolean;
}

/**
 * 限流后端的统一接口：Upstash 与内存回退各提供一个实现，
 * 上层逻辑无需关心实际跑在哪种存储上。
 */
interface LimiterBackend {
  /** 消费一个令牌：返回是否放行，以及令牌桶重置的 epoch ms。 */
  limit: (key: string) => Promise<{ ok: boolean; reset: number }>;
  /** 只读查询：当前剩余令牌数，以及重置的 epoch ms（不消费）。 */
  remaining: (key: string) => Promise<{ remaining: number; reset: number }>;
  /** 清空该 key 的计数（用于登录成功后清空账号维度）。 */
  reset: (key: string) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Upstash Redis 后端                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 基于 @upstash/ratelimit 滑动窗口的后端。
 * 单个 Ratelimit 实例通过不同 identifier（"account:xxx" / "ip:xxx"）区分维度。
 */
function createUpstashBackend(
  max: number,
  window: Duration,
  redis: Redis,
  prefix: string = KEY_PREFIX,
): LimiterBackend {
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, window),
    prefix,
  });

  return {
    async limit(key) {
      const res = await ratelimit.limit(key);
      // slidingWindow 在超限时「不」新增本次请求到窗口，故被拒时不会无限续期。
      return { ok: res.success, reset: res.reset };
    },
    async remaining(key) {
      const res = await ratelimit.getRemaining(key);
      return { remaining: res.remaining, reset: res.reset };
    },
    async reset(key) {
      await ratelimit.resetUsedTokens(key);
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  内存回退后端（仅本地开发 / 未配置 Upstash 时使用）                           */
/* -------------------------------------------------------------------------- */

/**
 * 单实例滑动窗口：Map<key, 时间戳数组>。每次操作先剔除窗口外的旧时间戳。
 * 语义与 @upstash/ratelimit 的 slidingWindow 一致，便于本地开发对照。
 */
function createMemoryBackend(max: number, windowMs: number): {
  backend: LimiterBackend;
  resetAllForTests: () => void;
} {
  const buckets = new Map<string, number[]>();

  /** 丢弃窗口外的时间戳，返回当前窗口内的有效时间戳数组（并写回 Map）。 */
  const sweep = (key: string): number[] => {
    const cutoff = Date.now() - windowMs;
    const arr = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    buckets.set(key, arr);
    return arr;
  };

  return {
    backend: {
      async limit(key) {
        const arr = sweep(key);
        if (arr.length >= max) {
          // 已满：不追加本次请求，reset = 窗口内最早一笔到期之时。
          return { ok: false, reset: arr[0] + windowMs };
        }
        const now = Date.now();
        arr.push(now);
        buckets.set(key, arr);
        return { ok: true, reset: arr[0] + windowMs };
      },
      async remaining(key) {
        const arr = sweep(key);
        const remaining = Math.max(0, max - arr.length);
        const reset = arr.length > 0 ? arr[0] + windowMs : Date.now() + windowMs;
        return { remaining, reset };
      },
      async reset(key) {
        buckets.delete(key);
      },
    },
    resetAllForTests: () => buckets.clear(),
  };
}

/* -------------------------------------------------------------------------- */
/*  初始化：有 Upstash 环境变量则用分布式，否则降级为内存                        */
/* -------------------------------------------------------------------------- */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const productionRateLimitRequired = requiresDistributedRateLimitBackend();

if (Boolean(UPSTASH_URL) !== Boolean(UPSTASH_TOKEN)) {
  throw new Error(
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together",
  );
}

/** 内存回退模式下，所有桶的「清空」函数集合（仅供测试）。 */
const memoryResets: Array<() => void> = [];

/** 是否使用分布式 Upstash 后端（否则单实例内存回退）。 */
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

/** 分布式模式下所有副本共享同一个 Redis 连接（不同限流桶用 prefix 区分）。 */
const sharedRedis = useUpstash
  ? new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  : null;

/**
 * 账号维度限流后端（严格防暴力破解）。
 */
const accountBackend: LimiterBackend = useUpstash
  ? createUpstashBackend(
      ACCOUNT_MAX_ATTEMPTS,
      WINDOW,
      sharedRedis!,
      `${KEY_PREFIX}-account`,
    )
  : (() => {
      // 本地开发回退：单实例内存计数（与分布式语义一致，但不跨实例共享）。
      if (!productionRateLimitRequired) {
        console.warn(
          "[login-limiter] 未配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，" +
            "降级为单实例内存限流（仅供本地开发；生产请务必配置 Upstash Redis）。",
        );
      }
      const mem = createMemoryBackend(ACCOUNT_MAX_ATTEMPTS, WINDOW_MS);
      memoryResets.push(mem.resetAllForTests);
      return mem.backend;
    })();

const ipBackend: LimiterBackend = useUpstash
  ? createUpstashBackend(
      IP_MAX_ATTEMPTS,
      WINDOW,
      sharedRedis!,
      `${KEY_PREFIX}-ip`,
    )
  : (() => {
      const mem = createMemoryBackend(IP_MAX_ATTEMPTS, WINDOW_MS);
      memoryResets.push(mem.resetAllForTests);
      return mem.backend;
    })();

/**
 * login-status 查询端点专属限流后端（prefix="login-status"）。
 * 独立桶，**不占用登录尝试配额**，仅用于防止攻击者高频探测锁定状态。
 * 阈值较登录尝试宽松（status 查询是轻量只读操作）。
 */
const statusBackend: LimiterBackend = useUpstash
  ? createUpstashBackend(STATUS_MAX, WINDOW, sharedRedis!, STATUS_KEY_PREFIX)
  : (() => {
      const mem = createMemoryBackend(STATUS_MAX, WINDOW_MS);
      memoryResets.push(mem.resetAllForTests);
    return mem.backend;
  })();

/** Re-authentication has its own session bucket in addition to account/IP. */
const REAUTH_SESSION_MAX = 10;
const reauthSessionBackend: LimiterBackend = useUpstash
  ? createUpstashBackend(REAUTH_SESSION_MAX, WINDOW, sharedRedis!, "reauth-session")
  : (() => {
      const mem = createMemoryBackend(REAUTH_SESSION_MAX, WINDOW_MS);
      memoryResets.push(mem.resetAllForTests);
      return mem.backend;
    })();

/* -------------------------------------------------------------------------- */
/*  辅助函数                                                                   */
/* -------------------------------------------------------------------------- */

/** 把 epoch ms 的重置时间换算成「距下次可重试的秒数」，至少 1s。 */
function toRetryAfterSec(resetMs: number): number {
  return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
}

/**
 * 模糊化「精确剩余秒数」的桶大小（向上取整到此值的倍数）。
 *
 * 登录滑动窗口最长 60s，取 30s 桶 → 对外回传值只会是 30 或 60，
 * 攻击者无从据此推得精确解锁时刻，无法精准排程并发爆破。
 */
const FUZZ_BUCKET_SEC = 30;

/**
 * 把「精确剩余秒数」模糊化为粗粒度桶，供对外的 API 回应使用。
 *
 * 策略：向上取整到 FUZZ_BUCKET_SEC 的倍数，且不低于 FUZZ_BUCKET_SEC。
 * 回传值必定 >= 精确值（只可能让使用者多等，不会让他提前重试又被锁），
 * 因此客户端倒计时不会在使用者真正可登入前提前结束。
 *
 * 安全考量：攻击者看到 30 / 60 这种粗估值，与「窗口最长 60s」的公开资讯
 * 相比并无额外信息增益，无法据此精确定时。（如需更强模糊，可叠加随机抖动，
 * 但桶化本身已足以破坏精确排程，且保持确定性便于测试，故未加抖动。）
 */
export function fuzzRetryAfterSec(preciseSec: number): number {
  return Math.max(
    FUZZ_BUCKET_SEC,
    Math.ceil(preciseSec / FUZZ_BUCKET_SEC) * FUZZ_BUCKET_SEC,
  );
}

/** 规范化账号键：小写 + 去首尾空白，避免大小写差异导致计数分裂。 */
function normalizeAccount(account: string): string {
  return account.toLowerCase().trim();
}

/* -------------------------------------------------------------------------- */
/*  对外 API（均为 async；调用方需 await）                                     */
/* -------------------------------------------------------------------------- */

/**
 * 检查当前请求是否被允许尝试登录，并消费一个令牌。
 *
 * 策略：先消费「IP」预认证维度，再消费严格「账号」维度；任一耗尽即拒绝。
 * IP 已被封锁时绝不触碰账号桶，防止攻击者借一个 blocked IP 批量耗尽其他
 * 学生账号的登录配额。
 *
 * 注意：本函数「会」消费令牌（即使是合法用户登录也计 1 次）。
 * 这是「每分钟最多 5 次尝试」的直接实现，并能保护后续 bcrypt 计算不被滥用。
 *
 * Redis 故障时 production fail-closed；本地开发才允许继续使用本地实现。
 */
export async function checkLimit(
  account: string,
  ip: string,
): Promise<LimitResult> {
  if (productionRateLimitRequired && !useUpstash) {
    return { ok: false, retryAfterSec: 60, backendUnavailable: true };
  }
  try {
    const ipResult = await ipBackend.limit(ip);
    if (!ipResult.ok) {
      return {
        ok: false,
        retryAfterSec: toRetryAfterSec(ipResult.reset),
        dimension: "ip",
      };
    }

    const accountResult = await accountBackend.limit(normalizeAccount(account));
    if (!accountResult.ok) {
      return {
        ok: false,
        retryAfterSec: toRetryAfterSec(accountResult.reset),
        dimension: "account",
      };
    }

    return { ok: true };
  } catch (err) {
    console.error(
      `[login-limiter] checkLimit 后端错误，${productionRateLimitRequired ? "fail-closed" : "本地继续"}：`,
      { errorType: describeBackendFailure(err) },
    );
    return productionRateLimitRequired
      ? { ok: false, retryAfterSec: 60, backendUnavailable: true }
      : { ok: true };
  }
}

/** Consume a session-bound reauth bucket after the normal account/IP gate. */
export async function checkReauthSessionLimit(sessionJti: string): Promise<LimitResult> {
  if (productionRateLimitRequired && !useUpstash) return { ok: false, retryAfterSec: 60, dimension: "session" };
  try {
    const result = await reauthSessionBackend.limit(sessionJti);
    return result.ok ? { ok: true } : { ok: false, retryAfterSec: toRetryAfterSec(result.reset), dimension: "session" };
  } catch (err) {
    console.error("[login-limiter] reauth session bucket failure", { errorType: describeBackendFailure(err) });
    return productionRateLimitRequired ? { ok: false, retryAfterSec: 60, dimension: "session" } : { ok: true };
  }
}

/**
 * 只读查询某 (account, ip) 当前是否处于限流状态（不消费令牌）。
 *
 * 供「登录失败后让前端知道是被限流了」的查询端点使用：
 * NextAuth v4 CredentialsProvider 的 authorize 返回 null 时，客户端拿到的
 * 是固定 error 字符串，无法区分「密码错」和「被限流」，故另起端点查询。
 * 该函数只读 Redis 计数，不查数据库，不会泄露账号是否存在。
 */
export async function getLimitStatus(
  account: string,
  ip: string,
): Promise<{
  locked: boolean;
  retryAfterSec?: number;
  dimension?: Dimension;
}> {
  if (productionRateLimitRequired && !useUpstash) {
    return { locked: true, retryAfterSec: 60, dimension: "account" };
  }
  try {
    const acct = await accountBackend.remaining(normalizeAccount(account));
    if (acct.remaining <= 0) {
      return {
        locked: true,
        retryAfterSec: toRetryAfterSec(acct.reset),
        dimension: "account",
      };
    }

    const ipr = await ipBackend.remaining(ip);
    if (ipr.remaining <= 0) {
      return {
        locked: true,
        retryAfterSec: toRetryAfterSec(ipr.reset),
        dimension: "ip",
      };
    }

    return { locked: false };
  } catch (err) {
    console.error(
      `[login-limiter] getLimitStatus 后端错误，${productionRateLimitRequired ? "按已锁定返回" : "按未锁定返回"}：`,
      { errorType: describeBackendFailure(err) },
    );
    return productionRateLimitRequired
      ? { locked: true, retryAfterSec: 60, dimension: "account" }
      : { locked: false };
  }
}

/**
 * 对 login-status 查询端点本身限流（IP 维度），防止攻击者高频探测锁定状态。
 *
 * 使用独立的 statusBackend 桶（prefix="login-status"），**不消耗登录尝试配额**，
 * 因此合法用户查询锁定状态不会影响其登录尝试次数。
 *
 * production 故障时 fail-closed；本地开发才允许继续运行。
 */
export async function checkStatusRate(ip: string): Promise<LimitResult> {
  if (productionRateLimitRequired && !useUpstash) {
    return { ok: false, retryAfterSec: 60, dimension: "ip" };
  }
  try {
    const r = await statusBackend.limit(`ip:${ip}`);
    if (!r.ok) {
      return {
        ok: false,
        retryAfterSec: toRetryAfterSec(r.reset),
        dimension: "ip",
      };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      `[login-limiter] checkStatusRate 后端错误，${productionRateLimitRequired ? "fail-closed" : "本地继续"}：`,
      { errorType: describeBackendFailure(err) },
    );
    return productionRateLimitRequired
      ? { ok: false, retryAfterSec: 60, dimension: "ip" }
      : { ok: true };
  }
}

/**
 * 登录成功后调用：清空该账号维度的计数。
 *
 * 故意只清账号维度 —— IP 维度的计数继续累积，
 * 这样「同 IP 连续撞 N 个不同账号」仍会被 IP 维度拦下。
 *
 * 注意：在「每次尝试都计数」的模型下，本调用是「对合法用户的善意复位」——
 * 用户此前几次手滑输错密码，登录成功后账号维度立刻恢复满额，体验更友好。
 */
export async function resetAccount(account: string): Promise<void> {
  try {
    await accountBackend.reset(normalizeAccount(account));
  } catch (err) {
    console.error("[login-limiter] resetAccount 后端错误：", {
      errorType: describeBackendFailure(err),
    });
  }
}

/**
 * 从 NextAuth authorize 的 req.headers 提取客户端真实 IP。
 *
 * 反代 / 托管平台（Vercel / Supabase 等）通常在 x-forwarded-for 里给真实 IP；
 * 次选 x-real-ip；都拿不到时回退 "unknown"（共享 NAT / 本地开发常见）。
 */
export function getClientIp(headers: unknown): string {
  if (!headers || typeof headers !== "object") return "unknown";
  if (
    "get" in headers &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    const webHeaders = headers as { get(name: string): string | null };
    const xff = webHeaders.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const xri = webHeaders.get("x-real-ip");
    if (xri) return xri.trim();
    return "unknown";
  }
  const h = headers as Record<string, unknown>;
  const pick = (name: string): string | undefined => {
    const v = h[name];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return undefined;
  };

  const xff = pick("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  const xri = pick("x-real-ip");
  if (xri) return xri.trim();

  return "unknown";
}

/** 仅供测试用：清空全部计数（仅内存回退模式有效）。 */
export function __resetForTests(): void {
  memoryResets.forEach((f) => f());
}
