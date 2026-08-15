import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";

function response(code: string, status: number) { return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } }); }

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requireRole(ROLES.ADMIN);
  if (!auth.ok) return response("AUTH_REQUIRED", auth.status);
  const { batchId } = await params;
  const batch = await prisma.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: auth.userId } });
  if (!batch) return response("MUTATION_BATCH_NOT_FOUND", 404);
  if (["PREVIEWED", "EXPIRED"].includes(batch.status) && batch.expiresAt <= new Date()) {
    await prisma.adminMutationBatch.updateMany({ where: { id: batch.id, status: { in: ["PREVIEWED", "EXPIRED"] } }, data: { status: "EXPIRED", payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
    return response("MUTATION_BATCH_EXPIRED", 410);
  }
  return NextResponse.json({ batchId: batch.id, operationKind: batch.operationKind, operationId: batch.operationId, status: batch.status, counts: batch.counts, expiresAt: batch.expiresAt.toISOString(), payload: batch.status === "PREVIEWED" ? batch.payload : null }, { headers: { "Cache-Control": "no-store" } });
}
