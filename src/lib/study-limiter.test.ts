import test from "node:test";
import assert from "node:assert/strict";
import { checkStudyRate, resetStudyLimiterForTests } from "./study-limiter";

test("study event limiter is scoped per authenticated user", async () => {
  resetStudyLimiterForTests();
  for (let i = 0; i < 90; i++) {
    assert.equal((await checkStudyRate("user-a")).ok, true);
  }
  assert.equal((await checkStudyRate("user-a")).ok, false);
  assert.equal((await checkStudyRate("user-b")).ok, true);
  resetStudyLimiterForTests();
});
