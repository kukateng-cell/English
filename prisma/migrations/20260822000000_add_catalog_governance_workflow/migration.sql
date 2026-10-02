-- Catalog governance workflow: teacher capability, immutable proposal snapshots
-- and review/audit records. Existing CSV seed data remains unchanged until an
-- explicit review decision is committed.

CREATE TYPE "CatalogChangeKind" AS ENUM ('UPDATE', 'CREATE', 'RETIRE', 'REACTIVATE');
CREATE TYPE "CatalogChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "TeacherProfile"
  ADD COLUMN "canManageWordCatalog" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "CatalogImportRow"
  ADD COLUMN "sourceData" JSONB;

CREATE TABLE "CatalogChangeRequest" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "kind" "CatalogChangeKind" NOT NULL,
  "status" "CatalogChangeStatus" NOT NULL DEFAULT 'PENDING',
  "senseId" TEXT,
  "sourceImportRowId" TEXT,
  "proposerId" TEXT NOT NULL,
  "reviewerId" TEXT,
  "baseRevision" INTEGER,
  "baseStatus" "CatalogStatus",
  "proposedRevision" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "reason" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogChangeRequest_proposerId_operationId_key"
  ON "CatalogChangeRequest"("proposerId", "operationId");
CREATE INDEX "CatalogChangeRequest_status_createdAt_idx"
  ON "CatalogChangeRequest"("status", "createdAt");
CREATE INDEX "CatalogChangeRequest_senseId_status_idx"
  ON "CatalogChangeRequest"("senseId", "status");
CREATE INDEX "CatalogChangeRequest_sourceImportRowId_status_idx"
  ON "CatalogChangeRequest"("sourceImportRowId", "status");

CREATE TABLE "CatalogAuditEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "actorUserId" TEXT,
  "senseId" TEXT,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "revision" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogAuditEvent_requestId_createdAt_idx"
  ON "CatalogAuditEvent"("requestId", "createdAt");
CREATE INDEX "CatalogAuditEvent_senseId_createdAt_idx"
  ON "CatalogAuditEvent"("senseId", "createdAt");
CREATE INDEX "CatalogAuditEvent_actorUserId_createdAt_idx"
  ON "CatalogAuditEvent"("actorUserId", "createdAt");

ALTER TABLE "CatalogChangeRequest"
  ADD CONSTRAINT "CatalogChangeRequest_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogChangeRequest_sourceImportRowId_fkey"
  FOREIGN KEY ("sourceImportRowId") REFERENCES "CatalogImportRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogChangeRequest_proposerId_fkey"
  FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogChangeRequest_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogAuditEvent"
  ADD CONSTRAINT "CatalogAuditEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "CatalogChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CatalogAuditEvent_senseId_fkey"
  FOREIGN KEY ("senseId") REFERENCES "WordSense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
