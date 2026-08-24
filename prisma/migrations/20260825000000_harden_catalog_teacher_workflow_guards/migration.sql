-- Preserve retry/feedback audit lineage independently of application code.

ALTER TABLE "CatalogChangeRequest"
  DROP CONSTRAINT "CatalogChangeRequest_supersedesRequestId_fkey",
  ADD CONSTRAINT "CatalogChangeRequest_supersedesRequestId_fkey"
    FOREIGN KEY ("supersedesRequestId") REFERENCES "CatalogChangeRequest"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogSubmissionBatch"
  DROP CONSTRAINT "CatalogSubmissionBatch_retryOfBatchId_fkey",
  ADD CONSTRAINT "CatalogSubmissionBatch_retryOfBatchId_fkey"
    FOREIGN KEY ("retryOfBatchId") REFERENCES "CatalogSubmissionBatch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogFeedback"
  DROP CONSTRAINT "CatalogFeedback_resolverId_fkey",
  ADD CONSTRAINT "CatalogFeedback_resolverId_fkey"
    FOREIGN KEY ("resolverId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogFeedback_resolution_consistent_check" CHECK (
    (
      "status" = 'OPEN'::"CatalogFeedbackStatus"
      AND "resolverId" IS NULL
      AND "resolvedAt" IS NULL
      AND "resolutionNote" IS NULL
    )
    OR
    (
      "status" IN ('RESOLVED'::"CatalogFeedbackStatus", 'DISMISSED'::"CatalogFeedbackStatus")
      AND "resolverId" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND "resolutionNote" IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION catalog_guard_request_retry_lineage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."supersedesRequestId" IS DISTINCT FROM OLD."supersedesRequestId" THEN
    RAISE EXCEPTION 'CATALOG_REQUEST_LINEAGE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CatalogChangeRequest_retry_lineage_guard" ON "CatalogChangeRequest";
CREATE TRIGGER "CatalogChangeRequest_retry_lineage_guard"
BEFORE UPDATE OF "supersedesRequestId" ON "CatalogChangeRequest"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_request_retry_lineage();

CREATE OR REPLACE FUNCTION catalog_guard_batch_retry_lineage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."retryOfBatchId" IS DISTINCT FROM OLD."retryOfBatchId" THEN
    RAISE EXCEPTION 'CATALOG_BATCH_RETRY_LINEAGE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CatalogSubmissionBatch_retry_lineage_guard" ON "CatalogSubmissionBatch";
CREATE TRIGGER "CatalogSubmissionBatch_retry_lineage_guard"
BEFORE UPDATE OF "retryOfBatchId" ON "CatalogSubmissionBatch"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_batch_retry_lineage();

CREATE OR REPLACE FUNCTION catalog_guard_feedback_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."operationId" IS DISTINCT FROM OLD."operationId"
     OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
     OR NEW."reporterId" IS DISTINCT FROM OLD."reporterId"
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

DROP TRIGGER IF EXISTS "CatalogFeedback_transition_guard" ON "CatalogFeedback";
CREATE TRIGGER "CatalogFeedback_transition_guard"
BEFORE UPDATE ON "CatalogFeedback"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_feedback_transition();
