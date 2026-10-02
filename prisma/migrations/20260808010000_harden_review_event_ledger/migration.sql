-- Preserve the immutable review ledger when vocabulary rows are deleted, and
-- distinguish aggregate legacy backfill from events with an exact timestamp.
ALTER TABLE "ReviewEvent"
  ADD COLUMN "wordTerm" TEXT,
  ADD COLUMN "wordLevel" "Level",
  ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ReviewEvent" AS e
SET "wordTerm" = w."term", "wordLevel" = w."level"
FROM "Word" AS w
WHERE e."wordId" = w."id";

UPDATE "ReviewEvent"
SET "isHistorical" = true
WHERE "operationId" LIKE 'legacy:%';

ALTER TABLE "ReviewEvent"
  ALTER COLUMN "wordTerm" SET NOT NULL,
  ALTER COLUMN "wordLevel" SET NOT NULL;

ALTER TABLE "ReviewEvent"
  DROP CONSTRAINT "ReviewEvent_wordId_fkey",
  ALTER COLUMN "wordId" DROP NOT NULL;

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Expand/contract bridge: old application instances only update Review. Keep a
-- trigger until every writer has moved to the v2 ledger. The v2 transaction sets
-- app.review_event_writer=v2, so it does not receive a duplicate trigger event.
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
    "id", "operationId", "userId", "wordId", "wordTerm", "wordLevel",
    "quality", "newlyUnlockedKeys", "isHistorical", "createdAt"
  )
  SELECT
    'cutover_' || md5(random()::text || clock_timestamp()::text || s.n::text),
    'cutover:' || NEW."id" || ':' || NEW."totalReviews" || ':' || s.n,
    NEW."userId", NEW."wordId", w."term", w."level", -1, ARRAY[]::TEXT[],
    false, COALESCE(NEW."lastReviewedAt", CURRENT_TIMESTAMP)
  FROM "Word" AS w
  CROSS JOIN generate_series(1, delta) AS s(n)
  WHERE w."id" = NEW."wordId"
  ON CONFLICT ("userId", "operationId") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Review_capture_legacy_event"
AFTER INSERT OR UPDATE OF "totalReviews" ON "Review"
FOR EACH ROW EXECUTE FUNCTION "capture_legacy_review_event"();

-- Close the tiny gap between the first migration's backfill snapshot and trigger
-- installation. Exact timestamps are unknowable, so reconciliation rows are
-- marked historical and excluded from day/week buckets.
WITH event_counts AS (
  SELECT "userId", "wordId", COUNT(*)::INTEGER AS count
  FROM "ReviewEvent"
  WHERE "wordId" IS NOT NULL
  GROUP BY "userId", "wordId"
), missing AS (
  SELECT r.*, GREATEST(r."totalReviews" - COALESCE(c.count, 0), 0) AS delta
  FROM "Review" AS r
  LEFT JOIN event_counts AS c
    ON c."userId" = r."userId" AND c."wordId" = r."wordId"
)
INSERT INTO "ReviewEvent" (
  "id", "operationId", "userId", "wordId", "wordTerm", "wordLevel",
  "quality", "newlyUnlockedKeys", "isHistorical", "createdAt"
)
SELECT
  'reconcile_' || md5(m."id" || ':' || s.n::text),
  'cutover-reconcile:' || m."id" || ':' || s.n,
  m."userId", m."wordId", w."term", w."level", -1, ARRAY[]::TEXT[],
  true, COALESCE(m."lastReviewedAt", CURRENT_TIMESTAMP)
FROM missing AS m
JOIN "Word" AS w ON w."id" = m."wordId"
CROSS JOIN LATERAL generate_series(1, m.delta) AS s(n)
ON CONFLICT ("userId", "operationId") DO NOTHING;
