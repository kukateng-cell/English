import test from "node:test";
import assert from "node:assert/strict";
import {
  hasRecentAuthentication,
  hashSecurityAuditValue,
  securityEventData,
} from "./security-events";

test("recent authentication expires after fifteen minutes", () => {
  const originalNow = Date.now;
  Date.now = () => 1_000_000;
  try {
    assert.equal(hasRecentAuthentication(1_000_000 - 14 * 60_000), true);
    assert.equal(hasRecentAuthentication(1_000_000 - 16 * 60_000), false);
    assert.equal(hasRecentAuthentication(1_000_001), false);
  } finally {
    Date.now = originalNow;
  }
});

test("linked audit subjects use a stable non-account pseudonym", () => {
  const event = securityEventData({
    actorUserId: "actor-id",
    subjectUserId: "cm-subject-random-id",
    subjectAccount: "predictable-student01",
    eventType: "PASSWORD_CHANGED",
  });
  assert.match(event.subjectAccountHash, /^uid-v1:[a-f0-9]{64}$/);
  assert.doesNotMatch(event.subjectAccountHash, /student01/);
});

test("security audit hashes normalize account identifiers", () => {
  assert.equal(hashSecurityAuditValue(" Admin "), hashSecurityAuditValue("admin"));
});

test("security audit hashes are independent from JWT secret rotation", () => {
  const previousAuditSecret = process.env.SECURITY_AUDIT_HASH_SECRET;
  const previousAuthSecret = process.env.NEXTAUTH_SECRET;
  try {
    process.env.SECURITY_AUDIT_HASH_SECRET = "stable-audit-secret-12345678901234567890";
    process.env.NEXTAUTH_SECRET = "jwt-secret-one";
    const first = hashSecurityAuditValue("student01");
    process.env.NEXTAUTH_SECRET = "jwt-secret-two";
    assert.equal(hashSecurityAuditValue("student01"), first);
  } finally {
    if (previousAuditSecret === undefined) {
      delete process.env.SECURITY_AUDIT_HASH_SECRET;
    } else {
      process.env.SECURITY_AUDIT_HASH_SECRET = previousAuditSecret;
    }
    if (previousAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousAuthSecret;
  }
});
