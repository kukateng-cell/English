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
      to_regclass('"ReviewEvent"') IS NOT NULL AS "hasReviewEvent"
  `);
  const { hasReview, hasReviewEvent } = relations.rows[0];
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
} finally {
  await pool.end();
}
