import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { lockRosterMutationState } from "@/lib/roster-server";
import { actorAuditFields } from "@/lib/admin-receipts";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const { id } = await params;
  const academicYearId = new URL(req.url).searchParams.get("academicYearId");
  if (!academicYearId) return response("ACADEMIC_YEAR_REQUIRED", 422);
  const teacher = await prisma.user.findFirst({ where: { id, role: ROLES.TEACHER }, select: { id: true, accountName: true, status: true, teacherProfile: { select: { legalName: true, accessRevision: true, classAccess: { where: { schoolClass: { academicYearId } }, select: { classId: true, canViewProgress: true, canResetStudentPassword: true, revision: true } } } } } });
  if (!teacher?.teacherProfile) return response("TEACHER_NOT_FOUND", 404);
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, label: true, status: true, revision: true } });
  if (!year) return response("ACADEMIC_YEAR_NOT_FOUND", 404);
  const classes = await prisma.schoolClass.findMany({ where: { academicYearId, active: true }, orderBy: [{ grade: "asc" }, { classCode: "asc" }], select: { id: true, grade: true, classCode: true, active: true, revision: true } });
  return NextResponse.json({ teacher, academicYear: year, classes }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const academicYearId = typeof body?.academicYearId === "string" ? body.academicYearId : "";
  const expectedAccessRevision = Number(body?.accessRevision);
  if (!academicYearId || !Number.isInteger(expectedAccessRevision) || !Array.isArray(body?.access)) return response("ACCESS_INPUT_INVALID", 422);
  const access: Array<{ classId: string; canViewProgress: boolean; canResetStudentPassword: boolean }> = [];
  for (const item of body.access as unknown[]) {
    if (typeof item !== "object" || item === null) return response("ACCESS_INPUT_INVALID", 422);
    const classId = Reflect.get(item, "classId");
    const canViewProgress = Reflect.get(item, "canViewProgress") !== false;
    const canResetStudentPassword = Reflect.get(item, "canResetStudentPassword") === true;
    if (typeof classId !== "string" || (canResetStudentPassword && !canViewProgress)) return response("ACCESS_INPUT_INVALID", 422);
    access.push({ classId, canViewProgress, canResetStudentPassword });
  }
  if (new Set(access.map((item) => item.classId)).size !== access.length) return response("ACCESS_DUPLICATE", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const teacher = await tx.user.findFirst({ where: { id, role: ROLES.TEACHER, status: "ACTIVE" }, select: { id: true, accountName: true } });
      if (!teacher) throw new Error("TEACHER_NOT_FOUND");
      const year = await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { status: true } });
      if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
      if (year.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
      const classes = await tx.schoolClass.findMany({ where: { id: { in: access.map((item) => item.classId) }, academicYearId, active: true }, select: { id: true } });
      if (classes.length !== access.length) throw new Error("CLASS_NOT_FOUND");
      const profile = await tx.teacherProfile.findUnique({ where: { userId: id }, select: { accessRevision: true } });
      if (!profile || profile.accessRevision !== expectedAccessRevision) throw new Error("STALE_PREVIEW");
      await tx.teacherClassAccess.deleteMany({ where: { teacherId: id, schoolClass: { academicYearId } } });
      if (access.length) {
        const audit = actorAuditFields(auth.userId);
        await tx.teacherClassAccess.createMany({ data: access.map((item) => ({ teacherId: id, classId: item.classId, canViewProgress: item.canViewProgress, canResetStudentPassword: item.canResetStudentPassword, grantedById: auth.userId, grantedByPseudonym: audit.actorPseudonym, hmacKeyVersion: audit.hmacKeyVersion })) });
      }
      const updated = await tx.teacherProfile.update({ where: { userId: id }, data: { accessRevision: { increment: 1 } }, select: { accessRevision: true } });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: teacher.accountName, eventType: "TEACHER_CLASS_ACCESS_CHANGED", ip: getClientIp(req.headers), metadata: { academicYearId, accessCount: access.length } }) });
      return { access, accessRevision: updated.accessRevision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && ["TEACHER_NOT_FOUND", "ACADEMIC_YEAR_NOT_FOUND", "ACADEMIC_YEAR_READ_ONLY", "CLASS_NOT_FOUND", "STALE_PREVIEW"].includes(error.message)) return response(error.message, error.message === "TEACHER_NOT_FOUND" || error.message === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : 409);
    return response("ACCESS_UPDATE_FAILED", 409);
  }
}
