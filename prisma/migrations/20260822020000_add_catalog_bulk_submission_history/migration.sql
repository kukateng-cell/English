-- Expand-only persistence for teacher CSV governance batches and immutable
-- catalog history. Existing seed imports and standalone requests remain valid.

CREATE TYPE "CatalogSubmissionStatus" AS ENUM (
  'PREVIEW', 'NEEDS_RESOLUTION', 'SUBMITTED', 'REVIEWING', 'REVIEWED',
  'FINALIZING', 'COMMITTED', 'REJECTED', 'STALE', 'EXPIRED', 'CANCELLED',
  'SUPERSEDED'
);
CREATE TYPE "CatalogSubmissionRowRole" AS ENUM ('CANONICAL_SOURCE', 'MERGED_SOURCE', 'EXCLUDED');
CREATE TYPE "CatalogProposalResolution" AS ENUM ('MERGE', 'KEEP_SEPARATE', 'LINK_EXISTING', 'REPLACE_EXISTING', 'REJECT', 'ESCALATE');
CREATE TYPE "CatalogProposalDecision" AS ENUM ('PENDING', 'APPROVE', 'REJECT');
CREATE TYPE "CatalogReviewRisk" AS ENUM ('MATERIAL', 'LOW_RISK_METADATA');
CREATE TYPE "CatalogProposalContributionKind" AS ENUM ('UPLOAD', 'RESOLUTION_EDIT', 'REVIEW_EDIT', 'CORRECTIVE_PREVIEW');
CREATE TYPE "CatalogSubmissionOperationKind" AS ENUM ('SUBMIT', 'FINALIZE');
CREATE TYPE "CatalogHistorySourceKind" AS ENUM ('STANDALONE_REQUEST', 'BATCH', 'INITIAL_BASELINE');

ALTER TABLE "CatalogChangeRequest"
  ADD COLUMN "submissionProposalGroupId" TEXT,
  ADD COLUMN "resultRevisionId" TEXT,
  ADD COLUMN "beforeTermSnapshot" TEXT,
  ADD COLUMN "afterTermSnapshot" TEXT,
  ADD COLUMN "beforeNormalizedTermSnapshot" TEXT,
  ADD COLUMN "afterNormalizedTermSnapshot" TEXT,
  ADD COLUMN "beforeDefinitionSnapshot" TEXT,
  ADD COLUMN "afterDefinitionSnapshot" TEXT,
  ADD COLUMN "beforeLevelSnapshot" "Level",
  ADD COLUMN "afterLevelSnapshot" "Level",
  ADD COLUMN "beforeCategorySnapshot" TEXT,
  ADD COLUMN "afterCategorySnapshot" TEXT,
  ADD COLUMN "actorPseudonym" TEXT,
  ADD COLUMN "actorKeyVersion" TEXT;

