import { createHash } from "node:crypto";
import { Prisma, prisma } from "@/lib/prisma";

export interface CatalogWorkspaceVersion {
  signature: string;
  mutationRevision: number;
  pendingCount: number;
  pendingHasMore: boolean;
}

export function catalogWorkspaceSignature(
  mutationRevision: number,
  pendingDigest: string,
  pendingCount: number,
): string {
  const hash = createHash("sha256");
  hash.update(`${mutationRevision}:${pendingCount}:${pendingDigest}`);
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
  const pendingState = await prisma.$queryRaw<Array<{ pendingCount: number; pendingDigest: string }>>(Prisma.sql`
    SELECT
      COUNT(*)::integer AS "pendingCount",
      md5(COALESCE(
        string_agg(
          request."id" || ':' || request."revision"::text,
          E'\\x1f'
          ORDER BY request."createdAt", request."id"
        ),
        ''
      )) AS "pendingDigest"
    FROM "CatalogChangeRequest" request
    WHERE request."status"::text = 'PENDING'
      AND request."submissionProposalGroupId" IS NULL
  `);
  const pendingCount = pendingState[0]?.pendingCount ?? 0;
  const pendingDigest = pendingState[0]?.pendingDigest ?? "";
  return {
    signature: catalogWorkspaceSignature(mutationRevision, pendingDigest, pendingCount),
    mutationRevision,
    pendingCount,
    pendingHasMore: pendingCount > 1000,
  };
}
