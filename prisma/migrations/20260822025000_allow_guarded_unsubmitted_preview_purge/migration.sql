-- Retention cleanup may purge heavy row/proposal content only from terminal
-- batches that were never submitted. The batch tombstone and receipts stay.

CREATE OR REPLACE FUNCTION catalog_unsubmitted_preview_purge_enabled(target_batch_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.catalog_preview_purge', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "CatalogSubmissionBatch"
      WHERE "id" = target_batch_id
        AND "submittedAt" IS NULL
        AND "status" IN ('EXPIRED', 'CANCELLED')
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION catalog_guard_submission_group_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."batchId" ELSE NEW."batchId" END;
  SELECT "status" INTO parent_status FROM "CatalogSubmissionBatch" WHERE "id" = parent_id;

  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION')
       AND NOT catalog_fixture_cleanup_enabled()
       AND NOT catalog_unsubmitted_preview_purge_enabled(parent_id) THEN
      RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') THEN
      RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."batchId" IS DISTINCT FROM OLD."batchId" THEN
    RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') AND (
       NEW."groupNumber" IS DISTINCT FROM OLD."groupNumber"
       OR NEW."requestedAction" IS DISTINCT FROM OLD."requestedAction"
       OR NEW."resolution" IS DISTINCT FROM OLD."resolution"
       OR NEW."resolutionReason" IS DISTINCT FROM OLD."resolutionReason"
       OR NEW."targetCatalogKey" IS DISTINCT FROM OLD."targetCatalogKey"
       OR NEW."targetSenseKey" IS DISTINCT FROM OLD."targetSenseKey"
       OR NEW."targetSenseId" IS DISTINCT FROM OLD."targetSenseId"
       OR NEW."baseRevision" IS DISTINCT FROM OLD."baseRevision"
       OR NEW."baseStatus" IS DISTINCT FROM OLD."baseStatus"
       OR NEW."dependencyDigest" IS DISTINCT FROM OLD."dependencyDigest"
       OR NEW."finalProposalPayload" IS DISTINCT FROM OLD."finalProposalPayload"
       OR NEW."payloadDigest" IS DISTINCT FROM OLD."payloadDigest"
       OR NEW."lastContentAuthorId" IS DISTINCT FROM OLD."lastContentAuthorId"
       OR NEW."reviewRisk" IS DISTINCT FROM OLD."reviewRisk"
       OR NEW."reviewRiskVersion" IS DISTINCT FROM OLD."reviewRiskVersion"
       OR NEW."reviewRiskReason" IS DISTINCT FROM OLD."reviewRiskReason"
       OR NEW."actorPseudonym" IS DISTINCT FROM OLD."actorPseudonym"
       OR NEW."actorKeyVersion" IS DISTINCT FROM OLD."actorKeyVersion"
     ) THEN
    RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog_guard_submission_row_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."batchId" ELSE NEW."batchId" END;
  SELECT "status" INTO parent_status FROM "CatalogSubmissionBatch" WHERE "id" = parent_id;
  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION')
       AND NOT catalog_fixture_cleanup_enabled()
       AND NOT catalog_unsubmitted_preview_purge_enabled(parent_id) THEN
      RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') THEN
    RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog_guard_submission_author_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE proposal_id TEXT;
DECLARE parent_id TEXT;
BEGIN
  proposal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."proposalGroupId" ELSE NEW."proposalGroupId" END;
  SELECT b."id", b."status" INTO parent_id, parent_status
  FROM "CatalogSubmissionProposalGroup" g
  JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
  WHERE g."id" = proposal_id;
  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION')
       AND NOT catalog_fixture_cleanup_enabled()
       AND NOT catalog_unsubmitted_preview_purge_enabled(parent_id) THEN
      RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') THEN
    RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
