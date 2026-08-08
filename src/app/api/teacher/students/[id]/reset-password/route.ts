import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

/** 生成密码学安全的随机临时密码（12 位，避开易混淆字符）。 */
function generateTemporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += chars[randomInt(chars.length)];
  }
  return pwd;
}

/**
 * POST /api/teacher/students/[id]/reset-password
 *
 * 老师重置某学生的密码（学生忘记密码场景）。
 * - 不传 newPassword 时自动生成随机临时密码；
 * - 重置后强制该学生下次登录修改密码（mustChangePassword=true）；
 * - tokenVersion +1，使该学生所有旧会话在下一次请求时失效（需重新登录）。
 *
 * 仅允许对 STUDENT 角色操作（老师不能重置老师/管理员的密码）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok)
    return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const { id } = await params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, tokenVersion: true },
    });
    if (!target) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    if (target.role !== ROLES.STUDENT) {
      return NextResponse.json(
        { error: "只能重置学生账号的密码" },
        { status: 403 },
      );
    }

    // 可选：老师手动指定新密码；未提供则生成随机临时密码。
    const body = await req.json().catch(() => null);
    let newPassword: string;
    if (
      body &&
      typeof body.newPassword === "string" &&
      body.newPassword.trim()
    ) {
      newPassword = body.newPassword.trim();
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json(
          { error: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` },
          { status: 400 },
        );
      }
      if (newPassword.length > MAX_PASSWORD_LENGTH) {
        return NextResponse.json({ error: "新密码过长" }, { status: 400 });
      }
    } else {
      newPassword = generateTemporaryPassword();
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.user.updateMany({
      // 把 role 放进写入条件，堵住「检查时仍是学生、hash 期间被升权」的竞态。
      where: {
        id,
        role: ROLES.STUDENT,
        tokenVersion: target.tokenVersion,
      },
      data: {
        passwordHash,
        // 强制下次登录修改密码
        mustChangePassword: true,
        // 版本号 +1 → 旧会话失效（jwt 回调检测到版本不一致即销毁会话）
        tokenVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return NextResponse.json(
        { error: "学生账号已被其他操作更新，请刷新后重试" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, temporaryPassword: newPassword });
  } catch {
    return NextResponse.json({ error: "重置密码失败" }, { status: 500 });
  }
}
