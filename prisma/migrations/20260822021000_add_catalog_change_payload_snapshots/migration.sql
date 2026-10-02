-- Expand-only immutable content snapshots for complete history diffs.
ALTER TABLE "CatalogChangeRequest"
  ADD COLUMN "beforePayloadSnapshot" JSONB,
  ADD COLUMN "afterPayloadSnapshot" JSONB;
