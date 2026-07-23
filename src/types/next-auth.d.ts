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
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
  }
}
