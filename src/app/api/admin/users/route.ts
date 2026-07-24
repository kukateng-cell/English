import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export async function GET() {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

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
