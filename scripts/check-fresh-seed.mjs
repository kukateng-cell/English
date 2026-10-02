import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL required");
const source = new URL(process.env.MIGRATE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(source.hostname)) throw new Error("Fresh seed test is localhost-only");
source.searchParams.delete("schema");
const name = `catalog_fresh_${randomBytes(8).toString("hex")}`;
const temporary = new URL(source);
temporary.pathname = `/${name}`;
temporary.searchParams.set("schema", "public");
const env = { ...process.env, MIGRATE_URL: temporary.href, DATABASE_URL: temporary.href,
  DATABASE_ENVIRONMENT: "test", CONFIRM_DATABASE_ENVIRONMENT: "test",
  INITIAL_ADMIN_PASSWORD: `Fresh!${randomBytes(16).toString("hex")}`, SEED_STUDENTS: "0", SEED_TEST_STUDENT: "1",
  TEST_STUDENT_USERNAME: "__test_student__fresh_seed", TEST_STUDENT_PASSWORD: `Student!${randomBytes(16).toString("hex")}`,
  CATALOG_REQUIRE_INITIAL_BASELINE: "1", CATALOG_FINALIZE: "1" };
const admin = new pg.Client(process.env.FRESH_SEED_ADMIN_USER
  ? { host: "/tmp", database: "postgres", user: process.env.FRESH_SEED_ADMIN_USER }
  : { connectionString: source.href });
let created = false;
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
try {
  await admin.connect();
  const owner = decodeURIComponent(source.username).replaceAll('"', '""');
  await admin.query(`CREATE DATABASE "${name}" OWNER "${owner}"`);
  created = true;
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npm", ["run", "seed"]);
  run("npm", ["run", "check:catalog"]);
  // Test-account creation deliberately refuses existing accounts. Repeat only
  // the normal catalog/role bootstrap, without requesting new test accounts.
  env.SEED_TEST_STUDENT = "0";
  env.SEED_TEST_ACCOUNT = "0";
  run("npm", ["run", "seed"]);
  run("npm", ["run", "check:catalog"]);
  const checkUrl = new URL(temporary); checkUrl.searchParams.delete("schema");
  const check = new pg.Client({ connectionString: checkUrl.href });
  await check.connect();
  try {
    const { rows } = await check.query('SELECT "email" AS "accountName", "role" FROM "User"');
    for (const [account, role] of [["admin", "ADMIN"], ["teacher", "TEACHER"], ["teacher-reset", "TEACHER"], [env.TEST_STUDENT_USERNAME, "STUDENT"]]) {
      assert.equal(rows.find(row => row.accountName === account)?.role, role);
    }
    console.log("Fresh PostgreSQL migrations -> seed -> accounts/catalog -> repeated seed passed");
  } finally { await check.end(); }
} finally {
  // Only this newly created random test database is eligible for cleanup.
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
