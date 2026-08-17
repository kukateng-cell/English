import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { rosterResponse, stableRosterCode } from "@/lib/roster-api";
import { queryTeacherClassSummary } from "@/lib/teacher-workspace";
import { STUDENT_GRADES } from "@/lib/roster-domain";
import { isSameOriginMutation } from "@/lib/csrf";
import { getRequestToken } from "@/lib/recent-auth";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return rosterResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.TEACHER, ROLES.ADMIN);
  if (!auth.ok) return rosterResponse(auth.status === 503 ? "AUTH_BACKEND_UNAVAILABLE" : auth.status === 403 ? "ROLE_FORBIDDEN" : "AUTH_REQUIRED", auth.status);
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 16 * 1024) throw new Error("QUERY_INVALID");
    const rawBody = await req.text().catch(() => "");
    if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) throw new Error("QUERY_INVALID");
    const body = (() => { try { return JSON.parse(rawBody) as { grade?: unknown }; } catch { return null; } })();
    const grade = typeof body?.grade === "string" && STUDENT_GRADES.includes(body.grade as never) ? body.grade as typeof STUDENT_GRADES[number] : body?.grade ? (() => { throw new Error("QUERY_INVALID"); })() : undefined;
    const token = await getRequestToken(req);
    const sessionToken = token?.id === auth.userId ? token : null;
    const result = await queryTeacherClassSummary({ userId: auth.userId, role: auth.role, grade, auth: { tokenVersion: sessionToken?.tokenVersion, credentialRevision: sessionToken?.credentialRevision } });
    return NextResponse.json({ viewMode: result.context.viewMode, academicYearId: result.context.academicYear.id, window: result.window, items: result.items, unassignedStudentCount: result.unassignedStudentCount, generatedAt: result.window.asOf }, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = stableRosterCode(error, ["QUERY_INVALID", "CURRENT_YEAR_UNAVAILABLE", "TEACHER_NOT_FOUND", "TEACHER_QUERY_STALE", "AUTH_REQUIRED", "ROLE_FORBIDDEN"], "INTERNAL_ERROR");
    return rosterResponse(code, code === "CURRENT_YEAR_UNAVAILABLE" ? 503 : code === "TEACHER_NOT_FOUND" ? 404 : code === "TEACHER_QUERY_STALE" ? 409 : code === "AUTH_REQUIRED" ? 401 : code === "ROLE_FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 422);
  }
}
