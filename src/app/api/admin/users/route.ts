import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, DEFAULT_ROLE, isRole, type Role } from "@/lib/roles";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

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

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });

    const email = String(body.email ?? "").toLowerCase().trim();
    const password = String(body.password ?? "");
    const name = body.name ? String(body.name).trim() : null;
    const role: Role = isRole(body.role) ? body.role : DEFAULT_ROLE;

    if (!email) return NextResponse.json({ error: "账号不能为空" }, { status: 400 });
    if (password.length < MIN_PASSWORD_LENGTH)
      return NextResponse.json(
        { error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` },
        { status: 400 },
      );
    if (password.length > MAX_PASSWORD_LENGTH)
      return NextResponse.json({ error: "密码过长" }, { status: 400 });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: "该账号已存在" }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    // data 类型由 Prisma.UserCreateInput 自动校验；回传值由 select 自动推断。
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: USER_SELECT,
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
