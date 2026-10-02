-- Keep the feedback target and its denormalized snapshots as one immutable
-- audit identity. A referenced sense must not disappear behind an implicit
-- SET NULL that the feedback transition guard would reject anyway.

ALTER TABLE "CatalogFeedback"
  DROP CONSTRAINT "CatalogFeedback_senseId_fkey",
  ADD CONSTRAINT "CatalogFeedback_senseId_fkey"
    FOREIGN KEY ("senseId") REFERENCES "WordSense"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION catalog_guard_feedback_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."operationId" IS DISTINCT FROM OLD."operationId"
     OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
     OR NEW."reporterId" IS DISTINCT FROM OLD."reporterId"
     OR NEW."senseId" IS DISTINCT FROM OLD."senseId"
     OR NEW."senseKey" IS DISTINCT FROM OLD."senseKey"
     OR NEW."termSnapshot" IS DISTINCT FROM OLD."termSnapshot"
     OR NEW."baseRevision" IS DISTINCT FROM OLD."baseRevision"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."suggestedValue" IS DISTINCT FROM OLD."suggestedValue"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CATALOG_FEEDBACK_CONTENT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IS DISTINCT FROM 'OPEN'::"CatalogFeedbackStatus" THEN
    RAISE EXCEPTION 'CATALOG_FEEDBACK_TERMINAL_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" NOT IN ('RESOLVED'::"CatalogFeedbackStatus", 'DISMISSED'::"CatalogFeedbackStatus") THEN
    RAISE EXCEPTION 'CATALOG_FEEDBACK_TRANSITION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'CATALOG_FEEDBACK_REVISION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
