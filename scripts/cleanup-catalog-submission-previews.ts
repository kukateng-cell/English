import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });
const apply = process.argv.includes("--apply");
const environment = process.env.DATABASE_ENVIRONMENT;
const confirmation = process.env.CONFIRM_DATABASE_ENVIRONMENT;
if (apply && (!environment || confirmation !== environment)) throw new Error("--apply requires matching DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
if (apply && environment === "production" && process.env.CONFIRM_CATALOG_PREVIEW_CLEANUP !== "production") throw new Error("production cleanup requires CONFIRM_CATALOG_PREVIEW_CLEANUP=production");

async function main() {
  if (apply) {
    const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
    if (!metadata || metadata.value !== environment) throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  }
  const now = new Date();
  const purgeBefore = new Date(now.getTime() - 7 * 86_400_000);
  const candidates = await prisma.catalogSubmissionBatch.findMany({
    where: {
      OR: [
        { status: { in: ["PREVIEW", "NEEDS_RESOLUTION"] }, expiresAt: { lte: now } },
        { status: { in: ["EXPIRED", "CANCELLED"] }, submittedAt: null, updatedAt: { lte: purgeBefore }, contentPurgedAt: null },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, status: true, revision: true },
  });
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, candidates: candidates.length, expire: candidates.filter((item) => item.status === "PREVIEW" || item.status === "NEEDS_RESOLUTION").length, purge: candidates.filter((item) => item.status === "EXPIRED" || item.status === "CANCELLED").length }, null, 2));
    return;
  }
  let expired = 0;
  let purged = 0;
  for (const candidate of candidates) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CatalogSubmissionBatch" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const current = await tx.catalogSubmissionBatch.findUnique({ where: { id: candidate.id } });
      if (!current || current.revision !== candidate.revision) return;
      if ((current.status === "PREVIEW" || current.status === "NEEDS_RESOLUTION") && current.expiresAt <= now) {
        await tx.catalogSubmissionBatch.update({ where: { id: current.id, revision: current.revision }, data: { status: "FINALIZING", revision: { increment: 1 } } });
        await tx.catalogSubmissionBatch.update({ where: { id: current.id }, data: { status: "EXPIRED", revision: { increment: 1 } } });
        await tx.catalogAuditEvent.create({ data: { submissionBatchId: current.id, action: "BATCH_EXPIRED", fromStatus: current.status, toStatus: "EXPIRED" } });
        expired += 1;
      } else if ((current.status === "EXPIRED" || current.status === "CANCELLED") && !current.submittedAt && current.updatedAt <= purgeBefore && !current.contentPurgedAt) {
        await tx.$executeRaw`SELECT set_config('app.catalog_preview_purge', 'on', true)`;
        await tx.catalogSubmissionRow.deleteMany({ where: { batchId: current.id } });
        await tx.catalogSubmissionProposalAuthor.deleteMany({ where: { proposalGroup: { batchId: current.id } } });
        await tx.catalogSubmissionProposalGroup.deleteMany({ where: { batchId: current.id } });
        await tx.catalogSubmissionBatch.update({ where: { id: current.id, revision: current.revision }, data: { contentPurgedAt: now, revision: { increment: 1 } } });
        purged += 1;
      }
    });
  }
  console.log(JSON.stringify({ dryRun: false, expired, purged }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog preview cleanup failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
