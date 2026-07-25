import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, isRole, type Role } from "@/lib/roles";

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

    // 防止管理员把自己降级 / 锁死自己（避免失去唯一管理员）
    if (id === auth.userId) {
      if (body.role && body.role !== ROLES.ADMIN) {
        return NextResponse.json(
          { error: "不能修改自己的管理员角色" },
          { status: 400 }
        );
      }
    }

    const data: {
      name?: string | null;
      role?: Role;
      passwordHash?: string;
      tokenVersion?: { increment: number };
    } = {};

    if (typeof body.name === "string") data.name = body.name.trim() || null;
    if (body.role) {
      if (!isRole(body.role)) {
        return NextResponse.json({ error: "角色无效" }, { status: 400 });
      }
      data.role = body.role;
      // 角色变更 → 令牌版本号 +1，使该用户下一次请求时 jwt 回调刷新缓存的角色。
      // 这样管理员改完角色，对方无需重新登录即可被新角色拦截（实时生效）。
      data.tokenVersion = { increment: 1 };
    }
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
      }
      data.passwordHash = await bcrypt.hash(body.password, 12);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
    }

    const user = (await prisma.user.update({
      where: { id },
      data: data as unknown as Prisma.UserUpdateInput,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { reviews: true } },
      } as unknown as Prisma.UserSelect,
    })) as unknown as {
      id: string;
      email: string;
      name: string | null;
      role: string;
      createdAt: Date;
      _count: { reviews: number };
    };

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      totalReviews: user._count.reviews,
      createdAt: user.createdAt.toISOString(),
    });
  } catch {
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

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
