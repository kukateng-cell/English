import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const topologyName = process.env.LOCAL_RESET_TOPOLOGY ?? "local-tcp-loopback-v6";
const targetConfirmation = process.env.CONFIRM_LOCAL_RESET_TARGET;
const environment = process.env.DATABASE_ENVIRONMENT;
const environmentConfirmation = process.env.CONFIRM_DATABASE_ENVIRONMENT;
const migrateUrl = process.env.MIGRATE_URL;

if (!migrateUrl) throw new Error("拒絕 reset：必须显式提供 MIGRATE_URL");
if (!(environment === "development" && environmentConfirmation === "development")) {
  throw new Error("拒絕 reset：DATABASE_ENVIRONMENT 与 CONFIRM_DATABASE_ENVIRONMENT 必须同为 development");
}

const topologies = JSON.parse(
  await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "local-reset-topology.json"), "utf8"),
);
const topology = topologies.find((entry) => entry.name === topologyName);
if (!topology) throw new Error("拒絕 reset：LOCAL_RESET_TOPOLOGY 不在 checked-in allowlist");

const url = new URL(migrateUrl);
const schema = url.searchParams.get("schema") || "public";
url.searchParams.delete("schema");
if (
  url.hostname !== topology.clientHost ||
  Number(url.port || 5432) !== topology.clientPort ||
  url.pathname.slice(1) !== topology.database ||
  schema !== topology.schema
) {
  throw new Error("拒絕 reset：client endpoint、database 或 schema 與 allowlist 不完全相同");
}
if (targetConfirmation !== `${topology.database}/${topology.schema}`) {
  throw new Error("拒絕 reset：CONFIRM_LOCAL_RESET_TARGET 必须精确匹配 database/schema");
}

const client = new pg.Client({ connectionString: url.toString() });
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

try {
  await client.connect();
  const metadata = await client.query(
    `SELECT current_database() AS database, current_schema() AS schema, current_user AS role,
            inet_server_addr()::text AS address, inet_server_port() AS port`,
  );
  const observed = metadata.rows[0];
  if (
    observed.database !== topology.database ||
    observed.schema !== topology.schema ||
    observed.role !== topology.dbRole ||
    observed.port !== topology.serverPort ||
    observed.address !== topology.serverAddress
  ) {
    throw new Error("拒絕 reset：server-observed database/schema/role/address/port 與 allowlist 不完全相同");
  }

  const relation = async (name) => {
    // PostgreSQL folds unquoted identifiers to lowercase.  Our canonical
    // tables (for example `User` and `DatabaseMetadata`) are quoted mixed
    // case, so the dry-run probe must pass a quoted qualified name or it
    // silently reports that the relation is absent.
    const qualified = `"${schema.replaceAll('"', '""')}"."${name.replaceAll('"', '""')}"`;
    const result = await client.query("SELECT to_regclass($1) AS relation", [qualified]);
    return Boolean(result.rows[0]?.relation);
  };
  const hasMigrations = await relation("_prisma_migrations");
  const hasMetadata = await relation("DatabaseMetadata");
  const hasUsers = await relation("User");
  const migration = hasMigrations
    ? await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schema)}."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)
    : { rows: [{ count: 0 }] };
  const marker = hasMetadata
    ? await client.query(`SELECT "value" FROM ${quoteIdentifier(schema)}."DatabaseMetadata" WHERE "key" = 'environment'`)
    : { rows: [] };
  const users = hasUsers
    ? await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schema)}."User"`)
    : { rows: [{ count: 0 }] };
  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    topology: topology.name,
    client: { host: topology.clientHost, port: topology.clientPort },
    server: observed,
    database: topology.database,
    schema: topology.schema,
    migrationCount: migration.rows[0].count,
    marker: marker.rows[0]?.value ?? null,
    userCount: users.rows[0].count,
  }, null, 2));

  if (!execute) {
    console.log("Dry-run only. Add --execute after reviewing the exact target summary.");
  } else {
    if (marker.rows[0]?.value && marker.rows[0].value !== "development") {
      throw new Error("拒絕 reset：DatabaseMetadata.environment 不是 development");
    }

  await client.query("BEGIN");
  await client.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
  await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  await client.query("COMMIT");

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const deploy = spawnSync(command, ["run", "db:deploy:local"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_ENVIRONMENT: environment,
      CONFIRM_DATABASE_ENVIRONMENT: environmentConfirmation,
    },
  });
  if (deploy.error) throw deploy.error;
  if (deploy.status !== 0) throw new Error(`local migration deploy exited with ${deploy.status}`);

  const markerClient = new pg.Client({ connectionString: url.toString() });
  await markerClient.connect();
  await markerClient.query(
    `INSERT INTO ${quoteIdentifier(schema)}."DatabaseMetadata" ("key", "value", "updatedAt")
     VALUES ('environment', 'development', CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`,
  );
  await markerClient.end();

  const seed = spawnSync(command, ["run", "seed"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_ENVIRONMENT: environment,
      CONFIRM_DATABASE_ENVIRONMENT: environmentConfirmation,
    },
  });
  if (seed.error) throw seed.error;
  if (seed.status !== 0) throw new Error(`seed exited with ${seed.status}`);
    console.log("Local roster reset, migration replay and seed completed.");
  }
} finally {
  await client.end().catch(() => undefined);
}
