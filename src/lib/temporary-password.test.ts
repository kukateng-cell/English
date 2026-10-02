import test from "node:test";
import assert from "node:assert/strict";
import { passwordPolicyError } from "./password-policy";
import { generateTemporaryPassword } from "./temporary-password";

test("temporary passwords are policy compliant and non-repeating", () => {
  const passwords = new Set(
    Array.from({ length: 100 }, () => generateTemporaryPassword()),
  );
  assert.equal(passwords.size, 100);
  for (const password of passwords) {
    assert.equal(passwordPolicyError(password), null);
    assert.equal(password.length, 10);
    assert.match(password, /^[a-hj-km-np-z2-9]+$/);
  }
});
