import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { queryTeacherClassSummary } from "@/lib/teacher-workspace";
import { STUDENT_GRADES } from "@/lib/roster-domain";
import { isSameOriginMutation } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  try {
    const body = await req.json().catch(() => null) as { grade?: unknown } | null;
    const grade = typeof body?.grade === "string" && STUDENT_GRADES.includes(body.grade as never) ? body.grade as typeof STUDENT_GRADES[number] : body?.grade ? (() => { throw new Error("QUERY_INVALID"); })() : undefined;
    const result = await queryTeacherClassSummary({ userId: auth.userId, role: auth.role, grade });
    return NextResponse.json({ viewMode: result.context.viewMode, academicYearId: result.context.academicYear.id, window: { asOf: new Date().toISOString() }, items: result.items, unassignedStudentCount: result.unassignedStudentCount, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
