import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";

const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403, headers });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED" }, { status: auth.status, headers });
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401, headers });
  const { id } = await params;
  if (!id || Buffer.byteLength(id, "utf8") > 128) return NextResponse.json({ code: "REQUEST_INVALID" }, { status: 422, headers });
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      accountName: true,
      role: true,
      status: true,
      contactEmail: true,
      legacyName: true,
      createdAt: true,
      revision: true,
      studentProfile: { select: { legalName: true, nickname: true, profileRevision: true } },
      teacherProfile: { select: { legalName: true, profileRevision: true, accessRevision: true } },
    },
  });
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404, headers });
  const currentEnrollment = user.role === ROLES.STUDENT ? await prisma.studentEnrollment.findFirst({
    where: { studentId: id, academicYear: { status: "CURRENT" } },
    orderBy: { academicYear: { startsOn: "desc" } },
    select: { academicYearId: true, grade: true, classId: true, studentNumber: true, revision: true, schoolClass: { select: { classCode: true } } },
  }) : null;
  const state = await prisma.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  return NextResponse.json({
    user: {
      id: user.id,
      accountName: user.accountName,
      role: user.role,
      status: user.status,
      contactEmail: user.contactEmail,
      createdAt: user.createdAt.toISOString(),
      userRevision: user.revision,
      profile: user.role === ROLES.STUDENT ? user.studentProfile : user.role === ROLES.TEACHER ? user.teacherProfile && { legalName: user.teacherProfile.legalName, profileRevision: user.teacherProfile.profileRevision } : { legalName: user.legacyName, profileRevision: null },
      teacherAccessRevision: user.teacherProfile?.accessRevision ?? null,
    },
    currentEnrollment: currentEnrollment ? { ...currentEnrollment, classCode: currentEnrollment.schoolClass?.classCode ?? null, schoolClass: undefined } : null,
    rosterRevision: state?.revision ?? 0,
    generatedAt: new Date().toISOString(),
  }, { headers });
}
