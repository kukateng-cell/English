import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hashSessionJti } from "@/lib/recent-auth";

export const PASSWORD_RESET_AUDIENCES = {
  ADMIN_USER_RESET: "ADMIN_USER_RESET",
  TEACHER_STUDENT_RESET: "TEACHER_STUDENT_RESET",
} as const;

export type PasswordResetAudience = (typeof PASSWORD_RESET_AUDIENCES)[keyof typeof PASSWORD_RESET_AUDIENCES];

const VERSION = "v2";
const TTL_MS = 5 * 60_000;
const KEY_BYTES = 32;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type PasswordResetPrecondition = {
  audience: PasswordResetAudience;
  actorId: string;
  actorRole: "ADMIN" | "TEACHER";
  targetId: string;
  targetRole: "STUDENT" | "TEACHER";
  sessionJtiHash: string;
  actorTokenVersion: number;
  actorCredentialRevision: number;
  targetTokenVersion: number;
  targetCredentialRevision: number;
  targetRevision: number;
  targetAccessRevision: number | null;
  grantReauthenticatedAt: number;
  grantExpiresAt: number;
  actorAccessRevision: number | null;
  issuedAt: number;
  expiresAt: number;
};

export type PasswordResetPreconditionInput = Omit<
  PasswordResetPrecondition,
  "sessionJtiHash" | "issuedAt" | "expiresAt"
> & { sessionJti: string; now?: number };

export class PasswordResetPreconditionError extends Error {
  constructor(public readonly code: "RESET_PRECONDITION_INVALID" | "RESET_PRECONDITION_UNAVAILABLE") {
    super(code);
  }
}

type KeySlot = { id: string; key: Buffer };

function audienceValue(audience: PasswordResetAudience) {
  return audience === PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET
    ? "admin-user"
    : "teacher-student";
}

function keyMaterial(audience: PasswordResetAudience, slot: "CURRENT" | "PREVIOUS") {
  const generic = process.env[`PASSWORD_RESET_PRECONDITION_KEY_${slot}`];
  const genericId = process.env[`PASSWORD_RESET_PRECONDITION_KEY_${slot}_ID`];
  if (generic || genericId) return { value: generic, id: genericId };

  // Development keeps the existing local setup usable while production
  // requires the explicit audience-neutral keyring through config checks.
  if (process.env.NODE_ENV !== "production" && audience === PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET) {
    return {
      value: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT,
      id: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID,
    };
  }
  return { value: undefined, id: undefined };
}

