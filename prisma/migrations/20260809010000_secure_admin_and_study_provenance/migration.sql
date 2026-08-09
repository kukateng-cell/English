-- Preserve security audit records independently of user lifecycle, bind
-- credential renewal to server provenance, and persist the database environment.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_BY_ADMIN';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROLE_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'USER_DELETED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'USER_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SESSIONS_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'LAST_ADMIN_PROTECTION_TRIGGERED';

ALTER TABLE "StudySession"
  ADD COLUMN "retiredAt" TIMESTAMP(3);

ALTER TABLE "StudySessionItem"
  ADD COLUMN "renewedAt" TIMESTAMP(3),
  ADD COLUMN "operationId" TEXT;

CREATE INDEX "StudySession_userId_retiredAt_expiresAt_idx"
  ON "StudySession"("userId", "retiredAt", "expiresAt");

ALTER TABLE "SecurityEvent"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "subjectUserId" TEXT,
  ADD COLUMN "subjectAccountHash" TEXT,
  ADD COLUMN "metadata" JSONB;

UPDATE "SecurityEvent" AS event
SET
  "actorUserId" = event."userId",
  "subjectUserId" = event."userId",
  "subjectAccountHash" = 'legacy:' || md5(account."email")
FROM "User" AS account
WHERE account."id" = event."userId";

ALTER TABLE "SecurityEvent"
  ALTER COLUMN "subjectAccountHash" SET NOT NULL;

DROP INDEX "SecurityEvent_userId_createdAt_idx";
ALTER TABLE "SecurityEvent" DROP CONSTRAINT "SecurityEvent_userId_fkey";
ALTER TABLE "SecurityEvent" DROP COLUMN "userId";

CREATE INDEX "SecurityEvent_actorUserId_createdAt_idx"
  ON "SecurityEvent"("actorUserId", "createdAt");
CREATE INDEX "SecurityEvent_subjectUserId_createdAt_idx"
  ON "SecurityEvent"("subjectUserId", "createdAt");

ALTER TABLE "SecurityEvent"
  ADD CONSTRAINT "SecurityEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent"
  ADD CONSTRAINT "SecurityEvent_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DatabaseMetadata" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DatabaseMetadata_pkey" PRIMARY KEY ("key")
);

INSERT INTO "DatabaseMetadata" ("key", "value", "updatedAt")
VALUES ('environment', 'unclassified', CURRENT_TIMESTAMP);
