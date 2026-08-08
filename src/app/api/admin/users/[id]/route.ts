import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, isRole } from "@/lib/roles";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

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
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === 4) throw error;
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

  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, tokenVersion: true },
    });
    if (!target) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // 防止管理员把自己降级 / 锁死自己（避免失去唯一管理员）
    if (id === auth.userId) {
      if (body.role && body.role !== ROLES.ADMIN) {
        return NextResponse.json(
          { error: "不能修改自己的管理员角色" },
          { status: 400 }
        );
      }
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
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` },
          { status: 400 },
        );
      }
      if (body.password.length > MAX_PASSWORD_LENGTH) {
        return NextResponse.json({ error: "密码过长" }, { status: 400 });
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
    const securitySensitiveUpdate =
      (typeof body.password === "string" && body.password.length > 0) ||
      (body.role !== undefined && body.role !== target.role);

    // data 类型由 Prisma 校验；select 与回传值类型由 Prisma 自动推断，无需任何强转。
    const user = await runSerializable(async (tx) => {
      const freshTarget = await tx.user.findUnique({
        where: { id },
        select: { role: true, tokenVersion: true },
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
      return tx.user.update({
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const { id } = await params;

    if (id === auth.userId) {
      return NextResponse.json(
        { error: "不能删除自己" },
        { status: 400 }
      );
    }

    await runSerializable(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { role: true },
      });
      if (!target) return;
      if (target.role === ROLES.ADMIN) {
        const adminCount = await tx.user.count({ where: { role: ROLES.ADMIN } });
        if (adminCount <= 1) throw new LastAdminError();
      }
      await tx.user.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return NextResponse.json(
        { error: "系统必须保留至少一名管理员" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
