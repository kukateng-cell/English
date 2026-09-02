import type { Locale } from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";

export type AuthServiceReturnTo = "/" | "/admin" | "/teacher";

const AUTH_SERVICE_RETURN_TARGETS = new Set<AuthServiceReturnTo>([
  "/",
  "/admin",
  "/teacher",
]);

export function normalizeAuthServiceReturnTo(value: string | null): AuthServiceReturnTo {
  return value && AUTH_SERVICE_RETURN_TARGETS.has(value as AuthServiceReturnTo)
    ? value as AuthServiceReturnTo
    : "/";
}

export function authServiceUnavailableLocation(returnTo: AuthServiceReturnTo): string {
  return `/auth-unavailable?returnTo=${encodeURIComponent(returnTo)}`;
}

export function buildAuthServiceUnavailableResponse(
  locale: Locale,
  requestedReturnTo: string | null,
): Response {
  const returnTo = normalizeAuthServiceReturnTo(requestedReturnTo);
  const title = convertText("登入服務暫時無法使用", locale);
  const description = convertText(
    "目前未能驗證你的登入狀態，請稍後再試。你的帳戶資料沒有被更改。",
    locale,
  );
  const retry = convertText("重試", locale);

  return new Response(`<!doctype html>
<html lang="${locale}" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #f5f3ee; color: #1f2937; }
    main { width: min(100%, 520px); padding: 32px; border: 1px solid #d8d3c8; border-radius: 24px; background: #fffdf8; box-shadow: 0 18px 55px rgba(31, 41, 55, .1); }
    p { margin: 12px 0 24px; line-height: 1.7; color: #5b6472; }
    h1 { margin: 0; font-size: clamp(1.5rem, 5vw, 2rem); line-height: 1.25; }
    a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 0 20px; border-radius: 999px; background: #315c4c; color: white; font-weight: 700; text-decoration: none; }
    a:focus-visible { outline: 3px solid #dcae4f; outline-offset: 3px; }
    @media (prefers-color-scheme: dark) {
      body { background: #171a18; color: #f4f1e8; }
      main { border-color: #3c443f; background: #222824; box-shadow: none; }
      p { color: #c7cec9; }
      a { background: #9ac8b5; color: #102119; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <a href="${returnTo}">${retry}</a>
  </main>
</body>
</html>`, {
    status: 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "30",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
