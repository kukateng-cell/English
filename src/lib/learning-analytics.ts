import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, StudentGrade, ClassCode, Role } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { todayKey, offsetDay } from "@/lib/streak";
import { MASTERED_MIN_INTERVAL } from "@/lib/mastered";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { STUDENT_GRADES } from "@/lib/roster-domain";
import { OBJECTIVE_QUALITY_POLICY_VERSION } from "@/lib/learning-policy/types";

const BODY_LIMIT = 16 * 1024;
const MAX_DAYS = 180;
const TIMEZONE = "Asia/Shanghai";
const CURSOR_VERSION = 1;
const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const LOCAL_DATE_CACHE = new Map<number, string>();

export type AnalyticsQuery = {
  fromDate: string;
  toDate: string;
  asOf?: Date;
  grade?: StudentGrade;
  classIds?: string[];
  classFilter?: { kind: "CLASS"; classId: string } | { kind: "UNASSIGNED" };
  search?: string;
  cursor?: string;
  limit: number;
  sort: "ACCOUNT_ASC";
  compareStudentIds?: string[];
};

type EffectiveRange = {
  requestedFrom: string;
  requestedTo: string;
  from: string;
  to: string;
  rangeClamped: boolean;
  timezone: string;
  calendarWarning?: "CURRENT_YEAR_ENDED_NOT_ACTIVATED";
};

type Member = {
  id: string;
  accountName: string;
  accountNameCanonical: string | null;
  legalName: string;
  nickname: string;
  grade: StudentGrade;
  classId: string | null;
  classCode: ClassCode | null;
  startedAt: Date | null;
};

type CandidateExcluded = { historical: number; nonWinning: number; unsupportedPurpose: number; missingProvenance: number; unknownPolicyVersion: number; invalidPolicyOutcome: number };
type ObjectiveMetric = {
  objectiveCandidateCount: number;
  correctCount: number;
  eligibleAttemptCount: number;
  accuracyPercent: number | null;
  accuracyDisplayStatus: "NO_DATA" | "SMALL_SAMPLE" | "SUFFICIENT";
  studentsWithAttempts: number;
  perStudentAccuracyMedian: number | null;
  perStudentAccuracyMedianDisplayStatus: "NO_DATA" | "SMALL_COHORT" | "SUFFICIENT";
  excludedDistinctTotal: number;
  excludedCounts: CandidateExcluded;
};

type Metric = {
  currentMemberCount: number;
  eligibleMemberCount: number;
  activeStudentCount: number;
  activeRate: number | null;
  studyDays: number;
  medianStudyDays: number | null;
  learningEncounterCount: number;
  medianLearningEncounters: number | null;
  effectiveReviewCount: number;
  reviewsPerEligibleMember: number | null;
  objective: ObjectiveMetric;
  mastery: { meanPercent: number | null; medianPercent: number | null };
  due: { studentCount: number; rate: number | null };
};

type CursorPayload = { v: number; id: string; accountName: string; fingerprint: string; scopeRevision: number; asOf: string; effectiveFrom: string; effectiveTo: string };

function cursorSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for analytics cursor");
  return "development-only-learning-analytics-cursor-secret";
}

function sign(value: string) { return createHmac("sha256", cursorSecret()).update("learning-analytics-v1:").update(value).digest("base64url"); }
function encodeCursor(payload: Omit<CursorPayload, "v">) { const body = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...payload }), "utf8").toString("base64url"); return `${body}.${sign(body)}`; }
function decodeCursor(value: string): CursorPayload | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const [body, sig] = value.split("."); if (!body || !sig) return null;
  const a = Buffer.from(sig); const b = Buffer.from(sign(body)); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CursorPayload>; if (parsed.v !== CURSOR_VERSION || typeof parsed.id !== "string" || typeof parsed.accountName !== "string" || typeof parsed.fingerprint !== "string" || !Number.isInteger(parsed.scopeRevision) || typeof parsed.asOf !== "string" || typeof parsed.effectiveFrom !== "string" || typeof parsed.effectiveTo !== "string") return null; return parsed as CursorPayload; } catch { return null; }
}

function validDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function dateDistance(from: string, to: string) { const [fy, fm, fd] = from.split("-").map(Number); const [ty, tm, td] = to.split("-").map(Number); return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000); }
function atShanghaiStart(key: string) { return new Date(`${key}T00:00:00+08:00`); }
function atShanghaiEnd(key: string) { return new Date(`${offsetDay(key, 1)}T00:00:00+08:00`); }
function localDate(value: Date) {
  const cached = LOCAL_DATE_CACHE.get(value.getTime());
  if (cached) return cached;
  const parts = LOCAL_DATE_FORMATTER.formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const result = `${get("year")}-${get("month")}-${get("day")}`;
  LOCAL_DATE_CACHE.set(value.getTime(), result);
  return result;
}
function daysBetween(from: string, to: string) { const rows: string[] = []; for (let cursor = from; cursor <= to; cursor = offsetDay(cursor, 1)) rows.push(cursor); return rows; }
function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function round(value: number | null) { return value === null ? null : Math.round(value * 100) / 100; }
function graphemes(value: string) { return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value)].length; }

