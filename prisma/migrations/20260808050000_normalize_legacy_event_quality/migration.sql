-- Legacy bridge and historical backfill rows do not have a real score. Keep
-- quality numeric for schema compatibility, but normalize those rows to the
-- neutral value 0; eventKind is the source of semantic truth.
UPDATE "ReviewEvent"
SET "quality" = 0
WHERE "eventKind" <> 'REVIEW' AND "quality" <> 0;

ALTER TABLE "ReviewEvent"
  DROP CONSTRAINT "ReviewEvent_quality_by_kind_check";

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_quality_by_kind_check"
  CHECK (
    ("eventKind" = 'REVIEW' AND "quality" >= 0 AND "quality" <= 5) OR
    ("eventKind" <> 'REVIEW' AND "quality" = 0)
  );

-- Keep future compatibility-bridge rows on the same neutral value.
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
    'LEGACY_BRIDGE', 0, ARRAY[]::TEXT[], false,
    COALESCE(NEW."lastReviewedAt", CURRENT_TIMESTAMP)
  FROM "Word" AS w
  CROSS JOIN generate_series(1, delta) AS s(n)
  WHERE w."id" = NEW."wordId"
  ON CONFLICT ("userId", "operationId") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
