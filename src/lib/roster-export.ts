import type { Prisma, AcademicYearStatus } from "@/generated/prisma";
import { parseClassCode, parseStudentGrade } from "@/lib/roster-domain";

export const EXPORT_ROW_CAP = 5_000;
export const STUDENT_EXPORT_FIELDS = ["accountName", "studentNumber", "legalName", "nickname", "grade", "classCode", "contactEmail", "status", "mustChangePassword", "createdAt"] as const;
export const TEACHER_EXPORT_FIELDS = ["templateVersion", "accountName", "legalName", "contactEmail", "classAccess", "resetPasswordCapability", "status", "createdAt"] as const;

export type ExportEntity = "STUDENT" | "TEACHER";
export type ExportFormat = "CSV" | "XLSX";
export type ExportRequest = { entityType: ExportEntity; academicYearId: string; fields: string[]; filters?: { grade?: unknown; classCode?: unknown; status?: unknown; search?: unknown } };
export type ExportRow = Record<string, string>;

export function selectedEnrollmentStatus(status: AcademicYearStatus) {
  return status === "CURRENT" ? "ACTIVE" : status === "PLANNED" ? "PLANNED" : "ENDED";
}

function searchFilter(search: string, role: ExportEntity): Prisma.UserWhereInput {
  if (!search) return {};
  const fields: Prisma.UserWhereInput[] = [
    { accountName: { contains: search, mode: "insensitive" } },
  ];
  if (role === "STUDENT") fields.push({ studentProfile: { is: { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { nickname: { contains: search, mode: "insensitive" } }] } } });
  else fields.push({ teacherProfile: { is: { legalName: { contains: search, mode: "insensitive" } } } });
  return { OR: fields };
}

export function validateExportRequest(body: unknown): { ok: true; request: ExportRequest } | { ok: false; code: string } {
  if (!body || typeof body !== "object") return { ok: false, code: "EXPORT_INPUT_INVALID" };
  const entityType = Reflect.get(body, "entityType") === "TEACHER" ? "TEACHER" : Reflect.get(body, "entityType") === "STUDENT" ? "STUDENT" : null;
  const academicYearId = Reflect.get(body, "academicYearId");
  const fields = Reflect.get(body, "fields");
  if (!entityType || typeof academicYearId !== "string" || !academicYearId || !Array.isArray(fields) || !fields.length) return { ok: false, code: "EXPORT_INPUT_INVALID" };
  const allowed = entityType === "STUDENT" ? STUDENT_EXPORT_FIELDS : TEACHER_EXPORT_FIELDS;
  const normalized = fields.filter((field): field is string => typeof field === "string");
  if (normalized.length !== fields.length || normalized.some((field) => !allowed.includes(field as never)) || new Set(normalized).size !== normalized.length) return { ok: false, code: "EXPORT_FIELDS_INVALID" };
  const rawFilters = Reflect.get(body, "filters");
  if (rawFilters !== undefined && (rawFilters === null || typeof rawFilters !== "object")) return { ok: false, code: "EXPORT_FILTER_INVALID" };
  const filters = rawFilters as ExportRequest["filters"];
  if (filters) {
    if (filters.status !== undefined && filters.status !== "ACTIVE" && filters.status !== "SUSPENDED") return { ok: false, code: "EXPORT_FILTER_INVALID" };
    if (filters.grade !== undefined && !parseStudentGrade(filters.grade)) return { ok: false, code: "EXPORT_FILTER_INVALID" };
    if (filters.classCode !== undefined && !parseClassCode(filters.classCode)) return { ok: false, code: "EXPORT_FILTER_INVALID" };
    if (filters.search !== undefined && (typeof filters.search !== "string" || filters.search.length > 120)) return { ok: false, code: "EXPORT_FILTER_INVALID" };
  }
  return { ok: true, request: { entityType, academicYearId, fields: normalized, filters } };
}

