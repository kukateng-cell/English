import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import AuthShell from "@/components/auth/AuthShell";
import { LOCALE_COOKIE_KEY, normalizeLocale } from "@/lib/i18n/config";
import { convertText } from "@/lib/i18n/convert";
import { safeCallbackPath } from "@/lib/safe-callback-url";
import SignOutConfirm from "./SignOutConfirm";

/** 未帶安全 callbackUrl 時的預設落點：與 LogoutButton 及認證不可用頁一致。 */
const DEFAULT_SIGN_OUT_CALLBACK = "/login";

/**
 * NextAuth v4 的 CSRF cookie 名稱。`useSecureCookies`（預設跟隨請求是否 HTTPS）
 * 會決定是否加上 `__Host-` 前綴，所以兩種都要讀。
 */
const CSRF_COOKIE_NAMES = [
  "__Host-next-auth.csrf-token",
  "next-auth.csrf-token",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_KEY)?.value);
  return {
    title: convertText("登出", locale),
    robots: { index: false, follow: false },
  };
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** 由請求標頭還原 origin，供 safeCallbackPath 判斷同源。 */
function requestOrigin(requestHeaders: { get(name: string): string | null }): string {
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : /^(?:localhost|127\.)/u.test(host)
        ? "http"
        : "https";
  return `${proto}://${host}`;
}

/**
 * 從 NextAuth 的 CSRF cookie 取出 token。cookie 值格式是
 * `${csrfToken}|${hash}`（可能經 URL 編碼），只需要 token 部分放進表單。
 *
 * 這樣一般情況（使用者已登入或剛由 `/api/auth/signout` 轉入）可以完全
 * 伺服器端渲染出有效 token，不必在 client 再請求 `/api/auth/csrf`；後者
 * 會與 SessionProvider 的 session 請求競爭，令兩邊各自建立新 token。
 */
function csrfTokenFromCookieValue(rawValue: string | undefined): string | null {
  if (!rawValue) return null;
  let value = rawValue;
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  const [token] = value.split("|");
  return token && /^[a-f0-9]{64}$/u.test(token) ? token : null;
}

/**
 * 自訂登出確認頁（NextAuth v4 `pages.signOut`）。
 *
 * GET /api/auth/signout 在設定 `pages.signOut` 後會 redirect 到此頁；POST
 * /api/auth/signout 仍由 NextAuth 依 CSRF token 完成登出，不會被攔截。
 * 部分舊版或外部連結會額外帶 `callbackUrl`／`csrfToken` query，兩者都做
 * 防禦性處理：callbackUrl 只接受同源應用路徑，缺失或不安全時回登入頁。
 */
export default async function SignOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(
    firstSearchParam(params.callbackUrl),
    requestOrigin(await headers()),
    DEFAULT_SIGN_OUT_CALLBACK,
  );
  const cookieStore = await cookies();
  const cookieCsrfToken =
    CSRF_COOKIE_NAMES.map((name) => csrfTokenFromCookieValue(cookieStore.get(name)?.value))
      .find((token): token is string => token !== null) ?? null;
  // cookie 的 token 才可能通過 NextAuth 驗證；query 版本只作舊客戶端相容後備。
  const csrfToken = cookieCsrfToken ?? firstSearchParam(params.csrfToken);

  return (
    <AuthShell>
      <SignOutConfirm callbackUrl={callbackUrl} initialCsrfToken={csrfToken} />
    </AuthShell>
  );
}