export async function readAnalyticsQuery(req: Request): Promise<AnalyticsQuery> {
  const contentLength = Number(req.headers.get("content-length") ?? 0); if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
  const raw = await req.text().catch(() => ""); if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
  let body: Record<string, unknown>; try { body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>; } catch { throw new Error("QUERY_INVALID"); }
  const allowedKeys = new Set(["range", "fromDate", "toDate", "asOf", "grade", "classIds", "classFilter", "search", "cursor", "limit", "sort", "compareStudentIds"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) throw new Error("QUERY_INVALID");
  const range = body.range && typeof body.range === "object" ? body.range as Record<string, unknown> : body;
  if (body.range !== undefined && (!body.range || typeof body.range !== "object" || Object.keys(range).some((key) => key !== "fromDate" && key !== "toDate"))) throw new Error("QUERY_INVALID");
  const fromDate = range.fromDate; const toDate = range.toDate;
  const today = todayKey();
  const defaultFrom = offsetDay(today, -29);
  const from = fromDate === undefined ? defaultFrom : fromDate;
  const to = toDate === undefined ? today : toDate;
  if (!validDate(from) || !validDate(to) || from > to || to > today || dateDistance(from, to) + 1 > MAX_DAYS) throw new Error("QUERY_INVALID");
  const parseId = (value: unknown) => { if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 128) throw new Error("QUERY_INVALID"); return value; };
  const classIds = body.classIds === undefined ? undefined : Array.isArray(body.classIds) ? body.classIds.map(parseId) : (() => { throw new Error("QUERY_INVALID"); })();
  if (classIds && (classIds.length < 1 || classIds.length > 6 || new Set(classIds).size !== classIds.length)) throw new Error("QUERY_INVALID");
  const compareStudentIds = body.compareStudentIds === undefined ? undefined : Array.isArray(body.compareStudentIds) ? body.compareStudentIds.map(parseId) : (() => { throw new Error("QUERY_INVALID"); })();
  if (compareStudentIds && (compareStudentIds.length < 1 || compareStudentIds.length > 8 || new Set(compareStudentIds).size !== compareStudentIds.length)) throw new Error("QUERY_INVALID");
  const classFilterRaw = body.classFilter;
  let classFilter: AnalyticsQuery["classFilter"];
  if (classFilterRaw !== undefined) {
    if (!classFilterRaw || typeof classFilterRaw !== "object") throw new Error("QUERY_INVALID");
    const value = classFilterRaw as Record<string, unknown>;
    if (value.kind === "UNASSIGNED") classFilter = { kind: "UNASSIGNED" };
    else if (value.kind === "CLASS") classFilter = { kind: "CLASS", classId: parseId(value.classId) };
    else throw new Error("QUERY_INVALID");
  }
  const searchRaw = typeof body.search === "string" ? body.search.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
  if (graphemes(searchRaw) > 80) throw new Error("QUERY_INVALID");
  const limit = body.limit === undefined ? 50 : Number(body.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("QUERY_INVALID");
  const cursor = body.cursor === undefined ? undefined : (() => {
    if (typeof body.cursor !== "string" || !body.cursor || Buffer.byteLength(body.cursor, "utf8") > 2048) throw new Error("QUERY_INVALID");
    return body.cursor;
  })();
  const sort = body.sort === undefined ? "ACCOUNT_ASC" : body.sort; if (sort !== "ACCOUNT_ASC") throw new Error("QUERY_INVALID");
  const grade = body.grade === undefined || body.grade === "" ? undefined : body.grade as StudentGrade; if (grade && !STUDENT_GRADES.includes(grade)) throw new Error("QUERY_INVALID");
  const asOfValue = typeof body.asOf === "string" ? new Date(body.asOf) : undefined;
  if (asOfValue && (Number.isNaN(asOfValue.getTime()) || asOfValue.getTime() > Date.now())) throw new Error("QUERY_INVALID");
  return { fromDate: from, toDate: to, asOf: asOfValue, grade, classIds, classFilter, search: searchRaw || undefined, cursor, limit, sort: "ACCOUNT_ASC", compareStudentIds };
}

type Db = typeof prisma | Prisma.TransactionClient;

async function readYear(db: Db) {
  const year = await db.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: [{ startsOn: "desc" }, { id: "asc" }], select: { id: true, label: true, startsOn: true, endsOn: true, revision: true, status: true } });
  if (!year) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  return year;
}