CREATE TABLE "CatalogSubmissionBatch" (
  "id" TEXT NOT NULL,
  "proposerId" TEXT NOT NULL,
  "resolutionOwnerId" TEXT,
  "reviewerId" TEXT,
  "finalizerId" TEXT,
  "operationId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "validatorVersion" TEXT NOT NULL,
  "normalizationVersion" TEXT NOT NULL,
  "taxonomyDigest" TEXT NOT NULL,
  "readyCatalogRevisionId" TEXT,
  "baseMutationRevision" INTEGER NOT NULL,
  "status" "CatalogSubmissionStatus" NOT NULL DEFAULT 'PREVIEW',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "rowCount" INTEGER NOT NULL,
  "summary" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentPurgedAt" TIMESTAMP(3),
  "supersedesBatchId" TEXT,
  "actorPseudonym" TEXT,
  "actorKeyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogSubmissionBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSubmissionProposalGroup" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "groupNumber" INTEGER NOT NULL,
  "requestedAction" "CatalogChangeKind" NOT NULL,
  "resolution" "CatalogProposalResolution",
  "resolutionReason" TEXT,
  "targetCatalogKey" TEXT,
  "targetSenseKey" TEXT,
  "targetSenseId" TEXT,
  "baseRevision" INTEGER,
  "baseStatus" "CatalogStatus",
  "dependencyDigest" TEXT NOT NULL,
  "finalProposalPayload" JSONB NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "lastContentAuthorId" TEXT NOT NULL,
  "reviewRisk" "CatalogReviewRisk" NOT NULL,
  "reviewRiskVersion" TEXT NOT NULL,
  "reviewRiskReason" JSONB NOT NULL,
  "decision" "CatalogProposalDecision" NOT NULL DEFAULT 'PENDING',
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "reviewedPayloadDigest" TEXT,
  "reviewNote" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "actorPseudonym" TEXT,
  "actorKeyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogSubmissionProposalGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSubmissionRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rowDigest" TEXT NOT NULL,
  "requestedAction" "CatalogChangeKind" NOT NULL,
  "primaryDisposition" TEXT NOT NULL,
  "warnings" JSONB NOT NULL,
  "errors" JSONB NOT NULL,
  "normalizedTerm" TEXT NOT NULL,
  "normalizedLemma" TEXT NOT NULL,
  "normalizedSourcePayload" JSONB,
  "proposalGroupId" TEXT,
  "rowRole" "CatalogSubmissionRowRole" NOT NULL DEFAULT 'CANONICAL_SOURCE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogSubmissionRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSubmissionProposalAuthor" (
  "id" TEXT NOT NULL,
  "proposalGroupId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "contributionKind" "CatalogProposalContributionKind" NOT NULL,
  "actorPseudonym" TEXT,
  "actorKeyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogSubmissionProposalAuthor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSubmissionOperationReceipt" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "operationKind" "CatalogSubmissionOperationKind" NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "outcomeStatus" "CatalogSubmissionStatus" NOT NULL,
  "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogSubmissionOperationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogMutationState" (
  "id" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogMutationState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogMutationState_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "CatalogMutationState" ("id", "revision", "updatedAt")
VALUES (1, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "CatalogHistoryFeedEntry" (
  "id" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "sourceKind" "CatalogHistorySourceKind" NOT NULL,
  "requestId" TEXT,
  "submissionBatchId" TEXT,
  "initialImportBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogHistoryFeedEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogHistoryFeedEntry_exactly_one_source_check" CHECK (
    num_nonnulls("requestId", "submissionBatchId", "initialImportBatchId") = 1
  ),
  CONSTRAINT "CatalogHistoryFeedEntry_source_kind_check" CHECK (
    ("sourceKind" = 'STANDALONE_REQUEST' AND "requestId" IS NOT NULL)
    OR ("sourceKind" = 'BATCH' AND "submissionBatchId" IS NOT NULL)
    OR ("sourceKind" = 'INITIAL_BASELINE' AND "initialImportBatchId" IS NOT NULL)
  )
);

ALTER TABLE "CatalogAuditEvent" ADD COLUMN "submissionBatchId" TEXT;

CREATE UNIQUE INDEX "CatalogChangeRequest_submissionProposalGroupId_key" ON "CatalogChangeRequest"("submissionProposalGroupId");
CREATE INDEX "CatalogChangeRequest_createdAt_id_idx" ON "CatalogChangeRequest"("createdAt", "id");
CREATE INDEX "CatalogChangeRequest_status_createdAt_id_idx" ON "CatalogChangeRequest"("status", "createdAt", "id");
CREATE INDEX "CatalogChangeRequest_kind_createdAt_id_idx" ON "CatalogChangeRequest"("kind", "createdAt", "id");
CREATE INDEX "CatalogChangeRequest_beforeNormalizedTermSnapshot_createdAt_id_idx" ON "CatalogChangeRequest"("beforeNormalizedTermSnapshot", "createdAt", "id");
CREATE INDEX "CatalogChangeRequest_afterNormalizedTermSnapshot_createdAt_id_idx" ON "CatalogChangeRequest"("afterNormalizedTermSnapshot", "createdAt", "id");
CREATE INDEX "CatalogChangeRequest_proposerId_createdAt_id_idx" ON "CatalogChangeRequest"("proposerId", "createdAt", "id");
CREATE INDEX "CatalogChangeRequest_reviewerId_createdAt_id_idx" ON "CatalogChangeRequest"("reviewerId", "createdAt", "id");
CREATE INDEX "CatalogAuditEvent_submissionBatchId_createdAt_idx" ON "CatalogAuditEvent"("submissionBatchId", "createdAt");

CREATE UNIQUE INDEX "CatalogSubmissionBatch_proposerId_operationId_key" ON "CatalogSubmissionBatch"("proposerId", "operationId");
CREATE INDEX "CatalogSubmissionBatch_proposerId_status_createdAt_id_idx" ON "CatalogSubmissionBatch"("proposerId", "status", "createdAt", "id");
CREATE INDEX "CatalogSubmissionBatch_reviewerId_status_createdAt_id_idx" ON "CatalogSubmissionBatch"("reviewerId", "status", "createdAt", "id");
CREATE INDEX "CatalogSubmissionBatch_status_expiresAt_idx" ON "CatalogSubmissionBatch"("status", "expiresAt");
CREATE INDEX "CatalogSubmissionBatch_fileHash_proposerId_idx" ON "CatalogSubmissionBatch"("fileHash", "proposerId");

CREATE UNIQUE INDEX "CatalogSubmissionProposalGroup_batchId_groupNumber_key" ON "CatalogSubmissionProposalGroup"("batchId", "groupNumber");
CREATE INDEX "CatalogSubmissionProposalGroup_batchId_decision_groupNumber_idx" ON "CatalogSubmissionProposalGroup"("batchId", "decision", "groupNumber");
CREATE INDEX "CatalogSubmissionProposalGroup_targetSenseId_createdAt_idx" ON "CatalogSubmissionProposalGroup"("targetSenseId", "createdAt");
CREATE INDEX "CatalogSubmissionProposalGroup_lastContentAuthorId_idx" ON "CatalogSubmissionProposalGroup"("lastContentAuthorId");

CREATE UNIQUE INDEX "CatalogSubmissionRow_batchId_rowNumber_key" ON "CatalogSubmissionRow"("batchId", "rowNumber");
CREATE INDEX "CatalogSubmissionRow_batchId_primaryDisposition_rowNumber_idx" ON "CatalogSubmissionRow"("batchId", "primaryDisposition", "rowNumber");
CREATE INDEX "CatalogSubmissionRow_proposalGroupId_rowNumber_idx" ON "CatalogSubmissionRow"("proposalGroupId", "rowNumber");

CREATE UNIQUE INDEX "CatalogSubmissionProposalAuthor_group_actor_payload_kind_key" ON "CatalogSubmissionProposalAuthor"("proposalGroupId", "actorUserId", "payloadDigest", "contributionKind");
CREATE INDEX "CatalogSubmissionProposalAuthor_actorUserId_createdAt_idx" ON "CatalogSubmissionProposalAuthor"("actorUserId", "createdAt");

CREATE UNIQUE INDEX "CatalogSubmissionOperationReceipt_actor_kind_operation_key" ON "CatalogSubmissionOperationReceipt"("actorUserId", "operationKind", "operationId");
CREATE INDEX "CatalogSubmissionOperationReceipt_batchId_createdAt_idx" ON "CatalogSubmissionOperationReceipt"("batchId", "createdAt");

CREATE UNIQUE INDEX "CatalogHistoryFeedEntry_requestId_key" ON "CatalogHistoryFeedEntry"("requestId");
CREATE UNIQUE INDEX "CatalogHistoryFeedEntry_submissionBatchId_key" ON "CatalogHistoryFeedEntry"("submissionBatchId");
CREATE UNIQUE INDEX "CatalogHistoryFeedEntry_initialImportBatchId_key" ON "CatalogHistoryFeedEntry"("initialImportBatchId");
CREATE INDEX "CatalogHistoryFeedEntry_occurredAt_sourceKind_id_idx" ON "CatalogHistoryFeedEntry"("occurredAt", "sourceKind", "id");
CREATE INDEX "CatalogHistoryFeedEntry_sourceKind_occurredAt_id_idx" ON "CatalogHistoryFeedEntry"("sourceKind", "occurredAt", "id");

ALTER TABLE "CatalogSubmissionBatch"
  ADD CONSTRAINT "CatalogSubmissionBatch_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionBatch_resolutionOwnerId_fkey" FOREIGN KEY ("resolutionOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionBatch_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionBatch_finalizerId_fkey" FOREIGN KEY ("finalizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionBatch_readyCatalogRevisionId_fkey" FOREIGN KEY ("readyCatalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionBatch_supersedesBatchId_fkey" FOREIGN KEY ("supersedesBatchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogSubmissionProposalGroup"
  ADD CONSTRAINT "CatalogSubmissionProposalGroup_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionProposalGroup_targetSenseId_fkey" FOREIGN KEY ("targetSenseId") REFERENCES "WordSense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionProposalGroup_lastContentAuthorId_fkey" FOREIGN KEY ("lastContentAuthorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionProposalGroup_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogSubmissionRow"
  ADD CONSTRAINT "CatalogSubmissionRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionRow_proposalGroupId_fkey" FOREIGN KEY ("proposalGroupId") REFERENCES "CatalogSubmissionProposalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogSubmissionProposalAuthor"
  ADD CONSTRAINT "CatalogSubmissionProposalAuthor_proposalGroupId_fkey" FOREIGN KEY ("proposalGroupId") REFERENCES "CatalogSubmissionProposalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionProposalAuthor_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogSubmissionOperationReceipt"
  ADD CONSTRAINT "CatalogSubmissionOperationReceipt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogSubmissionOperationReceipt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CatalogChangeRequest"
  ADD CONSTRAINT "CatalogChangeRequest_submissionProposalGroupId_fkey" FOREIGN KEY ("submissionProposalGroupId") REFERENCES "CatalogSubmissionProposalGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogChangeRequest_resultRevisionId_fkey" FOREIGN KEY ("resultRevisionId") REFERENCES "WordSenseRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogAuditEvent"
  ADD CONSTRAINT "CatalogAuditEvent_submissionBatchId_fkey" FOREIGN KEY ("submissionBatchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogHistoryFeedEntry"
  ADD CONSTRAINT "CatalogHistoryFeedEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CatalogChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogHistoryFeedEntry_submissionBatchId_fkey" FOREIGN KEY ("submissionBatchId") REFERENCES "CatalogSubmissionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogHistoryFeedEntry_initialImportBatchId_fkey" FOREIGN KEY ("initialImportBatchId") REFERENCES "CatalogImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION catalog_guard_batch_child_transition()
RETURNS TRIGGER AS $$
DECLARE parent_status "CatalogSubmissionStatus";
BEGIN
  IF OLD."submissionProposalGroupId" IS NOT NULL
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    SELECT b."status" INTO parent_status
    FROM "CatalogSubmissionProposalGroup" g
    JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
    WHERE g."id" = OLD."submissionProposalGroupId";
    IF parent_status IS DISTINCT FROM 'FINALIZING'::"CatalogSubmissionStatus" THEN
      RAISE EXCEPTION 'CATALOG_BATCH_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CatalogChangeRequest_batch_transition_guard"
BEFORE UPDATE OF "status" ON "CatalogChangeRequest"
FOR EACH ROW EXECUTE FUNCTION catalog_guard_batch_child_transition();

CREATE OR REPLACE FUNCTION catalog_validate_terminal_batch()
RETURNS TRIGGER AS $$
DECLARE target_batch_id TEXT;
DECLARE target_status "CatalogSubmissionStatus";
BEGIN
  IF TG_TABLE_NAME = 'CatalogSubmissionBatch' THEN
    target_batch_id := NEW."id";
    target_status := NEW."status";
  ELSE
    SELECT g."batchId", b."status" INTO target_batch_id, target_status
    FROM "CatalogSubmissionProposalGroup" g
    JOIN "CatalogSubmissionBatch" b ON b."id" = g."batchId"
    WHERE g."id" = NEW."submissionProposalGroupId";
  END IF;

  IF target_batch_id IS NOT NULL
     AND target_status IN ('COMMITTED', 'REJECTED', 'STALE', 'EXPIRED', 'CANCELLED', 'SUPERSEDED')
     AND EXISTS (
       SELECT 1
       FROM "CatalogChangeRequest" r
       JOIN "CatalogSubmissionProposalGroup" g ON g."id" = r."submissionProposalGroupId"
       WHERE g."batchId" = target_batch_id AND r."status" = 'PENDING'
     ) THEN
    RAISE EXCEPTION 'terminal catalog submission batch has pending child request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "CatalogSubmissionBatch_terminal_children_guard"
AFTER INSERT OR UPDATE OF "status" ON "CatalogSubmissionBatch"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_validate_terminal_batch();

CREATE CONSTRAINT TRIGGER "CatalogChangeRequest_terminal_parent_guard"
AFTER INSERT OR UPDATE OF "status", "submissionProposalGroupId" ON "CatalogChangeRequest"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_validate_terminal_batch();
