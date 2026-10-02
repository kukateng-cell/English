import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireAdminMutation } from "@/lib/roster-api";
import { lockRosterMutationState } from "@/lib/roster-server";
import { actorAuditFields, operationFingerprint } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";

type Snapshot = { id: string; credentialRevision: number; tokenVersion: number };

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { batchId: sourceBatchId } = await params;
  const body = await req.json().catch(() => null);
  const operationId = typeof body?.operationId === "string" ? body.operationId : randomUUID();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const source = await tx.rosterImportBatch.findFirst({ where: { id: sourceBatchId, actorUserId: gate.auth.userId, status: "COMMITTED" }, select: { id: true, committedAt: true, summary: true } });
      if (!source || !source.committedAt) throw new Error("ROSTER_BATCH_NOT_FOUND");
      if (Date.now() - source.committedAt.getTime() > 24 * 60 * 60_000) throw new Error("CREDENTIAL_ROTATION_WINDOW_EXPIRED");
      const summaryObject = source.summary && typeof source.summary === "object" && !Array.isArray(source.summary) ? source.summary as Record<string, unknown> : {};
      const snapshots = Array.isArray(summaryObject.credentialSnapshots) ? summaryObject.credentialSnapshots as Snapshot[] : [];
      const links = await tx.rosterImportBatchUserLink.findMany({ where: { batchId: source.id, linkRole: "ROTATION_ELIGIBLE" }, select: { userId: true } });
      const ids = [...new Set(links.map((link) => link.userId))];
      const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, accountName: true, status: true, mustChangePassword: true, credentialRevision: true, tokenVersion: true } });
      const snapshotById = new Map(snapshots.map((item) => [item.id, item]));
      const eligible = users.filter((user) => {
        const expected = snapshotById.get(user.id);
        return Boolean(expected && user.status === "ACTIVE" && user.mustChangePassword && user.credentialRevision === expected.credentialRevision && user.tokenVersion === expected.tokenVersion);
      }).map((user) => ({ userId: user.id, accountName: user.accountName, credentialRevision: user.credentialRevision, tokenVersion: user.tokenVersion }));
      const conflicts = users.filter((user) => !eligible.some((item) => item.userId === user.id)).map((user) => ({ userId: user.id, accountName: user.accountName, reason: user.status !== "ACTIVE" ? "ACCOUNT_NOT_ACTIVE" : !user.mustChangePassword ? "PASSWORD_ALREADY_CHANGED" : "CREDENTIAL_REVISION_CHANGED" }));
      const payload = { sourceImportBatchId: source.id, eligible: eligible.map(({ userId, credentialRevision, tokenVersion }) => ({ userId, credentialRevision, tokenVersion })), conflicts: conflicts.map(({ userId, reason }) => ({ userId, reason })) };
      const batch = await tx.adminMutationBatch.create({ data: { actorUserId: gate.auth.userId, ...actorAuditFields(gate.auth.userId), operationKind: "ROTATE_CREDENTIALS", operationId, canonicalDigest: operationFingerprint(payload), payload, counts: { eligibleCount: eligible.length, conflictCount: conflicts.length }, expiresAt: new Date(Date.now() + 30 * 60_000) } });
      const linksToCreate = [...eligible.map((item) => ({ batchId: batch.id, userId: item.userId, linkRole: "ROTATION_ELIGIBLE" as const })), ...conflicts.map((item) => ({ batchId: batch.id, userId: item.userId, linkRole: "ROTATION_CONFLICT" as const }))];
      if (linksToCreate.length) await tx.adminMutationBatchUserLink.createMany({ data: linksToCreate });
      return { batchId: batch.id, operationId: batch.operationId, sourceImportBatchId: source.id, eligible, conflicts, expiresAt: batch.expiresAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const code = stableRosterCode(error, ["ROSTER_BATCH_NOT_FOUND", "CREDENTIAL_ROTATION_WINDOW_EXPIRED"], "CREDENTIAL_ROTATION_PREVIEW_FAILED");
    return NextResponse.json({ code }, { status: code === "ROSTER_BATCH_NOT_FOUND" ? 404 : 409, headers: { "Cache-Control": "no-store" } });
  }
}
