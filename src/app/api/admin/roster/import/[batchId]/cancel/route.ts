import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireAdminMutation, rosterResponse } from "@/lib/roster-api";
import { lockRosterMutationState } from "@/lib/roster-server";
import { getClientIp } from "@/lib/login-limiter";
import { securityEventData } from "@/lib/security-events";
import { stableRosterCode } from "@/lib/roster-api";

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { batchId } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const batch = await tx.rosterImportBatch.findFirst({ where: { id: batchId, actorUserId: gate.auth.userId } });
      if (!batch) throw new Error("ROSTER_BATCH_NOT_FOUND");
      if (batch.status === "COMMITTED") throw new Error("ROSTER_BATCH_TERMINAL");
      if (batch.status === "CANCELLED") return { batchId, alreadyCancelled: true };
      await tx.rosterImportBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED", cancelledAt: new Date(), stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: gate.auth.userId, subjectAccount: `roster-import:${batch.id}`, eventType: "ROSTER_IMPORT_CANCELLED", ip: getClientIp(req.headers), metadata: { batchId: batch.id } }) });
      return { batchId, cancelled: true };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = stableRosterCode(error, ["ROSTER_BATCH_NOT_FOUND", "ROSTER_BATCH_TERMINAL"], "ROSTER_BATCH_CANCEL_FAILED");
    return rosterResponse(code, code === "ROSTER_BATCH_NOT_FOUND" ? 404 : 409);
  }
}
