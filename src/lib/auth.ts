import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import type { Role } from "@/generated/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "account",
      credentials: {
        // ‘email’ 字段实际存放账号名（如 student01），保留键名以兼容 NextAuth 表单
        email: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // 账号由老师统一预先生成（seed），不做自助注册
        const account = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({ where: { email: account } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  // 禁用详细错误日志，避免 CLIENT_FETCH_ERROR
  debug: false,
  logger: {
    error: () => {},
    warn: () => {},
    debug: () => {},
  },
  callbacks: {
    async jwt({ token, user }) {
      // 初次登录：user 存在，把角色与令牌版本快照写进 JWT。
      if (user) {
        token.id = user.id;
        token.role = user.role as Role;
        token.tokenVersion = user.tokenVersion as number;
        return token;
      }

      // 后续请求：user 不存在（只在登录时传入）。
      // 用 token.id 查库里的最新角色 / 版本号，实现“管理员改角色后实时生效”。
      // （NextAuth v4 JWT 模式的固有限制：角色缓存在 JWT 里，否则只能等重新登录。）
      const userId = token.id as string | undefined;
      if (userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, tokenVersion: true },
        });
        if (!dbUser) {
          // 用户已被删除：把角色降级为默认，使其被角色守卫拦下。
          token.role = ROLES.STUDENT;
          token.tokenVersion = undefined;
        } else if (dbUser.tokenVersion !== token.tokenVersion) {
          // 版本号变化 → 管理员改过角色，刷新快照。
          token.role = dbUser.role;
          token.tokenVersion = dbUser.tokenVersion;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role: Role }).role = token.role as Role;
      }
      return session;
    },
  },
};