async function readEffectiveRange(db: Db, query: AnalyticsQuery) {
  const year = await readYear(db);
  const today = todayKey(); const yearFrom = localDate(year.startsOn); const yearTo = localDate(year.endsOn);
  if (today < yearFrom) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  const from = query.fromDate > yearFrom ? query.fromDate : yearFrom;
  const to = query.toDate < yearTo && query.toDate < today ? query.toDate : (yearTo < today ? yearTo : today);
  if (from > to) throw new Error("RANGE_OUTSIDE_CURRENT_YEAR");
  return { year, range: { requestedFrom: query.fromDate, requestedTo: query.toDate, from, to, rangeClamped: from !== query.fromDate || to !== query.toDate, timezone: TIMEZONE, ...(today > yearTo ? { calendarWarning: "CURRENT_YEAR_ENDED_NOT_ACTIVATED" as const } : {}) } satisfies EffectiveRange };
}

async function readScopeRevision(db: Db) { const state = await db.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } }); return state?.revision ?? 0; }

async function readAuthorizedClasses(db: Db, input: { userId: string; role: Role; yearId: string; grade?: StudentGrade }) {
  return db.schoolClass.findMany({ where: { academicYearId: input.yearId, active: true, ...(input.grade ? { grade: input.grade } : {}), ...(input.role === "TEACHER" ? { teacherAccess: { some: { teacherId: input.userId, canViewProgress: true } } } : {}) }, orderBy: [{ grade: "asc" }, { classCode: "asc" }, { id: "asc" }], select: { id: true, grade: true, classCode: true, revision: true } });
}

async function readMembers(db: Db, input: { userId: string; role: Role; yearId: string; grade?: StudentGrade; classId?: string; unassigned?: boolean; search?: string }) {
  if (input.role === "TEACHER") {
    const teacher = await db.user.findUnique({ where: { id: input.userId }, select: { status: true, teacherProfile: { select: { accessRevision: true } } } });
    if (!teacher || teacher.status !== "ACTIVE" || !teacher.teacherProfile) throw new Error("ROLE_FORBIDDEN");
  }
  const search = input.search ? normalizeLegalName(input.search) : undefined;
  const rows = await db.user.findMany({ where: { role: "STUDENT", status: "ACTIVE", ...(search ? { OR: [{ accountName: { contains: normalizeAccountName(input.search!), mode: "insensitive" } }, { studentProfile: { is: { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { nickname: { contains: input.search, mode: "insensitive" } }] } } }] } : {}), studentProfile: { is: { enrollments: { some: { academicYearId: input.yearId, status: "ACTIVE", ...(input.classId ? { classId: input.classId } : {}), ...(input.unassigned ? { classId: null } : {}), ...(input.role === "TEACHER" ? { schoolClass: { is: { active: true, teacherAccess: { some: { teacherId: input.userId, canViewProgress: true } } } } } : input.unassigned ? {} : { schoolClass: { is: { active: true } } }) } } } } }, orderBy: [{ accountNameCanonical: "asc" }, { accountName: "asc" }, { id: "asc" }], select: { id: true, accountName: true, accountNameCanonical: true, studentProfile: { select: { legalName: true, nickname: true, enrollments: { where: { academicYearId: input.yearId, status: "ACTIVE" }, take: 1, select: { grade: true, classId: true, startedAt: true, schoolClass: { select: { classCode: true, active: true } } } } } } } });
  return rows.flatMap((row) => { const enrollment = row.studentProfile?.enrollments[0]; if (!enrollment) return []; return [{ id: row.id, accountName: row.accountName, accountNameCanonical: row.accountNameCanonical, legalName: row.studentProfile?.legalName ?? "", nickname: row.studentProfile?.nickname ?? "", grade: enrollment.grade, classId: enrollment.classId, classCode: enrollment.schoolClass?.classCode ?? null, startedAt: enrollment.startedAt } satisfies Member]; });
}

type LoadedActivity = {
  reviewEvents: Array<{ id: string; operationId: string; userId: string; submittedWordId: string; quality: number; createdAt: Date; isHistorical: boolean; evidenceKind: string | null; flowVersion: string | null; qualityPolicyVersion: string | null; probePurpose: string | null; objectiveEvidenceTargetId: string | null; objectiveQuestionSnapshotId: string | null; objectiveEvidenceTarget: { status: string; winningOperationId: string | null; winningReviewEventId: string | null; purpose: string; obligation: { status: string } | null; questionSnapshot: { id: string } | null } | null }>;
  encounters: Array<{ userId: string; wordId: string | null; acknowledgedAt: Date }>;
  studyDays: Array<{ userId: string; date: string; createdAt: Date }>;
  reviews: Array<{ userId: string; interval: number; nextReviewDate: Date }>;
  wordCount: number;
  reviewEventsByUser: Map<string, LoadedActivity["reviewEvents"]>;
  encountersByUser: Map<string, LoadedActivity["encounters"]>;
  studyDaysByUser: Map<string, LoadedActivity["studyDays"]>;
  reviewsByUser: Map<string, LoadedActivity["reviews"]>;
};

