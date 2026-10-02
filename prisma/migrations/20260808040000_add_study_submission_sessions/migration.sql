-- Bind scored submissions to a server-issued word list and one-time nonce.
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudySessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "StudySessionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudySessionItem_nonce_key"
    ON "StudySessionItem"("nonce");
CREATE UNIQUE INDEX "StudySessionItem_sessionId_wordId_key"
    ON "StudySessionItem"("sessionId", "wordId");
CREATE INDEX "StudySession_userId_expiresAt_idx"
    ON "StudySession"("userId", "expiresAt");
CREATE INDEX "StudySessionItem_sessionId_usedAt_idx"
    ON "StudySessionItem"("sessionId", "usedAt");

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySessionItem"
  ADD CONSTRAINT "StudySessionItem_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySessionItem"
  ADD CONSTRAINT "StudySessionItem_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "Word"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
