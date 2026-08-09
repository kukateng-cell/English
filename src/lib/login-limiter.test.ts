import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetForTests,
  checkLimit,
  getClientIp,
} from "./login-limiter";

test("getClientIp supports Web Headers and plain NextAuth records", () => {
  assert.equal(
    getClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    "203.0.113.7",
  );
  assert.equal(
    getClientIp({ "x-real-ip": "198.51.100.4" }),
    "198.51.100.4",
  );
});

test("a blocked IP cannot consume another account's quota", async () => {
  __resetForTests();
  const blockedIp = "203.0.113.10";
  for (let index = 0; index < 120; index++) {
    assert.equal(
      (await checkLimit(`spray-${index}`, blockedIp)).ok,
      true,
    );
  }

  for (let index = 0; index < 5; index++) {
    const blocked = await checkLimit("student-target", blockedIp);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.dimension, "ip");
  }

  for (let index = 0; index < 5; index++) {
    assert.equal(
      (await checkLimit("student-target", `198.51.100.${index}`)).ok,
      true,
    );
  }
  const accountBlocked = await checkLimit("student-target", "198.51.100.99");
  assert.equal(accountBlocked.ok, false);
  assert.equal(accountBlocked.dimension, "account");
  __resetForTests();
});
