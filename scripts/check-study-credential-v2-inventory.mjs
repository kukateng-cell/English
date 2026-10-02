import dotenv from "dotenv";
import pg from "pg";

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

const numberValue = (value) => Number(value ?? 0);

try {
  const relations = await pool.query(`
    SELECT
      to_regclass('"ReviewEvent"') IS NOT NULL AS "hasReviewEvent",
      to_regclass('"OperationReceipt"') IS NOT NULL AS "hasOperationReceipt",
      to_regclass('"StudySessionItem"') IS NOT NULL AS "hasStudySessionItem",
      to_regclass('"StudyStreamItem"') IS NOT NULL AS "hasStudyStreamItem"
  `);
  const shape = relations.rows[0];
  if (!shape.hasReviewEvent || !shape.hasOperationReceipt ||
      !shape.hasStudySessionItem || !shape.hasStudyStreamItem) {
    throw new Error("Credential v2 inventory requires all expand relations");
  }

  const legacy = await pool.query(`
    SELECT
      COUNT(*)::bigint AS "rows",
      COUNT(*) FILTER (WHERE "usedAt" IS NULL)::bigint AS "unusedRows",
      COUNT(*) FILTER (WHERE "renewedAt" IS NOT NULL)::bigint AS "renewedRows",
      COUNT(*) FILTER (WHERE "sourceItemId" IS NOT NULL)::bigint AS "lineageRows",
      COUNT(*) FILTER (WHERE "operationId" IS NOT NULL)::bigint AS "operationRows"
    FROM "StudySessionItem"
  `);
  const stream = await pool.query(`
    SELECT
      COUNT(*)::bigint AS "rows",
      COUNT(*) FILTER (WHERE "usedAt" IS NULL)::bigint AS "openRows",
      COUNT(*) FILTER (WHERE "itemKind" = 'OBJECTIVE_PROBE')::bigint AS "probeRows",
      COUNT(*) FILTER (WHERE "itemKind" = 'LEARNING_CARD')::bigint AS "learningRows"
    FROM "StudyStreamItem"
  `);
  const sessionFlows = await pool.query(`
    SELECT s."flowVersion", COUNT(*)::bigint AS "rows"
    FROM "StudySession" AS s
    GROUP BY s."flowVersion"
    ORDER BY s."flowVersion"
  `);
  const sameWord = await pool.query(`
    SELECT
      COUNT(*)::bigint AS "groups",
      COALESCE(MAX("itemCount"), 0)::bigint AS "maxItemsPerSessionWord"
    FROM (
      SELECT "sessionId", "wordId", COUNT(*)::bigint AS "itemCount"
      FROM "StudyStreamItem"
      WHERE "wordId" IS NOT NULL
      GROUP BY "sessionId", "wordId"
      HAVING COUNT(*) > 1
    ) AS duplicate_candidates
  `);
  const receipts = await pool.query(`
    SELECT
      COUNT(*)::bigint AS "rows",
      COUNT(*) FILTER (WHERE r."flowVersion" = 'v1')::bigint AS "v1Rows",
      COUNT(*) FILTER (WHERE r."flowVersion" = 'v2')::bigint AS "v2Rows"
    FROM "OperationReceipt" AS r
  `);
  const receiptGaps = await pool.query(`
    SELECT COUNT(*)::bigint AS "rows"
    FROM "ReviewEvent" AS e
    LEFT JOIN "OperationReceipt" AS r
      ON r."userId" = e."userId" AND r."operationId" = e."operationId"
    WHERE r."id" IS NULL
  `);
  const v2ProvenanceGaps = await pool.query(`
    SELECT COUNT(*)::bigint AS "rows"
    FROM "ReviewEvent"
    WHERE "flowVersion" = 'v2'
      AND (
        "eventKind" <> 'REVIEW'
        OR "evidenceKind" <> 'OBJECTIVE_PROBE'
        OR "objectiveEvidenceTargetId" IS NULL
        OR "objectiveQuestionSnapshotId" IS NULL
        OR "qualityPolicyVersion" IS NULL
        OR "itemConstructionVersion" IS NULL
        OR "probePurpose" IS NULL
      )
  `);
  const indexes = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('StudySessionItem', 'StudyStreamItem')
      AND (
        indexdef LIKE '%("sessionId", "wordId")%'
        OR indexdef LIKE '%("sessionId", "streamItemKey")%'
      )
    ORDER BY tablename, indexname
  `);

  const legacyRow = legacy.rows[0];
  const streamRow = stream.rows[0];
  const receiptRow = receipts.rows[0];
  const sameWordRow = sameWord.rows[0];
  const receiptGapCount = numberValue(receiptGaps.rows[0].rows);
  const v2GapCount = numberValue(v2ProvenanceGaps.rows[0].rows);
  const hasLegacyIdentityIndex = indexes.rows.some((row) =>
    row.indexdef.includes('"sessionId", "wordId"'));
  const hasStreamIdentityIndex = indexes.rows.some((row) =>
    row.indexdef.includes('"sessionId", "streamItemKey"'));

  console.log(
    `Credential v2 profile: legacy_session_items=${legacyRow.rows}, ` +
      `stream_items=${streamRow.rows}, sessions_by_flow=${JSON.stringify(sessionFlows.rows)}`,
  );
  console.log(
    `Legacy credential lineage: unused=${legacyRow.unusedRows}, ` +
      `renewed=${legacyRow.renewedRows}, source_links=${legacyRow.lineageRows}, ` +
      `operation_bound=${legacyRow.operationRows}`,
  );
  console.log(
    `V2 item profile: learning=${streamRow.learningRows}, probes=${streamRow.probeRows}, ` +
      `open=${streamRow.openRows}, same_word_groups=${sameWordRow.groups}, ` +
      `max_items_per_session_word=${sameWordRow.maxItemsPerSessionWord}`,
  );
  console.log(
    `Receipt profile: total=${receiptRow.rows}, v1=${receiptRow.v1Rows}, ` +
      `v2=${receiptRow.v2Rows}, review_event_gaps=${receiptGapCount}, ` +
      `v2_provenance_gaps=${v2GapCount}`,
  );
  console.log(
    `Identity indexes: legacy_session_word=${hasLegacyIdentityIndex}, ` +
      `v2_session_stream_key=${hasStreamIdentityIndex}`,
  );

  if (receiptGapCount > 0) {
    throw new Error("ReviewEvent rows without global OperationReceipt are not rollback-safe");
  }
  if (v2GapCount > 0) {
    throw new Error("V2 ReviewEvent provenance gaps detected");
  }
  if (!hasLegacyIdentityIndex || !hasStreamIdentityIndex) {
    throw new Error("Required V1/V2 identity indexes are missing");
  }
  console.log("Credential v2 inventory and compatibility profile passed");
} finally {
  await pool.end();
}
