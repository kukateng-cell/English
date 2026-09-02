import test from "node:test";
import assert from "node:assert/strict";
import { passwordPolicyError } from "./password-policy";

test("password policy rejects bcrypt byte truncation", () => {
  assert.equal(passwordPolicyError("short"), "密碼至少 8 個字元");
  assert.equal(passwordPolicyError("a".repeat(72)), null);
  assert.equal(
    passwordPolicyError("密".repeat(25)),
    "密碼的 UTF-8 編碼不可超過 72 bytes",
  );
});
