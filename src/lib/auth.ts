import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";
import {
  checkLimit,
  resetAccount,
  getClientIp,
} from "@/lib/login-limiter";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "account",
      credentials: {
        // ‘email’ 字段实际存放账号名（如 student01），保留键名以兼容 NextAuth 表单
        email: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // 账号由老师统一预先生成（seed），不做自助注册
        const account = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;
        const ip = getClientIp(req?.headers);

        // 登录限流：消费一个令牌；账号 / IP 任一维度耗尽即拒绝。
        // 账号维度防暴力破解；IP 维度防密码喷洒（同 IP 扫一批账号）。
        const limit = await checkLimit(account, ip);
        if (!limit.ok) {
          console.warn(
            `[login-limiter] 拒绝登录尝试 account=${account} ip=${ip} ` +
              `dimension=${limit.dimension} retryAfter=${limit.retryAfterSec}s`,
          );
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email: account } });
        if (!user) {
          // 失败已在 checkLimit 时计入滑动窗口，无需再记一笔。
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          // 失败已在 checkLimit 时计入滑动窗口，无需再记一笔。
          return null;
        }

        // 登录成功：清空该账号维度的计数（IP 维度继续累积）。
        await resetAccount(account);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tokenVersion: user.tokenVersion,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // 会话有效期 30 天：登录一次后保持登录，直到主动退出或过期。
    maxAge: 30 * 24 * 60 * 60,
  },
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
        token.mustChangePassword = user.mustChangePassword as boolean;
        return token;
      }

      // 后续请求：user 不存在（只在登录时传入）。
      // 用 token.id 查库校验会话是否仍有效：
      //   - 用户已被删除（dbUser 不存在）→ 旧会话失效；
      //   - tokenVersion 已变化（管理员改角色 / 重置密码）→ 旧会话失效，需重新登录。
      // 实现：jwt 回调抛错会让 NextAuth 的 session 处理清除会话 cookie
      // （见 node_modules/next-auth/core/routes/session.js 的 catch 分支），
      // 前端 useSession / 服务端 getServerSession 随之视为未登录。
      const userId = token.id as string | undefined;
      if (userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, tokenVersion: true, mustChangePassword: true },
        });
        if (!dbUser) {
          // 用户已被删除 → 会话失效。
          throw new Error("SESSION_INVALIDATED");
        }
        if (dbUser.tokenVersion !== token.tokenVersion) {
          // 版本号变化（改角色 / 重置密码）→ 旧会话失效，需重新登录。
          throw new Error("SESSION_INVALIDATED");
        }
        // mustChangePassword 可能被用户自己（重设密码）或管理员修改，
        // 每次都从 DB 刷新，确保重设密码后立即生效。
        token.mustChangePassword = dbUser.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role: Role }).role = token.role as Role;
        (session.user as { mustChangePassword: boolean }).mustChangePassword =
          token.mustChangePassword as boolean;
      }
      return session;
    },
  },
};
