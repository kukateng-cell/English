import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.MIGRATE_URL;
if (!connectionString) throw new Error("MIGRATE_URL is required");
const reviewBackfillLimit = Number(
  process.env.REVIEW_BACKFILL_ROW_LIMIT ?? 100_000,
);
const studySessionItemMigrationLimit = Number(
  process.env.STUDY_SESSION_ITEM_MIGRATION_ROW_LIMIT ?? 100_000,
);
if (
  !Number.isSafeInteger(reviewBackfillLimit) ||
  reviewBackfillLimit < 0 ||
  !Number.isSafeInteger(studySessionItemMigrationLimit) ||
  studySessionItemMigrationLimit < 0
) {
  throw new Error("Migration row limits must be non-negative safe integers");
}
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
      to_regclass('"StudySessionItem"') IS NOT NULL AS "hasStudySessionItem"
  `);
  const { hasReview, hasReviewEvent, hasStudySessionItem } = relations.rows[0];
  let estimatedRows = 0;
  if (hasReview && !hasReviewEvent) {
    const estimate = await pool.query(
      `SELECT COALESCE(SUM("totalReviews"), 0)::bigint AS rows FROM "Review"`,
    );
    estimatedRows = Number(estimate.rows[0].rows);
  }
  let studySessionItemRows = 0;
  let studySessionItemSize = "not-present";
  let hasSourceItemId = false;
  if (hasStudySessionItem) {
    const lineageColumn = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'StudySessionItem'
          AND column_name = 'sourceItemId'
      ) AS "hasSourceItemId"
    `);
    hasSourceItemId = lineageColumn.rows[0].hasSourceItemId;
    const studyRows = await pool.query(
      `SELECT count(*)::bigint AS rows FROM "StudySessionItem"`,
    );
    studySessionItemRows = Number(studyRows.rows[0].rows);
    const studySize = await pool.query(`
      SELECT
        pg_total_relation_size('"StudySessionItem"')::bigint AS bytes,
        pg_size_pretty(
          pg_total_relation_size('"StudySessionItem"')
        ) AS size
    `);
    studySessionItemSize = studySize.rows[0].size;
  }
  const size = await pool.query(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  console.log(
    `Migration preflight: database=${size.rows[0].size}, estimated ReviewEvent backfill=${estimatedRows} rows`,
  );
  console.log(
    `StudySessionItem rows=${studySessionItemRows}, size=${studySessionItemSize}`,
  );
  if (
    estimatedRows > reviewBackfillLimit &&
    process.env.ALLOW_LARGE_REVIEW_BACKFILL !== "1"
  ) {
    throw new Error(
      `Estimated backfill exceeds ${reviewBackfillLimit} rows; plan a batched rollout and set ALLOW_LARGE_REVIEW_BACKFILL=1 only after approval`,
    );
  }
  if (
    hasStudySessionItem &&
    !hasSourceItemId &&
    studySessionItemRows > studySessionItemMigrationLimit &&
    process.env.ALLOW_LARGE_STUDY_SESSION_ITEM_MIGRATION !== "1"
  ) {
    throw new Error(
      "StudySessionItem is too large for automatic lineage migration. Inspect lock impact and perform a staged rollout before retrying.",
    );
  }
} finally {
  await pool.end();
}
