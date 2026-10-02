-- Expand-only foundation for Retrieval-first Learning Stream v2.
-- V1 tables, routes and the legacy [sessionId, wordId] unique key remain intact.

ALTER TABLE "Review"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ReviewEvent"
  ADD COLUMN "evidenceKind" TEXT,
  ADD COLUMN "flowVersion" TEXT,
  ADD COLUMN "qualityPolicyVersion" TEXT,
  ADD COLUMN "probePurpose" TEXT,
  ADD COLUMN "itemConstructionVersion" TEXT,
  ADD COLUMN "objectiveEvidenceTargetId" TEXT,
  ADD COLUMN "objectiveQuestionSnapshotId" TEXT;

UPDATE "ReviewEvent"
SET
  "evidenceKind" = COALESCE("evidenceKind", 'LEGACY_UNKNOWN'),
  "flowVersion" = COALESCE("flowVersion", 'v1')
WHERE "evidenceKind" IS NULL OR "flowVersion" IS NULL;

ALTER TABLE "StudySession"
  ADD COLUMN "flowVersion" TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN "learningPolicyVersion" TEXT,
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN "scopeLevel" "Level",
  ADD COLUMN "scopeCategory" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "StudySession_flowVersion_idx"
  ON "StudySession"("userId", "flowVersion", "expiresAt");
CREATE INDEX "ReviewEvent_evidenceKind_createdAt_idx"
  ON "ReviewEvent"("evidenceKind", "createdAt");
CREATE INDEX "ReviewEvent_objectiveEvidenceTargetId_idx"
  ON "ReviewEvent"("objectiveEvidenceTargetId");

CREATE TABLE "OperationReceipt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "flowVersion" TEXT NOT NULL,
  "actionKind" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "outcomeStatus" TEXT NOT NULL,
  "outcomeReference" TEXT,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationReceipt_userId_operationId_key"
  ON "OperationReceipt"("userId", "operationId");
CREATE INDEX "OperationReceipt_userId_createdAt_idx"
  ON "OperationReceipt"("userId", "createdAt");
ALTER TABLE "OperationReceipt"
  ADD CONSTRAINT "OperationReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing ReviewEvent operation IDs become replay receipts before any V2
-- assignment can be enabled. The response is reconstructed from the ledger
-- row by the V1 route; the receipt stores the authoritative row reference.
INSERT INTO "OperationReceipt" (
  "id", "userId", "operationId", "flowVersion", "actionKind",
  "requestFingerprint", "outcomeStatus", "outcomeReference", "createdAt"
)
SELECT
  CONCAT('receipt_', md5(CONCAT("userId", ':', "operationId"))),
  "userId",
  "operationId",
  COALESCE("flowVersion", 'v1'),
  'REVIEW',
  md5(CONCAT("userId", ':', "operationId", ':', "submittedWordId", ':', "quality")),
  'COMMITTED',
  "id",
  "createdAt"
FROM "ReviewEvent"
ON CONFLICT ("userId", "operationId") DO NOTHING;

CREATE TABLE "EvidenceObligation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'EVIDENCE_OBLIGATION',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceOperationId" TEXT,
  "selectionReason" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "eligibleAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseOwnerSessionId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt" TIMESTAMP(3),
  "terminalReason" TEXT,
  "activeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvidenceObligation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EvidenceObligation_activeKey_key"
  ON "EvidenceObligation"("activeKey");
CREATE INDEX "EvidenceObligation_userId_status_eligibleAt_expiresAt_idx"
  ON "EvidenceObligation"("userId", "status", "eligibleAt", "expiresAt");
CREATE INDEX "EvidenceObligation_userId_wordId_kind_status_idx"
  ON "EvidenceObligation"("userId", "wordId", "kind", "status");
ALTER TABLE "EvidenceObligation"
  ADD CONSTRAINT "EvidenceObligation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EvidenceObligation_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ObjectiveEvidenceTarget" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT,
  "purpose" TEXT NOT NULL,
  "expectedReviewRevision" INTEGER,
  "policyVersion" TEXT NOT NULL,
  "itemConstructionVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "activeKey" TEXT,
  "obligationId" TEXT,
  "winningOperationId" TEXT,
  "winningReviewEventId" TEXT,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObjectiveEvidenceTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ObjectiveEvidenceTarget_activeKey_key"
  ON "ObjectiveEvidenceTarget"("activeKey");
