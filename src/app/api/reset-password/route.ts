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
import { securityEventData } from "@/lib/security-events";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { replacePasswordCredential, BCRYPT_COST } from "@/lib/password-credentials";
import { isSameOriginMutation } from "@/lib/csrf";

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
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  }
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (
    auth.role !== "STUDENT" &&
    !(await hasValidRecentAuthGrant({ req, userId: auth.userId }))
  ) {
    return NextResponse.json(
      { error: "高權限帳號修改密碼前必須重新登入" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "請求體格式錯誤" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "請輸入目前密碼" }, { status: 400 });
  }
  if (typeof newPassword !== "string") {
    return NextResponse.json({ error: "請輸入新密碼" }, { status: 400 });
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }

  const ip = getClientIp(req.headers);
  const limit = await checkPasswordChangeLimit(auth.userId, ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "目前密碼嘗試過於頻繁，請稍後再試" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec ?? 900) },
      },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { accountName: true, passwordHash: true, tokenVersion: true, credentialRevision: true },
  });
  if (!user) {
    return NextResponse.json({ error: "用戶不存在" }, { status: 404 });
  }

  // Existing hashes may predate the 72-byte policy. Permit their current
  // password only for this authenticated migration path; every new hash below
  // has already passed passwordPolicyError/bcrypt.truncates.
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    const retryAfterSec = await recordPasswordChangeFailure(auth.userId);
    return NextResponse.json(
      { error: "目前密碼不正確" },
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
      { error: "新密碼不能與目前密碼相同" },
      { status: 400 },
    );
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await replacePasswordCredential(tx, {
      userId: auth.userId,
      passwordHash: newHash,
      mustChangePassword: false,
      expectedTokenVersion: user.tokenVersion,
      expectedCredentialRevision: user.credentialRevision,
    });
    if (result) {
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: auth.userId,
          subjectAccount: user.accountName,
          eventType: "PASSWORD_CHANGED",
          ip,
        }),
      });
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: auth.userId,
          subjectAccount: user.accountName,
          eventType: "SESSIONS_REVOKED",
          ip,
          metadata: { reason: "password_changed" },
        }),
      });
    }
    return result ? 1 : 0;
  });
  if (updated !== 1) {
    return NextResponse.json(
      { error: "密碼已被其他操作更新，請重新登入後再試" },
      { status: 409 },
    );
  }

  await resetPasswordChangeUserLimit(auth.userId).catch((error) => {
    console.error("[password-change-limiter] reset failed", error);
  });

  return NextResponse.json({ ok: true });
}
