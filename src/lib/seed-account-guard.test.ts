import assert from "node:assert/strict";
import test from "node:test";
import { assertSeedAccountRole } from "./seed-account-guard";

test("reserved account guard refuses privilege takeover without changing credentials or profile", () => {
  const existing = Object.freeze({ role: "STUDENT", passwordHash: "known-password-hash", tokenVersion: 7, profile: Object.freeze({ legalName: "原有學生" }) });
  const before = structuredClone(existing);
  for (const [name, role] of [["admin", "ADMIN"], ["teacher", "TEACHER"], ["teacher-reset", "TEACHER"]]) {
    assert.throws(() => assertSeedAccountRole(existing, role, name), /SEED_RESERVED_ACCOUNT_ROLE_CONFLICT/);
    assert.deepEqual(existing, before);
  }
  assert.doesNotThrow(() => assertSeedAccountRole(null, "ADMIN", "admin"));
  assert.doesNotThrow(() => assertSeedAccountRole({ role: "ADMIN" }, "ADMIN", "admin"));
});
