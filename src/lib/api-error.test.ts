import assert from "node:assert/strict";
import test from "node:test";
import { responseErrorDetails, responseErrorMessage, statusMessage } from "./api-error";

test("generic API status fallbacks use the Traditional-safe source wording", () => {
  assert.equal(statusMessage(401), "登入狀態無效，請重新登入");
  assert.equal(statusMessage(500), "伺服器暫時出錯，請稍後再試");
});

test("recent-auth responses are not misreported as a full session expiry", async () => {
  const response = new Response(JSON.stringify({ code: "RECENT_AUTH_REQUIRED" }), { status: 401 });
  const details = await responseErrorDetails(response, (text) => `繁體:${text}`);
  assert.equal(details.code, "RECENT_AUTH_REQUIRED");
  assert.equal(details.message, "繁體:最近的安全驗證已過期，請重新輸入密碼");
});

test("responseErrorMessage can localize a code fallback without exposing the code", async () => {
  const response = new Response(JSON.stringify({ code: "PASSWORD_INVALID" }), { status: 401 });
  assert.equal(await responseErrorMessage(response, (text) => `繁體:${text}`), "繁體:密碼不正確，請再試一次");
});

test("auth backend outage keeps a retryable service message", async () => {
  const response = new Response(JSON.stringify({ code: "AUTH_BACKEND_UNAVAILABLE" }), { status: 503 });
  const details = await responseErrorDetails(response);
  assert.equal(details.code, "AUTH_BACKEND_UNAVAILABLE");
  assert.equal(details.message, "登入服務暫時無法使用，請稍後重試");
});
