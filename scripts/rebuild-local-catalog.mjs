import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const environment = process.env.DATABASE_ENVIRONMENT;
const environmentConfirmation = process.env.CONFIRM_DATABASE_ENVIRONMENT;
const targetConfirmation = process.env.CONFIRM_LOCAL_RESET_TARGET;
const topologyName = process.env.LOCAL_RESET_TOPOLOGY ?? "local-tcp-loopback-v6";
const migrateUrl = process.env.MIGRATE_URL;
const runtimeUrl = process.env.DATABASE_URL;
const root = process.cwd();

function fail(message) { throw new Error(message); }
function quoteIdentifier(value) { return `"${value.replaceAll('"', '""')}"`; }
function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
async function actualCatalogDigest() {
  const files = [
    "outputs/a1-word-catalog-reference-v1/a1-word-catalog-reference-v1.csv",
    "outputs/a2-word-catalog-reference-v1/a2-word-catalog-reference-v1.csv",
    "outputs/b1-word-catalog-reference-v1/b1-word-catalog-reference-v1.csv",
    "outputs/b2-word-catalog-reference-v1/b2-word-catalog-reference-v1.csv",
  ];
  const parts = [];
  for (const relativePath of files) {
    const text = await readFile(path.join(root, relativePath), "utf8");
    parts.push(`${relativePath}\0${sha256(text)}`);
  }
  return sha256(parts.join("\n"));
}
function connectionTarget(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    schema: url.searchParams.get("schema") || "public",
  };
}
function run(command, commandArgs) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_ENVIRONMENT: environment,
      CONFIRM_DATABASE_ENVIRONMENT: environmentConfirmation,
      CATALOG_FINALIZE: "0",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
}

if (!migrateUrl || !runtimeUrl) fail("拒絕 catalog rebuild：MIGRATE_URL 與 DATABASE_URL 必須同時提供。");
if (environment !== "development" || environmentConfirmation !== "development") fail("拒絕 catalog rebuild：只容許 development 並要求相同 confirmation marker。");
const migrateTarget = connectionTarget(migrateUrl);
const runtimeTarget = connectionTarget(runtimeUrl);
if (JSON.stringify(migrateTarget) !== JSON.stringify(runtimeTarget)) fail("拒絕 catalog rebuild：MIGRATE_URL 與 DATABASE_URL target 不完全一致。");

const topologies = JSON.parse(await readFile(path.join(root, "scripts/local-reset-topology.json"), "utf8"));
const topology = topologies.find((entry) => entry.name === topologyName);
if (!topology) fail("拒絕 catalog rebuild：LOCAL_RESET_TOPOLOGY 不在 checked-in allowlist。");
if (
  migrateTarget.host !== topology.clientHost ||
  migrateTarget.port !== topology.clientPort ||
  migrateTarget.database !== topology.database ||
  migrateTarget.schema !== topology.schema
) fail("拒絕 catalog rebuild：target 不符合 local topology allowlist。");
if (targetConfirmation !== `${topology.database}/${topology.schema}`) fail("拒絕 catalog rebuild：CONFIRM_LOCAL_RESET_TARGET 必須精確匹配 database/schema。");

const manifest = JSON.parse(await readFile(path.join(root, "outputs/catalog-identity/word-catalog-v1.identity.json"), "utf8"));
const catalogDigest = manifest.sourceDigest;
const fileDigest = await actualCatalogDigest();
if (fileDigest !== catalogDigest) fail("拒絕 catalog rebuild：CSV 實際 digest 與 checked-in identity manifest 不一致。");
const confirmationDigest = process.env.CONFIRM_LOCAL_CATALOG_DIGEST;
if (execute && confirmationDigest !== catalogDigest) fail("拒絕 catalog rebuild：CONFIRM_LOCAL_CATALOG_DIGEST 必須精確匹配 CSV identity manifest digest。");

