-- A deleted actor must not leave a live staged batch that contains PII.  The
-- link tables cover subjects/dependencies; this actor predicate covers an
-- administrator whose preview has no subject row yet.

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
    AND (b."actorUserId" = OLD."id" OR EXISTS (
      SELECT 1 FROM "RosterImportBatchUserLink" l
      WHERE l."batchId" = b."id" AND l."userId" = OLD."id"
    ));

  UPDATE "AdminMutationBatch" b
  SET "status" = 'CANCELLED'::"AdminMutationStatus",
      "cancelledAt" = CURRENT_TIMESTAMP,
      "payload" = NULL,
      "errorReport" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE b."status" IN ('PREVIEWED'::"AdminMutationStatus", 'EXPIRED'::"AdminMutationStatus")
    AND (b."actorUserId" = OLD."id" OR EXISTS (
      SELECT 1 FROM "AdminMutationBatchUserLink" l
      WHERE l."batchId" = b."id" AND l."userId" = OLD."id"
    ));

  DELETE FROM "StudentYearTransition" WHERE "studentId" = OLD."id";
  RETURN OLD;
END;
$$;