function keySlot(audience: PasswordResetAudience, slot: "CURRENT" | "PREVIOUS", required: boolean): KeySlot | null {
  const material = keyMaterial(audience, slot);
  if (!material.value && !material.id) {
    if (required) throw new PasswordResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
    return null;
  }
  if (!material.value || !material.id || !ID_PATTERN.test(material.id)) {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(material.value, "base64url");
  } catch {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  if (decoded.length !== KEY_BYTES) throw new PasswordResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  const aad = Buffer.from(`password-reset-precondition:${audienceValue(audience)}:${VERSION}`, "utf8");
  return { id: material.id, key: Buffer.from(hkdfSync("sha256", decoded, Buffer.alloc(0), aad, KEY_BYTES)) };
}

function keyring(audience: PasswordResetAudience) {
  const current = keySlot(audience, "CURRENT", true);
  const previous = keySlot(audience, "PREVIOUS", false);
  if (!current || previous?.id === current.id) throw new PasswordResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  return { current, previous };
}

function validateAudience(value: unknown): value is PasswordResetAudience {
  return value === PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET || value === PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET;
}

function encode(payload: PasswordResetPrecondition) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function parse(value: Buffer, now: number, expectedAudience: PasswordResetAudience): PasswordResetPrecondition {
  let parsed: Partial<PasswordResetPrecondition>;
  try {
    parsed = JSON.parse(value.toString("utf8")) as Partial<PasswordResetPrecondition>;
  } catch {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  const issuedAt = parsed.issuedAt;
  const expiresAt = parsed.expiresAt;
  const grantReauthenticatedAt = parsed.grantReauthenticatedAt;
  const grantExpiresAt = parsed.grantExpiresAt;
  if (
    parsed.audience !== expectedAudience || !validateAudience(parsed.audience) ||
    typeof parsed.actorId !== "string" || typeof parsed.targetId !== "string" || typeof parsed.sessionJtiHash !== "string" ||
    (parsed.actorRole !== "ADMIN" && parsed.actorRole !== "TEACHER") ||
    (parsed.targetRole !== "STUDENT" && parsed.targetRole !== "TEACHER") ||
    !Number.isInteger(parsed.actorTokenVersion) || !Number.isInteger(parsed.actorCredentialRevision) ||
    !Number.isInteger(parsed.targetTokenVersion) || !Number.isInteger(parsed.targetCredentialRevision) ||
    !Number.isInteger(parsed.targetRevision) ||
    (parsed.targetAccessRevision !== null && !Number.isInteger(parsed.targetAccessRevision)) ||
    !Number.isFinite(parsed.grantReauthenticatedAt) || !Number.isFinite(parsed.grantExpiresAt) ||
    (parsed.actorAccessRevision !== null && typeof parsed.actorAccessRevision !== "number") ||
    !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
    !Number.isFinite(grantReauthenticatedAt) || !Number.isFinite(grantExpiresAt)
  ) {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  const issuedAtNumber = issuedAt as number;
  const expiresAtNumber = expiresAt as number;
  const grantReauthenticatedAtNumber = grantReauthenticatedAt as number;
  const grantExpiresAtNumber = grantExpiresAt as number;
  if (
    expiresAtNumber <= issuedAtNumber || expiresAtNumber - issuedAtNumber > TTL_MS ||
    grantExpiresAtNumber <= grantReauthenticatedAtNumber || expiresAtNumber <= now || issuedAtNumber > now + 30_000
  ) {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  return parsed as PasswordResetPrecondition;
}

export function issuePasswordResetPrecondition(input: PasswordResetPreconditionInput): string {
  if (!validateAudience(input.audience)) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  const now = input.now ?? Date.now();
  const { current } = keyring(input.audience);
  const payload: PasswordResetPrecondition = {
    audience: input.audience,
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: input.targetId,
    targetRole: input.targetRole,
    sessionJtiHash: hashSessionJti(input.sessionJti),
    actorTokenVersion: input.actorTokenVersion,
    actorCredentialRevision: input.actorCredentialRevision,
    targetTokenVersion: input.targetTokenVersion,
    targetCredentialRevision: input.targetCredentialRevision,
    targetRevision: input.targetRevision,
    targetAccessRevision: input.targetAccessRevision,
    grantReauthenticatedAt: input.grantReauthenticatedAt,
    grantExpiresAt: input.grantExpiresAt,
    actorAccessRevision: input.actorAccessRevision,
    issuedAt: now,
    expiresAt: now + TTL_MS,
  };
  const nonce = randomBytes(12);
  const aad = Buffer.from(`password-reset-precondition:${audienceValue(input.audience)}:${VERSION}`, "utf8");
  const cipher = createCipheriv("aes-256-gcm", current.key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(encode(payload)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, current.id, nonce.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

function decodePart(value: string): Buffer {
  if (!value || value.length > 8192) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
}

export function readPasswordResetPrecondition(token: string, audience: PasswordResetAudience, now = Date.now()): PasswordResetPrecondition {
  if (typeof token !== "string" || token.length > 16 * 1024) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION || !ID_PATTERN.test(parts[1])) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  const { current, previous } = keyring(audience);
  const slot = parts[1] === current.id ? current : parts[1] === previous?.id ? previous : null;
  if (!slot) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  const nonce = decodePart(parts[2]);
  const ciphertext = decodePart(parts[3]);
  const tag = decodePart(parts[4]);
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", slot.key, nonce);
    decipher.setAAD(Buffer.from(`password-reset-precondition:${audienceValue(audience)}:${VERSION}`, "utf8"));
    decipher.setAuthTag(tag);
    return parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]), now, audience);
  } catch (error) {
    if (error instanceof PasswordResetPreconditionError) throw error;
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
}

export function assertPasswordResetPrecondition(
  payload: PasswordResetPrecondition,
  input: { audience: PasswordResetAudience; actorId: string; targetId: string; sessionJti: string },
) {
  if (payload.audience !== input.audience || payload.actorId !== input.actorId || payload.targetId !== input.targetId) {
    throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  const actual = Buffer.from(hashSessionJti(input.sessionJti), "utf8");
  const expected = Buffer.from(payload.sessionJtiHash, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new PasswordResetPreconditionError("RESET_PRECONDITION_INVALID");
  return payload;
}

export const passwordResetPreconditionTtlMs = () => TTL_MS;
