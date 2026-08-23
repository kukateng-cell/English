import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export interface CatalogWorkspaceVersion {
  signature: string;
  mutationRevision: number;
  pendingCount: number;
  pendingHasMore: boolean;
}

export function catalogWorkspaceSignature(
  mutationRevision: number,
  pending: Array<{ id: string; revision: number }>,
  pendingHasMore: boolean,
): string {
  const hash = createHash("sha256");
  hash.update(`${mutationRevision}:${pendingHasMore ? "1" : "0"}`);
  for (const request of pending) hash.update(`\0${request.id}:${request.revision}`);
  return hash.digest("hex");
}

/**
 * Version the two independently loaded halves of the governance workspace.
 * Canonical catalog changes advance mutationRevision; queue-only changes such
 * as REJECT/CANCEL are captured by the pending request ids and revisions.
 */
export async function readCatalogWorkspaceVersion(): Promise<CatalogWorkspaceVersion> {
  const mutationRevision = (await prisma.catalogMutationState.findUnique({
    where: { id: 1 },
    select: { revision: true },
  }))?.revision ?? 0;
  const pending = await prisma.catalogChangeRequest.findMany({
    where: { status: "PENDING", submissionProposalGroupId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1001,
    select: { id: true, revision: true },
  });
  const pendingHasMore = pending.length > 1000;
  return {
    signature: catalogWorkspaceSignature(mutationRevision, pending, pendingHasMore),
    mutationRevision,
    pendingCount: Math.min(pending.length, 1000),
    pendingHasMore,
  };
}
