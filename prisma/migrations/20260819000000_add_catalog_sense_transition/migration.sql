-- Expand-only CSV catalog / sense identity transition.
-- Existing Word/Review rows remain readable for the V1 compatibility window.
-- The local destructive rebuild is intentionally a separate guarded command.

CREATE TYPE "CatalogStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

ALTER TABLE "Word"
  DROP CONSTRAINT IF EXISTS "Word_term_key";
DROP INDEX IF EXISTS "Word_term_key";

ALTER TABLE "Word"
  ADD COLUMN "senseId" TEXT,
  ADD COLUMN "senseKey" TEXT,
  ADD COLUMN "contentRevisionId" TEXT,
  ADD COLUMN "catalogRevisionId" TEXT,
  ADD COLUMN "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "acceptedForms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "distractorZh" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "distractorEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "enableEnToZh" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "enableZhToEn" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX "Word_senseId_key" ON "Word"("senseId");
CREATE INDEX "Word_term_idx" ON "Word"("term");

CREATE TABLE "CatalogEntry" (
  "id" TEXT NOT NULL,
  "catalogKey" TEXT NOT NULL,
  "lemma" TEXT NOT NULL,
  "normalizedLemma" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogEntry_catalogKey_key" ON "CatalogEntry"("catalogKey");
CREATE INDEX "CatalogEntry_normalizedLemma_idx" ON "CatalogEntry"("normalizedLemma");

CREATE TABLE "CatalogRevision" (
  "id" TEXT NOT NULL,
  "revisionKey" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "taxonomyDigest" TEXT NOT NULL,
  "validatorVersion" TEXT NOT NULL,
  "normalizationVersion" TEXT NOT NULL,
  "activationBasis" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'BUILDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogRevision_revisionKey_key" ON "CatalogRevision"("revisionKey");
CREATE INDEX "CatalogRevision_status_createdAt_idx" ON "CatalogRevision"("status", "createdAt");

CREATE TABLE "WordSense" (
  "id" TEXT NOT NULL,
  "catalogEntryId" TEXT NOT NULL,
  "senseKey" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "normalizedTerm" TEXT NOT NULL,
  "pos" TEXT,
  "level" "Level" NOT NULL,
  "category" TEXT NOT NULL,
  "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WordSense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WordSense_senseKey_key" ON "WordSense"("senseKey");
CREATE UNIQUE INDEX "WordSense_approvedRevisionId_key" ON "WordSense"("approvedRevisionId");
CREATE INDEX "WordSense_normalizedTerm_idx" ON "WordSense"("normalizedTerm");
CREATE INDEX "WordSense_level_status_idx" ON "WordSense"("level", "status");
CREATE INDEX "WordSense_catalogEntryId_level_idx" ON "WordSense"("catalogEntryId", "level");

CREATE TABLE "WordSenseRevision" (
  "id" TEXT NOT NULL,
  "senseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "term" TEXT NOT NULL,
  "lemma" TEXT NOT NULL,
  "pos" TEXT,
  "level" "Level" NOT NULL,
  "category" TEXT NOT NULL,
  "definitionZh" TEXT NOT NULL,
  "acceptedAnswersZh" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "phoneticIpa" TEXT,
  "exampleEn" TEXT,
  "exampleZh" TEXT,
  "acceptedFormsEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "synonymsEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "antonymsEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enableEnToZh" BOOLEAN NOT NULL DEFAULT FALSE,
  "distractorZh" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enableZhToEn" BOOLEAN NOT NULL DEFAULT FALSE,
  "distractorEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "contentDigest" TEXT NOT NULL,
  "sourceReference" TEXT,
  "contributorRef" TEXT,
  "changeNote" TEXT,
  "retirementReason" TEXT,
  "catalogRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WordSenseRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WordSenseRevision_senseId_revision_key" ON "WordSenseRevision"("senseId", "revision");
CREATE INDEX "WordSenseRevision_contentDigest_idx" ON "WordSenseRevision"("contentDigest");
CREATE INDEX "WordSenseRevision_catalogRevisionId_idx" ON "WordSenseRevision"("catalogRevisionId");

CREATE TABLE "CatalogImportBatch" (
  "id" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "taxonomyDigest" TEXT NOT NULL,
  "validatorVersion" TEXT NOT NULL,
  "normalizationVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "catalogRevisionId" TEXT,
  "manifest" JSONB NOT NULL,
  "report" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogImportBatch_sourceDigest_key" ON "CatalogImportBatch"("sourceDigest");
CREATE INDEX "CatalogImportBatch_status_createdAt_idx" ON "CatalogImportBatch"("status", "createdAt");

CREATE TABLE "CatalogImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceFile" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "rowDigest" TEXT NOT NULL,
  "primaryDisposition" TEXT NOT NULL,
  "eligibilityResult" TEXT,
  "catalogKey" TEXT,
  "senseKey" TEXT,
  "issues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogImportRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogImportRow_batchId_sourceFile_sourceRow_key" ON "CatalogImportRow"("batchId", "sourceFile", "sourceRow");
CREATE INDEX "CatalogImportRow_primaryDisposition_idx" ON "CatalogImportRow"("primaryDisposition");
CREATE INDEX "CatalogImportRow_eligibilityResult_idx" ON "CatalogImportRow"("eligibilityResult");

CREATE TABLE "CatalogEligibility" (
  "id" TEXT NOT NULL,
  "senseId" TEXT NOT NULL,
  "senseRevisionId" TEXT NOT NULL,
  "catalogRevisionId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "validatorVersion" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogEligibility_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogEligibility_senseRevisionId_environment_key" ON "CatalogEligibility"("senseRevisionId", "environment");
CREATE INDEX "CatalogEligibility_environment_catalogRevisionId_idx" ON "CatalogEligibility"("environment", "catalogRevisionId");
CREATE INDEX "CatalogEligibility_senseId_environment_idx" ON "CatalogEligibility"("senseId", "environment");

CREATE TABLE "LegacyWordSenseMap" (
  "id" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "senseId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyWordSenseMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegacyWordSenseMap_wordId_key" ON "LegacyWordSenseMap"("wordId");
CREATE UNIQUE INDEX "LegacyWordSenseMap_senseId_key" ON "LegacyWordSenseMap"("senseId");

ALTER TABLE "Review"
  ADD COLUMN "senseId" TEXT;
CREATE UNIQUE INDEX "Review_userId_senseId_key" ON "Review"("userId", "senseId");
CREATE INDEX "Review_userId_senseId_nextReviewDate_idx" ON "Review"("userId", "senseId", "nextReviewDate");

ALTER TABLE "ReviewEvent"
  ADD COLUMN "senseId" TEXT,
  ADD COLUMN "submittedSenseId" TEXT,
  ADD COLUMN "senseKey" TEXT,
  ADD COLUMN "contentRevisionId" TEXT,
  ADD COLUMN "catalogRevisionId" TEXT;
CREATE INDEX "ReviewEvent_senseId_idx" ON "ReviewEvent"("senseId");

ALTER TABLE "StudySession"
  ADD COLUMN "catalogReadMode" TEXT NOT NULL DEFAULT 'LEGACY_WORD';

ALTER TABLE "StudySessionItem"
  ADD COLUMN "senseId" TEXT;
CREATE INDEX "StudySessionItem_sessionId_senseId_idx" ON "StudySessionItem"("sessionId", "senseId");

ALTER TABLE "StudyStreamItem"
  ADD COLUMN "senseId" TEXT;
CREATE INDEX "StudyStreamItem_sessionId_senseId_status_idx" ON "StudyStreamItem"("sessionId", "senseId", "status");

ALTER TABLE "EvidenceObligation"
  ADD COLUMN "senseId" TEXT;
CREATE INDEX "EvidenceObligation_userId_senseId_kind_status_idx" ON "EvidenceObligation"("userId", "senseId", "kind", "status");

ALTER TABLE "ObjectiveEvidenceTarget"
  ADD COLUMN "senseId" TEXT;
CREATE INDEX "ObjectiveEvidenceTarget_userId_senseId_expectedReviewRevision_purpose_idx"
  ON "ObjectiveEvidenceTarget"("userId", "senseId", "expectedReviewRevision", "purpose");

ALTER TABLE "ObjectiveQuestionSnapshot"
  ADD COLUMN "senseId" TEXT,
  ADD COLUMN "contentRevisionId" TEXT,
  ADD COLUMN "catalogRevisionId" TEXT;
CREATE INDEX "ObjectiveQuestionSnapshot_senseId_createdAt_idx" ON "ObjectiveQuestionSnapshot"("senseId", "createdAt");

ALTER TABLE "StudyEncounter"
  ADD COLUMN "senseId" TEXT;
CREATE INDEX "StudyEncounter_userId_senseId_createdAt_idx" ON "StudyEncounter"("userId", "senseId", "createdAt");

ALTER TABLE "Word"
  ADD CONSTRAINT "Word_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WordSense"
  ADD CONSTRAINT "WordSense_catalogEntryId_fkey"
  FOREIGN KEY ("catalogEntryId") REFERENCES "CatalogEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WordSense_approvedRevisionId_fkey"
  FOREIGN KEY ("approvedRevisionId") REFERENCES "WordSenseRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WordSenseRevision"
  ADD CONSTRAINT "WordSenseRevision_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WordSenseRevision_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogImportBatch"
  ADD CONSTRAINT "CatalogImportBatch_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogImportRow"
  ADD CONSTRAINT "CatalogImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "CatalogImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogEligibility"
  ADD CONSTRAINT "CatalogEligibility_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogEligibility_senseRevisionId_fkey"
  FOREIGN KEY ("senseRevisionId") REFERENCES "WordSenseRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogEligibility_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegacyWordSenseMap"
  ADD CONSTRAINT "LegacyWordSenseMap_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LegacyWordSenseMap_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReviewEvent_submittedSenseId_fkey"
  FOREIGN KEY ("submittedSenseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReviewEvent_contentRevisionId_fkey"
  FOREIGN KEY ("contentRevisionId") REFERENCES "WordSenseRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReviewEvent_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudySessionItem"
  ADD CONSTRAINT "StudySessionItem_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudyStreamItem"
  ADD CONSTRAINT "StudyStreamItem_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceObligation"
  ADD CONSTRAINT "EvidenceObligation_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ObjectiveEvidenceTarget"
  ADD CONSTRAINT "ObjectiveEvidenceTarget_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ObjectiveQuestionSnapshot"
  ADD CONSTRAINT "ObjectiveQuestionSnapshot_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ObjectiveQuestionSnapshot_contentRevisionId_fkey"
  FOREIGN KEY ("contentRevisionId") REFERENCES "WordSenseRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ObjectiveQuestionSnapshot_catalogRevisionId_fkey"
  FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudyEncounter"
  ADD CONSTRAINT "StudyEncounter_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
