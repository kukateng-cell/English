import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { queryTeacherProgress, readTeacherWorkspaceQuery } from "@/lib/teacher-workspace";
import { isSameOriginMutation } from "@/lib/csrf";
import { getRequestToken } from "@/lib/recent-auth";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  try {
    const token = await getRequestToken(req);
    const sessionToken = token?.id === auth.userId ? token : null;
    const query = await readTeacherWorkspaceQuery(req);
    const result = await queryTeacherProgress({ userId: auth.userId, role: auth.role, query, auth: { tokenVersion: sessionToken?.tokenVersion, credentialRevision: sessionToken?.credentialRevision } });
    return NextResponse.json({
      viewMode: result.context.viewMode,
      scope: { academicYearId: result.context.academicYear.id, ...query, accessRevision: result.context.accessRevision, rosterRevision: result.context.rosterRevision },
      items: result.items,
      nextCursor: result.nextCursor,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURSOR_INVALID", "TEACHER_QUERY_STALE", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND", "TEACHER_DIRECTORY_TOO_LARGE", "AUTH_REQUIRED", "ROLE_FORBIDDEN"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "TEACHER_QUERY_STALE" ? 409 : code === "AUTH_REQUIRED" ? 401 : code === "ROLE_FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