function indexByUser<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) (result.get(row.userId) ?? (result.set(row.userId, []), result.get(row.userId)!)).push(row);
  return result;
}

async function loadActivity(db: Db, memberIds: string[], range: EffectiveRange, asOf: Date): Promise<LoadedActivity> {
  if (!memberIds.length) return { reviewEvents: [], encounters: [], studyDays: [], reviews: [], wordCount: await db.word.count(), reviewEventsByUser: new Map(), encountersByUser: new Map(), studyDaysByUser: new Map(), reviewsByUser: new Map() };
  const from = atShanghaiStart(range.from); const to = atShanghaiEnd(range.to);
  const [reviewEvents, encounters, studyDays, reviews, wordCount] = await Promise.all([
    db.reviewEvent.findMany({ where: { userId: { in: memberIds }, eventKind: "REVIEW", createdAt: { gte: from, lte: asOf } }, select: { id: true, operationId: true, userId: true, submittedWordId: true, quality: true, createdAt: true, isHistorical: true, evidenceKind: true, flowVersion: true, qualityPolicyVersion: true, probePurpose: true, objectiveEvidenceTargetId: true, objectiveQuestionSnapshotId: true, objectiveEvidenceTarget: { select: { status: true, winningOperationId: true, winningReviewEventId: true, purpose: true, obligation: { select: { status: true } }, questionSnapshot: { select: { id: true } } } } } }),
    db.studyEncounter.findMany({ where: { userId: { in: memberIds }, acknowledgedAt: { gte: from, lt: to, lte: asOf } }, select: { userId: true, wordId: true, acknowledgedAt: true } }),
    db.studyDay.findMany({ where: { userId: { in: memberIds }, date: { gte: range.from, lte: range.to }, createdAt: { lte: asOf } }, select: { userId: true, date: true, createdAt: true } }),
    db.review.findMany({ where: { userId: { in: memberIds } }, select: { userId: true, interval: true, nextReviewDate: true } }),
    db.word.count(),
  ]);
  return { reviewEvents, encounters, studyDays, reviews, wordCount, reviewEventsByUser: indexByUser(reviewEvents), encountersByUser: indexByUser(encounters), studyDaysByUser: indexByUser(studyDays), reviewsByUser: indexByUser(reviews) };
}

function objectiveFor(memberIds: string[], events: LoadedActivity["reviewEvents"], dateFrom?: string, dateTo?: string) {
  const excluded: CandidateExcluded = { historical: 0, nonWinning: 0, unsupportedPurpose: 0, missingProvenance: 0, unknownPolicyVersion: 0, invalidPolicyOutcome: 0 };
  const perStudent = new Map<string, { correct: number; attempts: number }>();
  let candidate = 0; let correct = 0; let eligible = 0;
  for (const event of events) {
    const date = localDate(event.createdAt); if (dateFrom && (date < dateFrom || date > dateTo!)) continue;
    const marker = event.evidenceKind === "OBJECTIVE_PROBE" || Boolean(event.objectiveEvidenceTargetId) || Boolean(event.objectiveQuestionSnapshotId) || event.probePurpose !== null;
    if (!marker) continue;
    candidate += 1;
    if (event.isHistorical) { excluded.historical += 1; continue; }
    if (!event.objectiveEvidenceTargetId || !event.objectiveQuestionSnapshotId || !event.flowVersion || event.flowVersion !== "v2") { excluded.missingProvenance += 1; continue; }
    if (!event.objectiveEvidenceTarget || event.objectiveEvidenceTarget.status !== "CONSUMED" || event.objectiveEvidenceTarget.purpose !== event.probePurpose || event.objectiveEvidenceTarget.winningReviewEventId !== event.id || event.objectiveEvidenceTarget.winningOperationId !== event.operationId || event.objectiveEvidenceTarget.questionSnapshot?.id !== event.objectiveQuestionSnapshotId) { excluded.nonWinning += 1; continue; }
    if (event.objectiveEvidenceTarget.obligation && !["ANSWERED", "EXPIRED"].includes(event.objectiveEvidenceTarget.obligation.status)) { excluded.missingProvenance += 1; continue; }
    if (event.probePurpose !== "DUE_REVIEW" && event.probePurpose !== "EVIDENCE_OBLIGATION") { excluded.unsupportedPurpose += 1; continue; }
    if (event.qualityPolicyVersion !== OBJECTIVE_QUALITY_POLICY_VERSION) { excluded.unknownPolicyVersion += 1; continue; }
    // Retrieval-v1's server policy only accepts these two operational qualities.
    const quality = event.quality;
    if (quality !== 4 && quality !== 2) { excluded.invalidPolicyOutcome += 1; continue; }
    eligible += 1; if (quality === 4) correct += 1;
    const current = perStudent.get(event.userId) ?? { correct: 0, attempts: 0 }; current.attempts += 1; if (quality === 4) current.correct += 1; perStudent.set(event.userId, current);
  }
  const rates = [...perStudent.values()].filter((item) => item.attempts > 0).map((item) => item.correct / item.attempts * 100);
  const excludedDistinctTotal = Object.values(excluded).reduce((sum, value) => sum + value, 0);
  return { metric: { objectiveCandidateCount: candidate, correctCount: correct, eligibleAttemptCount: eligible, accuracyPercent: eligible ? round(correct / eligible * 100) : null, accuracyDisplayStatus: eligible === 0 ? "NO_DATA" as const : eligible < 5 ? "SMALL_SAMPLE" as const : "SUFFICIENT" as const, studentsWithAttempts: perStudent.size, perStudentAccuracyMedian: round(median(rates)), perStudentAccuracyMedianDisplayStatus: rates.length === 0 ? "NO_DATA" as const : rates.length < 5 ? "SMALL_COHORT" as const : "SUFFICIENT" as const, excludedDistinctTotal, excludedCounts: excluded }, perStudent };
}

