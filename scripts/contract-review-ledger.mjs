import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const connectionString = process.env.MIGRATE_URL;
if (!connectionString) throw new Error("MIGRATE_URL is required");
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

try {
  const compatibilityObjects = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'Review_capture_legacy_event' AND NOT tgisinternal
      ) AS "hasTrigger",
      to_regprocedure('"capture_legacy_review_event"()') IS NOT NULL AS "hasFunction"
  `);
  const { hasTrigger, hasFunction } = compatibilityObjects.rows[0];
  if (!hasTrigger && !hasFunction) {
    console.log("Legacy review bridge is already removed.");
    process.exitCode = 0;
  } else {
    const recent = await pool.query(`
      SELECT COUNT(*)::integer AS count
      FROM "ReviewEvent"
      WHERE "eventKind" = 'LEGACY_BRIDGE'
        AND "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '30 minutes'
    `);
    if (recent.rows[0].count > 0) {
      throw new Error(
        `Refusing contract: ${recent.rows[0].count} legacy writes were observed in the last 30 minutes`,
      );
    }
    if (!apply) {
      console.log("Ledger contract preflight passed; rerun with --apply to remove the bridge.");
    } else {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query(
          'DROP TRIGGER IF EXISTS "Review_capture_legacy_event" ON "Review"',
        );
        await client.query(
          'DROP FUNCTION IF EXISTS "capture_legacy_review_event"()',
        );
        await client.query("COMMIT");
        console.log("Legacy review bridge trigger and function removed.");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }
} finally {
  await pool.end();
}
