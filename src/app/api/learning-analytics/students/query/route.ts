import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isSameOriginMutation } from "@/lib/csrf";
import { readAnalyticsQuery, queryLearningAnalyticsStudents } from "@/lib/learning-analytics";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function authError(status: number) { return NextResponse.json({ code: status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED" }, { status, headers }); }

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403, headers });
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN); if (!auth.ok) return authError(auth.status);
  try { return NextResponse.json(await queryLearningAnalyticsStudents({ userId: auth.userId, role: auth.role, query: await readAnalyticsQuery(req) }), { headers }); }
  catch (error) { const code = error instanceof Error ? error.message : "INTERNAL_ERROR"; const status = code === "PAYLOAD_TOO_LARGE" ? 413 : ["QUERY_INVALID", "RANGE_OUTSIDE_CURRENT_YEAR"].includes(code) ? 422 : ["CLASS_NOT_FOUND", "STUDENT_NOT_FOUND"].includes(code) ? 404 : code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "ANALYTICS_SCOPE_STALE" ? 409 : code === "ROLE_FORBIDDEN" ? 403 : code === "AUTH_REQUIRED" ? 401 : 500; return NextResponse.json({ code: status === 500 ? "INTERNAL_ERROR" : code }, { status, headers }); }
}
