import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertRosterSelectionCap, parseClassCode, studentNumberConflictKey } from "@/lib/roster-domain";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { lockRosterMutationState } from "@/lib/roster-server";
import { actorAuditFields, operationFingerprint, readReceiptForCommit, writeAdminReceipt } from "@/lib/admin-receipts";
import { touchRosterRevision } from "@/lib/teacher-workspace";

type BulkItem = { studentId: string; enrollmentId: string; revision: number; grade: string; currentClassId: string | null; targetClassId: string | null; targetClassRevision?: number | null };
type BulkPayload = { academicYearId: string; targetClassCode: string | null; items: BulkItem[]; excludedIds: string[]; filterHash?: string };

function response(code: string, status: number) { return NextResponse.json({ code }, { status }); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const body = await req.json().catch(() => null);
  const requestedOperationId = typeof body?.operationId === "string" ? body.operationId : null;
  const batchId = typeof body?.selectionBatchId === "string" ? body.selectionBatchId : typeof body?.batchId === "string" ? body.batchId : "";
  if (!batchId) return response("SELECTION_BATCH_REQUIRED", 422);
  try {
    const summary = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const batch = await tx.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId, operationKind: "BULK_CLASS" } });
      if (!batch) throw new Error("BATCH_NOT_FOUND");
      if (requestedOperationId && requestedOperationId !== batch.operationId) throw new Error("IDEMPOTENCY_CONFLICT");
      const operationId = batch.operationId;
      const requestFingerprint = operationFingerprint({ operationKind: "BULK_CLASS", batchId: batch.id, operationId, canonicalDigest: batch.canonicalDigest });
      const replay = await readReceiptForCommit(tx, { actorUserId: auth.userId, operationKind: "BULK_CLASS", operationId, requestFingerprint });
      if (replay) return { duplicate: true, summary: replay };
      if (batch.status === "COMMITTED") {
        const stored = typeof batch.counts === "object" && batch.counts ? batch.counts : {};
        await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "BULK_CLASS", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: stored as Prisma.InputJsonValue });
        return { duplicate: true, summary: stored };
      }
      if (batch.status !== "PREVIEWED" || batch.expiresAt <= new Date()) throw new Error("BATCH_EXPIRED");
      const payload = batch.payload as BulkPayload | null;
      if (!payload || !Array.isArray(payload.items)) throw new Error("BATCH_INVALID");
      const year = await tx.academicYear.findUnique({ where: { id: payload.academicYearId } });
      if (!year || year.status !== "CURRENT") throw new Error("CURRENT_YEAR_REQUIRED");
      const currentState = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
      if (batch.rosterRevision !== currentState.revision) throw new Error("STALE_PREVIEW");
      const ids = payload.items.map((item) => item.studentId);
      const enrollments = await tx.studentEnrollment.findMany({ where: { studentId: { in: ids }, academicYearId: year.id, status: "ACTIVE" }, select: { id: true, studentId: true, revision: true, classId: true, studentNumber: true } });
      const byStudent = new Map(enrollments.map((item) => [item.studentId, item]));
      if (enrollments.length !== ids.length || payload.items.some((item) => byStudent.get(item.studentId)?.revision !== item.revision || (item.currentClassId !== undefined && byStudent.get(item.studentId)?.classId !== item.currentClassId))) throw new Error("STALE_PREVIEW");
      const targetIds = [...new Set(payload.items.map((item) => item.targetClassId).filter((id): id is string => Boolean(id)))];
      const targetClasses = await tx.schoolClass.findMany({ where: { id: { in: targetIds }, academicYearId: year.id, active: true }, select: { id: true, revision: true } });
      const targetClassById = new Map(targetClasses.map((item) => [item.id, item]));
      if (payload.items.some((item) => item.targetClassId && (!targetClassById.has(item.targetClassId) || (item.targetClassRevision !== undefined && targetClassById.get(item.targetClassId)?.revision !== item.targetClassRevision)))) throw new Error("STALE_PREVIEW");
      const targetScopes: Prisma.StudentEnrollmentWhereInput[] = [];
      if (targetIds.length) targetScopes.push({ classId: { in: targetIds } });
      if (payload.items.some((item) => item.targetClassId === null)) targetScopes.push({ classId: null });
      const existingTargetNumbers = targetScopes.length ? await tx.studentEnrollment.findMany({ where: { academicYearId: year.id, studentNumber: { not: null }, studentId: { notIn: ids }, OR: targetScopes }, select: { classId: true, studentNumber: true } }) : [];
      const occupied = new Set(existingTargetNumbers.map((item) => studentNumberConflictKey(item.classId, item.studentNumber!)));
      const movingNumbers = new Set<string>();
      for (const item of payload.items) {
        const enrollment = byStudent.get(item.studentId);
        if (enrollment?.studentNumber !== null && enrollment?.studentNumber !== undefined) {
          const key = studentNumberConflictKey(item.targetClassId, enrollment.studentNumber);
          if (occupied.has(key) || movingNumbers.has(key)) throw new Error("STUDENT_NUMBER_CONFLICT");
          movingNumbers.add(key);
        }
      }
      let changedCount = 0;
      for (const item of payload.items) {
        const result = await tx.studentEnrollment.updateMany({ where: { id: item.enrollmentId, studentId: item.studentId, status: "ACTIVE", revision: item.revision }, data: { classId: item.targetClassId, revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error("STALE_PREVIEW");
        if (item.targetClassId !== item.currentClassId) changedCount += 1;
      }
      if (changedCount > 0) await touchRosterRevision(tx);
      const result = { changedCount, selectedCount: payload.items.length, academicYearId: year.id };
      await tx.adminMutationBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date(), counts: result, payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "BULK_CLASS", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: result });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `bulk-class:${operationId}`, eventType: "STUDENT_CLASS_CHANGED", ip: getClientIp(req.headers), metadata: result }) });
      return { duplicate: false, ...result };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("student_number")) return response("STUDENT_NUMBER_CONFLICT", 409);
    if (error instanceof Error && ["BATCH_NOT_FOUND", "BATCH_INVALID", "CURRENT_YEAR_REQUIRED", "BATCH_EXPIRED", "STALE_PREVIEW", "IDEMPOTENCY_CONFLICT", "STUDENT_NUMBER_CONFLICT"].includes(error.message)) return response(error.message, error.message === "BATCH_NOT_FOUND" ? 404 : error.message === "BATCH_EXPIRED" ? 410 : 409);
    return response("BULK_CLASS_FAILED", 409);
  }
}

