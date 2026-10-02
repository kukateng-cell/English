import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getClientIp } from "@/lib/login-limiter";
import { getRequestToken, hashSessionJti, hasValidRecentAuthGrant, readRecentAuthGrantSnapshot, revokeRecentAuthGrants } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { securityEventData } from "@/lib/security-events";
import { contactEmailError, legalNameError, normalizeContactEmail, normalizeLegalName } from "@/lib/identity";
import { validateNicknameAgainstIdentity } from "@/lib/nickname";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";
import { deriveRolloverDisposition, parseClassCode, parseStudentGrade, parseStudentNumber } from "@/lib/roster-domain";
import { actorAuditFields } from "@/lib/admin-receipts";
import { isRetryableTransactionConflict, waitForTransactionRetry } from "@/lib/transaction-retry";
import { touchRosterRevision } from "@/lib/teacher-workspace";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}

const BODY_LIMIT = 16 * 1024;
const ADMIN_MUTATION_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

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
  input: { userId: string; grade: ReturnType<typeof parseStudentGrade>; classCode: ReturnType<typeof parseClassCode>; studentNumber?: number | null; restoreMode?: string; actorUserId: string },
) {
  const currentYear = await tx.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: { startsOn: "desc" } });
  if (!currentYear) throw new Error("CURRENT_YEAR_MISSING");
  const targetYear = await tx.academicYear.findFirst({
    where: { status: "PLANNED", startsOn: { gt: currentYear.endsOn } },
    orderBy: [{ startsOn: "asc" }, { id: "asc" }],
  });
  const existingCurrent = await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: currentYear.id } } });
  const existingTarget = targetYear ? await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: input.userId, academicYearId: targetYear.id } } }) : null;
  if (input.restoreMode === "PRE_ENROLLED" && existingTarget?.status === "PLANNED") {
    if (input.studentNumber !== undefined && existingTarget.studentNumber !== input.studentNumber) {
      return tx.studentEnrollment.update({ where: { id: existingTarget.id }, data: { studentNumber: input.studentNumber, revision: { increment: 1 } } });
    }
    return existingTarget;
  }
  if (!input.grade) throw new Error("ENROLLMENT_GRADE_REQUIRED");
  const classRecord = input.classCode
    ? await tx.schoolClass.findUnique({ where: { academicYearId_grade_classCode: { academicYearId: currentYear.id, grade: input.grade, classCode: input.classCode } } })
    : null;
  if (input.classCode && (!classRecord || !classRecord.active)) throw new Error("CLASS_NOT_FOUND");
  if (existingCurrent?.status === "ACTIVE") {
    const classChanged = (existingCurrent.classId ?? null) !== (classRecord?.id ?? null);
    const gradeChanged = existingCurrent.grade !== input.grade;
    const numberChanged = input.studentNumber !== undefined && existingCurrent.studentNumber !== input.studentNumber;
    if (classChanged || gradeChanged || numberChanged) {
      return tx.studentEnrollment.update({ where: { id: existingCurrent.id }, data: { grade: input.grade, classId: classRecord?.id ?? null, ...(input.studentNumber !== undefined ? { studentNumber: input.studentNumber } : {}), revision: { increment: 1 } } });
    }
    return existingCurrent;
  }
  const enrollment = existingCurrent
    ? await tx.studentEnrollment.update({ where: { id: existingCurrent.id }, data: { grade: input.grade, classId: classRecord?.id ?? null, ...(input.studentNumber !== undefined ? { studentNumber: input.studentNumber } : {}), isCurrent: true, status: "ACTIVE", origin: "MANUAL", startedAt: existingCurrent.startedAt ?? new Date(), endedAt: null, revision: { increment: 1 } } })
    : await tx.studentEnrollment.create({ data: { studentId: input.userId, academicYearId: currentYear.id, grade: input.grade, classId: classRecord?.id ?? null, studentNumber: input.studentNumber ?? null, isCurrent: true, status: "ACTIVE", origin: "MANUAL", startedAt: new Date() } });
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
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  const { id } = await params;
  if (!id || Buffer.byteLength(id, "utf8") > 128) return response("REQUEST_INVALID", 422);
  if (Number(req.headers.get("content-length") ?? 0) > BODY_LIMIT) return response("PAYLOAD_TOO_LARGE", 413);
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) return response("PAYLOAD_TOO_LARGE", 413);
  const body = await (async () => { try { return (raw ? JSON.parse(raw) : null) as Record<string, unknown> | null; } catch { return null; } })();
  if (!body || typeof body.operation !== "string") return response("REQUEST_INVALID", 422);
  const operation = body.operation;
  const allowedIdentity = new Set(["operation", "legalName", "contactEmail", "nickname", "expectedUserRevision", "expectedProfileRevision"]);
  const allowedEnrollment = new Set(["operation", "studentNumber", "expectedUserRevision", "expectedEnrollmentRevision", "expectedRosterRevision"]);
  const allowedStatus = new Set(["operation", "status", "suspendedReason", "restoreMode", "grade", "classCode", "studentNumber", "expectedUserRevision"]);
  const allowed = operation === "UPDATE_IDENTITY" ? allowedIdentity : operation === "CHANGE_STATUS" ? allowedStatus : operation === "UPDATE_ENROLLMENT" ? allowedEnrollment : null;
  if (!allowed || Object.keys(body).some((key) => !allowed.has(key))) return response(Object.prototype.hasOwnProperty.call(body, "password") ? "PASSWORD_FIELD_NOT_ALLOWED" : "REQUEST_INVALID", 422);
  const grantSnapshot = await readRecentAuthGrantSnapshot({ req, userId: auth.userId });
  if (!grantSnapshot) return response("RECENT_AUTH_REQUIRED", 401);
  const token = await getRequestToken(req);
  if (!token?.sessionJti || token.id !== auth.userId) return response("AUTH_REQUIRED", 401);
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, contactEmail: true, revision: true, legacyName: true, studentProfile: { select: { legalName: true, nickname: true, profileRevision: true } }, teacherProfile: { select: { legalName: true, profileRevision: true } } } });
  if (!target) return response("USER_NOT_FOUND", 404);
  const expectedUserRevision = Number(body.expectedUserRevision);
  if (!Number.isInteger(expectedUserRevision) || expectedUserRevision < 0) return response("REQUEST_INVALID", 422);
  const expectedProfileRevision = body.expectedProfileRevision === undefined || body.expectedProfileRevision === null ? null : Number(body.expectedProfileRevision);
  if (expectedProfileRevision !== null && (!Number.isInteger(expectedProfileRevision) || expectedProfileRevision < 0)) return response("REQUEST_INVALID", 422);
  const expectedEnrollmentRevision = body.expectedEnrollmentRevision === undefined || body.expectedEnrollmentRevision === null ? null : Number(body.expectedEnrollmentRevision);
  const expectedRosterRevision = body.expectedRosterRevision === undefined || body.expectedRosterRevision === null ? null : Number(body.expectedRosterRevision);
  if (operation === "UPDATE_ENROLLMENT" && (expectedEnrollmentRevision === null || !Number.isInteger(expectedEnrollmentRevision) || expectedEnrollmentRevision < 0 || expectedRosterRevision === null || !Number.isInteger(expectedRosterRevision) || expectedRosterRevision < 0)) return response("REQUEST_INVALID", 422);

  let identity: { legalName: string; contactEmail: string | null; nickname: { ok: true; value: string; normalized: string } | null; changedFields: string[] } | null = null;
  if (operation === "UPDATE_IDENTITY") {
    const legalNameProvided = Object.prototype.hasOwnProperty.call(body, "legalName");
    const contactProvided = Object.prototype.hasOwnProperty.call(body, "contactEmail");
    const nicknameProvided = Object.prototype.hasOwnProperty.call(body, "nickname");
    if (!legalNameProvided && !contactProvided && !nicknameProvided) return response("REQUEST_INVALID", 422);
    const legalName = legalNameProvided ? normalizeLegalName(String(body.legalName ?? "")) : target.studentProfile?.legalName ?? target.teacherProfile?.legalName ?? target.legacyName ?? "";
    if (target.role !== ROLES.ADMIN && legalNameError(legalName)) return response("LEGAL_NAME_INVALID", 422);
    const contactEmail = contactProvided ? normalizeContactEmail(String(body.contactEmail ?? "")) : target.contactEmail;
    if (contactProvided && contactEmailError(String(body.contactEmail ?? ""))) return response("CONTACT_EMAIL_INVALID", 422);
    const nicknameValue = nicknameProvided ? String(body.nickname ?? "") : target.studentProfile?.nickname ?? "";
    const nickname = target.role === ROLES.STUDENT ? validateNicknameAgainstIdentity(nicknameValue, { legalName, accountName: target.accountName, contactEmail }) : null;
    if (nickname && !nickname.ok) return response("NICKNAME_INVALID", 422);
    const changedFields = [legalNameProvided ? "legalName" : null, contactProvided ? "contactEmail" : null, nicknameProvided ? "nickname" : null].filter((field): field is string => Boolean(field));
    identity = { legalName, contactEmail, nickname: nickname?.ok ? nickname : null, changedFields };
  } else if (operation === "CHANGE_STATUS") {
    if (body.status !== "ACTIVE" && body.status !== "SUSPENDED") return response("STATUS_INVALID", 422);
    if (id === auth.userId && body.status === "SUSPENDED") return response("SELF_SUSPEND_FORBIDDEN", 409);
    if (target.role === ROLES.STUDENT && body.grade !== undefined && !parseStudentGrade(body.grade)) return response("GRADE_INVALID", 422);
    if (target.role === ROLES.STUDENT && body.classCode !== undefined && body.classCode !== null && body.classCode !== "" && !parseClassCode(body.classCode)) return response("CLASS_INVALID", 422);
    if (target.role === ROLES.STUDENT && body.studentNumber !== undefined && body.studentNumber !== null && parseStudentNumber(body.studentNumber) === null) return response("STUDENT_NUMBER_INVALID", 422);
  } else {
    if (target.role !== ROLES.STUDENT) return response("REQUEST_INVALID", 422);
    if (body.studentNumber !== undefined && body.studentNumber !== null && parseStudentNumber(body.studentNumber) === null) return response("STUDENT_NUMBER_INVALID", 422);
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const identityKeys = identity ? [target.accountName, target.contactEmail, identity.contactEmail, identity.nickname?.normalized] : [target.accountName];
      await lockRosterIdentityKeys(tx, identityKeys);
      for (const userId of [auth.userId, id].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true } });
      const fresh = await tx.user.findUnique({ where: { id }, select: { id: true, accountName: true, role: true, status: true, tokenVersion: true, credentialRevision: true, revision: true, legacyName: true, contactEmail: true, studentProfile: { select: { legalName: true, nickname: true, profileRevision: true } }, teacherProfile: { select: { legalName: true, profileRevision: true } } } });
      if (!actor || actor.role !== ROLES.ADMIN || actor.status !== "ACTIVE") throw new Error("AUTH_REQUIRED");
      if (actor.tokenVersion !== grantSnapshot.user.tokenVersion || actor.credentialRevision !== grantSnapshot.user.credentialRevision || token.tokenVersion !== actor.tokenVersion || token.credentialRevision !== actor.credentialRevision) throw new Error("AUTH_REQUIRED");
      const grantId = hashSessionJti(token.sessionJti as string);
      await tx.$queryRaw`SELECT "id" FROM "RecentAuthGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.recentAuthGrant.findUnique({ where: { id: grantId }, select: { userId: true, tokenVersion: true, credentialRevision: true, reauthenticatedAt: true, expiresAt: true } });
      if (!grant || grant.userId !== auth.userId || grant.tokenVersion !== actor.tokenVersion || grant.credentialRevision !== actor.credentialRevision || grant.expiresAt <= new Date() || grant.reauthenticatedAt.getTime() !== grantSnapshot.grant.reauthenticatedAt.getTime() || grant.expiresAt.getTime() !== grantSnapshot.grant.expiresAt.getTime()) throw new Error("RECENT_AUTH_REQUIRED");
      if (!fresh) throw new Error("USER_NOT_FOUND");
      if (fresh.revision !== expectedUserRevision) throw new Error("ADMIN_USER_PROFILE_STALE");
      if (operation === "UPDATE_ENROLLMENT") {
        if (fresh.role !== ROLES.STUDENT) throw new Error("REQUEST_INVALID");
        const rosterState = await tx.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
        if (!rosterState || rosterState.revision !== expectedRosterRevision) throw new Error("ADMIN_ROSTER_STALE");
        const currentEnrollment = await tx.studentEnrollment.findFirst({ where: { studentId: id, academicYear: { status: "CURRENT" } }, select: { id: true, revision: true } });
        if (!currentEnrollment) throw new Error("CURRENT_ENROLLMENT_REQUIRED");
        if (currentEnrollment.revision !== expectedEnrollmentRevision) throw new Error("ADMIN_ROSTER_STALE");
        const nextStudentNumber = body.studentNumber === undefined || body.studentNumber === null || String(body.studentNumber).trim() === "" ? null : parseStudentNumber(body.studentNumber);
        if (body.studentNumber !== undefined && body.studentNumber !== null && nextStudentNumber === null) throw new Error("STUDENT_NUMBER_INVALID");
        await tx.studentEnrollment.update({ where: { id: currentEnrollment.id }, data: { studentNumber: nextStudentNumber, revision: { increment: 1 } } });
        // Enrollment identity is part of the admin directory snapshot as well
        // as the roster snapshot. Bump the user revision so an open detail
        // form cannot overwrite a number change that just committed.
        await tx.user.update({ where: { id }, data: { revision: { increment: 1 } } });
        await touchRosterRevision(tx);
        await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: fresh.accountName, eventType: "STUDENT_CLASS_CHANGED", ip: getClientIp(req.headers), metadata: { changedFields: ["studentNumber"] } }) });
      } else if (operation === "UPDATE_IDENTITY") {
        const profileRevision = fresh.role === ROLES.STUDENT ? fresh.studentProfile?.profileRevision : fresh.role === ROLES.TEACHER ? fresh.teacherProfile?.profileRevision : null;
        if (profileRevision !== null && profileRevision !== undefined && expectedProfileRevision !== profileRevision) throw new Error("ADMIN_USER_PROFILE_STALE");
        const fields = identity!;
        await tx.user.update({ where: { id }, data: { ...(Object.prototype.hasOwnProperty.call(body, "contactEmail") ? { contactEmail: fields.contactEmail, contactEmailCanonical: fields.contactEmail } : {}), ...(fresh.role === ROLES.ADMIN && Object.prototype.hasOwnProperty.call(body, "legalName") ? { legacyName: fields.legalName } : {}), revision: { increment: 1 } } });
        if (fresh.role === ROLES.STUDENT) await tx.studentProfile.update({ where: { userId: id }, data: { ...(Object.prototype.hasOwnProperty.call(body, "legalName") ? { legalName: fields.legalName } : {}), ...(Object.prototype.hasOwnProperty.call(body, "nickname") && fields.nickname ? { nickname: fields.nickname.value, nicknameNormalized: fields.nickname.normalized, nicknameUpdatedAt: new Date() } : {}), profileRevision: { increment: 1 } } });
        if (fresh.role === ROLES.TEACHER && Object.prototype.hasOwnProperty.call(body, "legalName")) await tx.teacherProfile.update({ where: { userId: id }, data: { legalName: fields.legalName, profileRevision: { increment: 1 } } });
        await touchRosterRevision(tx);
        await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: fresh.accountName, eventType: "ADMIN_PROFILE_UPDATED", ip: getClientIp(req.headers), metadata: { changedFields: fields.changedFields } }) });
      } else {
        const nextStatus = body.status as "ACTIVE" | "SUSPENDED";
        if (fresh.role === ROLES.ADMIN && nextStatus === "SUSPENDED" && await tx.user.count({ where: { role: ROLES.ADMIN, status: "ACTIVE" } }) <= 1) throw new Error("LAST_ADMIN");
        const statusChanged = nextStatus !== fresh.status;
        if (statusChanged) {
          await tx.user.update({ where: { id }, data: { status: nextStatus, suspendedAt: nextStatus === "SUSPENDED" ? new Date() : null, suspendedReason: nextStatus === "SUSPENDED" ? String(body.suspendedReason ?? "由管理員停權").trim().slice(0, 200) : null, tokenVersion: { increment: 1 }, revision: { increment: 1 } } });
          await revokeRecentAuthGrants(tx, id);
        }
        if (fresh.role === ROLES.STUDENT && nextStatus === "ACTIVE") {
          const currentEnrollment = await tx.studentEnrollment.findFirst({ where: { studentId: id, academicYear: { status: "CURRENT" } }, select: { grade: true, classId: true, schoolClass: { select: { classCode: true } } } });
          const grade = body.grade === undefined ? currentEnrollment?.grade ?? null : parseStudentGrade(body.grade);
          const classCode = body.classCode === undefined ? currentEnrollment?.schoolClass?.classCode ?? null : body.classCode === null || body.classCode === "" ? null : parseClassCode(body.classCode);
          const studentNumber = body.studentNumber === undefined ? undefined : body.studentNumber === null ? null : parseStudentNumber(body.studentNumber);
          await ensureManualCurrentEnrollment(tx, { userId: id, grade, classCode, studentNumber, restoreMode: typeof body.restoreMode === "string" ? body.restoreMode : undefined, actorUserId: auth.userId });
        }
        if (statusChanged || (fresh.role === ROLES.STUDENT && nextStatus === "ACTIVE")) await touchRosterRevision(tx);
        if (statusChanged) await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: id, subjectAccount: fresh.accountName, eventType: nextStatus === "SUSPENDED" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REACTIVATED", ip: getClientIp(req.headers) }) });
      }
      return tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, accountName: true, contactEmail: true, role: true, status: true, suspendedAt: true, revision: true, legacyName: true, studentProfile: { select: { legalName: true, nickname: true } }, teacherProfile: { select: { legalName: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ id: updated.id, accountName: updated.accountName, contactEmail: updated.contactEmail, legalName: updated.studentProfile?.legalName ?? updated.teacherProfile?.legalName ?? updated.legacyName, nickname: updated.studentProfile?.nickname ?? null, role: updated.role, status: updated.status, suspendedAt: updated.suspendedAt?.toISOString() ?? null, revision: updated.revision, sessionInvalidated: operation === "CHANGE_STATUS" }, { headers: ADMIN_MUTATION_HEADERS });
  } catch (error) {
    if (error instanceof Error && ["USER_NOT_FOUND"].includes(error.message)) return response(error.message, 404);
    if (error instanceof Error && ["AUTH_REQUIRED"].includes(error.message)) return response(error.message, 401);
    if (error instanceof Error && ["RECENT_AUTH_REQUIRED"].includes(error.message)) return response(error.message, 401);
    if (error instanceof Error && ["ADMIN_USER_PROFILE_STALE", "LAST_ADMIN"].includes(error.message)) return response(error.message === "LAST_ADMIN" ? "LAST_ADMIN_PROTECTION" : error.message, 409);
    if (error instanceof Error && ["ENROLLMENT_GRADE_REQUIRED", "CURRENT_YEAR_MISSING", "CURRENT_ENROLLMENT_REQUIRED", "GRADE_CLASS_REQUIRED", "PENDING_TRANSITION_REQUIRES_REPLAN", "TRANSITION_DISPOSITION_REQUIRED", "ADMIN_ROSTER_STALE"].includes(error.message)) return response(error.message, 409);
    if (error instanceof Error && error.message === "CLASS_NOT_FOUND") return response(error.message, 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return response(String(error.meta?.target ?? "").includes("student_number") ? "STUDENT_NUMBER_CONFLICT" : "ACCOUNT_OR_EMAIL_EXISTS", 409);
    return response("INTERNAL_ERROR", 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
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
          await touchRosterRevision(tx);
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
    return NextResponse.json({ ok: true }, { headers: ADMIN_MUTATION_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") return response("USER_NOT_FOUND", 404);
    if (error instanceof Error && error.message === "CONFIRMATION_REQUIRED") return response("CONFIRMATION_REQUIRED", 422);
    if (error instanceof Error && error.message === "LAST_ADMIN") return response("LAST_ADMIN_PROTECTION", 409);
    if (isRetryableTransactionConflict(error)) return response("ROSTER_CONFLICT_RETRY", 409);
    return response("USER_DELETE_FAILED", 409);
  }
}
