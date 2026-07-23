import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// 临时 API：创建 admin 和 teacher 账号
// GET /api/seed-roles
export async function GET() {
  try {
    const hash = await bcrypt.hash("admin123", 12);

    let admin = await prisma.user.findUnique({ where: { email: "admin" } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: "admin", passwordHash: hash, name: "管理员", role: "ADMIN" },
      });
    } else if (admin.role !== "ADMIN") {
      admin = await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    }

    let teacher = await prisma.user.findUnique({ where: { email: "teacher" } });
    if (!teacher) {
      teacher = await prisma.user.create({
        data: { email: "teacher", passwordHash: hash, name: "王老师", role: "TEACHER" },
      });
    } else if (teacher.role !== "TEACHER") {
      teacher = await prisma.user.update({ where: { id: teacher.id }, data: { role: "TEACHER" } });
    }

    return NextResponse.json({
      ok: true,
      admin: { email: "admin", password: "admin123" },
      teacher: { email: "teacher", password: "admin123" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
