-- Expand-only credential rotation support. Existing binaries can ignore this
-- nullable JSONB field while the receipt-aware V2 runtime accepts a bounded
-- set of short-lived digest grants for concurrent tabs/devices.
ALTER TABLE "StudyStreamItem"
  ADD COLUMN "credentialLineage" JSONB;