function metricFor(members: Member[], activity: LoadedActivity, range: EffectiveRange, dateFrom?: string, dateTo?: string, asOf = new Date()): Metric {
  const from = dateFrom ?? range.from; const to = dateTo ?? range.to;
  const eligible = members.filter((member) => { const start = member.startedAt ? localDate(member.startedAt) : range.from; const exposureStart = start > from ? start : from; return exposureStart <= to; });
  const active = new Set<string>();
  const studies: number[] = [];
  const encounterCounts: number[] = [];
  const encounters: LoadedActivity["encounters"] = [];
  const reviews: LoadedActivity["reviewEvents"] = [];
  const stock = new Map<string, { mastered: number; due: number }>();
  for (const member of members) {
    const exposureStart = member.startedAt ? localDate(member.startedAt) : from;
    const isExposed = (date: string) => date >= from && date <= to && date >= exposureStart;
    const days = new Set<string>();
    for (const row of activity.studyDaysByUser.get(member.id) ?? []) if (isExposed(row.date) && row.createdAt <= asOf) days.add(row.date);
    const memberEncounters = (activity.encountersByUser.get(member.id) ?? []).filter((row) => isExposed(localDate(row.acknowledgedAt)) && row.acknowledgedAt <= asOf);
    const memberReviews = (activity.reviewEventsByUser.get(member.id) ?? []).filter((row) => !row.isHistorical && isExposed(localDate(row.createdAt)) && row.createdAt <= asOf);
    if (days.size || memberEncounters.length || memberReviews.length) active.add(member.id);
    studies.push(days.size); encounterCounts.push(memberEncounters.length); encounters.push(...memberEncounters); reviews.push(...memberReviews);
    const memberStock = activity.reviewsByUser.get(member.id) ?? [];
    stock.set(member.id, { mastered: memberStock.filter((row) => row.interval >= MASTERED_MIN_INTERVAL).length, due: memberStock.filter((row) => row.nextReviewDate <= asOf).length });
  }
  const eligibleIds = new Set(eligible.map((member) => member.id));
  const objective = objectiveFor([...eligibleIds], reviews, from, to).metric;
  const mastery = members.map((member) => (activity.wordCount ? (stock.get(member.id)?.mastered ?? 0) / activity.wordCount * 100 : 0));
  const dueStudentCount = members.filter((member) => (stock.get(member.id)?.due ?? 0) > 0).length;
  return { currentMemberCount: members.length, eligibleMemberCount: eligible.length, activeStudentCount: active.size, activeRate: eligible.length ? round(active.size / eligible.length * 100) : null, studyDays: studies.reduce((sum, value) => sum + value, 0), medianStudyDays: median(studies), learningEncounterCount: encounters.length, medianLearningEncounters: median(encounterCounts), effectiveReviewCount: reviews.length, reviewsPerEligibleMember: eligible.length ? round(reviews.length / eligible.length) : null, objective, mastery: { meanPercent: round(mean(mastery)), medianPercent: round(median(mastery)) }, due: { studentCount: dueStudentCount, rate: members.length ? round(dueStudentCount / members.length * 100) : null } };
}

