import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hashSessionJti } from "@/lib/recent-auth";

const VERSION = "v1";
const AAD = Buffer.from("teacher-reset-precondition:v1", "utf8");
const TTL_MS = 5 * 60_000;
const KEY_BYTES = 32;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type TeacherResetPrecondition = {
  targetId: string;
  actorId: string;
  sessionJtiHash: string;
  targetTokenVersion: number;
  targetCredentialRevision: number;
  actorAccessRevision: number | null;
  issuedAt: number;
  expiresAt: number;
};

export type TeacherResetPreconditionInput = Omit<
  TeacherResetPrecondition,
  "issuedAt" | "expiresAt" | "sessionJtiHash"
> & { sessionJti: string; now?: number };

export class TeacherResetPreconditionError extends Error {
  constructor(public readonly code: "RESET_PRECONDITION_INVALID" | "RESET_PRECONDITION_UNAVAILABLE") {
    super(code);
  }
}

type KeySlot = { id: string; key: Buffer };

function decodeKey(value: string, name: string): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  if (decoded.length !== KEY_BYTES) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  void name;
  return decoded;
}

function keySlot(materialValue: string | undefined, id: string | undefined, required: boolean): KeySlot | null {
  if (!materialValue && !id) {
    if (required) throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
    return null;
  }
  if (!materialValue || !id || !ID_PATTERN.test(id)) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  const material = decodeKey(materialValue, id);
  const key = Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), AAD, KEY_BYTES));
  return { id, key };
}

function keyring(): { current: KeySlot; previous: KeySlot | null } {
  const current = keySlot(
    process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT,
    process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID,
    true,
  );
  const previous = keySlot(
    process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS,
    process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID,
    false,
  );
  if (!current) throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  if (previous && previous.id === current.id) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_UNAVAILABLE");
  }
  return { current, previous };
}

function encodePayload(payload: TeacherResetPrecondition) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function parsePayload(value: Buffer, now: number): TeacherResetPrecondition {
  let parsed: Partial<TeacherResetPrecondition>;
  try {
    parsed = JSON.parse(value.toString("utf8")) as Partial<TeacherResetPrecondition>;
  } catch {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  if (
    typeof parsed.targetId !== "string" || typeof parsed.actorId !== "string" ||
    typeof parsed.sessionJtiHash !== "string" || typeof parsed.targetTokenVersion !== "number" ||
    typeof parsed.targetCredentialRevision !== "number" ||
    (parsed.actorAccessRevision !== null && typeof parsed.actorAccessRevision !== "number") ||
    typeof parsed.issuedAt !== "number" || typeof parsed.expiresAt !== "number" ||
    parsed.expiresAt <= parsed.issuedAt || parsed.expiresAt - parsed.issuedAt > TTL_MS ||
    parsed.expiresAt <= now || parsed.issuedAt > now + 30_000
  ) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  return parsed as TeacherResetPrecondition;
}

export function issueTeacherResetPrecondition(input: TeacherResetPreconditionInput): string {
  const now = input.now ?? Date.now();
  const { current } = keyring();
  const payload: TeacherResetPrecondition = {
    targetId: input.targetId,
    actorId: input.actorId,
    sessionJtiHash: hashSessionJti(input.sessionJti),
    targetTokenVersion: input.targetTokenVersion,
    targetCredentialRevision: input.targetCredentialRevision,
    actorAccessRevision: input.actorAccessRevision,
    issuedAt: now,
    expiresAt: now + TTL_MS,
  };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(encodePayload(payload)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, current.id, nonce.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

function decodePart(value: string): Buffer {
  if (!value || value.length > 8192) throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
}

export function readTeacherResetPrecondition(token: string, now = Date.now()): TeacherResetPrecondition {
  if (typeof token !== "string" || token.length > 16 * 1024) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION || !ID_PATTERN.test(parts[1])) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  const { current, previous } = keyring();
  const slot = parts[1] === current.id ? current : parts[1] === previous?.id ? previous : null;
  if (!slot) throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  const nonce = decodePart(parts[2]);
  const ciphertext = decodePart(parts[3]);
  const tag = decodePart(parts[4]);
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", slot.key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return parsePayload(Buffer.concat([decipher.update(ciphertext), decipher.final()]), now);
  } catch (error) {
    if (error instanceof TeacherResetPreconditionError) throw error;
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
}

export function assertTeacherResetPrecondition(
  payload: TeacherResetPrecondition,
  input: { actorId: string; targetId: string; sessionJti: string },
) {
  const expectedSession = hashSessionJti(input.sessionJti);
  const sameSession = Buffer.from(payload.sessionJtiHash, "utf8");
  const actualSession = Buffer.from(expectedSession, "utf8");
  if (
    payload.actorId !== input.actorId || payload.targetId !== input.targetId ||
    sameSession.length !== actualSession.length || !timingSafeEqual(sameSession, actualSession)
  ) {
    throw new TeacherResetPreconditionError("RESET_PRECONDITION_INVALID");
  }
  return payload;
}

export function teacherResetPreconditionTtlMs() {
  return TTL_MS;
}
