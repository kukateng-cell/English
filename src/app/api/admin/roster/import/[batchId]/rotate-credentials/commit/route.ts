import { NextResponse } from "next/server";
import { prisma, Prisma } from "@/lib/prisma";
import { requireAdminMutation } from "@/lib/roster-api";
import { lockRosterMutationState } from "@/lib/roster-server";
import { prepareCredentials } from "@/lib/credential-batch";
import { replacePasswordCredential } from "@/lib/password-credentials";
import { securityEventData } from "@/lib/security-events";
import { getClientIp } from "@/lib/login-limiter";
import { operationFingerprint, readReceiptForCommit, writeAdminReceipt } from "@/lib/admin-receipts";
import { stableRosterCode } from "@/lib/roster-api";

type RotationItem = { userId: string; credentialRevision: number; tokenVersion: number };
type RotationPayload = { sourceImportBatchId: string; eligible: RotationItem[]; conflicts: Array<{ userId: string; reason: string }> };

export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const gate = await requireAdminMutation(req);
  if (!gate.ok) return gate.response;
  const { batchId } = await params;
  const body = await req.json().catch(() => null);
  const requestedOperationId = typeof body?.operationId === "string" ? body.operationId : null;
  const batch = await prisma.adminMutationBatch.findFirst({ where: { id: batchId, actorUserId: gate.auth.userId, operationKind: "ROTATE_CREDENTIALS" } });
  if (!batch) return NextResponse.json({ code: "MUTATION_BATCH_NOT_FOUND" }, { status: 404 });
  if (requestedOperationId && requestedOperationId !== batch.operationId) return NextResponse.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  if (batch.status === "COMMITTED") return NextResponse.json({ ok: true, alreadyCommitted: true, credentialReportAvailable: false, counts: batch.counts }, { headers: { "Cache-Control": "no-store" } });
  if (batch.status !== "PREVIEWED" || batch.expiresAt <= new Date()) return NextResponse.json({ code: "MUTATION_BATCH_EXPIRED" }, { status: 410 });
  const payload = batch.payload as RotationPayload | null;
  if (!payload) return NextResponse.json({ code: "MUTATION_BATCH_INVALID" }, { status: 409 });
  const users = await prisma.user.findMany({ where: { id: { in: payload.eligible.map((item) => item.userId) } }, select: { id: true, accountName: true } });
  const accountById = new Map(users.map((user) => [user.id, user.accountName]));
  const credentials = await prepareCredentials(payload.eligible.map((item) => accountById.get(item.userId) ?? ""), payload.eligible.map((item) => item.userId));
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockRosterMutationState(tx);
      const locked = await tx.adminMutationBatch.findFirst({ where: { id: batch.id, actorUserId: gate.auth.userId, operationKind: "ROTATE_CREDENTIALS" } });
      if (!locked || locked.status !== "PREVIEWED" || locked.expiresAt <= new Date()) throw new Error("MUTATION_BATCH_EXPIRED");
      const operationId = locked.operationId;
      const requestFingerprint = operationFingerprint({ operationKind: "ROTATE_CREDENTIALS", batchId: locked.id, operationId, canonicalDigest: locked.canonicalDigest });
      const replay = await readReceiptForCommit(tx, { actorUserId: gate.auth.userId, operationKind: "ROTATE_CREDENTIALS", operationId, requestFingerprint });
      if (replay) return { replay: true, counts: replay };
      const updated: Array<{ userId: string; accountName: string }> = [];
      for (const item of payload.eligible) {
        const credential = credentials.find((value) => value.userId === item.userId);
        if (!credential) throw new Error("CREDENTIAL_MISSING");
        const user = await tx.user.findUnique({ where: { id: item.userId }, select: { id: true, accountName: true, status: true, mustChangePassword: true, credentialRevision: true, tokenVersion: true } });
        if (!user || user.status !== "ACTIVE" || !user.mustChangePassword || user.credentialRevision !== item.credentialRevision || user.tokenVersion !== item.tokenVersion) throw new Error("CREDENTIAL_ROTATION_STALE");
        const ok = await replacePasswordCredential(tx, { userId: user.id, passwordHash: credential.passwordHash, mustChangePassword: true, expectedCredentialRevision: item.credentialRevision, expectedTokenVersion: item.tokenVersion });
        if (!ok) throw new Error("CREDENTIAL_ROTATION_STALE");
        updated.push({ userId: user.id, accountName: user.accountName });
      }
      const counts = { rotatedCount: updated.length, conflictCount: payload.conflicts.length };
      await tx.adminMutationBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date(), counts, payload: Prisma.JsonNull, errorReport: Prisma.JsonNull } });
      await writeAdminReceipt(tx, { actorUserId: gate.auth.userId, operationKind: "ROTATE_CREDENTIALS", operationId, requestFingerprint, outcomeStatus: "COMMITTED", summary: counts });
      await tx.securityEvent.create({ data: securityEventData({ actorUserId: gate.auth.userId, subjectAccount: `credential-rotation:${batch.id}`, eventType: "IMPORT_CREDENTIALS_ROTATED", ip: getClientIp(req.headers), metadata: counts }) });
      return { replay: false, counts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
    const legalNames = await prisma.user.findMany({ where: { id: { in: payload.eligible.map((item) => item.userId) } }, select: { id: true, studentProfile: { select: { legalName: true } }, teacherProfile: { select: { legalName: true } } } });
    const names = new Map(legalNames.map((user) => [user.id, user.studentProfile?.legalName ?? user.teacherProfile?.legalName ?? ""]));
    if (result.replay) return NextResponse.json({ ok: true, alreadyCommitted: true, summary: result.counts, credentialReportAvailable: false }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    return NextResponse.json({ ok: true, summary: result.counts, credentials: credentials.map((item) => ({ accountName: item.accountName, legalName: names.get(item.userId ?? "") ?? "", temporaryPassword: item.temporaryPassword })) }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const code = stableRosterCode(error, ["MUTATION_BATCH_EXPIRED", "CREDENTIAL_ROTATION_STALE", "CREDENTIAL_MISSING"], "CREDENTIAL_ROTATION_FAILED");
    return NextResponse.json({ code }, { status: code === "MUTATION_BATCH_EXPIRED" ? 410 : 409 });
  }
}
