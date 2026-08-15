import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { lockRosterMutationState } from "@/lib/roster-server";
import { stableRosterCode } from "@/lib/roster-api";

function response(code: string, status: number) { return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const { id } = await params;
  const schoolClass = await prisma.schoolClass.findUnique({ where: { id }, include: { academicYear: true, _count: { select: { enrollments: true, teacherAccess: true } } } });
  if (!schoolClass) return response("CLASS_NOT_FOUND", 404);
  return NextResponse.json(schoolClass, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) return response("RECENT_AUTH_REQUIRED", 401);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.active !== "boolean") return response("CLASS_INPUT_INVALID", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const schoolClass = await tx.schoolClass.findUnique({ where: { id }, select: { id: true, active: true, revision: true } });
      if (!schoolClass) throw new Error("CLASS_NOT_FOUND");
      const year = await tx.academicYear.findFirst({ where: { classes: { some: { id } } }, select: { status: true } });
      if (year?.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
      const expected = Number(body.revision ?? schoolClass.revision);
      if (!Number.isInteger(expected)) throw new Error("REVISION_INVALID");
      if (!body.active && schoolClass.active) {
        const [enrollmentCount, accessCount] = await Promise.all([
          tx.studentEnrollment.count({ where: { classId: id, status: { in: ["ACTIVE", "PLANNED"] } } }),
          tx.teacherClassAccess.count({ where: { classId: id } }),
        ]);
        if (enrollmentCount || accessCount) throw new Error("CLASS_IN_USE");
      }
      const updated = await tx.schoolClass.updateMany({ where: { id, active: schoolClass.active, revision: expected }, data: { active: body.active, revision: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("STALE_PREVIEW");
      return tx.schoolClass.findUniqueOrThrow({ where: { id }, include: { academicYear: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["CLASS_NOT_FOUND", "ACADEMIC_YEAR_READ_ONLY", "REVISION_INVALID", "CLASS_IN_USE", "STALE_PREVIEW"], "CLASS_UPDATE_FAILED");
    return response(code, code === "CLASS_NOT_FOUND" ? 404 : code === "REVISION_INVALID" ? 422 : 409);
  }
}
