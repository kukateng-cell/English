import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPasswordResetPrecondition,
  issuePasswordResetPrecondition,
  readPasswordResetPrecondition,
  PasswordResetPreconditionError,
  PASSWORD_RESET_AUDIENCES,
} from "@/lib/password-reset-precondition";

const original = {
  key: process.env.PASSWORD_RESET_PRECONDITION_KEY_CURRENT,
  keyId: process.env.PASSWORD_RESET_PRECONDITION_KEY_CURRENT_ID,
  previous: process.env.PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS,
  previousId: process.env.PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS_ID,
  teacherKey: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT,
  teacherKeyId: process.env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID,
};

function setup() {
  process.env.PASSWORD_RESET_PRECONDITION_KEY_CURRENT = Buffer.alloc(32, 7).toString("base64url");
  process.env.PASSWORD_RESET_PRECONDITION_KEY_CURRENT_ID = "current-v2";
  delete process.env.PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS;
  delete process.env.PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS_ID;
}

function restore() {
  for (const [key, value] of Object.entries({
    PASSWORD_RESET_PRECONDITION_KEY_CURRENT: original.key,
    PASSWORD_RESET_PRECONDITION_KEY_CURRENT_ID: original.keyId,
    PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS: original.previous,
    PASSWORD_RESET_PRECONDITION_KEY_PREVIOUS_ID: original.previousId,
    TEACHER_RESET_PRECONDITION_KEY_CURRENT: original.teacherKey,
    TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID: original.teacherKeyId,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("password reset v2 precondition binds audience, session and grant generation", () => {
  setup();
  try {
    const token = issuePasswordResetPrecondition({
      audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET,
      actorId: "admin-1",
      actorRole: "ADMIN",
      targetId: "student-1",
      targetRole: "STUDENT",
      sessionJti: "session-1",
      actorTokenVersion: 2,
      actorCredentialRevision: 3,
      targetTokenVersion: 4,
      targetCredentialRevision: 5,
      targetRevision: 6,
      targetAccessRevision: null,
      actorAccessRevision: null,
      grantReauthenticatedAt: 1_000,
      grantExpiresAt: 901_000,
      now: 2_000,
    });
    const payload = readPasswordResetPrecondition(token, PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET, 2_001);
    assert.equal(payload.targetRevision, 6);
    assert.doesNotThrow(() => assertPasswordResetPrecondition(payload, {
      audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET,
      actorId: "admin-1",
      targetId: "student-1",
      sessionJti: "session-1",
    }));
    assert.throws(() => readPasswordResetPrecondition(token, PASSWORD_RESET_AUDIENCES.TEACHER_STUDENT_RESET, 2_001), (error: unknown) => error instanceof PasswordResetPreconditionError && error.code === "RESET_PRECONDITION_INVALID");
    assert.throws(() => assertPasswordResetPrecondition(payload, {
      audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET,
      actorId: "admin-1",
      targetId: "student-1",
      sessionJti: "session-2",
    }), (error: unknown) => error instanceof PasswordResetPreconditionError && error.code === "RESET_PRECONDITION_INVALID");
  } finally {
    restore();
  }
});

test("password reset v2 rejects expired tokens and malformed keyrings", () => {
  setup();
  try {
    const token = issuePasswordResetPrecondition({
      audience: PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET,
      actorId: "admin",
      actorRole: "ADMIN",
      targetId: "teacher",
      targetRole: "TEACHER",
      sessionJti: "session",
      actorTokenVersion: 1,
      actorCredentialRevision: 1,
      targetTokenVersion: 1,
      targetCredentialRevision: 1,
      targetRevision: 1,
      targetAccessRevision: 2,
      actorAccessRevision: null,
      grantReauthenticatedAt: 10_000,
      grantExpiresAt: 800_000,
      now: 10_000,
    });
    assert.throws(() => readPasswordResetPrecondition(token, PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET, 310_001), (error: unknown) => error instanceof PasswordResetPreconditionError && error.code === "RESET_PRECONDITION_INVALID");
    delete process.env.PASSWORD_RESET_PRECONDITION_KEY_CURRENT;
    assert.throws(() => readPasswordResetPrecondition(token, PASSWORD_RESET_AUDIENCES.ADMIN_USER_RESET, 10_001), (error: unknown) => error instanceof PasswordResetPreconditionError && error.code === "RESET_PRECONDITION_UNAVAILABLE");
  } finally {
    restore();
  }
});
