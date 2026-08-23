import test from "node:test";
import assert from "node:assert/strict";
import type { JWT } from "next-auth/jwt";
import {
  validateAuthTokenVersion,
  type AuthValidationStore,
} from "./auth";

type ValidationUser = NonNullable<Awaited<ReturnType<AuthValidationStore["findUser"]>>>;

const activeTeacher: ValidationUser = {
  role: "TEACHER",
  status: "ACTIVE",
  tokenVersion: 4,
  credentialRevision: 7,
  mustChangePassword: false,
  accountName: "teacher-1",
  legacyName: null,
  studentProfile: null,
  teacherProfile: { legalName: "陳老師" },
};

function token(overrides: Partial<JWT> = {}): JWT {
  return {
    id: "teacher-1",
    role: "TEACHER",
    tokenVersion: 4,
    credentialRevision: 7,
    sessionJti: "session-jti",
    ...overrides,
  };
}

function store(overrides: Partial<AuthValidationStore> = {}): AuthValidationStore {
  return {
    findUser: async () => activeTeacher,
    findCurrentStudentEnrollment: async () => ({ id: "enrollment-1" }),
    ...overrides,
  };
}

test("token validation accepts current credentials and refreshes display claims", async () => {
  const result = await validateAuthTokenVersion(token(), store());
  assert.equal(result.authUnavailable, false);
  assert.equal(result.accountName, "teacher-1");
  assert.equal(result.displayName, "陳老師");
});

test("deleted, suspended, rotated or role-changed accounts invalidate an old JWT", async () => {
  const cases: Array<{ name: string; jwt: JWT; user: typeof activeTeacher | null }> = [
    { name: "deleted", jwt: token(), user: null },
    { name: "suspended", jwt: token(), user: { ...activeTeacher, status: "SUSPENDED" } },
    { name: "password/token reset", jwt: token(), user: { ...activeTeacher, tokenVersion: 5 } },
    { name: "credential rotation", jwt: token(), user: { ...activeTeacher, credentialRevision: 8 } },
    { name: "role change", jwt: token(), user: { ...activeTeacher, role: "ADMIN" } },
  ];

  for (const item of cases) {
    await assert.rejects(
      validateAuthTokenVersion(item.jwt, store({ findUser: async () => item.user })),
      (error: unknown) => error instanceof Error && error.message === "SESSION_INVALIDATED",
      item.name,
    );
  }
});

test("students without a current active enrollment invalidate their JWT", async () => {
  await assert.rejects(
    validateAuthTokenVersion(
      token({ id: "student-1", role: "STUDENT" }),
      store({
        findUser: async () => ({
          ...activeTeacher,
          role: "STUDENT",
          accountName: "student-1",
          studentProfile: { nickname: "同學一" },
          teacherProfile: null,
        }),
        findCurrentStudentEnrollment: async () => null,
      }),
    ),
    (error: unknown) => error instanceof Error && error.message === "SESSION_INVALIDATED",
  );
});

test("user and enrollment database failures mark auth unavailable instead of escaping", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const userFailure = await validateAuthTokenVersion(
    token(),
    store({ findUser: async () => { throw new Error("user query failed"); } }),
  );
  assert.equal(userFailure.authUnavailable, true);

  const enrollmentFailure = await validateAuthTokenVersion(
    token({ id: "student-1", role: "STUDENT" }),
    store({
      findUser: async () => ({
        ...activeTeacher,
        role: "STUDENT",
        accountName: "student-1",
        studentProfile: { nickname: "同學一" },
        teacherProfile: null,
      }),
      findCurrentStudentEnrollment: async () => { throw new Error("enrollment query failed"); },
    }),
  );
  assert.equal(enrollmentFailure.authUnavailable, true);
});
