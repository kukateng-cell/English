import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

/**
 * 首次登入 / 主动修改密码。
 *
 * 请求体：{ currentPassword: string, newPassword: string }
 *  - currentPassword：必须与库中 hash 匹配（防止会话被劫持后直接改密码）。
 *  - newPassword：长度 >= 8，且不能与当前密码相同。
 *
 * 成功后：更新 passwordHash，并把 mustChangePassword 置为 false。
 * auth.ts 的 jwt 回调每次请求都会从 DB 刷新 mustChangePassword，
 * 因此重设完成后的下一次请求即被视为「已重设」，proxy 闸门不再拦截。
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
  }
  if (
    typeof newPassword !== "string" ||
    newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    return NextResponse.json(
      { error: `新密码至少 ${MIN_PASSWORD_LENGTH} 个字符` },
      { status: 400 },
    );
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "新密码过长" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { passwordHash: true, tokenVersion: true },
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "新密码不能与当前密码相同" },
      { status: 400 },
    );
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const updated = await prisma.user.updateMany({
    // 比较并交换：bcrypt 验证后如管理员／教师已重设密码，旧请求不可覆盖新值。
    where: {
      id: auth.userId,
      passwordHash: user.passwordHash,
      tokenVersion: user.tokenVersion,
    },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
      // 所有其他浏览器（以及当前浏览器）的旧 JWT 立即失效，防止临时密码外泄后
      // 攻击者持有的 30 天 session 在受害者改密后继续使用。
      tokenVersion: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json(
      { error: "密码已被其他操作更新，请重新登录后再试" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
