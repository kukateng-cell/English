import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { createBulkClassPreview } from "@/app/api/admin/roster/students/bulk-class/route";
import { parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { prisma } from "@/lib/prisma";
import { stableRosterCode } from "@/lib/roster-api";

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ code: "CSRF_ORIGIN_INVALID" }, { status: 403 });
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return NextResponse.json({ code: "RECENT_AUTH_REQUIRED" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const academicYearId = typeof body?.academicYearId === "string" ? body.academicYearId : "";
  const mode = body?.mode === "allMatching" ? "allMatching" : "explicit";
  let studentIds: string[] = Array.isArray(body?.studentIds) ? body.studentIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const excludedIds: string[] = Array.isArray(body?.excludedIds) ? body.excludedIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const operationId = typeof body?.operationId === "string" ? body.operationId : randomUUID();
  if (!academicYearId) return NextResponse.json({ code: "ACADEMIC_YEAR_REQUIRED" }, { status: 422 });
  try {
    if (mode === "allMatching") {
      const grade = parseStudentGrade(body?.filters?.grade);
      const classCode = parseClassCode(body?.filters?.classCode);
      const search = typeof body?.filters?.search === "string" ? body.filters.search.trim().toLowerCase() : "";
      const users = await prisma.user.findMany({
        where: {
          role: "STUDENT", status: "ACTIVE",
          ...(search ? { OR: [{ accountName: { contains: search, mode: "insensitive" } }, { studentProfile: { is: { legalName: { contains: search, mode: "insensitive" } } } }] } : {}),
          studentProfile: { is: { enrollments: { some: { academicYearId, status: "ACTIVE", ...(grade ? { grade } : {}), ...(classCode ? { schoolClass: { is: { classCode } } } : {}) } } } },
        },
        orderBy: [{ accountName: "asc" }, { id: "asc" }],
        select: { id: true },
        take: 501,
      });
      studentIds = users.map((user) => user.id);
    }
    const filterHash = createHash("sha256").update(JSON.stringify({ mode, filters: body?.filters ?? null, studentIds: [...new Set(studentIds)], excludedIds: [...new Set(excludedIds)] })).digest("hex");
    const result = await createBulkClassPreview({ req, actorUserId: auth.userId, academicYearId, targetClassCode: body?.classCode === null || body?.classCode === "" ? null : String(body?.classCode ?? ""), studentIds: [...new Set(studentIds)], excludedIds: [...new Set(excludedIds)], filterHash, operationId });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["CLASS_INVALID", "SELECTION_CAP", "CURRENT_YEAR_REQUIRED", "STUDENT_SCOPE_INVALID", "CLASS_NOT_FOUND"], "BULK_CLASS_PREVIEW_FAILED");
    return NextResponse.json({ code }, { status: code === "SELECTION_CAP" ? 413 : 409 });
  }
}
