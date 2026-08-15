import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { getRequestToken, hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { BCRYPT_COST, replacePasswordCredential } from "@/lib/password-credentials";
import {
  authorizedStudentWhere,
  teacherActorCanResetStudentPassword,
  teacherActorIsActive,
} from "@/lib/teacher-access";
import { securityEventData } from "@/lib/security-events";
import { consumeTeacherResetLimits } from "@/lib/teacher-reset-limiter";
import {
  assertTeacherResetPrecondition,
  readTeacherResetPrecondition,
  TeacherResetPreconditionError,
} from "@/lib/teacher-reset-precondition";
import { rosterResponse } from "@/lib/roster-api";

const JSON_BODY_LIMIT = 16 * 1024;

function successHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  if (auth.role === ROLES.TEACHER && !(await teacherActorIsActive(prisma, auth.userId))) {
    return rosterResponse("STUDENT_NOT_FOUND", 404);
  }
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return rosterResponse("RECENT_AUTH_REQUIRED", 401);
  }
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) return rosterResponse("RECENT_AUTH_REQUIRED", 401);
  if (Number(req.headers.get("content-length") ?? 0) > JSON_BODY_LIMIT) return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > JSON_BODY_LIMIT) return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  let body: { resetPrecondition?: unknown } | null = null;
  try { body = JSON.parse(rawBody) as { resetPrecondition?: unknown }; } catch { body = null; }
  if (typeof body?.resetPrecondition !== "string" || !body.resetPrecondition) {
    return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  }
  const { id } = await params;
  let precondition;
  try {
    precondition = assertTeacherResetPrecondition(
      readTeacherResetPrecondition(body.resetPrecondition),
      { actorId: auth.userId, targetId: id, sessionJti: token.sessionJti },
    );
  } catch (error) {
    if (error instanceof TeacherResetPreconditionError) {
      return rosterResponse(error.code, error.code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : 422);
    }
    return rosterResponse("RESET_PRECONDITION_INVALID", 422);
  }

  const target = await prisma.user.findFirst({
    where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: auth.role, capability: "RESET_STUDENT_PASSWORD" }) },
    select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true },
  });
  if (!target || target.role !== ROLES.STUDENT) return rosterResponse("STUDENT_NOT_FOUND", 404);
  if (target.tokenVersion !== precondition.targetTokenVersion || target.credentialRevision !== precondition.targetCredentialRevision) {
    return rosterResponse("RESET_CREDENTIAL_STALE", 409);
  }
  if (auth.role === ROLES.TEACHER && precondition.actorAccessRevision !== null) {
    const actorProfile = await prisma.teacherProfile.findUnique({ where: { userId: auth.userId }, select: { accessRevision: true } });
    if (!actorProfile || actorProfile.accessRevision !== precondition.actorAccessRevision) {
      return rosterResponse("RESET_CREDENTIAL_STALE", 409);
    }
  }
  const limit = await consumeTeacherResetLimits({ teacherId: auth.userId, sessionJti: token.sessionJti, ip: getClientIp(req.headers), targetId: target.id });
  if (!limit.ok) {
    return rosterResponse(limit.dimension === "backend" ? "RATE_LIMIT_BACKEND_UNAVAILABLE" : "TEACHER_RESET_RATE_LIMITED", limit.dimension === "backend" ? 503 : 429, { retryAfterSeconds: limit.retryAfterSec });
  }
  const newPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  try {
    await prisma.$transaction(async (tx) => {
      if (auth.role === ROLES.TEACHER && !(await teacherActorCanResetStudentPassword(tx, auth.userId))) throw new Error("ACCESS_REVOKED");
      const allowed = await tx.user.findFirst({
        where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: auth.role, capability: "RESET_STUDENT_PASSWORD" }) },
        select: { id: true, accountName: true, role: true, status: true },
      });
      if (!allowed || allowed.role !== ROLES.STUDENT || allowed.status !== "ACTIVE") throw new Error("ACCESS_REVOKED");
      const ok = await replacePasswordCredential(tx, {
        userId: id,
        passwordHash,
        mustChangePassword: true,
        expectedTokenVersion: precondition.targetTokenVersion,
        expectedCredentialRevision: precondition.targetCredentialRevision,
      });
      if (!ok) throw new Error("STALE_PREVIEW");
      await tx.securityEvent.create({
        data: securityEventData({
          actorUserId: auth.userId,
          subjectUserId: id,
          subjectAccount: allowed.accountName,
          eventType: auth.role === ROLES.TEACHER ? "PASSWORD_RESET_BY_TEACHER" : "PASSWORD_RESET_BY_ADMIN",
          ip: getClientIp(req.headers),
          metadata: { actorRole: auth.role },
        }),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, temporaryPassword: newPassword }, { headers: successHeaders() });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_REVOKED") return rosterResponse("STUDENT_NOT_FOUND", 404);
    if (error instanceof Error && error.message === "STALE_PREVIEW") return rosterResponse("RESET_CREDENTIAL_STALE", 409);
    return rosterResponse("INTERNAL_ERROR", 500);
  }
}
