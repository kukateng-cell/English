import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { CATALOG_SOURCE_FILES } from "../src/lib/catalog/seed";
import { CATALOG_IDENTITY_MANIFEST_PATH } from "../src/lib/catalog/identity";
import { withCurrentCatalogWord } from "../src/lib/catalog/runtime";
import { readFile } from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config();
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");
const environment = process.env.DATABASE_ENVIRONMENT;
if (environment !== "development" && environment !== "test" && environment !== "production") throw new Error("DATABASE_ENVIRONMENT is invalid.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

function fail(message: string): never { throw new Error(message); }

async function main() {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), CATALOG_IDENTITY_MANIFEST_PATH), "utf8")) as { sourceDigest: string; assignments: unknown[] };
  const batch = await prisma.catalogImportBatch.findUnique({ where: { sourceDigest: manifest.sourceDigest }, include: { rows: true, catalogRevision: true } });
  if (!batch) fail("最新 CSV catalog import batch 不存在。");
  if (batch.rows.length !== manifest.assignments.length || batch.rows.length !== 5641) fail(`import row reconciliation 失敗：${batch.rows.length}`);
  const dispositions = new Map<string, number>();
  for (const row of batch.rows) dispositions.set(row.primaryDisposition, (dispositions.get(row.primaryDisposition) ?? 0) + 1);
  const eligibility = await prisma.catalogEligibility.groupBy({ by: ["environment"], where: { catalogRevisionId: batch.catalogRevisionId ?? "" }, _count: { _all: true } });
  const projectionCount = await prisma.word.count({ where: withCurrentCatalogWord() });
  const senseCount = await prisma.wordSense.count({ where: { status: { not: "RETIRED" }, revisions: { some: { catalogRevisionId: batch.catalogRevisionId ?? "" } } } });
  const mismatches = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT SUM(item_count)::bigint AS count
    FROM (
      SELECT COUNT(*)::bigint AS item_count FROM "Review" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "ReviewEvent" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "StudyStreamItem" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "EvidenceObligation" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "ObjectiveEvidenceTarget" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "ObjectiveQuestionSnapshot" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
      UNION ALL SELECT COUNT(*)::bigint FROM "StudyEncounter" item JOIN "Word" word ON word."id" = item."wordId" WHERE item."wordId" IS NOT NULL AND item."senseId" IS NOT NULL AND word."senseId" IS DISTINCT FROM item."senseId"
    ) counts
  `);
  const identityMismatchCount = Number(mismatches[0]?.count ?? BigInt(0));
  const failed = dispositions.get("VALIDATION_FAILED") ?? 0;
  const eligible = eligibility.find((row) => row.environment === environment)?._count._all ?? 0;
  const expectedImportedSenses = batch.rows.length - failed - (dispositions.get("MERGED") ?? 0) - (dispositions.get("CONFLICT") ?? 0);
  if (senseCount !== expectedImportedSenses || projectionCount !== eligible || identityMismatchCount !== 0 || (environment === "production" && eligible !== 0)) {
    fail(`catalog count invariant failed: ${JSON.stringify({ senseCount, projectionCount, failed, eligible, identityMismatchCount, environment })}`);
  }
  if (batch.catalogRevision?.sourceDigest !== manifest.sourceDigest || batch.catalogRevision.status !== "READY") fail("catalog revision digest／READY state 不一致。");
  console.log(JSON.stringify({
    ready: true,
    sourceFiles: CATALOG_SOURCE_FILES.length,
    sourceDigest: manifest.sourceDigest,
    rows: batch.rows.length,
    dispositions: Object.fromEntries(dispositions),
    eligibility,
    senseCount,
    projectionCount,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog import check failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
