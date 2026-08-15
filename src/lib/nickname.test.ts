import assert from "node:assert/strict";
import test from "node:test";
import { validateNickname, validateNicknameAgainstIdentity } from "./nickname";

test("nickname normalization preserves readable identity text", () => {
  assert.deepEqual(validateNickname("  阿  明  "), {
    ok: true,
    value: "阿 明",
    normalized: "阿明",
  });
});

test("nickname rejects invisible characters and contact details", () => {
  assert.equal(validateNickname("阿\u200B明").ok, false);
  assert.equal(validateNickname("student@example.com").ok, false);
  assert.equal(validateNickname("+852 6123 4567").ok, false);
});

test("nickname rejects reserved and clearly inappropriate names", () => {
  assert.equal(validateNickname("管理員").ok, false);
  assert.equal(validateNickname("f.u.c.k").ok, false);
});

test("nickname accepts duplicate-safe ordinary Chinese and English names", () => {
  assert.equal(validateNickname("星 河 7").ok, true);
  assert.equal(validateNickname("Sunny-01").ok, true);
});

test("nickname cannot reveal the student's legal or login identity", () => {
  assert.equal(
    validateNicknameAgainstIdentity("李小明", {
      legalName: "李小明",
      accountName: "001234",
      contactEmail: "li@example.com",
    }).ok,
    false,
  );
  assert.equal(
    validateNicknameAgainstIdentity("001234", {
      legalName: "李小明",
      accountName: "001234",
      contactEmail: "li@example.com",
    }).ok,
    false,
  );
  assert.equal(
    validateNicknameAgainstIdentity("小星星", {
      legalName: "李小明",
      accountName: "001234",
      contactEmail: "li@example.com",
    }).ok,
    true,
  );
});
