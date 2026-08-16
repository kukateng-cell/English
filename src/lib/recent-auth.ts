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
  const grantId = hashSessionJti(input.sessionJti);

  // All grant writers use the same lock order as sensitive roster/password
  // mutations: User → exact RecentAuthGrant → audit.  Locking the actor first
  // also serializes two same-session reauth requests, so a retry can never
  // write the same generation timestamp.
  // Prisma's findUnique does not expose FOR UPDATE; the raw lock below is
  // deliberately kept immediately before the authoritative read.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
  const fresh = await tx.user.findUnique({
    where: { id: input.userId },
    select: { status: true, tokenVersion: true, credentialRevision: true },
  });
  if (!fresh || fresh.status !== "ACTIVE" || fresh.tokenVersion !== input.tokenVersion || fresh.credentialRevision !== input.credentialRevision) {
    throw new Error("RECENT_AUTH_STALE");
  }

  const existing = await tx.recentAuthGrant.findUnique({
    where: { id: grantId },
    select: { reauthenticatedAt: true },
  });
  const nextTimestamp = new Date(Math.max(
    now.getTime(),
    (existing?.reauthenticatedAt.getTime() ?? Number.NEGATIVE_INFINITY) + 1,
  ));
  return tx.recentAuthGrant.upsert({
    where: { id: grantId },
    create: {
      id: grantId,
      userId: input.userId,
      tokenVersion: fresh.tokenVersion,
      credentialRevision: fresh.credentialRevision,
      reauthenticatedAt: nextTimestamp,
      expiresAt: new Date(nextTimestamp.getTime() + RECENT_AUTH_WINDOW_MS),
    },
    update: {
      userId: input.userId,
      tokenVersion: fresh.tokenVersion,
      credentialRevision: fresh.credentialRevision,
      reauthenticatedAt: nextTimestamp,
      expiresAt: new Date(nextTimestamp.getTime() + RECENT_AUTH_WINDOW_MS),
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

/**
 * Return the exact session-bound grant snapshot used by sensitive prepare
 * flows. Callers must bind every field returned here into their precondition
 * and re-check it inside the final transaction.
 */
export async function readRecentAuthGrantSnapshot(input: {
  req: Request;
  userId: string;
  now?: Date;
}) {
  const token = await getRequestToken(input.req);
  if (!token?.id || token.id !== input.userId || !token.sessionJti) return null;
  const now = input.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      status: true,
      tokenVersion: true,
      credentialRevision: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (
    token.tokenVersion !== user.tokenVersion ||
    token.credentialRevision !== user.credentialRevision
  ) return null;
  const grant = await prisma.recentAuthGrant.findUnique({
    where: { id: hashSessionJti(token.sessionJti) },
    select: {
      userId: true,
      tokenVersion: true,
      credentialRevision: true,
      reauthenticatedAt: true,
      expiresAt: true,
    },
  });
  if (
    !grant ||
    grant.userId !== user.id ||
    grant.tokenVersion !== user.tokenVersion ||
    grant.credentialRevision !== user.credentialRevision ||
    grant.expiresAt <= now
  ) return null;
  return {
    token,
    user,
    sessionJti: token.sessionJti,
    grant: {
      reauthenticatedAt: grant.reauthenticatedAt,
      expiresAt: grant.expiresAt,
    },
  };
}

export async function readRecentAuthGrantForSession(input: {
  userId: string;
  sessionJti: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, status: true, tokenVersion: true, credentialRevision: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  const grant = await prisma.recentAuthGrant.findUnique({
    where: { id: hashSessionJti(input.sessionJti) },
    select: { userId: true, tokenVersion: true, credentialRevision: true, reauthenticatedAt: true, expiresAt: true },
  });
  if (!grant || grant.userId !== user.id || grant.tokenVersion !== user.tokenVersion || grant.credentialRevision !== user.credentialRevision || grant.expiresAt <= now) return null;
  return { user, grant };
}
