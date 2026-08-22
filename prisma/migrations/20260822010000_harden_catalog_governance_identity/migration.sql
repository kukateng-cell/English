-- Keep stable identity on every proposal, including a standalone CREATE that
-- has no CatalogImportRow yet. Existing requests are backfilled from their
-- linked sense/source row by the application when they are next processed.
ALTER TABLE "CatalogChangeRequest"
  ADD COLUMN "catalogKey" TEXT,
  ADD COLUMN "senseKey" TEXT;

CREATE INDEX "CatalogChangeRequest_senseKey_status_idx"
  ON "CatalogChangeRequest"("senseKey", "status");
