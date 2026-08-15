import { timingSafeEqual } from "node:crypto";

const CSRF_COOKIE = "roster-csrf";
const NEXTAUTH_CSRF_COOKIES = ["next-auth.csrf-token", "__Host-next-auth.csrf-token"];
const CSRF_HEADER = "x-csrf-token";

function configuredOrigins(): Set<string> {
  const values = [process.env.NEXTAUTH_URL, process.env.APP_URL].filter(
    (value): value is string => Boolean(value),
  );
  return new Set(
    values.flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    }),
  );
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function cookieValues(req: Request): string[] {
  const cookie = req.headers.get("cookie") ?? "";
  const values = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) values.set(name, value);
  }
  const names = [CSRF_COOKIE, ...NEXTAUTH_CSRF_COOKIES];
  const tokens: string[] = [];
  for (const name of names) {
    const raw = values.get(name);
    if (!raw) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      continue;
    }
    // NextAuth's double-submit cookie stores token|hash; the token is the
    // value returned by /api/auth/csrf and sent in the request header.
    const token = name === CSRF_COOKIE ? decoded : decoded.split("|", 1)[0];
    if (token) tokens.push(token);
  }
  return tokens;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * All cookie-auth state-changing routes use this guard. Missing Origin or a
 * missing/mismatched double-submit token fails closed. A small GET endpoint
 * issues the cookie for browser clients.
 */
export function isSameOriginMutation(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const configured = configuredOrigins();
  const requestUrl = new URL(req.url);
  const requestOrigin = requestUrl.origin;
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let forwardedOrigin: string | null = null;
  if (hostHeader) {
    try {
      const protocol = req.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
      forwardedOrigin = new URL(`${protocol}://${hostHeader}`).origin;
    } catch {
      forwardedOrigin = null;
    }
  }
  const localAlias = (() => {
    if (!forwardedOrigin) return false;
    try {
      const forwarded = new URL(forwardedOrigin);
      return isLoopbackHost(parsed.hostname) && isLoopbackHost(forwarded.hostname) && parsed.port === forwarded.port;
    } catch {
      return false;
    }
  })();
  if (parsed.origin !== requestOrigin && parsed.origin !== forwardedOrigin && !configured.has(parsed.origin) && !localAlias) {
    return false;
  }
  const cookies = cookieValues(req);
  const header = req.headers.get(CSRF_HEADER);
  return Boolean(header && cookies.some((cookie) => constantTimeEqual(cookie, header)));
}

export function csrfCookieName(): string {
  return CSRF_COOKIE;
}

export function csrfHeaderName(): string {
  return CSRF_HEADER;
}

export function csrfCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly${secure}`;
}
