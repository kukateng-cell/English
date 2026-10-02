import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { parseClassCode, parseStudentGrade } from "@/lib/roster-domain";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";
import { lockRosterMutationState } from "@/lib/roster-server";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

export async function GET(req: Request) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const yearId = new URL(req.url).searchParams.get("academicYearId");
  if (!yearId) return response("ACADEMIC_YEAR_REQUIRED", 422);
  const classes = await prisma.schoolClass.findMany({
    where: { academicYearId: yearId },
    orderBy: [{ grade: "asc" }, { classCode: "asc" }],
    include: {
      academicYear: { select: { id: true, label: true, status: true, revision: true } },
      _count: { select: { enrollments: true, teacherAccess: true } },
    },
  });
  return NextResponse.json(classes, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return response("RECENT_AUTH_REQUIRED", 401);
  }
  const body = await req.json().catch(() => null);
  const academicYearId = typeof body?.academicYearId === "string" ? body.academicYearId : "";
  const grade = parseStudentGrade(body?.grade);
  const classCode = parseClassCode(body?.classCode);
  if (!academicYearId || !grade || !classCode) return response("CLASS_INPUT_INVALID", 422);
  try {
    const schoolClass = await prisma.$transaction(
      async (tx) => {
        await lockRosterMutationState(tx);
        const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
        if (!year) throw new Error("ACADEMIC_YEAR_NOT_FOUND");
        if (year.status === "CLOSED") throw new Error("ACADEMIC_YEAR_READ_ONLY");
        return tx.schoolClass.create({ data: { academicYearId, grade, classCode } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(schoolClass, { status: 201 });
  } catch (error) {
    if (error instanceof Error && ["ACADEMIC_YEAR_NOT_FOUND", "ACADEMIC_YEAR_READ_ONLY"].includes(error.message)) {
      return response(error.message, error.message === "ACADEMIC_YEAR_NOT_FOUND" ? 404 : 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return response("CLASS_EXISTS", 409);
    }
    return response("CLASS_CREATE_FAILED", 409);
  }
}

export async function PATCH(req: Request) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return response("RECENT_AUTH_REQUIRED", 401);
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || typeof body?.active !== "boolean") return response("CLASS_INPUT_INVALID", 422);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const schoolClass = await tx.schoolClass.findUnique({ where: { id: body.id } });
      if (!schoolClass) throw new Error("CLASS_NOT_FOUND");
      if (schoolClass.active === body.active) return schoolClass;
      if (!body.active) {
        const used = await tx.studentEnrollment.count({
          where: { classId: body.id, status: { in: ["ACTIVE", "PLANNED"] } },
        });
        const access = await tx.teacherClassAccess.count({ where: { classId: body.id } });
        if (used || access) throw new Error("CLASS_IN_USE");
      }
      const updated = await tx.schoolClass.updateMany({
        where: { id: body.id, revision: Number(body.revision ?? schoolClass.revision) },
        data: { active: body.active, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error("STALE_PREVIEW");
      return tx.schoolClass.findUniqueOrThrow({ where: { id: body.id } });
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "CLASS_NOT_FOUND") return response(error.message, 404);
    if (error instanceof Error && error.message === "CLASS_IN_USE") return response(error.message, 409);
    if (error instanceof Error && error.message === "STALE_PREVIEW") return response(error.message, 409);
    return response("CLASS_UPDATE_FAILED", 409);
  }
}
