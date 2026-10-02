-- Revision 3 canonical roster foundation.
-- The earlier 20260815000000 migration is already applied and is immutable.
-- This is an expand/forward migration: legacy isCurrent columns remain for
-- old binaries, while new application writers use status and the new models.

CREATE TYPE "AcademicYearStatus" AS ENUM ('PLANNED', 'CURRENT', 'CLOSED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ENDED');
CREATE TYPE "EnrollmentOrigin" AS ENUM ('MANUAL', 'IMPORT', 'PROMOTION', 'SEED');
CREATE TYPE "RolloverDisposition" AS ENUM ('PROMOTE', 'REPEAT', 'HOLD_UNASSIGNED', 'GRADUATE', 'LEAVE');
CREATE TYPE "AdminMutationKind" AS ENUM ('BULK_CLASS', 'PROMOTION', 'YEAR_ACTIVATION', 'ROTATE_CREDENTIALS');
CREATE TYPE "AdminMutationStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "BatchUserLinkRole" AS ENUM (
  'TARGET', 'DEPENDENCY', 'EMAIL_OWNER', 'COVERAGE_TEACHER',
  'ROTATION_ELIGIBLE', 'ROTATION_CONFLICT', 'ACTOR'
);

ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SCHOOL_CLASS_DEACTIVATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ACADEMIC_YEAR_ACTIVATED';
ALTER TYPE "RosterImportStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "User"
  ADD COLUMN "accountNameCanonical" TEXT,
  ADD COLUMN "credentialRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "User_accountNameCanonical_key"
  ON "User"("accountNameCanonical")
  WHERE "accountNameCanonical" IS NOT NULL;

ALTER TABLE "SecurityEvent"
  ADD COLUMN "actorPseudonym" TEXT,
  ADD COLUMN "hmacKeyVersion" TEXT;

ALTER TABLE "AcademicYear"
  ADD COLUMN "status" "AcademicYearStatus" NOT NULL DEFAULT 'PLANNED';

UPDATE "AcademicYear"
SET "status" = CASE WHEN "isCurrent" THEN 'CURRENT'::"AcademicYearStatus"
                    ELSE 'PLANNED'::"AcademicYearStatus" END;

ALTER TABLE "AcademicYear"
  ADD CONSTRAINT "AcademicYear_label_format_check"
  CHECK ("label" ~ '^[0-9]{4}-[0-9]{4}$'
         AND split_part("label", '-', 2)::INTEGER = split_part("label", '-', 1)::INTEGER + 1);

CREATE INDEX "AcademicYear_status_idx" ON "AcademicYear"("status");
CREATE UNIQUE INDEX "AcademicYear_one_current_status_key"
  ON "AcademicYear"(("status")) WHERE "status" = 'CURRENT';

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "AcademicYear"
  ADD CONSTRAINT "AcademicYear_dates_no_overlap"
  EXCLUDE USING gist (
    daterange("startsOn", "endsOn" + 1, '[)') WITH &&
  );

ALTER TABLE "StudentEnrollment"
  ADD COLUMN "status" "EnrollmentStatus" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN "origin" "EnrollmentOrigin" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "StudentEnrollment"
  ALTER COLUMN "startedAt" DROP NOT NULL;

UPDATE "StudentEnrollment" AS e
SET "status" = CASE
  WHEN NOT e."isCurrent" THEN 'ENDED'::"EnrollmentStatus"
  WHEN y."status" = 'CURRENT' THEN 'ACTIVE'::"EnrollmentStatus"
  ELSE 'PLANNED'::"EnrollmentStatus"
END
FROM "AcademicYear" AS y
WHERE y."id" = e."academicYearId";

UPDATE "StudentEnrollment"
SET "startedAt" = NULL, "endedAt" = NULL
WHERE "status" = 'PLANNED';

UPDATE "StudentEnrollment"
SET "startedAt" = COALESCE("startedAt", "createdAt"), "endedAt" = NULL
WHERE "status" = 'ACTIVE';

UPDATE "StudentEnrollment"
SET "startedAt" = COALESCE("startedAt", "createdAt"), "endedAt" = COALESCE("endedAt", "updatedAt")
WHERE "status" = 'ENDED';

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_status_dates_check"
  CHECK (
    ("status" = 'PLANNED' AND "startedAt" IS NULL AND "endedAt" IS NULL)
    OR ("status" = 'ACTIVE' AND "startedAt" IS NOT NULL AND "endedAt" IS NULL)
    OR ("status" = 'ENDED' AND "startedAt" IS NOT NULL AND "endedAt" IS NOT NULL AND "endedAt" >= "startedAt")
  );

CREATE UNIQUE INDEX "StudentEnrollment_one_active_status_key"
  ON "StudentEnrollment"("studentId") WHERE "status" = 'ACTIVE';
CREATE INDEX "StudentEnrollment_status_idx" ON "StudentEnrollment"("studentId", "status");

ALTER TABLE "RosterImportBatch"
  ADD COLUMN "academicYearId" TEXT,
  ADD COLUMN "mode" TEXT,
  ADD COLUMN "fingerprint" TEXT,
  ADD COLUMN "canonicalDigest" TEXT,
  ADD COLUMN "rosterRevision" INTEGER,
  ADD COLUMN "calendarRevision" INTEGER,
  ADD COLUMN "actorPseudonym" TEXT,
  ADD COLUMN "hmacKeyVersion" TEXT,
  ADD COLUMN "errorReport" JSONB,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE TABLE "RosterMutationState" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "calendarRevision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RosterMutationState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RosterMutationState_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "RosterMutationState" ("id", "revision", "calendarRevision", "updatedAt")
