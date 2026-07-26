import { NextResponse } from "next/server";
import { getLimitStatus, getClientIp } from "@/lib/login-limiter";

/**
 * GET /api/auth/login-status?account=xxx
 *
 * 登录失败后，前端用此端点查询当前账号 / 网络是否被限流锁定，
 * 以便给出「已锁定 + 剩余时间」的明确反馈，而非让用户对着
 * 千篇一律的「账号或密码错误」反复重试（加重服务端负担）。
 *
 * 安全性：
 *  - 只读内存计数 Map，不查数据库 → 不泄露账号是否存在（无账号枚举风险）。
 *  - 端点本身极轻量（纯内存读），单机可承受很高 QPS。
 *
 * 响应：
 *  - { locked: false }                              未锁定
 *  - { locked: true, dimension: "account", retryAfterSec, message }  账号维度锁定
 *  - { locked: true, dimension: "ip", retryAfterSec, message }      IP 维度锁定
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const account = (url.searchParams.get("account") ?? "")
    .toLowerCase()
    .trim();

  // 没传账号无法查账号维度；退化为只看 IP 维度（传入空串不会命中任何账号桶）。
  const ip = getClientIp(req.headers);
  const status = getLimitStatus(account, ip);

  if (!status.locked) {
    return NextResponse.json({ locked: false });
  }

  const message =
    status.dimension === "account"
      ? "该账号登录失败次数过多，已临时锁定"
      : "当前网络登录失败次数过多，已临时锁定";

  return NextResponse.json({
    locked: true,
    dimension: status.dimension,
    retryAfterSec: status.retryAfterSec,
    message,
  });
}
