-- Expand-only presentation state. It gates a Learning Card self-rating after
-- reveal while remaining nullable for existing V1 and pre-reveal V2 items.
ALTER TABLE "StudyStreamItem"
  ADD COLUMN "revealedAt" TIMESTAMP(3);
