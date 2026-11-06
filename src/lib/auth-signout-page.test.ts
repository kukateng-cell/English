import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * #96：NextAuth 預設英文登出確認頁要換成自訂繁中頁。
 *
 * 這組測試以原始碼靜態約定固定 wiring，避免日後有人只改頁面或只改
 * `authOptions`，令登出流程回到英文頁或失去 CSRF 保護。
 */

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("authOptions.pages 指向自訂登出頁並保留既有 pages 設定", () => {
  const authSource = readSource(path.join("src", "lib", "auth.ts"));
  const pagesBlock = authSource.match(/pages:\s*\{([\s\S]*?)\n {2}\},/u)?.[1] ?? "";

  assert.match(pagesBlock, /signIn:\s*"\/login"/u);
  assert.match(pagesBlock, /error:\s*"\/login"/u);
  assert.match(pagesBlock, /signOut:\s*"\/auth\/signout"/u);
  // `/api/auth/*` 是 NextAuth 保留路徑，自訂頁不可以放在那裡。
  assert.doesNotMatch(pagesBlock, /signOut:\s*"\/api\/auth/u);
});

test("自訂登出頁以安全 callbackUrl 及伺服器端 CSRF token 組成", () => {
  const pageSource = readSource(path.join("src", "app", "auth", "signout", "page.tsx"));

  // 頁面本身是 Server Component，locale／theme 由 client 元件沿用既有 provider。
  assert.doesNotMatch(pageSource, /"use client"/u);
  assert.match(pageSource, /import \{ safeCallbackPath \} from "@\/lib\/safe-callback-url";/u);
  assert.match(pageSource, /DEFAULT_SIGN_OUT_CALLBACK = "\/login"/u);
  assert.match(pageSource, /safeCallbackPath\(/u);
  assert.match(pageSource, /firstSearchParam\(params\.callbackUrl\)/u);
  assert.match(pageSource, /firstSearchParam\(params\.csrfToken\)/u);
  // token 由 NextAuth 的 CSRF cookie 取得（含 HTTPS 的 __Host- 前綴）。
  assert.match(pageSource, /"__Host-next-auth\.csrf-token"/u);
  assert.match(pageSource, /"next-auth\.csrf-token"/u);
  assert.match(pageSource, /<AuthShell>/u);
  assert.match(pageSource, /initialCsrfToken=\{csrfToken\}/u);
});

test("登出確認表單以 POST 提交並帶同源 CSRF token 及 callbackUrl", () => {
  const confirmSource = readSource(
    path.join("src", "app", "auth", "signout", "SignOutConfirm.tsx"),
  );

  assert.match(confirmSource, /"use client";/u);
  // 原生表單 POST，交由 NextAuth 驗證 CSRF；不呼叫 helper 繞過確認頁。
  assert.match(confirmSource, /<form[^>]*method="POST"/u);
  assert.match(confirmSource, /<form[^>]*action="\/api\/auth\/signout"/u);
  assert.match(confirmSource, /<input[^>]*name="csrfToken"/u);
  assert.match(confirmSource, /<input[^>]*name="callbackUrl" value=\{callbackUrl\}/u);
  // 只在 cookie 尚未建立時才於提交前補取 token，並重新觸發原生提交。
  assert.match(confirmSource, /getCsrfToken\(\)/u);
  assert.match(confirmSource, /requestSubmit\(\)/u);
  assert.doesNotMatch(confirmSource, /\bsignOut\(/u);
  // 取消出路回到安全 callbackUrl。
  assert.match(confirmSource, /href=\{callbackUrl\}/u);
  // 文案經既有繁簡轉換出口。
  assert.match(confirmSource, /tc\("確定要登出嗎？"\)/u);
});

test("頂欄 LogoutButton 維持一按即登出，不經確認頁", () => {
  const logoutButtonSource = readSource(
    path.join("src", "components", "LogoutButton.tsx"),
  );

  // next-auth/react 的 signOut() 直接 POST /api/auth/signout；
  // `pages.signOut` 只影響 GET，因此頂欄按鈕行為不變。
  assert.match(logoutButtonSource, /signOut\(\{ callbackUrl: "\/login" \}\)/u);
  assert.doesNotMatch(logoutButtonSource, /\/auth\/signout|\/api\/auth\/signout/u);
});
