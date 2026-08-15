import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const environment = process.env.DATABASE_ENVIRONMENT;
const confirmation = process.env.CONFIRM_DATABASE_ENVIRONMENT;
if (!((environment === "development" || environment === "test") && confirmation === environment)) {
  throw new Error(
    "拒絕 local expand：DATABASE_ENVIRONMENT 與 CONFIRM_DATABASE_ENVIRONMENT 必須同為 development 或 test",
  );
}
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");

const sourceUrl = new URL(process.env.MIGRATE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)) {
  throw new Error("local expand 只接受 localhost PostgreSQL");
}

const adminUrl = new URL(sourceUrl);
const schema = adminUrl.searchParams.get("schema") || "public";
adminUrl.searchParams.delete("schema");
const client = new pg.Client({ connectionString: adminUrl.toString() });
const migrationPath = await mkdtemp(join(process.cwd(), ".local-migrations-"));

try {
  await client.connect();
  const migrationTable = await client.query(
    "SELECT to_regclass($1) AS relation",
    [`${schema}._prisma_migrations`],
  );
  const applied = migrationTable.rows[0]?.relation
    ? await client.query(
        `SELECT migration_name FROM "${schema.replaceAll('"', '""')}"."_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          AND migration_name = ANY($1::text[])`,
        [[
          "20260809019000_atomic_contract_legacy_review_bridge",
          "20260809020000_contract_legacy_review_bridge",
        ]],
      )
    : { rows: [] };
  const appliedNames = new Set(applied.rows.map((row) => row.migration_name));
  const roots = appliedNames.size === 2
    ? ["prisma/migrations", "prisma/contract-migrations"]
    : ["prisma/migrations"];

  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const destination = join(migrationPath, entry.name);
      await mkdir(destination);
      await copyFile(join(process.cwd(), root, entry.name, "migration.sql"), join(destination, "migration.sql"));
    }
  }

  const configPath = join(migrationPath, "prisma.local.config.ts");
  await writeFile(
    configPath,
    `import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(join(process.cwd(), "prisma", "schema.prisma"))},
  migrations: { path: ${JSON.stringify(migrationPath)} },
  datasource: { url: process.env.MIGRATE_URL ?? "postgresql://invalid" },
});
`,
  );

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["prisma", "migrate", "deploy", "--config", configPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      PGOPTIONS: process.env.PGOPTIONS ?? "-c lock_timeout=10s -c statement_timeout=30min",
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await client.end().catch(() => undefined);
  await rm(migrationPath, { recursive: true, force: true });
}
