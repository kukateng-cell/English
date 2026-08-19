-- ReviewEvent is part of the learning identity ledger.  Keep the same
-- expand-window invariant as the other learning tables: when both the legacy
-- Word projection and the canonical sense are present, they must match.
CREATE TRIGGER "ReviewEvent_word_sense_projection_guard"
  BEFORE INSERT OR UPDATE OF "wordId", "senseId" ON "ReviewEvent"
  FOR EACH ROW EXECUTE FUNCTION "assert_word_sense_projection"();
