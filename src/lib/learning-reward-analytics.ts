import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AcademicYearStatus, ClassCode, Level, Prisma as GeneratedPrisma, Role, StudentGrade } from "@/generated/prisma";
import { Prisma, prisma } from "@/lib/prisma";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { CLASS_LABELS, compareStudentNumberSortKey, parseStudentNumber, GRADE_LABELS, STUDENT_GRADES } from "@/lib/roster-domain";
import { offsetDay, todayKey } from "@/lib/streak";
import { readLimitedBody } from "@/lib/request-body";
import {
  addRewardScores,
  calculateRewardScores,
  emptyRewardScores,
  isRewardWeights,
  rewardAccuracyPercent,
  rewardAccuracyStatus,
  REWARD_DAILY_EFFORT_CAP,
  REWARD_DAILY_OUTCOME_CAP,
  REWARD_DAILY_SCALE,
  REWARD_POLICY_VERSION,
  REWARD_TIMEZONE,
  type RewardAccuracyStatus,
  type RewardScores,
  type RewardWeights,
} from "@/lib/learning-reward-policy";

const BODY_LIMIT = 128 * 1024;
const MAX_REWARD_DAYS = 366;
const MAX_REWARD_CLASSES = 200;
const MAX_REWARD_STUDENTS = 500;
const MAX_REWARD_ACTIVITY_ROWS = 200_000;
const MAX_REWARD_LIMIT = 100;
const DEFAULT_REWARD_LIMIT = 50;
const SCOPE_TOKEN_VERSION = 1;
const SCOPE_TOKEN_TTL_MS = 30 * 60_000;
const MAX_SIGNED_BYTES = 4_096;
const CURSOR_VERSION = 2;

// reward-v1 is a historical projection. These literals are deliberately not
// imported from the current learning-policy module so a future product policy
// cannot silently rewrite old reward reports.
const REWARD_SUPPORTED_FLOW_VERSION = "v2" as const;
const REWARD_SUPPORTED_POLICY_VERSION = "retrieval-v1" as const;
const REWARD_SUPPORTED_QUALITY_POLICY_VERSION = "retrieval-v1-quality-v1" as const;
const REWARD_SUPPORTED_CONSTRUCTION_VERSION = "retrieval-v1-mcq-curated-v2" as const;

export const REWARD_MAX_DAYS = MAX_REWARD_DAYS;
export const REWARD_MAX_CLASSES = MAX_REWARD_CLASSES;
export const REWARD_MAX_STUDENTS = MAX_REWARD_STUDENTS;
export const REWARD_MAX_ACTIVITY_ROWS = MAX_REWARD_ACTIVITY_ROWS;

const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: REWARD_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type Db = typeof prisma | Prisma.TransactionClient;

export type RewardRequest = {
  fromDate?: string;
  toDate?: string;
  grade?: StudentGrade;
  classIds?: string[];
  studentIds?: string[];
  search?: string;
  weights: RewardWeights;
  policyVersion: typeof REWARD_POLICY_VERSION;
  limit?: number;
  cursor?: string;
  asOf?: Date;
  scopeToken?: string;
  format?: "CSV" | "XLSX";
};

export type RewardRoute = "QUERY" | "TIMELINE" | "EXPORT";

export type RewardRange = {
  requestedFrom: string;
  requestedTo: string;
  from: string;
  to: string;
  rangeClamped: boolean;
  timezone: typeof REWARD_TIMEZONE;
  calendarWarning?: "CURRENT_YEAR_ENDED_NOT_ACTIVATED";
};

export type RewardMember = {
  id: string;
  accountName: string;
  studentNumber: number | null;
  legalName: string;
  nickname: string;
  grade: StudentGrade;
  classId: string | null;
  classCode: ClassCode | null;
  startedAt: Date | null;
};

type RewardYear = {
  id: string;
  label: string;
  startsOn: Date;
  endsOn: Date;
  revision: number;
  status: AcademicYearStatus;
};

type RewardClass = {
  id: string;
  grade: StudentGrade;
  classCode: ClassCode;
  revision: number;
};

type RewardActor = {
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  tokenVersion: number;
  credentialRevision: number;
  accessRevision: number | null;
};

type SourceBucket =
  | "outsideEligibility"
  | "policyExcluded"
  | "unsupportedVersion"
  | "missingIdentityOrProvenance"
  | "nonWinningOrInvalidOutcome"
  | "included";

export type RewardSourceCounts = {
  candidateCount: number;
  outsideEligibility: number;
  policyExcluded: number;
  unsupportedVersion: number;
  missingIdentityOrProvenance: number;
  nonWinningOrInvalidOutcome: number;
  included: number;
};

export type RewardCoverage = {
  sources: {
    encounters: RewardSourceCounts;
    reviews: RewardSourceCounts;
  };
  validationGapCount: number;
  policyExcludedCount: number;
  validationStatus: "CHECKED" | "INCOMPLETE";
  historyCoverage: "NOT_GUARANTEED" | "KNOWN_GAP";
  studyDayMismatchCount: number;
  warningCodes: string[];
};

export type RewardLevelCounts = Record<"A1" | "A2" | "B1" | "B2", { attempts: number; correct: number }>;

export type RewardDay = {
  studentId: string;
  date: string;
  eligible: boolean;
  learningCardCount: number | null;
  objectiveAttemptCount: number | null;
  objectiveCorrectCount: number | null;
  effortActivityCount: number | null;
  creditedEffortActivityCount: number | null;
  firstCorrectSenseCount: number | null;
  creditedFirstCorrectSenseCount: number | null;
  distinctSenseCount: number | null;
  levelCounts: RewardLevelCounts | null;
  objectiveAccuracyPercent: number | null;
  accuracyStatus: RewardAccuracyStatus;
  effortCapReached: boolean | null;
  outcomeCapReached: boolean | null;
  scores: RewardScores | null;
  cumulative: RewardScores | null;
  coverage: RewardCoverage;
};

export type RewardStudentTotal = {
  studentId: string;
  studentNumber: number | null;
  accountName: string;
  legalName: string;
  nickname: string;
  grade: StudentGrade;
  classId: string | null;
  classLabel: string;
  eligibleFrom: string;
  eligibleDayCount: number;
  activeDayCount: number;
  learningCardCount: number;
  objectiveAttemptCount: number;
  objectiveCorrectCount: number;
  effortActivityCount: number;
  creditedEffortActivityCount: number;
  firstCorrectSenseDayCount: number;
  creditedFirstCorrectSenseDayCount: number;
  distinctSenseCount: number;
  levelCounts: RewardLevelCounts;
  objectiveAccuracyPercent: number | null;
  accuracyStatus: RewardAccuracyStatus;
  effortCapDays: number;
  outcomeCapDays: number;
  effortCapDayPercent: number | null;
  outcomeCapDayPercent: number | null;
  scores: RewardScores | null;
  coverage: RewardCoverage;
};

export type RewardCoverageSummary = {
  basis: "WHOLE_REPORT";
  studentCount: number;
  studentsWithValidationGaps: number;
  studentsWithPolicyExclusions: number;
  studentsWithKnownHistoryGaps: number;
  combined: RewardCoverage;
};

type RewardEnvelope = {
  requestedRange: { fromDate: string; toDate: string };
  effectiveRange: RewardRange;
  academicYear: { id: string; label: string; startsOn: string; endsOn: string };
  cohortBasis: "CURRENT_MEMBERSHIP";
  asOf: string;
  policy: {
    version: typeof REWARD_POLICY_VERSION;
    dailyEffortCap: number;
    dailyOutcomeCap: number;
    dailyScale: number;
    weights: RewardWeights;
  };
  scopeRevision: number;
  scopeToken: string;
  coverageSummary: RewardCoverageSummary;
};

export type RewardQueryResult = RewardEnvelope & {
  items: RewardStudentTotal[];
  totalStudentCount: number;
  nextCursor: string | null;
};

export type RewardTimelineResult = RewardEnvelope & {
  student: RewardStudentTotal;
  days: RewardDay[];
};

