import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import {
  accountNameError,
  contactEmailError,
  legalNameError,
  normalizeAccountName,
  normalizeContactEmail,
  normalizeLegalName,
} from "@/lib/identity";
import { validateNicknameAgainstIdentity } from "@/lib/nickname";
import { parseRosterFile, type RosterCellRow } from "@/lib/roster-file";
import { parseClassReference, parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { lockRosterIdentityKeys, lockRosterMutationState } from "@/lib/roster-server";
import type { StagedRosterRow, StagedStudentRow, StagedTeacherRow } from "@/lib/roster-import-contract";
import { actorAuditFields } from "@/lib/admin-receipts";
import { securityEventData } from "@/lib/security-events";
import { getClientIp } from "@/lib/login-limiter";

function field(row: RosterCellRow, names: string[]) {
  for (const name of names) if (row[name] !== undefined) return row[name];
  return "";
}

const ACCOUNT_HEADERS = ["accountName", "studentNumber", "學生證號碼", "学生证号码", "帳號", "账号"];
const LEGAL_NAME_HEADERS = ["legalName", "真實姓名", "真实姓名", "姓名"];
const NICKNAME_HEADERS = ["nickname", "暱稱", "昵称"];
const GRADE_HEADERS = ["grade", "年級", "年级"];
const CLASS_HEADERS = ["classCode", "班別", "班别", "班級", "班级"];
const EMAIL_HEADERS = ["contactEmail", "email", "聯絡電郵", "联络电邮"];

function validateHeaders(rows: RosterCellRow[], entityType: "STUDENT" | "TEACHER") {
  const headers = Object.keys(rows[0] ?? {});
  const aliases = entityType === "STUDENT"
    ? [...ACCOUNT_HEADERS, ...LEGAL_NAME_HEADERS, ...NICKNAME_HEADERS, ...GRADE_HEADERS, ...CLASS_HEADERS, ...EMAIL_HEADERS]
    : [...ACCOUNT_HEADERS, ...LEGAL_NAME_HEADERS, ...EMAIL_HEADERS, "templateVersion", "classAccess", "班級權限", "班级权限", "resetPasswordAccess", "canResetStudentPassword", "resetPasswordCapability", "重設密碼權限", "可重設密碼", "可重设密码"];
  const allowed = new Set(aliases);
  const unknown = headers.filter((header) => !allowed.has(header));
  if (unknown.length) throw new Error("ROSTER_HEADER_UNKNOWN");
  const teacherV2 = entityType === "TEACHER" && headers.includes("templateVersion");
  if (teacherV2 && (headers.length !== 6 || !["templateVersion", "accountName", "legalName", "contactEmail", "classAccess", "resetPasswordCapability"].every((header) => headers.includes(header)))) throw new Error("ROSTER_HEADER_REQUIRED");
  const required = entityType === "STUDENT"
    ? [ACCOUNT_HEADERS, LEGAL_NAME_HEADERS, NICKNAME_HEADERS, GRADE_HEADERS]
    : [ACCOUNT_HEADERS, LEGAL_NAME_HEADERS];
  const semanticGroups = entityType === "STUDENT"
    ? [ACCOUNT_HEADERS, LEGAL_NAME_HEADERS, NICKNAME_HEADERS, GRADE_HEADERS, CLASS_HEADERS, EMAIL_HEADERS]
    : [ACCOUNT_HEADERS, LEGAL_NAME_HEADERS, EMAIL_HEADERS, ["classAccess", "班級權限", "班级权限"], ["resetPasswordCapability", "resetPasswordAccess", "canResetStudentPassword", "重設密碼權限", "可重設密碼", "可重设密码"]];
  if (semanticGroups.some((group) => headers.filter((header) => group.includes(header)).length > 1)) {
    throw new Error("ROSTER_HEADER_DUPLICATE");
  }
  if (required.some((group) => !headers.some((header) => group.includes(header)))) {
    throw new Error("ROSTER_HEADER_REQUIRED");
  }
}

function parseAccess(value: string) {
  const accessClear = value.trim() === "__CLEAR__";
  if (accessClear) value = "";
  const errors: string[] = [];
  const access = value.split(/[|,;，；]+/u).map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const parsed = parseClassReference(part);
    if (!parsed) {
      errors.push(`无法识别班级权限「${part}」`);
      return [];
    }
    return [parsed];
  });
  return { access, errors, accessClear };
}

