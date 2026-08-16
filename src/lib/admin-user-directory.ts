import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, AccountStatus, ClassCode, Role, StudentGrade } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { parseClassCode, parseStudentGrade, STUDENT_GRADES } from "@/lib/roster-domain";

export const ADMIN_DIRECTORY_LIMIT_DEFAULT = 50;
export const ADMIN_DIRECTORY_LIMIT_MAX = 100;
const BODY_LIMIT = 16 * 1024;
const MAX_SEARCH_GRAPHEMES = 80;
const MAX_ID_BYTES = 128;
const CURSOR_VERSION = 1;

export type AdminDirectoryQuery = {
  role?: Role;
  status?: AccountStatus;
  academicYearId?: string;
  grade?: StudentGrade;
  classCode?: ClassCode;
  search?: string;
  cursor?: string;
  limit: number;
};

type CursorPayload = {
  v: number;
  accountName: string;
  id: string;
  fingerprint: string;
  rosterRevision: number;
};

export type AdminDirectoryItem = {
  id: string;
  accountName: string;
  role: Role;
  status: AccountStatus;
  mustChangePassword: boolean;
  legalName: string;
  nickname: string | null;
  academicYearId: string | null;
  grade: StudentGrade | null;
  classId: string | null;
  classCode: ClassCode | null;
  createdAt: string;
  revision: number;
};

function cursorSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for admin user cursors");
  return "development-only-admin-user-directory-cursor-secret";
}

function signature(body: string) {
  return createHmac("sha256", cursorSecret()).update("admin-user-directory-v1:").update(body).digest("base64url");
}

function filterFingerprint(query: AdminDirectoryQuery) {
  return createHmac("sha256", cursorSecret()).update(JSON.stringify({
    role: query.role ?? null,
    status: query.status ?? null,
    academicYearId: query.academicYearId ?? null,
    grade: query.grade ?? null,
    classCode: query.classCode ?? null,
    search: query.search ?? null,
  })).digest("hex");
}

export function encodeAdminDirectoryCursor(payload: Omit<CursorPayload, "v">) {
  const body = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...payload }), "utf8").toString("base64url");
  return `${body}.${signature(body)}`;
}

export function decodeAdminDirectoryCursor(value: string): CursorPayload | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const [body, supplied] = value.split(".");
  if (!body || !supplied) return null;
  const expected = signature(body);
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (
      parsed.v !== CURSOR_VERSION || typeof parsed.accountName !== "string" ||
      typeof parsed.id !== "string" || typeof parsed.fingerprint !== "string" ||
      !Number.isInteger(parsed.rosterRevision)
    ) return null;
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

function graphemeLength(value: string) {
  return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value)].length;
}

function parseId(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > MAX_ID_BYTES) throw new Error("QUERY_INVALID");
  return value;
}

export function parseAdminDirectoryQuery(input: unknown): AdminDirectoryQuery {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const role = body.role === undefined || body.role === null || body.role === "" ? undefined : body.role as Role;
  if (role !== undefined && !["STUDENT", "TEACHER", "ADMIN"].includes(role)) throw new Error("QUERY_INVALID");
  const status = body.status === undefined || body.status === null || body.status === "" ? undefined : body.status as AccountStatus;
  if (status !== undefined && !["ACTIVE", "SUSPENDED"].includes(status)) throw new Error("QUERY_INVALID");
  const academicYearId = parseId(body.academicYearId);
  const cursor = parseId(body.cursor);
  const searchRaw = typeof body.search === "string" ? body.search.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
  if (graphemeLength(searchRaw) > MAX_SEARCH_GRAPHEMES) throw new Error("QUERY_INVALID");
  const grade = body.grade === undefined || body.grade === null || body.grade === "" ? undefined : parseStudentGrade(body.grade);
  if (body.grade !== undefined && body.grade !== null && body.grade !== "" && !grade) throw new Error("QUERY_INVALID");
  const classCode = body.classCode === undefined || body.classCode === null || body.classCode === "" ? undefined : parseClassCode(body.classCode);
  if (body.classCode !== undefined && body.classCode !== null && body.classCode !== "" && !classCode) throw new Error("QUERY_INVALID");
  if (role !== undefined && role !== "STUDENT" && (grade || classCode || academicYearId)) throw new Error("QUERY_INVALID");
  const parsedLimit = body.limit === undefined ? ADMIN_DIRECTORY_LIMIT_DEFAULT : Number(body.limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > ADMIN_DIRECTORY_LIMIT_MAX) throw new Error("QUERY_INVALID");
  return { role, status, academicYearId, grade: grade ?? undefined, classCode: classCode ?? undefined, search: searchRaw || undefined, cursor, limit: parsedLimit };
}

