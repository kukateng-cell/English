import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

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
  const shape = await pool.query(`
    SELECT
      to_regclass('"StudySessionItem"') IS NOT NULL AS "hasStudySessionItem",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'StudySessionItem'
          AND column_name = 'sourceItemId'
      ) AS "hasSourceItemId"
  `);
  const { hasStudySessionItem, hasSourceItemId } = shape.rows[0];
  if (!hasStudySessionItem || !hasSourceItemId) {
    throw new Error(
      "StudySessionItem.sourceItemId is unavailable; run the lineage migration before scanning",
    );
  }

  const gaps = await pool.query(`
    SELECT
      source."id" AS "sourceItemId",
      source."sessionId" AS "sourceSessionId",
      source_session."userId" AS "userId",
      source."wordId" AS "wordId",
      source."operationId" AS "operationId",
      source."renewedAt" AS "renewedAt",
      (
        SELECT COUNT(*)::int
        FROM "StudySessionItem" AS replacement
        JOIN "StudySession" AS replacement_session
          ON replacement_session."id" = replacement."sessionId"
        WHERE source."operationId" IS NOT NULL
          AND replacement."operationId" = source."operationId"
          AND replacement."wordId" = source."wordId"
          AND replacement."usedAt" IS NULL
          AND replacement."renewedAt" IS NULL
          AND replacement_session."userId" = source_session."userId"
          AND replacement_session."retiredAt" IS NULL
          AND replacement_session."expiresAt" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      ) AS "operationCredentialCount",
      EXISTS (
        SELECT 1
        FROM "StudySessionItem" AS replacement
        JOIN "StudySession" AS replacement_session
          ON replacement_session."id" = replacement."sessionId"
        WHERE replacement."sourceItemId" IS NULL
          AND replacement."wordId" = source."wordId"
          AND replacement_session."userId" = source_session."userId"
          AND replacement_session."rotationKey" =
            CONCAT('rotate-', source."sessionId")
      ) AS "recoverableByRotation"
    FROM "StudySessionItem" AS source
    JOIN "StudySession" AS source_session
      ON source_session."id" = source."sessionId"
    LEFT JOIN "StudySessionItem" AS successor
      ON successor."sourceItemId" = source."id"
    WHERE source."usedAt" IS NULL
      AND source."renewedAt" IS NOT NULL
      AND successor."id" IS NULL
    ORDER BY source."renewedAt" ASC, source."id" ASC
  `);

  let recoverableByOperationId = 0;
  let recoverableByRotation = 0;
  let ambiguousOperationCredentials = 0;
  let unresolved = 0;
  for (const gap of gaps.rows) {
    const operationCredentialCount = Number(gap.operationCredentialCount);
    const category =
      operationCredentialCount > 1
        ? "ambiguous_operation_credentials"
        : operationCredentialCount === 1
          ? "recoverable_by_operation_id"
          : gap.recoverableByRotation
            ? "recoverable_by_rotation"
            : "unresolved_lineage_gap";
    if (category === "recoverable_by_operation_id") {
      recoverableByOperationId += 1;
    } else if (category === "recoverable_by_rotation") {
      recoverableByRotation += 1;
    } else if (category === "ambiguous_operation_credentials") {
      ambiguousOperationCredentials += 1;
      unresolved += 1;
    } else {
      unresolved += 1;
    }

    const details = [
      `sourceItemId=${gap.sourceItemId}`,
      `sourceSessionId=${gap.sourceSessionId}`,
      `userId=${gap.userId}`,
      `wordId=${gap.wordId}`,
      `operationId=${gap.operationId ?? "<null>"}`,
    ];
    if (category === "ambiguous_operation_credentials") {
      details.push(`operationCredentialCount=${operationCredentialCount}`);
    }
    if (category === "unresolved_lineage_gap") {
      details.push(`renewedAt=${gap.renewedAt.toISOString()}`);
    }
    console.log(`${category} ${details.join(" ")}`);
  }

  console.log(
    `Study lineage compatibility scan: total=${gaps.rows.length}, ` +
      `recoverable_by_operation_id=${recoverableByOperationId}, ` +
      `recoverable_by_rotation=${recoverableByRotation}, ` +
      `ambiguous_operation_credentials=${ambiguousOperationCredentials}, ` +
      `unresolved_lineage_gap=${unresolved}`,
  );
  if (unresolved > 0) {
    console.error(
      "Study lineage compatibility scan found unresolved gaps; deployment is blocked until they are classified and repaired.",
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
