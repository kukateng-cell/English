import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { academicYearDatesForLabel, lockRosterMutationState } from "@/lib/roster-server";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";

function errorResponse(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

export async function GET() {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return errorResponse("AUTH_REQUIRED", auth.status);
  const years = await prisma.academicYear.findMany({
    orderBy: { startsOn: "desc" },
    include: { _count: { select: { classes: true, enrollments: true } } },
  });
  return NextResponse.json(years, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) return errorResponse("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return errorResponse("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return errorResponse("RECENT_AUTH_REQUIRED", 401);
  }
  const body = await req.json().catch(() => null);
  const input = academicYearDatesForLabel(String(body?.label ?? ""));
  if (!input) return errorResponse("ACADEMIC_YEAR_LABEL_INVALID", 422);
  try {
    const year = await prisma.$transaction(
      async (tx) => {
        await lockRosterMutationState(tx);
        return tx.academicYear.create({
          data: { ...input, status: "PLANNED", isCurrent: false },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(year, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse("ACADEMIC_YEAR_EXISTS", 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "23P01") {
      return errorResponse("ACADEMIC_YEAR_OVERLAP", 422);
    }
    return errorResponse("ACADEMIC_YEAR_CREATE_FAILED", 409);
  }
}
