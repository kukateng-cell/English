import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { lockRosterMutationState } from "@/lib/roster-server";
import { actorAuditFields, operationFingerprint, readReceiptForCommit, writeAdminReceipt } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";

type PromotionItem = { studentId: string; sourceEnrollmentId: string; sourceRevision: number; disposition: "PROMOTE" | "REPEAT" | "HOLD_UNASSIGNED" | "GRADUATE" | "LEAVE"; targetGrade: "JUNIOR_1" | "JUNIOR_2" | "JUNIOR_3" | "SENIOR_1" | "SENIOR_2" | "SENIOR_3"; targetClassId: string | null; targetClassCode: string | null; targetClassRevision?: number | null };
type PromotionPayload = { sourceAcademicYearId: string; targetAcademicYearId: string; sourceGrade: string; targetGrade: string | null; items: PromotionItem[] };

function response(code: string, status: number) { return NextResponse.json({ code }, { status }); }

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId : typeof body?.promotionBatchId === "string" ? body.promotionBatchId : "";
  const requestedOperationId = typeof body?.operationId === "string" ? body.operationId : null;
  if (!batchId) return response("PROMOTION_BATCH_REQUIRED", 422);
  try {
    const summary = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const batch = await tx.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId, operationKind: "PROMOTION" } });
      if (!batch) throw new Error("BATCH_NOT_FOUND");
      if (requestedOperationId && requestedOperationId !== batch.operationId) throw new Error("IDEMPOTENCY_CONFLICT");
      const operationId = batch.operationId;
      const requestFingerprint = operationFingerprint({ operationKind: "PROMOTION", batchId: batch.id, operationId, canonicalDigest: batch.canonicalDigest });
      const replay = await readReceiptForCommit(tx, { actorUserId: auth.userId, operationKind: "PROMOTION", operationId, requestFingerprint });
      if (replay) return { duplicate: true, summary: replay };
      if (batch.status === "COMMITTED") {
        const stored = typeof batch.counts === "object" && batch.counts ? batch.counts : {};
        await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "PROMOTION", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: stored as Prisma.InputJsonValue });
        return { duplicate: true, summary: stored };
      }
      if (batch.status !== "PREVIEWED" || batch.expiresAt <= new Date()) throw new Error("BATCH_EXPIRED");
      const payload = batch.payload as PromotionPayload | null;
      if (!payload?.items?.length) throw new Error("BATCH_INVALID");
      const source = await tx.academicYear.findUnique({ where: { id: payload.sourceAcademicYearId } });
      const target = await tx.academicYear.findUnique({ where: { id: payload.targetAcademicYearId } });
      const state = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
      if (!source || source.status !== "CURRENT" || !target || target.status !== "PLANNED" || source.revision !== batch.sourceYearRevision || target.revision !== batch.targetYearRevision || state.revision !== batch.rosterRevision) throw new Error("STALE_PREVIEW");
      const successor = await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: source.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } });
      if (successor?.id !== target.id) throw new Error("YEAR_NOT_SUCCESSOR");
      const sourceEnrollments = await tx.studentEnrollment.findMany({ where: { id: { in: payload.items.map((item) => item.sourceEnrollmentId) }, status: "ACTIVE", academicYearId: source.id }, select: { id: true, studentId: true, grade: true, revision: true } });
      const sourceById = new Map(sourceEnrollments.map((item) => [item.id, item]));
      if (sourceEnrollments.length !== payload.items.length || payload.items.some((item) => sourceById.get(item.sourceEnrollmentId)?.revision !== item.sourceRevision)) throw new Error("STALE_PREVIEW");
      const targetClassIds = [...new Set(payload.items.map((item) => item.targetClassId).filter((id): id is string => Boolean(id)))];
      const targetClasses = await tx.schoolClass.findMany({ where: { id: { in: targetClassIds }, academicYearId: target.id, active: true }, select: { id: true, revision: true } });
      const targetClassById = new Map(targetClasses.map((item) => [item.id, item]));
      if (payload.items.some((item) => item.targetClassId && (!targetClassById.has(item.targetClassId) || (item.targetClassRevision !== undefined && targetClassById.get(item.targetClassId)?.revision !== item.targetClassRevision)))) throw new Error("STALE_PREVIEW");
      let createdTargetCount = 0; let transitionCount = 0;
      for (const item of payload.items) {
        const sourceEnrollment = sourceById.get(item.sourceEnrollmentId)!;
        if (item.disposition === "GRADUATE" || item.disposition === "LEAVE") {
          const existingTarget = await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: item.studentId, academicYearId: target.id } }, select: { id: true, status: true } });
          if (existingTarget?.status === "PLANNED") await tx.studentEnrollment.delete({ where: { id: existingTarget.id } });
          if (existingTarget?.status === "ACTIVE") throw new Error("TERMINAL_TARGET_EXISTS");
          await tx.studentYearTransition.upsert({ where: { studentId_sourceAcademicYearId_targetAcademicYearId: { studentId: item.studentId, sourceAcademicYearId: source.id, targetAcademicYearId: target.id } }, create: { studentId: item.studentId, sourceEnrollmentId: sourceEnrollment.id, sourceAcademicYearId: source.id, targetAcademicYearId: target.id, disposition: item.disposition, ...actorAuditFields(auth.userId) }, update: { disposition: item.disposition, targetEnrollmentId: null, revision: { increment: 1 }, ...actorAuditFields(auth.userId) } });
          transitionCount += 1;
          continue;
        }
        const targetEnrollment = await tx.studentEnrollment.upsert({ where: { studentId_academicYearId: { studentId: item.studentId, academicYearId: target.id } }, create: { studentId: item.studentId, academicYearId: target.id, grade: item.targetGrade, classId: item.targetClassId, isCurrent: false, status: "PLANNED", origin: "PROMOTION", startedAt: null }, update: { grade: item.targetGrade, classId: item.targetClassId, isCurrent: false, status: "PLANNED", origin: "PROMOTION", startedAt: null, endedAt: null, revision: { increment: 1 } } });
        await tx.studentYearTransition.upsert({ where: { studentId_sourceAcademicYearId_targetAcademicYearId: { studentId: item.studentId, sourceAcademicYearId: source.id, targetAcademicYearId: target.id } }, create: { studentId: item.studentId, sourceEnrollmentId: sourceEnrollment.id, sourceAcademicYearId: source.id, targetAcademicYearId: target.id, disposition: item.disposition, targetEnrollmentId: targetEnrollment.id, ...actorAuditFields(auth.userId) }, update: { disposition: item.disposition, targetEnrollmentId: targetEnrollment.id, revision: { increment: 1 }, ...actorAuditFields(auth.userId) } });
        createdTargetCount += 1; transitionCount += 1;
      }
      const result = { promotedCount: payload.items.filter((item) => item.disposition === "PROMOTE").length, transitionCount, createdTargetCount, sourceAcademicYearId: source.id, targetAcademicYearId: target.id };
      await tx.adminMutationBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date(), counts: result, payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "PROMOTION", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: result });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `promotion:${batch.operationId}`, eventType: "STUDENTS_PROMOTED", ip: getClientIp(req.headers), metadata: result }) });
      return { duplicate: false, ...result };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const code = stableRosterCode(error, ["BATCH_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "BATCH_EXPIRED", "BATCH_INVALID", "STALE_PREVIEW", "YEAR_NOT_SUCCESSOR", "TERMINAL_TARGET_EXISTS"], "PROMOTION_COMMIT_FAILED");
    return response(code, code === "BATCH_EXPIRED" ? 410 : code === "BATCH_NOT_FOUND" ? 404 : 409);
  }
}