function memberMetric(members: Member[], activity: LoadedActivity, range: EffectiveRange, member: Member, asOf = new Date()) {
  const metric = metricFor([member], activity, range, undefined, undefined, asOf);
  const exposureStart = member.startedAt ? localDate(member.startedAt) : range.from;
  const inRangeReview = (row: LoadedActivity["reviewEvents"][number]) => row.userId === member.id && !row.isHistorical && localDate(row.createdAt) >= range.from && localDate(row.createdAt) <= range.to && localDate(row.createdAt) >= exposureStart && row.createdAt <= asOf;
  const inRangeEncounter = (row: LoadedActivity["encounters"][number]) => row.userId === member.id && localDate(row.acknowledgedAt) >= range.from && localDate(row.acknowledgedAt) <= range.to && localDate(row.acknowledgedAt) >= exposureStart && row.acknowledgedAt <= asOf;
  const userReviews = activity.reviewEventsByUser.get(member.id) ?? [];
  const userEncounters = activity.encountersByUser.get(member.id) ?? [];
  const reviewWords = new Set(userReviews.filter(inRangeReview).map((row) => row.submittedWordId));
  const encounterWords = new Set(userEncounters.filter((row) => inRangeEncounter(row) && row.wordId).map((row) => row.wordId!));
  const lastReview = userReviews.filter(inRangeReview).map((row) => row.createdAt.getTime());
  const lastEncounter = userEncounters.filter(inRangeEncounter).map((row) => row.acknowledgedAt.getTime());
  const stock = activity.reviewsByUser.get(member.id) ?? []; const mastered = stock.filter((row) => row.interval >= MASTERED_MIN_INTERVAL).length; const due = stock.filter((row) => row.nextReviewDate <= asOf).length;
  const start = member.startedAt ? localDate(member.startedAt) : range.from; const exposureFrom = start > range.from ? start : range.from; const eligibleDayCount = exposureFrom <= range.to ? dateDistance(exposureFrom, range.to) + 1 : 0;
  const activeDayCount = new Set((activity.studyDaysByUser.get(member.id) ?? []).filter((row) => row.date >= range.from && row.date <= range.to && row.createdAt <= asOf).map((row) => row.date)).size;
  const unknownEncounterWordCount = userEncounters.filter((row) => inRangeEncounter(row) && !row.wordId).length;
  return { id: member.id, accountName: member.accountName, legalName: member.legalName, nickname: member.nickname, grade: member.grade, classId: member.classId, classCode: member.classCode, exposureStart: exposureFrom, eligibleDayCount, activeDayCount, learningEncounterCount: metric.learningEncounterCount, effectiveReviewCount: metric.effectiveReviewCount, evaluatedDistinctWordCount: reviewWords.size, encounteredDistinctWordCount: encounterWords.size, unknownEncounterWordCount, objective: metric.objective, currentMastery: { masteredWordCount: mastered, wordCount: activity.wordCount, percent: activity.wordCount ? round(mastered / activity.wordCount * 100) : null }, dueReviewCount: due, lastStudyAt: [...lastReview, ...lastEncounter].length ? new Date(Math.max(...lastReview, ...lastEncounter)).toISOString() : null };
}

function baseEnvelope(viewMode: "TEACHER" | "ADMIN", year: Awaited<ReturnType<typeof readYear>>, range: EffectiveRange, asOf: Date, scopeRevision: number) { return { viewMode, cohortBasis: "CURRENT_MEMBERSHIP" as const, academicYear: { id: year.id, label: year.label, startsOn: year.startsOn.toISOString(), endsOn: year.endsOn.toISOString() }, requestedRange: { fromDate: range.requestedFrom, toDate: range.requestedTo }, effectiveRange: range, asOf: asOf.toISOString(), dataCoverageWarning: null, scopeRevision }; }

type AnalyticsSnapshot = {
  year: Awaited<ReturnType<typeof readYear>>;
  range: EffectiveRange;
  scopeRevision: number;
  classes: Awaited<ReturnType<typeof readAuthorizedClasses>>;
  asOf: Date;
  actor: { role: Role; status: "ACTIVE" | "SUSPENDED"; tokenVersion: number; credentialRevision: number; accessRevision: number | null };
};

async function readAnalyticsActor(db: Db, input: { userId: string; role: Role }) {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { role: true, status: true, tokenVersion: true, credentialRevision: true, teacherProfile: { select: { accessRevision: true } } } });
  if (!user || user.role !== input.role) throw new Error("ROLE_FORBIDDEN");
  if (user.status !== "ACTIVE") throw new Error("AUTH_REQUIRED");
  return { role: user.role, status: user.status, tokenVersion: user.tokenVersion, credentialRevision: user.credentialRevision, accessRevision: user.teacherProfile?.accessRevision ?? null };
}

