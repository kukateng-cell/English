import { NextResponse } from "next/server";
import {
  getLimitStatus,
  getClientIp,
  checkStatusRate,
  fuzzRetryAfterSec,
} from "@/lib/login-limiter";

/**
 * GET /api/auth/login-status?account=xxx
 *
 * 登录失败后，前端用此端点查询当前账号 / 网络是否被限流锁定，
 * 以便给出「已锁定 + 剩余时间」的明确反馈，而非让用户对着
 * 千篇一律的「账号或密码错误」反复重试（加重服务端负担）。
 *
 * 安全性：
 *  - 只读 Redis 计数，不查数据库 → 不泄露账号是否存在（无账号枚举风险）。
 *  - **不回传精确剩余秒数**：过去直接回传 retryAfterSec（如 127）会让攻击者
 *    精准排程并发爆破。现在经 fuzzRetryAfterSec() 向上取整到 30s 桶
 *    （窗口最长 60s → 只回 30 或 60），不暴露精确解锁时刻。
 *  - 端点本身套用独立限流（checkStatusRate），防止高频探测锁定状态。
 *  - 端点本身轻量（一次 Redis 读），可承受较高 QPS。
 *
 * 响应：
 *  - 200 { locked: false }                                          未锁定
 *  - 429 { locked: true, dimension, retryAfterSec(粗估), message }
 *        并于 Response Header 加入标准的 Retry-After（同一个粗估值）。
 *    - dimension "account"：账号维度锁定
 *    - dimension "ip"：IP 维度锁定
 *  - 429 { locked: false }（仅 Header 带 Retry-After）：查询端点本身被限流，
 *        此时账号未必锁定，前端会回退到通用错误提示。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const account = (url.searchParams.get("account") ?? "")
    .toLowerCase()
    .trim();

  const ip = getClientIp(req.headers);

  // 1. 先对本查询端点本身限流（独立桶，不占用登录尝试配额），
  //    防止攻击者高频探测锁定状态以精确定时爆破。
  const statusLimit = await checkStatusRate(ip);
  if (!statusLimit.ok) {
    const coarse = fuzzRetryAfterSec(statusLimit.retryAfterSec ?? 60);
    return NextResponse.json(
      { locked: false },
      { status: 429, headers: { "Retry-After": String(coarse) } },
    );
  }

  // 2. 查询 (account, ip) 的限流状态（只读，不消费登录令牌）。
  //    没传账号则只看 IP 维度（空账号不会命中任何账号桶）。
  const status = await getLimitStatus(account, ip);

  if (!status.locked) {
    return NextResponse.json({ locked: false });
  }

  // 3. 模糊化剩余时间：向上取整到 30s 桶（窗口最长 60s → 只回 30 或 60），
  //    避免泄露精确解锁秒数。回传值恒 >= 实际值，客户端倒计时不会过早结束。
  const coarseRetry = fuzzRetryAfterSec(status.retryAfterSec ?? 60);

  const message =
    status.dimension === "account"
      ? "该账号登录失败次数过多，已临时锁定"
      : "当前网络登录失败次数过多，已临时锁定";

  // 4. 锁定 → HTTP 429 + 标准 Retry-After Header（粗估）；Body 仅给粗估秒数。
  return NextResponse.json(
    {
      locked: true,
      dimension: status.dimension,
      retryAfterSec: coarseRetry,
      message,
    },
    { status: 429, headers: { "Retry-After": String(coarseRetry) } },
  );
}
