import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/generated/prisma";
import { prisma, Prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/roles";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { offsetDay, todayKey } from "@/lib/streak";
import { lockRosterMutationState } from "@/lib/roster-server";
import { STUDENT_GRADES } from "@/lib/roster-domain";
import type { StudentGrade } from "@/generated/prisma";
import { issueTeacherResetPrecondition } from "@/lib/teacher-reset-precondition";

const CURSOR_VERSION = 1;
const MAX_SEARCH_GRAPHEMES = 80;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export type TeacherWorkspaceViewMode = "TEACHER" | "ADMIN";

export type TeacherWorkspaceQuery = {
  grade?: StudentGrade;
  classId?: string;
  search?: string;
  cursor?: string;
  limit: number;
};

export type TeacherWorkspaceContext = {
  viewMode: TeacherWorkspaceViewMode;
  academicYear: { id: string; label: string; revision: number };
  accessRevision: number | null;
  rosterRevision: number;
  classes: Array<{ id: string; grade: StudentGrade; classCode: string; revision: number }>;
  studentWhere: Prisma.UserWhereInput;
};

type CursorPayload = {
  v: number;
  accountName: string;
  id: string;
  fingerprint: string;
  accessRevision: number | null;
  rosterRevision: number;
  yearRevision: number;
};

function cursorSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for teacher cursors");
  return "development-only-teacher-workspace-cursor-secret";
}

function signCursor(payload: string) {
  return createHmac("sha256", cursorSecret()).update("teacher-cursor-v1:").update(payload).digest("base64url");
}

