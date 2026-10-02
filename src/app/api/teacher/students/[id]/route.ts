import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { getTeacherStudentDetail } from "@/lib/teacher-workspace";
import { getRequestToken } from "@/lib/recent-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  try {
    const { id } = await params;
    const token = await getRequestToken(_req);
    const sessionToken = token?.id === auth.userId ? token : null;
    const result = await getTeacherStudentDetail({ userId: auth.userId, role: auth.role, studentId: id, sessionJti: sessionToken?.sessionJti, auth: { tokenVersion: sessionToken?.tokenVersion, credentialRevision: sessionToken?.credentialRevision } });
    return NextResponse.json({ viewMode: result.context.viewMode, student: result.student, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["STUDENT_NOT_FOUND", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND", "RESET_PRECONDITION_UNAVAILABLE", "TEACHER_QUERY_STALE", "AUTH_REQUIRED", "ROLE_FORBIDDEN"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" || code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "TEACHER_QUERY_STALE" ? 409 : code === "AUTH_REQUIRED" ? 401 : code === "ROLE_FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 404);
  }
}
