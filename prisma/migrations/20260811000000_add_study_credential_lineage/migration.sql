-- Preserve the exact one-time credential successor across rotation, renewal,
-- cap retirement recovery, and response-loss retries.
ALTER TABLE "StudySessionItem"
ADD COLUMN "sourceItemId" TEXT;

CREATE UNIQUE INDEX "StudySessionItem_sourceItemId_key"
ON "StudySessionItem"("sourceItemId");

CREATE INDEX "StudySessionItem_operationId_idx"
ON "StudySessionItem"("operationId");

ALTER TABLE "StudySessionItem"
ADD CONSTRAINT "StudySessionItem_sourceItemId_fkey"
FOREIGN KEY ("sourceItemId") REFERENCES "StudySessionItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
