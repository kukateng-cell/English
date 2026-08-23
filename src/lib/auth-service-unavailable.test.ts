import test from "node:test";
import assert from "node:assert/strict";
import {
  authServiceUnavailableLocation,
  buildAuthServiceUnavailableResponse,
  normalizeAuthServiceReturnTo,
} from "./auth-service-unavailable";

test("auth outage return targets are allowlisted and never become an open redirect", () => {
  assert.equal(normalizeAuthServiceReturnTo("/admin"), "/admin");
  assert.equal(normalizeAuthServiceReturnTo("/teacher"), "/teacher");
  assert.equal(normalizeAuthServiceReturnTo("https://example.com"), "/");
  assert.equal(normalizeAuthServiceReturnTo("//example.com"), "/");
  assert.equal(normalizeAuthServiceReturnTo("/admin/users"), "/");
  assert.equal(authServiceUnavailableLocation("/admin"), "/auth-unavailable?returnTo=%2Fadmin");
});

test("auth outage document has an explicit retryable 503 contract", async () => {
  const response = buildAuthServiceUnavailableResponse("zh-Hant", "/teacher");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("retry-after"), "30");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const body = await response.text();
  assert.match(body, /登入服務暫時無法使用/);
  assert.match(body, /href="\/teacher"/);
});

test("auth outage document falls back to the student root for an unsafe target", async () => {
  const response = buildAuthServiceUnavailableResponse("zh-Hans", "//example.com");
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /登录服务暂时无法使用/);
  assert.match(body, /href="\/"/);
  assert.doesNotMatch(body, /example\.com/);
});
