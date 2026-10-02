-- Record explicit scheduler fallbacks so spacing and probe-cap overrides are
-- auditable without changing the immutable selection reason.
ALTER TABLE "StudyStreamItem"
ADD COLUMN "selectionOverrideReason" TEXT;
