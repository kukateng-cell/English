-- Give review ledger rows an explicit semantic kind instead of using quality=-1
-- as a magic value for events produced by the rollout bridge.
CREATE TYPE "ReviewEventKind" AS ENUM (
  'REVIEW',
  'LEGACY_BRIDGE',
  'HISTORICAL_BACKFILL'
);

ALTER TABLE "ReviewEvent"
  ADD COLUMN "eventKind" "ReviewEventKind" NOT NULL DEFAULT 'REVIEW';

UPDATE "ReviewEvent"
SET "eventKind" = 'HISTORICAL_BACKFILL'
WHERE "isHistorical" = true OR "operationId" LIKE 'legacy:%';

UPDATE "ReviewEvent"
SET "eventKind" = 'LEGACY_BRIDGE'
WHERE "isHistorical" = false AND "operationId" LIKE 'cutover:%';

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_quality_by_kind_check"
  CHECK (
    "eventKind" <> 'REVIEW' OR
    ("quality" >= 0 AND "quality" <= 5)
  );

-- Refresh the expand/contract bridge so new legacy rows are self-describing.
CREATE OR REPLACE FUNCTION "capture_legacy_review_event"()
RETURNS trigger AS $$
DECLARE
  previous_total INTEGER := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD."totalReviews" END;
  delta INTEGER := NEW."totalReviews" - previous_total;
BEGIN
  IF current_setting('app.review_event_writer', true) = 'v2' OR delta <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO "ReviewEvent" (
    "id", "operationId", "userId", "submittedWordId", "wordId", "wordTerm",
    "wordLevel", "eventKind", "quality", "newlyUnlockedKeys", "isHistorical", "createdAt"
  )
  SELECT
    'cutover_' || md5(random()::text || clock_timestamp()::text || s.n::text),
    'cutover:' || NEW."id" || ':' || NEW."totalReviews" || ':' || s.n,
    NEW."userId", NEW."wordId", NEW."wordId", w."term", w."level",
    'LEGACY_BRIDGE', -1, ARRAY[]::TEXT[], false,
    COALESCE(NEW."lastReviewedAt", CURRENT_TIMESTAMP)
  FROM "Word" AS w
  CROSS JOIN generate_series(1, delta) AS s(n)
  WHERE w."id" = NEW."wordId"
  ON CONFLICT ("userId", "operationId") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
