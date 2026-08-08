import test from "node:test";
import assert from "node:assert/strict";
import { getClientIp } from "./login-limiter";

test("getClientIp supports Web Headers and plain NextAuth records", () => {
  assert.equal(
    getClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    "203.0.113.7",
  );
  assert.equal(
    getClientIp({ "x-real-ip": "198.51.100.4" }),
    "198.51.100.4",
  );
});
