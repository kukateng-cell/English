// NextAuth 类型扩展：把 role 带进 Session 与 JWT，
// 让前后端都能通过 session.user.role / token.role 读取用户角色。
import "next-auth";
import type { Role } from "@/generated/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      accountName: string;
      displayName: string;
      role: Role;
      // 首次登入強制改密碼标记：true 时前端需引导用户到 /reset-password。
      mustChangePassword?: boolean;
      authenticatedAt?: number;
      authUnavailable?: boolean;
    };
  }

  interface User {
    accountName?: string;
    displayName?: string;
    role?: Role;
    tokenVersion?: number;
    mustChangePassword?: boolean;
    credentialRevision?: number;
    sessionJti?: string;
    authenticatedAt?: number;
    authUnavailable?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    accountName?: string;
    displayName?: string;
    role?: Role;
    // 登录时写入的“角色令牌版本快照”，用于和数据库里的最新版本对比，
    // 不一致即说明角色已被管理员修改，需要刷新 token.role（实时生效机制）。
    tokenVersion?: number;
    // 首次登入強制改密碼标记：每次请求都从 DB 刷新，重设后立即生效。
    mustChangePassword?: boolean;
    credentialRevision?: number;
    sessionJti?: string;
    authenticatedAt?: number;
    authUnavailable?: boolean;
  }
}
