-- Freeze the content and source lineage of a submitted catalog batch at the
-- database boundary.  Review decisions remain writable, and child request
-- status changes remain limited to the internal FINALIZING transition.

CREATE OR REPLACE FUNCTION catalog_fixture_cleanup_enabled()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.catalog_fixture_cleanup', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "DatabaseMetadata"
      WHERE "key" = 'environment' AND "value" IN ('development', 'test')
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION catalog_guard_batch_child_transition()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE proposal_group_id TEXT;
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
    IF NEW."operationId" IS DISTINCT FROM OLD."operationId"
       OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."catalogKey" IS DISTINCT FROM OLD."catalogKey"
       OR NEW."senseKey" IS DISTINCT FROM OLD."senseKey"
       OR NEW."senseId" IS DISTINCT FROM OLD."senseId"
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

    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      SELECT b."status" INTO parent_status
      FROM "CatalogSubmissionProposalGroup" g
      JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
      WHERE g."id" = proposal_group_id;
      IF parent_status IS DISTINCT FROM 'FINALIZING'::"CatalogSubmissionStatus" THEN
        RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION catalog_guard_submission_group_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."batchId" ELSE NEW."batchId" END;
  SELECT "status" INTO parent_status FROM "CatalogSubmissionBatch" WHERE "id" = parent_id;

  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') AND NOT catalog_fixture_cleanup_enabled() THEN
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

DROP TRIGGER IF EXISTS "CatalogSubmissionProposalGroup_lineage_guard" ON "CatalogSubmissionProposalGroup";
CREATE TRIGGER "CatalogSubmissionProposalGroup_lineage_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CatalogSubmissionProposalGroup"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_submission_group_lineage();

CREATE OR REPLACE FUNCTION catalog_guard_submission_row_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."batchId" ELSE NEW."batchId" END;
  SELECT "status" INTO parent_status FROM "CatalogSubmissionBatch" WHERE "id" = parent_id;
  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') AND NOT catalog_fixture_cleanup_enabled() THEN
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

DROP TRIGGER IF EXISTS "CatalogSubmissionRow_lineage_guard" ON "CatalogSubmissionRow";
CREATE TRIGGER "CatalogSubmissionRow_lineage_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CatalogSubmissionRow"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_submission_row_lineage();

CREATE OR REPLACE FUNCTION catalog_guard_submission_author_lineage()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE proposal_id TEXT;
BEGIN
  proposal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."proposalGroupId" ELSE NEW."proposalGroupId" END;
  SELECT b."status" INTO parent_status
  FROM "CatalogSubmissionProposalGroup" g
  JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
  WHERE g."id" = proposal_id;
  IF TG_OP = 'DELETE' THEN
    IF parent_status NOT IN ('PREVIEW', 'NEEDS_RESOLUTION') AND NOT catalog_fixture_cleanup_enabled() THEN
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

DROP TRIGGER IF EXISTS "CatalogSubmissionProposalAuthor_lineage_guard" ON "CatalogSubmissionProposalAuthor";
CREATE TRIGGER "CatalogSubmissionProposalAuthor_lineage_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CatalogSubmissionProposalAuthor"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_submission_author_lineage();
