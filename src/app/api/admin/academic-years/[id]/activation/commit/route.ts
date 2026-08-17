import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { lockRosterMutationState } from "@/lib/roster-server";
import { touchRosterRevision } from "@/lib/teacher-workspace";
import { createHash } from "node:crypto";
import { actorAuditFields, operationFingerprint, readReceiptForCommit, writeAdminReceipt } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";
import { assertYearActivationSelectionCap } from "@/lib/roster-domain";

type ActivationPayload = { sourceAcademicYearId: string; targetAcademicYearId: string; sourceEnrollments: Array<{ id: string; studentId: string; revision: number; student: { user: { status: "ACTIVE" | "SUSPENDED"; revision: number } } }>; transitions: Array<{ id: string; studentId: string; sourceEnrollmentId: string; targetEnrollmentId: string | null; disposition: "PROMOTE" | "REPEAT" | "HOLD_UNASSIGNED" | "GRADUATE" | "LEAVE"; revision: number }>; targetEnrollments: Array<{ id: string; studentId: string; revision: number }>; coverage: Array<{ classId: string; classRevision?: number; viewTeacherIds: string[]; resetTeacherIds: string[]; acknowledged: boolean; teacherSnapshots: Array<{ userId: string; status: "ACTIVE" | "SUSPENDED"; revision: number; accessRevision: number | null; canResetStudentPassword: boolean; access: Array<{ classId: string; canViewProgress: boolean }> }> }>; coverageFingerprint: string; rosterRevision: number };
function response(code: string, status: number) { return NextResponse.json({ code }, { status }); }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId : "";
  const requestedOperationId = typeof body?.operationId === "string" ? body.operationId : null;
  if (!batchId) return response("ACTIVATION_BATCH_REQUIRED", 422);
  const { id: sourceAcademicYearId } = await params;
  const transactionStartedAt = Date.now();
  try {
    const summary = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      // Lifecycle triggers permit the complete CURRENT→CLOSED / PLANNED→CURRENT
      // transition only inside this explicitly marked transaction.  The
      // deferred invariants still validate the whole final graph at COMMIT.
      await tx.$executeRaw`SELECT set_config('app.roster_activation', 'on', true)`;
      const batch = await tx.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId, operationKind: "YEAR_ACTIVATION" } });
      if (!batch) throw new Error("BATCH_NOT_FOUND");
      if (requestedOperationId && requestedOperationId !== batch.operationId) throw new Error("IDEMPOTENCY_CONFLICT");
      const operationId = batch.operationId;
      const requestFingerprint = operationFingerprint({ operationKind: "YEAR_ACTIVATION", batchId: batch.id, operationId, canonicalDigest: batch.canonicalDigest });
      const replay = await readReceiptForCommit(tx, { actorUserId: auth.userId, operationKind: "YEAR_ACTIVATION", operationId, requestFingerprint });
      if (replay) return { duplicate: true, summary: replay };
      if (batch.status === "COMMITTED") {
        const stored = typeof batch.counts === "object" && batch.counts ? batch.counts : {};
        await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "YEAR_ACTIVATION", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: stored as Prisma.InputJsonValue });
        return { duplicate: true, summary: stored };
      }
      if (batch.status !== "PREVIEWED" || batch.expiresAt <= new Date()) throw new Error("BATCH_EXPIRED");
      const payload = batch.payload as ActivationPayload | null;
      if (!payload || payload.sourceAcademicYearId !== sourceAcademicYearId) throw new Error("BATCH_INVALID");
      const source = await tx.academicYear.findUnique({ where: { id: payload.sourceAcademicYearId } });
      const target = await tx.academicYear.findUnique({ where: { id: payload.targetAcademicYearId } });
      const state = await tx.rosterMutationState.findUniqueOrThrow({ where: { id: 1 } });
      if (!source || source.status !== "CURRENT" || !target || target.status !== "PLANNED" || source.revision !== batch.sourceYearRevision || target.revision !== batch.targetYearRevision || state.revision !== batch.rosterRevision) {
        throw new Error("STALE_PREVIEW");
      }
      const successor = await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: source.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } });
      if (successor?.id !== target.id) throw new Error("STALE_PREVIEW");
      const classes = await tx.schoolClass.findMany({ where: { academicYearId: target.id, active: true }, orderBy: [{ grade: "asc" }, { classCode: "asc" }], select: { id: true, grade: true, classCode: true, revision: true } });
      const teachers = await tx.user.findMany({ where: { role: ROLES.TEACHER, teacherProfile: { isNot: null } }, select: { id: true, status: true, revision: true, teacherProfile: { select: { accessRevision: true, canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYearId: target.id } }, select: { classId: true, canViewProgress: true } } } } } });
      const coverage = classes.map((schoolClass) => {
        const candidates = teachers.filter((teacher) => teacher.status === "ACTIVE" && teacher.teacherProfile?.classAccess.some((access) => access.classId === schoolClass.id && access.canViewProgress));
        const resetCandidates = candidates.filter((teacher) => teacher.teacherProfile?.canResetStudentPassword === true);
        return { classId: schoolClass.id, classRevision: schoolClass.revision, grade: schoolClass.grade, classCode: schoolClass.classCode, viewTeacherIds: candidates.map((teacher) => teacher.id).sort(), resetTeacherIds: resetCandidates.map((teacher) => teacher.id).sort(), acknowledged: payload.coverage.find((item) => item.classId === schoolClass.id)?.acknowledged === true, teacherSnapshots: teachers.map((teacher) => ({ userId: teacher.id, status: teacher.status, revision: teacher.revision, accessRevision: teacher.teacherProfile?.accessRevision ?? null, canResetStudentPassword: teacher.teacherProfile?.canResetStudentPassword ?? false, access: (teacher.teacherProfile?.classAccess ?? []).filter((access) => access.classId === schoolClass.id).map((access) => ({ classId: access.classId, canViewProgress: access.canViewProgress })).sort((a, b) => a.classId.localeCompare(b.classId)) })) };
      });
      if (digest(coverage) !== payload.coverageFingerprint || coverage.some((item) => item.viewTeacherIds.length === 0 && !item.acknowledged) || payload.coverage.some((item) => item.classRevision !== undefined && coverage.find((current) => current.classId === item.classId)?.classRevision !== item.classRevision)) {
        throw new Error("STALE_PREVIEW");
      }
      const currentSources = await tx.studentEnrollment.findMany({ where: { academicYearId: source.id, status: "ACTIVE" }, select: { id: true, studentId: true, grade: true, revision: true } });
      assertYearActivationSelectionCap(currentSources.length);
      const transitionStudentIds = new Set(payload.transitions.map((item) => item.studentId));
      if (currentSources.length !== payload.sourceEnrollments.length) throw new Error("STALE_PREVIEW");
      const currentSourcesById = new Map(currentSources.map((item) => [item.id, item]));
      for (const item of payload.sourceEnrollments) {
        const current = currentSourcesById.get(item.id);
        if (!current || current.studentId !== item.studentId || current.revision !== item.revision || !transitionStudentIds.has(item.studentId)) throw new Error("STALE_PREVIEW");
      }
      const now = new Date();
      const transitionIds = [...new Set(payload.transitions.map((item) => item.id))];
      if (transitionIds.length !== payload.transitions.length) throw new Error("STALE_PREVIEW");
      const transitions = await tx.studentYearTransition.findMany({
        where: { id: { in: transitionIds } },
        select: {
          id: true,
          studentId: true,
          sourceEnrollmentId: true,
          targetEnrollmentId: true,
          disposition: true,
          revision: true,
          activatedAt: true,
          targetEnrollment: { select: { id: true, studentId: true, status: true, grade: true, classId: true, revision: true } },
        },
      });
      if (transitions.length !== payload.transitions.length) throw new Error("STALE_PREVIEW");
      const transitionsById = new Map(transitions.map((item) => [item.id, item]));
      const transitionPlans = payload.transitions.map((snapshot) => {
        const transition = transitionsById.get(snapshot.id);
        if (!transition || transition.revision !== snapshot.revision || transition.activatedAt || transition.studentId !== snapshot.studentId || transition.sourceEnrollmentId !== snapshot.sourceEnrollmentId || transition.disposition !== snapshot.disposition) throw new Error("STALE_PREVIEW");
        const terminal = snapshot.disposition === "GRADUATE" || snapshot.disposition === "LEAVE";
        if (terminal && transition.targetEnrollment && transition.targetEnrollment.status !== "PLANNED") throw new Error("TERMINAL_TARGET_INVALID");
        if (!terminal && (!transition.targetEnrollment || transition.targetEnrollment.status !== "PLANNED")) throw new Error("TARGET_ENROLLMENT_MISSING");
        return { snapshot, transition, terminal };
      });
      const targetClassIds = transitionPlans.flatMap(({ transition, terminal }) => terminal || !transition.targetEnrollment?.classId ? [] : [transition.targetEnrollment.classId!]);
      const targetClasses = targetClassIds.length
        ? await tx.schoolClass.findMany({ where: { id: { in: [...new Set(targetClassIds)] } }, select: { id: true, classCode: true } })
        : [];
      const classCodeById = new Map(targetClasses.map((item) => [item.id, item.classCode]));
      if (targetClasses.length !== new Set(targetClassIds).size) throw new Error("STALE_PREVIEW");

      // The partial unique index permits only one ACTIVE enrollment per
      // student. End all CURRENT sources in one CAS statement before opening
      // any target row.  The deferred lifecycle trigger validates the final
      // graph once at commit rather than once per affected row.
      const expectedSources = JSON.stringify(payload.sourceEnrollments.map((item) => ({ id: item.id, revision: item.revision })));
      const endedSources = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH expected AS (
          SELECT * FROM jsonb_to_recordset(${expectedSources}::jsonb)
            AS expected("id" text, "revision" integer)
        )
        UPDATE "StudentEnrollment" AS e
        SET "isCurrent" = false,
            "status" = 'ENDED'::"EnrollmentStatus",
            -- Prisma's timestamp-without-time-zone adapter serializes a Date
            -- in UTC while local fixtures may have been inserted in the
            -- database session zone.  Keep the status-date invariant valid
            -- across either representation when a clock/zone boundary makes
            -- the stored start appear slightly ahead of the request time.
            "endedAt" = GREATEST(COALESCE(e."startedAt", ${now}), ${now}),
            "revision" = e."revision" + 1
        FROM expected
        WHERE e."id" = expected."id"
          AND e."revision" = expected."revision"
          AND e."status" = 'ACTIVE'::"EnrollmentStatus"
        RETURNING e."id"
      `);
      if (endedSources.length !== payload.sourceEnrollments.length) throw new Error("STALE_PREVIEW");

      const expectedTargets = transitionPlans
        .filter(({ terminal }) => !terminal)
        .map(({ transition }) => ({ id: transition.targetEnrollment!.id, revision: transition.targetEnrollment!.revision }));
      if (expectedTargets.length) {
        const activatedTargets = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          WITH expected AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(expectedTargets)}::jsonb)
              AS expected("id" text, "revision" integer)
          )
          UPDATE "StudentEnrollment" AS e
          SET "isCurrent" = true,
              "status" = 'ACTIVE'::"EnrollmentStatus",
              "startedAt" = ${now},
              "endedAt" = NULL,
              "revision" = e."revision" + 1
          FROM expected
          WHERE e."id" = expected."id"
            AND e."revision" = expected."revision"
            AND e."status" = 'PLANNED'::"EnrollmentStatus"
          RETURNING e."id"
        `);
        if (activatedTargets.length !== expectedTargets.length) throw new Error("STALE_PREVIEW");
      }

      const audit = actorAuditFields(auth.userId);
      const transitionUpdates = transitionPlans.map(({ snapshot, transition, terminal }) => ({
        id: transition.id,
        revision: snapshot.revision,
        targetEnrollmentId: terminal ? null : transition.targetEnrollment!.id,
        targetGrade: terminal ? null : transition.targetEnrollment!.grade,
        targetClassCode: terminal || !transition.targetEnrollment!.classId ? null : classCodeById.get(transition.targetEnrollment!.classId!) ?? null,
      }));
      const activatedTransitions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH expected AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(transitionUpdates)}::jsonb)
            AS expected("id" text, "revision" integer, "targetEnrollmentId" text, "targetGrade" text, "targetClassCode" text)
        )
        UPDATE "StudentYearTransition" AS t
        SET "targetEnrollmentId" = expected."targetEnrollmentId",
            "activatedAt" = ${now},
            "activatedTargetGrade" = expected."targetGrade"::"StudentGrade",
            "activatedTargetClassCode" = expected."targetClassCode"::"ClassCode",
            "revision" = t."revision" + 1,
            "actorUserId" = ${auth.userId},
            "actorPseudonym" = ${audit.actorPseudonym},
            "hmacKeyVersion" = ${audit.hmacKeyVersion}
        FROM expected
        WHERE t."id" = expected."id"
          AND t."revision" = expected."revision"
          AND t."activatedAt" IS NULL
        RETURNING t."id"
      `);
      if (activatedTransitions.length !== transitionUpdates.length) throw new Error("STALE_PREVIEW");

      const terminalTargetIds = transitionPlans.flatMap(({ transition, terminal }) => terminal && transition.targetEnrollment ? [transition.targetEnrollment.id] : []);
      if (terminalTargetIds.length) {
        const deleted = await tx.studentEnrollment.deleteMany({ where: { id: { in: terminalTargetIds }, status: "PLANNED" } });
        if (deleted.count !== terminalTargetIds.length) throw new Error("TERMINAL_TARGET_INVALID");
      }

      const terminalStudents = transitionPlans.filter(({ terminal }) => terminal).map(({ transition, snapshot }) => ({ studentId: transition.studentId, reason: snapshot.disposition === "GRADUATE" ? "学年完成" : "离校" }));
      if (terminalStudents.length) {
        await tx.$queryRaw(Prisma.sql`
          WITH terminal_students AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(terminalStudents)}::jsonb)
              AS terminal_students("studentId" text, "reason" text)
          )
          UPDATE "User" AS u
          SET "status" = 'SUSPENDED'::"AccountStatus",
              "suspendedAt" = ${now},
              "suspendedReason" = terminal_students."reason",
              "tokenVersion" = u."tokenVersion" + 1,
              "revision" = u."revision" + 1
          FROM terminal_students
          WHERE u."id" = terminal_students."studentId"
            AND u."status" = 'ACTIVE'::"AccountStatus"
        `);
        await tx.recentAuthGrant.deleteMany({ where: { userId: { in: terminalStudents.map((item) => item.studentId) } } });
      }

      const incoming = await tx.studentEnrollment.findMany({ where: { academicYearId: target.id, status: "PLANNED", studentId: { notIn: [...transitionStudentIds] } }, select: { id: true, studentId: true, revision: true } });
      assertYearActivationSelectionCap(currentSources.length + incoming.length);
      if (incoming.length) {
        const activatedIncoming = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          WITH expected AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(incoming.map((item) => ({ id: item.id, revision: item.revision })))}::jsonb)
              AS expected("id" text, "revision" integer)
          )
          UPDATE "StudentEnrollment" AS e
          SET "isCurrent" = true,
              "status" = 'ACTIVE'::"EnrollmentStatus",
              "startedAt" = ${now},
              "revision" = e."revision" + 1
          FROM expected
          WHERE e."id" = expected."id"
            AND e."revision" = expected."revision"
            AND e."status" = 'PLANNED'::"EnrollmentStatus"
          RETURNING e."id"
        `);
        if (activatedIncoming.length !== incoming.length) throw new Error("STALE_PREVIEW");
      }
      await tx.academicYear.update({ where: { id: source.id, status: "CURRENT", revision: source.revision }, data: { status: "CLOSED", isCurrent: false, revision: { increment: 1 } } });
      await tx.academicYear.update({ where: { id: target.id, status: "PLANNED", revision: target.revision }, data: { status: "CURRENT", isCurrent: true, revision: { increment: 1 } } });
      // Academic-year activation changes the CURRENT membership universe even
      // when no individual class row changed. Bump the shared roster scope so
      // an in-flight analytics/export snapshot fails closed instead of
      // returning the previous year's roster.
      await touchRosterRevision(tx);
      const result = { sourceAcademicYearId: source.id, targetAcademicYearId: target.id, endedSourceCount: payload.sourceEnrollments.length, activatedTargetCount: payload.transitions.filter((item) => !["GRADUATE", "LEAVE"].includes(item.disposition)).length + incoming.length, terminalCount: payload.transitions.filter((item) => ["GRADUATE", "LEAVE"].includes(item.disposition)).length };
      await tx.adminMutationBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: now, counts: result, payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      await writeAdminReceipt(tx, { actorUserId: auth.userId, operationKind: "YEAR_ACTIVATION", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: result });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `activation:${batch.operationId}`, eventType: "ACADEMIC_YEAR_ACTIVATED", ip: getClientIp(req.headers), metadata: result }) });
      return { duplicate: false, ...result };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
    const responseBody = NextResponse.json({ ok: true, ...summary });
    responseBody.headers.set("Server-Timing", `roster-activation-transaction;dur=${Date.now() - transactionStartedAt}`);
    return responseBody;
  } catch (error) {
    const code = stableRosterCode(error, ["BATCH_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "BATCH_EXPIRED", "BATCH_INVALID", "STALE_PREVIEW", "TERMINAL_TARGET_INVALID", "TARGET_ENROLLMENT_MISSING", "ACTIVATION_SELECTION_CAP"], "ACTIVATION_COMMIT_FAILED");
    return response(code, code === "BATCH_EXPIRED" ? 410 : code === "BATCH_NOT_FOUND" ? 404 : code === "ACTIVATION_SELECTION_CAP" ? 422 : 409);
  }
}
