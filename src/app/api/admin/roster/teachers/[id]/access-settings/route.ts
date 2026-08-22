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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRead();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const academicYearId = new URL(req.url).searchParams.get("academicYearId");
  if (!academicYearId) return rosterResponse("ACADEMIC_YEAR_NOT_FOUND", 422);
  try {
    const snapshot = await prisma.$transaction(async (tx) => {
      const [teacher, year] = await Promise.all([
        tx.user.findFirst({ where: { id, role: ROLES.TEACHER }, select: { id: true, accountName: true, status: true, teacherProfile: { select: { legalName: true, accessRevision: true, canResetStudentPassword: true, canManageWordCatalog: true, classAccess: { where: { schoolClass: { academicYearId } }, select: { classId: true, canViewProgress: true } } } } } }),
        tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, label: true, status: true, revision: true } }),
      ]);
      if (!teacher?.teacherProfile) throw new Error("TEACHER_NOT_FOUND");
      if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
      const classes = await tx.schoolClass.findMany({ where: { academicYearId, active: true }, orderBy: [{ grade: "asc" }, { classCode: "asc" }, { id: "asc" }], select: { id: true, grade: true, classCode: true, active: true, revision: true } });
      const currentClasses = await tx.schoolClass.findMany({ where: { academicYear: { status: "CURRENT" }, active: true, teacherAccess: { some: { teacherId: id, canViewProgress: true } } }, select: { id: true } });
      const studentCount = await tx.studentEnrollment.count({ where: { status: "ACTIVE", academicYear: { status: "CURRENT" }, student: { user: { role: ROLES.STUDENT, status: "ACTIVE" } }, schoolClass: { is: { teacherAccess: { some: { teacherId: id, canViewProgress: true } } } } } });
      return { teacher, year, classes, currentImpact: { classCount: currentClasses.length, studentCount } };
    });
    return NextResponse.json({
      teacher: { id: snapshot.teacher.id, accountName: snapshot.teacher.accountName, status: snapshot.teacher.status, legalName: snapshot.teacher.teacherProfile!.legalName },
      accessRevision: snapshot.teacher.teacherProfile!.accessRevision,
      canResetStudentPassword: snapshot.teacher.teacherProfile!.canResetStudentPassword,
      canManageWordCatalog: snapshot.teacher.teacherProfile!.canManageWordCatalog,
      academicYear: snapshot.year,
      classes: snapshot.classes,
      selectedClassIds: snapshot.teacher.teacherProfile!.classAccess.filter((item) => item.canViewProgress).map((item) => item.classId),
      currentImpact: snapshot.currentImpact,
    }, { headers: headers() });
  } catch (error) {
    const code = stableRosterCode(error, ["TEACHER_NOT_FOUND", "ACADEMIC_YEAR_NOT_FOUND"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "INTERNAL_ERROR" ? 500 : 404);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  const body = (() => { try { return JSON.parse(rawBody) as { accessRevision?: unknown; globalCapabilities?: { canResetStudentPassword?: unknown; canManageWordCatalog?: unknown; acknowledgeImmediateEffect?: unknown }; classAccess?: { academicYearId?: unknown; classIds?: unknown } | null }; } catch { return null; } })();
  const expectedAccessRevision = Number(body?.accessRevision);
  const canReset = body?.globalCapabilities?.canResetStudentPassword;
  const canManageWordCatalog = body?.globalCapabilities?.canManageWordCatalog;
  const acknowledge = body?.globalCapabilities?.acknowledgeImmediateEffect;
  if (!Number.isInteger(expectedAccessRevision) || typeof canReset !== "boolean" || typeof canManageWordCatalog !== "boolean" || (acknowledge !== undefined && typeof acknowledge !== "boolean")) return rosterResponse("ACCESS_INPUT_INVALID", 422);
  const classAccess = body?.classAccess;
  let selectedYearId: string | null = null;
  let selectedClassIds: string[] | null = null;
  if (classAccess !== null && classAccess !== undefined) {
    if (typeof classAccess.academicYearId !== "string" || !Array.isArray(classAccess.classIds) || classAccess.classIds.some((value) => typeof value !== "string") || new Set(classAccess.classIds).size !== classAccess.classIds.length || classAccess.classIds.length > 48) return rosterResponse("ACCESS_INPUT_INVALID", 422);
    selectedYearId = classAccess.academicYearId;
    selectedClassIds = [...classAccess.classIds] as string[];
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const teacher = await tx.user.findFirst({ where: { id, role: ROLES.TEACHER }, select: { id: true, accountName: true, teacherProfile: { select: { accessRevision: true, canResetStudentPassword: true, canManageWordCatalog: true } } } });
      if (!teacher?.teacherProfile) throw new Error("TEACHER_NOT_FOUND");
      if (teacher.teacherProfile.accessRevision !== expectedAccessRevision) throw new Error("ACCESS_UPDATE_STALE");
      const globalChanged = teacher.teacherProfile.canResetStudentPassword !== canReset;
      const catalogChanged = teacher.teacherProfile.canManageWordCatalog !== canManageWordCatalog;
      if (globalChanged && acknowledge !== true) throw new Error("IMMEDIATE_EFFECT_ACK_REQUIRED");
      let selectedChanged = false;
      if (selectedYearId) {
        const year = await tx.academicYear.findUnique({ where: { id: selectedYearId }, select: { id: true, status: true } });
        if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
        if (year.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
        const classes = await tx.schoolClass.findMany({ where: { id: { in: selectedClassIds ?? [] }, academicYearId: selectedYearId, active: true }, select: { id: true } });
        if (classes.length !== (selectedClassIds?.length ?? 0)) throw new Error("CLASS_NOT_FOUND");
        const existing = (await tx.teacherClassAccess.findMany({ where: { teacherId: id, schoolClass: { academicYearId: selectedYearId }, canViewProgress: true }, select: { classId: true } })).map((item) => item.classId).sort();
        selectedChanged = JSON.stringify(existing) !== JSON.stringify([...(selectedClassIds ?? [])].sort());
        if (selectedChanged) {
          await tx.teacherClassAccess.deleteMany({ where: { teacherId: id, schoolClass: { academicYearId: selectedYearId } } });
          if (selectedClassIds?.length) {
            const audit = actorAuditFields(gate.auth.userId);
            await tx.teacherClassAccess.createMany({ data: selectedClassIds.map((classId) => ({ teacherId: id, classId, canViewProgress: true, canResetStudentPassword: canReset, grantedById: gate.auth.userId, grantedByPseudonym: audit.actorPseudonym, hmacKeyVersion: audit.hmacKeyVersion })) });
          }
        }
      }
      const changed = globalChanged || catalogChanged || selectedChanged;
      if (globalChanged || catalogChanged) await tx.teacherProfile.update({ where: { userId: id }, data: { canResetStudentPassword: canReset, canManageWordCatalog } });
      if (globalChanged) await tx.teacherClassAccess.updateMany({ where: { teacherId: id, schoolClass: { academicYear: { status: { in: ["CURRENT", "PLANNED"] } } } }, data: { canResetStudentPassword: canReset } });
      if (changed) {
        await tx.teacherProfile.update({ where: { userId: id }, data: { accessRevision: { increment: 1 } } });
        await tx.rosterMutationState.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
      }
      const audit = changed ? await tx.securityEvent.create({ data: securityEventData({ actorUserId: gate.auth.userId, subjectUserId: id, subjectAccount: teacher.accountName, eventType: "TEACHER_CLASS_ACCESS_CHANGED", ip: getClientIp(req.headers), metadata: { globalResetCapability: canReset, canManageWordCatalog, academicYearId: selectedYearId, selectedClassCount: selectedClassIds?.length ?? null } }) }) : null;
      const currentClasses = await tx.schoolClass.findMany({ where: { academicYear: { status: "CURRENT" }, active: true, teacherAccess: { some: { teacherId: id, canViewProgress: true } } }, select: { id: true } });
      const studentCount = await tx.studentEnrollment.count({ where: { status: "ACTIVE", academicYear: { status: "CURRENT" }, student: { user: { role: ROLES.STUDENT, status: "ACTIVE" } }, schoolClass: { is: { teacherAccess: { some: { teacherId: id, canViewProgress: true } } } } } });
      const updated = await tx.teacherProfile.findUniqueOrThrow({ where: { userId: id }, select: { accessRevision: true, canResetStudentPassword: true, canManageWordCatalog: true } });
      return { accessRevision: updated.accessRevision, canResetStudentPassword: updated.canResetStudentPassword, canManageWordCatalog: updated.canManageWordCatalog, currentImpact: { classCount: currentClasses.length, studentCount }, selectedYear: selectedYearId ? { academicYearId: selectedYearId, classIds: selectedClassIds } : null, auditEventId: audit?.id ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, ...result }, { headers: headers() });
  } catch (error) {
    const code = stableRosterCode(error, ["TEACHER_NOT_FOUND", "ACADEMIC_YEAR_NOT_FOUND", "ACADEMIC_YEAR_READ_ONLY", "CLASS_NOT_FOUND", "ACCESS_UPDATE_STALE", "IMMEDIATE_EFFECT_ACK_REQUIRED"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "TEACHER_NOT_FOUND" || code === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : code === "ACCESS_UPDATE_STALE" || code === "ACADEMIC_YEAR_READ_ONLY" ? 409 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
