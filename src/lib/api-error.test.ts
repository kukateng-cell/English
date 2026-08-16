import assert from "node:assert/strict";
import test from "node:test";
import { responseErrorDetails, responseErrorMessage, statusMessage } from "./api-error";

test("generic API status fallbacks use the Traditional-safe source wording", () => {
  assert.equal(statusMessage(401), "登录状态无效，请重新登录");
  assert.equal(statusMessage(500), "服务器暂时出错，请稍后再试");
});

test("recent-auth responses are not misreported as a full session expiry", async () => {
  const response = new Response(JSON.stringify({ code: "RECENT_AUTH_REQUIRED" }), { status: 401 });
  const details = await responseErrorDetails(response, (text) => `繁體:${text}`);
  assert.equal(details.code, "RECENT_AUTH_REQUIRED");
  assert.equal(details.message, "繁體:最近的安全验证已过期，请重新输入密码");
});

test("responseErrorMessage can localize a code fallback without exposing the code", async () => {
  const response = new Response(JSON.stringify({ code: "PASSWORD_INVALID" }), { status: 401 });
  assert.equal(await responseErrorMessage(response, (text) => `繁體:${text}`), "繁體:密码不正确，请再试一次");
});
