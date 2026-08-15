import test from "node:test";
import assert from "node:assert/strict";
import { csrfCookieHeader, isSameOriginMutation } from "./csrf";

function mutation(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/admin/roster", {
    method: "POST",
    headers,
  });
}

test("same-origin mutation requires a matching double-submit token", () => {
  const cookie = csrfCookieHeader("csrf-test-token").split(";", 1)[0];
  assert.equal(
    isSameOriginMutation(mutation({ origin: "http://localhost:3000", cookie, "x-csrf-token": "csrf-test-token" })),
    true,
  );
  assert.equal(isSameOriginMutation(mutation({ origin: "http://localhost:3000", cookie })), false);
  assert.equal(isSameOriginMutation(mutation({ origin: "http://localhost:3000", cookie, "x-csrf-token": "wrong" })), false);
});

test("cross-site or missing-origin mutations fail closed", () => {
  const cookie = csrfCookieHeader("csrf-test-token").split(";", 1)[0];
  assert.equal(isSameOriginMutation(mutation({ cookie, "x-csrf-token": "csrf-test-token" })), false);
  assert.equal(isSameOriginMutation(mutation({ origin: "https://evil.example", cookie, "x-csrf-token": "csrf-test-token" })), false);
});

test("accepts the encoded NextAuth CSRF cookie beside other cookies", () => {
  const token = "next-auth-token";
  const cookie = `locale=zh-Hant; next-auth.csrf-token=${encodeURIComponent(`${token}|hash`)}; next-auth.callback-url=http%3A%2F%2Flocalhost%3A3000`;
  assert.equal(
    isSameOriginMutation(
      mutation({ origin: "http://localhost:3000", cookie, "x-csrf-token": token }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutation(
      mutation({
        origin: "http://localhost:3000",
        cookie: `${cookie}; roster-csrf=stale-token`,
        "x-csrf-token": token,
      }),
    ),
    true,
  );
});

test("accepts loopback host aliases when the framework rewrites the request URL", () => {
  const token = "loopback-token";
  const req = new Request("http://localhost:3100/api/study/actions", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3100",
      host: "127.0.0.1:3100",
      cookie: `next-auth.csrf-token=${encodeURIComponent(`${token}|hash`)}`,
      "x-csrf-token": token,
    },
  });
  assert.equal(isSameOriginMutation(req), true);
});
