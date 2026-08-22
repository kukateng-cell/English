import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { CATALOG_SOURCE_FILES } from "../src/lib/catalog/seed";
import { CATALOG_IDENTITY_MANIFEST_PATH } from "../src/lib/catalog/identity";
import {
  catalogSenseKeySetDigest,
  readCatalogInitialActivationManifest,
} from "../src/lib/catalog/initial-activation";
import { withCurrentCatalogWord } from "../src/lib/catalog/runtime";
import { readFile } from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config();
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });
const requireInitialBaseline = process.env.CATALOG_REQUIRE_INITIAL_BASELINE === "1";

function fail(message: string): never { throw new Error(message); }

async function main() {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), CATALOG_IDENTITY_MANIFEST_PATH), "utf8")) as { sourceDigest: string; assignments: unknown[] };
  const activationManifest = await readCatalogInitialActivationManifest(
    process.cwd(),
    manifest.sourceDigest,
  );
  const batch = await prisma.catalogImportBatch.findUnique({ where: { sourceDigest: manifest.sourceDigest }, include: { rows: true, catalogRevision: true } });
  if (!batch) fail("最新 CSV catalog import batch 不存在。");
  if (batch.rows.length !== manifest.assignments.length || batch.rows.length !== 5641) fail(`import row reconciliation 失敗：${batch.rows.length}`);
  const dispositions = new Map<string, number>();
  for (const row of batch.rows) dispositions.set(row.primaryDisposition, (dispositions.get(row.primaryDisposition) ?? 0) + 1);
  const activationResults = new Map<string, number>();
  for (const row of batch.rows) {
    const result = row.eligibilityResult ?? "UNCLASSIFIED";
    activationResults.set(result, (activationResults.get(result) ?? 0) + 1);
  }
  const importedSenseKeys = [...new Set(batch.rows.flatMap((row) =>
    row.senseKey &&
    row.primaryDisposition !== "VALIDATION_FAILED" &&
    row.primaryDisposition !== "MERGED" &&
    row.primaryDisposition !== "CONFLICT"
      ? [row.senseKey]
      : [],
  ))];
  const [projectionCount, senseCount, activeSenses, draftSenses, obsoleteEligibilityCount] = await Promise.all([
    prisma.word.count({ where: withCurrentCatalogWord({ senseKey: { in: importedSenseKeys } }) }),
    prisma.wordSense.count({ where: { senseKey: { in: importedSenseKeys } } }),
    prisma.wordSense.findMany({ where: { senseKey: { in: importedSenseKeys }, status: "ACTIVE" }, select: { senseKey: true } }),
    prisma.wordSense.findMany({ where: { senseKey: { in: importedSenseKeys }, status: "DRAFT" }, select: { senseKey: true } }),
    prisma.catalogEligibility.count(),
  ]);
  const activeCount = activeSenses.length;
  const draftCount = draftSenses.length;
  const selectionDigests = {
    activeSenseKeysSha256: catalogSenseKeySetDigest(activeSenses.map((sense) => sense.senseKey)),
    draftSenseKeysSha256: catalogSenseKeySetDigest(draftSenses.map((sense) => sense.senseKey)),
  };
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
  const expectedImportedSenses = importedSenseKeys.length;
  const currentInvariantFailed =
    senseCount !== expectedImportedSenses ||
    projectionCount !== activeCount ||
    obsoleteEligibilityCount !== 0 ||
    identityMismatchCount !== 0;
  const initialBaselineDrift = requireInitialBaseline && (
    senseCount !== activationManifest.expected.validRows ||
    activeCount !== activationManifest.expected.activeSenses ||
    draftCount !== activationManifest.expected.draftSenses ||
    failed !== activationManifest.expected.validationFailedRows ||
    (activationResults.get("ACTIVATION_ELIGIBLE") ?? 0) !== activationManifest.expected.activeSenses ||
    selectionDigests.activeSenseKeysSha256 !== activationManifest.selectionDigests.activeSenseKeysSha256 ||
    selectionDigests.draftSenseKeysSha256 !== activationManifest.selectionDigests.draftSenseKeysSha256
  );
  if (currentInvariantFailed || initialBaselineDrift) {
    fail(`catalog count invariant failed: ${JSON.stringify({ senseCount, activeCount, draftCount, projectionCount, failed, activationResults: Object.fromEntries(activationResults), selectionDigests, obsoleteEligibilityCount, identityMismatchCount })}`);
  }
  if (batch.catalogRevision?.sourceDigest !== manifest.sourceDigest || batch.catalogRevision.status !== "READY") fail("catalog revision digest／READY state 不一致。");
  console.log(JSON.stringify({
    ready: true,
    sourceFiles: CATALOG_SOURCE_FILES.length,
    sourceDigest: manifest.sourceDigest,
    requireInitialBaseline,
    rows: batch.rows.length,
    dispositions: Object.fromEntries(dispositions),
    activationResults: Object.fromEntries(activationResults),
    senseCount,
    activeCount,
    draftCount,
    selectionDigests,
    projectionCount,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "catalog import check failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
