-- Expand-only durable Learning Encounter and read-only feedback resume state.

ALTER TABLE "StudyStreamItem"
  ADD COLUMN "feedbackAcknowledgedAt" TIMESTAMP(3);

CREATE TABLE "StudyEncounter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT,
  "streamItemId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "selfRating" TEXT NOT NULL,
  "selectionReason" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "requiresVerification" BOOLEAN NOT NULL,
  "verificationDisposition" TEXT,
  "evidenceObligationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyEncounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudyEncounter_streamItemId_key"
  ON "StudyEncounter"("streamItemId");
CREATE UNIQUE INDEX "StudyEncounter_userId_operationId_key"
  ON "StudyEncounter"("userId", "operationId");
CREATE INDEX "StudyEncounter_userId_createdAt_idx"
  ON "StudyEncounter"("userId", "createdAt");
CREATE INDEX "StudyEncounter_userId_wordId_createdAt_idx"
  ON "StudyEncounter"("userId", "wordId", "createdAt");
ALTER TABLE "StudyEncounter"
  ADD CONSTRAINT "StudyEncounter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyEncounter_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyEncounter_streamItemId_fkey"
  FOREIGN KEY ("streamItemId") REFERENCES "StudyStreamItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyEncounter_evidenceObligationId_fkey"
  FOREIGN KEY ("evidenceObligationId") REFERENCES "EvidenceObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
