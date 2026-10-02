import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { normalizeCatalogText } from "../src/lib/catalog/csv";
import { isCatalogCategory } from "../src/lib/catalog/taxonomy";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

async function main() {
  const batch = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, sourceDigest: true, catalogRevisionId: true, status: true } });
  if (!batch?.catalogRevisionId) throw new Error("No READY catalog batch with a catalog revision exists.");
  const [revision, status, sourceDataMissing, draftWithApproved, pendingIdentityMissing, activeSenses, obsoleteEligibilityCount, identitySenses, catalogEntries, finalizingSubmissionBatches, terminalBatchesWithPendingChildren, mutationStates, historySourceViolations, submissionTriggers] = await Promise.all([
    prisma.catalogRevision.findUnique({ where: { id: batch.catalogRevisionId }, select: { id: true, status: true, activationBasis: true } }),
    prisma.wordSense.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.catalogImportRow.count({ where: { batchId: batch.id, sourceData: { equals: Prisma.JsonNull } } }),
    prisma.wordSense.count({ where: { status: "DRAFT", approvedRevisionId: { not: null } } }),
    prisma.catalogChangeRequest.count({ where: { status: "PENDING", OR: [{ catalogKey: null }, { senseKey: null }] } }),
    prisma.wordSense.findMany({ where: { status: "ACTIVE" }, select: { id: true, approvedRevisionId: true, approvedRevision: { select: { id: true, senseId: true, catalogRevision: { select: { status: true } } } }, wordProjection: { select: { senseId: true, contentRevisionId: true } } } }),
    prisma.catalogEligibility.count(),
    prisma.wordSense.findMany({
      select: {
        senseKey: true,
        category: true,
        catalogEntry: { select: { lemma: true, normalizedLemma: true } },
        approvedRevision: { select: { lemma: true, category: true } },
        revisions: { orderBy: { revision: "desc" }, take: 1, select: { lemma: true, category: true } },
      },
    }),
    prisma.catalogEntry.findMany({ select: { id: true, normalizedLemma: true } }),
    prisma.catalogSubmissionBatch.count({ where: { status: "FINALIZING" } }),
    prisma.catalogSubmissionBatch.count({ where: { status: { in: ["COMMITTED", "REJECTED", "STALE", "EXPIRED", "CANCELLED", "SUPERSEDED"] }, proposalGroups: { some: { changeRequest: { is: { status: "PENDING" } } } } } }),
    prisma.catalogMutationState.findMany({ select: { id: true, revision: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "CatalogHistoryFeedEntry"
      WHERE num_nonnulls("requestId", "submissionBatchId", "initialImportBatchId") <> 1
    `,
    prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN (
        'CatalogChangeRequest_batch_transition_guard',
        'CatalogSubmissionBatch_terminal_children_guard',
        'CatalogChangeRequest_terminal_parent_guard'
      ) AND NOT tgisinternal
    `,
  ]);
  const activeMissingLineage = activeSenses.filter((sense) => !sense.approvedRevisionId || !sense.approvedRevision || sense.approvedRevision.senseId !== sense.id || sense.approvedRevision.catalogRevision?.status !== "READY").length;
  const projectionMismatch = activeSenses.filter((sense) => !sense.wordProjection || sense.wordProjection.senseId !== sense.id || sense.wordProjection.contentRevisionId !== sense.approvedRevisionId).length;
  const lemmaIdentityMismatch = identitySenses.filter((sense) => {
    const currentRevision = sense.approvedRevision ?? sense.revisions[0];
    return normalizeCatalogText(sense.catalogEntry.lemma) !== sense.catalogEntry.normalizedLemma
      || Boolean(currentRevision && normalizeCatalogText(currentRevision.lemma) !== sense.catalogEntry.normalizedLemma);
  }).length;
  const unknownCategoryCount = identitySenses.filter((sense) => {
    const currentRevision = sense.approvedRevision ?? sense.revisions[0];
    return !isCatalogCategory(currentRevision?.category ?? sense.category);
  }).length;
  const normalizedLemmaCounts = new Map<string, number>();
  for (const entry of catalogEntries) normalizedLemmaCounts.set(entry.normalizedLemma, (normalizedLemmaCounts.get(entry.normalizedLemma) ?? 0) + 1);
  const duplicateNormalizedLemmaGroups = [...normalizedLemmaCounts.values()].filter((count) => count > 1).length;
  const result = {
    ready: revision?.status === "READY" && revision.activationBasis === "INITIAL_BASELINE_MANIFEST" && sourceDataMissing === 0 && draftWithApproved === 0 && pendingIdentityMissing === 0 && activeMissingLineage === 0 && projectionMismatch === 0 && obsoleteEligibilityCount === 0 && lemmaIdentityMismatch === 0 && unknownCategoryCount === 0 && duplicateNormalizedLemmaGroups === 0 && finalizingSubmissionBatches === 0 && terminalBatchesWithPendingChildren === 0 && mutationStates.length === 1 && mutationStates[0]?.id === 1 && Number(historySourceViolations[0]?.count ?? 0) === 0 && submissionTriggers.length === 3,
    batch,
    revision,
    status,
    sourceDataMissing,
    draftWithApproved,
    pendingIdentityMissing,
    activeCount: activeSenses.length,
    activeMissingLineage,
    projectionMismatch,
    obsoleteEligibilityCount,
    lemmaIdentityMismatch,
    unknownCategoryCount,
    duplicateNormalizedLemmaGroups,
    finalizingSubmissionBatches,
    terminalBatchesWithPendingChildren,
    mutationStates,
    historySourceViolations: Number(historySourceViolations[0]?.count ?? 0),
    submissionTriggers: submissionTriggers.map((item) => item.tgname).sort(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) throw new Error("catalog governance invariant failed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "catalog governance check failed");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
