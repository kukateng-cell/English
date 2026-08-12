import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";
import {
  checkLimit,
  resetAccount,
  getClientIp,
} from "@/lib/login-limiter";

/**
 * Revalidate the account-bound claims used by protected routes. Keeping this
 * boundary callable outside the NextAuth callback makes token-version
 * revocation testable without fabricating a login event.
 */
export async function validateAuthTokenVersion(token: JWT): Promise<JWT> {
  const userId = token.id as string | undefined;
  if (!userId) return token;

  // Session validity is a security decision: a transient DB failure keeps the
  // cookie but marks it unavailable so protected APIs fail closed with 503.
  let dbUser;
  try {
    dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, tokenVersion: true, mustChangePassword: true },
    });
  } catch (error) {
    console.error("[auth] session validation database unavailable", error);
    token.authUnavailable = true;
    return token;
  }
  if (!dbUser) throw new Error("SESSION_INVALIDATED");
  if (dbUser.tokenVersion !== token.tokenVersion || dbUser.role !== token.role) {
    throw new Error("SESSION_INVALIDATED");
  }
  token.mustChangePassword = dbUser.mustChangePassword;
  token.authUnavailable = false;
  return token;
}

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
        token.authenticatedAt = Date.now();
        token.authUnavailable = false;
        return token;
      }

      // 后续请求：user 不存在（只在登录时传入）。JWT callback 抛出
      // SESSION_INVALIDATED 时，NextAuth 会清除失效 session cookie。
      return validateAuthTokenVersion(token);
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role: Role }).role = token.role as Role;
        (session.user as { mustChangePassword: boolean }).mustChangePassword =
          token.mustChangePassword as boolean;
        (session.user as { authenticatedAt?: number }).authenticatedAt =
          token.authenticatedAt as number | undefined;
        (session.user as { authUnavailable?: boolean }).authUnavailable =
          token.authUnavailable === true;
      }
      return session;
    },
  },
};
