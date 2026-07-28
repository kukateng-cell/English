import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

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
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json(
      { error: "新密码至少 8 个字符" },
      { status: 400 },
    );
  }
  if (newPassword.length > 128) {
    return NextResponse.json({ error: "新密码过长" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { passwordHash: true },
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
  await prisma.user.update({
    where: { id: auth.userId },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  return NextResponse.json({ ok: true });
}
