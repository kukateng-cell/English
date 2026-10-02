-- Bound and reuse server-issued study sessions, support global expiry cleanup,
-- and retain an auditable record of sensitive account changes.
ALTER TABLE "StudySession"
  ADD COLUMN "queueFingerprint" TEXT;

UPDATE "StudySession" AS session
SET "queueFingerprint" = md5(
  COALESCE(
    (
      SELECT string_agg(item."wordId", ',' ORDER BY item."wordId")
      FROM "StudySessionItem" AS item
      WHERE item."sessionId" = session."id"
    ),
    ''
  )
);

ALTER TABLE "StudySession"
  ALTER COLUMN "queueFingerprint" SET NOT NULL;

CREATE INDEX "StudySession_userId_queueFingerprint_expiresAt_idx"
  ON "StudySession"("userId", "queueFingerprint", "expiresAt");
CREATE INDEX "StudySession_expiresAt_idx"
  ON "StudySession"("expiresAt");

CREATE TYPE "SecurityEventType" AS ENUM ('PASSWORD_CHANGED');

CREATE TABLE "SecurityEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" "SecurityEventType" NOT NULL,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityEvent_userId_createdAt_idx"
  ON "SecurityEvent"("userId", "createdAt");
CREATE INDEX "SecurityEvent_eventType_createdAt_idx"
  ON "SecurityEvent"("eventType", "createdAt");

ALTER TABLE "SecurityEvent"
  ADD CONSTRAINT "SecurityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