const adminTarget = new URL(migrateUrl);
adminTarget.searchParams.delete("schema");
const client = new pg.Client({ connectionString: adminTarget.toString() });
const schema = topology.schema;
let lockHeld = false;
try {
  await client.connect();
  const observed = (await client.query("SELECT current_database() AS database, current_schema() AS schema, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port")).rows[0];
  if (observed.database !== topology.database || observed.schema !== schema || observed.role !== topology.dbRole || observed.port !== topology.serverPort || observed.address !== topology.serverAddress) fail("拒絕 catalog rebuild：server-observed target 不符合 allowlist。");
  const qSchema = quoteIdentifier(schema);
  const count = async (table) => {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${qSchema}.${quoteIdentifier(table)}`);
    return result.rows[0].count;
  };
  const hasMetadata = (await client.query(`SELECT to_regclass($1) AS relation`, [`${schema}."DatabaseMetadata"`])).rows[0]?.relation;
  const marker = hasMetadata
    ? (await client.query(`SELECT "key", "value" FROM ${qSchema}."DatabaseMetadata" WHERE "key" IN ('environment', 'catalogRebuildState')`)).rows
    : [];
  const existing = {};
  for (const table of ["User", "Word", "WordSense", "Review", "ReviewEvent", "StudySession", "StudyStreamItem"]) {
    try { existing[table] = await count(table); } catch { existing[table] = null; }
  }
  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    topology: topology.name,
    target: { database: topology.database, schema: topology.schema, serverAddress: observed.address, serverPort: observed.port, role: observed.role },
    catalog: { sourceDigest: catalogDigest, manifestVersion: manifest.manifestVersion, assignments: manifest.assignments.length },
    environment,
    existing,
    marker,
    action: "drop schema → replay migrations → CSV catalog seed → roster seed → sense-level demo factory → checker → READY",
  }, null, 2));
  if (!execute) {
    console.log("Dry-run only. Review exact target and digest, then add --execute plus CONFIRM_LOCAL_CATALOG_DIGEST.");
    await client.end();
    process.exit(0);
  }

  await client.query("SELECT pg_advisory_lock(hashtext('catalog-local-rebuild-v1'))");
  lockHeld = true;
  const lockedFileDigest = await actualCatalogDigest();
  if (lockedFileDigest !== catalogDigest) fail("拒絕 catalog rebuild：取得 advisory lock 後 CSV 已改變，未執行 destructive reset。");
  if (execute && process.env.CONFIRM_LOCAL_CATALOG_DIGEST !== lockedFileDigest) fail("拒絕 catalog rebuild：digest confirmation 與 lock 後實際 CSV 不一致。");
  await client.query("BEGIN");
  await client.query(`DROP SCHEMA ${qSchema} CASCADE`);
  await client.query(`CREATE SCHEMA ${qSchema}`);
  await client.query("COMMIT");

  run("npm", ["run", "db:deploy:local"]);
  const markerClient = new pg.Client({ connectionString: adminTarget.toString() });
  await markerClient.connect();
  await markerClient.query(`INSERT INTO ${qSchema}."DatabaseMetadata" ("key", "value", "updatedAt") VALUES ('environment', 'development', CURRENT_TIMESTAMP), ('catalogRebuildState', 'BUILDING', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`);
  await markerClient.end();

  run("npm", ["run", "seed"]);
  run("npm", ["run", "seed:demo-analytics", "--", "--reset-and-rebuild", "--confirm-local-demo-reset"]);
  run("npm", ["run", "check:demo-analytics-fixture"]);

  await client.query(`UPDATE ${qSchema}."CatalogRevision" SET "status" = 'READY', "updatedAt" = CURRENT_TIMESTAMP WHERE "revisionKey" = $1`, [`catalog_${catalogDigest.slice(0, 24)}`]);
  await client.query(`UPDATE ${qSchema}."CatalogImportBatch" SET "status" = 'READY', "updatedAt" = CURRENT_TIMESTAMP WHERE "sourceDigest" = $1`, [catalogDigest]);
  run("npm", ["run", "check:catalog"]);

  const readyClient = new pg.Client({ connectionString: adminTarget.toString() });
  await readyClient.connect();
  await readyClient.query(`INSERT INTO ${qSchema}."DatabaseMetadata" ("key", "value", "updatedAt") VALUES ('catalogRebuildState', 'READY', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`);
  await readyClient.end();
  console.log("Local CSV catalog rebuild completed with READY state.");
} catch (error) {
  if (execute) {
    try {
      const failedClient = new pg.Client({ connectionString: adminTarget.toString() });
      await failedClient.connect();
      await failedClient.query(`INSERT INTO ${quoteIdentifier(schema)}."DatabaseMetadata" ("key", "value", "updatedAt") VALUES ('catalogRebuildState', 'FAILED', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`);
      await failedClient.end();
    } catch { /* preserve the original failure without leaking connection details */ }
  }
  throw error;
} finally {
  if (lockHeld) await client.query("SELECT pg_advisory_unlock(hashtext('catalog-local-rebuild-v1'))").catch(() => undefined);
  await client.end().catch(() => undefined);
}
