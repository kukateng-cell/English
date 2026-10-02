CREATE TYPE "CatalogRetryClosureReason" AS ENUM ('NO_LONGER_APPLICABLE');

ALTER TYPE "CatalogSubmissionOperationKind" ADD VALUE 'RETRY_CLOSE';

ALTER TABLE "CatalogSubmissionBatch"
  ADD COLUMN "retryClosedAt" TIMESTAMP(3),
  ADD COLUMN "retryCloseReason" "CatalogRetryClosureReason";

ALTER TABLE "CatalogSubmissionBatch"
  ADD CONSTRAINT "CatalogSubmissionBatch_retry_close_consistent_check"
  CHECK (
    (
      "retryClosedAt" IS NULL
      AND "retryCloseReason" IS NULL
    )
    OR
    (
      "retryClosedAt" IS NOT NULL
      AND "retryCloseReason" IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION catalog_guard_submission_retry_closure()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."retryClosedAt" IS NOT DISTINCT FROM OLD."retryClosedAt"
     AND NEW."retryCloseReason" IS NOT DISTINCT FROM OLD."retryCloseReason" THEN
    RETURN NEW;
  END IF;

  IF OLD."retryClosedAt" IS NOT NULL
     OR OLD."retryCloseReason" IS NOT NULL
     OR NEW."retryClosedAt" IS NULL
     OR NEW."retryCloseReason" IS DISTINCT FROM 'NO_LONGER_APPLICABLE'::"CatalogRetryClosureReason" THEN
    RAISE EXCEPTION 'CATALOG_BATCH_RETRY_CLOSURE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    OLD."status" IN ('STALE', 'REJECTED')
    OR (
      OLD."retryOfBatchId" IS NOT NULL
      AND OLD."status" IN ('CANCELLED', 'EXPIRED')
    )
  ) THEN
    RAISE EXCEPTION 'CATALOG_BATCH_RETRY_CLOSURE_INVALID' USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'CATALOG_BATCH_RETRY_CLOSURE_REVISION_INVALID' USING ERRCODE = '23514';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."proposerId" IS DISTINCT FROM OLD."proposerId"
     OR NEW."resolutionOwnerId" IS DISTINCT FROM OLD."resolutionOwnerId"
     OR NEW."reviewerId" IS DISTINCT FROM OLD."reviewerId"
     OR NEW."finalizerId" IS DISTINCT FROM OLD."finalizerId"
     OR NEW."operationId" IS DISTINCT FROM OLD."operationId"
     OR NEW."fileName" IS DISTINCT FROM OLD."fileName"
     OR NEW."fileHash" IS DISTINCT FROM OLD."fileHash"
     OR NEW."requestDigest" IS DISTINCT FROM OLD."requestDigest"
     OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
     OR NEW."validatorVersion" IS DISTINCT FROM OLD."validatorVersion"
     OR NEW."normalizationVersion" IS DISTINCT FROM OLD."normalizationVersion"
     OR NEW."taxonomyDigest" IS DISTINCT FROM OLD."taxonomyDigest"
     OR NEW."readyCatalogRevisionId" IS DISTINCT FROM OLD."readyCatalogRevisionId"
     OR NEW."baseMutationRevision" IS DISTINCT FROM OLD."baseMutationRevision"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."rowCount" IS DISTINCT FROM OLD."rowCount"
     OR NEW."summary" IS DISTINCT FROM OLD."summary"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."absoluteExpiresAt" IS DISTINCT FROM OLD."absoluteExpiresAt"
     OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
     OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
     OR NEW."committedAt" IS DISTINCT FROM OLD."committedAt"
     OR NEW."lastActivityAt" IS DISTINCT FROM OLD."lastActivityAt"
     OR NEW."contentPurgedAt" IS DISTINCT FROM OLD."contentPurgedAt"
     OR NEW."supersedesBatchId" IS DISTINCT FROM OLD."supersedesBatchId"
     OR NEW."retryOfBatchId" IS DISTINCT FROM OLD."retryOfBatchId"
     OR NEW."actorPseudonym" IS DISTINCT FROM OLD."actorPseudonym"
     OR NEW."actorKeyVersion" IS DISTINCT FROM OLD."actorKeyVersion"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CATALOG_BATCH_RETRY_CLOSURE_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CatalogSubmissionBatch_retry_closure_guard"
BEFORE UPDATE OF "retryClosedAt", "retryCloseReason" ON "CatalogSubmissionBatch"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_submission_retry_closure();