export function encodeTeacherCursor(payload: CursorPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signCursor(body)}`;
}

export function decodeTeacherCursor(value: string): CursorPayload | null {
  if (!value || value.length > 2048) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = signCursor(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (
      parsed.v !== CURSOR_VERSION || typeof parsed.accountName !== "string" ||
      typeof parsed.id !== "string" || typeof parsed.fingerprint !== "string" ||
      typeof parsed.rosterRevision !== "number" || typeof parsed.yearRevision !== "number" ||
      (parsed.accessRevision !== null && typeof parsed.accessRevision !== "number")
    ) return null;
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

export function normalizeTeacherWorkspaceQuery(input: unknown): TeacherWorkspaceQuery {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const grade = typeof body.grade === "string" && body.grade ? body.grade as StudentGrade : undefined;
  if (grade && !STUDENT_GRADES.includes(grade)) throw new Error("QUERY_INVALID");
  const classId = typeof body.classId === "string" && body.classId.trim() ? body.classId.trim() : undefined;
  if (classId && classId.length > 128) throw new Error("QUERY_INVALID");
  const searchRaw = typeof body.search === "string" ? body.search.normalize("NFKC").trim() : "";
  const searchLength = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(searchRaw)].length;
  if (searchLength > MAX_SEARCH_GRAPHEMES) throw new Error("QUERY_INVALID");
  const limit = body.limit === undefined ? DEFAULT_LIMIT : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error("QUERY_INVALID");
  const cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : undefined;
  return { grade, classId, search: searchRaw || undefined, cursor, limit };
}

export async function readTeacherWorkspaceQuery(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 16 * 1024) throw new Error("QUERY_INVALID");
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > 16 * 1024) throw new Error("QUERY_INVALID");
  const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  return normalizeTeacherWorkspaceQuery(body);
}

function currentStudentEnrollmentWhere(input: {
  viewMode: TeacherWorkspaceViewMode;
  teacherId: string;
  academicYearId: string;
}): Prisma.StudentEnrollmentWhereInput {
  const activeClass: Prisma.SchoolClassWhereInput = {
    academicYearId: input.academicYearId,
    active: true,
    ...(input.viewMode === "TEACHER"
      ? { teacherAccess: { some: { teacherId: input.teacherId, canViewProgress: true } } }
      : {}),
  };
  if (input.viewMode === "ADMIN") {
    return {
      academicYearId: input.academicYearId,
      status: "ACTIVE",
      OR: [{ classId: null }, { schoolClass: { is: activeClass } }],
    };
  }
  return { academicYearId: input.academicYearId, status: "ACTIVE", schoolClass: { is: activeClass } };
}

async function readCurrentYear(tx: Prisma.TransactionClient | typeof prisma) {
  const year = await tx.academicYear.findFirst({
    where: { status: "CURRENT" },
    orderBy: [{ startsOn: "desc" }, { id: "asc" }],
    select: { id: true, label: true, revision: true },
  });
  if (!year) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  return year;
}

async function readRosterRevision(tx: Prisma.TransactionClient | typeof prisma) {
  const state = await tx.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  if (!state) throw new Error("ROSTER_MUTATION_STATE_MISSING");
  return state.revision;
}

export async function getTeacherWorkspaceContext(input: { userId: string; role: Role }) {
  const year = await readCurrentYear(prisma);
  const rosterRevision = await readRosterRevision(prisma);
  const viewMode: TeacherWorkspaceViewMode = input.role === ROLES.ADMIN ? "ADMIN" : "TEACHER";
  if (viewMode === "TEACHER") {
    const teacher = await prisma.user.findFirst({
      where: { id: input.userId, role: ROLES.TEACHER, status: "ACTIVE", teacherProfile: { isNot: null } },
      select: { teacherProfile: { select: { accessRevision: true } } },
    });
    if (!teacher?.teacherProfile) throw new Error("TEACHER_NOT_FOUND");
  }
  const classes = await prisma.schoolClass.findMany({
    where: {
      academicYearId: year.id,
      active: true,
      ...(viewMode === "TEACHER" ? { teacherAccess: { some: { teacherId: input.userId, canViewProgress: true } } } : {}),
    },
    orderBy: [{ grade: "asc" }, { classCode: "asc" }, { id: "asc" }],
    select: { id: true, grade: true, classCode: true, revision: true },
  });
  const teacherProfile = viewMode === "TEACHER"
    ? await prisma.teacherProfile.findUnique({ where: { userId: input.userId }, select: { accessRevision: true } })
    : null;
  return {
    viewMode,
    academicYear: year,
    accessRevision: teacherProfile?.accessRevision ?? null,
    rosterRevision,
    classes,
    studentWhere: {
      role: ROLES.STUDENT,
      status: "ACTIVE",
      studentProfile: {
        is: { enrollments: { some: currentStudentEnrollmentWhere({ viewMode, teacherId: input.userId, academicYearId: year.id }) } },
      },
    } satisfies Prisma.UserWhereInput,
  } satisfies TeacherWorkspaceContext;
}

function filterFingerprint(query: TeacherWorkspaceQuery, context: TeacherWorkspaceContext) {
  return createHmac("sha256", cursorSecret()).update(JSON.stringify({
    grade: query.grade ?? null,
    classId: query.classId ?? null,
    search: query.search ?? null,
    yearId: context.academicYear.id,
    viewMode: context.viewMode,
  })).digest("hex");
}

function addQueryFilters(base: Prisma.UserWhereInput, query: TeacherWorkspaceQuery, context: TeacherWorkspaceContext, teacherId: string) {
  const enrollmentWhere = currentStudentEnrollmentWhere({ viewMode: context.viewMode, teacherId, academicYearId: context.academicYear.id });
  const scopedEnrollment: Prisma.StudentEnrollmentWhereInput = {
    ...enrollmentWhere,
    ...(query.grade ? { grade: query.grade } : {}),
    ...(query.classId ? { classId: query.classId } : {}),
  };
  const filters: Prisma.UserWhereInput[] = [
    { studentProfile: { is: { enrollments: { some: scopedEnrollment } } } },
  ];
  if (query.search) {
    const accountSearch = normalizeAccountName(query.search);
    const legalSearch = normalizeLegalName(query.search);
    const nicknameSearch = query.search.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase().replace(/[\s._-]+/gu, "");
    filters.push({
      OR: [
        ...(accountSearch ? [
          { accountNameCanonical: { contains: accountSearch, mode: "insensitive" as const } },
          { accountName: { contains: accountSearch, mode: "insensitive" as const } },
        ] : []),
        ...(legalSearch ? [{ studentProfile: { is: { legalName: { contains: legalSearch, mode: "insensitive" as const } } } }] : []),
        ...(nicknameSearch ? [{ studentProfile: { is: { nicknameNormalized: { contains: nicknameSearch, mode: "insensitive" as const } } } }] : []),
      ],
    });
  }
  return { ...base, AND: [...(Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : []), ...filters] } satisfies Prisma.UserWhereInput;
}

async function readMembers(input: { userId: string; role: Role; query: TeacherWorkspaceQuery }) {
  const context = await getTeacherWorkspaceContext({ userId: input.userId, role: input.role });
  const fingerprint = filterFingerprint(input.query, context);
  const cursor = input.query.cursor ? decodeTeacherCursor(input.query.cursor) : null;
  if (input.query.cursor && (!cursor || cursor.fingerprint !== fingerprint || cursor.accessRevision !== context.accessRevision || cursor.rosterRevision !== context.rosterRevision || cursor.yearRevision !== context.academicYear.revision)) {
    throw new Error(cursor ? "TEACHER_QUERY_STALE" : "CURSOR_INVALID");
  }
  const where = addQueryFilters(context.studentWhere, input.query, context, input.userId);
  if (cursor) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { OR: [{ accountName: { gt: cursor.accountName } }, { accountName: cursor.accountName, id: { gt: cursor.id } }] },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ accountName: "asc" }, { id: "asc" }],
    take: input.query.limit + 1,
    select: {
      id: true,
      accountName: true,
      accountNameCanonical: true,
      status: true,
      tokenVersion: true,
      credentialRevision: true,
      studentProfile: {
        select: {
          legalName: true,
          nickname: true,
          enrollments: {
            where: currentStudentEnrollmentWhere({ viewMode: context.viewMode, teacherId: input.userId, academicYearId: context.academicYear.id }),
            take: 1,
            orderBy: { id: "asc" },
            select: { grade: true, classId: true, schoolClass: { select: { classCode: true } } },
          },
        },
      },
    },
  });
  const hasNext = users.length > input.query.limit;
  const rows = hasNext ? users.slice(0, input.query.limit) : users;
  return { context, fingerprint, rows, hasNext };
}

export async function queryTeacherRoster(input: { userId: string; role: Role; query: TeacherWorkspaceQuery; sessionJti?: string }) {
  const result = await readMembers(input);
  const last = result.rows.at(-1);
  const canReset = input.role === ROLES.ADMIN || await awaitTeacherGlobalReset(input.userId);
  if (canReset && !input.sessionJti) throw new Error("RESET_PRECONDITION_UNAVAILABLE");
  return {
    context: result.context,
    items: result.rows.map((user) => {
      const enrollment = user.studentProfile?.enrollments[0];
      return {
        id: user.id,
        accountName: user.accountName,
        legalName: user.studentProfile?.legalName ?? "",
        nickname: user.studentProfile?.nickname ?? "",
        grade: enrollment?.grade ?? null,
        classId: enrollment?.classId ?? null,
        classCode: enrollment?.schoolClass?.classCode ?? null,
        status: user.status,
        // The account-level switch is checked once per request; class scope
        // is already enforced by the membership query.
        canResetStudentPassword: canReset,
        resetPrecondition: canReset && input.sessionJti
          ? issueTeacherResetPrecondition({
              targetId: user.id,
              actorId: input.userId,
              sessionJti: input.sessionJti,
              targetTokenVersion: user.tokenVersion,
              targetCredentialRevision: user.credentialRevision,
              actorAccessRevision: result.context.viewMode === "TEACHER" ? result.context.accessRevision : null,
            })
          : null,
      };
    }),
    nextCursor: result.hasNext && last ? encodeTeacherCursor({
      v: CURSOR_VERSION,
      accountName: normalizeAccountName(last.accountName),
      id: last.id,
      fingerprint: result.fingerprint,
      accessRevision: result.context.accessRevision,
      rosterRevision: result.context.rosterRevision,
      yearRevision: result.context.academicYear.revision,
    }) : null,
  };
}

async function awaitTeacherGlobalReset(userId: string) {
  const profile = await prisma.user.findFirst({
    where: { id: userId, role: ROLES.TEACHER, status: "ACTIVE", teacherProfile: { is: { canResetStudentPassword: true } } },
    select: { id: true },
  });
  return Boolean(profile);
}

async function metricSnapshot(userIds: string[], now = new Date()) {
  const totalWords = await prisma.word.count();
  const wordsByLevel = await prisma.word.groupBy({ by: ["level"], _count: { _all: true } });
  const todayDate = todayKey(now);
  const sevenDayStart = offsetDay(todayDate, -6);
  const [reviews, reviewEvents, studyDays, encounters] = await Promise.all([
    prisma.review.findMany({ where: { userId: { in: userIds } }, select: { userId: true, interval: true, nextReviewDate: true, word: { select: { level: true } } } }),
    prisma.reviewEvent.findMany({
      where: { userId: { in: userIds }, eventKind: "REVIEW", isHistorical: false },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        evidenceKind: true,
        flowVersion: true,
        qualityPolicyVersion: true,
        itemConstructionVersion: true,
        probePurpose: true,
        objectiveEvidenceTargetId: true,
        objectiveQuestionSnapshotId: true,
        objectiveEvidenceTarget: { select: { winningReviewEventId: true } },
      },
    }),
    prisma.studyDay.findMany({ where: { userId: { in: userIds }, date: { gte: sevenDayStart, lte: todayDate } }, select: { userId: true, date: true } }),
    prisma.studyEncounter.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _max: { acknowledgedAt: true } }),
  ]);
  const levels = new Map<string, number>(wordsByLevel.map((row) => [row.level, row._count._all]));
  const perUser = new Map<string, { mastered: number; due: number; byLevel: Map<string, number> }>();
  for (const id of userIds) perUser.set(id, { mastered: 0, due: 0, byLevel: new Map() });
  for (const review of reviews) {
    const item = perUser.get(review.userId); if (!item) continue;
    if (review.interval >= MASTERED_MIN_INTERVAL) { item.mastered += 1; item.byLevel.set(review.word.level, (item.byLevel.get(review.word.level) ?? 0) + 1); }
    if (review.nextReviewDate <= now) item.due += 1;
  }
  const objectiveCount = new Map<string, number>();
  const reviewCount = new Map<string, number>();
  const validEvents: Array<{ userId: string; createdAt: Date }> = [];
  for (const event of reviewEvents) {
    reviewCount.set(event.userId, (reviewCount.get(event.userId) ?? 0) + 1);
    if (
      event.evidenceKind === "OBJECTIVE_PROBE" &&
      event.flowVersion === "v2" &&
      event.probePurpose !== "OPERATIONAL_DIAGNOSTIC" &&
      event.probePurpose !== "RESEARCH_DIAGNOSTIC" &&
      (event.probePurpose === "DUE_REVIEW" || event.probePurpose === "EVIDENCE_OBLIGATION") &&
      Boolean(event.qualityPolicyVersion) &&
      Boolean(event.itemConstructionVersion) &&
      Boolean(event.objectiveEvidenceTargetId) &&
      Boolean(event.objectiveQuestionSnapshotId) &&
      event.objectiveEvidenceTarget?.winningReviewEventId === event.id
    ) {
      objectiveCount.set(event.userId, (objectiveCount.get(event.userId) ?? 0) + 1);
    }
    validEvents.push({ userId: event.userId, createdAt: event.createdAt });
  }
  const daySets = new Map<string, Set<string>>();
  for (const row of studyDays) { const set = daySets.get(row.userId) ?? new Set<string>(); set.add(row.date); daySets.set(row.userId, set); }
  const latest = new Map<string, Date>();
  for (const row of encounters) if (row._max?.acknowledgedAt) latest.set(row.userId, row._max.acknowledgedAt);
  for (const row of validEvents) if (!latest.has(row.userId) || latest.get(row.userId)! < row.createdAt) latest.set(row.userId, row.createdAt);
  return { totalWords, levels, perUser, objectiveCount, reviewCount, daySets, latest, todayDate, sevenDayStart };
}

function itemMetrics(id: string, snapshot: Awaited<ReturnType<typeof metricSnapshot>>) {
  const item = snapshot.perUser.get(id) ?? { mastered: 0, due: 0, byLevel: new Map<string, number>() };
  const byLevel = [...snapshot.levels].map(([level, total]) => ({ level, mastered: item.byLevel.get(level) ?? 0, total, progress: total ? Math.round(((item.byLevel.get(level) ?? 0) / total) * 100) : 0 }));
  const days = snapshot.daySets.get(id) ?? new Set<string>();
  return {
    masteredWords: item.mastered,
    totalWords: snapshot.totalWords,
    masteryPercent: snapshot.totalWords ? Math.round((item.mastered / snapshot.totalWords) * 100) : null,
    byLevel,
    dueReviewCount: item.due,
    effectiveObjectiveProbeCount: snapshot.objectiveCount.get(id) ?? 0,
    effectiveReviewEventCount: snapshot.reviewCount.get(id) ?? 0,
    activeToday: days.has(snapshot.todayDate),
    activeSevenDay: days.size > 0,
    lastActivityAt: snapshot.latest.get(id)?.toISOString() ?? null,
  };
}

export async function queryTeacherProgress(input: { userId: string; role: Role; query: TeacherWorkspaceQuery }) {
  const result = await readMembers(input);
  const snapshot = await metricSnapshot(result.rows.map((row) => row.id));
  return {
    context: result.context,
    items: result.rows.map((user) => {
      const enrollment = user.studentProfile?.enrollments[0];
      return { id: user.id, accountName: user.accountName, legalName: user.studentProfile?.legalName ?? "", nickname: user.studentProfile?.nickname ?? "", grade: enrollment?.grade ?? null, classId: enrollment?.classId ?? null, classCode: enrollment?.schoolClass?.classCode ?? null, ...itemMetrics(user.id, snapshot) };
    }),
    nextCursor: result.hasNext && result.rows.at(-1) ? encodeTeacherCursor({ v: CURSOR_VERSION, accountName: normalizeAccountName(result.rows.at(-1)!.accountName), id: result.rows.at(-1)!.id, fingerprint: result.fingerprint, accessRevision: result.context.accessRevision, rosterRevision: result.context.rosterRevision, yearRevision: result.context.academicYear.revision }) : null,
  };
}

export async function queryTeacherClassSummary(input: { userId: string; role: Role; grade?: StudentGrade }) {
  const context = await getTeacherWorkspaceContext({ userId: input.userId, role: input.role });
  const classIds = context.classes.filter((item) => !input.grade || item.grade === input.grade).map((item) => item.id);
  const users = await prisma.user.findMany({
    where: { ...context.studentWhere, studentProfile: { is: { enrollments: { some: { academicYearId: context.academicYear.id, status: "ACTIVE", classId: { in: classIds } } } } } },
    select: { id: true, studentProfile: { select: { enrollments: { where: { academicYearId: context.academicYear.id, status: "ACTIVE", classId: { in: classIds } }, take: 1, select: { classId: true } } } } },
  });
  const snapshot = await metricSnapshot(users.map((user) => user.id));
  const rows = new Map<string, string[]>();
  for (const user of users) { const classId = user.studentProfile?.enrollments[0]?.classId; if (classId) rows.set(classId, [...(rows.get(classId) ?? []), user.id]); }
  const items = context.classes.filter((item) => !input.grade || item.grade === input.grade).map((schoolClass) => {
    const ids = rows.get(schoolClass.id) ?? [];
    const metrics = ids.map((id) => itemMetrics(id, snapshot));
    const averages = metrics.map((metric) => metric.masteryPercent).filter((value): value is number => value !== null);
    return { classId: schoolClass.id, grade: schoolClass.grade, classCode: schoolClass.classCode, studentCount: ids.length, activeTodayCount: metrics.filter((metric) => metric.activeToday).length, activeSevenDayCount: metrics.filter((metric) => metric.activeSevenDay).length, masteredWordCount: metrics.reduce((sum, metric) => sum + metric.masteredWords, 0), masteryAveragePercent: averages.length ? Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length) : null, dueStudentCount: metrics.filter((metric) => metric.dueReviewCount > 0).length, inactiveSevenDayCount: metrics.filter((metric) => !metric.activeSevenDay).length, totalWords: snapshot.totalWords };
  });
  const unassigned = input.role === ROLES.ADMIN ? await prisma.user.count({ where: { ...context.studentWhere, studentProfile: { is: { enrollments: { some: { academicYearId: context.academicYear.id, status: "ACTIVE", classId: null } } } } } }) : 0;
  return { context, items, unassignedStudentCount: unassigned };
}

export async function getTeacherStudentDetail(input: { userId: string; role: Role; studentId: string; sessionJti?: string }) {
  const context = await getTeacherWorkspaceContext({ userId: input.userId, role: input.role });
  const user = await prisma.user.findFirst({
    where: { id: input.studentId, ...context.studentWhere },
    select: {
      id: true,
      accountName: true,
      tokenVersion: true,
      credentialRevision: true,
      revision: true,
      studentProfile: {
        select: {
          legalName: true,
          nickname: true,
          profileRevision: true,
          enrollments: {
            where: currentStudentEnrollmentWhere({ viewMode: context.viewMode, teacherId: input.userId, academicYearId: context.academicYear.id }),
            take: 1,
            select: {
              id: true,
              grade: true,
              classId: true,
              revision: true,
              schoolClass: { select: { classCode: true } },
            },
          },
        },
      },
    },
  });
  if (!user?.studentProfile) throw new Error("STUDENT_NOT_FOUND");
  const snapshot = await metricSnapshot([user.id]);
  const enrollment = user.studentProfile.enrollments[0];
  const canResetStudentPassword = input.role === ROLES.ADMIN || await awaitTeacherGlobalReset(input.userId);
  if (canResetStudentPassword && !input.sessionJti) throw new Error("RESET_PRECONDITION_UNAVAILABLE");
  return { context, student: { id: user.id, accountName: user.accountName, legalName: user.studentProfile.legalName, nickname: user.studentProfile.nickname, grade: enrollment?.grade ?? null, classId: enrollment?.classId ?? null, classCode: enrollment?.schoolClass?.classCode ?? null, canResetStudentPassword, resetPrecondition: canResetStudentPassword && input.sessionJti ? issueTeacherResetPrecondition({ targetId: user.id, actorId: input.userId, sessionJti: input.sessionJti, targetTokenVersion: user.tokenVersion, targetCredentialRevision: user.credentialRevision, actorAccessRevision: input.role === ROLES.TEACHER ? context.accessRevision : null }) : null, userRevision: user.revision, profileRevision: user.studentProfile.profileRevision, enrollmentRevision: enrollment?.revision ?? null, ...itemMetrics(user.id, snapshot) } };
}

export async function touchRosterRevision(tx: Prisma.TransactionClient) {
  await lockRosterMutationState(tx);
  await tx.rosterMutationState.update({ where: { id: 1 }, data: { revision: { increment: 1 } } });
}
