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
import { roleDisplayName } from "@/lib/identity";
import {
  createSessionJti,
  hashSessionJti,
  issueRecentAuthGrant,
} from "@/lib/recent-auth";

type AuthValidationUser = {
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  tokenVersion: number;
  credentialRevision: number;
  mustChangePassword: boolean;
  accountName: string;
  legacyName: string | null;
  studentProfile: { nickname: string } | null;
  teacherProfile: { legalName: string } | null;
};

export type AuthValidationStore = {
  findUser(userId: string): Promise<AuthValidationUser | null>;
  findCurrentStudentEnrollment(userId: string): Promise<{ id: string } | null>;
};

const authValidationStore: AuthValidationStore = {
  findUser: (userId) => prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      tokenVersion: true,
      credentialRevision: true,
      mustChangePassword: true,
      accountName: true,
      legacyName: true,
      studentProfile: { select: { nickname: true } },
      teacherProfile: { select: { legalName: true } },
    },
  }),
  findCurrentStudentEnrollment: (userId) => prisma.studentEnrollment.findFirst({
    where: { studentId: userId, status: "ACTIVE", academicYear: { status: "CURRENT" } },
    select: { id: true },
  }),
};

/**
 * Revalidate the account-bound claims used by protected routes. Keeping this
 * boundary callable outside the NextAuth callback makes token-version
 * revocation testable without fabricating a login event.
 */
export async function validateAuthTokenVersion(
  token: JWT,
  store: AuthValidationStore = authValidationStore,
): Promise<JWT> {
  const userId = token.id as string | undefined;
  if (!userId) return token;

  // Session validity is a security decision: a transient DB failure keeps the
  // cookie but marks it unavailable so protected APIs fail closed with 503.
  let dbUser: AuthValidationUser | null;
  let currentEnrollment: { id: string } | null = null;
  try {
    dbUser = await store.findUser(userId);
    if (dbUser?.role === "STUDENT") {
      currentEnrollment = await store.findCurrentStudentEnrollment(userId);
    }
  } catch (error) {
    console.error("[auth] session validation database unavailable", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    token.authUnavailable = true;
    return token;
  }
  if (!dbUser) throw new Error("SESSION_INVALIDATED");
  if (dbUser.status !== "ACTIVE") throw new Error("SESSION_INVALIDATED");
  if (dbUser.role === "STUDENT" && !currentEnrollment) throw new Error("SESSION_INVALIDATED");
  if (dbUser.tokenVersion !== token.tokenVersion || dbUser.role !== token.role) {
    throw new Error("SESSION_INVALIDATED");
  }
  if (
    !token.sessionJti ||
    dbUser.credentialRevision !== token.credentialRevision
  ) {
    throw new Error("SESSION_INVALIDATED");
  }
  const displayName = roleDisplayName(dbUser);
  token.accountName = dbUser.accountName;
  token.displayName = displayName;
  token.name = displayName;
  token.email = dbUser.accountName;
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
        email: { label: "帳號", type: "text" },
        password: { label: "密碼", type: "password" },
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
            `[login-limiter] 拒絕登入嘗試 account=${account} ip=${ip} ` +
              `dimension=${limit.dimension} retryAfter=${limit.retryAfterSec}s`,
          );
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { accountName: account },
          include: {
            studentProfile: { select: { nickname: true } },
            teacherProfile: { select: { legalName: true } },
          },
        });
        if (!user || user.status !== "ACTIVE") {
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
        if (user.role === "STUDENT") {
          const currentEnrollment = await prisma.studentEnrollment.findFirst({
            where: {
              studentId: user.id,
              status: "ACTIVE",
              academicYear: { status: "CURRENT" },
            },
            select: { id: true },
          });
          if (!currentEnrollment) return null;
        }
        const sessionJti = createSessionJti();
        try {
          await prisma.$transaction((tx) =>
            issueRecentAuthGrant(tx, {
              sessionJti,
              userId: user.id,
              tokenVersion: user.tokenVersion,
              credentialRevision: user.credentialRevision,
            }),
          );
        } catch (error) {
          console.error("[auth] recent-auth grant creation failed", error);
          return null;
        }
        const displayName = roleDisplayName(user);
        return {
          id: user.id,
          email: user.accountName,
          name: displayName,
          accountName: user.accountName,
          displayName,
          role: user.role,
          tokenVersion: user.tokenVersion,
          credentialRevision: user.credentialRevision,
          sessionJti,
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
        token.credentialRevision = user.credentialRevision as number;
        token.sessionJti = user.sessionJti as string;
        token.mustChangePassword = user.mustChangePassword as boolean;
        token.accountName = user.accountName as string;
        token.displayName = user.displayName as string;
        token.name = user.displayName as string;
        token.email = user.accountName as string;
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
        session.user.accountName = token.accountName as string;
        session.user.displayName = token.displayName as string;
        session.user.name = token.displayName as string;
        session.user.email = token.accountName as string;
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
  events: {
    async signOut({ token }) {
      if (!token?.sessionJti) return;
      try {
        await prisma.recentAuthGrant.delete({
          where: { id: hashSessionJti(token.sessionJti) },
        });
      } catch {
        // Logout is best effort; token expiry and revision revocation remain
        // authoritative even when the cleanup write is unavailable.
      }
    },
  },
};
