import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { getRequestToken, hashSessionJti } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { BCRYPT_COST, replacePasswordCredential } from "@/lib/password-credentials";
import { authorizedStudentWhere, teacherActorCanResetStudentPassword } from "@/lib/teacher-access";
import { securityEventData } from "@/lib/security-events";
import { consumePasswordResetLimits, passwordResetLimitErrorCode } from "@/lib/password-reset-limiter";
import { assertPasswordResetPrecondition, readPasswordResetPrecondition, PASSWORD_RESET_AUDIENCES, PasswordResetPreconditionError } from "@/lib/password-reset-precondition";
import { rosterResponse } from "@/lib/roster-api";

const BODY_LIMIT = 16 * 1024;

function authResponse(status: number) {
  return rosterResponse(status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", status);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER);
  if (!auth.ok) return authResponse(auth.status);
  const { id } = await params;
  if (!id || Buffer.byteLength(id, "utf8") > 128) return rosterResponse("REQUEST_INVALID", 422);
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) return rosterResponse("AUTH_REQUIRED", 401);
  if (Number(req.headers.get("content-length") ?? 0) > BODY_LIMIT) return rosterResponse("PAYLOAD_TOO_LARGE", 413);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > BODY_LIMIT) return rosterResponse("PAYLOAD_TOO_LARGE", 413);
  let body: { resetPrecondition?: unknown } | null = null;
  try { body = JSON.parse(rawBody) as { resetPrecondition?: unknown }; } catch { return rosterResponse("REQUEST_INVALID", 422); }
  if (typeof body.resetPrecondition !== "string" || !body.resetPrecondition) return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  let precondition;
  try {
    precondition = assertPasswordResetPrecondition(
      readPasswordResetPrecondition(body.resetPrecondition, PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET),
      { audience: PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET, actorId: auth.userId, targetId: id, sessionJti: token.sessionJti },
    );
  } catch (error) {
    const code = error instanceof PasswordResetPreconditionError ? error.code : "RESET_PRECONDITION_INVALID";
    return rosterResponse(code, code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : 422);
  }
  if (precondition.actorRole !== "TEACHER" || precondition.targetRole !== "STUDENT") return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  const target = await prisma.user.findFirst({
    where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: ROLES.TEACHER, capability: "RESET_STUDENT_PASSWORD" }) },
    select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, revision: true },
  });
  if (!target || target.role !== ROLES.STUDENT) return rosterResponse("STUDENT_NOT_FOUND", 404);
  if (target.status !== "ACTIVE") return rosterResponse("RESET_TARGET_NOT_ACTIVE", 409);
  if (target.tokenVersion !== precondition.targetTokenVersion || target.credentialRevision !== precondition.targetCredentialRevision || target.revision !== precondition.targetRevision) return rosterResponse("RESET_CREDENTIAL_STALE", 409);
  const limit = await consumePasswordResetLimits({ audience: PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET, actorId: auth.userId, sessionJti: token.sessionJti, ip: getClientIp(req.headers), targetId: id });
  if (!limit.ok) return rosterResponse(limit.dimension === "backend" ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : passwordResetLimitErrorCode(PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET), limit.dimension === "backend" ? 503 : 429, { retryAfterSeconds: limit.retryAfterSec });
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  try {
    await prisma.$transaction(async (tx) => {
      for (const userId of [auth.userId, id].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { id: true, role: true, status: true, tokenVersion: true, credentialRevision: true } });
      if (!actor || actor.role !== ROLES.TEACHER || actor.status !== "ACTIVE") throw new Error("ACCESS_REVOKED");
      if (actor.tokenVersion !== precondition.actorTokenVersion || actor.credentialRevision !== precondition.actorCredentialRevision || token.tokenVersion !== actor.tokenVersion || token.credentialRevision !== actor.credentialRevision) throw new Error("RESET_ACTOR_CREDENTIAL_STALE");
      const grantId = hashSessionJti(token.sessionJti as string);
      await tx.$queryRaw`SELECT "id" FROM "RecentAuthGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.recentAuthGrant.findUnique({ where: { id: grantId }, select: { userId: true, tokenVersion: true, credentialRevision: true, reauthenticatedAt: true, expiresAt: true } });
      if (!grant || grant.userId !== actor.id || grant.tokenVersion !== actor.tokenVersion || grant.credentialRevision !== actor.credentialRevision || grant.expiresAt <= new Date() || grant.reauthenticatedAt.getTime() !== precondition.grantReauthenticatedAt || grant.expiresAt.getTime() !== precondition.grantExpiresAt) throw new Error("RESET_PRECONDITION_INVALID");
      if (!(await teacherActorCanResetStudentPassword(tx, auth.userId))) throw new Error("ACCESS_REVOKED");
      const allowed = await tx.user.findFirst({ where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: ROLES.TEACHER, capability: "RESET_STUDENT_PASSWORD" }) }, select: { id: true, accountName: true, role: true, status: true, revision: true, tokenVersion: true, credentialRevision: true } });
      if (!allowed || allowed.role !== ROLES.STUDENT || allowed.status !== "ACTIVE" || allowed.revision !== precondition.targetRevision || allowed.tokenVersion !== precondition.targetTokenVersion || allowed.credentialRevision !== precondition.targetCredentialRevision) throw new Error("RESET_CREDENTIAL_STALE");
      const ok = await replacePasswordCredential(tx, { userId: id, passwordHash, mustChangePassword: true, expectedTokenVersion: precondition.targetTokenVersion, expectedCredentialRevision: precondition.targetCredentialRevision });
      if (!ok) throw new Error("RESET_CREDENTIAL_STALE");
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: allowed.accountName, eventType: "PASSWORD_RESET_BY_TEACHER", ip: getClientIp(req.headers), metadata: { actorRole: "TEACHER", resetAudience: PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET } }) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, temporaryPassword }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_REVOKED") return rosterResponse("STUDENT_NOT_FOUND", 404);
    if (error instanceof Error && error.message === "RESET_ACTOR_CREDENTIAL_STALE") return rosterResponse("RESET_ACTOR_CREDENTIAL_STALE", 409);
    if (error instanceof Error && ["RESET_PRECONDITION_INVALID", "RESET_CREDENTIAL_STALE"].includes(error.message)) return rosterResponse(error.message, 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return rosterResponse("RESET_CREDENTIAL_STALE", 409);
    return rosterResponse("INTERNAL_ERROR", 500);
  }
}
