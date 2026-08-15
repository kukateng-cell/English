import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  assertTeacherResetPrecondition,
  issueTeacherResetPrecondition,
  readTeacherResetPrecondition,
  TeacherResetPreconditionError,
} from "./teacher-reset-precondition";

const original = {
  current: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT,
  currentId: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID,
  previous: process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS,
  previousId: process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID,
};

function key() {
  return randomBytes(32).toString("base64url");
}

function configure(current = key(), currentId = "k-current", previous?: string, previousId?: string) {
  process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT = current;
  process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID = currentId;
  if (previous === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS = previous;
  if (previousId === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID = previousId;
  return current;
}

function restore() {
  if (original.current === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT = original.current;
  if (original.currentId === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID = original.currentId;
  if (original.previous === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS = original.previous;
  if (original.previousId === undefined) delete process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID;
  else process.env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID = original.previousId;
}

test.afterEach(restore);

test("AEAD precondition hides revisions and binds actor, target and session", () => {
  configure();
  const token = issueTeacherResetPrecondition({
    actorId: "teacher-1",
    targetId: "student-1",
    sessionJti: "session-1",
    targetTokenVersion: 4,
    targetCredentialRevision: 7,
    actorAccessRevision: 11,
    now: 1_000,
  });
  assert.equal(token.includes("credentialRevision"), false);
  const payload = readTeacherResetPrecondition(token, 1_001);
  assert.equal(payload.targetCredentialRevision, 7);
  assert.doesNotThrow(() => assertTeacherResetPrecondition(payload, { actorId: "teacher-1", targetId: "student-1", sessionJti: "session-1" }));
  assert.throws(() => assertTeacherResetPrecondition(payload, { actorId: "teacher-1", targetId: "student-1", sessionJti: "session-2" }), (error: unknown) => error instanceof TeacherResetPreconditionError && error.code === "RESET_PRECONDITION_INVALID");
});

test("rotation keeps an old current token readable through stable previous id until expiry", () => {
  const oldKey = configure(key(), "old-id");
  const token = issueTeacherResetPrecondition({ actorId: "teacher", targetId: "student", sessionJti: "session", targetTokenVersion: 1, targetCredentialRevision: 2, actorAccessRevision: null, now: 10_000 });
  const newKey = key();
  configure(newKey, "new-id", oldKey, "old-id");
  assert.equal(readTeacherResetPrecondition(token, 10_001).targetTokenVersion, 1);
  assert.throws(() => readTeacherResetPrecondition(token, 10_000 + 5 * 60_000 + 1), (error: unknown) => error instanceof TeacherResetPreconditionError && error.code === "RESET_PRECONDITION_INVALID");
});

test("missing, duplicate and malformed keyring fail closed", () => {
  delete process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT;
  delete process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID;
  assert.throws(() => issueTeacherResetPrecondition({ actorId: "a", targetId: "b", sessionJti: "s", targetTokenVersion: 0, targetCredentialRevision: 0, actorAccessRevision: null }), (error: unknown) => error instanceof TeacherResetPreconditionError && error.code === "RESET_PRECONDITION_UNAVAILABLE");
  configure(key(), "same", key(), "same");
  assert.throws(() => issueTeacherResetPrecondition({ actorId: "a", targetId: "b", sessionJti: "s", targetTokenVersion: 0, targetCredentialRevision: 0, actorAccessRevision: null }), (error: unknown) => error instanceof TeacherResetPreconditionError && error.code === "RESET_PRECONDITION_UNAVAILABLE");
});
