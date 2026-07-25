import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, DEFAULT_ROLE, isRole, type Role } from "@/lib/roles";

/** 用户查询返回的结构（role / _count 在 Postgres schema 存在，SQLite 预览 schema 不存在）。 */
type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
  _count: { reviews: number };
};

// role / _count 在 SQLite 预览版生成的 client 中不存在；用 unknown cast 适配两种 schema。
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  _count: { select: { reviews: true } },
} as unknown as Prisma.UserSelect;

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const users = (await prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
    })) as unknown as UserRow[];

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        totalReviews: u._count.reviews,
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
    if (password.length < 6)
      return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ error: "该账号已存在" }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = (await prisma.user.create({
      // role 字段在 Postgres schema 存在、SQLite 预览 schema 不存在；用 unknown cast 适配两者。
      data: { email, passwordHash, name, role } as unknown as Prisma.UserCreateInput,
      select: USER_SELECT,
    })) as unknown as UserRow;

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        totalReviews: user._count.reviews,
        createdAt: user.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}
