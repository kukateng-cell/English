import test from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import { readSessionSafely } from "./session";

function session(overrides: Partial<NonNullable<Session["user"]>> = {}): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: "student-1",
      role: "STUDENT",
      accountName: "student-1",
      displayName: "同學一",
      name: "同學一",
      email: "student-1",
      mustChangePassword: false,
      authUnavailable: false,
      ...overrides,
    },
  };
}

test("safe session reader maps invalidated JWTs to 401", async () => {
  const result = await readSessionSafely(async () => {
    throw new Error("SESSION_INVALIDATED");
  });
  assert.deepEqual(result, { ok: false, status: 401, message: "Unauthorized" });
});

test("safe session reader maps auth backend failures and unavailable snapshots to 503", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const rejected = await readSessionSafely(async () => {
    throw new Error("database unavailable");
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.status, 503);

  const unavailable = await readSessionSafely(async () => session({ authUnavailable: true }));
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.status, 503);
});

test("safe session reader preserves authenticated sessions and treats a missing session as 401", async () => {
  const authenticated = session();
  assert.deepEqual(await readSessionSafely(async () => authenticated), { ok: true, session: authenticated });
  assert.deepEqual(await readSessionSafely(async () => null), { ok: false, status: 401, message: "Unauthorized" });
});
