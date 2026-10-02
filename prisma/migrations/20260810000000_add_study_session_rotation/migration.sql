ALTER TABLE "StudySession"
  ADD COLUMN "rotationKey" TEXT;

CREATE UNIQUE INDEX "StudySession_rotationKey_key"
  ON "StudySession"("rotationKey");
