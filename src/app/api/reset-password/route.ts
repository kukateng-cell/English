import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getClientIp } from "@/lib/login-limiter";
import {
  checkPasswordChangeLimit,
  recordPasswordChangeFailure,
  resetPasswordChangeUserLimit,
} from "@/lib/password-change-limiter";
import { passwordPolicyError } from "@/lib/password-policy";
import {
  hasRecentAuthentication,
  securityEventData,
} from "@/lib/security-events";

/**
 * 首次登入 / 主动修改密码。
 *
 * 请求体：{ currentPassword: string, newPassword: string }
 *  - currentPassword：必须与库中 hash 匹配（防止会话被劫持后直接改密码）。
 *  - newPassword：长度 >= 8，且不能与当前密码相同。
 *
 * 成功后：更新 passwordHash，并把 mustChangePassword 置为 false。
 * auth.ts 的 jwt 回调每次请求都会从 DB 刷新 mustChangePassword，
 * 因此重设完成后的下一次请求即被视为「已重设」，proxy 闸门不再拦截。
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (
    auth.role !== "STUDENT" &&
    !hasRecentAuthentication(auth.authenticatedAt)
  ) {
    return NextResponse.json(
      { error: "高权限账号修改密码前必须重新登录" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
  }
  if (typeof newPassword !== "string") {
    return NextResponse.json({ error: "请输入新密码" }, { status: 400 });
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }

  const ip = getClientIp(req.headers);
  const limit = await checkPasswordChangeLimit(auth.userId, ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "当前密码尝试过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec ?? 900) },
      },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { email: true, passwordHash: true, tokenVersion: true },
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  // Existing hashes may predate the 72-byte policy. Permit their current
  // password only for this authenticated migration path; every new hash below
  // has already passed passwordPolicyError/bcrypt.truncates.
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    const retryAfterSec = await recordPasswordChangeFailure(auth.userId);
    return NextResponse.json(
      { error: "当前密码不正确" },
      {
        status: 400,
        headers:
          retryAfterSec > 0
            ? { "Retry-After": String(retryAfterSec) }
            : undefined,
      },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "新密码不能与当前密码相同" },
      { status: 400 },
    );
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      // 比较并交换：bcrypt 验证后如管理员／教师已重设密码，旧请求不可覆盖新值。
      where: {
        id: auth.userId,
        passwordHash: user.passwordHash,
        tokenVersion: user.tokenVersion,
      },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        // 所有其他浏览器（以及当前浏览器）的旧 JWT 立即失效，防止临时密码外泄后
        // 攻击者持有的 30 天 session 在受害者改密后继续使用。
        tokenVersion: { increment: 1 },
      },
    });
    if (result.count === 1) {
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: auth.userId,
          subjectAccount: user.email,
          eventType: "PASSWORD_CHANGED",
          ip,
        }),
      });
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: auth.userId,
          subjectAccount: user.email,
          eventType: "SESSIONS_REVOKED",
          ip,
          metadata: { reason: "password_changed" },
        }),
      });
    }
    return result.count;
  });
  if (updated !== 1) {
    return NextResponse.json(
      { error: "密码已被其他操作更新，请重新登录后再试" },
      { status: 409 },
    );
  }

  await resetPasswordChangeUserLimit(auth.userId).catch((error) => {
    console.error("[password-change-limiter] reset failed", error);
  });

  return NextResponse.json({ ok: true });
}
