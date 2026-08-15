-- Raw-DB hard-delete fallback. API paths perform the same cleanup explicitly;
-- this trigger prevents staged PII/payloads surviving an out-of-band User delete.

ALTER TABLE "StudentYearTransition"
  ALTER CONSTRAINT "StudentYearTransition_sourceEnrollment_fkey" DEFERRABLE INITIALLY DEFERRED,
  ALTER CONSTRAINT "StudentYearTransition_targetEnrollment_fkey" DEFERRABLE INITIALLY DEFERRED,
  ALTER CONSTRAINT "StudentYearTransition_sourceYear_fkey" DEFERRABLE INITIALLY DEFERRED,
  ALTER CONSTRAINT "StudentYearTransition_targetYear_fkey" DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION roster_user_delete_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "RosterImportBatch" b
  SET "status" = 'CANCELLED'::"RosterImportStatus",
      "cancelledAt" = CURRENT_TIMESTAMP,
      "stagedRows" = NULL,
      "errorReport" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE b."status" IN ('PREVIEWED'::"RosterImportStatus", 'EXPIRED'::"RosterImportStatus")
    AND EXISTS (SELECT 1 FROM "RosterImportBatchUserLink" l WHERE l."batchId" = b."id" AND l."userId" = OLD."id");

  UPDATE "AdminMutationBatch" b
  SET "status" = 'CANCELLED'::"AdminMutationStatus",
      "cancelledAt" = CURRENT_TIMESTAMP,
      "payload" = NULL,
      "errorReport" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE b."status" IN ('PREVIEWED'::"AdminMutationStatus", 'EXPIRED'::"AdminMutationStatus")
    AND EXISTS (SELECT 1 FROM "AdminMutationBatchUserLink" l WHERE l."batchId" = b."id" AND l."userId" = OLD."id");

  -- A student is the subject of a transition; remove the transition before
  -- cascading Profile/Enrollment rows. Actor links intentionally SetNull.
  DELETE FROM "StudentYearTransition" WHERE "studentId" = OLD."id";
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "User_roster_delete_cleanup" ON "User";
CREATE TRIGGER "User_roster_delete_cleanup"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION roster_user_delete_cleanup();
