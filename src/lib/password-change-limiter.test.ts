import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPasswordChangeLimit,
  recordPasswordChangeFailure,
  resetPasswordChangeLimiterForTests,
} from "./password-change-limiter";

test("password verification attempts are capped per user", async () => {
  resetPasswordChangeLimiterForTests();
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(
      (await checkPasswordChangeLimit("user-a", `198.51.100.${attempt}`)).ok,
      true,
    );
  }
  const blocked = await checkPasswordChangeLimit("user-a", "198.51.100.99");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.dimension, "user");
  assert.equal(
    (await checkPasswordChangeLimit("user-b", "198.51.100.99")).ok,
    true,
  );
  resetPasswordChangeLimiterForTests();
});

test("failed password checks impose exponential backoff", async () => {
  resetPasswordChangeLimiterForTests();
  assert.equal(await recordPasswordChangeFailure("user-backoff"), 1);
  const blocked = await checkPasswordChangeLimit("user-backoff", "203.0.113.5");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.dimension, "backoff");
  assert.equal(blocked.retryAfterSec, 1);
  resetPasswordChangeLimiterForTests();
});
