-- Raw User deletes can race a roster commit that already owns a batch row and
-- is waiting for the subject User row.  The API path follows the canonical
-- state -> identity -> batch -> User order; this BEFORE trigger must never
-- block in the reverse direction.  Lock all affected batches NOWAIT and make
-- a lock conflict an explicit serialization retry (SQLSTATE 40001).

CREATE OR REPLACE FUNCTION roster_user_delete_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  batch_id TEXT;
BEGIN
  FOR batch_id IN
    SELECT b."id"
    FROM "RosterImportBatch" b
    WHERE b."status" IN ('PREVIEWED'::"RosterImportStatus", 'EXPIRED'::"RosterImportStatus")
      AND (b."actorUserId" = OLD."id" OR EXISTS (
        SELECT 1 FROM "RosterImportBatchUserLink" l
        WHERE l."batchId" = b."id" AND l."userId" = OLD."id"
      ))
    ORDER BY b."id"
  LOOP
    BEGIN
      PERFORM 1 FROM "RosterImportBatch" WHERE "id" = batch_id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'roster delete serialization retry required' USING ERRCODE = '40001';
    END;
  END LOOP;

  FOR batch_id IN
    SELECT b."id"
    FROM "AdminMutationBatch" b
    WHERE b."status" IN ('PREVIEWED'::"AdminMutationStatus", 'EXPIRED'::"AdminMutationStatus")
      AND (b."actorUserId" = OLD."id" OR EXISTS (
        SELECT 1 FROM "AdminMutationBatchUserLink" l
        WHERE l."batchId" = b."id" AND l."userId" = OLD."id"
      ))
    ORDER BY b."id"
  LOOP
    BEGIN
      PERFORM 1 FROM "AdminMutationBatch" WHERE "id" = batch_id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'roster delete serialization retry required' USING ERRCODE = '40001';
    END;
  END LOOP;

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

  -- The deferred enrollment FKs are intentionally satisfied before the User
  -- cascade.  Actor links remain SetNull and therefore never delete history.
  DELETE FROM "StudentYearTransition" WHERE "studentId" = OLD."id";
  RETURN OLD;
END;
$$;