export type RewardExportResult = RewardEnvelope & {
  totals: RewardStudentTotal[];
  days: RewardDay[];
  settings: Array<[string, string]>;
};

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function dateDistance(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function daysBetween(from: string, to: string) {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = offsetDay(cursor, 1)) days.push(cursor);
  return days;
}

function atShanghaiStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function atShanghaiEnd(date: string) {
  return atShanghaiStart(offsetDay(date, 1));
}

function localDate(value: Date) {
  const parts = LOCAL_DATE_FORMATTER.formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function maxDate(left: string, right: string) { return left > right ? left : right; }
function minDate(left: string, right: string) { return left < right ? left : right; }

function graphemeCount(value: string) {
  return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value)].length;
}

function parseIdArray(value: unknown, max: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error("QUERY_INVALID");
  const values = value.map((item) => {
    if (typeof item !== "string" || !item || Buffer.byteLength(item, "utf8") > 128) throw new Error("QUERY_INVALID");
    return item;
  });
  if (new Set(values).size !== values.length) throw new Error("QUERY_INVALID");
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function cursorSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for learning reward context");
  return "development-only-learning-reward-context-secret";
}

function signValue(prefix: string, value: string) {
  return createHmac("sha256", cursorSecret()).update(prefix).update(value).digest("base64url");
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function encodeSignedJson(prefix: string, value: object) {
  const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${body}.${signValue(prefix, body)}`;
}

function decodeSignedJson<T>(prefix: string, value: string, maxBytes = MAX_SIGNED_BYTES): T | null {
  if (!value || Buffer.byteLength(value, "utf8") > maxBytes) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const left = Buffer.from(signature);
  const right = Buffer.from(signValue(prefix, body));
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
}

type ScopeTokenPayload = {
  v: typeof SCOPE_TOKEN_VERSION;
  actorId: string;
  role: Role;
  tokenVersion: number;
  credentialRevision: number;
  accessRevision: number | null;
  rosterRevision: number;
  yearId: string;
  yearRevision: number;
  fingerprint: string;
  memberDigest: string;
  asOf: string;
  expiresAt: string;
};

type RewardCursorPayload = {
  v: typeof CURSOR_VERSION;
  fingerprint: string;
  memberDigest: string;
  scopeTokenDigest: string;
  limit: number;
  afterClassLabel: string;
  afterStudentNumber: number | null;
  afterAccountName: string;
  afterStudentId: string;
};

function memberDigest(members: readonly RewardMember[]) {
  return hashValue([...members].map((member) => member.id).sort().join("\n"));
}

function requestFingerprint(request: RewardRequest, range: RewardRange) {
  return hashValue(JSON.stringify({
    fromDate: request.fromDate ?? null,
    toDate: request.toDate ?? null,
    effectiveFrom: range.from,
    effectiveTo: range.to,
    grade: request.grade ?? null,
    classIds: request.classIds ?? null,
    studentIds: request.studentIds ?? null,
    search: request.search ?? null,
    weights: request.weights,
    policyVersion: request.policyVersion,
  }));
}

function readScopeToken(value: string, now = new Date()) {
  const payload = decodeSignedJson<ScopeTokenPayload>("learning-reward-scope-v1:", value);
  if (!payload || payload.v !== SCOPE_TOKEN_VERSION || typeof payload.actorId !== "string" ||
    (payload.role !== "TEACHER" && payload.role !== "ADMIN") || !Number.isInteger(payload.tokenVersion) ||
    !Number.isInteger(payload.credentialRevision) || (payload.accessRevision !== null && !Number.isInteger(payload.accessRevision)) ||
    !Number.isInteger(payload.rosterRevision) || typeof payload.yearId !== "string" || !Number.isInteger(payload.yearRevision) ||
    typeof payload.fingerprint !== "string" || typeof payload.memberDigest !== "string" || typeof payload.asOf !== "string" ||
    typeof payload.expiresAt !== "string") return null;
  const expiresAt = new Date(payload.expiresAt);
  const asOf = new Date(payload.asOf);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now || Number.isNaN(asOf.getTime()) || asOf > now) return null;
  return payload;
}

function createScopeToken(input: {
  actorId: string;
  role: Role;
  actor: RewardActor;
  rosterRevision: number;
  year: RewardYear;
  fingerprint: string;
  memberDigest: string;
  asOf: Date;
}) {
  const expiresAt = new Date(Date.now() + SCOPE_TOKEN_TTL_MS);
  return encodeSignedJson("learning-reward-scope-v1:", {
    v: SCOPE_TOKEN_VERSION,
    actorId: input.actorId,
    role: input.role,
    tokenVersion: input.actor.tokenVersion,
    credentialRevision: input.actor.credentialRevision,
    accessRevision: input.actor.accessRevision,
    rosterRevision: input.rosterRevision,
    yearId: input.year.id,
    yearRevision: input.year.revision,
    fingerprint: input.fingerprint,
    memberDigest: input.memberDigest,
    asOf: input.asOf.toISOString(),
    expiresAt: expiresAt.toISOString(),
  } satisfies ScopeTokenPayload);
}

function createRewardCursor(input: RewardCursorPayload) {
  return encodeSignedJson("learning-reward-cursor-v1:", input);
}

function readRewardCursor(value: string) {
  const payload = decodeSignedJson<RewardCursorPayload>("learning-reward-cursor-v1:", value);
  if (!payload || payload.v !== CURSOR_VERSION || typeof payload.fingerprint !== "string" || typeof payload.memberDigest !== "string" || typeof payload.scopeTokenDigest !== "string" ||
    !Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > MAX_REWARD_LIMIT || typeof payload.afterClassLabel !== "string" ||
    (payload.afterStudentNumber !== null && !Number.isInteger(payload.afterStudentNumber)) || typeof payload.afterAccountName !== "string" || typeof payload.afterStudentId !== "string") return null;
  return payload;
}

function parseDateRange(body: Record<string, unknown>) {
  if (body.range !== undefined && (body.fromDate !== undefined || body.toDate !== undefined)) throw new Error("QUERY_INVALID");
  const rawRange = body.range === undefined ? { fromDate: body.fromDate, toDate: body.toDate } : jsonObject(body.range);
  if (!rawRange || Object.keys(rawRange).some((key) => key !== "fromDate" && key !== "toDate")) throw new Error("QUERY_INVALID");
  if (rawRange.fromDate !== undefined && !validDate(rawRange.fromDate)) throw new Error("QUERY_INVALID");
  if (rawRange.toDate !== undefined && !validDate(rawRange.toDate)) throw new Error("QUERY_INVALID");
  return {
    fromDate: rawRange.fromDate as string | undefined,
    toDate: rawRange.toDate as string | undefined,
  };
}

export async function readRewardRequest(req: Request, options: { route: RewardRoute }): Promise<RewardRequest> {
  const raw = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
  let body: Record<string, unknown>;
  try {
    const parsed = jsonObject(raw ? JSON.parse(raw) : {});
    if (!parsed) throw new Error("QUERY_INVALID");
    body = parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") throw error;
    throw new Error("QUERY_INVALID");
  }

  const commonKeys = new Set(["range", "fromDate", "toDate", "grade", "classIds", "studentIds", "search", "weights", "policyVersion", "asOf", "scopeToken"]);
  const routeKeys = options.route === "QUERY" ? new Set([...commonKeys, "limit", "cursor"]) : options.route === "EXPORT" ? new Set([...commonKeys, "format"]) : commonKeys;
  if (Object.keys(body).some((key) => !routeKeys.has(key))) throw new Error("QUERY_INVALID");
  const range = parseDateRange(body);
  const grade = body.grade === undefined || body.grade === "" ? undefined : body.grade;
  if (grade !== undefined && (typeof grade !== "string" || !STUDENT_GRADES.includes(grade as StudentGrade))) throw new Error("QUERY_INVALID");
  const classIds = parseIdArray(body.classIds, MAX_REWARD_CLASSES);
  const studentIds = parseIdArray(body.studentIds, MAX_REWARD_STUDENTS);
  if (body.search !== undefined && typeof body.search !== "string") throw new Error("QUERY_INVALID");
  const search = typeof body.search === "string" ? body.search.normalize("NFKC").trim().replace(/\s+/gu, " ") : undefined;
  if (search && (graphemeCount(search) > 80 || Buffer.byteLength(search, "utf8") > 1_024)) throw new Error("QUERY_INVALID");
  if (studentIds && search) throw new Error("QUERY_INVALID");
  const rawWeights = body.weights === undefined ? { effort: 50, outcome: 50 } : body.weights;
  if (!isRewardWeights(rawWeights)) throw new Error("QUERY_INVALID");
  const policyVersion = body.policyVersion === undefined ? REWARD_POLICY_VERSION : body.policyVersion;
  if (policyVersion !== REWARD_POLICY_VERSION) throw new Error("QUERY_INVALID");

  let limit: number | undefined;
  if (options.route === "QUERY") {
    limit = body.limit === undefined ? DEFAULT_REWARD_LIMIT : typeof body.limit === "number" ? body.limit : Number.NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REWARD_LIMIT) throw new Error("QUERY_INVALID");
  } else if (body.limit !== undefined || body.cursor !== undefined) {
    throw new Error("QUERY_INVALID");
  }

  let cursor: string | undefined;
  if (options.route === "QUERY" && body.cursor !== undefined) {
    if (typeof body.cursor !== "string" || !body.cursor || Buffer.byteLength(body.cursor, "utf8") > MAX_SIGNED_BYTES) throw new Error("QUERY_INVALID");
    cursor = body.cursor;
  }

  let asOf: Date | undefined;
  if (body.asOf !== undefined) {
    if (typeof body.asOf !== "string") throw new Error("QUERY_INVALID");
    asOf = new Date(body.asOf);
    if (Number.isNaN(asOf.getTime()) || asOf.getTime() > Date.now()) throw new Error("QUERY_INVALID");
  }
  let scopeToken: string | undefined;
  if (body.scopeToken !== undefined) {
    if (typeof body.scopeToken !== "string" || !body.scopeToken || Buffer.byteLength(body.scopeToken, "utf8") > MAX_SIGNED_BYTES) throw new Error("QUERY_INVALID");
    scopeToken = body.scopeToken;
  }
  if (options.route === "QUERY") {
    if (cursor && (!asOf || !scopeToken)) throw new Error("QUERY_INVALID");
    if (!cursor && (asOf || scopeToken)) throw new Error("QUERY_INVALID");
  } else if (!asOf || !scopeToken) {
    throw new Error("QUERY_INVALID");
  }

  let format: RewardRequest["format"];
  if (options.route === "EXPORT") {
    if (body.format !== "CSV" && body.format !== "XLSX") throw new Error("QUERY_INVALID");
    format = body.format;
  } else if (body.format !== undefined) {
    throw new Error("QUERY_INVALID");
  }

  return {
    ...range,
    grade: grade as StudentGrade | undefined,
    classIds,
    studentIds,
    search: search || undefined,
    weights: rawWeights,
    policyVersion,
    limit,
    cursor,
    asOf,
    scopeToken,
    format,
  };
}

async function readCurrentYear(db: Db): Promise<RewardYear> {
  const year = await db.academicYear.findFirst({
    where: { status: "CURRENT" },
    orderBy: [{ startsOn: "desc" }, { id: "asc" }],
    select: { id: true, label: true, startsOn: true, endsOn: true, revision: true, status: true },
  });
  if (!year) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  return year;
}

async function readRosterRevision(db: Db) {
  const state = await db.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  if (!state) throw new Error("ROSTER_MUTATION_STATE_MISSING");
  return state.revision;
}

async function readRewardActor(db: Db, input: { userId: string; role: Role }): Promise<RewardActor> {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { role: true, status: true, tokenVersion: true, credentialRevision: true, teacherProfile: { select: { accessRevision: true } } } });
  if (!user || user.role !== input.role) throw new Error("ROLE_FORBIDDEN");
  if (user.status !== "ACTIVE") throw new Error("AUTH_REQUIRED");
  return { role: user.role, status: user.status, tokenVersion: user.tokenVersion, credentialRevision: user.credentialRevision, accessRevision: user.teacherProfile?.accessRevision ?? null };
}

async function readRewardClasses(db: Db, input: { userId: string; role: Role; yearId: string; grade?: StudentGrade; classIds?: string[] }): Promise<RewardClass[]> {
  const rows = await db.schoolClass.findMany({
    where: {
      academicYearId: input.yearId,
      active: true,
      ...(input.grade ? { grade: input.grade } : {}),
      ...(input.classIds ? { id: { in: input.classIds } } : {}),
      ...(input.role === "TEACHER" ? { teacherAccess: { some: { teacherId: input.userId, canViewProgress: true } } } : {}),
    },
    orderBy: [{ grade: "asc" }, { classCode: "asc" }, { id: "asc" }],
    take: input.classIds ? input.classIds.length : MAX_REWARD_CLASSES + 1,
    select: { id: true, grade: true, classCode: true, revision: true },
  });
  if (!input.classIds && rows.length > MAX_REWARD_CLASSES) throw new Error("REWARD_SCOPE_TOO_LARGE");
  if (input.classIds && rows.length !== input.classIds.length) throw new Error("CLASS_NOT_FOUND");
  return rows;
}

function enrollmentWhere(input: { userId: string; role: Role; yearId: string; grade?: StudentGrade; classIds?: string[] }): Prisma.StudentEnrollmentWhereInput {
  const activeClass: Prisma.SchoolClassWhereInput = {
    academicYearId: input.yearId,
    active: true,
    ...(input.role === "TEACHER" ? { teacherAccess: { some: { teacherId: input.userId, canViewProgress: true } } } : {}),
  };
  const membership = input.classIds
    ? { classId: { in: input.classIds } }
    : input.role === "ADMIN"
      ? { OR: [{ classId: null }, { schoolClass: { is: activeClass } }] }
      : { schoolClass: { is: activeClass } };
  return { academicYearId: input.yearId, status: "ACTIVE", ...(input.grade ? { grade: input.grade } : {}), ...membership };
}

export async function readRewardMembers(db: Pick<Db, "user">, input: { userId: string; role: Role; yearId: string; grade?: StudentGrade; classIds?: string[]; studentIds?: string[]; search?: string }): Promise<RewardMember[]> {
  const enrollmentScope = enrollmentWhere(input);
  const search = input.search ? input.search.normalize("NFKC").trim() : undefined;
  const studentNumber = parseStudentNumber(search);
  const accountSearch = search ? normalizeAccountName(search) : undefined;
  const legalSearch = search ? normalizeLegalName(search) : undefined;
  const rows = await db.user.findMany({
    where: {
      role: "STUDENT",
      status: "ACTIVE",
      ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
      ...(search ? {
        OR: [
          ...(studentNumber === null ? [] : [{ studentProfile: { is: { enrollments: { some: { ...enrollmentScope, studentNumber } } } } }]),
          { accountName: { contains: accountSearch, mode: "insensitive" } },
          { accountNameCanonical: { contains: accountSearch, mode: "insensitive" } },
          { studentProfile: { is: { legalName: { contains: legalSearch, mode: "insensitive" } } } },
          { studentProfile: { is: { nickname: { contains: search, mode: "insensitive" } } } },
        ],
      } : {}),
      studentProfile: { is: { enrollments: { some: enrollmentScope } } },
    },
    orderBy: [{ accountNameCanonical: "asc" }, { accountName: "asc" }, { id: "asc" }],
    take: MAX_REWARD_STUDENTS + 1,
    select: {
      id: true,
      accountName: true,
      studentProfile: {
        select: {
          legalName: true,
          nickname: true,
          enrollments: {
            where: enrollmentScope,
            take: 1,
            orderBy: { id: "asc" },
            select: { grade: true, classId: true, studentNumber: true, startedAt: true, schoolClass: { select: { classCode: true } } },
          },
        },
      },
    },
  });
  if (rows.length > MAX_REWARD_STUDENTS) throw new Error("REWARD_SCOPE_TOO_LARGE");
  const members = rows.flatMap((row) => {
    const enrollment = row.studentProfile?.enrollments[0];
    if (!enrollment) return [];
    return [{ id: row.id, accountName: row.accountName, studentNumber: enrollment.studentNumber ?? null, legalName: row.studentProfile?.legalName ?? "", nickname: row.studentProfile?.nickname ?? "", grade: enrollment.grade, classId: enrollment.classId, classCode: enrollment.schoolClass?.classCode ?? null, startedAt: enrollment.startedAt } satisfies RewardMember];
  });
  return members.sort((left, right) => {
    const classLeft = `${left.grade}:${left.classCode ?? "ZZ"}`;
    const classRight = `${right.grade}:${right.classCode ?? "ZZ"}`;
    return classLeft.localeCompare(classRight) || compareStudentNumberSortKey({ studentNumber: left.studentNumber, accountName: normalizeAccountName(left.accountName), id: left.id }, { studentNumber: right.studentNumber, accountName: normalizeAccountName(right.accountName), id: right.id });
  });
}

async function resolveRewardRange(db: Db, request: RewardRequest) {
  const year = await readCurrentYear(db);
  const today = todayKey();
  const yearFrom = localDate(year.startsOn);
  const yearTo = localDate(year.endsOn);
  if (today < yearFrom) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  const requestedFrom = request.fromDate ?? yearFrom;
  const requestedTo = request.toDate ?? today;
  if (!validDate(requestedFrom) || !validDate(requestedTo) || requestedFrom > requestedTo || requestedTo > today || dateDistance(requestedFrom, requestedTo) + 1 > MAX_REWARD_DAYS) throw new Error("QUERY_INVALID");
  const from = maxDate(requestedFrom, yearFrom);
  const to = minDate(minDate(requestedTo, yearTo), today);
  if (from > to) throw new Error("RANGE_OUTSIDE_CURRENT_YEAR");
  return {
    year,
    range: { requestedFrom, requestedTo, from, to, rangeClamped: from !== requestedFrom || to !== requestedTo, timezone: REWARD_TIMEZONE, ...(today > yearTo ? { calendarWarning: "CURRENT_YEAR_ENDED_NOT_ACTIVATED" as const } : {}) } satisfies RewardRange,
  };
}

type RewardSnapshot = {
  year: RewardYear;
  range: RewardRange;
  scopeRevision: number;
  classes: RewardClass[];
  members: RewardMember[];
  asOf: Date;
  actor: RewardActor;
  fingerprint: string;
  memberDigest: string;
  scopeToken: string;
};

async function verifyScopeToken(input: { request: RewardRequest; actor: RewardActor; actorId: string; year: RewardYear; range: RewardRange; scopeRevision: number; members: RewardMember[]; asOf: Date }) {
  const fingerprint = requestFingerprint(input.request, input.range);
  const digest = memberDigest(input.members);
  if (input.request.scopeToken) {
    const token = readScopeToken(input.request.scopeToken);
    if (!token || token.actorId !== input.actorId || token.role !== input.actor.role || token.fingerprint !== fingerprint || token.memberDigest !== digest || token.yearId !== input.year.id || token.yearRevision !== input.year.revision || token.rosterRevision !== input.scopeRevision || token.tokenVersion !== input.actor.tokenVersion || token.credentialRevision !== input.actor.credentialRevision || token.accessRevision !== input.actor.accessRevision || token.asOf !== input.asOf.toISOString()) throw new Error("REWARD_SCOPE_STALE");
    return { fingerprint, memberDigest: digest, scopeToken: input.request.scopeToken };
  }
  return {
    fingerprint,
    memberDigest: digest,
    scopeToken: createScopeToken({ actorId: input.actorId, role: input.actor.role, actor: input.actor, rosterRevision: input.scopeRevision, year: input.year, fingerprint, memberDigest: digest, asOf: input.asOf }),
  };
}

async function withRewardSnapshot<T>(input: { userId: string; role: Role; request: RewardRequest }, callback: (db: Prisma.TransactionClient, snapshot: RewardSnapshot) => Promise<T>) {
  const result = await prisma.$transaction(async (tx) => {
    const actor = await readRewardActor(tx, input);
    const { year, range } = await resolveRewardRange(tx, input.request);
    const scopeRevision = await readRosterRevision(tx);
    const classes = await readRewardClasses(tx, { userId: input.userId, role: input.role, yearId: year.id, grade: input.request.grade, classIds: input.request.classIds });
    const members = await readRewardMembers(tx, { userId: input.userId, role: input.role, yearId: year.id, grade: input.request.grade, classIds: input.request.classIds, studentIds: input.request.studentIds, search: input.request.search });
    if (input.request.studentIds && members.length !== input.request.studentIds.length) throw new Error("STUDENT_NOT_FOUND");
    const asOf = input.request.asOf ?? new Date();
    const context = await verifyScopeToken({ request: input.request, actor, actorId: input.userId, year, range, scopeRevision, members, asOf });
    const snapshot = { year, range, scopeRevision, classes, members, asOf, actor, ...context } satisfies RewardSnapshot;
    return { value: await callback(tx, snapshot), snapshot };
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 });
  await recheckRewardSnapshot({ userId: input.userId, role: input.role, snapshot: result.snapshot });
  return result.value;
}

async function recheckRewardSnapshot(input: { userId: string; role: Role; snapshot: RewardSnapshot }) {
  const [actor, rosterRevision, year] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { role: true, status: true, tokenVersion: true, credentialRevision: true, teacherProfile: { select: { accessRevision: true } } } }),
    readRosterRevision(prisma),
    prisma.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: [{ startsOn: "desc" }, { id: "asc" }], select: { id: true, revision: true, status: true } }),
  ]);
  if (!actor || actor.role !== input.role || actor.status !== "ACTIVE") throw new Error("ROLE_FORBIDDEN");
  if (actor.tokenVersion !== input.snapshot.actor.tokenVersion || actor.credentialRevision !== input.snapshot.actor.credentialRevision) throw new Error("AUTH_REQUIRED");
  if (input.role === "TEACHER" && actor.teacherProfile?.accessRevision !== input.snapshot.actor.accessRevision) throw new Error("REWARD_SCOPE_STALE");
  if (rosterRevision !== input.snapshot.scopeRevision) throw new Error("REWARD_SCOPE_STALE");
  if (!year || year.id !== input.snapshot.year.id || year.revision !== input.snapshot.year.revision || year.status !== "CURRENT") throw new Error("REWARD_SCOPE_STALE");
}

/**
 * Recheck the short-lived scope immediately before a serialized response is
 * delivered. The transaction-level check protects the read; this second
 * check protects the response boundary from a concurrent credential, access,
 * roster, or academic-year mutation.
 */
export async function recheckRewardAccess(input: { userId: string; role: Role; scopeToken: string; scopeRevision: number; academicYearId: string }) {
  const token = readScopeToken(input.scopeToken);
  if (!token || token.actorId !== input.userId || token.role !== input.role || token.rosterRevision !== input.scopeRevision || token.yearId !== input.academicYearId) throw new Error("REWARD_SCOPE_STALE");
  const actor = await readRewardActor(prisma, { userId: input.userId, role: input.role });
  const [rosterRevision, year] = await Promise.all([readRosterRevision(prisma), readCurrentYear(prisma)]);
  if (rosterRevision !== token.rosterRevision || year.id !== token.yearId || year.revision !== token.yearRevision || actor.tokenVersion !== token.tokenVersion || actor.credentialRevision !== token.credentialRevision || actor.accessRevision !== token.accessRevision) throw new Error("REWARD_SCOPE_STALE");
}

const reviewEventSelect = {
  id: true,
  operationId: true,
  userId: true,
  submittedWordId: true,
  wordId: true,
  senseId: true,
  submittedSenseId: true,
  contentRevisionId: true,
  catalogRevisionId: true,
  wordLevel: true,
  eventKind: true,
  quality: true,
  isHistorical: true,
  evidenceKind: true,
  flowVersion: true,
  qualityPolicyVersion: true,
  probePurpose: true,
  itemConstructionVersion: true,
  objectiveEvidenceTargetId: true,
  objectiveQuestionSnapshotId: true,
  createdAt: true,
  objectiveEvidenceTarget: {
    select: {
      id: true,
      userId: true,
      wordId: true,
      senseId: true,
      purpose: true,
      policyVersion: true,
      itemConstructionVersion: true,
      status: true,
      winningOperationId: true,
      winningReviewEventId: true,
      obligationId: true,
      obligation: { select: { id: true, userId: true, wordId: true, senseId: true, kind: true, policyVersion: true, status: true } },
      questionSnapshot: { select: { id: true, targetId: true, wordId: true, senseId: true, contentRevisionId: true, catalogRevisionId: true, contentVersion: true, itemConstructionVersion: true } },
    },
  },
} as const;

export type RewardReviewEvent = GeneratedPrisma.ReviewEventGetPayload<{ select: typeof reviewEventSelect }>;

const encounterSelect = {
  id: true,
  userId: true,
  wordId: true,
  senseId: true,
  streamItemId: true,
  operationId: true,
  selfRating: true,
  policyVersion: true,
  acknowledgedAt: true,
  streamItem: {
    select: {
      id: true,
      wordId: true,
      senseId: true,
      itemKind: true,
      status: true,
      revealedAt: true,
      usedAt: true,
      feedbackAcknowledgedAt: true,
      operationId: true,
      policyVersion: true,
      session: { select: { userId: true, flowVersion: true } },
    },
  },
} as const;

type RewardEncounter = GeneratedPrisma.StudyEncounterGetPayload<{ select: typeof encounterSelect }>;

export type RewardLoadedActivity = {
  reviewEvents: RewardReviewEvent[];
  encounters: RewardEncounter[];
  studyDays: Array<{ userId: string; date: string; createdAt: Date }>;
};

async function loadRewardActivity(db: Db, snapshot: RewardSnapshot): Promise<RewardLoadedActivity> {
  if (!snapshot.members.length) return { reviewEvents: [], encounters: [], studyDays: [] };
  const memberIds = snapshot.members.map((member) => member.id);
  const from = atShanghaiStart(snapshot.range.from);
  const to = atShanghaiEnd(snapshot.range.to);
  const reviewEvents = await db.reviewEvent.findMany({ where: { userId: { in: memberIds }, createdAt: { gte: from, lt: to, lte: snapshot.asOf } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_REWARD_ACTIVITY_ROWS + 1, select: reviewEventSelect });
  if (reviewEvents.length > MAX_REWARD_ACTIVITY_ROWS) throw new Error("REWARD_SCOPE_TOO_LARGE");
  const encounters = await db.studyEncounter.findMany({ where: { userId: { in: memberIds }, acknowledgedAt: { gte: from, lt: to, lte: snapshot.asOf } }, orderBy: [{ acknowledgedAt: "asc" }, { id: "asc" }], take: MAX_REWARD_ACTIVITY_ROWS + 1, select: encounterSelect });
  if (encounters.length > MAX_REWARD_ACTIVITY_ROWS) throw new Error("REWARD_SCOPE_TOO_LARGE");
  const studyDays = await db.studyDay.findMany({ where: { userId: { in: memberIds }, date: { gte: snapshot.range.from, lte: snapshot.range.to }, createdAt: { lte: snapshot.asOf } }, orderBy: [{ date: "asc" }, { id: "asc" }], take: MAX_REWARD_ACTIVITY_ROWS + 1, select: { userId: true, date: true, createdAt: true } });
  if (studyDays.length > MAX_REWARD_ACTIVITY_ROWS) throw new Error("REWARD_SCOPE_TOO_LARGE");
  return { reviewEvents, encounters, studyDays };
}

type GroupedRewardActivity = {
  reviewsByUser: Map<string, RewardReviewEvent[]>;
  encountersByUser: Map<string, RewardEncounter[]>;
  studyDaysByUser: Map<string, Array<{ userId: string; date: string; createdAt: Date }>>;
};

function groupRewardActivity(activity: RewardLoadedActivity): GroupedRewardActivity {
  const reviewsByUser = new Map<string, RewardReviewEvent[]>();
  const encountersByUser = new Map<string, RewardEncounter[]>();
  const studyDaysByUser = new Map<string, Array<{ userId: string; date: string; createdAt: Date }>>();
  const add = <T extends { userId: string }>(groups: Map<string, T[]>, value: T) => {
    const bucket = groups.get(value.userId);
    if (bucket) bucket.push(value); else groups.set(value.userId, [value]);
  };
  for (const event of activity.reviewEvents) add(reviewsByUser, event);
  for (const encounter of activity.encounters) add(encountersByUser, encounter);
  for (const studyDay of activity.studyDays) add(studyDaysByUser, studyDay);
  return { reviewsByUser, encountersByUser, studyDaysByUser };
}

function buildRewardReport(member: RewardMember, grouped: GroupedRewardActivity, range: RewardRange, weights: RewardWeights) {
  return buildStudentReward({
    member,
    activity: {
      reviewEvents: grouped.reviewsByUser.get(member.id) ?? [],
      encounters: grouped.encountersByUser.get(member.id) ?? [],
      studyDays: grouped.studyDaysByUser.get(member.id) ?? [],
    },
    range,
    weights,
  });
}

function emptySourceCounts(): RewardSourceCounts {
  return { candidateCount: 0, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 0 };
}

function emptyCoverage(): RewardCoverage {
  return {
    sources: { encounters: emptySourceCounts(), reviews: emptySourceCounts() },
    validationGapCount: 0,
    policyExcludedCount: 0,
    validationStatus: "CHECKED",
    historyCoverage: "NOT_GUARANTEED",
    studyDayMismatchCount: 0,
    warningCodes: [],
  };
}

function addSourceBucket(coverage: RewardCoverage, source: "encounters" | "reviews", bucket: SourceBucket) {
  const counts = coverage.sources[source];
  counts.candidateCount += 1;
  counts[bucket] += 1;
}

function finalizeCoverage(coverage: RewardCoverage): RewardCoverage {
  const sources = [coverage.sources.encounters, coverage.sources.reviews];
  coverage.policyExcludedCount = sources.reduce((sum, source) => sum + source.policyExcluded, 0);
  coverage.validationGapCount = sources.reduce((sum, source) => sum + source.unsupportedVersion + source.missingIdentityOrProvenance + source.nonWinningOrInvalidOutcome, 0);
  coverage.validationStatus = coverage.validationGapCount > 0 ? "INCOMPLETE" : "CHECKED";
  const warnings = new Set(coverage.warningCodes);
  if (coverage.policyExcludedCount > 0) warnings.add("POLICY_EXCLUSIONS_PRESENT");
  if (coverage.validationGapCount > 0) warnings.add("VALIDATION_GAP_PRESENT");
  if (coverage.historyCoverage === "KNOWN_GAP") warnings.add("HISTORY_GAP_PRESENT");
  if (coverage.studyDayMismatchCount > 0) warnings.add("STUDY_DAY_MISMATCH");
  coverage.warningCodes = [...warnings].sort();
  return coverage;
}

function mergeSourceCounts(left: RewardSourceCounts, right: RewardSourceCounts): RewardSourceCounts {
  return {
    candidateCount: left.candidateCount + right.candidateCount,
    outsideEligibility: left.outsideEligibility + right.outsideEligibility,
    policyExcluded: left.policyExcluded + right.policyExcluded,
    unsupportedVersion: left.unsupportedVersion + right.unsupportedVersion,
    missingIdentityOrProvenance: left.missingIdentityOrProvenance + right.missingIdentityOrProvenance,
    nonWinningOrInvalidOutcome: left.nonWinningOrInvalidOutcome + right.nonWinningOrInvalidOutcome,
    included: left.included + right.included,
  };
}

function mergeCoverage(left: RewardCoverage, right: RewardCoverage): RewardCoverage {
  const merged: RewardCoverage = {
    sources: {
      encounters: mergeSourceCounts(left.sources.encounters, right.sources.encounters),
      reviews: mergeSourceCounts(left.sources.reviews, right.sources.reviews),
    },
    validationGapCount: 0,
    policyExcludedCount: 0,
    validationStatus: "CHECKED",
    historyCoverage: left.historyCoverage === "KNOWN_GAP" || right.historyCoverage === "KNOWN_GAP" ? "KNOWN_GAP" : "NOT_GUARANTEED",
    studyDayMismatchCount: left.studyDayMismatchCount + right.studyDayMismatchCount,
    warningCodes: [...left.warningCodes, ...right.warningCodes],
  };
  return finalizeCoverage(merged);
}

function emptyLevelCounts(): RewardLevelCounts {
  return { A1: { attempts: 0, correct: 0 }, A2: { attempts: 0, correct: 0 }, B1: { attempts: 0, correct: 0 }, B2: { attempts: 0, correct: 0 } };
}

function addLevelCount(target: RewardLevelCounts, level: Level, correct: boolean) {
  target[level].attempts += 1;
  if (correct) target[level].correct += 1;
}

function addLevelCounts(target: RewardLevelCounts, source: RewardLevelCounts) {
  for (const level of ["A1", "A2", "B1", "B2"] as const) {
    target[level].attempts += source[level].attempts;
    target[level].correct += source[level].correct;
  }
}

function classifyRewardReviewEvent(event: RewardReviewEvent): SourceBucket {
  if (event.isHistorical || event.eventKind !== "REVIEW" || event.probePurpose === "RESEARCH_DIAGNOSTIC" || event.probePurpose === "OPERATIONAL_DIAGNOSTIC") return "policyExcluded";
  if (event.flowVersion === null || event.qualityPolicyVersion === null || event.itemConstructionVersion === null || event.objectiveEvidenceTargetId === null || event.objectiveQuestionSnapshotId === null) return "missingIdentityOrProvenance";
  if (event.flowVersion !== REWARD_SUPPORTED_FLOW_VERSION || event.qualityPolicyVersion !== REWARD_SUPPORTED_QUALITY_POLICY_VERSION || event.itemConstructionVersion !== REWARD_SUPPORTED_CONSTRUCTION_VERSION) return "unsupportedVersion";
  const target = event.objectiveEvidenceTarget;
  const snapshot = target?.questionSnapshot;
  if (event.evidenceKind !== "OBJECTIVE_PROBE" || !target || !snapshot) return "missingIdentityOrProvenance";
  if (
    !event.submittedSenseId || !event.senseId || !target.senseId || !snapshot.senseId ||
    event.submittedSenseId !== event.senseId || event.senseId !== target.senseId || target.senseId !== snapshot.senseId ||
    !event.submittedWordId || !event.wordId || !target.wordId || !snapshot.wordId ||
    event.submittedWordId !== event.wordId || event.wordId !== target.wordId || target.wordId !== snapshot.wordId ||
    !event.userId || target.userId !== event.userId ||
    !event.contentRevisionId || !event.catalogRevisionId || snapshot.contentRevisionId !== event.contentRevisionId || snapshot.catalogRevisionId !== event.catalogRevisionId ||
    target.id !== event.objectiveEvidenceTargetId || snapshot.id !== event.objectiveQuestionSnapshotId || snapshot.targetId !== target.id ||
    target.purpose !== event.probePurpose || target.policyVersion !== REWARD_SUPPORTED_POLICY_VERSION || target.itemConstructionVersion !== REWARD_SUPPORTED_CONSTRUCTION_VERSION ||
    snapshot.contentVersion !== REWARD_SUPPORTED_CONSTRUCTION_VERSION || snapshot.itemConstructionVersion !== REWARD_SUPPORTED_CONSTRUCTION_VERSION
  ) return "missingIdentityOrProvenance";
  if (target.status !== "CONSUMED" || target.winningOperationId !== event.operationId || target.winningReviewEventId !== event.id) return "nonWinningOrInvalidOutcome";
  if (event.probePurpose === "DUE_REVIEW") {
    if (target.obligationId !== null || target.obligation !== null) return "missingIdentityOrProvenance";
  } else if (event.probePurpose === "EVIDENCE_OBLIGATION") {
    const obligation = target.obligation;
    if (!target.obligationId || !obligation || obligation.id !== target.obligationId || obligation.userId !== event.userId || obligation.wordId !== event.wordId || obligation.senseId !== event.senseId || obligation.kind !== "EVIDENCE_OBLIGATION" || obligation.policyVersion !== REWARD_SUPPORTED_POLICY_VERSION || obligation.status !== "ANSWERED") return "missingIdentityOrProvenance";
  } else {
    return "unsupportedVersion";
  }
  if (event.quality !== 2 && event.quality !== 4) return "nonWinningOrInvalidOutcome";
  return "included";
}

function classifyRewardEncounter(encounter: RewardEncounter): SourceBucket {
  const item = encounter.streamItem;
  if (!item) return "missingIdentityOrProvenance";
  if (item.itemKind !== "LEARNING_CARD") return "policyExcluded";
  if (item.session?.flowVersion === null || item.policyVersion === null || encounter.policyVersion === null) return "missingIdentityOrProvenance";
  if (item.session?.flowVersion !== REWARD_SUPPORTED_FLOW_VERSION || item.policyVersion !== REWARD_SUPPORTED_POLICY_VERSION || encounter.policyVersion !== REWARD_SUPPORTED_POLICY_VERSION) return "unsupportedVersion";
  if (
    !encounter.wordId || !encounter.senseId || !item.wordId || !item.senseId ||
    encounter.wordId !== item.wordId || encounter.senseId !== item.senseId || encounter.streamItemId !== item.id ||
    item.session?.userId !== encounter.userId || item.operationId !== encounter.operationId ||
    item.status !== "ACKNOWLEDGED" || item.revealedAt === null || item.usedAt === null || item.feedbackAcknowledgedAt === null ||
    item.usedAt.getTime() !== encounter.acknowledgedAt.getTime() || item.feedbackAcknowledgedAt.getTime() !== encounter.acknowledgedAt.getTime() ||
    item.revealedAt.getTime() > encounter.acknowledgedAt.getTime() ||
    encounter.selfRating !== "selfForgot" && encounter.selfRating !== "selfRecalled"
  ) return "nonWinningOrInvalidOutcome";
  return "included";
}

type MutableDay = {
  learningCardCount: number;
  objectiveAttemptCount: number;
  objectiveCorrectCount: number;
  firstCorrectSenseCount: number;
  senseIds: Set<string>;
  levelCounts: RewardLevelCounts;
  coverage: RewardCoverage;
  candidatePresent: boolean;
  active: boolean;
};

function newMutableDay(): MutableDay {
  return { learningCardCount: 0, objectiveAttemptCount: 0, objectiveCorrectCount: 0, firstCorrectSenseCount: 0, senseIds: new Set(), levelCounts: emptyLevelCounts(), coverage: emptyCoverage(), candidatePresent: false, active: false };
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function coverageForDays(coverageByDate: Map<string, RewardCoverage>, date: string) {
  return finalizeCoverage(coverageByDate.get(date) ?? emptyCoverage());
}

export function buildStudentReward(input: { member: RewardMember; activity: RewardLoadedActivity; range: RewardRange; weights: RewardWeights }): { total: RewardStudentTotal; days: RewardDay[] } {
  const { member, activity, range, weights } = input;
  const eligibleFrom = maxDate(range.from, member.startedAt ? localDate(member.startedAt) : range.from);
  const dates = daysBetween(range.from, range.to);
  const mutable = new Map(dates.map((date) => [date, newMutableDay()]));
  const coverageByDate = new Map(dates.map((date) => [date, emptyCoverage()]));
  const periodSenseIds = new Set<string>();
  const candidateDates = new Set<string>();
  const firstResultBySenseDay = new Set<string>();
  const seenEncounterIds = new Set<string>();
  const seenTargetIds = new Set<string>();
  // loadRewardActivity already orders both collections by their reducer keys;
  // grouping preserves that order, so do not re-sort once per student.
  const memberReviewEvents = activity.reviewEvents.filter((event) => event.userId === member.id);
  const memberEncounters = activity.encounters.filter((encounter) => encounter.userId === member.id);
  const memberStudyDays = activity.studyDays.filter((row) => row.userId === member.id);

  const record = (source: "encounters" | "reviews", date: string, bucket: SourceBucket) => {
    const coverage = coverageByDate.get(date);
    if (!coverage) return;
    addSourceBucket(coverage, source, bucket);
    const day = mutable.get(date);
    if (day) {
      day.candidatePresent = true;
    }
  };

  for (const encounter of memberEncounters) {
    const date = localDate(encounter.acknowledgedAt);
    candidateDates.add(date);
    const eligible = date >= eligibleFrom;
    const bucket = classifyRewardEncounter(encounter);
    record("encounters", date, eligible ? bucket : "outsideEligibility");
    if (!eligible || bucket !== "included" || seenEncounterIds.has(encounter.id)) continue;
    seenEncounterIds.add(encounter.id);
    const day = mutable.get(date);
    if (!day || !encounter.senseId) continue;
    day.learningCardCount += 1;
    day.senseIds.add(encounter.senseId);
    day.active = true;
    periodSenseIds.add(encounter.senseId);
  }

  for (const event of memberReviewEvents) {
    const date = localDate(event.createdAt);
    candidateDates.add(date);
    const eligible = date >= eligibleFrom;
    const bucket = classifyRewardReviewEvent(event);
    record("reviews", date, eligible ? bucket : "outsideEligibility");
    if (!eligible || bucket !== "included" || seenTargetIds.has(event.objectiveEvidenceTargetId ?? "")) continue;
    const targetId = event.objectiveEvidenceTargetId;
    if (!targetId || !event.senseId) continue;
    seenTargetIds.add(targetId);
    const day = mutable.get(date);
    if (!day) continue;
    day.objectiveAttemptCount += 1;
    day.objectiveCorrectCount += event.quality === 4 ? 1 : 0;
    day.senseIds.add(event.senseId);
    day.active = true;
    periodSenseIds.add(event.senseId);
    addLevelCount(day.levelCounts, event.wordLevel, event.quality === 4);
    const senseDayKey = `${date}:${event.senseId}`;
    if (!firstResultBySenseDay.has(senseDayKey)) {
      firstResultBySenseDay.add(senseDayKey);
      if (event.quality === 4) day.firstCorrectSenseCount += 1;
    }
  }

  const mismatchDates = new Set<string>();
  for (const studyDay of memberStudyDays) {
    if (studyDay.date < range.from || studyDay.date > range.to || studyDay.date < eligibleFrom) continue;
    if (!candidateDates.has(studyDay.date)) mismatchDates.add(studyDay.date);
  }
  for (const date of mismatchDates) {
    const coverage = coverageByDate.get(date);
    if (coverage) {
      coverage.historyCoverage = "KNOWN_GAP";
      coverage.studyDayMismatchCount += 1;
      coverage.warningCodes.push("STUDY_DAY_MISMATCH");
    }
    const day = mutable.get(date);
    if (day) {
      day.candidatePresent = false;
    }
  }

  const days: RewardDay[] = [];
  let cumulative = emptyRewardScores();
  for (const date of dates) {
    const day = mutable.get(date)!;
    const coverage = coverageForDays(coverageByDate, date);
    if (member.startedAt === null) {
      coverage.warningCodes = [...new Set([...coverage.warningCodes, "ENROLLMENT_STARTED_AT_MISSING"])].sort();
    }
    if (date < eligibleFrom) {
      days.push({ studentId: member.id, date, eligible: false, learningCardCount: null, objectiveAttemptCount: null, objectiveCorrectCount: null, effortActivityCount: null, creditedEffortActivityCount: null, firstCorrectSenseCount: null, creditedFirstCorrectSenseCount: null, distinctSenseCount: null, levelCounts: null, objectiveAccuracyPercent: null, accuracyStatus: "NO_DATA", effortCapReached: null, outcomeCapReached: null, scores: null, cumulative: null, coverage });
      continue;
    }
    const effortActivityCount = day.learningCardCount + day.objectiveAttemptCount;
    const scores = calculateRewardScores({ effortActivityCount, firstCorrectSenseCount: day.firstCorrectSenseCount, weights });
    cumulative = addRewardScores(cumulative, scores);
    days.push({
      studentId: member.id,
      date,
      eligible: true,
      learningCardCount: day.learningCardCount,
      objectiveAttemptCount: day.objectiveAttemptCount,
      objectiveCorrectCount: day.objectiveCorrectCount,
      effortActivityCount,
      creditedEffortActivityCount: Math.min(effortActivityCount, REWARD_DAILY_EFFORT_CAP),
      firstCorrectSenseCount: day.firstCorrectSenseCount,
      creditedFirstCorrectSenseCount: Math.min(day.firstCorrectSenseCount, REWARD_DAILY_OUTCOME_CAP),
      distinctSenseCount: day.senseIds.size,
      levelCounts: day.levelCounts,
      objectiveAccuracyPercent: rewardAccuracyPercent(day.objectiveCorrectCount, day.objectiveAttemptCount),
      accuracyStatus: rewardAccuracyStatus(day.objectiveAttemptCount),
      effortCapReached: effortActivityCount >= REWARD_DAILY_EFFORT_CAP,
      outcomeCapReached: day.firstCorrectSenseCount >= REWARD_DAILY_OUTCOME_CAP,
      scores,
      cumulative,
      coverage,
    });
  }

  const eligibleDays = days.filter((day) => day.eligible);
  const eligibleDayCount = eligibleDays.length;
  const score = eligibleDayCount === 0 ? null : eligibleDays.reduce((sum, day) => addRewardScores(sum, day.scores!), emptyRewardScores());
  const levelCounts = emptyLevelCounts();
  for (const day of eligibleDays) addLevelCounts(levelCounts, day.levelCounts!);
  const learningCardCount = eligibleDays.reduce((sum, day) => sum + day.learningCardCount!, 0);
  const objectiveAttemptCount = eligibleDays.reduce((sum, day) => sum + day.objectiveAttemptCount!, 0);
  const objectiveCorrectCount = eligibleDays.reduce((sum, day) => sum + day.objectiveCorrectCount!, 0);
  const effortActivityCount = eligibleDays.reduce((sum, day) => sum + day.effortActivityCount!, 0);
  const creditedEffortActivityCount = eligibleDays.reduce((sum, day) => sum + day.creditedEffortActivityCount!, 0);
  const firstCorrectSenseDayCount = eligibleDays.reduce((sum, day) => sum + day.firstCorrectSenseCount!, 0);
  const creditedFirstCorrectSenseDayCount = eligibleDays.reduce((sum, day) => sum + day.creditedFirstCorrectSenseCount!, 0);
  const coverage = finalizeCoverage(days.reduce((sum, day) => mergeCoverage(sum, day.coverage), emptyCoverage()));
  const effortCapDays = eligibleDays.filter((day) => day.effortCapReached).length;
  const outcomeCapDays = eligibleDays.filter((day) => day.outcomeCapReached).length;
  const total: RewardStudentTotal = {
    studentId: member.id,
    studentNumber: member.studentNumber,
    accountName: member.accountName,
    legalName: member.legalName,
    nickname: member.nickname,
    grade: member.grade,
    classId: member.classId,
    classLabel: `${GRADE_LABELS[member.grade]}${member.classCode ? CLASS_LABELS[member.classCode] : "未分班"}`,
    eligibleFrom,
    eligibleDayCount,
    activeDayCount: eligibleDays.filter((day) => day.effortActivityCount! > 0).length,
    learningCardCount,
    objectiveAttemptCount,
    objectiveCorrectCount,
    effortActivityCount,
    creditedEffortActivityCount,
    firstCorrectSenseDayCount,
    creditedFirstCorrectSenseDayCount,
    distinctSenseCount: periodSenseIds.size,
    levelCounts,
    objectiveAccuracyPercent: rewardAccuracyPercent(objectiveCorrectCount, objectiveAttemptCount),
    accuracyStatus: rewardAccuracyStatus(objectiveAttemptCount),
    effortCapDays,
    outcomeCapDays,
    effortCapDayPercent: eligibleDayCount ? roundPercent(effortCapDays / eligibleDayCount * 100) : null,
    outcomeCapDayPercent: eligibleDayCount ? roundPercent(outcomeCapDays / eligibleDayCount * 100) : null,
    scores: score,
    coverage,
  };
  return { total, days };
}

function sortRewardTotals(left: RewardStudentTotal, right: RewardStudentTotal) {
  return left.classLabel.localeCompare(right.classLabel, "zh-Hant") || compareStudentNumberSortKey({ studentNumber: left.studentNumber, accountName: normalizeAccountName(left.accountName), id: left.studentId }, { studentNumber: right.studentNumber, accountName: normalizeAccountName(right.accountName), id: right.studentId });
}

function buildCoverageSummary(totals: RewardStudentTotal[]): RewardCoverageSummary {
  const combined = finalizeCoverage(totals.reduce((sum, total) => mergeCoverage(sum, total.coverage), emptyCoverage()));
  return {
    basis: "WHOLE_REPORT",
    studentCount: totals.length,
    studentsWithValidationGaps: totals.filter((total) => total.coverage.validationGapCount > 0).length,
    studentsWithPolicyExclusions: totals.filter((total) => total.coverage.policyExcludedCount > 0).length,
    studentsWithKnownHistoryGaps: totals.filter((total) => total.coverage.historyCoverage === "KNOWN_GAP").length,
    combined,
  };
}

function envelope(snapshot: RewardSnapshot, coverageSummary: RewardCoverageSummary, weights: RewardWeights): RewardEnvelope {
  return {
    requestedRange: { fromDate: snapshot.range.requestedFrom, toDate: snapshot.range.requestedTo },
    effectiveRange: snapshot.range,
    academicYear: { id: snapshot.year.id, label: snapshot.year.label, startsOn: snapshot.year.startsOn.toISOString(), endsOn: snapshot.year.endsOn.toISOString() },
    cohortBasis: "CURRENT_MEMBERSHIP",
    asOf: snapshot.asOf.toISOString(),
    policy: { version: REWARD_POLICY_VERSION, dailyEffortCap: REWARD_DAILY_EFFORT_CAP, dailyOutcomeCap: REWARD_DAILY_OUTCOME_CAP, dailyScale: REWARD_DAILY_SCALE, weights },
    scopeRevision: snapshot.scopeRevision,
    scopeToken: snapshot.scopeToken,
    coverageSummary,
  };
}

async function loadGroupedRewardActivity(db: Prisma.TransactionClient, snapshot: RewardSnapshot) {
  return groupRewardActivity(await loadRewardActivity(db, snapshot));
}

function sortRewardReports(reports: Array<{ total: RewardStudentTotal; days: RewardDay[] }>) {
  reports.sort((left, right) => sortRewardTotals(left.total, right.total));
  return reports;
}

async function buildAllReports(db: Prisma.TransactionClient, snapshot: RewardSnapshot, weights: RewardWeights) {
  const grouped = await loadGroupedRewardActivity(db, snapshot);
  return sortRewardReports(snapshot.members.map((member) => buildRewardReport(member, grouped, snapshot.range, weights)));
}

async function buildAllTotals(db: Prisma.TransactionClient, snapshot: RewardSnapshot, weights: RewardWeights) {
  const grouped = await loadGroupedRewardActivity(db, snapshot);
  const totals = snapshot.members.map((member) => buildRewardReport(member, grouped, snapshot.range, weights).total);
  return totals.sort(sortRewardTotals);
}

async function buildTotalsAndReport(db: Prisma.TransactionClient, snapshot: RewardSnapshot, weights: RewardWeights, studentId: string) {
  const grouped = await loadGroupedRewardActivity(db, snapshot);
  let selected: { total: RewardStudentTotal; days: RewardDay[] } | undefined;
  const totals: RewardStudentTotal[] = [];
  for (const member of snapshot.members) {
    const report = buildRewardReport(member, grouped, snapshot.range, weights);
    if (member.id === studentId) selected = report;
    totals.push(report.total);
  }
  totals.sort(sortRewardTotals);
  return { totals, selected };
}

export async function queryLearningRewards(input: { userId: string; role: Role; request: RewardRequest }): Promise<RewardQueryResult> {
  return withRewardSnapshot(input, async (tx, snapshot) => {
    const totals = await buildAllTotals(tx, snapshot, input.request.weights);
    const coverageSummary = buildCoverageSummary(totals);
    const pageLimit = input.request.limit ?? DEFAULT_REWARD_LIMIT;
    let start = 0;
    if (input.request.cursor) {
      const cursor = readRewardCursor(input.request.cursor);
      if (!cursor || cursor.fingerprint !== snapshot.fingerprint || cursor.memberDigest !== snapshot.memberDigest || cursor.scopeTokenDigest !== hashValue(snapshot.scopeToken) || cursor.limit !== pageLimit) throw new Error(cursor ? "REWARD_SCOPE_STALE" : "CURSOR_INVALID");
      const index = totals.findIndex((total) => total.studentId === cursor.afterStudentId);
      const cursorTotal = index < 0 ? undefined : totals[index];
      if (!cursorTotal || cursorTotal.classLabel !== cursor.afterClassLabel || cursorTotal.studentNumber !== cursor.afterStudentNumber || normalizeAccountName(cursorTotal.accountName) !== cursor.afterAccountName) throw new Error("REWARD_SCOPE_STALE");
      start = index + 1;
    }
    const page = totals.slice(start, start + pageLimit);
    const hasNext = start + pageLimit < totals.length;
    const last = page.at(-1);
    return { ...envelope(snapshot, coverageSummary, input.request.weights), items: page, totalStudentCount: totals.length, nextCursor: hasNext && last ? createRewardCursor({ v: CURSOR_VERSION, fingerprint: snapshot.fingerprint, memberDigest: snapshot.memberDigest, scopeTokenDigest: hashValue(snapshot.scopeToken), limit: pageLimit, afterClassLabel: last.classLabel, afterStudentNumber: last.studentNumber, afterAccountName: normalizeAccountName(last.accountName), afterStudentId: last.studentId }) : null };
  });
}

export async function queryLearningRewardTimeline(input: { userId: string; role: Role; studentId: string; request: RewardRequest }): Promise<RewardTimelineResult> {
  return withRewardSnapshot(input, async (tx, snapshot) => {
    if (!snapshot.members.some((member) => member.id === input.studentId)) throw new Error("STUDENT_NOT_FOUND");
    const { totals, selected } = await buildTotalsAndReport(tx, snapshot, input.request.weights, input.studentId);
    if (!selected) throw new Error("STUDENT_NOT_FOUND");
    const coverageSummary = buildCoverageSummary(totals);
    return { ...envelope(snapshot, coverageSummary, input.request.weights), student: selected.total, days: selected.days };
  });
}

export async function exportLearningRewards(input: { userId: string; role: Role; request: RewardRequest }): Promise<RewardExportResult> {
  return withRewardSnapshot(input, async (tx, snapshot) => {
    const reports = await buildAllReports(tx, snapshot, input.request.weights);
    const totals = reports.map((report) => report.total);
    const coverageSummary = buildCoverageSummary(totals);
    return {
      ...envelope(snapshot, coverageSummary, input.request.weights),
      totals,
      days: reports.flatMap((report) => report.days),
      settings: [
        ["policyVersion", REWARD_POLICY_VERSION],
        ["dailyEffortCap", String(REWARD_DAILY_EFFORT_CAP)],
        ["dailyOutcomeCap", String(REWARD_DAILY_OUTCOME_CAP)],
        ["dailyScale", String(REWARD_DAILY_SCALE)],
        ["effortWeight", String(input.request.weights.effort)],
        ["outcomeWeight", String(input.request.weights.outcome)],
        ["timezone", REWARD_TIMEZONE],
        ["cohortBasis", "CURRENT_MEMBERSHIP"],
        ["formula", "Ed=10*min(Ud,20)/20; Od=10*min(Cd,5)/5; Td=Ed*effortWeight/100+Od*outcomeWeight/100"],
        ["requestedRange", `${snapshot.range.requestedFrom} 至 ${snapshot.range.requestedTo}`],
        ["effectiveRange", `${snapshot.range.from} 至 ${snapshot.range.to}`],
        ["asOf", snapshot.asOf.toISOString()],
        ["historyNote", "按可核對紀錄計算；資料缺漏會在 coverage 欄標示"],
      ],
    };
  });
}
