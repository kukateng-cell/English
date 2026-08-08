import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

const source = process.env.MIGRATE_URL;
if (!source) throw new Error("MIGRATE_URL is required for migration checksum audit");

const url = new URL(source);
const schema = url.searchParams.get("schema") || "public";
url.searchParams.delete("schema");
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

const client = new pg.Client({ connectionString: url.toString() });
try {
  await client.connect();
  const table = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = '_prisma_migrations'`,
    [schema],
  );
  if (table.rowCount === 0) {
    console.log("Migration checksum audit passed (new database)");
    process.exitCode = 0;
  } else {
    const applied = await client.query(
      `SELECT migration_name, checksum
         FROM ${quoteIdentifier(schema)}."_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const local = new Map(
      readdirSync("prisma/migrations", { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const sql = readFileSync(
            `prisma/migrations/${entry.name}/migration.sql`,
          );
          return [
            entry.name,
            createHash("sha256").update(sql).digest("hex"),
          ];
        }),
    );
    const mismatches = applied.rows.flatMap((row) => {
      const checksum = local.get(row.migration_name);
      return checksum && checksum === row.checksum ? [] : [row.migration_name];
    });
    if (mismatches.length > 0) {
      throw new Error(
        `Applied migration checksum mismatch: ${mismatches.join(", ")}. ` +
          "Refuse to deploy; restore the immutable migration files or migrate data into a fresh canonical database/schema. Do not edit _prisma_migrations by hand.",
      );
    }
    console.log("Migration checksum audit passed");
  }
} finally {
  await client.end().catch(() => undefined);
}
