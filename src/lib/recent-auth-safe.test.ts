import test from "node:test";
import assert from "node:assert/strict";
import { readRecentAuthSafely } from "./recent-auth";

const input = {
  req: new Request("https://example.test/api/admin/roster/import/preview"),
  userId: "admin-1",
};

test("safe recent-auth reader distinguishes missing grants from backend outages", async (context) => {
  context.mock.method(console, "error", () => undefined);
  assert.deepEqual(
    await readRecentAuthSafely(input, async () => false),
    { ok: false, status: 401, code: "RECENT_AUTH_REQUIRED" },
  );
  assert.deepEqual(
    await readRecentAuthSafely(input, async () => {
      throw new Error("database unavailable");
    }),
    { ok: false, status: 503, code: "AUTH_BACKEND_UNAVAILABLE" },
  );
  assert.deepEqual(await readRecentAuthSafely(input, async () => true), { ok: true });
});
