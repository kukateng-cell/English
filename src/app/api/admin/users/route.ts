import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, isRole, type Role } from "@/lib/roles";
import { passwordPolicyError } from "@/lib/password-policy";
import { getClientIp } from "@/lib/login-limiter";
import {
  hasRecentAuthentication,
  securityEventData,
} from "@/lib/security-events";

/**
 * 用户查询统一用到的字段。给 select 显式声明 Prisma.UserSelect 类型，
 * 既得到字段补全，又让 Prisma 据此精确推断回传值类型（无需再写 UserRow）。
 */
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  _count: { select: { reviewEvents: true } },
} satisfies Prisma.UserSelect;

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const users = await prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        totalReviews: u._count.reviewEvents,
        createdAt: u.createdAt.toISOString(),
      }))
    );
  } catch {
    return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  if (!hasRecentAuthentication(auth.authenticatedAt)) {
    return NextResponse.json(
      { error: "创建用户前必须重新登录" },
      { status: 401 },
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

    const email = String(body.email ?? "").toLowerCase().trim();
    const password = String(body.password ?? "");
    const name = body.name ? String(body.name).trim() : null;
    if (!isRole(body.role)) {
      return NextResponse.json({ error: "角色无效" }, { status: 400 });
    }
    const role: Role = body.role;

    if (!email) return NextResponse.json({ error: "账号不能为空" }, { status: 400 });
    const policyError = passwordPolicyError(password);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: "该账号已存在" }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    // data 类型由 Prisma.UserCreateInput 自动校验；回传值由 select 自动推断。
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          role,
          mustChangePassword: role === ROLES.STUDENT,
        },
        select: USER_SELECT,
      });
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: created.id,
          subjectAccount: created.email,
          eventType: "USER_CREATED",
          ip: getClientIp(req.headers),
          metadata: { role: created.role },
        }),
      });
      return created;
    });

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        totalReviews: user._count.reviewEvents,
        createdAt: user.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "该账号已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}
