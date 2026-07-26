/**
 * 登录限流（内存计数，按「账号」与「来源 IP」双维度）。
 *
 * 防御目标：
 *  - 暴力破解：对单个账号高频试密码 → 账号维度锁定。
 *  - 密码喷洒：用同一密码扫一批账号（每人试 1~2 次，规避账号维度）
 *    → IP 维度封顶，单个 IP 累计失败到阈值即锁。
 *
 * 实现：模块级 Map，单进程内有效。
 *  - 限制：Next.js serverless / 多实例部署时，计数不共享（每副本各自计算），
 *    攻击者请求若被负载均衡分散到不同副本时会绕过。
 *    生产高并发或多副本场景建议改用 upstash/redis 等共享存储；
 *    本实现满足「单实例 / 中小规模」的校园场景。
 *  - 内存回收：每小时清理一次「计数为 0 且已过锁定时间」的空桶，
 *    防止长期运行后 Map 无限增长。
 */

/** 单账号连续失败 5 次 → 锁定 15 分钟。 */
const MAX_ATTEMPTS_BY_ACCOUNT = 5;
const LOCK_MS_BY_ACCOUNT = 15 * 60 * 1000;

/** 单 IP 累计失败 20 次 → 锁定 5 分钟。阈值比账号高，避免多用户共用 IP 误伤。 */
const MAX_ATTEMPTS_BY_IP = 20;
const LOCK_MS_BY_IP = 5 * 60 * 1000;

/** 每隔 1 小时清理一次空桶。 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

interface Bucket {
  /** 当前周期内已累计的失败次数；进入锁定时清零。 */
  count: number;
  /** 锁定截止时刻（epoch ms），0 表示未锁。 */
  lockedUntil: number;
}

const accountBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
let lastCleanup = Date.now();

/** 清掉「无计数且未锁定」的桶，控制 Map 体积。 */
function prune(m: Map<string, Bucket>): void {
  const now = Date.now();
  for (const [k, v] of m) {
    if (v.count === 0 && v.lockedUntil <= now) m.delete(k);
  }
}

/** 距上次清理超过 CLEANUP_INTERVAL_MS 才执行一次，避免每次请求都扫。 */
function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  prune(accountBuckets);
  prune(ipBuckets);
}

interface LimitResult {
  ok: boolean;
  /** 被锁定时，距解锁的剩余秒数（向上取整），用于日志与排查。 */
  retryAfterSec?: number;
  /** 命中锁定的维度，便于排查。 */
  dimension?: "account" | "ip";
}

/**
 * 在某个维度的桶上记一笔失败。
 *
 * 锁定语义：累计失败次数到达阈值 → 设置 lockedUntil，并把 count 清零。
 * 清零的目的：锁定到期后进入全新一轮计数，避免历史 count 累积导致
 * 「锁一解就立刻又因 +1 越界再锁」。
 * 锁定期间内重复调用不再累加（lockedUntil > now 时跳过），防止无限堆积。
 */
function bump(
  m: Map<string, Bucket>,
  key: string,
  max: number,
  lockMs: number,
): void {
  const now = Date.now();
  const b = m.get(key) ?? { count: 0, lockedUntil: 0 };
  if (b.lockedUntil <= now) {
    b.count += 1;
    if (b.count >= max) {
      b.lockedUntil = now + lockMs;
      b.count = 0;
    }
  }
  m.set(key, b);
}

/** 检查当前请求是否被允许尝试登录。两个维度都放行才返回 ok。 */
export function checkLimit(account: string, ip: string): LimitResult {
  maybeCleanup();
  const now = Date.now();

  const ab = accountBuckets.get(account);
  if (ab && ab.lockedUntil > now) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((ab.lockedUntil - now) / 1000),
      dimension: "account",
    };
  }

  const ib = ipBuckets.get(ip);
  if (ib && ib.lockedUntil > now) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((ib.lockedUntil - now) / 1000),
      dimension: "ip",
    };
  }

  return { ok: true };
}

/** 登录失败后调用：账号、IP 两个维度各记一笔。 */
export function recordFailure(account: string, ip: string): void {
  bump(accountBuckets, account, MAX_ATTEMPTS_BY_ACCOUNT, LOCK_MS_BY_ACCOUNT);
  bump(ipBuckets, ip, MAX_ATTEMPTS_BY_IP, LOCK_MS_BY_IP);
}

/**
 * 查询某 (account, ip) 当前是否处于锁定状态（只读，不改变计数）。
 *
 * 供「登录失败后让前端知道是被锁了」的查询端点使用：
 * NextAuth v4 CredentialsProvider 的 authorize 返回 null 时，客户端拿到的
 * 是固定 error 字符串，无法区分「密码错」和「被限流」，故另起端点查询。
 * 该函数只读内存 Map，不查数据库，不会泄露账号是否存在。
 */
export function getLimitStatus(account: string, ip: string): {
  locked: boolean;
  retryAfterSec?: number;
  dimension?: "account" | "ip";
} {
  const now = Date.now();

  const ab = accountBuckets.get(account);
  if (ab && ab.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((ab.lockedUntil - now) / 1000),
      dimension: "account",
    };
  }

  const ib = ipBuckets.get(ip);
  if (ib && ib.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((ib.lockedUntil - now) / 1000),
      dimension: "ip",
    };
  }

  return { locked: false };
}

/**
 * 登录成功后调用：清空该账号的失败计数。
 * 故意只清账号维度 —— IP 维度的计数继续累积，
 * 这样「同 IP 连续撞 N 个不同账号」仍会被 IP 维度拦下。
 */
export function resetAccount(account: string): void {
  const ab = accountBuckets.get(account);
  if (ab) {
    ab.count = 0;
    ab.lockedUntil = 0;
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

/** 仅供测试用：清空全部计数与锁定。 */
export function __resetForTests(): void {
  accountBuckets.clear();
  ipBuckets.clear();
  lastCleanup = Date.now();
}
