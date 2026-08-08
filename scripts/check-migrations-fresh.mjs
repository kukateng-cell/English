import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

const source = process.env.MIGRATE_URL;
if (!source) {
  throw new Error("MIGRATE_URL is required for a fresh migration check");
}

const sourceUrl = new URL(source);
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)) {
  throw new Error(
    "Fresh migration check only creates temporary databases on localhost",
  );
}

const schemaName = `codex_migration_check_${randomBytes(8).toString("hex")}`;
const interruptedSchema = `codex_migration_interrupted_${randomBytes(8).toString("hex")}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const adminUrl = new URL(sourceUrl);
adminUrl.searchParams.delete("schema");
const temporaryUrl = new URL(sourceUrl);
temporaryUrl.searchParams.set("schema", schemaName);

const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
let interruptedCreated = false;

async function verifyLedger(client, schema) {
  const columns = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'ReviewEvent'`,
    [schema],
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const required of [
    "submittedWordId",
    "wordId",
    "wordTerm",
    "wordLevel",
    "isHistorical",
  ]) {
    if (!names.has(required)) throw new Error(`ReviewEvent.${required} is missing`);
  }

  const foreignKey = await client.query(
    `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_name = rc.constraint_name
        AND tc.constraint_schema = rc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = 'ReviewEvent'
        AND tc.constraint_type = 'FOREIGN KEY'`,
    [schema],
  );
  if (!foreignKey.rows.some((row) => row.delete_rule === "SET NULL")) {
    throw new Error("ReviewEvent word foreign key is not ON DELETE SET NULL");
  }
}

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
  created = true;

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const deployed = spawnSync(command, ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, MIGRATE_URL: temporaryUrl.toString() },
  });
  if (deployed.error) throw deployed.error;
  if (deployed.status !== 0) {
    throw new Error(`prisma migrate deploy exited with ${deployed.status}`);
  }

  const check = new pg.Client({ connectionString: adminUrl.toString() });
  await check.connect();
  await verifyLedger(check, schemaName);

  // Simulate an interrupted rollout that applied the original minimal first
  // ledger migration, but stopped before hardening. The current second migration
  // must expand that shape itself; it cannot depend on the third migration.
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(interruptedSchema)}`);
  interruptedCreated = true;
  await check.query(`SET search_path TO ${quoteIdentifier(interruptedSchema)}`);
  for (const migration of [
    "20260724030000_init",
    "20260724030001_add_user_role",
    "20260725030000_add_user_token_version",
    "20260728030000_add_user_must_change_password",
    "20260728030001_add_b2_level",
    "20260802000000_add_study_day",
    "20260802010000_add_user_achievement",
  ]) {
    await check.query(
      readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
  }
  await check.query(`
    CREATE TABLE "ReviewEvent" (
      "id" TEXT PRIMARY KEY,
      "operationId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "wordId" TEXT NOT NULL,
      "quality" INTEGER NOT NULL,
      "newlyUnlockedKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "ReviewEvent_userId_operationId_key"
      ON "ReviewEvent"("userId", "operationId");
    CREATE INDEX "ReviewEvent_userId_createdAt_idx"
      ON "ReviewEvent"("userId", "createdAt");
    CREATE INDEX "ReviewEvent_wordId_idx" ON "ReviewEvent"("wordId");
    ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_wordId_fkey"
      FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    INSERT INTO "User" ("id", "email", "passwordHash", "mustChangePassword")
      VALUES ('fixture-user', 'fixture-user', 'x', false);
    INSERT INTO "Word" ("id", "term", "definition", "level", "synonyms", "antonyms")
      VALUES ('fixture-word', 'fixture', 'fixture', 'A1', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
    INSERT INTO "Review" ("id", "userId", "wordId", "nextReviewDate", "totalReviews")
      VALUES ('fixture-review', 'fixture-user', 'fixture-word', CURRENT_TIMESTAMP, 1);
    INSERT INTO "ReviewEvent" (
      "id", "operationId", "userId", "wordId", "quality", "createdAt"
    ) VALUES (
      'legacy:fixture-review:1', 'legacy:fixture-review:1', 'fixture-user',
      'fixture-word', 0, CURRENT_TIMESTAMP
    );
  `);
  await check.query(
    readFileSync(
      "prisma/migrations/20260808010000_harden_review_event_ledger/migration.sql",
      "utf8",
    ),
  );
  await check.query(
    readFileSync(
      "prisma/migrations/20260808020000_preserve_submitted_word_id/migration.sql",
      "utf8",
    ),
  );
  await verifyLedger(check, interruptedSchema);
  await check.query(`DELETE FROM "Word" WHERE "id" = 'fixture-word'`);
  const retained = await check.query(
    `SELECT "submittedWordId", "wordId", "wordTerm", "isHistorical"
       FROM "ReviewEvent" WHERE "operationId" = 'legacy:fixture-review:1'`,
  );
  if (
    retained.rows.length !== 1 ||
    retained.rows[0].submittedWordId !== "fixture-word" ||
    retained.rows[0].wordId !== null ||
    retained.rows[0].wordTerm !== "fixture" ||
    retained.rows[0].isHistorical !== true
  ) {
    throw new Error("interrupted ledger upgrade did not preserve its snapshot");
  }
  await check.end();

  console.log("Fresh and interrupted migration replay checks passed");
} finally {
  if (interruptedCreated) {
    await admin.query(
      `DROP SCHEMA ${quoteIdentifier(interruptedSchema)} CASCADE`,
    );
  }
  if (created) {
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
  }
  await admin.end().catch(() => undefined);
}
