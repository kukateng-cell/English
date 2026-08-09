import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { passwordPolicyError } from "@/lib/password-policy";
import { getClientIp } from "@/lib/login-limiter";
import {
  hasRecentAuthentication,
  securityEventData,
} from "@/lib/security-events";

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
  if (!hasRecentAuthentication(auth.authenticatedAt)) {
    return NextResponse.json(
      { error: "重置学生密码前必须重新登录" },
      { status: 401 },
    );
  }

  try {
    const { id } = await params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, tokenVersion: true },
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
    } else {
      newPassword = generateTemporaryPassword();
    }
    const policyError = passwordPolicyError(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        // 把 role 放进写入条件，堵住「检查时仍是学生、hash 期间被升权」的竞态。
        where: {
          id,
          role: ROLES.STUDENT,
          tokenVersion: target.tokenVersion,
        },
        data: {
          passwordHash,
          mustChangePassword: true,
          tokenVersion: { increment: 1 },
        },
      });
      if (result.count === 1) {
        await tx.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectUserId: id,
            subjectAccount: target.email,
            eventType: "PASSWORD_RESET_BY_ADMIN",
            ip: getClientIp(req.headers),
            metadata: { actorRole: auth.role },
          }),
        });
        await tx.securityEvent.create({
          data: securityEventData({
            actorUserId: auth.userId,
            subjectUserId: id,
            subjectAccount: target.email,
            eventType: "SESSIONS_REVOKED",
            ip: getClientIp(req.headers),
            metadata: { reason: "teacher_password_reset" },
          }),
        });
        await tx.databaseMetadata.upsert({
          where: { key: `studentTemporaryCredential:${target.email}` },
          create: {
            key: `studentTemporaryCredential:${target.email}`,
            value: "issued-v1",
          },
          update: { value: "issued-v1" },
        });
      }
      return result;
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
