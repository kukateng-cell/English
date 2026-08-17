import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { passwordCredentialCreateData } from "@/lib/password-credentials";
import { isStagedRosterRows } from "@/lib/roster-import-contract";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";
import { securityEventData } from "@/lib/security-events";
import { ROLES as ROLE_VALUES } from "@/lib/roles";
import { prepareCredentials } from "@/lib/credential-batch";
import { actorAuditFields } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";
import { deriveRolloverDisposition } from "@/lib/roster-domain";
import { touchRosterRevision } from "@/lib/teacher-workspace";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

async function upsertStudentEnrollment(
  tx: Prisma.TransactionClient,
  input: { userId: string; academicYearId: string; yearStatus: "CURRENT" | "PLANNED"; grade: NonNullable<import("@/generated/prisma").StudentGrade>; classId: string | null; studentNumber: number | null; actorUserId: string },
) {
  const existing = await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: input.academicYearId } } });
  let classId = input.classId;
  if (existing && input.classId === null && existing.grade === input.grade) classId = existing.classId;
  if (existing && input.classId === null && existing.grade !== input.grade) throw new Error("GRADE_CLASS_REQUIRED");
  const status = input.yearStatus === "CURRENT" ? "ACTIVE" : "PLANNED";
  if (existing && existing.status === "ACTIVE" && input.yearStatus === "CURRENT" && (existing.grade !== input.grade || existing.classId !== classId)) {
    const pending = await tx.studentYearTransition.findFirst({ where: { sourceEnrollmentId: existing.id, activatedAt: null }, select: { id: true } });
    if (pending) throw new Error("PENDING_TRANSITION_REQUIRES_REPLAN");
  }
  const data = input.yearStatus === "CURRENT"
    ? { grade: input.grade, classId, studentNumber: input.studentNumber, isCurrent: true, status: "ACTIVE" as const, origin: "IMPORT" as const, startedAt: existing?.startedAt ?? new Date(), endedAt: null, revision: { increment: 1 } }
    : { grade: input.grade, classId, studentNumber: input.studentNumber, isCurrent: false, status: "PLANNED" as const, origin: "IMPORT" as const, startedAt: null, endedAt: null, revision: { increment: 1 } };
  const enrollment = existing
    ? await tx.studentEnrollment.update({ where: { id: existing.id }, data })
    : await tx.studentEnrollment.create({ data: { studentId: input.userId, academicYearId: input.academicYearId, grade: input.grade, classId, studentNumber: input.studentNumber, isCurrent: input.yearStatus === "CURRENT", status, origin: "IMPORT", startedAt: input.yearStatus === "CURRENT" ? new Date() : null } });

  if (input.yearStatus === "PLANNED") {
    const source = await tx.studentEnrollment.findFirst({ where: { studentId: input.userId, status: "ACTIVE", academicYear: { status: "CURRENT" } }, include: { academicYear: true } });
    if (source) {
      const successor = await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: source.academicYear.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } });
      if (successor?.id !== input.academicYearId) throw new Error("ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR");
      const disposition = deriveRolloverDisposition(source.grade, input.grade, classId);
      if (!disposition) throw new Error("TRANSITION_DISPOSITION_REQUIRED");
      if (source.academicYearId === input.academicYearId) throw new Error("YEAR_TRANSITION_INVALID");
      await tx.studentYearTransition.upsert({
        where: { studentId_sourceAcademicYearId_targetAcademicYearId: { studentId: input.userId, sourceAcademicYearId: source.academicYearId, targetAcademicYearId: input.academicYearId } },
        create: { studentId: input.userId, sourceEnrollmentId: source.id, sourceAcademicYearId: source.academicYearId, targetAcademicYearId: input.academicYearId, disposition, targetEnrollmentId: enrollment.id, ...actorAuditFields(input.actorUserId) },
        update: { disposition, targetEnrollmentId: enrollment.id, revision: { increment: 1 }, ...actorAuditFields(input.actorUserId) },
      });
    }
  } else {
    // A planned-first incoming row may later be merged into the current year.
    // The deferred completeness invariant requires the reverse writer to
    // create the same transition that promotion/import would have created.
    const currentYear = await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { id: true, status: true, endsOn: true } });
    const targetYear = currentYear?.status === "CURRENT"
      ? await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: currentYear.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } })
      : null;
    const target = targetYear
      ? await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: targetYear.id } }, select: { id: true, grade: true, classId: true, status: true } })
      : null;
    if (target?.status === "PLANNED") {
      const disposition = deriveRolloverDisposition(enrollment.grade, target.grade, target.classId);
      if (!disposition) throw new Error("TRANSITION_DISPOSITION_REQUIRED");
      await tx.studentYearTransition.upsert({
        where: { studentId_sourceAcademicYearId_targetAcademicYearId: { studentId: input.userId, sourceAcademicYearId: input.academicYearId, targetAcademicYearId: targetYear!.id } },
        create: { studentId: input.userId, sourceEnrollmentId: enrollment.id, sourceAcademicYearId: input.academicYearId, targetAcademicYearId: targetYear!.id, disposition, targetEnrollmentId: target.id, ...actorAuditFields(input.actorUserId) },
        update: { sourceEnrollmentId: enrollment.id, disposition, targetEnrollmentId: target.id, revision: { increment: 1 }, ...actorAuditFields(input.actorUserId) },
      });
    }
  }
  return enrollment;
}

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { batchId } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) return response("ROSTER_INPUT_INVALID", 422);
  const rawBody = await req.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return response("ROSTER_INPUT_INVALID", 422);
  const body = (() => { try { return JSON.parse(rawBody) as { operationId?: unknown }; } catch { return null; } })();
  const requestedOperationId = typeof body?.operationId === "string" ? body.operationId : null;
  const batch = await prisma.rosterImportBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId } });
  if (!batch) return response("ROSTER_BATCH_NOT_FOUND", 404);
  if (requestedOperationId && requestedOperationId !== batch.operationId) return response("IDEMPOTENCY_CONFLICT", 409);
  if (batch.status === "COMMITTED") return NextResponse.json({ ok: true, alreadyCommitted: true, credentialReportAvailable: false, summary: batch.summary }, { headers: { "Cache-Control": "no-store" } });
  if (batch.status !== "PREVIEWED") return response("ROSTER_BATCH_TERMINAL", 409);
  if (batch.expiresAt <= new Date()) {
    await prisma.rosterImportBatch.update({ where: { id: batch.id }, data: { status: "EXPIRED", stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
    return response("ROSTER_BATCH_EXPIRED", 410);
  }
  if (batch.errorCount > 0 || !isStagedRosterRows(batch.stagedRows) || !batch.academicYearId) return response("ROSTER_BATCH_NOT_COMMITTABLE", 409);
  const academicYearId = batch.academicYearId;
  const rows = batch.stagedRows;
  const credentials = await prepareCredentials(rows.filter((row) => row.action === "CREATE").map((row) => row.accountName));
  const credentialByAccount = new Map(credentials.map((item) => [item.accountName, item]));
  const ip = getClientIp(req.headers);
  const transactionStartedAt = performance.now();
  try {
    const summary = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      await lockRosterIdentityKeys(tx, rows.flatMap((row) => [row.accountName, row.contactEmail]));
      // Hashing happens outside the transaction, so lock and re-read the
      // staged batch before any write.  This closes the cancel/expiry race
      // without changing the global roster lock order (state → batch → user).
      await tx.$queryRaw`SELECT "id" FROM "RosterImportBatch" WHERE "id" = ${batch.id} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { role: true, status: true, accountName: true } });
      if (!actor || actor.role !== ROLE_VALUES.ADMIN || actor.status !== "ACTIVE") throw new Error("ACTOR_INVALID");
      const state = await tx.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true, calendarRevision: true } });
      if (!state || state.revision !== batch.rosterRevision || state.calendarRevision !== batch.calendarRevision) throw new Error("STALE_PREVIEW");
      const lockedBatch = await tx.rosterImportBatch.findUnique({ where: { id: batch.id } });
      if (!lockedBatch || lockedBatch.status !== "PREVIEWED" || lockedBatch.expiresAt <= new Date() || lockedBatch.canonicalDigest !== batch.canonicalDigest || lockedBatch.fingerprint !== batch.fingerprint || lockedBatch.academicYearId !== batch.academicYearId || lockedBatch.operationId !== batch.operationId) throw new Error("STALE_PREVIEW");
      const batchSummary = lockedBatch.summary && typeof lockedBatch.summary === "object" && !Array.isArray(lockedBatch.summary) ? lockedBatch.summary as { immediateGlobalCapabilityChange?: unknown; acknowledgeImmediateGlobalCapabilityChange?: unknown } : {};
      if (batchSummary.immediateGlobalCapabilityChange === true && batchSummary.acknowledgeImmediateGlobalCapabilityChange !== true) throw new Error("IMMEDIATE_EFFECT_ACK_REQUIRED");
      const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
      if (!year || year.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
      if (batch.entityType === "STUDENT" && year.status === "PLANNED") {
        const current = await tx.academicYear.findFirst({ where: { status: "CURRENT" } });
        const successor = current ? await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: current.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }] }) : null;
        if (!current || successor?.id !== year.id) throw new Error("ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR");
      }
      const classes = await tx.schoolClass.findMany({ where: { academicYearId: year.id, active: true }, select: { id: true, grade: true, classCode: true } });
      const classMap = new Map(classes.map((item) => [`${item.grade}:${item.classCode}`, item.id]));
      let createdCount = 0; let updatedCount = 0; let skippedCount = 0;
      const createdIds: string[] = [];
      for (const row of rows) {
        const existing = await tx.user.findFirst({ where: { OR: [{ accountName: row.accountName }, { accountNameCanonical: row.accountName }] }, select: { id: true, role: true, contactEmail: true, contactEmailCanonical: true } });
        const expectedRole = row.entityType === "STUDENT" ? ROLE_VALUES.STUDENT : ROLE_VALUES.TEACHER;
        if (existing && existing.role !== expectedRole) throw new Error("ROLE_COLLISION");
        if (row.action === "CREATE" && existing) throw new Error("ACCOUNT_COLLISION");
        if (row.action !== "CREATE" && !existing) throw new Error("ACCOUNT_CHANGED");
        let userId: string;
        if (row.action === "CREATE") {
          const credential = credentialByAccount.get(row.accountName);
          if (!credential) throw new Error("CREDENTIAL_MISSING");
          if (row.entityType === "STUDENT") {
            if (!row.grade) throw new Error("GRADE_MISSING");
            const classId = row.classCode ? classMap.get(`${row.grade}:${row.classCode}`) ?? null : null;
            if (row.classCode && !classId) throw new Error("CLASS_NOT_FOUND");
            const created = await tx.user.create({ data: { accountName: row.accountName, accountNameCanonical: row.accountName, contactEmail: row.contactEmail, contactEmailCanonical: row.contactEmail, legacyName: row.legalName, role: ROLE_VALUES.STUDENT, ...passwordCredentialCreateData({ passwordHash: credential.passwordHash, mustChangePassword: true }), studentProfile: { create: { legalName: row.legalName, nickname: row.nickname, nicknameNormalized: row.nicknameNormalized, moderationPolicyVersion: "nickname-v1", enrollments: { create: { academicYearId: year.id, grade: row.grade, classId, studentNumber: row.studentNumber, isCurrent: year.status === "CURRENT", status: year.status === "CURRENT" ? "ACTIVE" : "PLANNED", origin: "IMPORT", startedAt: year.status === "CURRENT" ? new Date() : null } } } } }, select: { id: true } });
            userId = created.id;
          } else {
            const created = await tx.user.create({ data: { accountName: row.accountName, accountNameCanonical: row.accountName, contactEmail: row.contactEmail, contactEmailCanonical: row.contactEmail, legacyName: row.legalName, role: ROLE_VALUES.TEACHER, ...passwordCredentialCreateData({ passwordHash: credential.passwordHash, mustChangePassword: true }), teacherProfile: { create: { legalName: row.legalName, canResetStudentPassword: row.canResetStudentPassword ?? false } } }, select: { id: true } });
            userId = created.id;
          }
          createdIds.push(userId); createdCount += 1;
        } else if (row.action === "UNCHANGED") {
          userId = existing!.id; skippedCount += 1;
        } else {
          userId = existing!.id;
          const nextContactEmail = row.contactEmailAction === "PRESERVE" ? undefined : row.contactEmailAction === "CLEAR" ? null : row.contactEmail;
          await tx.user.update({ where: { id: userId }, data: { ...(nextContactEmail === undefined ? {} : { contactEmail: nextContactEmail, contactEmailCanonical: nextContactEmail }), legacyName: row.legalName, revision: { increment: 1 } } });
          if (row.entityType === "STUDENT") {
            if (!row.grade) throw new Error("GRADE_MISSING");
            const profile = await tx.studentProfile.findUnique({ where: { userId }, select: { legalName: true, nickname: true } });
            if (!profile) throw new Error("PROFILE_MISSING");
            await tx.studentProfile.update({ where: { userId }, data: { legalName: row.legalName, nickname: row.nickname, nicknameNormalized: row.nicknameNormalized, moderationPolicyVersion: "nickname-v1", profileRevision: { increment: 1 } } });
            const classId = row.classCode ? classMap.get(`${row.grade}:${row.classCode}`) ?? null : null;
            if (row.classCode && !classId) throw new Error("CLASS_NOT_FOUND");
            await upsertStudentEnrollment(tx, { userId, academicYearId: year.id, yearStatus: year.status, grade: row.grade, classId, studentNumber: row.studentNumber, actorUserId: auth.userId });
          } else {
            const profile = await tx.teacherProfile.findUnique({ where: { userId }, select: { canResetStudentPassword: true } });
            if (!profile) throw new Error("PROFILE_MISSING");
            await tx.teacherProfile.update({ where: { userId }, data: { legalName: row.legalName, ...(row.canResetStudentPassword === undefined ? {} : { canResetStudentPassword: row.canResetStudentPassword }), profileRevision: { increment: 1 }, ...(row.canResetStudentPassword !== undefined && row.canResetStudentPassword !== profile.canResetStudentPassword ? { accessRevision: { increment: 1 } } : {}) } });
          }
          updatedCount += 1;
        }
        if (row.entityType === "TEACHER") {
          if (row.action !== "UNCHANGED") {
            if (row.accessAction !== "PRESERVE") {
              await tx.teacherClassAccess.deleteMany({ where: { teacherId: userId, schoolClass: { academicYearId: year.id } } });
              const globalReset = row.canResetStudentPassword ?? (await tx.teacherProfile.findUniqueOrThrow({ where: { userId }, select: { canResetStudentPassword: true } })).canResetStudentPassword;
              for (const access of row.access) {
                const classId = classMap.get(`${access.grade}:${access.classCode}`);
                if (!classId) throw new Error("CLASS_NOT_FOUND");
                await tx.teacherClassAccess.create({ data: { teacherId: userId, classId, canViewProgress: true, canResetStudentPassword: globalReset, grantedById: auth.userId } });
              }
              await tx.teacherProfile.update({ where: { userId }, data: { accessRevision: { increment: 1 } } });
            }
            if (row.canResetStudentPassword !== undefined) {
              await tx.teacherClassAccess.updateMany({ where: { teacherId: userId, schoolClass: { academicYear: { status: { in: ["CURRENT", "PLANNED"] } } } }, data: { canResetStudentPassword: row.canResetStudentPassword } });
            }
          }
        }
        await tx.rosterImportBatchUserLink.upsert({ where: { batchId_userId_linkRole: { batchId: batch.id, userId, linkRole: "TARGET" } }, create: { batchId: batch.id, userId, linkRole: "TARGET" }, update: {} });
      }
      if (createdCount > 0 || updatedCount > 0) await touchRosterRevision(tx);
      const result = { operationId: batch.operationId, createdCount, updatedCount, skippedCount, rowCount: rows.length };
      const createdSnapshots = createdIds.length
        ? await tx.user.findMany({ where: { id: { in: createdIds } }, select: { id: true, credentialRevision: true, tokenVersion: true } })
        : [];
      if (createdIds.length) {
        await tx.rosterImportBatchUserLink.createMany({ data: createdIds.map((userId) => ({ batchId: batch.id, userId, linkRole: "ROTATION_ELIGIBLE" as const })) });
      }
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `roster-batch:${batch.id}`, eventType: "ROSTER_IMPORTED", ip, metadata: { batchId: batch.id, entityType: batch.entityType, ...result } }) });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `roster-import:${batch.id}`, eventType: "ROSTER_IMPORT_COMMITTED", ip, metadata: result }) });
      await tx.rosterImportBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date(), createdCount, updatedCount, skippedCount, stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull, summary: { ...result, credentialSnapshots: createdSnapshots } } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
    const transactionElapsedMs = performance.now() - transactionStartedAt;
    const legalNames = new Map(rows.filter((row) => row.action === "CREATE").map((row) => [row.accountName, row.legalName]));
    return NextResponse.json({ ok: true, summary, credentials: credentials.map(({ accountName, temporaryPassword }) => ({ accountName, legalName: legalNames.get(accountName) ?? "", temporaryPassword })) }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Server-Timing": `roster-transaction;dur=${transactionElapsedMs.toFixed(1)}` } });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PREVIEW") return response("ROSTER_BATCH_STALE", 409);
    if (error instanceof Error && error.message === "ROSTER_BATCH_EXPIRED") return response(error.message, 410);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return response(String(error.meta?.target ?? "").includes("student_number") ? "STUDENT_NUMBER_CONFLICT" : "ROSTER_ACCOUNT_CONFLICT", 409);
    const code = stableRosterCode(error, ["ROSTER_INPUT_INVALID", "IMMEDIATE_EFFECT_ACK_REQUIRED", "ACTOR_INVALID", "ACADEMIC_YEAR_READ_ONLY", "ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR", "ROLE_COLLISION", "ACCOUNT_COLLISION", "ACCOUNT_CHANGED", "CREDENTIAL_MISSING", "GRADE_MISSING", "CLASS_NOT_FOUND", "PROFILE_MISSING", "GRADE_CLASS_REQUIRED", "PENDING_TRANSITION_REQUIRES_REPLAN", "TRANSITION_DISPOSITION_REQUIRED", "YEAR_TRANSITION_INVALID", "ROSTER_MUTATION_STATE_MISSING"], "ROSTER_COMMIT_FAILED");
    return response(code, code === "ROSTER_INPUT_INVALID" ? 422 : code === "IMMEDIATE_EFFECT_ACK_REQUIRED" ? 422 : 409);
  }
}
