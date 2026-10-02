import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { isStagedRosterRows } from "@/lib/roster-import-contract";

export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: auth.status });
  const { batchId } = await params;
  const batch = await prisma.rosterImportBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId }, select: { id: true, status: true, expiresAt: true, stagedRows: true } });
  if (!batch) return NextResponse.json({ code: "ROSTER_BATCH_NOT_FOUND" }, { status: 404 });
  if (batch.expiresAt <= new Date() || batch.status !== "PREVIEWED") return NextResponse.json({ code: "ROSTER_BATCH_EXPIRED" }, { status: 410 });
  const allRows = isStagedRosterRows(batch.stagedRows) ? batch.stagedRows.filter((row) => row.errors.length) : [];
  const query = new URL(req.url).searchParams;
  const limitValue = Number(query.get("limit") ?? 100);
  const limit = Number.isInteger(limitValue) ? Math.min(100, Math.max(1, limitValue)) : 100;
  const cursorValue = Number(query.get("cursor") ?? 0);
  const cursor = Number.isInteger(cursorValue) && cursorValue >= 0 ? cursorValue : 0;
  const rows = allRows.slice(cursor, cursor + limit);
  const nextCursor = cursor + rows.length < allRows.length ? String(cursor + rows.length) : null;
  if (new URL(req.url).searchParams.get("download") === "1") {
    const neutralize = (value: string) => /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
    const body = `row,accountName,code\r\n${rows.map((row) => `${row.rowNumber},"${neutralize(row.accountName).replaceAll('"', '""')}","${neutralize(row.errors.join(" | ")).replaceAll('"', '""')}"`).join("\r\n")}`;
    return new Response(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="roster-errors-${batch.id}.csv"`, "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ batchId, rows, nextCursor, total: allRows.length }, { headers: { "Cache-Control": "no-store" } });
}
