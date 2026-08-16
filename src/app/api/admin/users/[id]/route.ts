import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { passwordPolicyError } from "@/lib/password-policy";
import { BCRYPT_COST, replacePasswordCredential } from "@/lib/password-credentials";
import { getClientIp } from "@/lib/login-limiter";
import { hasValidRecentAuthGrant, revokeRecentAuthGrants } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { securityEventData } from "@/lib/security-events";
import { contactEmailError, legalNameError, normalizeContactEmail, normalizeLegalName } from "@/lib/identity";
import { validateNicknameAgainstIdentity } from "@/lib/nickname";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";
import { deriveRolloverDisposition, parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { actorAuditFields } from "@/lib/admin-receipts";
import { isRetryableTransactionConflict, waitForTransactionRetry } from "@/lib/transaction-retry";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

async function cancelUserBatches(tx: Prisma.TransactionClient, userId: string) {
  const importLinks = await tx.rosterImportBatchUserLink.findMany({ where: { userId }, select: { batchId: true } });
  const mutationLinks = await tx.adminMutationBatchUserLink.findMany({ where: { userId }, select: { batchId: true } });
  if (importLinks.length) await tx.rosterImportBatch.updateMany({ where: { id: { in: importLinks.map((link) => link.batchId) }, status: { in: ["PREVIEWED", "EXPIRED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
  if (mutationLinks.length) await tx.adminMutationBatch.updateMany({ where: { id: { in: mutationLinks.map((link) => link.batchId) }, status: { in: ["PREVIEWED", "EXPIRED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
}

async function lockUserBatchRows(tx: Prisma.TransactionClient, userId: string) {
  const importBatchIds = (await tx.rosterImportBatch.findMany({
    where: {
      status: { in: ["PREVIEWED", "EXPIRED"] },
      OR: [{ actorUserId: userId }, { userLinks: { some: { userId } } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  })).map((batch) => batch.id);
  const mutationBatchIds = (await tx.adminMutationBatch.findMany({
    where: {
      status: { in: ["PREVIEWED", "EXPIRED"] },
      OR: [{ actorUserId: userId }, { userLinks: { some: { userId } } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  })).map((batch) => batch.id);
  for (const batchId of importBatchIds) {
    await tx.$queryRaw`SELECT "id" FROM "RosterImportBatch" WHERE "id" = ${batchId} FOR UPDATE`;
  }
  for (const batchId of mutationBatchIds) {
    await tx.$queryRaw`SELECT "id" FROM "AdminMutationBatch" WHERE "id" = ${batchId} FOR UPDATE`;
  }
  return { importBatchIds, mutationBatchIds };
}

async function ensureManualCurrentEnrollment(
  tx: Prisma.TransactionClient,
  input: { userId: string; grade: ReturnType<typeof parseStudentGrade>; classCode: ReturnType<typeof parseClassCode>; restoreMode?: string; actorUserId: string },
) {
  const currentYear = await tx.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: { startsOn: "desc" } });
  if (!currentYear) throw new Error("CURRENT_YEAR_MISSING");
  const targetYear = await tx.academicYear.findFirst({
    where: { status: "PLANNED", startsOn: { gt: currentYear.endsOn } },
    orderBy: [{ startsOn: "asc" }, { id: "asc" }],
  });
  const existingCurrent = await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: currentYear.id } } });
  const existingTarget = targetYear ? await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: targetYear.id } } }) : null;
  if (input.restoreMode === "PRE_ENROLLED" && existingTarget?.status === "PLANNED") return existingTarget;
  if (!input.grade) throw new Error("ENROLLMENT_GRADE_REQUIRED");
  if (existingCurrent?.status === "ACTIVE") return existingCurrent;
  const classRecord = input.classCode
    ? await tx.schoolClass.findUnique({ where: { academicYearId_grade_classCode: { academicYearId: currentYear.id, grade: input.grade, classCode: input.classCode } } })
    : null;
  if (input.classCode && (!classRecord || !classRecord.active)) throw new Error("CLASS_NOT_FOUND");
  const enrollment = existingCurrent
    ? await tx.studentEnrollment.update({ where: { id: existingCurrent.id }, data: { grade: input.grade, classId: classRecord?.id ?? null, isCurrent: true, status: "ACTIVE", origin: "MANUAL", startedAt: existingCurrent.startedAt ?? new Date(), endedAt: null, revision: { increment: 1 } } })
    : await tx.studentEnrollment.create({ data: { studentId: input.userId, academicYearId: currentYear.id, grade: input.grade, classId: classRecord?.id ?? null, isCurrent: true, status: "ACTIVE", origin: "MANUAL", startedAt: new Date() } });
  if (existingTarget?.status === "PLANNED" && targetYear) {
    const disposition = deriveRolloverDisposition(input.grade, existingTarget.grade, existingTarget.classId);
    if (!disposition) throw new Error("TRANSITION_DISPOSITION_REQUIRED");
    await tx.studentYearTransition.upsert({
      where: { studentId_sourceAcademicYearId_targetAcademicYearId: { studentId: input.userId, sourceAcademicYearId: currentYear.id, targetAcademicYearId: targetYear.id } },
      create: { studentId: input.userId, sourceEnrollmentId: enrollment.id, sourceAcademicYearId: currentYear.id, targetAcademicYearId: targetYear.id, disposition, targetEnrollmentId: existingTarget.id, ...actorAuditFields(input.actorUserId) },
      update: { sourceEnrollmentId: enrollment.id, disposition, targetEnrollmentId: existingTarget.id, revision: { increment: 1 }, ...actorAuditFields(input.actorUserId) },
    });
  }
  return enrollment;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return response("REQUEST_INVALID", 422);
  // Password changes for another account must go through the dedicated
  // prepare → commit reset flow. Keeping this guard at the legacy boundary
  // prevents callers that have not yet migrated from bypassing its
  // target-bound precondition, limiter and one-time-secret contract.
  if (Object.prototype.hasOwnProperty.call(body, "password")) return response("PASSWORD_FIELD_NOT_ALLOWED", 422);
  if (id === auth.userId && body.status === "SUSPENDED") return response("SELF_SUSPEND_FORBIDDEN", 409);
  const requestedPassword = typeof body.password === "string" && body.password.length > 0 ? body.password : null;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, contactEmail: true, studentProfile: { select: { legalName: true, nickname: true } } } });
  if (!target) return response("USER_NOT_FOUND", 404);
  if (body.role !== undefined && body.role !== target.role) return response("ROLE_IMMUTABLE", 422);
  const legalNameRequested = typeof body.legalName === "string" || typeof body.name === "string";
  const legalName = legalNameRequested ? normalizeLegalName(String(body.legalName ?? body.name ?? "")) : target.studentProfile?.legalName ?? "";
  if (legalNameRequested && target.role !== ROLES.ADMIN && legalNameError(legalName)) return response("LEGAL_NAME_INVALID", 422);
  const contactRequested = typeof body.contactEmail === "string";
  const contactEmail = contactRequested ? normalizeContactEmail(String(body.contactEmail)) : target.contactEmail;
  if (contactRequested && contactEmailError(String(body.contactEmail))) return response("CONTACT_EMAIL_INVALID", 422);
  const nicknameRequested = typeof body.nickname === "string";
  const nicknameValue = nicknameRequested ? String(body.nickname) : target.studentProfile?.nickname ?? "";
  const nickname = target.role === ROLES.STUDENT ? validateNicknameAgainstIdentity(nicknameValue, { legalName, accountName: target.accountName, contactEmail }) : null;
  if (nickname && !nickname.ok) return response("NICKNAME_INVALID", 422);
  if (requestedPassword) {
    const policyError = passwordPolicyError(requestedPassword);
    if (policyError) return response("PASSWORD_INVALID", 422);
    if (id === auth.userId) return response("SELF_PASSWORD_USE_PROFILE", 409);
  }
  const statusRequested = body.status === "ACTIVE" || body.status === "SUSPENDED";
  if (body.status !== undefined && !statusRequested) return response("STATUS_INVALID", 422);
  if (id === auth.userId && body.status === "SUSPENDED") return response("SELF_SUSPEND_FORBIDDEN", 409);
  const expectedRevision = body.revision === undefined ? undefined : Number(body.revision);
  const gradeProvided = target.role === ROLES.STUDENT && Object.prototype.hasOwnProperty.call(body, "grade");
  const classProvided = target.role === ROLES.STUDENT && Object.prototype.hasOwnProperty.call(body, "classCode");
  const requestedGrade = gradeProvided ? parseStudentGrade(body.grade) : null;
  const requestedClass = classProvided ? parseClassCode(body.classCode) : null;
  if (gradeProvided && !requestedGrade) return response("GRADE_INVALID", 422);
  if (classProvided && body.classCode !== null && body.classCode !== "" && !requestedClass) return response("CLASS_INVALID", 422);
  if (gradeProvided && !classProvided) return response("GRADE_CLASS_REQUIRED", 422);
  try {
    const passwordHash = requestedPassword ? await bcrypt.hash(requestedPassword, BCRYPT_COST) : null;
    const updated = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      await lockRosterIdentityKeys(tx, [target.accountName, contactEmail]);
      const fresh = await tx.user.findUnique({ where: { id }, select: { accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, revision: true } });
      if (!fresh) throw new Error("USER_NOT_FOUND");
      if (expectedRevision !== undefined && fresh.revision !== expectedRevision) throw new Error("STALE_PREVIEW");
      if (fresh.role === ROLES.ADMIN && body.status === "SUSPENDED") {
        const count = await tx.user.count({ where: { role: ROLES.ADMIN, status: "ACTIVE" } });
        if (count <= 1) throw new Error("LAST_ADMIN");
      }
      if (passwordHash) {
        const ok = await replacePasswordCredential(tx, { userId: id, passwordHash, mustChangePassword: id !== auth.userId, expectedCredentialRevision: fresh.credentialRevision, expectedTokenVersion: fresh.tokenVersion });
        if (!ok) throw new Error("STALE_PREVIEW");
      }
      const nextStatus = statusRequested ? body.status : fresh.status;
      const statusChanged = nextStatus !== fresh.status;
      if (statusChanged) {
        await tx.user.update({ where: { id }, data: { status: nextStatus, suspendedAt: nextStatus === "SUSPENDED" ? new Date() : null, suspendedReason: nextStatus === "SUSPENDED" ? String(body.suspendedReason ?? "由管理员暂停").trim().slice(0, 200) : null, tokenVersion: { increment: 1 }, revision: { increment: 1 } } });
        await revokeRecentAuthGrants(tx, id);
      }
      if (legalNameRequested || contactRequested || (nicknameRequested && nickname?.ok)) {
        await tx.user.update({ where: { id }, data: { ...(legalNameRequested ? { legacyName: legalName } : {}), ...(contactRequested ? { contactEmail, contactEmailCanonical: contactEmail } : {}), revision: { increment: 1 } } });
        if (fresh.role === ROLES.STUDENT) {
          await tx.studentProfile.update({ where: { userId: id }, data: { ...(legalNameRequested ? { legalName } : {}), ...(nickname?.ok && nicknameRequested ? { nickname: nickname.value, nicknameNormalized: nickname.normalized, nicknameUpdatedAt: new Date(), moderationPolicyVersion: "nickname-v1" } : {}), profileRevision: { increment: 1 } } });
        } else if (fresh.role === ROLES.TEACHER && legalNameRequested) {
          await tx.teacherProfile.update({ where: { userId: id }, data: { legalName, profileRevision: { increment: 1 } } });
        }
      }
      if (fresh.role === ROLES.STUDENT && (gradeProvided || classProvided || (statusChanged && nextStatus === "ACTIVE"))) {
        const existingCurrent = await tx.studentEnrollment.findFirst({ where: { studentId: id, academicYear: { status: "CURRENT" } } });
        if (gradeProvided || classProvided) {
          if (existingCurrent?.status !== "ACTIVE") throw new Error("CURRENT_ENROLLMENT_REQUIRED");
          const pending = await tx.studentYearTransition.findFirst({ where: { sourceEnrollmentId: existingCurrent.id, activatedAt: null } });
          if (pending) throw new Error("PENDING_TRANSITION_REQUIRES_REPLAN");
          const currentYear = await tx.academicYear.findFirst({ where: { status: "CURRENT" } });
          if (!currentYear) throw new Error("CURRENT_YEAR_MISSING");
          const nextClass = classProvided
            ? (requestedClass ? await tx.schoolClass.findUnique({ where: { academicYearId_grade_classCode: { academicYearId: currentYear.id, grade: requestedGrade ?? existingCurrent.grade, classCode: requestedClass } } }) : null)
            : existingCurrent.classId ? await tx.schoolClass.findUnique({ where: { id: existingCurrent.classId } }) : null;
          const nextGradeValue = requestedGrade ?? existingCurrent.grade;
          if (classProvided && body.classCode && (!nextClass || !nextClass.active)) throw new Error("CLASS_NOT_FOUND");
          if (requestedGrade && requestedGrade !== existingCurrent.grade && !classProvided) throw new Error("GRADE_CLASS_REQUIRED");
          await tx.studentEnrollment.update({ where: { id: existingCurrent.id }, data: { grade: nextGradeValue, classId: nextClass?.id ?? null, isCurrent: true, revision: { increment: 1 } } });
        } else if (statusChanged && nextStatus === "ACTIVE" && existingCurrent?.status !== "ACTIVE") {
          await ensureManualCurrentEnrollment(tx, { userId: id, grade: requestedGrade ?? null, classCode: requestedClass, restoreMode: typeof body.restoreMode === "string" ? body.restoreMode : undefined, actorUserId: auth.userId });
        }
      }
      if (requestedPassword || statusChanged) {
        await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: fresh.accountName, eventType: requestedPassword ? "PASSWORD_RESET_BY_ADMIN" : body.status === "SUSPENDED" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REACTIVATED", ip: getClientIp(req.headers) }) });
      }
      const result = await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, accountName: true, contactEmail: true, role: true, status: true, suspendedAt: true, legacyName: true, studentProfile: { select: { legalName: true, nickname: true } }, teacherProfile: { select: { legalName: true } } } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ id: updated.id, accountName: updated.accountName, email: updated.accountName, contactEmail: updated.contactEmail, legalName: updated.studentProfile?.legalName ?? updated.teacherProfile?.legalName ?? updated.legacyName, nickname: updated.studentProfile?.nickname ?? null, role: updated.role, status: updated.status, suspendedAt: updated.suspendedAt?.toISOString() ?? null, sessionInvalidated: Boolean(requestedPassword || statusRequested) });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return response("USER_NOT_FOUND", 404);
    if (error instanceof Error && error.message === "STALE_PREVIEW") return response("STALE_PREVIEW", 409);
    if (error instanceof Error && error.message === "LAST_ADMIN") return response("LAST_ADMIN_PROTECTION", 409);
    if (error instanceof Error && ["ENROLLMENT_GRADE_REQUIRED", "CURRENT_YEAR_MISSING", "CURRENT_ENROLLMENT_REQUIRED", "GRADE_CLASS_REQUIRED", "PENDING_TRANSITION_REQUIRES_REPLAN", "TRANSITION_DISPOSITION_REQUIRED"].includes(error.message)) return response(error.message, 409);
    if (error instanceof Error && ["GRADE_INVALID", "CLASS_INVALID", "REVISION_INVALID"].includes(error.message)) return response(error.message, 422);
    if (error instanceof Error && error.message === "CLASS_NOT_FOUND") return response(error.message, 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return response("ACCOUNT_OR_EMAIL_EXISTS", 409);
    return response("USER_UPDATE_FAILED", 409);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { id } = await params;
  if (id === auth.userId) return response("SELF_DELETE_FORBIDDEN", 409);
  const body = await req.json().catch(() => null);
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
  try {
    let transactionError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          await lockRosterMutationState(tx);
          await tx.$executeRaw`SELECT set_config('app.roster_hard_delete', 'on', true)`;
          const target = await tx.user.findUnique({ where: { id }, select: { accountName: true, role: true } });
          if (!target) throw new Error("USER_NOT_FOUND");
          if (confirmation !== target.accountName) throw new Error("CONFIRMATION_REQUIRED");
          // Keep hard-delete in the same global order as import/mutation commit:
          // state → identity advisory keys → batch rows → User row.  The API
          // path therefore cannot hold User while waiting on a batch that a
          // commit already holds while waiting on User.
          await lockRosterIdentityKeys(tx, [target.accountName]);
          await lockUserBatchRows(tx, id);
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
          if (target.role === ROLES.ADMIN && await tx.user.count({ where: { role: ROLES.ADMIN, status: "ACTIVE" } }) <= 1) throw new Error("LAST_ADMIN");
          await cancelUserBatches(tx, id);
          if (target.role === ROLES.STUDENT) {
            await tx.studentYearTransition.deleteMany({ where: { studentId: id } });
          }
          await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: target.accountName, eventType: "USER_DELETED", ip: getClientIp(req.headers), metadata: { role: target.role } }) });
          await tx.user.delete({ where: { id } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        transactionError = null;
        break;
      } catch (error) {
        transactionError = error;
        if (!isRetryableTransactionConflict(error) || attempt === 2) break;
        await waitForTransactionRetry(attempt);
      }
    }
    if (transactionError) throw transactionError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return response("USER_NOT_FOUND", 404);
    if (error instanceof Error && error.message === "CONFIRMATION_REQUIRED") return response("CONFIRMATION_REQUIRED", 422);
    if (error instanceof Error && error.message === "LAST_ADMIN") return response("LAST_ADMIN_PROTECTION", 409);
    if (isRetryableTransactionConflict(error)) return response("ROSTER_CONFLICT_RETRY", 409);
    return response("USER_DELETE_FAILED", 409);
  }
}