CREATE UNIQUE INDEX "ObjectiveEvidenceTarget_obligationId_key"
  ON "ObjectiveEvidenceTarget"("obligationId");
CREATE INDEX "ObjectiveEvidenceTarget_userId_status_purpose_idx"
  ON "ObjectiveEvidenceTarget"("userId", "status", "purpose");
CREATE INDEX "ObjectiveEvidenceTarget_userId_wordId_expectedReviewRevision_purpose_idx"
  ON "ObjectiveEvidenceTarget"("userId", "wordId", "expectedReviewRevision", "purpose");
ALTER TABLE "ObjectiveEvidenceTarget"
  ADD CONSTRAINT "ObjectiveEvidenceTarget_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ObjectiveEvidenceTarget_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ObjectiveEvidenceTarget_obligationId_fkey"
  FOREIGN KEY ("obligationId") REFERENCES "EvidenceObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ObjectiveQuestionSnapshot" (
  "id" TEXT NOT NULL,
  "targetId" TEXT,
  "wordId" TEXT,
  "prompt" TEXT NOT NULL,
  "wordTerm" TEXT NOT NULL,
  "wordDefinition" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "correctOptionId" TEXT NOT NULL,
  "contentVersion" TEXT NOT NULL,
  "itemConstructionVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectiveQuestionSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ObjectiveQuestionSnapshot_targetId_key"
  ON "ObjectiveQuestionSnapshot"("targetId");
CREATE INDEX "ObjectiveQuestionSnapshot_wordId_createdAt_idx"
  ON "ObjectiveQuestionSnapshot"("wordId", "createdAt");
ALTER TABLE "ObjectiveQuestionSnapshot"
  ADD CONSTRAINT "ObjectiveQuestionSnapshot_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "ObjectiveEvidenceTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ObjectiveQuestionSnapshot_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StudyStreamItem" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "streamItemKey" TEXT NOT NULL,
  "wordId" TEXT,
  "itemKind" TEXT NOT NULL,
  "selectionReason" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LEASED',
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "credentialDigest" TEXT NOT NULL,
  "credentialExpiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "operationId" TEXT,
  "clientRevision" INTEGER,
  "objectiveEvidenceTargetId" TEXT,
  "objectiveQuestionSnapshotId" TEXT,
  "sourceItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyStreamItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudyStreamItem_credentialDigest_key"
  ON "StudyStreamItem"("credentialDigest");
CREATE UNIQUE INDEX "StudyStreamItem_sourceItemId_key"
  ON "StudyStreamItem"("sourceItemId");
CREATE UNIQUE INDEX "StudyStreamItem_sessionId_streamItemKey_key"
  ON "StudyStreamItem"("sessionId", "streamItemKey");
CREATE INDEX "StudyStreamItem_sessionId_status_leaseExpiresAt_idx"
  ON "StudyStreamItem"("sessionId", "status", "leaseExpiresAt");
CREATE INDEX "StudyStreamItem_sessionId_usedAt_idx"
  ON "StudyStreamItem"("sessionId", "usedAt");
CREATE INDEX "StudyStreamItem_operationId_idx"
  ON "StudyStreamItem"("operationId");
CREATE INDEX "StudyStreamItem_objectiveEvidenceTargetId_status_idx"
  ON "StudyStreamItem"("objectiveEvidenceTargetId", "status");
ALTER TABLE "StudyStreamItem"
  ADD CONSTRAINT "StudyStreamItem_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyStreamItem_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyStreamItem_objectiveEvidenceTargetId_fkey"
  FOREIGN KEY ("objectiveEvidenceTargetId") REFERENCES "ObjectiveEvidenceTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyStreamItem_objectiveQuestionSnapshotId_fkey"
  FOREIGN KEY ("objectiveQuestionSnapshotId") REFERENCES "ObjectiveQuestionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudyStreamItem_sourceItemId_fkey"
  FOREIGN KEY ("sourceItemId") REFERENCES "StudyStreamItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_objectiveEvidenceTargetId_fkey"
  FOREIGN KEY ("objectiveEvidenceTargetId") REFERENCES "ObjectiveEvidenceTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReviewEvent_objectiveQuestionSnapshotId_fkey"
  FOREIGN KEY ("objectiveQuestionSnapshotId") REFERENCES "ObjectiveQuestionSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
