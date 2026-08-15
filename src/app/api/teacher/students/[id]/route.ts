import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { getTeacherStudentDetail } from "@/lib/teacher-workspace";
import { getRequestToken } from "@/lib/recent-auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  try {
    const { id } = await params;
    const token = await getRequestToken(_req);
    const result = await getTeacherStudentDetail({ userId: auth.userId, role: auth.role, studentId: id, sessionJti: token?.id === auth.userId ? token.sessionJti : undefined });
    return NextResponse.json({ viewMode: result.context.viewMode, student: result.student, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["STUDENT_NOT_FOUND", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND", "RESET_PRECONDITION_UNAVAILABLE"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" || code === "RESET_PRECONDITION_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 404);
  }
}