export async function readAdminDirectoryQuery(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error("QUERY_INVALID"); }
  return parseAdminDirectoryQuery(body);
}

function searchPredicate(search: string | undefined): Prisma.UserWhereInput | null {
  if (!search) return null;
  const account = normalizeAccountName(search);
  const legal = normalizeLegalName(search);
  const nickname = search.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return {
    OR: [
      { accountName: { contains: account, mode: "insensitive" } },
      { accountNameCanonical: { contains: account, mode: "insensitive" } },
      { role: "ADMIN", legacyName: { contains: legal, mode: "insensitive" } },
      { role: "STUDENT", studentProfile: { is: { OR: [
        { legalName: { contains: legal, mode: "insensitive" } },
        { nickname: { contains: nickname, mode: "insensitive" } },
      ] } } },
      { role: "TEACHER", teacherProfile: { is: { legalName: { contains: legal, mode: "insensitive" } } } },
    ],
  };
}

function enrollmentFilter(query: AdminDirectoryQuery, yearId: string): Prisma.StudentEnrollmentWhereInput {
  return {
    academicYearId: yearId,
    status: { in: ["ACTIVE", "PLANNED"] },
    ...(query.grade ? { grade: query.grade } : {}),
    ...(query.classCode ? { schoolClass: { is: { classCode: query.classCode } } } : {}),
  };
}

function buildWhere(query: AdminDirectoryQuery, yearId: string | undefined, omit: "role" | "status" | "grade" | "classCode" | null = null): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [];
  if (query.role && omit !== "role") filters.push({ role: query.role });
  if (query.status && omit !== "status") filters.push({ status: query.status });
  const studentFilter = yearId ? { studentProfile: { is: { enrollments: { some: enrollmentFilter(query, yearId) } } } } satisfies Prisma.UserWhereInput : null;
  const hasStudentFilters = Boolean(yearId && (query.academicYearId || query.grade || query.classCode));
  if (hasStudentFilters && studentFilter) {
    if (query.role === "STUDENT" && omit !== "role") filters.push(studentFilter);
    else if (!query.role || omit === "role") filters.push({ OR: [{ role: { not: "STUDENT" } }, studentFilter] });
  }
  if (query.grade && omit !== "grade" && query.role === "STUDENT" && studentFilter) filters.push(studentFilter);
  if (query.classCode && omit !== "classCode" && query.role === "STUDENT" && studentFilter) filters.push(studentFilter);
  const search = searchPredicate(query.search);
  if (search) filters.push(search);
  return filters.length ? { AND: filters } : {};
}

const baseSelect = {
  id: true, accountName: true, accountNameCanonical: true, role: true, status: true,
  mustChangePassword: true, revision: true, createdAt: true,
  legacyName: true,
  studentProfile: { select: { legalName: true, nickname: true, enrollments: { select: { id: true, academicYearId: true, grade: true, classId: true, status: true, schoolClass: { select: { classCode: true } }, academicYear: { select: { id: true, status: true, startsOn: true } } } } } },
  teacherProfile: { select: { legalName: true } },
} satisfies Prisma.UserSelect;

