import type { NextRequest } from "next/server";
import { buildAuthServiceUnavailableResponse } from "@/lib/auth-service-unavailable";
import { LOCALE_COOKIE_KEY, normalizeLocale } from "@/lib/i18n/config";

export function GET(request: NextRequest): Response {
  const locale = normalizeLocale(request.cookies.get(LOCALE_COOKIE_KEY)?.value);
  return buildAuthServiceUnavailableResponse(
    locale,
    request.nextUrl.searchParams.get("returnTo"),
  );
}
