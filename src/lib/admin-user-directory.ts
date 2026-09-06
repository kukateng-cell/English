import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountStatus, ClassCode, EnrollmentStatus, Role, StudentGrade } from "@/generated/prisma";
import { prisma, Prisma } from "@/lib/prisma";
import { normalizeAccountName, normalizeLegalName } from "@/lib/identity";
import { compareStudentNumberSortKey, parseClassCode, parseStudentGrade, STUDENT_GRADES } from "@/lib/roster-domain";
import { readLimitedBody } from "@/lib/request-body";

export const ADMIN_DIRECTORY_LIMIT_DEFAULT = 50;
export const ADMIN_DIRECTORY_LIMIT_MAX = 100;
const BODY_LIMIT = 16 * 1024;
const MAX_SEARCH_GRAPHEMES = 80;
const MAX_ID_BYTES = 128;
const CURSOR_VERSION = 2;
const MAX_STUDENT_NUMBER_SORT_ROWS = 5_000;

export type AdminDirectoryQuery = {
  role?: Role;
  status?: AccountStatus;
  academicYearId?: string;
  grade?: StudentGrade;
  classCode?: ClassCode;
  search?: string;
  sort: "ACCOUNT_ASC" | "STUDENT_NUMBER_ASC";
  cursor?: string;
  limit: number;
};

type CursorPayload = {
  v: number;
  accountName: string;
  studentNumber: number | null;
  sort: AdminDirectoryQuery["sort"];
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
  studentNumber: number | null;
  enrollmentStatus: EnrollmentStatus | null;
  createdAt: string;
  revision: number;
};

type ProjectedAdminDirectoryItem = AdminDirectoryItem & { sortAccountName: string };

function cursorSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for admin user cursors");
  return "development-only-admin-user-directory-cursor-secret";
}

function signature(body: string) {
  return createHmac("sha256", cursorSecret()).update("admin-user-directory-v2:").update(body).digest("base64url");
}

function filterFingerprint(query: AdminDirectoryQuery) {
  return createHmac("sha256", cursorSecret()).update(JSON.stringify({
    role: query.role ?? null,
    status: query.status ?? null,
    academicYearId: query.academicYearId ?? null,
    grade: query.grade ?? null,
    classCode: query.classCode ?? null,
    search: query.search ?? null,
    sort: query.sort,
  })).digest("hex");
}

export function encodeAdminDirectoryCursor(payload: Omit<CursorPayload, "v">) {
  const body = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...payload }), "utf8").toString("base64url");
  return `${body}.${signature(body)}`;
}

export function decodeAdminDirectoryCursor(value: string): CursorPayload | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
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
      !Number.isInteger(parsed.rosterRevision) ||
      (parsed.studentNumber !== null && !Number.isInteger(parsed.studentNumber)) ||
      (parsed.sort !== "ACCOUNT_ASC" && parsed.sort !== "STUDENT_NUMBER_ASC")
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
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("QUERY_INVALID");
  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["role", "status", "academicYearId", "grade", "classCode", "search", "sort", "cursor", "limit"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) throw new Error("QUERY_INVALID");
  const role = body.role === undefined || body.role === null || body.role === "" ? undefined : body.role as Role;
  if (role !== undefined && !["STUDENT", "TEACHER", "ADMIN"].includes(role)) throw new Error("QUERY_INVALID");
  const status = body.status === undefined || body.status === null || body.status === "" ? undefined : body.status as AccountStatus;
  if (status !== undefined && !["ACTIVE", "SUSPENDED"].includes(status)) throw new Error("QUERY_INVALID");
  const academicYearId = parseId(body.academicYearId);
  const cursor = parseId(body.cursor);
  if (body.search !== undefined && typeof body.search !== "string") throw new Error("QUERY_INVALID");
  const searchRaw = typeof body.search === "string" ? body.search.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
  if (graphemeLength(searchRaw) > MAX_SEARCH_GRAPHEMES) throw new Error("QUERY_INVALID");
  if (body.grade !== undefined && typeof body.grade !== "string") throw new Error("QUERY_INVALID");
  const grade = body.grade === undefined || body.grade === "" ? undefined : parseStudentGrade(body.grade);
  if (body.grade !== undefined && body.grade !== "" && !grade) throw new Error("QUERY_INVALID");
  if (body.classCode !== undefined && typeof body.classCode !== "string") throw new Error("QUERY_INVALID");
  const classCode = body.classCode === undefined || body.classCode === "" ? undefined : parseClassCode(body.classCode);
  if (body.classCode !== undefined && body.classCode !== "" && !classCode) throw new Error("QUERY_INVALID");
  if (role !== undefined && role !== "STUDENT" && (grade || classCode || academicYearId)) throw new Error("QUERY_INVALID");
  const limitValue = body.limit;
  const parsedLimit = limitValue === undefined ? ADMIN_DIRECTORY_LIMIT_DEFAULT : typeof limitValue === "number" ? limitValue : Number.NaN;
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > ADMIN_DIRECTORY_LIMIT_MAX) throw new Error("QUERY_INVALID");
  const sort = body.sort === undefined ? "STUDENT_NUMBER_ASC" : body.sort;
  if (sort !== "ACCOUNT_ASC" && sort !== "STUDENT_NUMBER_ASC") throw new Error("QUERY_INVALID");
  return { role, status, academicYearId, grade: grade ?? undefined, classCode: classCode ?? undefined, search: searchRaw || undefined, sort, cursor, limit: parsedLimit };
}

