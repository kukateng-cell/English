import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertRosterSelectionCap, nextGrade, parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { lockRosterMutationState } from "@/lib/roster-server";
import { actorAuditFields, operationFingerprint } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";

function response(code: string, status: number) { return NextResponse.json({ code }, { status }); }

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const body = await req.json().catch(() => null);
  const sourceAcademicYearId = typeof body?.sourceAcademicYearId === "string" ? body.sourceAcademicYearId : "";
  const targetAcademicYearId = typeof body?.targetAcademicYearId === "string" ? body.targetAcademicYearId : "";
  const sourceGrade = parseStudentGrade(body?.sourceGrade);
  const targetGrade = sourceGrade ? nextGrade(sourceGrade) : null;
  const operationId = typeof body?.operationId === "string" ? body.operationId : randomUUID();
  if (!sourceAcademicYearId || !targetAcademicYearId || !sourceGrade) return response("PROMOTION_INPUT_INVALID", 422);
  const mappingInput = typeof body?.classMapping === "object" && body.classMapping !== null ? body.classMapping : {};
  const classMapping = new Map<string, ReturnType<typeof parseClassCode>>();
  for (const [source, target] of Object.entries(mappingInput)) {
    const sourceCode = parseClassCode(source);
    const targetCode = target === null || target === "" ? null : parseClassCode(target);
    if (!sourceCode || (target !== null && target !== "" && !targetCode)) return response("CLASS_MAPPING_INVALID", 422);
    classMapping.set(sourceCode, targetCode);
  }
  const excluded = new Set(Array.isArray(body?.excludedStudentIds) ? body.excludedStudentIds.filter((id: unknown): id is string => typeof id === "string") : []);
  const dispositionOverrides = new Map<string, "PROMOTE" | "REPEAT" | "HOLD_UNASSIGNED" | "GRADUATE" | "LEAVE">();
  if (body?.dispositions && typeof body.dispositions === "object" && !Array.isArray(body.dispositions)) {
    for (const [studentId, value] of Object.entries(body.dispositions)) {
      if (value !== "PROMOTE" && value !== "REPEAT" && value !== "HOLD_UNASSIGNED" && value !== "GRADUATE" && value !== "LEAVE") return response("PROMOTION_DISPOSITION_INVALID", 422);
      dispositionOverrides.set(studentId, value);
    }
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const source = await tx.academicYear.findUnique({ where: { id: sourceAcademicYearId } });
      const target = await tx.academicYear.findUnique({ where: { id: targetAcademicYearId } });
      if (!source || source.status !== "CURRENT" || !target || target.status !== "PLANNED") throw new Error("YEAR_STATE_INVALID");
      const successor = await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: source.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } });
      if (successor?.id !== target.id) throw new Error("YEAR_NOT_SUCCESSOR");
      const enrollments = await tx.studentEnrollment.findMany({ where: { academicYearId: source.id, grade: sourceGrade, status: "ACTIVE", student: { user: { role: ROLES.STUDENT } } }, orderBy: [{ student: { user: { accountName: "asc" } } }, { studentId: "asc" }], select: { id: true, studentId: true, grade: true, revision: true, classId: true, schoolClass: { select: { classCode: true } }, student: { select: { legalName: true, nickname: true, user: { select: { accountName: true, status: true } } } } } });
      assertRosterSelectionCap(enrollments.length);
      const targetClasses = await tx.schoolClass.findMany({ where: { academicYearId: target.id, active: true }, select: { id: true, grade: true, classCode: true, revision: true } });
      const classMap = new Map(targetClasses.map((item) => [`${item.grade}:${item.classCode}`, item.id]));
      const classRevisionMap = new Map(targetClasses.map((item) => [`${item.grade}:${item.classCode}`, item.revision]));
      const items = enrollments.map((enrollment) => {
        const override = dispositionOverrides.get(enrollment.studentId);
        // Suspended students still need an explicit rollover outcome so an
        // active source roster can pass the activation completeness gate. The
        // activation transaction preserves their suspended account status.
        const included = !excluded.has(enrollment.studentId);
        if (excluded.has(enrollment.studentId) && !override) throw new Error("PROMOTION_DISPOSITION_REQUIRED");
        const sourceClass = enrollment.schoolClass?.classCode ?? null;
        const mapped = sourceClass ? classMapping.get(sourceClass) ?? sourceClass : null;
        const disposition = override ?? (targetGrade ? (included ? "PROMOTE" : "HOLD_UNASSIGNED") : (included ? "GRADUATE" : "HOLD_UNASSIGNED"));
        if (disposition === "PROMOTE" && !targetGrade) throw new Error("PROMOTION_DISPOSITION_INVALID");
        if (disposition === "GRADUATE" && targetGrade) throw new Error("PROMOTION_DISPOSITION_INVALID");
        const effectiveGrade = disposition === "PROMOTE" && targetGrade ? targetGrade : sourceGrade;
        const targetClassCode = disposition === "HOLD_UNASSIGNED" || disposition === "GRADUATE" || disposition === "LEAVE" ? null : mapped;
        if (disposition === "REPEAT" && !targetClassCode) throw new Error("TARGET_CLASS_REQUIRED");
        const targetClassId = targetClassCode ? classMap.get(`${effectiveGrade}:${targetClassCode}`) ?? null : null;
        const targetClassRevision = targetClassCode ? classRevisionMap.get(`${effectiveGrade}:${targetClassCode}`) ?? null : null;
        return { studentId: enrollment.studentId, sourceEnrollmentId: enrollment.id, sourceRevision: enrollment.revision, accountName: enrollment.student.user.accountName, legalName: enrollment.student.legalName, nickname: enrollment.student.nickname, sourceClassCode: sourceClass, disposition, targetGrade: effectiveGrade, targetClassCode, targetClassId, targetClassRevision };
      });
      if (items.some((item) => ["PROMOTE", "REPEAT"].includes(item.disposition) && item.targetClassCode && !item.targetClassId)) throw new Error("TARGET_CLASS_NOT_FOUND");
      if ([...excluded].some((studentId) => !items.some((item) => item.studentId === studentId))) throw new Error("PROMOTION_STUDENT_NOT_FOUND");
      const state = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
      // The preview response may show the admin the account/legal/nickname
      // columns, but the actor-bound mutation payload must remain ID/revision
      // only.  This keeps staged AdminMutationBatch rows free of direct PII;
      // commit re-reads authoritative rows under the same CAS contract.
      const payloadItems = items.map((item) => ({
        studentId: item.studentId,
        sourceEnrollmentId: item.sourceEnrollmentId,
        sourceRevision: item.sourceRevision,
        disposition: item.disposition,
        targetGrade: item.targetGrade,
        targetClassId: item.targetClassId,
        targetClassCode: item.targetClassCode,
        targetClassRevision: item.targetClassRevision,
      }));
      const payload = { sourceAcademicYearId: source.id, targetAcademicYearId: target.id, sourceGrade, targetGrade, items: payloadItems };
      const batch = await tx.adminMutationBatch.create({ data: { actorUserId: auth.userId, ...actorAuditFields(auth.userId), operationKind: "PROMOTION", operationId, sourceAcademicYearId: source.id, targetAcademicYearId: target.id, sourceYearRevision: source.revision, targetYearRevision: target.revision, rosterRevision: state.revision, calendarRevision: state.calendarRevision, canonicalDigest: operationFingerprint(payload), payload, counts: { selectedCount: items.length, excludedCount: excluded.size }, expiresAt: new Date(Date.now() + 30 * 60_000) } });
      await tx.adminMutationBatchUserLink.createMany({ data: items.map((item) => ({ batchId: batch.id, userId: item.studentId, linkRole: "TARGET" as const })) });
      return { batchId: batch.id, operationId: batch.operationId, sourceAcademicYear: source.label, targetAcademicYear: target.label, sourceGrade, targetGrade, count: items.length, students: items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["YEAR_STATE_INVALID", "YEAR_NOT_SUCCESSOR", "SELECTION_CAP", "TARGET_CLASS_NOT_FOUND", "TARGET_CLASS_REQUIRED", "PROMOTION_DISPOSITION_REQUIRED", "PROMOTION_DISPOSITION_INVALID", "PROMOTION_STUDENT_NOT_FOUND"], "PROMOTION_PREVIEW_FAILED");
    return response(code, ["TARGET_CLASS_NOT_FOUND", "TARGET_CLASS_REQUIRED", "PROMOTION_DISPOSITION_REQUIRED", "PROMOTION_DISPOSITION_INVALID", "PROMOTION_STUDENT_NOT_FOUND", "SELECTION_CAP"].includes(code) ? 422 : 409);
  }
}
