import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { ROLES } from "@/lib/roles";

// 临时 API：创建 admin 和 teacher 账号
// GET /api/seed-roles
export async function GET() {
  try {
    // Bootstrap 守卫：仅当系统尚无任何管理员时才允许创建，
    // 避免该公开端点被反复滥用批量建管理员。首次部署后即被自动禁用。
    const adminCount = await prisma.user.count({ where: { role: ROLES.ADMIN } });
    if (adminCount > 0) {
      return NextResponse.json(
        { error: "已存在管理员，初始化接口已禁用。请联系现有管理员创建账号。" },
        { status: 403 },
      );
    }
    const hash = await bcrypt.hash("admin123", 12);

    let admin = await prisma.user.findUnique({ where: { email: "admin" } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: "admin", passwordHash: hash, name: "管理员", role: ROLES.ADMIN },
      });
    } else if (admin.role !== ROLES.ADMIN) {
      admin = await prisma.user.update({ where: { id: admin.id }, data: { role: ROLES.ADMIN } });
    }

    let teacher = await prisma.user.findUnique({ where: { email: "teacher" } });
    if (!teacher) {
      teacher = await prisma.user.create({
        data: { email: "teacher", passwordHash: hash, name: "王老师", role: ROLES.TEACHER },
      });
    } else if (teacher.role !== ROLES.TEACHER) {
      teacher = await prisma.user.update({ where: { id: teacher.id }, data: { role: ROLES.TEACHER } });
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
