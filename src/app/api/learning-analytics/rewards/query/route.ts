import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/csrf";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { queryLearningRewards, readRewardRequest, recheckRewardAccess } from "@/lib/learning-reward-analytics";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

function authError(status: number) {
  return NextResponse.json({ code: status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED" }, { status, headers });
}

function statusFor(code: string) {
  if (["PAYLOAD_TOO_LARGE", "REWARD_SCOPE_TOO_LARGE"].includes(code)) return 413;
  if (["CLASS_NOT_FOUND", "STUDENT_NOT_FOUND"].includes(code)) return 404;
  if (["QUERY_INVALID", "RANGE_OUTSIDE_CURRENT_YEAR", "CURSOR_INVALID"].includes(code)) return 422;
  if (code === "REWARD_SCOPE_STALE") return 409;
  if (["CURRENT_YEAR_UNAVAILABLE", "AUTH_BACKEND_UNAVAILABLE", "ROSTER_MUTATION_STATE_MISSING"].includes(code)) return 503;
  if (code === "ROLE_FORBIDDEN") return 403;
  if (code === "AUTH_REQUIRED") return 401;
  return 500;
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403, headers });
  let auth: Awaited<ReturnType<typeof requireRole>>;
  try { auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN); } catch { return authError(503); }
  if (!auth.ok) return authError(auth.status);
  try {
    const request = await readRewardRequest(req, { route: "QUERY" });
    const result = await queryLearningRewards({ userId: auth.userId, role: auth.role, request });
    const body = JSON.stringify(result);
    await recheckRewardAccess({ userId: auth.userId, role: auth.role, scopeToken: result.scopeToken, scopeRevision: result.scopeRevision, academicYearId: result.academicYear.id });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = statusFor(code);
    return NextResponse.json({ code: status === 500 ? "INTERNAL_ERROR" : code }, { status, headers });
  }
}

export async function GET() {
  return NextResponse.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
}
