import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireAdminMutation, rosterResponse } from "@/lib/roster-api";
import { lockRosterMutationState } from "@/lib/roster-server";
import { stableRosterCode } from "@/lib/roster-api";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { batchId } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const batch = await tx.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: gate.auth.userId } });
      if (!batch) throw new Error("MUTATION_BATCH_NOT_FOUND");
      if (batch.status === "COMMITTED") throw new Error("MUTATION_BATCH_TERMINAL");
      if (batch.status === "CANCELLED") return { batchId, alreadyCancelled: true };
      await tx.adminMutationBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED", cancelledAt: new Date(), payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      return { batchId, cancelled: true };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["MUTATION_BATCH_NOT_FOUND", "MUTATION_BATCH_TERMINAL"], "MUTATION_BATCH_CANCEL_FAILED");
    return rosterResponse(code, code === "MUTATION_BATCH_NOT_FOUND" ? 404 : 409);
  }
}