VALUES (1, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "StudentYearTransition" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "sourceEnrollmentId" TEXT NOT NULL,
  "sourceAcademicYearId" TEXT NOT NULL,
  "targetAcademicYearId" TEXT NOT NULL,
  "disposition" "RolloverDisposition" NOT NULL,
  "targetEnrollmentId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "actorUserId" TEXT,
  "actorPseudonym" TEXT,
  "hmacKeyVersion" TEXT,
  "activatedAt" TIMESTAMP(3),
  "activatedTargetGrade" "StudentGrade",
  "activatedTargetClassCode" "ClassCode",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentYearTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentYearTransition_activation_snapshot_check" CHECK (
    ("activatedAt" IS NULL AND "activatedTargetGrade" IS NULL AND "activatedTargetClassCode" IS NULL)
    OR ("activatedAt" IS NOT NULL AND "activatedTargetGrade" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "StudentYearTransition_student_source_target_key"
  ON "StudentYearTransition"("studentId", "sourceAcademicYearId", "targetAcademicYearId");
CREATE UNIQUE INDEX "StudentYearTransition_sourceEnrollment_key"
  ON "StudentYearTransition"("sourceEnrollmentId");
CREATE UNIQUE INDEX "StudentYearTransition_targetEnrollment_key"
  ON "StudentYearTransition"("targetEnrollmentId") WHERE "targetEnrollmentId" IS NOT NULL;
CREATE INDEX "StudentYearTransition_sourceYear_disposition_idx"
  ON "StudentYearTransition"("sourceAcademicYearId", "disposition");
CREATE INDEX "StudentYearTransition_targetYear_disposition_idx"
  ON "StudentYearTransition"("targetAcademicYearId", "disposition");

CREATE TABLE "AdminMutationBatch" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorPseudonym" TEXT,
  "hmacKeyVersion" TEXT,
  "operationKind" "AdminMutationKind" NOT NULL,
  "operationId" TEXT NOT NULL,
  "status" "AdminMutationStatus" NOT NULL DEFAULT 'PREVIEWED',
  "filterHash" TEXT,
  "canonicalDigest" TEXT,
  "rosterRevision" INTEGER,
  "calendarRevision" INTEGER,
  "sourceAcademicYearId" TEXT,
  "targetAcademicYearId" TEXT,
  "sourceYearRevision" INTEGER,
  "targetYearRevision" INTEGER,
  "payload" JSONB,
  "errorReport" JSONB,
  "counts" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminMutationBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminMutationBatch_actor_kind_operation_key"
  ON "AdminMutationBatch"("actorUserId", "operationKind", "operationId");
CREATE INDEX "AdminMutationBatch_actor_created_idx"
  ON "AdminMutationBatch"("actorUserId", "createdAt");
CREATE INDEX "AdminMutationBatch_status_expires_idx"
  ON "AdminMutationBatch"("status", "expiresAt");

CREATE TABLE "RosterImportBatchUserLink" (
  "batchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "linkRole" "BatchUserLinkRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RosterImportBatchUserLink_pkey" PRIMARY KEY ("batchId", "userId", "linkRole")
);

CREATE INDEX "RosterImportBatchUserLink_user_batch_idx"
  ON "RosterImportBatchUserLink"("userId", "batchId");

CREATE TABLE "AdminMutationBatchUserLink" (
  "batchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "linkRole" "BatchUserLinkRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMutationBatchUserLink_pkey" PRIMARY KEY ("batchId", "userId", "linkRole")
);

CREATE INDEX "AdminMutationBatchUserLink_user_batch_idx"
  ON "AdminMutationBatchUserLink"("userId", "batchId");

CREATE TABLE "RecentAuthGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenVersion" INTEGER NOT NULL,
  "credentialRevision" INTEGER NOT NULL,
  "reauthenticatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecentAuthGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecentAuthGrant_user_expires_idx"
  ON "RecentAuthGrant"("userId", "expiresAt");

ALTER TABLE "AcademicYear"
  ADD CONSTRAINT "AcademicYear_status_dates_guard"
  CHECK (
    ("status" = 'PLANNED') OR
    ("status" = 'CURRENT') OR
    ("status" = 'CLOSED')
  );

ALTER TABLE "StudentYearTransition"
  ADD CONSTRAINT "StudentYearTransition_student_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentYearTransition_sourceEnrollment_fkey"
  FOREIGN KEY ("sourceEnrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentYearTransition_targetEnrollment_fkey"
  FOREIGN KEY ("targetEnrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentYearTransition_sourceYear_fkey"
  FOREIGN KEY ("sourceAcademicYearId") REFERENCES "AcademicYear"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentYearTransition_targetYear_fkey"
  FOREIGN KEY ("targetAcademicYearId") REFERENCES "AcademicYear"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentYearTransition_actor_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminMutationBatch"
  ADD CONSTRAINT "AdminMutationBatch_actor_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminMutationBatch_sourceYear_fkey"
  FOREIGN KEY ("sourceAcademicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminMutationBatch_targetYear_fkey"
  FOREIGN KEY ("targetAcademicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RosterImportBatch"
  ADD CONSTRAINT "RosterImportBatch_academicYear_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RosterImportBatchUserLink"
  ADD CONSTRAINT "RosterImportBatchUserLink_batch_fkey"
  FOREIGN KEY ("batchId") REFERENCES "RosterImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RosterImportBatchUserLink_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminMutationBatchUserLink"
  ADD CONSTRAINT "AdminMutationBatchUserLink_batch_fkey"
  FOREIGN KEY ("batchId") REFERENCES "AdminMutationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AdminMutationBatchUserLink_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecentAuthGrant"
  ADD CONSTRAINT "RecentAuthGrant_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
