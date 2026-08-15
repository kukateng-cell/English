import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { BCRYPT_COST, replacePasswordCredential } from "@/lib/password-credentials";
import { authorizedStudentWhere, teacherActorIsActive } from "@/lib/teacher-access";
import { securityEventData } from "@/lib/security-events";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  if (auth.role === ROLES.TEACHER && !(await teacherActorIsActive(prisma, auth.userId))) return NextResponse.json({ code: "STUDENT_NOT_FOUND" }, { status: 404 });
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401 });
  const { id } = await params;
  const target = await prisma.user.findFirst({
    where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: auth.role, capability: "RESET_STUDENT_PASSWORD" }) },
    select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true },
  });
  if (!target || target.role !== ROLES.STUDENT) return NextResponse.json({ code: "STUDENT_NOT_FOUND" }, { status: 404 });
  const newPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  try {
    await prisma.$transaction(async (tx) => {
      if (auth.role === ROLES.TEACHER && !(await teacherActorIsActive(tx, auth.userId))) throw new Error("ACCESS_REVOKED");
      const allowed = await tx.user.findFirst({ where: { id, ...authorizedStudentWhere({ userId: auth.userId, role: auth.role, capability: "RESET_STUDENT_PASSWORD" }) }, select: { id: true, accountName: true, tokenVersion: true, credentialRevision: true } });
      if (!allowed) throw new Error("ACCESS_REVOKED");
      const ok = await replacePasswordCredential(tx, { userId: id, passwordHash, mustChangePassword: true, expectedTokenVersion: allowed.tokenVersion, expectedCredentialRevision: allowed.credentialRevision });
      if (!ok) throw new Error("STALE_PREVIEW");
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: allowed.accountName, eventType: "PASSWORD_RESET_BY_ADMIN", ip: getClientIp(req.headers), metadata: { actorRole: auth.role } }) });
      await tx.databaseMetadata.upsert({ where: { key: `studentTemporaryCredential:${allowed.accountName}` }, create: { key: `studentTemporaryCredential:${allowed.accountName}`, value: "issued-v2" }, update: { value: "issued-v2" } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, temporaryPassword: newPassword }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_REVOKED") return NextResponse.json({ code: "STUDENT_NOT_FOUND" }, { status: 404 });
    if (error instanceof Error && error.message === "STALE_PREVIEW") return NextResponse.json({ code: "STALE_PREVIEW" }, { status: 409 });
    return NextResponse.json({ code: "PASSWORD_RESET_FAILED" }, { status: 409 });
  }
}