export async function readAdminDirectoryQuery(req: Request) {
  let body: unknown = null;
  try {
    const raw = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") throw error;
    throw new Error("QUERY_INVALID");
  }
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
  studentProfile: { select: { legalName: true, nickname: true, enrollments: { select: { id: true, academicYearId: true, grade: true, classId: true, studentNumber: true, status: true, schoolClass: { select: { classCode: true } }, academicYear: { select: { id: true, status: true, startsOn: true } } } } } },
  teacherProfile: { select: { legalName: true } },
} satisfies Prisma.UserSelect;

function project(user: Prisma.UserGetPayload<{ select: typeof baseSelect }>, yearId?: string): ProjectedAdminDirectoryItem {
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
    studentNumber: enrollment?.studentNumber ?? null,
    enrollmentStatus: enrollment?.status ?? null,
    createdAt: user.createdAt.toISOString(),
    revision: user.revision,
    sortAccountName: normalizeAccountName(user.accountNameCanonical ?? user.accountName),
  };
}

function compareItems(a: ProjectedAdminDirectoryItem, b: ProjectedAdminDirectoryItem, sort: AdminDirectoryQuery["sort"]) {
  if (sort === "STUDENT_NUMBER_ASC") {
    return compareStudentNumberSortKey({ studentNumber: a.studentNumber, accountName: a.sortAccountName, id: a.id }, { studentNumber: b.studentNumber, accountName: b.sortAccountName, id: b.id });
  }
  return a.sortAccountName.localeCompare(b.sortAccountName, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

function isAfterCursor(item: ProjectedAdminDirectoryItem, cursor: CursorPayload, sort: AdminDirectoryQuery["sort"]) {
  if (sort === "STUDENT_NUMBER_ASC") {
    return compareStudentNumberSortKey({ studentNumber: item.studentNumber, accountName: item.sortAccountName, id: item.id }, { studentNumber: cursor.studentNumber, accountName: cursor.accountName, id: cursor.id }) > 0;
  }
  return item.sortAccountName.localeCompare(cursor.accountName, "en", { sensitivity: "base" }) > 0 || (item.sortAccountName === cursor.accountName && item.id > cursor.id);
}

async function currentYearId(db: typeof prisma | Prisma.TransactionClient = prisma) {
  const year = await db.academicYear.findFirst({ where: { status: "CURRENT" }, orderBy: [{ startsOn: "desc" }, { id: "asc" }], select: { id: true } });
  return year?.id;
}

async function readRosterRevision(db: typeof prisma | Prisma.TransactionClient = prisma) {
  const state = await db.rosterMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  return state?.revision ?? 0;
}

export async function queryAdminUserDirectory(query: AdminDirectoryQuery) {
  return prisma.$transaction(async (tx) => {
  // Always project student fields against the current year, including the
  // all-roles tab, so an unfiltered directory never shows a historical number.
  const yearId = query.academicYearId ?? await currentYearId(tx);
  if (!yearId) throw new Error("CURRENT_YEAR_UNAVAILABLE");
  if (query.academicYearId) {
    const year = await tx.academicYear.findUnique({ where: { id: query.academicYearId }, select: { id: true } });
    if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
  }
  const rosterRevision = await readRosterRevision(tx);
  const fingerprint = filterFingerprint(query);
  const decoded = query.cursor ? decodeAdminDirectoryCursor(query.cursor) : null;
  if (query.cursor && (!decoded || decoded.fingerprint !== fingerprint)) throw new Error(decoded ? "ADMIN_USER_QUERY_STALE" : "CURSOR_INVALID");
  if (decoded && decoded.rosterRevision !== rosterRevision) throw new Error("ADMIN_USER_QUERY_STALE");
  const where = buildWhere(query, yearId);
  // Both supported orders are applied after projecting the enrollment fields.
  // Load the complete bounded scope before cursor slicing; taking only the
  // first page and then filtering a cursor would make ACCOUNT_ASC page 2
  // appear empty (and would silently drop students for numeric ordering).
  const count = await tx.user.count({ where });
  if (count > MAX_STUDENT_NUMBER_SORT_ROWS) throw new Error("DIRECTORY_TOO_LARGE");
  const users = await tx.user.findMany({ where, select: baseSelect, take: MAX_STUDENT_NUMBER_SORT_ROWS + 1 });
  const allItems = users.map((user) => project(user, yearId)).sort((a, b) => compareItems(a, b, query.sort));
  const filteredItems = decoded ? allItems.filter((item) => isAfterCursor(item, decoded, query.sort)) : allItems;
  const hasNext = filteredItems.length > query.limit;
  const items = filteredItems.slice(0, query.limit);

  const roleFacetBase = { ...query, role: undefined, cursor: undefined };
  const statusFacetBase = { ...query, status: undefined, cursor: undefined };
  const [allRoleCount, studentRoleCount, teacherRoleCount, adminRoleCount, activeCount, suspendedCount] = await Promise.all([
    tx.user.count({ where: buildWhere(roleFacetBase, yearId, "role") }),
    tx.user.count({ where: buildWhere({ ...roleFacetBase, role: "STUDENT" }, yearId) }),
    tx.user.count({ where: buildWhere({ ...roleFacetBase, role: "TEACHER" }, yearId) }),
    tx.user.count({ where: buildWhere({ ...roleFacetBase, role: "ADMIN" }, yearId) }),
    tx.user.count({ where: buildWhere(statusFacetBase, yearId, "status") }),
    tx.user.count({ where: buildWhere({ ...statusFacetBase, status: "SUSPENDED" }, yearId) }),
  ]);
  const exactRoles = { all: allRoleCount, students: studentRoleCount, teachers: teacherRoleCount, admins: adminRoleCount };
  const exactStatus = { active: activeCount, suspended: suspendedCount };
  const exactGrades = Object.fromEntries(STUDENT_GRADES.map((grade) => [grade, 0])) as Record<StudentGrade, number>;
  const exactClassCodes = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G", "H"].map((code) => [code, 0])) as Record<ClassCode, number>;
  if (query.role === "STUDENT") {
    const gradeCounts = await Promise.all(STUDENT_GRADES.map((grade) => tx.user.count({ where: buildWhere({ ...query, role: "STUDENT", grade, cursor: undefined }, yearId) })));
    const classCounts = await Promise.all((["A", "B", "C", "D", "E", "F", "G", "H"] as ClassCode[]).map((classCode) => tx.user.count({ where: buildWhere({ ...query, role: "STUDENT", classCode, cursor: undefined }, yearId) })));
    STUDENT_GRADES.forEach((grade, index) => { exactGrades[grade] = gradeCounts[index] ?? 0; });
    (Object.keys(exactClassCodes) as ClassCode[]).forEach((classCode, index) => { exactClassCodes[classCode] = classCounts[index] ?? 0; });
  }
  const facets = { roles: exactRoles, status: exactStatus, grades: exactGrades, classCodes: exactClassCodes };
  const last = items.at(-1);
  const publicItems = items.map((item) => {
    const { sortAccountName, ...publicItem } = item;
    void sortAccountName;
    return publicItem;
  });
  return {
    items: publicItems,
    facets,
    rosterRevision,
    generatedAt: new Date().toISOString(),
    nextCursor: hasNext && last ? encodeAdminDirectoryCursor({ accountName: last.sortAccountName, studentNumber: last.studentNumber, sort: query.sort, id: last.id, fingerprint, rosterRevision }) : null,
  };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
