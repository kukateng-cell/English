import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const source = process.env.MIGRATE_URL;
if (!source) throw new Error("MIGRATE_URL is required for contract migration regression");

const sourceUrl = new URL(source);
if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)) {
  throw new Error("Contract migration regression only creates schemas on localhost");
}

const schema = `codex_contract_check_${randomBytes(8).toString("hex")}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const adminUrl = new URL(sourceUrl);
adminUrl.searchParams.delete("schema");
const temporaryUrl = new URL(sourceUrl);
temporaryUrl.searchParams.set("schema", schema);
const command = process.platform === "win32" ? "npx.cmd" : "npx";

function run(commandName, args, env) {
  const result = spawnSync(commandName, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      PGOPTIONS:
        env.PGOPTIONS ??
        process.env.PGOPTIONS ??
        "-c lock_timeout=10s -c statement_timeout=30min",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${commandName} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function bridgeExists(client) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relname = 'Review'
         AND t.tgname = 'Review_capture_legacy_event'
         AND NOT t.tgisinternal
     ) AS trigger_exists,
     EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1
         AND p.proname = 'capture_legacy_review_event'
     ) AS function_exists`,
    [schema],
  );
  return result.rows[0].trigger_exists && result.rows[0].function_exists;
}

const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  created = true;

  const env = {
    MIGRATE_URL: temporaryUrl.toString(),
    CONFIRM_DATABASE_ENVIRONMENT: "test",
    DATABASE_ENVIRONMENT: "test",
    PGOPTIONS: `-c search_path=${schema},public -c lock_timeout=10s -c statement_timeout=30min`,
  };
  run(command, ["prisma", "migrate", "deploy"], env);
  if (!(await bridgeExists(admin))) {
    throw new Error("expand deployment did not install the legacy review bridge");
  }

  run(process.execPath, ["scripts/apply-ledger-contract.mjs"], {
    ...env,
    CONFIRM_LEDGER_BRIDGE_CONTRACT: "REMOVE_LEGACY_BRIDGE",
  });
  if (await bridgeExists(admin)) {
    throw new Error("contract deployment did not remove the legacy review bridge");
  }

  // A future ordinary deployment must still be able to read the database
  // after the separately-confirmed contract migrations have run.
  run(command, ["prisma", "migrate", "deploy"], env);
  console.log("Expand/contract/ordinary migration regression passed");
} finally {
  if (created) {
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
  }
  await admin.end().catch(() => undefined);
}
