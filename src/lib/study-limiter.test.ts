import test from "node:test";
import assert from "node:assert/strict";
import {
  checkStudyQueueRate,
  checkStudyCredentialRate,
  checkStudyRate,
  resetStudyLimiterForTests,
} from "./study-limiter";

test("study event limiter is scoped per authenticated user", async () => {
  resetStudyLimiterForTests();
  for (let i = 0; i < 90; i++) {
    assert.equal((await checkStudyRate("user-a")).ok, true);
  }
  assert.equal((await checkStudyRate("user-a")).ok, false);
  assert.equal((await checkStudyRate("user-b")).ok, true);
  resetStudyLimiterForTests();
});

test("study credential renewal is capped per authenticated user", async () => {
  resetStudyLimiterForTests();
  for (let index = 0; index < 30; index++) {
    assert.equal(
      (await checkStudyCredentialRate("user-a", `203.0.113.${index}`)).ok,
      true,
    );
  }
  const blocked = await checkStudyCredentialRate("user-a", "203.0.113.99");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.dimension, "user");
  resetStudyLimiterForTests();
});

test("study queue loads are capped per authenticated user", async () => {
  resetStudyLimiterForTests();
  for (let index = 0; index < 60; index++) {
    assert.equal(
      (await checkStudyQueueRate("user-a", `198.51.100.${index}`)).ok,
      true,
    );
  }
  const blocked = await checkStudyQueueRate("user-a", "198.51.100.99");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.dimension, "user");
  assert.equal(
    (await checkStudyQueueRate("user-b", "198.51.100.99")).ok,
    true,
  );
  resetStudyLimiterForTests();
});
