import { NextResponse } from "next/server";
import { requireRole, type AuthResult } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";

export function rosterResponse(code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, ...extra }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Route handlers may use internal Error messages for control flow, but those
 * messages must never become an API contract by accident.  Keep the public
 * error vocabulary explicit and fail closed for Prisma/SQL/runtime errors.
 */
export function stableRosterCode(error: unknown, allowed: readonly string[], fallback: string) {
  const code = error instanceof Error ? error.message : "";
  return allowed.includes(code) ? code : fallback;
}

export async function requireAdminMutation(req: Request): Promise<
  { ok: true; auth: Extract<AuthResult, { ok: true }> } |
  { ok: false; response: Response }
> {
  if (!isSameOriginMutation(req)) return { ok: false, response: rosterResponse("CSRF_ORIGIN_INVALID", 403) };
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return { ok: false, response: rosterResponse("AUTH_REQUIRED", auth.status) };
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return { ok: false, response: rosterResponse("RECENT_AUTH_REQUIRED", 401) };
  }
  return { ok: true, auth };
}

export async function requireAdminRead(): Promise<Extract<AuthResult, { ok: true }> | Response> {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  return auth;
}

export function isAdminAuth(value: Extract<AuthResult, { ok: true }> | Response): value is Extract<AuthResult, { ok: true }> {
  return !(value instanceof Response);
}
