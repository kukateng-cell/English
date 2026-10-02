-- Revision 3 operation receipts and expanded audit pseudonym columns.
-- Expand-only: all new audit columns remain nullable for legacy rows/writers.

ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROSTER_IMPORT_PREVIEWED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROSTER_IMPORT_COMMITTED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROSTER_IMPORT_CANCELLED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ACADEMIC_YEAR_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ACADEMIC_YEAR_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SCHOOL_CLASS_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SCHOOL_CLASS_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ADMIN_PROFILE_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'TEACHER_CLASS_ACCESS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'IMPORT_CREDENTIALS_ROTATED';

ALTER TABLE "SecurityEvent"
  ADD COLUMN "subjectPseudonym" TEXT,
  ADD COLUMN "ipPseudonym" TEXT;

CREATE TABLE "AdminOperationReceipt" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorPseudonym" TEXT,
  "hmacKeyVersion" TEXT,
  "operationKind" "AdminMutationKind" NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "outcomeStatus" TEXT NOT NULL,
  "summary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminOperationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminOperationReceipt_actorUserId_operationKind_operationId_key"
  ON "AdminOperationReceipt"("actorUserId", "operationKind", "operationId");
CREATE INDEX "AdminOperationReceipt_actorUserId_createdAt_idx"
  ON "AdminOperationReceipt"("actorUserId", "createdAt");

ALTER TABLE "AdminOperationReceipt"
  ADD CONSTRAINT "AdminOperationReceipt_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
