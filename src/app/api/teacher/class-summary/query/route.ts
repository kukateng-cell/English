import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { normalizeTeacherClassSummaryQuery, queryTeacherClassSummary } from "@/lib/teacher-workspace";
import { isSameOriginMutation } from "@/lib/csrf";
import { getRequestToken } from "@/lib/recent-auth";
import { readLimitedBody } from "@/lib/request-body";

const BODY_LIMIT = 16 * 1024;

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  try {
    let body: unknown;
    try {
      const rawBody = new TextDecoder().decode(await readLimitedBody(req, BODY_LIMIT));
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : null;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("QUERY_INVALID");
      }
      body = parsed;
    } catch (error) {
      if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
        return rosterResponse("PAYLOAD_TOO_LARGE", 413);
      }
      throw new Error("QUERY_INVALID");
    }
    const { grade } = normalizeTeacherClassSummaryQuery(body);
    const token = await getRequestToken(req);
    const sessionToken = token?.id === auth.userId ? token : null;
    const result = await queryTeacherClassSummary({ userId: auth.userId, role: auth.role, grade, auth: { tokenVersion: sessionToken?.tokenVersion, credentialRevision: sessionToken?.credentialRevision } });
    return NextResponse.json({ viewMode: result.context.viewMode, academicYearId: result.context.academicYear.id, window: result.window, items: result.items, unassignedStudentCount: result.unassignedStudentCount, generatedAt: result.window.asOf }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND", "TEACHER_QUERY_STALE", "AUTH_REQUIRED", "ROLE_FORBIDDEN"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "TEACHER_QUERY_STALE" ? 409 : code === "AUTH_REQUIRED" ? 401 : code === "ROLE_FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
