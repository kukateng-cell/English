import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma, Prisma } = await import("../src/lib/prisma");
  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RosterMutationState" WHERE "id" = 1 FOR UPDATE`;
      const importBatches = await tx.rosterImportBatch.findMany({
        where: { status: { in: ["PREVIEWED", "EXPIRED"] }, expiresAt: { lte: now } },
        select: { id: true },
      });
      const mutationBatches = await tx.adminMutationBatch.findMany({
        where: { status: { in: ["PREVIEWED", "EXPIRED"] }, expiresAt: { lte: now } },
        select: { id: true },
      });
      if (importBatches.length) {
        await tx.rosterImportBatch.updateMany({
          where: { id: { in: importBatches.map((item) => item.id) } },
          data: { status: "EXPIRED", stagedRows: Prisma.JsonNull, errorReport: Prisma.JsonNull },
        });
      }
      if (mutationBatches.length) {
        await tx.adminMutationBatch.updateMany({
          where: { id: { in: mutationBatches.map((item) => item.id) } },
          data: { status: "EXPIRED", payload: Prisma.JsonNull, errorReport: Prisma.JsonNull },
        });
      }
      const rotationLinks = await tx.rosterImportBatchUserLink.deleteMany({ where: { linkRole: "ROTATION_ELIGIBLE", batch: { status: "COMMITTED", committedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } } } });
      return { importBatches: importBatches.length, mutationBatches: mutationBatches.length, rotationLinks: rotationLinks.count };
    });
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.name : "cleanup-failed");
  process.exitCode = 1;
});
