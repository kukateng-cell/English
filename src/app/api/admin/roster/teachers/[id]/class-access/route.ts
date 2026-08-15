import { NextResponse } from "next/server";
import { Prisma, prisma } from "@/lib/prisma";
import { requireAdminMutation, requireAdminRead, rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { actorAuditFields } from "@/lib/admin-receipts";
import { lockRosterMutationState } from "@/lib/roster-server";

function headers() {
  return { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}

/** Compatibility adapter: this endpoint may change view scope, never reset scope. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRead();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const academicYearId = new URL(req.url).searchParams.get("academicYearId");
  if (!academicYearId) return rosterResponse("ACADEMIC_YEAR_NOT_FOUND", 422);
  const teacher = await prisma.user.findFirst({
    where: { id, role: ROLES.TEACHER },
    select: { id: true, accountName: true, status: true, teacherProfile: { select: { legalName: true, accessRevision: true, canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYearId } }, select: { classId: true, canViewProgress: true, canResetStudentPassword: true, revision: true } } } } },
  });
  if (!teacher?.teacherProfile) return rosterResponse("TEACHER_NOT_FOUND", 404);
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, label: true, status: true, revision: true } });
  if (!year) return rosterResponse("ACADEMIC_YEAR_NOT_FOUND", 404);
  const classes = await prisma.schoolClass.findMany({ where: { academicYearId, active: true }, orderBy: [{ grade: "asc" }, { classCode: "asc" }], select: { id: true, grade: true, classCode: true, active: true, revision: true } });
  return NextResponse.json({
    teacher: { id: teacher.id, accountName: teacher.accountName, status: teacher.status, teacherProfile: { legalName: teacher.teacherProfile.legalName, accessRevision: teacher.teacherProfile.accessRevision, canResetStudentPassword: teacher.teacherProfile.canResetStudentPassword } },
    academicYear: year,
    classes,
    access: teacher.teacherProfile.classAccess.map((item) => ({ classId: item.classId, canViewProgress: item.canViewProgress, canResetStudentPassword: teacher.teacherProfile!.canResetStudentPassword, revision: item.revision })),
  }, { headers: headers() });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  const body = await req.json().catch(() => null) as { academicYearId?: unknown; access?: unknown } | null;
  if (typeof body?.academicYearId !== "string" || !Array.isArray(body.access)) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  const access: Array<{ classId: string; canViewProgress: boolean }> = [];
  let resetProjection: boolean | undefined;
  for (const item of body.access as unknown[]) {
    if (!item || typeof item !== "object") return rosterResponse("ACCESS_INPUT_INVALID", 422);
    const classId = Reflect.get(item, "classId");
    const canViewProgress = Reflect.get(item, "canViewProgress") !== false;
    const hasReset = Object.prototype.hasOwnProperty.call(item, "canResetStudentPassword") || Object.prototype.hasOwnProperty.call(item, "resetPasswordAccess");
    const rawReset = Object.prototype.hasOwnProperty.call(item, "canResetStudentPassword") ? Reflect.get(item, "canResetStudentPassword") : Reflect.get(item, "resetPasswordAccess");
    if (typeof classId !== "string" || !classId || typeof canViewProgress !== "boolean" || (hasReset && typeof rawReset !== "boolean")) return rosterResponse("ACCESS_INPUT_INVALID", 422);
    if (hasReset) {
      const value = rawReset as boolean;
      if (resetProjection !== undefined && resetProjection !== value) return rosterResponse("LEGACY_RESET_SCOPE_UNSUPPORTED", 409);
      resetProjection = value;
    }
    access.push({ classId, canViewProgress });
  }
  if (new Set(access.map((item) => item.classId)).size !== access.length || access.length > 48) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const teacher = await tx.user.findFirst({ where: { id, role: ROLES.TEACHER }, select: { id: true, accountName: true, teacherProfile: { select: { canResetStudentPassword: true } } } });
      if (!teacher?.teacherProfile) throw new Error("TEACHER_NOT_FOUND");
      if (resetProjection !== undefined && resetProjection !== teacher.teacherProfile.canResetStudentPassword) throw new Error("LEGACY_RESET_SCOPE_UNSUPPORTED");
      const year = await tx.academicYear.findUnique({ where: { id: body.academicYearId as string }, select: { id: true, status: true } });
      if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
      if (year.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
      const classes = await tx.schoolClass.findMany({ where: { id: { in: access.map((item) => item.classId) }, academicYearId: year.id, active: true }, select: { id: true } });
      if (classes.length !== access.length) throw new Error("CLASS_NOT_FOUND");
      await tx.teacherClassAccess.deleteMany({ where: { teacherId: id, schoolClass: { academicYearId: year.id } } });
      if (access.length) {
        const audit = actorAuditFields(gate.auth.userId);
        await tx.teacherClassAccess.createMany({ data: access.map((item) => ({ teacherId: id, classId: item.classId, canViewProgress: item.canViewProgress, canResetStudentPassword: teacher.teacherProfile!.canResetStudentPassword, grantedById: gate.auth.userId, grantedByPseudonym: audit.actorPseudonym, hmacKeyVersion: audit.hmacKeyVersion })) });
      }
      const updated = await tx.teacherProfile.update({ where: { userId: id }, data: { accessRevision: { increment: 1 } }, select: { accessRevision: true, canResetStudentPassword: true } });
      await tx.rosterMutationState.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
      const audit = await tx.securityEvent.create({ data: securityEventData({ actorUserId: gate.auth.userId, subjectUserId: id, subjectAccount: teacher.accountName, eventType: "TEACHER_CLASS_ACCESS_CHANGED", ip: getClientIp(req.headers), metadata: { compatibilityAdapter: true, academicYearId: year.id, accessCount: access.length } }) });
      return { accessRevision: updated.accessRevision, canResetStudentPassword: updated.canResetStudentPassword, auditEventId: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, ...result }, { headers: headers() });
  } catch (error) {
    const code = stableRosterCode(error, ["TEACHER_NOT_FOUND", "ACADEMIC_YEAR_NOT_FOUND", "ACADEMIC_YEAR_READ_ONLY", "CLASS_NOT_FOUND", "LEGACY_RESET_SCOPE_UNSUPPORTED"], "ACCESS_UPDATE_FAILED");
    return rosterResponse(code, code === "TEACHER_NOT_FOUND" || code === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : code === "LEGACY_RESET_SCOPE_UNSUPPORTED" || code === "ACADEMIC_YEAR_READ_ONLY" ? 409 : 422);
  }
}
