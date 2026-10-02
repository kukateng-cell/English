import { createHash } from "node:crypto";
import type { Prisma, AdminMutationKind } from "@/generated/prisma";
import { auditKeyVersion, hashSecurityAuditValue } from "@/lib/security-events";

type DbClient = Prisma.TransactionClient;

export function operationFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function actorAuditFields(actorUserId: string) {
  return {
    actorPseudonym: `actor-v1:${hashSecurityAuditValue(actorUserId)}`,
    hmacKeyVersion: auditKeyVersion(),
  };
}

/**
 * A commit route calls this while holding its batch/mutation locks.  Returning
 * the stored summary makes an HTTP retry safe; a different request payload for
 * the same operation id is a stable 409 instead of a second mutation.
 */
export async function readReceiptForCommit(
  tx: DbClient,
  input: { actorUserId: string; operationKind: AdminMutationKind; operationId: string; requestFingerprint: string },
) {
  const receipt = await readAdminReceipt(tx, input);
  if (!receipt) return null;
  if (receipt.requestFingerprint !== input.requestFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
  return receipt.summary;
}

export async function readAdminReceipt(
  tx: DbClient,
  input: { actorUserId: string; operationKind: AdminMutationKind; operationId: string },
) {
  return tx.adminOperationReceipt.findUnique({
    where: {
      actorUserId_operationKind_operationId: {
        actorUserId: input.actorUserId,
        operationKind: input.operationKind,
        operationId: input.operationId,
      },
    },
  });
}

export async function writeAdminReceipt(
  tx: DbClient,
  input: {
    actorUserId: string;
    operationKind: AdminMutationKind;
    operationId: string;
    requestFingerprint: string;
    outcomeStatus: string;
    summary: Prisma.InputJsonValue;
  },
) {
  return tx.adminOperationReceipt.upsert({
    where: {
      actorUserId_operationKind_operationId: {
        actorUserId: input.actorUserId,
        operationKind: input.operationKind,
        operationId: input.operationId,
      },
    },
    create: {
      actorUserId: input.actorUserId,
      ...actorAuditFields(input.actorUserId),
      operationKind: input.operationKind,
      operationId: input.operationId,
      requestFingerprint: input.requestFingerprint,
      outcomeStatus: input.outcomeStatus,
      summary: input.summary,
    },
    update: {},
  });
}

export function receiptSummary(value: unknown): Prisma.InputJsonValue {
  if (value === null || typeof value !== "object") return { value: String(value ?? "") };
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
