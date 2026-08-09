import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STUDY_SESSION_WORDS,
  canResumeStudySession,
  canReuseResumeSession,
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

test("resume provenance cannot strip retirement or operation binding", () => {
  const now = Date.parse("2026-08-09T00:00:00Z");
  const source = {
    expiresAt: new Date(now + 10 * 60_000),
    retiredAt: null,
    items: [
      {
        wordId: "word-1",
        usedAt: null,
        renewedAt: null,
        operationId: null,
      },
    ],
  };
  assert.equal(canReuseResumeSession(source, ["word-1"], now), true);
  assert.equal(
    canReuseResumeSession(
      { ...source, retiredAt: new Date(now) },
      ["word-1"],
      now,
    ),
    false,
  );
  assert.equal(
    canReuseResumeSession(
      {
        ...source,
        items: [{ ...source.items[0], operationId: "operation-1" }],
      },
      ["word-1"],
      now,
    ),
    false,
  );
  assert.equal(
    canReuseResumeSession(
      { ...source, expiresAt: new Date(now + 60_000) },
      ["word-1"],
      now,
    ),
    false,
  );
});

test("partial progress can resume without replacing consumed credentials", () => {
  const now = Date.parse("2026-08-09T00:00:00Z");
  const source = {
    expiresAt: new Date(now + 10 * 60_000),
    retiredAt: null,
    items: [
      {
        wordId: "word-done",
        usedAt: new Date(now + 1_000),
        renewedAt: null,
        operationId: null,
      },
      {
        wordId: "word-pending",
        usedAt: null,
        renewedAt: null,
        operationId: null,
      },
    ],
  };

  assert.equal(
    canReuseResumeSession(source, ["word-done", "word-pending"], now),
    true,
  );
  assert.equal(
    canReuseResumeSession(
      {
        ...source,
        items: [
          source.items[0],
          { ...source.items[1], renewedAt: new Date(now + 2_000) },
        ],
      },
      ["word-done", "word-pending"],
      now,
    ),
    false,
  );
});