function project(user: Prisma.UserGetPayload<{ select: typeof baseSelect }>, yearId?: string): AdminDirectoryItem {
  const enrollments = user.studentProfile?.enrollments.filter((enrollment) => !yearId || enrollment.academicYearId === yearId) ?? [];
  const enrollment = enrollments.sort((a, b) => Number(b.academicYear.startsOn) - Number(a.academicYear.startsOn))[0];
  return {
    id: user.id,
    accountName: user.accountName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    legalName: user.studentProfile?.legalName ?? user.teacherProfile?.legalName ?? user.legacyName ?? "",
    nickname: user.studentProfile?.nickname ?? null,
    academicYearId: enrollment?.academicYearId ?? null,
    grade: enrollment?.grade ?? null,
    classId: enrollment?.classId ?? null,
    classCode: enrollment?.schoolClass?.classCode ?? null,
    createdAt: user.createdAt.toISOString(),
    revision: user.revision,
  };
}

async function currentYearId() {
  const year = await prisma.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: [{ startsOn: "desc" }, { id: "asc" }], select: { id: true } });
  return year?.id;
}

async function readRosterRevision() {
  const state = await prisma.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  return state?.revision ?? 0;
}

function countFacet(items: AdminDirectoryItem[]) {
  const roles = { all: items.length, students: 0, teachers: 0, admins: 0 };
  const status = { active: 0, suspended: 0 };
  const grades = Object.fromEntries(STUDENT_GRADES.map((grade) => [grade, 0])) as Record<StudentGrade, number>;
  const classCodes = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G", "H"].map((code) => [code, 0])) as Record<ClassCode, number>;
  for (const item of items) {
    if (item.role === "STUDENT") roles.students += 1;
    if (item.role === "TEACHER") roles.teachers += 1;
    if (item.role === "ADMIN") roles.admins += 1;
    if (item.status === "ACTIVE") status.active += 1;
    else status.suspended += 1;
    if (item.role === "STUDENT" && item.grade) grades[item.grade] += 1;
    if (item.role === "STUDENT" && item.classCode) classCodes[item.classCode] += 1;
  }
  return { roles, status, grades, classCodes };
}

export async function queryAdminUserDirectory(query: AdminDirectoryQuery) {
  const yearId = query.academicYearId ?? (query.role === "STUDENT" || query.grade || query.classCode ? await currentYearId() : undefined);
  if ((query.role === "STUDENT" || query.grade || query.classCode) && !yearId) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  const rosterRevision = await readRosterRevision();
  const fingerprint = filterFingerprint(query);
  const decoded = query.cursor ? decodeAdminDirectoryCursor(query.cursor) : null;
  if (query.cursor && (!decoded || decoded.fingerprint !== fingerprint)) throw new Error(decoded ? "ADMIN_USER_QUERY_STALE" : "CURSOR_INVALID");
  if (decoded && decoded.rosterRevision !== rosterRevision) throw new Error("ADMIN_USER_QUERY_STALE");
  const where = buildWhere(query, yearId);
  if (decoded) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [
      { accountName: { gt: decoded.accountName } },
      { accountName: decoded.accountName, id: { gt: decoded.id } },
    ] }];
  }
  const users = await prisma.user.findMany({ where, select: baseSelect, orderBy: [{ accountName: "asc" }, { id: "asc" }], take: query.limit + 1 });
  const hasNext = users.length > query.limit;
  const pageUsers = hasNext ? users.slice(0, query.limit) : users;
  const items = pageUsers.map((user) => project(user, yearId));

  const facetItems = await prisma.user.findMany({ where: buildWhere({ ...query, cursor: undefined }, yearId), select: baseSelect, orderBy: [{ accountName: "asc" }, { id: "asc" }], take: 5_001 });
  const facets = countFacet(facetItems.map((user) => project(user, yearId)));
  const last = pageUsers.at(-1);
  return {
    items,
    facets,
    rosterRevision,
    generatedAt: new Date().toISOString(),
    nextCursor: hasNext && last ? encodeAdminDirectoryCursor({ accountName: last.accountName, id: last.id, fingerprint, rosterRevision }) : null,
  };
}
