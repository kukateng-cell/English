import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { lockRosterMutationState } from "@/lib/roster-server";
import { createHash } from "node:crypto";
import { actorAuditFields } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";
import { assertYearActivationSelectionCap } from "@/lib/roster-domain";

function response(code: string, status: number) { return NextResponse.json({ code }, { status }); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { id: sourceAcademicYearId } = await params;
  const body = await req.json().catch(() => null);
  const targetAcademicYearId = typeof body?.targetAcademicYearId === "string" ? body.targetAcademicYearId : "";
  const operationId = typeof body?.operationId === "string" ? body.operationId : randomUUID();
  const acknowledgedClassIds = new Set(Array.isArray(body?.acknowledgedClassIds) ? body.acknowledgedClassIds.filter((value: unknown): value is string => typeof value === "string") : []);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const source = await tx.academicYear.findUnique({ where: { id: sourceAcademicYearId } });
      const target = await tx.academicYear.findUnique({ where: { id: targetAcademicYearId } });
      if (!source || source.status !== "CURRENT" || !target || target.status !== "PLANNED") throw new Error("YEAR_STATE_INVALID");
      const successor = await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: source.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } });
      if (successor?.id !== target.id) throw new Error("YEAR_NOT_SUCCESSOR");
      const sourceEnrollments = await tx.studentEnrollment.findMany({ where: { academicYearId: source.id, status: "ACTIVE", student: { user: { role: "STUDENT" } } }, orderBy: { studentId: "asc" }, select: { id: true, studentId: true, grade: true, classId: true, revision: true, student: { select: { user: { select: { status: true, revision: true, accountName: true } }, legalName: true, nickname: true } } } });
      assertYearActivationSelectionCap(sourceEnrollments.length);
      const transitions = await tx.studentYearTransition.findMany({ where: { sourceAcademicYearId: source.id, targetAcademicYearId: target.id, activatedAt: null }, select: { id: true, studentId: true, sourceEnrollmentId: true, targetEnrollmentId: true, disposition: true, revision: true } });
      const transitionByStudent = new Map(transitions.map((item) => [item.studentId, item]));
      const missingOutcomes = sourceEnrollments.filter((item) => !transitionByStudent.has(item.studentId));
      if (missingOutcomes.length) throw new Error("MISSING_TRANSITION_OUTCOME");
      const targetEnrollments = await tx.studentEnrollment.findMany({ where: { academicYearId: target.id, status: "PLANNED" }, select: { id: true, studentId: true, grade: true, classId: true, revision: true } });
      assertYearActivationSelectionCap(sourceEnrollments.length + targetEnrollments.filter((item) => !transitionByStudent.has(item.studentId)).length);
      const classes = await tx.schoolClass.findMany({ where: { academicYearId: target.id, active: true }, orderBy: [{ grade: "asc" }, { classCode: "asc" }], select: { id: true, grade: true, classCode: true, revision: true } });
      const teachers = await tx.user.findMany({ where: { role: ROLES.TEACHER, teacherProfile: { isNot: null } }, orderBy: { id: "asc" }, select: { id: true, status: true, revision: true, teacherProfile: { select: { accessRevision: true, canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYearId: target.id } }, select: { classId: true, canViewProgress: true } } } } } });
      const coverage = classes.map((schoolClass) => {
        const candidates = teachers.filter((teacher) => teacher.status === "ACTIVE" && teacher.teacherProfile?.classAccess.some((access) => access.classId === schoolClass.id && access.canViewProgress));
        const resetCandidates = candidates.filter((teacher) => teacher.teacherProfile?.canResetStudentPassword === true);
        return { classId: schoolClass.id, classRevision: schoolClass.revision, grade: schoolClass.grade, classCode: schoolClass.classCode, viewTeacherIds: candidates.map((teacher) => teacher.id).sort(), resetTeacherIds: resetCandidates.map((teacher) => teacher.id).sort(), acknowledged: acknowledgedClassIds.has(schoolClass.id), teacherSnapshots: teachers.map((teacher) => ({ userId: teacher.id, status: teacher.status, revision: teacher.revision, accessRevision: teacher.teacherProfile?.accessRevision ?? null, canResetStudentPassword: teacher.teacherProfile?.canResetStudentPassword ?? false, access: (teacher.teacherProfile?.classAccess ?? []).filter((access) => access.classId === schoolClass.id).map((access) => ({ classId: access.classId, canViewProgress: access.canViewProgress })).sort((a, b) => a.classId.localeCompare(b.classId)) })) };
      });
      const unacknowledged = coverage.filter((item) => item.viewTeacherIds.length === 0 && !item.acknowledged).map((item) => item.classId);
      if (unacknowledged.length) {
        return { pendingAcknowledgement: true, missingClassIds: unacknowledged, sourceAcademicYear: source.label, targetAcademicYear: target.label, sourceCount: sourceEnrollments.length, targetCount: targetEnrollments.length, coverage, transitions: transitions.map((item) => ({ studentId: item.studentId, disposition: item.disposition, targetEnrollmentId: item.targetEnrollmentId })) };
      }
      const state = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
      // Keep the batch payload usable for CAS/revision checks without copying
      // legalName, nickname or accountName from the admin preview projection.
      // The response still contains the aggregate coverage/transition view;
      // commit re-reads authoritative rows before writing.
      const sourceEnrollmentSnapshots = sourceEnrollments.map(({ student, ...enrollment }) => ({
        ...enrollment,
        student: { user: { status: student.user.status, revision: student.user.revision } },
      }));
      const payload = { sourceAcademicYearId: source.id, targetAcademicYearId: target.id, sourceEnrollments: sourceEnrollmentSnapshots, transitions, targetEnrollments, coverage, coverageFingerprint: digest(coverage), rosterRevision: state.revision };
      const fingerprint = digest(payload);
      const prior = await tx.adminMutationBatch.findUnique({ where: { actorUserId_operationKind_operationId: { actorUserId: auth.userId, operationKind: "YEAR_ACTIVATION", operationId } } });
      if (prior) {
        if (prior.canonicalDigest !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
        return { batchId: prior.id, operationId: prior.operationId, sourceAcademicYear: source.label, targetAcademicYear: target.label, sourceCount: sourceEnrollments.length, targetCount: targetEnrollments.length, coverage, transitions: transitions.map((item) => ({ studentId: item.studentId, disposition: item.disposition, targetEnrollmentId: item.targetEnrollmentId })) };
      }
      const batch = await tx.adminMutationBatch.create({ data: { actorUserId: auth.userId, ...actorAuditFields(auth.userId), operationKind: "YEAR_ACTIVATION", operationId, sourceAcademicYearId: source.id, targetAcademicYearId: target.id, sourceYearRevision: source.revision, targetYearRevision: target.revision, rosterRevision: state.revision, calendarRevision: state.calendarRevision, canonicalDigest: fingerprint, payload, counts: { sourceCount: sourceEnrollments.length, targetCount: targetEnrollments.length, terminalCount: transitions.filter((item) => item.disposition === "GRADUATE" || item.disposition === "LEAVE").length, coverage }, expiresAt: new Date(Date.now() + 30 * 60_000) } });
      const links = [...new Set([...sourceEnrollments.map((item) => item.studentId), ...targetEnrollments.map((item) => item.studentId), ...teachers.map((teacher) => teacher.id)])];
      if (links.length) await tx.adminMutationBatchUserLink.createMany({ data: links.map((userId) => ({ batchId: batch.id, userId, linkRole: sourceEnrollments.some((item) => item.studentId === userId) || targetEnrollments.some((item) => item.studentId === userId) ? "TARGET" as const : "COVERAGE_TEACHER" as const })) });
      return { batchId: batch.id, operationId: batch.operationId, sourceAcademicYear: source.label, targetAcademicYear: target.label, sourceCount: sourceEnrollments.length, targetCount: targetEnrollments.length, coverage, transitions: transitions.map((item) => ({ studentId: item.studentId, disposition: item.disposition, targetEnrollmentId: item.targetEnrollmentId })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["YEAR_STATE_INVALID", "YEAR_NOT_SUCCESSOR", "MISSING_TRANSITION_OUTCOME", "IDEMPOTENCY_CONFLICT", "ACTIVATION_SELECTION_CAP"], "ACTIVATION_PREVIEW_FAILED");
    return response(code, code === "ACTIVATION_SELECTION_CAP" ? 422 : 409);
  }
}
