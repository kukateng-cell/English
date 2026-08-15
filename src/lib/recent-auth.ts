import { createHmac, randomBytes } from "node:crypto";
import { getToken } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export const RECENT_AUTH_WINDOW_MS = 15 * 60_000;

function sessionGrantSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXTAUTH_SECRET is required for recent-auth grants");
  }
  return "development-only-recent-auth-secret";
}

export function createSessionJti(): string {
  return randomBytes(16).toString("base64url");
}

export function hashSessionJti(sessionJti: string): string {
  return createHmac("sha256", sessionGrantSecret())
    .update("reauth-v1:")
    .update(sessionJti)
    .digest("hex");
}

export function sessionCookieIsSecure(request?: Request): boolean {
  if (request) {
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      // Fall back to the deployment default for synthetic requests without a
      // parseable absolute URL.
    }
  }
  return process.env.NODE_ENV === "production";
}

export async function getRequestToken(req: Request): Promise<JWT | null> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("NEXTAUTH_SECRET is required for session validation");
  }
  return getToken({
    req: req as unknown as Parameters<typeof getToken>[0]["req"],
    secret: secret ?? "development-only-nextauth-secret",
    secureCookie: sessionCookieIsSecure(req),
  });
}

export async function issueRecentAuthGrant(
  tx: Prisma.TransactionClient,
  input: {
    sessionJti: string;
    userId: string;
    tokenVersion: number;
    credentialRevision: number;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return tx.recentAuthGrant.upsert({
    where: { id: hashSessionJti(input.sessionJti) },
    create: {
      id: hashSessionJti(input.sessionJti),
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      credentialRevision: input.credentialRevision,
      reauthenticatedAt: now,
      expiresAt: new Date(now.getTime() + RECENT_AUTH_WINDOW_MS),
    },
    update: {
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      credentialRevision: input.credentialRevision,
      reauthenticatedAt: now,
      expiresAt: new Date(now.getTime() + RECENT_AUTH_WINDOW_MS),
    },
  });
}

export async function revokeRecentAuthGrants(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.recentAuthGrant.deleteMany({ where: { userId } });
}

export async function hasValidRecentAuthGrant(input: {
  req: Request;
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const token = await getRequestToken(input.req);
  if (!token?.id || token.id !== input.userId || !token.sessionJti) return false;
  const now = input.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { status: true, tokenVersion: true, credentialRevision: true },
  });
  if (!user || user.status !== "ACTIVE") return false;
  if (
    token.tokenVersion !== user.tokenVersion ||
    token.credentialRevision !== user.credentialRevision
  ) {
    return false;
  }
  const grant = await prisma.recentAuthGrant.findUnique({
    where: { id: hashSessionJti(token.sessionJti) },
    select: {
      userId: true,
      tokenVersion: true,
      credentialRevision: true,
      expiresAt: true,
    },
  });
  return Boolean(
    grant &&
      grant.userId === input.userId &&
      grant.tokenVersion === user.tokenVersion &&
      grant.credentialRevision === user.credentialRevision &&
      grant.expiresAt > now,
  );
}