async function recheckAnalyticsSnapshot(input: { userId: string; role: Role; snapshot: AnalyticsSnapshot }) {
  const [actor, scopeRevision] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { role: true, status: true, tokenVersion: true, credentialRevision: true, teacherProfile: { select: { accessRevision: true } } } }),
    readScopeRevision(prisma),
  ]);
  if (!actor || actor.role !== input.role || actor.status !== "ACTIVE") throw new Error("ROLE_FORBIDDEN");
  if (actor.tokenVersion !== input.snapshot.actor.tokenVersion || actor.credentialRevision !== input.snapshot.actor.credentialRevision) throw new Error("AUTH_REQUIRED");
  if (input.role === "TEACHER" && actor.teacherProfile?.accessRevision !== input.snapshot.actor.accessRevision) throw new Error("ANALYTICS_SCOPE_STALE");
  if (scopeRevision !== input.snapshot.scopeRevision) throw new Error("ANALYTICS_SCOPE_STALE");
}

async function withAnalyticsSnapshot<T>(input: { userId: string; role: Role; query: AnalyticsQuery }, callback: (db: Prisma.TransactionClient, snapshot: AnalyticsSnapshot) => Promise<T>) {
  const result = await prisma.$transaction(async (tx) => {
    const actor = await readAnalyticsActor(tx, input);
    const { year, range } = await readEffectiveRange(tx, input.query);
    const scopeRevision = await readScopeRevision(tx);
    const classes = await readAuthorizedClasses(tx, { userId: input.userId, role: input.role, yearId: year.id, grade: input.query.grade });
    const asOf = input.query.asOf ?? new Date();
    const snapshot = { year, range, scopeRevision, classes, asOf, actor } satisfies AnalyticsSnapshot;
    return { value: await callback(tx, snapshot), snapshot };
  }, { isolationLevel: "RepeatableRead" });
  await recheckAnalyticsSnapshot({ userId: input.userId, role: input.role, snapshot: result.snapshot });
  return { value: result.value, snapshot: result.snapshot };
}

export async function queryLearningAnalyticsClasses(input: { userId: string; role: Role; query: AnalyticsQuery }) {
  if (input.query.classIds && input.query.classIds.length > 6) throw new Error("QUERY_INVALID");
  const result = await withAnalyticsSnapshot(input, async (tx, snapshot) => {
    const { year, range, scopeRevision, classes, asOf } = snapshot;
    const selected = input.query.classIds ? classes.filter((item) => input.query.classIds!.includes(item.id)) : classes;
    if (input.query.classIds && selected.length !== input.query.classIds.length) throw new Error("CLASS_NOT_FOUND");
    if (!input.query.classIds && selected.length > 48) throw new Error("QUERY_INVALID");
    const comparison = Boolean(input.query.classIds);
    const allMembers = await readMembers(tx, { userId: input.userId, role: input.role, yearId: year.id, grade: input.query.grade });
    const activity = await loadActivity(tx, allMembers.map((member) => member.id), range, asOf);
    const items = selected.map((schoolClass) => { const members = allMembers.filter((member) => member.classId === schoolClass.id); return { classId: schoolClass.id, grade: schoolClass.grade, classCode: schoolClass.classCode, ...metricFor(members, activity, range, undefined, undefined, asOf) }; });
    const unassignedMembers = input.role === "ADMIN" ? allMembers.filter((member) => member.classId === null) : [];
    const unassignedSummary = input.role === "ADMIN" && unassignedMembers.length ? metricFor(unassignedMembers, activity, range, undefined, undefined, asOf) : null;
    // Timeline is a comparison chart, not a second copy of the full summary
    // DTO. Keep only the three chart dimensions used by the UI so a 6-class ×
    // 180-day response stays within the documented response budget.
    const timeline = comparison ? daysBetween(range.from, range.to).map((date) => ({ date, classes: selected.map((schoolClass) => { const members = allMembers.filter((member) => member.classId === schoolClass.id); const metric = metricFor(members, activity, range, date, date, asOf); return { classId: schoolClass.id, activeRate: metric.activeRate, objective: { accuracyPercent: metric.objective.accuracyPercent }, mastery: { meanPercent: metric.mastery.meanPercent } }; }) })) : [];
    return { ...baseEnvelope(input.role === "ADMIN" ? "ADMIN" : "TEACHER", year, range, asOf, scopeRevision), items, unassignedSummary, timeline };
  });
  return result.value;
}

