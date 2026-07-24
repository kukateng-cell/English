import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import type { Role } from "@/generated/prisma";

export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { id: string }).id;
}

export async function requireAuth(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export async function getSessionRole(): Promise<Role | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return (session.user as { role: Role }).role;
}

/**
 * 统一的鉴权结果。API 路由可直接判断 ok 并返回 status。
 *  - ok=true：通过，可取 userId / role
 *  - ok=false：未通过，status 为 401(未登录) 或 403(角色不足)，附带 message
 */
export type AuthResult =
  | { ok: true; userId: string; role: Role }
  | { ok: false; status: 401 | 403; message: string };

/** 要求已登录（任意角色）。 */
export async function requireUser(): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role: Role }).role;
  return { ok: true, userId, role };
}

/** 要求登录用户属于指定角色之一（用于管理端 / 教师端 API）。 */
export async function requireRole(...allowed: Role[]): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role: Role }).role;
  if (!allowed.includes(role)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, userId, role };
}

