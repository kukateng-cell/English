import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { queryTeacherProgress, readTeacherWorkspaceQuery } from "@/lib/teacher-workspace";
import { isSameOriginMutation } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  try {
    const query = await readTeacherWorkspaceQuery(req);
    const result = await queryTeacherProgress({ userId: auth.userId, role: auth.role, query });
    return NextResponse.json({
      viewMode: result.context.viewMode,
      scope: { academicYearId: result.context.academicYear.id, ...query, accessRevision: result.context.accessRevision, rosterRevision: result.context.rosterRevision },
      items: result.items,
      nextCursor: result.nextCursor,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURSOR_INVALID", "TEACHER_QUERY_STALE", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "TEACHER_QUERY_STALE" ? 409 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