export async function createBulkClassPreview(input: {
  req: Request;
  actorUserId: string;
  academicYearId: string;
  targetClassCode: string | null;
  studentIds: string[];
  excludedIds?: string[];
  filterHash?: string;
  operationId: string;
}) {
  const targetClassCode = input.targetClassCode === null ? null : parseClassCode(input.targetClassCode);
  if (input.targetClassCode !== null && !targetClassCode) throw new Error("CLASS_INVALID");
  assertRosterSelectionCap(input.studentIds.length);
  return prisma.$transaction(async (tx) => {
    await lockRosterMutationState(tx);
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId } });
    if (!year || year.status !== "CURRENT") throw new Error("CURRENT_YEAR_REQUIRED");
    const excluded = new Set(input.excludedIds ?? []);
    const enrollments = await tx.studentEnrollment.findMany({ where: { studentId: { in: input.studentIds.filter((id) => !excluded.has(id)) }, academicYearId: year.id, status: "ACTIVE", student: { user: { role: "STUDENT", status: "ACTIVE" } } }, select: { id: true, studentId: true, revision: true, grade: true, classId: true, studentNumber: true } });
    if (enrollments.length !== input.studentIds.filter((id) => !excluded.has(id)).length) throw new Error("STUDENT_SCOPE_INVALID");
    const classes = await tx.schoolClass.findMany({ where: { academicYearId: year.id, active: true, ...(targetClassCode ? { classCode: targetClassCode } : {}) }, select: { id: true, grade: true, classCode: true, revision: true } });
    const classMap = new Map(classes.map((item) => [`${item.grade}:${item.classCode}`, item.id]));
    const classRevisionMap = new Map(classes.map((item) => [`${item.grade}:${item.classCode}`, item.revision]));
    const payload: BulkPayload = { academicYearId: year.id, targetClassCode, excludedIds: [...excluded], filterHash: input.filterHash, items: enrollments.map((enrollment) => ({ studentId: enrollment.studentId, enrollmentId: enrollment.id, revision: enrollment.revision, grade: enrollment.grade, currentClassId: enrollment.classId, targetClassId: targetClassCode ? classMap.get(`${enrollment.grade}:${targetClassCode}`) ?? null : null, targetClassRevision: targetClassCode ? classRevisionMap.get(`${enrollment.grade}:${targetClassCode}`) ?? null : null })) };
    if (targetClassCode && payload.items.some((item) => item.targetClassId === null)) throw new Error("CLASS_NOT_FOUND");
    const targetIds = [...new Set(payload.items.map((item) => item.targetClassId).filter((id): id is string => Boolean(id)))];
    const targetScopes: Prisma.StudentEnrollmentWhereInput[] = [];
    if (targetIds.length) targetScopes.push({ classId: { in: targetIds } });
    if (payload.items.some((item) => item.targetClassId === null)) targetScopes.push({ classId: null });
    const existingTargetNumbers = targetScopes.length ? await tx.studentEnrollment.findMany({ where: { academicYearId: year.id, studentNumber: { not: null }, studentId: { notIn: payload.items.map((item) => item.studentId) }, OR: targetScopes }, select: { classId: true, studentNumber: true } }) : [];
    const occupied = new Set(existingTargetNumbers.map((item) => studentNumberConflictKey(item.classId, item.studentNumber!)));
    const moving = new Set<string>();
    for (const enrollment of enrollments) {
      const targetClassId = payload.items.find((item) => item.studentId === enrollment.studentId)?.targetClassId;
      if (enrollment.studentNumber === null || enrollment.studentNumber === undefined) continue;
      const key = studentNumberConflictKey(targetClassId ?? null, enrollment.studentNumber);
      if (occupied.has(key) || moving.has(key)) throw new Error("STUDENT_NUMBER_CONFLICT");
      moving.add(key);
    }
    const state = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
    const batch = await tx.adminMutationBatch.create({ data: { actorUserId: input.actorUserId, ...actorAuditFields(input.actorUserId), operationKind: "BULK_CLASS", operationId: input.operationId, rosterRevision: state.revision, calendarRevision: state.calendarRevision, sourceAcademicYearId: year.id, filterHash: input.filterHash, canonicalDigest: digest(payload), payload, counts: { selectedCount: payload.items.length, excludedCount: excluded.size }, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    await tx.adminMutationBatchUserLink.createMany({ data: payload.items.map((item) => ({ batchId: batch.id, userId: item.studentId, linkRole: "TARGET" as const })) });
    return { batchId: batch.id, operationId: batch.operationId, counts: batch.counts, payload: { academicYearId: year.id, targetClassCode, selectedCount: payload.items.length, excludedCount: excluded.size } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
