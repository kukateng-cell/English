import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { getTeacherWorkspaceContext, serializeTeacherWorkspaceAcademicYear } from "@/lib/teacher-workspace";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";

export async function GET() {
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse("AUTH_REQUIRED", auth.status);
  try {
    const context = await getTeacherWorkspaceContext({ userId: auth.userId, role: auth.role });
    const unassignedStudentCount = auth.role === ROLES.ADMIN
      ? await import("@/lib/prisma").then(({ prisma }) => prisma.user.count({ where: { ...context.studentWhere, studentProfile: { is: { enrollments: { some: { academicYearId: context.academicYear.id, status: "ACTIVE", classId: null } } } } } }))
      : 0;
    // Academic-year boundaries are calendar dates for the teacher UI.  Do not
    // expose Prisma Date JSON (UTC midnight) and let the browser slice it: a
    // stored Shanghai midnight is the previous UTC day.
    const academicYear = serializeTeacherWorkspaceAcademicYear(context.academicYear);
    return NextResponse.json({
      viewMode: context.viewMode,
      academicYear,
      items: context.classes.map((item) => ({ ...item, label: `${item.grade}:${item.classCode}` })),
      unassignedStudentCount,
      accessRevision: context.accessRevision,
      rosterRevision: context.rosterRevision,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "TEACHER_NOT_FOUND" ? 404 : 503);
  }
}
