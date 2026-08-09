import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, isRole } from "@/lib/roles";
import { passwordPolicyError } from "@/lib/password-policy";
import { getClientIp } from "@/lib/login-limiter";
import {
  hasRecentAuthentication,
  securityEventData,
} from "@/lib/security-events";
import {
  isRetryableTransactionConflict,
  waitForTransactionRetry,
} from "@/lib/transaction-retry";

class LastAdminError extends Error {}
class UserNotFoundError extends Error {}
class ConcurrentUserUpdateError extends Error {}

async function runSerializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt === 4) throw error;
      await waitForTransactionRetry(attempt - 1);
    }
  }
  throw new Error("Transaction retry exhausted");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  let attemptedTarget: { id: string; email: string } | null = null;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    const target = await prisma.user.findUnique({
      where: { id },
      select: { email: true, role: true, tokenVersion: true },
    });
    if (!target) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    attemptedTarget = { id, email: target.email };

    // 防止管理员把自己降级 / 锁死自己（避免失去唯一管理员）
    if (id === auth.userId) {
      if (body.role && body.role !== ROLES.ADMIN) {
        return NextResponse.json(
          { error: "不能修改自己的管理员角色" },
          { status: 400 }
        );
      }
      if (typeof body.password === "string" && body.password.length > 0) {
        return NextResponse.json(
          { error: "管理员修改自己的密码必须使用修改密码页面" },
          { status: 400 },
        );
      }
    }

    const passwordRequested =
      typeof body.password === "string" && body.password.length > 0;
    const roleChangeRequested =
      body.role !== undefined && body.role !== target.role;
    const securitySensitiveUpdate =
      passwordRequested || roleChangeRequested;
    if (
      securitySensitiveUpdate &&
      !hasRecentAuthentication(auth.authenticatedAt)
    ) {
      return NextResponse.json(
        { error: "敏感管理员操作前必须重新登录" },
        { status: 401 },
      );
    }

    // 以 Prisma.UserUpdateInput 为目标类型累积字段，让 TypeScript 校验字段名与类型。
    const data: Prisma.UserUpdateInput = {};

    if (typeof body.name === "string") data.name = body.name.trim() || null;
    if (body.role) {
      if (!isRole(body.role)) {
        return NextResponse.json({ error: "角色无效" }, { status: 400 });
      }
      if (body.role !== target.role) {
        data.role = body.role;
        // 只有实际角色变更才撤销 session；编辑姓名时重传相同 role 不应把用户踢下线。
        data.tokenVersion = { increment: 1 };
      }
    }
    if (passwordRequested) {
      const policyError = passwordPolicyError(body.password);
      if (policyError) {
        return NextResponse.json({ error: policyError }, { status: 400 });
      }
      data.passwordHash = await bcrypt.hash(body.password, 12);
      data.tokenVersion = { increment: 1 };
      if (id !== auth.userId) {
        // 重置他人密码：强制对方下次登录修改，并让旧会话失效（tokenVersion+1）。
        data.mustChangePassword = true;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
    }
    const ip = getClientIp(req.headers);

    // data 类型由 Prisma 校验；select 与回传值类型由 Prisma 自动推断，无需任何强转。
    const user = await runSerializable(async (tx) => {
      const freshTarget = await tx.user.findUnique({
        where: { id },
        select: { email: true, role: true, tokenVersion: true },
      });
      if (!freshTarget) throw new UserNotFoundError();
      if (
        securitySensitiveUpdate &&
        freshTarget.tokenVersion !== target.tokenVersion
      ) {
        throw new ConcurrentUserUpdateError();
      }
      if (
        freshTarget.role === ROLES.ADMIN &&
        data.role !== undefined &&
        data.role !== ROLES.ADMIN
      ) {
        const adminCount = await tx.user.count({
          where: { role: ROLES.ADMIN },
        });
        if (adminCount <= 1) throw new LastAdminError();
      }
      const updated = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          _count: { select: { reviewEvents: true } },
        },
      });
      if (passwordRequested) {
        await tx.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectUserId: id,
            subjectAccount: freshTarget.email,
            eventType: "PASSWORD_RESET_BY_ADMIN",
            ip,
          }),
        });
      }
      if (roleChangeRequested && isRole(body.role)) {
        await tx.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectUserId: id,
            subjectAccount: freshTarget.email,
            eventType: "ROLE_CHANGED",
            ip,
            metadata: { from: freshTarget.role, to: body.role },
          }),
        });
      }
      if (securitySensitiveUpdate) {
        await tx.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectUserId: id,
            subjectAccount: freshTarget.email,
            eventType: "SESSIONS_REVOKED",
            ip,
            metadata: { reason: "admin_user_update" },
          }),
        });
      }
      if (passwordRequested && freshTarget.role === ROLES.STUDENT) {
        await tx.databaseMetadata.upsert({
          where: {
            key: `studentTemporaryCredential:${freshTarget.email}`,
          },
          create: {
            key: `studentTemporaryCredential:${freshTarget.email}`,
            value: "issued-v1",
          },
          update: { value: "issued-v1" },
        });
      }
      return updated;
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      totalReviews: user._count.reviewEvents,
      createdAt: user.createdAt.toISOString(),
      sessionInvalidated:
        id === auth.userId &&
        typeof body.password === "string" &&
        body.password.length > 0,
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      if (attemptedTarget) {
        await prisma.securityEvent.create({
            data: securityEventData({
              actorUserId: auth.userId,
              subjectStableId: attemptedTarget.id,
              subjectAccount: attemptedTarget.email,
            eventType: "LAST_ADMIN_PROTECTION_TRIGGERED",
            ip: getClientIp(req.headers),
            metadata: { action: "role_change" },
          }),
        });
      }
      return NextResponse.json(
        { error: "系统必须保留至少一名管理员" },
        { status: 409 },
      );
    }
    if (error instanceof UserNotFoundError) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    if (error instanceof ConcurrentUserUpdateError) {
      return NextResponse.json(
        { error: "用户账号已被其他操作更新，请刷新后重试" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "更新用户失败" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  if (!hasRecentAuthentication(auth.authenticatedAt)) {
    return NextResponse.json(
      { error: "删除用户前必须重新登录" },
      { status: 401 },
    );
  }
  let attemptedTarget: { id: string; email: string } | null = null;
  try {
    const { id } = await params;

    if (id === auth.userId) {
      return NextResponse.json(
        { error: "不能删除自己" },
        { status: 400 }
      );
    }
    attemptedTarget = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!attemptedTarget) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    await runSerializable(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { email: true, role: true },
      });
      if (!target) return;
      if (target.role === ROLES.ADMIN) {
        const adminCount = await tx.user.count({ where: { role: ROLES.ADMIN } });
        if (adminCount <= 1) throw new LastAdminError();
      }
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: id,
          subjectAccount: target.email,
          eventType: "USER_DELETED",
          ip: getClientIp(req.headers),
          metadata: { role: target.role },
        }),
      });
      await tx.user.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LastAdminError) {
      if (attemptedTarget !== null) {
        await prisma.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectStableId: attemptedTarget.id,
            subjectAccount: attemptedTarget.email,
            eventType: "LAST_ADMIN_PROTECTION_TRIGGERED",
            ip: getClientIp(req.headers),
            metadata: { action: "delete" },
          }),
        });
      }
      return NextResponse.json(
        { error: "系统必须保留至少一名管理员" },
        { status: 409 },
      );
    }
    if (error instanceof UserNotFoundError) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
