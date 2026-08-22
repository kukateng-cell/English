import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { CATALOG_IDENTITY_MANIFEST_PATH } from "../src/lib/catalog/identity";

dotenv.config({ path: ".env.local", override: true });

const environment = process.env.DATABASE_ENVIRONMENT;
const confirmation = process.env.CONFIRM_DATABASE_ENVIRONMENT;
if (environment !== "development" || confirmation !== "development") {
  throw new Error("Initial catalog activation is restricted to development and requires CONFIRM_DATABASE_ENVIRONMENT=development.");
}
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");

const topologyName = process.env.LOCAL_RESET_TOPOLOGY ?? "local-tcp-loopback-v6";
const targetConfirmation = process.env.CONFIRM_LOCAL_RESET_TARGET;
const topologies = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/local-reset-topology.json"), "utf8")) as Array<{ name: string; clientHost: string; clientPort: number; database: string; schema: string; serverAddress: string; serverPort: number; dbRole: string }>;
const topology = topologies.find((item) => item.name === topologyName);
if (!topology) throw new Error("Initial catalog activation target is not in the checked-in local topology allowlist.");
const localTopology = topology;
if (targetConfirmation !== `${localTopology.database}/${localTopology.schema}`) throw new Error("CONFIRM_LOCAL_RESET_TARGET must exactly match the checked-in local database/schema.");

const migrateUrl = new URL(process.env.MIGRATE_URL);
const schema = migrateUrl.searchParams.get("schema") || "public";
if (migrateUrl.hostname !== localTopology.clientHost || Number(migrateUrl.port || 5432) !== localTopology.clientPort || migrateUrl.pathname.slice(1) !== localTopology.database || schema !== localTopology.schema) {
  throw new Error("Initial catalog activation target does not match the checked-in local topology.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

async function main() {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), CATALOG_IDENTITY_MANIFEST_PATH), "utf8")) as { sourceDigest?: unknown };
  if (typeof manifest.sourceDigest !== "string" || !manifest.sourceDigest) throw new Error("Catalog identity manifest has no source digest.");
  const sourceDigest = manifest.sourceDigest;
  if (process.env.CONFIRM_LOCAL_CATALOG_DIGEST !== sourceDigest) throw new Error("CONFIRM_LOCAL_CATALOG_DIGEST must exactly match the checked-in catalog digest.");

  const adminUrl = new URL(migrateUrl);
  adminUrl.searchParams.delete("schema");
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const observed = (await client.query("SELECT current_database() AS database, current_schema() AS schema, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port")).rows[0] as { database: string; schema: string; role: string; address: string; port: number };
    if (observed.database !== localTopology.database || observed.schema !== localTopology.schema || observed.role !== localTopology.dbRole || observed.port !== localTopology.serverPort || observed.address !== localTopology.serverAddress) {
      throw new Error("Initial catalog activation server-observed target does not match the checked-in local topology.");
    }
    const metadataRelation = (await client.query("SELECT to_regclass($1) AS relation", [`${localTopology.schema}.\"DatabaseMetadata\"`])).rows[0]?.relation;
    if (metadataRelation) {
      const metadata = await client.query(`SELECT "key", "value" FROM "${localTopology.schema}"."DatabaseMetadata" WHERE "key" IN ('environment', 'catalogRebuildState')`);
      const values = new Map(metadata.rows.map((row: { key: string; value: string }) => [row.key, row.value]));
      if (values.get("environment") !== "development" || (values.has("catalogRebuildState") && values.get("catalogRebuildState") !== "READY")) {
        throw new Error("DatabaseMetadata does not identify a READY development catalog target.");
      }
    }
  } finally {
    await client.end();
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.catalogImportBatch.findUnique({
      where: { sourceDigest },
      select: { id: true, sourceDigest: true, catalogRevisionId: true, status: true },
    });
    if (!batch?.catalogRevisionId || batch.status !== "READY") throw new Error("The checked-in catalog batch is not READY.");
    const catalogRevision = await tx.catalogRevision.findUnique({ where: { id: batch.catalogRevisionId }, select: { id: true, status: true, activationBasis: true } });
    if (!catalogRevision || catalogRevision.status !== "READY") throw new Error("The checked-in catalog revision is not READY.");

    const eligibilities = await tx.catalogEligibility.findMany({
      where: { catalogRevisionId: catalogRevision.id, environment: "development", basis: "LOCAL_DEMO_BOOTSTRAP" },
      select: { senseId: true, senseRevisionId: true },
    });
    let activated = 0;
    for (const eligibility of eligibilities) {
      const sense = await tx.wordSense.findUnique({ where: { id: eligibility.senseId }, select: { id: true, status: true, approvedRevisionId: true } });
      if (!sense || sense.status !== "DRAFT" || sense.approvedRevisionId) continue;
      const revision = await tx.wordSenseRevision.findUnique({ where: { id: eligibility.senseRevisionId }, select: { id: true, senseId: true } });
      if (!revision || revision.senseId !== sense.id) continue;
      await tx.wordSense.update({ where: { id: sense.id }, data: { status: "ACTIVE", approvedRevisionId: revision.id } });
      activated += 1;
    }

    if (activated > 0) {
      await tx.catalogRevision.update({ where: { id: catalogRevision.id }, data: { activationBasis: "INITIAL_CURATED_ACTIVE" } });
      await tx.catalogAuditEvent.create({
        data: {
          action: "INITIAL_ACTIVE_BOOTSTRAP",
          toStatus: "ACTIVE",
          revision: 1,
          metadata: { sourceDigest, activated, eligibleRows: eligibilities.length, basis: "LOCAL_DEMO_BOOTSTRAP" },
        },
      });
    }

    const [active, draft, retired] = await Promise.all([
      tx.wordSense.count({ where: { status: "ACTIVE", revisions: { some: { catalogRevisionId: catalogRevision.id } } } }),
      tx.wordSense.count({ where: { status: "DRAFT", revisions: { some: { catalogRevisionId: catalogRevision.id } } } }),
      tx.wordSense.count({ where: { status: "RETIRED", revisions: { some: { catalogRevisionId: catalogRevision.id } } } }),
    ]);
    return { sourceDigest, activated, eligibleRows: eligibilities.length, active, draft, retired };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "initial catalog activation failed");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
