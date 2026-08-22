-- Permit the one authoritative CREATE child binding performed inside
-- FINALIZING, while forbidding source/author re-parenting and terminal batch
-- reopening.

CREATE OR REPLACE FUNCTION catalog_guard_batch_child_transition()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE proposal_group_id TEXT;
DECLARE create_binding_allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."submissionProposalGroupId" IS NOT NULL
       AND NEW."status" IS DISTINCT FROM 'PENDING'::"CatalogChangeStatus" THEN
      RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."submissionProposalGroupId" IS NOT NULL AND NOT catalog_fixture_cleanup_enabled() THEN
      RAISE EXCEPTION 'CATALOG_BATCH_CHILD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."submissionProposalGroupId" IS DISTINCT FROM OLD."submissionProposalGroupId" THEN
    RAISE EXCEPTION 'CATALOG_BATCH_CHILD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  proposal_group_id := OLD."submissionProposalGroupId";
  IF proposal_group_id IS NOT NULL THEN
    SELECT b."status" INTO parent_status
    FROM "CatalogSubmissionProposalGroup" g
    JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
    WHERE g."id" = proposal_group_id;

    IF NEW."senseId" IS DISTINCT FROM OLD."senseId" THEN
      create_binding_allowed := OLD."kind" = 'CREATE'::"CatalogChangeKind"
        AND OLD."senseId" IS NULL
        AND NEW."senseId" IS NOT NULL
        AND parent_status = 'FINALIZING'::"CatalogSubmissionStatus"
        AND EXISTS (
          SELECT 1
          FROM "WordSense" s
          JOIN "CatalogEntry" e ON e."id" = s."catalogEntryId"
          WHERE s."id" = NEW."senseId"
            AND s."senseKey" = OLD."senseKey"
            AND e."catalogKey" = OLD."catalogKey"
        );
      IF NOT create_binding_allowed THEN
        RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW."operationId" IS DISTINCT FROM OLD."operationId"
       OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."catalogKey" IS DISTINCT FROM OLD."catalogKey"
       OR NEW."senseKey" IS DISTINCT FROM OLD."senseKey"
       OR NEW."sourceImportRowId" IS DISTINCT FROM OLD."sourceImportRowId"
       OR NEW."proposerId" IS DISTINCT FROM OLD."proposerId"
       OR NEW."baseRevision" IS DISTINCT FROM OLD."baseRevision"
       OR NEW."baseStatus" IS DISTINCT FROM OLD."baseStatus"
       OR NEW."payload" IS DISTINCT FROM OLD."payload"
       OR NEW."beforePayloadSnapshot" IS DISTINCT FROM OLD."beforePayloadSnapshot"
       OR NEW."afterPayloadSnapshot" IS DISTINCT FROM OLD."afterPayloadSnapshot"
       OR NEW."reason" IS DISTINCT FROM OLD."reason"
       OR NEW."beforeTermSnapshot" IS DISTINCT FROM OLD."beforeTermSnapshot"
       OR NEW."afterTermSnapshot" IS DISTINCT FROM OLD."afterTermSnapshot"
       OR NEW."beforeNormalizedTermSnapshot" IS DISTINCT FROM OLD."beforeNormalizedTermSnapshot"
       OR NEW."afterNormalizedTermSnapshot" IS DISTINCT FROM OLD."afterNormalizedTermSnapshot"
       OR NEW."beforeDefinitionSnapshot" IS DISTINCT FROM OLD."beforeDefinitionSnapshot"
       OR NEW."afterDefinitionSnapshot" IS DISTINCT FROM OLD."afterDefinitionSnapshot"
       OR NEW."beforeLevelSnapshot" IS DISTINCT FROM OLD."beforeLevelSnapshot"
       OR NEW."afterLevelSnapshot" IS DISTINCT FROM OLD."afterLevelSnapshot"
       OR NEW."beforeCategorySnapshot" IS DISTINCT FROM OLD."beforeCategorySnapshot"
       OR NEW."afterCategorySnapshot" IS DISTINCT FROM OLD."afterCategorySnapshot"
       OR NEW."actorPseudonym" IS DISTINCT FROM OLD."actorPseudonym"
       OR NEW."actorKeyVersion" IS DISTINCT FROM OLD."actorKeyVersion" THEN
      RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status"
       AND parent_status IS DISTINCT FROM 'FINALIZING'::"CatalogSubmissionStatus" THEN
      RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog_guard_submission_batch_lifecycle()
RETURNS TRIGGER AS $$
DECLARE allowed BOOLEAN := FALSE;
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD."status"
    WHEN 'PREVIEW' THEN NEW."status" IN ('NEEDS_RESOLUTION', 'SUBMITTED', 'FINALIZING')
    WHEN 'NEEDS_RESOLUTION' THEN NEW."status" IN ('PREVIEW', 'FINALIZING')
    WHEN 'SUBMITTED' THEN NEW."status" IN ('REVIEWING', 'REVIEWED', 'FINALIZING')
    WHEN 'REVIEWING' THEN NEW."status" IN ('REVIEWING', 'REVIEWED', 'FINALIZING')
    WHEN 'REVIEWED' THEN NEW."status" IN ('REVIEWED', 'FINALIZING')
    WHEN 'FINALIZING' THEN NEW."status" IN ('COMMITTED', 'REJECTED', 'STALE', 'EXPIRED', 'CANCELLED', 'SUPERSEDED')
    ELSE FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'CATALOG_BATCH_TRANSITION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CatalogSubmissionBatch_lifecycle_guard" ON "CatalogSubmissionBatch";
CREATE TRIGGER "CatalogSubmissionBatch_lifecycle_guard"
BEFORE UPDATE OF "status" ON "CatalogSubmissionBatch"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_submission_batch_lifecycle();

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

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'CATALOG_SUBMISSION_ROW_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF NEW."proposalGroupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CatalogSubmissionProposalGroup" g
    WHERE g."id" = NEW."proposalGroupId" AND g."batchId" = NEW."batchId"
  ) THEN
    RAISE EXCEPTION 'CATALOG_SUBMISSION_ROW_PARENT_INVALID' USING ERRCODE = '23514';
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

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'CATALOG_SUBMISSION_AUTHOR_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') THEN
    RAISE EXCEPTION 'CATALOG_SUBMITTED_PAYLOAD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