export async function queryLearningAnalyticsStudents(input: { userId: string; role: Role; query: AnalyticsQuery }) {
  const cursorSeed = input.query.cursor ? decodeCursor(input.query.cursor) : null;
  if (input.query.cursor && !cursorSeed) throw new Error("CURSOR_INVALID");
  const snapshotQuery = cursorSeed && !input.query.asOf ? { ...input.query, asOf: new Date(cursorSeed.asOf) } : input.query;
  const result = await withAnalyticsSnapshot({ ...input, query: snapshotQuery }, async (tx, snapshot) => {
    const { year, range, scopeRevision, classes, asOf } = snapshot;
    if (input.query.classFilter?.kind === "UNASSIGNED" && input.role !== "ADMIN") throw new Error("QUERY_INVALID");
    const selectedClassId = input.query.classFilter?.kind === "CLASS" ? input.query.classFilter.classId : undefined;
    if (selectedClassId && !classes.some((item) => item.id === selectedClassId)) throw new Error("CLASS_NOT_FOUND");
    const members = await readMembers(tx, { userId: input.userId, role: input.role, yearId: year.id, grade: input.query.grade, classId: selectedClassId, unassigned: input.query.classFilter?.kind === "UNASSIGNED", search: input.query.search });
    const fingerprint = sign(JSON.stringify({ role: input.role, userId: input.userId, range, asOf: asOf.toISOString(), grade: input.query.grade ?? null, classFilter: input.query.classFilter ?? null, search: input.query.search ?? null, sort: input.query.sort, limit: input.query.limit }));
    const cursor = input.query.cursor ? decodeCursor(input.query.cursor) : null;
    if (input.query.cursor && (!cursor || cursor.fingerprint !== fingerprint || cursor.scopeRevision !== scopeRevision || cursor.asOf !== asOf.toISOString() || cursor.effectiveFrom !== range.from || cursor.effectiveTo !== range.to)) throw new Error(cursor ? "ANALYTICS_SCOPE_STALE" : "CURSOR_INVALID");
    const cursorKey = cursor?.accountName ?? "";
    const sortKey = (member: Member) => member.accountNameCanonical ?? member.accountName;
    const filtered = cursor ? members.filter((member) => sortKey(member) > cursorKey || (sortKey(member) === cursorKey && member.id > cursor.id)) : members;
    const rows = filtered.slice(0, input.query.limit + 1); const hasNext = rows.length > input.query.limit; const page = hasNext ? rows.slice(0, input.query.limit) : rows;
    const activity = await loadActivity(tx, members.map((member) => member.id), range, asOf);
    const items = page.map((member) => memberMetric(members, activity, range, member, asOf));
    const comparisonMembers = input.query.compareStudentIds ? members.filter((member) => input.query.compareStudentIds!.includes(member.id)) : [];
    if (input.query.compareStudentIds && comparisonMembers.length !== input.query.compareStudentIds.length) throw new Error("STUDENT_NOT_FOUND");
    const comparison = comparisonMembers.map((member) => memberMetric(members, activity, range, member, asOf));
    const last = page.at(-1);
    return { ...baseEnvelope(input.role === "ADMIN" ? "ADMIN" : "TEACHER", year, range, asOf, scopeRevision), items, comparison, nextCursor: hasNext && last ? encodeCursor({ id: last.id, accountName: sortKey(last), fingerprint, scopeRevision, asOf: asOf.toISOString(), effectiveFrom: range.from, effectiveTo: range.to }) : null };
  });
  return result.value;
}

export async function queryLearningAnalyticsTimeline(input: { userId: string; role: Role; studentId: string; query: AnalyticsQuery }) {
  const result = await withAnalyticsSnapshot(input, async (tx, snapshot) => {
    const { year, range, scopeRevision, asOf } = snapshot;
    const members = await readMembers(tx, { userId: input.userId, role: input.role, yearId: year.id });
    const member = members.find((item) => item.id === input.studentId); if (!member) throw new Error("STUDENT_NOT_FOUND");
    const activity = await loadActivity(tx, [member.id], range, asOf);
    const summary = memberMetric(members, activity, range, member, asOf);
    const days = daysBetween(range.from, range.to).map((date) => {
      const metric = metricFor([member], activity, range, date, date, asOf);
      return { date, eligible: date >= summary.exposureStart, activeStudentCount: metric.activeStudentCount, learningEncounterCount: metric.learningEncounterCount, effectiveReviewCount: metric.effectiveReviewCount, objectiveAttemptCount: metric.objective.eligibleAttemptCount, objectiveCorrectCount: metric.objective.correctCount, objectiveAccuracy: metric.objective.accuracyPercent, accuracyDisplayStatus: metric.objective.accuracyDisplayStatus };
    });
    return { ...baseEnvelope(input.role === "ADMIN" ? "ADMIN" : "TEACHER", year, range, asOf, scopeRevision), student: { id: member.id, accountName: member.accountName, legalName: member.legalName, nickname: member.nickname, grade: member.grade, classId: member.classId, classCode: member.classCode }, summary, timeline: days };
  });
  return result.value;
}
