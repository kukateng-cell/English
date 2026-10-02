import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { catalogActorPseudonym } from "../src/lib/catalog/submission";
import { normalizeCatalogText } from "../src/lib/catalog/csv";
import { payloadFromRevision } from "../src/lib/catalog/governance";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");
const apply = process.argv.includes("--apply");
const environment = process.env.DATABASE_ENVIRONMENT;
if (apply && (!environment || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment)) {
  throw new Error("--apply requires matching DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}
if (apply && environment === "production" && process.env.CONFIRM_CATALOG_HISTORY_BACKFILL !== "production") {
  throw new Error("production backfill requires CONFIRM_CATALOG_HISTORY_BACKFILL=production");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function main() {
  const pendingWhere: Prisma.CatalogChangeRequestWhereInput = {
    OR: [
      { kind: { not: "CREATE" }, beforeNormalizedTermSnapshot: null },
      { afterNormalizedTermSnapshot: null },
      { afterPayloadSnapshot: { equals: Prisma.DbNull } },
      { actorPseudonym: null },
      { historyFeedEntry: null, submissionProposalGroupId: null },
    ],
  };
  if (!apply) {
    const [requests, standaloneFeed, batches, baseline] = await Promise.all([
      prisma.catalogChangeRequest.count({ where: pendingWhere }),
      prisma.catalogChangeRequest.count({ where: { submissionProposalGroupId: null, historyFeedEntry: null } }),
      prisma.catalogSubmissionBatch.count({ where: { submittedAt: { not: null }, historyFeedEntry: null } }),
      prisma.catalogImportBatch.count({ where: { status: "READY", historyFeedEntry: null } }),
    ]);
    console.log(JSON.stringify({ dryRun: true, requests, standaloneFeed, batches, baseline }, null, 2));
    return;
  }
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata && metadata.value !== environment) throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  let processed = 0;
  let unresolvedBefore = 0;
  let afterId: string | null = null;
  while (true) {
    const requests: Array<Prisma.CatalogChangeRequestGetPayload<{
      include: { sense: { include: { revisions: true } } };
    }>> = await prisma.catalogChangeRequest.findMany({
      where: {
        AND: [pendingWhere, ...(afterId ? [{ id: { gt: afterId } }] : [])],
      },
      orderBy: { id: "asc" },
      take: 200,
      include: {
        sense: { include: { revisions: { orderBy: { revision: "asc" } } } },
      },
    });
    if (!requests.length) break;
    for (const request of requests) {
      const before = request.sense?.revisions.find((revision) => revision.revision === request.baseRevision) ?? null;
      const after = record(request.payload);
      const afterTerm = typeof after.term === "string" ? after.term : before?.term ?? null;
      const afterDefinition = typeof after.definitionZh === "string" ? after.definitionZh : before?.definitionZh ?? null;
      const afterLevel = ["A1", "A2", "B1", "B2"].includes(String(after.level)) ? after.level as "A1" | "A2" | "B1" | "B2" : before?.level ?? null;
      const afterCategory = typeof after.category === "string" ? after.category : before?.category ?? null;
      const resultRevision = request.status === "APPROVED" && request.proposedRevision && request.sense
        ? request.sense.revisions.find((revision) => revision.revision === request.proposedRevision) ?? null
        : null;
      if (request.baseRevision && !before) unresolvedBefore += 1;
      const actor = catalogActorPseudonym(request.proposerId);
      await prisma.$transaction(async (tx) => {
        await tx.catalogChangeRequest.update({
          where: { id: request.id },
          data: {
            beforeTermSnapshot: request.beforeTermSnapshot ?? before?.term ?? null,
            afterTermSnapshot: request.afterTermSnapshot ?? afterTerm,
            beforeNormalizedTermSnapshot: request.beforeNormalizedTermSnapshot ?? (before ? normalizeCatalogText(before.term) : null),
            afterNormalizedTermSnapshot: request.afterNormalizedTermSnapshot ?? (afterTerm ? normalizeCatalogText(afterTerm) : null),
            beforeDefinitionSnapshot: request.beforeDefinitionSnapshot ?? before?.definitionZh ?? null,
            afterDefinitionSnapshot: request.afterDefinitionSnapshot ?? afterDefinition,
            beforeLevelSnapshot: request.beforeLevelSnapshot ?? before?.level ?? null,
            afterLevelSnapshot: request.afterLevelSnapshot ?? afterLevel,
            beforeCategorySnapshot: request.beforeCategorySnapshot ?? before?.category ?? null,
            afterCategorySnapshot: request.afterCategorySnapshot ?? afterCategory,
            beforePayloadSnapshot: request.beforePayloadSnapshot ?? (before ? json(payloadFromRevision(before)) : undefined),
            afterPayloadSnapshot: request.afterPayloadSnapshot ?? json(Object.keys(after).length ? after : before ? payloadFromRevision(before) : {}),
            resultRevisionId: request.resultRevisionId ?? resultRevision?.id ?? null,
            actorPseudonym: request.actorPseudonym ?? actor.value,
            actorKeyVersion: request.actorKeyVersion ?? actor.keyVersion,
          },
        });
        if (!request.submissionProposalGroupId) {
          await tx.catalogHistoryFeedEntry.upsert({
            where: { requestId: request.id },
            create: { occurredAt: request.createdAt, sourceKind: "STANDALONE_REQUEST", requestId: request.id },
            update: {},
          });
        }
      });
      processed += 1;
    }
    afterId = requests.at(-1)!.id;
  }
  const baseline = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (baseline) await prisma.catalogHistoryFeedEntry.upsert({ where: { initialImportBatchId: baseline.id }, create: { occurredAt: baseline.createdAt, sourceKind: "INITIAL_BASELINE", initialImportBatchId: baseline.id }, update: {} });
  const batches = await prisma.catalogSubmissionBatch.findMany({ where: { submittedAt: { not: null } }, select: { id: true, submittedAt: true, createdAt: true } });
  for (const batch of batches) await prisma.catalogHistoryFeedEntry.upsert({ where: { submissionBatchId: batch.id }, create: { occurredAt: batch.submittedAt ?? batch.createdAt, sourceKind: "BATCH", submissionBatchId: batch.id }, update: {} });
  console.log(JSON.stringify({ processed, unresolvedBefore, baselineCreated: Boolean(baseline), submissionBatches: batches.length }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog history backfill failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
