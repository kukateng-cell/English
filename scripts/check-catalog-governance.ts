import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";

dotenv.config({ path: ".env.local", override: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

async function main() {
  const batch = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, sourceDigest: true, catalogRevisionId: true, status: true } });
  if (!batch?.catalogRevisionId) throw new Error("No READY catalog batch with a catalog revision exists.");
  const [revision, status, sourceDataMissing, draftWithApproved, pendingIdentityMissing, activeSenses] = await Promise.all([
    prisma.catalogRevision.findUnique({ where: { id: batch.catalogRevisionId }, select: { id: true, status: true, activationBasis: true } }),
    prisma.wordSense.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.catalogImportRow.count({ where: { batchId: batch.id, sourceData: { equals: Prisma.JsonNull } } }),
    prisma.wordSense.count({ where: { status: "DRAFT", approvedRevisionId: { not: null } } }),
    prisma.catalogChangeRequest.count({ where: { status: "PENDING", OR: [{ catalogKey: null }, { senseKey: null }] } }),
    prisma.wordSense.findMany({ where: { status: "ACTIVE" }, select: { id: true, approvedRevisionId: true, approvedRevision: { select: { id: true, senseId: true, catalogRevision: { select: { status: true } } } }, wordProjection: { select: { senseId: true, contentRevisionId: true } } } }),
  ]);
  const activeMissingLineage = activeSenses.filter((sense) => !sense.approvedRevisionId || !sense.approvedRevision || sense.approvedRevision.senseId !== sense.id || sense.approvedRevision.catalogRevision?.status !== "READY").length;
  const projectionMismatch = activeSenses.filter((sense) => !sense.wordProjection || sense.wordProjection.senseId !== sense.id || sense.wordProjection.contentRevisionId !== sense.approvedRevisionId).length;
  const result = {
    ready: revision?.status === "READY" && sourceDataMissing === 0 && draftWithApproved === 0 && pendingIdentityMissing === 0 && activeMissingLineage === 0 && projectionMismatch === 0,
    batch,
    revision,
    status,
    sourceDataMissing,
    draftWithApproved,
    pendingIdentityMissing,
    activeCount: activeSenses.length,
    activeMissingLineage,
    projectionMismatch,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) throw new Error("catalog governance invariant failed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "catalog governance check failed");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
