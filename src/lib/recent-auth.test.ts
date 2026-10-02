import test from "node:test";
import assert from "node:assert/strict";
import { createSessionJti, hashSessionJti, RECENT_AUTH_WINDOW_MS, sessionCookieIsSecure } from "./recent-auth";

test("recent-auth grants are session-bound and use one-way identifiers", () => {
  const first = createSessionJti();
  const second = createSessionJti();
  assert.notEqual(first, second);
  assert.notEqual(hashSessionJti(first), hashSessionJti(second));
  assert.match(hashSessionJti(first), /^[a-f0-9]{64}$/u);
  assert.equal(RECENT_AUTH_WINDOW_MS, 15 * 60_000);
});

test("recent-auth hash is stable for the same session and secret", () => {
  const jti = "device-session-jti";
  assert.equal(hashSessionJti(jti), hashSessionJti(jti));
});

test("recent-auth follows the request transport when selecting the session cookie", () => {
  assert.equal(sessionCookieIsSecure(new Request("http://127.0.0.1:3100/api/auth/reauth")), false);
  assert.equal(sessionCookieIsSecure(new Request("https://example.test/api/auth/reauth")), true);
});
