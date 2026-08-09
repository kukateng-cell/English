import test from "node:test";
import assert from "node:assert/strict";
import { passwordPolicyError } from "./password-policy";

test("password policy rejects bcrypt byte truncation", () => {
  assert.equal(passwordPolicyError("short"), "密码至少 8 个字符");
  assert.equal(passwordPolicyError("a".repeat(72)), null);
  assert.equal(
    passwordPolicyError("密".repeat(25)),
    "密码的 UTF-8 编码不可超过 72 bytes",
  );
});
