-- Upgrade databases that briefly received the split ledger migrations during
-- development. Fresh databases already get this column in the first migration.
ALTER TABLE "ReviewEvent"
  ADD COLUMN IF NOT EXISTS "submittedWordId" TEXT;

UPDATE "ReviewEvent"
SET "submittedWordId" = COALESCE("wordId", 'unknown:' || "id")
WHERE "submittedWordId" IS NULL;

ALTER TABLE "ReviewEvent"
  ALTER COLUMN "submittedWordId" SET NOT NULL;

-- Refresh the rollout bridge on already-migrated databases so old writers also
-- preserve the immutable submitted ID.
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
    "wordLevel", "quality", "newlyUnlockedKeys", "isHistorical", "createdAt"
  )
  SELECT
    'cutover_' || md5(random()::text || clock_timestamp()::text || s.n::text),
    'cutover:' || NEW."id" || ':' || NEW."totalReviews" || ':' || s.n,
    NEW."userId", NEW."wordId", NEW."wordId", w."term", w."level", -1,
    ARRAY[]::TEXT[], false, COALESCE(NEW."lastReviewedAt", CURRENT_TIMESTAMP)
  FROM "Word" AS w
  CROSS JOIN generate_series(1, delta) AS s(n)
  WHERE w."id" = NEW."wordId"
  ON CONFLICT ("userId", "operationId") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
