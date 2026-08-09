-- Perform the final old-writer check and bridge removal under one table lock.
-- The later 090200 migration remains as an idempotent compatibility contract.
BEGIN;

LOCK TABLE "Review" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  recent_legacy_writes INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO recent_legacy_writes
  FROM "ReviewEvent"
  WHERE "eventKind" = 'LEGACY_BRIDGE'
    AND "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '30 minutes';

  IF recent_legacy_writes > 0 THEN
    RAISE EXCEPTION
      'Refusing ledger bridge contract: % legacy writes observed in the last 30 minutes',
      recent_legacy_writes;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "Review_capture_legacy_event" ON "Review";
DROP FUNCTION IF EXISTS "capture_legacy_review_event"();

COMMIT;
