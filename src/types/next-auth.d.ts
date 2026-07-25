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
      role: Role;
    };
  }

  interface User {
    role?: Role;
    tokenVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    // 登录时写入的“角色令牌版本快照”，用于和数据库里的最新版本对比，
    // 不一致即说明角色已被管理员修改，需要刷新 token.role（实时生效机制）。
    tokenVersion?: number;
  }
}