export async function resolveExportRows(tx: Prisma.TransactionClient, request: ExportRequest): Promise<ExportRow[]> {
  const year = await tx.academicYear.findUnique({ where: { id: request.academicYearId }, select: { id: true, status: true } });
  if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
  const status = request.filters?.status === "ACTIVE" || request.filters?.status === "SUSPENDED" ? request.filters.status : undefined;
  const search = typeof request.filters?.search === "string" ? request.filters.search.normalize("NFKC").trim() : "";
  const grade = parseStudentGrade(request.filters?.grade);
  const classCode = parseClassCode(request.filters?.classCode);
  const selectedStatus = selectedEnrollmentStatus(year.status);
  if (request.entityType === "STUDENT") {
    const users = await tx.user.findMany({
      where: {
        role: "STUDENT", ...(status ? { status } : {}), ...searchFilter(search, "STUDENT"),
        studentProfile: { is: { enrollments: { some: { academicYearId: year.id, status: selectedStatus, ...(grade ? { grade } : {}), ...(classCode ? { schoolClass: { is: { classCode } } } : request.filters?.classCode !== undefined ? { classId: null } : {}) } } } },
      },
      orderBy: [{ accountName: "asc" }, { id: "asc" }], take: EXPORT_ROW_CAP + 1,
      select: { accountName: true, contactEmail: true, status: true, mustChangePassword: true, createdAt: true, studentProfile: { select: { legalName: true, nickname: true, enrollments: { where: { academicYearId: year.id, status: selectedStatus }, select: { grade: true, studentNumber: true, schoolClass: { select: { classCode: true } } } } } } },
    });
    if (users.length > EXPORT_ROW_CAP) throw new Error("EXPORT_TOO_LARGE");
    return users.map((user) => {
      const enrollment = user.studentProfile?.enrollments[0];
      return { accountName: user.accountName, studentNumber: enrollment?.studentNumber === null || enrollment?.studentNumber === undefined ? "" : String(enrollment.studentNumber), legalName: user.studentProfile?.legalName ?? "", nickname: user.studentProfile?.nickname ?? "", grade: enrollment?.grade ?? "", classCode: enrollment?.schoolClass?.classCode ?? "", contactEmail: user.contactEmail ?? "", status: user.status, mustChangePassword: String(user.mustChangePassword), createdAt: user.createdAt.toISOString() };
    });
  }
  const users = await tx.user.findMany({
    where: { role: "TEACHER", ...(status ? { status } : {}), ...searchFilter(search, "TEACHER"), ...(grade || classCode ? { teacherProfile: { is: { classAccess: { some: { schoolClass: { academicYearId: year.id, ...(grade ? { grade } : {}), ...(classCode ? { classCode } : {}) } } } } } } : {}) },
    orderBy: [{ accountName: "asc" }, { id: "asc" }], take: EXPORT_ROW_CAP + 1,
    select: { accountName: true, contactEmail: true, status: true, createdAt: true, teacherProfile: { select: { legalName: true, canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYearId: year.id }, canViewProgress: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { schoolClass: { classCode: "asc" } }], select: { schoolClass: { select: { grade: true, classCode: true } } } } } } },
  });
  if (users.length > EXPORT_ROW_CAP) throw new Error("EXPORT_TOO_LARGE");
  return users.map((user) => {
    const access = user.teacherProfile?.classAccess ?? [];
    const filtered = grade || classCode ? access.filter((item) => (!grade || item.schoolClass.grade === grade) && (!classCode || item.schoolClass.classCode === classCode)) : access;
    return { templateVersion: "teacher-roster-v2", accountName: user.accountName, legalName: user.teacherProfile?.legalName ?? "", contactEmail: user.contactEmail ?? "", status: user.status, classAccess: filtered.map((item) => `${item.schoolClass.grade}:${item.schoolClass.classCode}`).join("|"), resetPasswordCapability: user.teacherProfile?.canResetStudentPassword ? "TRUE" : "FALSE", createdAt: user.createdAt.toISOString() };
  });
}

export function projectExportRows(rows: ExportRow[], fields: string[]) {
  return rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? ""])));
}
