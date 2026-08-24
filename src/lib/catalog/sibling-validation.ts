import type { Prisma } from "@/lib/prisma";
import { normalizeCatalogRow, normalizeCatalogText, type NormalizedCatalogRow } from "./csv";
import { payloadFromRevision, payloadToSourceRow, type CatalogGovernancePayload } from "./governance";

export async function loadCatalogSiblingValidationRows(
  client: Pick<Prisma.TransactionClient, "wordSense">,
  payload: CatalogGovernancePayload,
  excludeSenseKey?: string,
): Promise<NormalizedCatalogRow[]> {
  const siblings = await client.wordSense.findMany({
    where: {
      normalizedTerm: normalizeCatalogText(payload.term),
      ...(excludeSenseKey ? { senseKey: { not: excludeSenseKey } } : {}),
    },
    include: {
      catalogEntry: { select: { catalogKey: true } },
      revisions: { orderBy: { revision: "desc" }, take: 1 },
      approvedRevision: true,
    },
  });
  return siblings.flatMap((sibling) => {
    const revision = sibling.approvedRevision ?? sibling.revisions[0];
    if (!revision) return [];
    return [normalizeCatalogRow(payloadToSourceRow(payloadFromRevision(revision), {
      catalogKey: sibling.catalogEntry.catalogKey,
      senseKey: sibling.senseKey,
      sourceFile: "sibling",
      sourceRow: 0,
    }, revision.revision), 0)];
  });
}
