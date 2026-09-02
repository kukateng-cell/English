import { getServerSession, type Session } from "next-auth";
import { authOptions } from "./auth";
import type { Role } from "@/generated/prisma";

type SessionReader = () => Promise<Session | null>;

export type SafeSessionResult =
  | { ok: true; session: Session }
  | { ok: false; status: 401 | 503; message: string };

/**
 * Keep every server-side session consumer on one failure contract. Invalidated
 * cookies are ordinary unauthenticated requests; database/auth backend errors
 * fail closed without escaping route handlers as an unhandled 500.
 */
export async function readSessionSafely(
  readSession: SessionReader = () => getServerSession(authOptions),
): Promise<SafeSessionResult> {
  let session: Session | null;
  try {
    session = await readSession();
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_INVALIDATED") {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    console.error("[auth] session check unavailable", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      status: 503,
      message: "認證服務暫時不可用，請稍後重試",
    };
  }
  if (!session?.user) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  if (session.user.authUnavailable) {
    return {
      ok: false,
      status: 503,
      message: "認證服務暫時不可用，請稍後重試",
    };
  }
  return { ok: true, session };
}

export interface CurrentUser {
  id: string;
  role: Role;
  accountName: string;
  displayName: string;
  /** Compatibility aliases for existing shell props during the roster migration. */
  name: string | null;
  email: string;
}

export type CurrentUserResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 503 };

/**
 * 取得當前登入使用者的 { id, role }，供 RSC / Layout 的「服務端角色守衛」使用。
 *
 * 回傳 null 表示未登入；否則回傳最新角色。注意：此處走 getServerSession，
 * 會觸發 auth.ts 的 jwt callback 重新查庫（與 getToken 的純 JWT 解碼不同），
 * 因此角色一定是最新的——即便管理員剛改過角色，也能即時攔下越權訪問。
 * 適合做為 proxy.ts（快取角色）之後的第二道防線。
 */
export async function getCurrentUser(
  readSession?: SessionReader,
): Promise<CurrentUserResult> {
  const result = await readSessionSafely(readSession);
  if (!result.ok) {
    return { ok: false, status: result.status };
  }
  const { session } = result;
  return {
    ok: true,
    user: {
      id: (session.user as { id: string }).id,
      role: (session.user as { role: Role }).role,
      accountName: session.user.accountName,
      displayName: session.user.displayName,
      name: session.user.displayName ?? null,
      email: session.user.accountName,
    },
  };
}

/**
 * 统一的鉴权结果。API 路由可直接判断 ok 并返回 status。
 *  - ok=true：通过，可取 userId / role
 *  - ok=false：未通过，status 为 401(未登录) 或 403(角色不足)，附带 message
 */
export type AuthResult =
  | { ok: true; userId: string; role: Role; authenticatedAt?: number }
  | { ok: false; status: 401 | 403 | 503; message: string };

/** 要求已登录（任意角色）。 */
export async function requireUser(): Promise<AuthResult> {
  const result = await readSessionSafely();
  if (!result.ok) return result;
  const { session } = result;
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role: Role }).role;
  return {
    ok: true,
    userId,
    role,
    authenticatedAt: session.user.authenticatedAt,
  };
}

/** 要求登录用户属于指定角色之一（用于管理端 / 教师端 API）。 */
export async function requireRole(...allowed: Role[]): Promise<AuthResult> {
  const result = await readSessionSafely();
  if (!result.ok) return result;
  const { session } = result;
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role: Role }).role;
  if (!allowed.includes(role)) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return {
    ok: true,
    userId,
    role,
    authenticatedAt: session.user.authenticatedAt,
  };
}
