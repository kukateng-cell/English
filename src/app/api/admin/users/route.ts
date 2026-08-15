import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES, isRole, type Role } from "@/lib/roles";
import type { AccountStatus } from "@/generated/prisma";
import { passwordPolicyError } from "@/lib/password-policy";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import { BCRYPT_COST, passwordCredentialCreateData } from "@/lib/password-credentials";
import { getClientIp } from "@/lib/login-limiter";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { securityEventData } from "@/lib/security-events";
import { accountNameError, contactEmailError, legalNameError, normalizeAccountName, normalizeContactEmail, normalizeLegalName } from "@/lib/identity";
import { validateNicknameAgainstIdentity } from "@/lib/nickname";
import { parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";

const USER_SELECT = {
  id: true,
  accountName: true,
  contactEmail: true,
  legacyName: true,
  role: true,
  status: true,
  suspendedAt: true,
  revision: true,
  credentialRevision: true,
  studentProfile: {
    select: {
      legalName: true,
      nickname: true,
      profileRevision: true,
      enrollments: {
        where: { status: { in: ["ACTIVE", "PLANNED"] } },
        orderBy: { academicYear: { startsOn: "desc" } },
        take: 1,
        select: { grade: true, status: true, schoolClass: { select: { classCode: true } }, academicYear: { select: { id: true, label: true, status: true } } },
      },
    },
  },
  teacherProfile: { select: { legalName: true, profileRevision: true, accessRevision: true } },
  createdAt: true,
  _count: { select: { reviewEvents: true } },
} satisfies Prisma.UserSelect;

function serializeUser(user: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>) {
  const enrollment = user.studentProfile?.enrollments[0];
  const legalName = user.studentProfile?.legalName ?? user.teacherProfile?.legalName ?? user.legacyName ?? "";
  return {
    id: user.id,
    accountName: user.accountName,
    email: user.accountName,
    name: legalName || null,
    contactEmail: user.contactEmail,
    legalName,
    nickname: user.studentProfile?.nickname ?? null,
    grade: enrollment?.grade ?? null,
    classCode: enrollment?.schoolClass?.classCode ?? null,
    academicYearId: enrollment?.academicYear.id ?? null,
    academicYear: enrollment?.academicYear.label ?? null,
    enrollmentStatus: enrollment?.status ?? null,
    role: user.role,
    status: user.status,
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    revision: user.revision,
    profileRevision: user.studentProfile?.profileRevision ?? user.teacherProfile?.profileRevision ?? 0,
    accessRevision: user.teacherProfile?.accessRevision ?? null,
    totalReviews: user._count.reviewEvents,
    createdAt: user.createdAt.toISOString(),
  };
}

function encodeCursor(value: { accountName: string; id: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { accountName?: unknown; id?: unknown };
    if (typeof decoded.accountName !== "string" || typeof decoded.id !== "string") return null;
    return { accountName: decoded.accountName, id: decoded.id };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  const params = new URL(req.url).searchParams;
  const role = isRole(params.get("role")) ? (params.get("role") as Role) : undefined;
  const status: AccountStatus | undefined = params.get("status") === "ACTIVE" || params.get("status") === "SUSPENDED" ? params.get("status") as AccountStatus : undefined;
  const academicYearId = params.get("academicYearId");
  const grade = parseStudentGrade(params.get("grade"));
  const classCode = parseClassCode(params.get("classCode"));
  if (params.has("grade") && params.get("grade") && !grade) return NextResponse.json({ code: "GRADE_INVALID" }, { status: 422 });
  if (params.has("classCode") && params.get("classCode") && !classCode) return NextResponse.json({ code: "CLASS_INVALID" }, { status: 422 });
  const search = (params.get("search") ?? "").trim();
  const parsedLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50;
  const cursor = decodeCursor(params.get("cursor"));
  if (params.has("cursor") && !cursor) return NextResponse.json({ code: "CURSOR_INVALID" }, { status: 422 });
  const filters: Prisma.UserWhereInput[] = [];
  if (role) filters.push({ role });
  if (status) filters.push({ status });
  if (search) filters.push({ OR: [
      { accountName: { contains: search, mode: "insensitive" } },
      { legacyName: { contains: search, mode: "insensitive" } },
      { studentProfile: { is: { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { nickname: { contains: search, mode: "insensitive" } }] } } },
      { teacherProfile: { is: { legalName: { contains: search, mode: "insensitive" } } } },
    ] });
  if (academicYearId || grade || classCode) {
    const enrollmentWhere: Prisma.StudentEnrollmentWhereInput = {
      ...(academicYearId ? { academicYearId } : {}),
      status: { in: ["ACTIVE", "PLANNED"] },
      ...(grade ? { grade } : {}),
      ...(classCode ? { schoolClass: { is: { classCode } } } : {}),
    };
    const studentScope: Prisma.UserWhereInput = { studentProfile: { is: { enrollments: { some: enrollmentWhere } } } };
    // A roster year filter scopes students, while teacher/admin rows remain
    // visible so the same page can manage teacher access for that year.
    filters.push(role === "STUDENT" ? studentScope : role ? {} : { OR: [{ role: { not: "STUDENT" } }, studentScope] });
  }
  if (cursor) filters.push({ OR: [{ accountName: { gt: cursor.accountName } }, { accountName: cursor.accountName, id: { gt: cursor.id } }] });
  const baseWhere: Prisma.UserWhereInput = filters.length ? { AND: filters } : {};
  const query = await prisma.user.findMany({
    where: baseWhere,
    select: USER_SELECT,
    orderBy: [{ accountName: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const hasNext = query.length > limit;
  const items = (hasNext ? query.slice(0, limit) : query).map(serializeUser);
  const last = items.at(-1);
  return NextResponse.json({ items, nextCursor: hasNext && last ? encodeCursor({ accountName: last.accountName, id: last.id }) : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !isRole(body.role)) return NextResponse.json({ code: "ROLE_INVALID" }, { status: 422 });
  const role: Role = body.role;
  const accountName = normalizeAccountName(String(body.accountName ?? ""));
  const accountError = accountNameError(accountName);
  if (accountError) return NextResponse.json({ code: "ACCOUNT_INVALID", detail: accountError }, { status: 422 });
  const legalName = normalizeLegalName(String(body.legalName ?? body.name ?? ""));
  const nameError = legalNameError(legalName);
  if (role !== ROLES.ADMIN && nameError) return NextResponse.json({ code: "LEGAL_NAME_INVALID", detail: nameError }, { status: 422 });
  const rawContact = String(body.contactEmail ?? "");
  const emailError = contactEmailError(rawContact);
  if (emailError) return NextResponse.json({ code: "CONTACT_EMAIL_INVALID" }, { status: 422 });
  const contactEmail = normalizeContactEmail(rawContact);
  let grade: ReturnType<typeof parseStudentGrade> = null;
  let classCode: ReturnType<typeof parseClassCode> = null;
  let academicYearId = "";
  if (role === ROLES.STUDENT) {
    grade = parseStudentGrade(body.grade);
    academicYearId = typeof body.academicYearId === "string" ? body.academicYearId : "";
    if (!grade || !academicYearId) return NextResponse.json({ code: "STUDENT_YEAR_GRADE_REQUIRED" }, { status: 422 });
    classCode = parseClassCode(body.classCode);
    if (body.classCode && !classCode) return NextResponse.json({ code: "CLASS_INVALID" }, { status: 422 });
  }
  const nickname = role === ROLES.STUDENT ? validateNicknameAgainstIdentity(String(body.nickname ?? ""), { legalName, accountName, contactEmail }) : null;
  if (nickname && !nickname.ok) return NextResponse.json({ code: "NICKNAME_INVALID", detail: nickname.error }, { status: 422 });
  const generatedPassword = !String(body.password ?? "");
  const password = generatedPassword ? generateTemporaryPassword() : String(body.password);
  const policyError = passwordPolicyError(password);
  if (policyError) return NextResponse.json({ code: "PASSWORD_INVALID" }, { status: 422 });
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    const user = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      await lockRosterIdentityKeys(tx, [accountName, contactEmail]);
      const year = role === ROLES.STUDENT ? await tx.academicYear.findUnique({ where: { id: academicYearId } }) : null;
      if (role === ROLES.STUDENT && (!year || year.status === "CLOSED")) throw new Error("ACADEMIC_YEAR_READ_ONLY");
      if (role === ROLES.STUDENT && year?.status === "PLANNED") {
        const current = await tx.academicYear.findFirst({ where: { status: "CURRENT" } });
        const successor = current ? await tx.academicYear.findFirst({ where: { status: "PLANNED", startsOn: { gt: current.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } }) : null;
        if (!current || successor?.id !== year.id) throw new Error("ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR");
      }
      const schoolClass = role === ROLES.STUDENT && classCode && grade && year
        ? await tx.schoolClass.findFirst({ where: { academicYearId: year.id, grade, classCode, active: true } })
        : null;
      if (role === ROLES.STUDENT && classCode && !schoolClass) throw new Error("CLASS_NOT_FOUND");
      const created = await tx.user.create({ data: {
        accountName, accountNameCanonical: accountName, contactEmail, contactEmailCanonical: contactEmail, legacyName: legalName || null, role,
        ...passwordCredentialCreateData({ passwordHash, mustChangePassword: role !== ROLES.ADMIN }),
        ...(role === ROLES.STUDENT && year && grade && nickname?.ok ? { studentProfile: { create: { legalName, nickname: nickname.value, nicknameNormalized: nickname.normalized, moderationPolicyVersion: "nickname-v1", enrollments: { create: { academicYearId: year.id, grade, classId: schoolClass?.id ?? null, isCurrent: year.status === "CURRENT", status: year.status === "CURRENT" ? "ACTIVE" : "PLANNED", origin: "MANUAL", startedAt: year.status === "CURRENT" ? new Date() : null } } } } } : {}),
        ...(role === ROLES.TEACHER ? { teacherProfile: { create: { legalName } } } : {}),
      }, select: USER_SELECT });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectUserId: created.id, subjectAccount: created.accountName, eventType: "USER_CREATED", ip: getClientIp(req.headers), metadata: { role: created.role } }) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ...serializeUser(user), ...(generatedPassword ? { temporaryPassword: password } : {}) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && ["ACADEMIC_YEAR_READ_ONLY", "CLASS_NOT_FOUND", "ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR"].includes(error.message)) return NextResponse.json({ code: error.message }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ code: "ACCOUNT_OR_EMAIL_EXISTS" }, { status: 409 });
    return NextResponse.json({ code: "USER_CREATE_FAILED" }, { status: 409 });
  }
}
