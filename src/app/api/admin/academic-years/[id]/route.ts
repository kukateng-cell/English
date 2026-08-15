import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { academicYearDatesForLabel, lockRosterMutationState } from "@/lib/roster-server";
import { hasValidRecentAuthGrant } from "@/lib/recent-auth";
import { isSameOriginMutation } from "@/lib/csrf";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const { id } = await params;
  const year = await prisma.academicYear.findUnique({
    where: { id },
    include: { classes: { orderBy: [{ grade: "asc" }, { classCode: "asc" }] } },
  });
  if (!year) return response("ACADEMIC_YEAR_NOT_FOUND", 404);
  return NextResponse.json(year, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(req)) return response("CSRF_ORIGIN_INVALID", 403);
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  if (!(await hasValidRecentAuthGrant({ req, userId: auth.userId }))) {
    return response("RECENT_AUTH_REQUIRED", 401);
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (body?.status !== undefined || body?.isCurrent !== undefined) {
    return response("ACADEMIC_YEAR_STATUS_IMMUTABLE", 422);
  }
  const current = await prisma.academicYear.findUnique({ where: { id } });
  if (!current) return response("ACADEMIC_YEAR_NOT_FOUND", 404);
  if (current.status !== "PLANNED") return response("ACADEMIC_YEAR_READ_ONLY", 409);
  const input = academicYearDatesForLabel(String(body?.label ?? current.label));
  if (!input) return response("ACADEMIC_YEAR_LABEL_INVALID", 422);
  const expectedRevision = Number(body?.revision ?? current.revision);
  if (!Number.isInteger(expectedRevision)) return response("REVISION_INVALID", 422);
  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        await lockRosterMutationState(tx);
        const result = await tx.academicYear.updateMany({
          where: { id, status: "PLANNED", revision: expectedRevision },
          data: { ...input, revision: { increment: 1 } },
        });
        if (result.count !== 1) throw new Error("STALE");
        return tx.academicYear.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "STALE") return response("STALE_PREVIEW", 409);
    return response("ACADEMIC_YEAR_UPDATE_FAILED", 409);
  }
}
