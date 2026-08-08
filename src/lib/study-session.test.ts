import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STUDY_SESSION_WORDS,
  canResumeStudySession,
} from "./study-session";

test("resume signatures share the same hard limit as generated study queues", () => {
  assert.equal(canResumeStudySession(["one"]), true);
  assert.equal(
    canResumeStudySession(
      Array.from({ length: MAX_STUDY_SESSION_WORDS }, (_, i) => String(i)),
    ),
    true,
  );
  assert.equal(
    canResumeStudySession(
      Array.from(
        { length: MAX_STUDY_SESSION_WORDS + 1 },
        (_, i) => String(i),
      ),
    ),
    false,
  );
  assert.equal(canResumeStudySession(null), false);
  assert.equal(canResumeStudySession("word-1"), false);
  assert.equal(canResumeStudySession(["dup", "dup"]), false);
  assert.equal(canResumeStudySession(["bad,id"]), false);
});
