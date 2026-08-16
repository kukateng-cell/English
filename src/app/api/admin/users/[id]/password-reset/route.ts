import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { getClientIp } from "@/lib/login-limiter";
import { getRequestToken, hashSessionJti } from "@/lib/recent-auth";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { BCRYPT_COST, replacePasswordCredential } from "@/lib/password-credentials";
import { assertPasswordResetPrecondition, readPasswordResetPrecondition, PASSWORD_RESET_AUDIENCES, PasswordResetPreconditionError } from "@/lib/password-reset-precondition";
import { consumePasswordResetLimits, passwordResetLimitErrorCode } from "@/lib/password-reset-limiter";
import { securityEventData } from "@/lib/security-events";

const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const BODY_LIMIT = 16 * 1024;

function json(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, { status, headers });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return json("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return json(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  const { id } = await params;
  if (!id || Buffer.byteLength(id, "utf8") > 128 || id === auth.userId) return json(id === auth.userId ? "RESET_TARGET_ROLE_FORBIDDEN" : "REQUEST_INVALID", 422);
  if (Number(req.headers.get("content-length") ?? 0) > BODY_LIMIT) return json("PAYLOAD_TOO_LARGE", 413);
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) return json("PAYLOAD_TOO_LARGE", 413);
  let body: { resetPrecondition?: unknown } | null = null;
  try { body = JSON.parse(raw) as { resetPrecondition?: unknown }; } catch { return json("REQUEST_INVALID", 422); }
  if (typeof body.resetPrecondition !== "string" || !body.resetPrecondition) return json("RESET_PRECONDITION_INVALID", 422);
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) return json("AUTH_REQUIRED", 401);
  let precondition;
  try {
    precondition = assertPasswordResetPrecondition(
      readPasswordResetPrecondition(body.resetPrecondition, PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET),
      { audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET, actorId: auth.userId, targetId: id, sessionJti: token.sessionJti },
    );
  } catch (error) {
    const code = error instanceof PasswordResetPreconditionError ? error.code : "RESET_PRECONDITION_INVALID";
    return json(code, code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : 422);
  }
  if (precondition.actorRole !== "ADMIN" || !["STUDENT", "TEACHER"].includes(precondition.targetRole)) return json("RESET_PRECONDITION_INVALID", 422);
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, tokenVersion: true, credentialRevision: true, revision: true } });
  if (!target) return json("USER_NOT_FOUND", 404);
  if (target.role !== precondition.targetRole || ![ROLES.STUDENT, ROLES.TEACHER].includes(target.role)) return json("RESET_TARGET_ROLE_FORBIDDEN", 422);
  if (target.status !== "ACTIVE") return json("RESET_TARGET_NOT_ACTIVE", 409);
  const limit = await consumePasswordResetLimits({ audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET, actorId: auth.userId, sessionJti: token.sessionJti, ip: getClientIp(req.headers), targetId: id });
  if (!limit.ok) return json(limit.dimension === "backend" ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : passwordResetLimitErrorCode(PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET), limit.dimension === "backend" ? 503 : 429, { retryAfterSeconds: limit.retryAfterSec });
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  try {
    await prisma.$transaction(async (tx) => {
      const ids = [auth.userId, id].sort();
      for (const userId of ids) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true } });
      const fresh = await tx.user.findUnique({ where: { id }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, revision: true } });
      if (!actor || actor.status !== "ACTIVE" || actor.role !== ROLES.ADMIN) throw new Error("AUTH_REQUIRED");
      if (actor.tokenVersion !== precondition.actorTokenVersion || actor.credentialRevision !== precondition.actorCredentialRevision || token.tokenVersion !== actor.tokenVersion || token.credentialRevision !== actor.credentialRevision) throw new Error("RESET_ACTOR_CREDENTIAL_STALE");
      const grantId = hashSessionJti(token.sessionJti as string);
      await tx.$queryRaw`SELECT "id" FROM "RecentAuthGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.recentAuthGrant.findUnique({ where: { id: grantId }, select: { userId: true, tokenVersion: true, credentialRevision: true, reauthenticatedAt: true, expiresAt: true } });
      if (!grant || grant.userId !== auth.userId || grant.tokenVersion !== actor.tokenVersion || grant.credentialRevision !== actor.credentialRevision || grant.expiresAt <= new Date() || grant.reauthenticatedAt.getTime() !== precondition.grantReauthenticatedAt || grant.expiresAt.getTime() !== precondition.grantExpiresAt) throw new Error("RESET_PRECONDITION_INVALID");
      if (!fresh || fresh.role !== precondition.targetRole || fresh.status !== "ACTIVE" || fresh.tokenVersion !== precondition.targetTokenVersion || fresh.credentialRevision !== precondition.targetCredentialRevision || fresh.revision !== precondition.targetRevision) throw new Error("RESET_CREDENTIAL_STALE");
      const ok = await replacePasswordCredential(tx, { userId: id, passwordHash, mustChangePassword: true, expectedTokenVersion: precondition.targetTokenVersion, expectedCredentialRevision: precondition.targetCredentialRevision });
      if (!ok) throw new Error("RESET_CREDENTIAL_STALE");
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: fresh.accountName, eventType: "PASSWORD_RESET_BY_ADMIN", ip: getClientIp(req.headers), metadata: { actorRole: "ADMIN", resetAudience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET } }) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, temporaryPassword }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (["AUTH_REQUIRED", "RESET_ACTOR_CREDENTIAL_STALE"].includes(code)) return json(code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : code, code === "AUTH_REQUIRED" ? 401 : 409);
    if (["RESET_PRECONDITION_INVALID", "RESET_CREDENTIAL_STALE"].includes(code)) return json(code, 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return json("RESET_CREDENTIAL_STALE", 409);
    console.error("[admin-user-reset] commit failed", { errorType: error instanceof Error ? error.name : typeof error });
    return json("INTERNAL_ERROR", 500);
  }
}
