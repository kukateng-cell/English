-- Additive governance workflow extensions. Feedback is non-executable and
-- supersession links preserve immutable rejected/stale history.
CREATE TYPE "CatalogFeedbackKind" AS ENUM (
  'DEFINITION', 'LEVEL', 'PART_OF_SPEECH', 'PHONETIC', 'EXAMPLE',
  'DISTRACTOR', 'INAPPROPRIATE_WORD', 'MISSING_WORD', 'OTHER'
);

CREATE TYPE "CatalogFeedbackStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

ALTER TABLE "CatalogChangeRequest" ADD COLUMN "supersedesRequestId" TEXT;
CREATE UNIQUE INDEX "CatalogChangeRequest_supersedesRequestId_key"
  ON "CatalogChangeRequest"("supersedesRequestId");
ALTER TABLE "CatalogChangeRequest"
  ADD CONSTRAINT "CatalogChangeRequest_supersedesRequestId_fkey"
  FOREIGN KEY ("supersedesRequestId") REFERENCES "CatalogChangeRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CatalogFeedback" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "resolverId" TEXT,
  "senseId" TEXT,
  "senseKey" TEXT,
  "termSnapshot" TEXT,
  "baseRevision" INTEGER,
  "kind" "CatalogFeedbackKind" NOT NULL,
  "status" "CatalogFeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "message" TEXT NOT NULL,
  "suggestedValue" TEXT,
  "resolutionNote" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogFeedback_reporterId_operationId_key" ON "CatalogFeedback"("reporterId", "operationId");
CREATE INDEX "CatalogFeedback_status_createdAt_id_idx" ON "CatalogFeedback"("status", "createdAt", "id");
CREATE INDEX "CatalogFeedback_reporterId_status_createdAt_id_idx" ON "CatalogFeedback"("reporterId", "status", "createdAt", "id");
CREATE INDEX "CatalogFeedback_senseId_status_createdAt_id_idx" ON "CatalogFeedback"("senseId", "status", "createdAt", "id");
CREATE INDEX "CatalogFeedback_resolverId_resolvedAt_id_idx" ON "CatalogFeedback"("resolverId", "resolvedAt", "id");

ALTER TABLE "CatalogFeedback" ADD CONSTRAINT "CatalogFeedback_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogFeedback" ADD CONSTRAINT "CatalogFeedback_resolverId_fkey"
  FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogFeedback" ADD CONSTRAINT "CatalogFeedback_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Corrective previews already use supersedesBatchId as a one-to-many audit
-- lineage. Retries use a separate one-to-one lineage so an abandoned
-- corrective preview never blocks a later corrective action.
ALTER TABLE "CatalogSubmissionBatch" ADD COLUMN "retryOfBatchId" TEXT;
CREATE UNIQUE INDEX "CatalogSubmissionBatch_retryOfBatchId_key"
  ON "CatalogSubmissionBatch"("retryOfBatchId");
ALTER TABLE "CatalogSubmissionBatch"
  ADD CONSTRAINT "CatalogSubmissionBatch_retryOfBatchId_fkey"
  FOREIGN KEY ("retryOfBatchId") REFERENCES "CatalogSubmissionBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
