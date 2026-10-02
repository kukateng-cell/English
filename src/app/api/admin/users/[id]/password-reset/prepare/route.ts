import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { getRequestToken, readRecentAuthGrantSnapshot } from "@/lib/recent-auth";
import { issuePasswordResetPrecondition, PASSWORD_RESET_AUDIENCES, PasswordResetPreconditionError } from "@/lib/password-reset-precondition";

const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function authResponse(status: number) {
  return NextResponse.json({ code: status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED" }, { status, headers });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403, headers });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return authResponse(auth.status);
  const { id } = await params;
  if (!id || Buffer.byteLength(id, "utf8") > 128 || id === auth.userId) return NextResponse.json({ code: id === auth.userId ? "RESET_TARGET_ROLE_FORBIDDEN" : "REQUEST_INVALID" }, { status: 422, headers });
  const snapshot = await readRecentAuthGrantSnapshot({ req, userId: auth.userId });
  if (!snapshot) return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401, headers });
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, accountName: true, role: true, status: true, revision: true, tokenVersion: true, credentialRevision: true,
      studentProfile: { select: { legalName: true } },
      teacherProfile: { select: { legalName: true, accessRevision: true } },
    },
  });
  if (!target) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404, headers });
  if (target.role !== ROLES.STUDENT && target.role !== ROLES.TEACHER) return NextResponse.json({ code: "RESET_TARGET_ROLE_FORBIDDEN" }, { status: 422, headers });
  if (target.status !== "ACTIVE") return NextResponse.json({ code: "RESET_TARGET_NOT_ACTIVE" }, { status: 409, headers });
  const targetRole = target.role === ROLES.TEACHER ? "TEACHER" : "STUDENT";
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers });
  try {
    const resetPrecondition = issuePasswordResetPrecondition({
      audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET,
      actorId: auth.userId,
      actorRole: "ADMIN",
      targetId: target.id,
      targetRole,
      sessionJti: token.sessionJti,
      actorTokenVersion: snapshot.user.tokenVersion,
      actorCredentialRevision: snapshot.user.credentialRevision,
      targetTokenVersion: target.tokenVersion,
      targetCredentialRevision: target.credentialRevision,
      targetRevision: target.revision,
      targetAccessRevision: target.teacherProfile?.accessRevision ?? null,
      actorAccessRevision: null,
      grantReauthenticatedAt: snapshot.grant.reauthenticatedAt.getTime(),
      grantExpiresAt: snapshot.grant.expiresAt.getTime(),
    });
    return NextResponse.json({
      target: { id: target.id, accountName: target.accountName, legalName: target.studentProfile?.legalName ?? target.teacherProfile?.legalName ?? "", role: target.role, status: target.status },
      resetPrecondition,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }, { headers });
  } catch (error) {
    const code = error instanceof PasswordResetPreconditionError ? error.code : "RESET_PRECONDITION_UNAVAILABLE";
    return NextResponse.json({ code }, { status: code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : 422, headers });
  }
}
