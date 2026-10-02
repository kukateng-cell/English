-- Runtime readers may only treat a Word row as current when its catalog
-- revision is known.  The expand migration created the column first so this
-- foreign key can be added without rewriting existing learning ledgers.
ALTER TABLE "Word"
  ADD CONSTRAINT "Word_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Word_catalogRevisionId_idx" ON "Word"("catalogRevisionId");

-- During the V1 compatibility window a V2 row carries the current Word
-- projection together with its canonical sense.  The pair is derived, never
-- independently chosen: reject a mismatched pair while still allowing legacy
-- Word-only rows and future sense-only rows during the expand phase.
CREATE OR REPLACE FUNCTION "assert_word_sense_projection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  projected_sense_id text;
BEGIN
  IF NEW."wordId" IS NOT NULL AND NEW."senseId" IS NOT NULL THEN
    SELECT "senseId" INTO projected_sense_id FROM "Word" WHERE "id" = NEW."wordId";
    IF projected_sense_id IS DISTINCT FROM NEW."senseId" THEN
      RAISE EXCEPTION 'wordId/senseId projection mismatch on %', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Review_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "Review"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "StudySessionItem_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "StudySessionItem"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "StudyStreamItem_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "StudyStreamItem"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "EvidenceObligation_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "EvidenceObligation"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "ObjectiveEvidenceTarget_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "ObjectiveEvidenceTarget"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "ObjectiveQuestionSnapshot_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "ObjectiveQuestionSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
CREATE TRIGGER "StudyEncounter_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "StudyEncounter"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
