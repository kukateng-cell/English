-- Revision 3 profile/access and batch-lifecycle contract fields.
-- Expand-only: canonical companions are nullable until the separate shared
-- rollout contract retires legacy writers and completes a preflight/backfill.

ALTER TABLE "User"
  ADD COLUMN "contactEmailCanonical" TEXT;

CREATE UNIQUE INDEX "User_contactEmailCanonical_key"
  ON "User"("contactEmailCanonical")
  WHERE "contactEmailCanonical" IS NOT NULL;

ALTER TABLE "StudentProfile"
  ADD COLUMN "moderationPolicyVersion" TEXT NOT NULL DEFAULT 'nickname-v1';

ALTER TABLE "TeacherProfile"
  ADD COLUMN "accessRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TeacherClassAccess"
  ADD COLUMN "grantedByPseudonym" TEXT,
  ADD COLUMN "hmacKeyVersion" TEXT;

ALTER TABLE "RosterImportBatch"
  ALTER COLUMN "actorUserId" DROP NOT NULL;

ALTER TABLE "RosterImportBatch"
  DROP CONSTRAINT IF EXISTS "RosterImportBatch_actorUserId_fkey",
  ADD CONSTRAINT "RosterImportBatch_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_status_fields_check"
  CHECK (
    ("status" = 'ACTIVE'::"AccountStatus" AND "suspendedAt" IS NULL AND "suspendedReason" IS NULL)
    OR
    ("status" = 'SUSPENDED'::"AccountStatus" AND "suspendedAt" IS NOT NULL)
  );
