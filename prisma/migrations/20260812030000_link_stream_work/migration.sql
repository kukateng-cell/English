-- Expand-only link between a V2 stream item and the work/debt record that
-- leased it. Existing V1 items and existing V2 objective items remain null.
ALTER TABLE "StudyStreamItem"
  ADD COLUMN "workObligationId" TEXT;

CREATE INDEX "StudyStreamItem_workObligationId_status_idx"
  ON "StudyStreamItem"("workObligationId", "status");

ALTER TABLE "StudyStreamItem"
  ADD CONSTRAINT "StudyStreamItem_workObligationId_fkey"
  FOREIGN KEY ("workObligationId") REFERENCES "EvidenceObligation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
