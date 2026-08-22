-- Integration checks create a complete committed batch so that the same
-- immutable-history path used in production is exercised.  Permit cleanup
-- only when both the transaction opts in and DatabaseMetadata identifies a
-- non-production fixture database.  Production never satisfies this guard.

CREATE OR REPLACE FUNCTION catalog_guard_batch_child_transition()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
DECLARE proposal_group_id TEXT;
DECLARE fixture_cleanup BOOLEAN;
BEGIN
  fixture_cleanup := current_setting('app.catalog_fixture_cleanup', true) = 'on'
    AND EXISTS (
      SELECT 1
      FROM "DatabaseMetadata"
      WHERE "key" = 'environment'
        AND "value" IN ('development', 'test')
    );

  IF TG_OP = 'INSERT' THEN
    IF NEW."submissionProposalGroupId" IS NOT NULL
       AND NEW."status" IS DISTINCT FROM 'PENDING'::"CatalogChangeStatus" THEN
      RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."submissionProposalGroupId" IS NOT NULL AND NOT fixture_cleanup THEN
      RAISE EXCEPTION 'CATALOG_BATCH_CHILD_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."submissionProposalGroupId" IS DISTINCT FROM OLD."submissionProposalGroupId" THEN
    RAISE EXCEPTION 'CATALOG_BATCH_CHILD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  proposal_group_id := NEW."submissionProposalGroupId";
  IF proposal_group_id IS NOT NULL
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    SELECT b."status" INTO parent_status
    FROM "CatalogSubmissionProposalGroup" g
    JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
    WHERE g."id" = proposal_group_id;
    IF parent_status IS DISTINCT FROM 'FINALIZING'::"CatalogSubmissionStatus" THEN
      RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
