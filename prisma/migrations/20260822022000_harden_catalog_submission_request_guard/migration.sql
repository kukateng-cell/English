-- Harden the batch-child bridge so a writer cannot attach a standalone
-- request to a batch while simultaneously terminalising it, nor delete or
-- detach an immutable submitted child request.

DROP TRIGGER IF EXISTS "CatalogChangeRequest_batch_transition_guard" ON "CatalogChangeRequest";

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
    IF OLD."submissionProposalGroupId" IS NOT NULL THEN
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

CREATE TRIGGER "CatalogChangeRequest_batch_transition_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CatalogChangeRequest"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_batch_child_transition();