function parseTeacherReset(value: string, templateVersion: "teacher-roster-v2" | "v1") {
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined, error: null };
  if (templateVersion === "v1") return { value: undefined, error: "LEGACY_RESET_SCOPE_UNSUPPORTED" };
  if (!/^(true|false)$/iu.test(trimmed)) return { value: undefined, error: "resetPasswordCapability 必须为 TRUE 或 FALSE" };
  return { value: trimmed.toLowerCase() === "true", error: null };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const PREVIEW_PAGE_SIZE = 50;
const PREVIEW_VALIDATION_CODES = new Set([
  "ROSTER_FILE_EMPTY",
  "ROSTER_FORMAT_INVALID",
  "ROSTER_HEADER_UNKNOWN",
  "ROSTER_HEADER_REQUIRED",
  "ROSTER_HEADER_DUPLICATE",
  "ACADEMIC_YEAR_REQUIRED",
  "ACADEMIC_YEAR_READ_ONLY",
  "ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR",
]);

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    const entityType = form.get("entityType") === "TEACHER" ? "TEACHER" : "STUDENT";
    const mergeMode = form.get("mergeMode") === "true" || form.get("mode") === "MERGE";
    const academicYearId = String(form.get("academicYearId") ?? "").trim();
    const operationId = String(form.get("operationId") ?? randomUUID()).trim();
    if (!(file instanceof File)) return NextResponse.json({ code: "ROSTER_FILE_REQUIRED" }, { status: 422 });
    if (!academicYearId) return NextResponse.json({ code: "ACADEMIC_YEAR_REQUIRED" }, { status: 422 });
    const lowerName = file.name.toLowerCase();
    const format = lowerName.endsWith(".csv") ? "CSV" : lowerName.endsWith(".xlsx") ? "XLSX" : null;
    if (!format) return NextResponse.json({ code: "ROSTER_FORMAT_INVALID" }, { status: 422 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const rows = await parseRosterFile(bytes, format);
    if (!rows.length) return NextResponse.json({ code: "ROSTER_FILE_EMPTY" }, { status: 422 });
    validateHeaders(rows, entityType);
    const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!year || year.status === "CLOSED") return NextResponse.json({ code: "ACADEMIC_YEAR_READ_ONLY" }, { status: 409 });
    const classes = await prisma.schoolClass.findMany({ where: { academicYearId, active: true }, select: { id: true, grade: true, classCode: true } });
    if (entityType === "STUDENT" && year.status === "PLANNED") {
      const current = await prisma.academicYear.findFirst({ where: { status: "CURRENT" } });
      const successors = current ? await prisma.academicYear.findMany({ where: { status: "PLANNED", startsOn: { gt: current.endsOn } }, orderBy: [{ startsOn: "asc" }, { id: "asc" }], select: { id: true } }) : [];
      if (!current || successors[0]?.id !== year.id) return NextResponse.json({ code: "ACADEMIC_YEAR_NOT_IMMEDIATE_SUCCESSOR" }, { status: 422 });
    }
    const classMap = new Map(classes.map((item) => [`${item.grade}:${item.classCode}`, item]));
    const accountSeen = new Set<string>();
    const emailSeen = new Set<string>();
    const accounts = rows.map((row) => normalizeAccountName(field(row, ACCOUNT_HEADERS))).filter(Boolean);
    const contactEmails = rows.map((row) => normalizeContactEmail(field(row, EMAIL_HEADERS))).filter((value): value is string => value !== null);
    const existing = await prisma.user.findMany({
      where: { OR: [{ accountName: { in: accounts } }, { accountNameCanonical: { in: accounts } }, { contactEmail: { in: contactEmails } }, { contactEmailCanonical: { in: contactEmails } }] },
      select: {
        id: true, accountName: true, accountNameCanonical: true, contactEmail: true, contactEmailCanonical: true, role: true,
        studentProfile: { select: { legalName: true, nickname: true, nicknameNormalized: true, enrollments: { where: { academicYearId }, select: { id: true, grade: true, classId: true, status: true, schoolClass: { select: { classCode: true } } } } } },
        teacherProfile: { select: { legalName: true, canResetStudentPassword: true, classAccess: { where: { schoolClass: { academicYearId } }, select: { classId: true, canViewProgress: true, schoolClass: { select: { grade: true, classCode: true } } } } } },
      },
    });
    const existingByAccount = new Map(existing.flatMap((user) => [[user.accountName, user], ...(user.accountNameCanonical ? [[user.accountNameCanonical, user] as const] : [])]));
    const existingByContact = new Map(existing.flatMap((user) => [
      ...(user.contactEmail ? [[user.contactEmail, user] as const] : []),
      ...(user.contactEmailCanonical ? [[user.contactEmailCanonical, user] as const] : []),
    ]));
    const staged: StagedRosterRow[] = rows.map((row, index) => {
      const rowNumber = index + 2;
      const errors: string[] = [];
      const accountName = normalizeAccountName(field(row, ACCOUNT_HEADERS));
      const accountError = accountNameError(accountName);
      if (accountError) errors.push(accountError);
      if (accountSeen.has(accountName)) errors.push("档案内账号重复");
      accountSeen.add(accountName);
      const existingUser = existingByAccount.get(accountName);
      const legalName = normalizeLegalName(field(row, LEGAL_NAME_HEADERS));
      const nameError = legalNameError(legalName);
      if (nameError) errors.push(nameError);
      if (mergeMode && existingUser && !legalName) errors.push("MERGE 必须提供真实姓名");
      const rawEmail = field(row, EMAIL_HEADERS);
      const contactEmail = rawEmail.trim() === "__CLEAR__" ? null : normalizeContactEmail(rawEmail);
      const mailError = rawEmail.trim() === "__CLEAR__" ? null : contactEmailError(rawEmail);
      if (mailError) errors.push(mailError);
      if (contactEmail && emailSeen.has(contactEmail)) errors.push("档案内联络 Email 重复");
      if (contactEmail) emailSeen.add(contactEmail);
      const emailOwner = contactEmail ? existingByContact.get(contactEmail) : undefined;
      if (emailOwner && emailOwner.accountName !== accountName) errors.push("联络 Email 已被其他账号使用");
      if (existingUser && existingUser.role !== entityType) errors.push("账号已属于其他角色");
      if (existingUser && existingUser.role === entityType && !mergeMode) errors.push("账号已经存在；create-only 不会覆盖");
      const baseAction = existingUser ? "UPDATE" : "CREATE";
      if (entityType === "STUDENT") {
        const rawNickname = field(row, NICKNAME_HEADERS);
        const nickname = validateNicknameAgainstIdentity(rawNickname, { legalName, accountName, contactEmail });
        if (!nickname.ok) errors.push(nickname.error);
        if (mergeMode && existingUser && !rawNickname) errors.push("MERGE 必须提供昵称");
        const grade = parseStudentGrade(field(row, GRADE_HEADERS));
        if (!grade) errors.push("年级必须为初一至高三");
        const rawClass = field(row, CLASS_HEADERS);
        const classCode = parseClassCode(rawClass);
        if (rawClass && !classCode) errors.push("班别必须为甲至辛");
        if (classCode && !classMap.has(`${grade}:${classCode}`)) errors.push("所选学年不存在该班级，请先建立班级");
        if (existingUser && existingUser.role === entityType && !existingUser.studentProfile) errors.push("学生资料不完整");
        const currentEnrollment = existingUser?.studentProfile?.enrollments[0];
        if (mergeMode && existingUser && !classCode && currentEnrollment && year.status === "CURRENT") {
          // blank preserves the selected-year class for an existing enrollment
        }
        const contactEmailAction = existingUser && !rawEmail ? "PRESERVE" : rawEmail.trim() === "__CLEAR__" ? "CLEAR" : "SET";
        if (existingUser && mergeMode && currentEnrollment && currentEnrollment.grade !== grade && !classCode) errors.push("年级改变时必须同时提供新年级班别或明确未分班");
        const diff = existingUser?.studentProfile ? {
          legalName: { before: existingUser.studentProfile.legalName, after: legalName || existingUser.studentProfile.legalName },
          nickname: { before: existingUser.studentProfile.nickname, after: nickname.ok ? nickname.value : existingUser.studentProfile.nickname },
          grade: { before: currentEnrollment?.grade ?? null, after: grade },
          classCode: { before: currentEnrollment?.schoolClass?.classCode ?? null, after: classCode ?? (currentEnrollment ? currentEnrollment.schoolClass?.classCode ?? null : null) },
        } : undefined;
        const sameSelectedYear = Boolean(existingUser?.studentProfile && currentEnrollment && currentEnrollment.grade === grade && (currentEnrollment.schoolClass?.classCode ?? null) === (classCode ?? (currentEnrollment.schoolClass?.classCode ?? null)));
        const unchanged = Boolean(mergeMode && existingUser?.studentProfile && !errors.length && existingUser.studentProfile.legalName === legalName && existingUser.studentProfile.nicknameNormalized === (nickname.ok ? nickname.normalized : "") && sameSelectedYear && contactEmailAction === "PRESERVE");
        const action = errors.length ? "ERROR" : unchanged ? "UNCHANGED" : baseAction;
        return { entityType, rowNumber, action, accountName, legalName, nickname: nickname.ok ? nickname.value : "", nicknameNormalized: nickname.ok ? nickname.normalized : "", contactEmail, contactEmailAction, grade, classCode, errors, diff } satisfies StagedStudentRow;
      }
      const rawTemplateVersion = field(row, ["templateVersion"]).trim().toLowerCase();
      const templateVersion = rawTemplateVersion === "teacher-roster-v2" ? "teacher-roster-v2" as const : "v1" as const;
      if (Object.prototype.hasOwnProperty.call(row, "templateVersion") && templateVersion !== "teacher-roster-v2") errors.push("templateVersion 必须为 teacher-roster-v2");
      const rawAccessField = field(row, ["classAccess", "班級權限", "班级权限"]);
      const rawResetField = field(row, ["resetPasswordCapability", "resetPasswordAccess", "canResetStudentPassword", "重設密碼權限", "可重設密碼", "可重设密码"]);
      const parsedAccess = parseAccess(rawAccessField);
      const parsedReset = parseTeacherReset(rawResetField, templateVersion);
      errors.push(...parsedAccess.errors);
      if (parsedReset.error) errors.push(parsedReset.error);
      if (templateVersion === "v1" && rawResetField.trim()) errors.push("LEGACY_RESET_SCOPE_UNSUPPORTED");
      for (const access of parsedAccess.access) if (!classMap.has(`${access.grade}:${access.classCode}`)) errors.push("所选学年不存在教师权限班级");
      const existingAccess = existingUser?.teacherProfile?.classAccess ?? [];
      const incomingAccess = parsedAccess.access.map((item) => `${item.grade}:${item.classCode}`).sort().join("|");
      const savedAccess = existingAccess.filter((item) => item.canViewProgress).map((item) => `${item.schoolClass.grade}:${item.schoolClass.classCode}`).sort().join("|");
      const contactEmailAction = existingUser && !rawEmail ? "PRESERVE" : rawEmail.trim() === "__CLEAR__" ? "CLEAR" : "SET";
      const resetUnchanged = parsedReset.value === undefined || parsedReset.value === existingUser?.teacherProfile?.canResetStudentPassword;
      const unchanged = Boolean(mergeMode && existingUser?.teacherProfile && !errors.length && existingUser.teacherProfile.legalName === legalName && contactEmailAction === "PRESERVE" && resetUnchanged && (parsedAccess.access.length ? incomingAccess === savedAccess : !rawAccessField));
      const action = errors.length ? "ERROR" : unchanged ? "UNCHANGED" : baseAction;
      const accessAction = existingUser && !rawAccessField ? "PRESERVE" : "REPLACE";
      return { entityType, rowNumber, action, accountName, legalName, contactEmail, contactEmailAction, templateVersion, canResetStudentPassword: parsedReset.value, access: parsedAccess.access, accessAction, errors } satisfies StagedTeacherRow;
    });
    const errorCount = staged.filter((row) => row.errors.length).length;
    const createCount = staged.filter((row) => row.action === "CREATE").length;
    const updateCount = staged.filter((row) => row.action === "UPDATE").length;
    const state = await prisma.rosterMutationState.findUnique({ where: { id: 1 } });
    if (!state) return NextResponse.json({ code: "ROSTER_STATE_MISSING" }, { status: 503 });
    const canonicalDigest = digest(staged);
    const fingerprint = digest({ academicYearId, yearRevision: year.revision, calendarRevision: state.calendarRevision, fileHash, operationId, entityType, mergeMode });
    const batch = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      await lockRosterIdentityKeys(tx, [...accounts, ...contactEmails]);
      const prior = await tx.rosterImportBatch.findUnique({ where: { actorUserId_operationId: { actorUserId: auth.userId, operationId } } });
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.canonicalDigest !== canonicalDigest) throw new Error("ROSTER_OPERATION_CONFLICT");
        return prior;
      }
      const created = await tx.rosterImportBatch.create({ data: { actorUserId: auth.userId, ...actorAuditFields(auth.userId), entityType, format, fileHash, operationId, academicYearId, mode: mergeMode ? "MERGE" : "CREATE_ONLY", fingerprint, canonicalDigest, rosterRevision: state.revision, calendarRevision: state.calendarRevision, rowCount: staged.length, createdCount: createCount, updatedCount: updateCount, errorCount, stagedRows: staged, summary: { mergeMode, yearRevision: year.revision }, expiresAt: new Date(Date.now() + 30 * 60_000) } });
      const userLinks = new Map<string, "TARGET" | "DEPENDENCY" | "EMAIL_OWNER">();
      for (const row of staged) {
        const target = existingByAccount.get(row.accountName);
        if (target) userLinks.set(target.id, "TARGET");
        const emailOwner = row.contactEmail ? existingByContact.get(row.contactEmail) : undefined;
        if (emailOwner && emailOwner.id !== target?.id) userLinks.set(emailOwner.id, "EMAIL_OWNER");
      }
      if (userLinks.size) await tx.rosterImportBatchUserLink.createMany({ data: [...userLinks].map(([userId, linkRole]) => ({ batchId: created.id, userId, linkRole })) });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: auth.userId, subjectAccount: `roster-preview:${created.id}`, eventType: "ROSTER_IMPORT_PREVIEWED", ip: getClientIp(req.headers), metadata: { batchId: created.id, entityType, academicYearId, rowCount: staged.length, errorCount } }) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const previewRows = staged.slice(0, PREVIEW_PAGE_SIZE);
    return NextResponse.json({ batchId: batch.id, operationId: batch.operationId, academicYearId, entityType, format, rowCount: staged.length, createCount: batch.createdCount, updateCount: batch.updatedCount, errorCount: batch.errorCount, canCommit: batch.status === "PREVIEWED" && batch.errorCount === 0, nextCursor: staged.length > PREVIEW_PAGE_SIZE ? String(PREVIEW_PAGE_SIZE) : null, rows: previewRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "";
    const code = rawCode === "ROSTER_OPERATION_CONFLICT"
      ? rawCode
      : PREVIEW_VALIDATION_CODES.has(rawCode)
        ? rawCode
        : /^(档案|名单|栏位|学生证|XLSX|CSV)/u.test(rawCode)
          ? "ROSTER_FILE_INVALID"
          : "ROSTER_PREVIEW_FAILED";
    return NextResponse.json({ code }, { status: code === "ROSTER_OPERATION_CONFLICT" ? 409 : code === "ROSTER_PREVIEW_FAILED" ? 503 : 422 });
  }
}
