import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isStagedRosterRows } from "@/lib/roster-import-contract";
import { lockRosterMutationState } from "@/lib/roster-server";

function response(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const { batchId } = await params;
  const batch = await prisma.rosterImportBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId } });
  if (!batch) return response("ROSTER_BATCH_NOT_FOUND", 404);
  if (["PREVIEWED", "EXPIRED"].includes(batch.status) && batch.expiresAt <= new Date()) {
    await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      await tx.rosterImportBatch.updateMany({ where: { id: batch.id, status: { in: ["PREVIEWED", "EXPIRED"] } }, data: { status: "EXPIRED", stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
    });
    return response("ROSTER_BATCH_EXPIRED", 410);
  }
  const query = new URL(req.url).searchParams;
  const parsedLimit = Number(query.get("limit") ?? 50);
  const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50;
  const errorsOnly = query.get("errors") === "1";
  const cursor = Number(query.get("cursor") ?? 0);
  const allRows = batch.status === "PREVIEWED" && isStagedRosterRows(batch.stagedRows) ? batch.stagedRows : [];
  const filteredRows = errorsOnly ? allRows.filter((row) => row.errors.length) : allRows;
  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  const rows = filteredRows.slice(safeCursor, safeCursor + limit);
  const nextCursor = safeCursor + rows.length < filteredRows.length ? String(safeCursor + rows.length) : null;
  return NextResponse.json({
    batchId: batch.id,
    entityType: batch.entityType,
    format: batch.format,
    academicYearId: batch.academicYearId,
    mode: batch.mode,
    status: batch.status,
    rowCount: batch.rowCount,
    createCount: batch.createdCount,
    updateCount: batch.updatedCount,
    skippedCount: batch.skippedCount,
    errorCount: batch.errorCount,
    expiresAt: batch.expiresAt.toISOString(),
    canCommit: batch.status === "PREVIEWED" && batch.errorCount === 0 && isStagedRosterRows(batch.stagedRows),
    nextCursor,
    rows,
    errorsOnly,
    summary: batch.summary,
  }, { headers: { "Cache-Control": "no-store" } });
}
