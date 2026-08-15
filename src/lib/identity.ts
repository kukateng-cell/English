import type { Role } from "@/generated/prisma";
import { ROLES } from "@/lib/roles";

export const MIN_ACCOUNT_NAME_LENGTH = 1;
export const MAX_ACCOUNT_NAME_LENGTH = 64;
export const MAX_LEGAL_NAME_LENGTH = 80;
export const MAX_CONTACT_EMAIL_LENGTH = 254;

export function normalizeAccountName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function accountNameError(value: string): string | null {
  const normalized = normalizeAccountName(value);
  if (!normalized) return "账号不能为空";
  if (
    normalized.length < MIN_ACCOUNT_NAME_LENGTH ||
    normalized.length > MAX_ACCOUNT_NAME_LENGTH
  ) {
    return (
      "账号必须为 " +
      MIN_ACCOUNT_NAME_LENGTH +
      "–" +
      MAX_ACCOUNT_NAME_LENGTH +
      " 个字符"
    );
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    return "账号只可包含英文字母、数字、点、下划线或连字符";
  }
  return null;
}

export function normalizeLegalName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function legalNameError(value: string): string | null {
  const normalized = normalizeLegalName(value);
  if (!normalized) return "真实姓名不能为空";
  const graphemes = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(normalized)].length;
  if (graphemes > MAX_LEGAL_NAME_LENGTH) return "真实姓名过长";
  if (/[\p{Cc}\p{Cf}]/u.test(normalized)) {
    return "真实姓名包含不可见或控制字符";
  }
  return null;
}

export function normalizeContactEmail(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return normalized || null;
}

export function contactEmailError(value: string): string | null {
  const normalized = normalizeContactEmail(value);
  if (!normalized) return null;
  if (normalized.length > MAX_CONTACT_EMAIL_LENGTH) return "Email 过长";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Email 格式无效";
  }
  return null;
}

export function roleDisplayName(input: {
  role: Role;
  legacyName: string | null;
  accountName: string;
  studentProfile?: { nickname: string } | null;
  teacherProfile?: { legalName: string } | null;
}): string {
  if (input.role === ROLES.STUDENT) {
    return input.studentProfile?.nickname || "同学";
  }
  if (input.role === ROLES.TEACHER && input.teacherProfile?.legalName) {
    return input.teacherProfile.legalName;
  }
  return input.legacyName?.trim() || input.accountName;
}
