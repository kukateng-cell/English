import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.MIGRATE_URL;
if (!connectionString) throw new Error("MIGRATE_URL is required");
const threshold = Number(process.env.REVIEW_BACKFILL_ROW_LIMIT ?? 100_000);
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

try {
  const relations = await pool.query(`
    SELECT
      to_regclass('"Review"') IS NOT NULL AS "hasReview",
      to_regclass('"ReviewEvent"') IS NOT NULL AS "hasReviewEvent",
      to_regclass('"_prisma_migrations"') IS NOT NULL AS "hasMigrations"
  `);
  const { hasReview, hasReviewEvent, hasMigrations } = relations.rows[0];
  let estimatedRows = 0;
  if (hasReview && !hasReviewEvent) {
    const estimate = await pool.query(
      `SELECT COALESCE(SUM("totalReviews"), 0)::bigint AS rows FROM "Review"`,
    );
    estimatedRows = Number(estimate.rows[0].rows);
  }
  const size = await pool.query(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  console.log(
    `Migration preflight: database=${size.rows[0].size}, estimated ReviewEvent backfill=${estimatedRows} rows`,
  );
  if (
    estimatedRows > threshold &&
    process.env.ALLOW_LARGE_REVIEW_BACKFILL !== "1"
  ) {
    throw new Error(
      `Estimated backfill exceeds ${threshold} rows; plan a batched rollout and set ALLOW_LARGE_REVIEW_BACKFILL=1 only after approval`,
    );
  }

  if (hasMigrations) {
    const contract = await pool.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20260808010000_harden_review_event_ledger'
            AND finished_at IS NOT NULL
            AND rolled_back_at IS NULL
        ) AS bridge_installed,
        EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20260809019000_atomic_contract_legacy_review_bridge'
            AND finished_at IS NOT NULL
            AND rolled_back_at IS NULL
        ) AS applied
    `);
    const state = contract.rows[0];
    if (
      state.bridge_installed &&
      !state.applied &&
      process.env.CONFIRM_LEDGER_BRIDGE_CONTRACT !== "REMOVE_LEGACY_BRIDGE"
    ) {
      throw new Error(
        "Ledger bridge contract is pending on a database with the old-writer bridge; run the explicitly confirmed contract workflow before normal deployment",
      );
    }
  }
} finally {
  await pool.end();
}
