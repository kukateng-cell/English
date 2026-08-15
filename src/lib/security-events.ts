import { createHmac } from "node:crypto";
import type { Prisma, SecurityEventType } from "@/generated/prisma";

export const RECENT_AUTHENTICATION_MS = 15 * 60_000;

export function hasRecentAuthentication(authenticatedAt?: number): boolean {
  return Boolean(
    authenticatedAt &&
      authenticatedAt <= Date.now() &&
      Date.now() - authenticatedAt <= RECENT_AUTHENTICATION_MS,
  );
}

function auditSecret() {
  // Keep audit pseudonyms stable when the JWT signing secret rotates.
  const secret = process.env.SECURITY_AUDIT_HMAC_SECRET ?? process.env.SECURITY_AUDIT_HASH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY_AUDIT_HASH_SECRET is required for security audit hashing",
    );
  }
  return "development-only-security-audit-secret";
}

export function auditKeyVersion(): string {
  return process.env.SECURITY_AUDIT_HMAC_KEY_ID ?? process.env.SECURITY_AUDIT_HASH_KEY_ID ?? "v1-development";
}

export function hashSecurityAuditValue(value: string): string {
  return createHmac("sha256", auditSecret())
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function stableSubjectKey(userId: string): string {
  return `uid-v1:${hashSecurityAuditValue(userId)}`;
}

export function securityEventData(input: {
  actorUserId?: string | null;
  subjectUserId?: string | null;
  /** Stable pseudonym source when the subject relation may disappear mid-audit. */
  subjectStableId?: string | null;
  subjectAccount: string;
  eventType: SecurityEventType;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
  actorPseudonym?: string | null;
  hmacKeyVersion?: string | null;
}): Prisma.SecurityEventCreateInput {
  return {
    eventType: input.eventType,
    subjectAccountHash: input.subjectStableId || input.subjectUserId
      ? stableSubjectKey(input.subjectStableId ?? input.subjectUserId!)
      : `account-v1:${hashSecurityAuditValue(input.subjectAccount)}`,
    subjectPseudonym: input.subjectStableId || input.subjectUserId
      ? stableSubjectKey(input.subjectStableId ?? input.subjectUserId!)
      : `account-v1:${hashSecurityAuditValue(input.subjectAccount)}`,
    ipHash: input.ip ? hashSecurityAuditValue(input.ip) : null,
    ipPseudonym: input.ip ? `ip-v1:${hashSecurityAuditValue(input.ip)}` : null,
    actorPseudonym:
      input.actorPseudonym ??
      (input.actorUserId ? `actor-v1:${hashSecurityAuditValue(input.actorUserId)}` : null),
    hmacKeyVersion: input.hmacKeyVersion ?? auditKeyVersion(),
    metadata: input.metadata,
    actor: input.actorUserId
      ? { connect: { id: input.actorUserId } }
      : undefined,
    subject: input.subjectUserId
      ? { connect: { id: input.subjectUserId } }
      : undefined,
  };
}
