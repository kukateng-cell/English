-- Expand-only class roster foundation.
--
-- The physical User.email and User.name columns intentionally remain in
-- place. New Prisma code maps them to accountName and legacyName so an older
-- binary can still read the database during the rollback window.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "StudentGrade" AS ENUM (
  'JUNIOR_1',
  'JUNIOR_2',
  'JUNIOR_3',
  'SENIOR_1',
  'SENIOR_2',
  'SENIOR_3'
);
CREATE TYPE "ClassCode" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H');
CREATE TYPE "RosterEntityType" AS ENUM ('STUDENT', 'TEACHER');
CREATE TYPE "RosterFileFormat" AS ENUM ('CSV', 'XLSX');
CREATE TYPE "RosterImportStatus" AS ENUM (
  'PREVIEWED',
  'COMMITTED',
  'EXPIRED',
  'FAILED'
);

ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ACCOUNT_SUSPENDED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ACCOUNT_REACTIVATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'NICKNAME_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'PROFILE_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'CLASS_ACCESS_GRANTED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'CLASS_ACCESS_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'STUDENT_CLASS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'STUDENTS_PROMOTED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROSTER_IMPORTED';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'ROSTER_EXPORTED';

ALTER TABLE "User"
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedReason" TEXT;

CREATE TABLE "StudentProfile" (
  "userId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "nicknameNormalized" TEXT NOT NULL,
  "nicknameUpdatedAt" TIMESTAMP(3),
  "profileRevision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "TeacherProfile" (
  "userId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "profileRevision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "AcademicYear" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AcademicYear_dates_check" CHECK ("startsOn" <= "endsOn")
);

CREATE TABLE "SchoolClass" (
  "id" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "grade" "StudentGrade" NOT NULL,
  "classCode" "ClassCode" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentEnrollment" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "grade" "StudentGrade" NOT NULL,
  "classId" TEXT,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentEnrollment_current_dates_check" CHECK (
    ("isCurrent" = true AND "endedAt" IS NULL)
    OR
    ("isCurrent" = false AND "endedAt" IS NOT NULL)
  )
);

CREATE TABLE "TeacherClassAccess" (
  "teacherId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "canViewProgress" BOOLEAN NOT NULL DEFAULT true,
  "canResetStudentPassword" BOOLEAN NOT NULL DEFAULT false,
  "grantedById" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherClassAccess_pkey" PRIMARY KEY ("teacherId", "classId"),
  CONSTRAINT "TeacherClassAccess_reset_requires_view_check" CHECK (
    "canResetStudentPassword" = false OR "canViewProgress" = true
  )
);

CREATE TABLE "RosterImportBatch" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "entityType" "RosterEntityType" NOT NULL,
  "format" "RosterFileFormat" NOT NULL,
  "fileHash" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "status" "RosterImportStatus" NOT NULL DEFAULT 'PREVIEWED',
  "rowCount" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "stagedRows" JSONB,
  "summary" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RosterImportBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RosterImportBatch_counts_check" CHECK (
    "rowCount" >= 0
    AND "createdCount" >= 0
    AND "updatedCount" >= 0
    AND "skippedCount" >= 0
    AND "errorCount" >= 0
  )
);

-- Existing local identities are backfilled without guessing grade or class.
-- A stable pseudonym is generated instead of copying a possible legal name
-- into the public nickname field.
INSERT INTO "StudentProfile" (
  "userId",
  "legalName",
  "nickname",
  "nicknameNormalized",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  COALESCE(NULLIF(BTRIM("name"), ''), "email"),
  '學員-' || UPPER(SUBSTRING(MD5("id") FROM 1 FOR 8)),
  '學員-' || LOWER(SUBSTRING(MD5("id") FROM 1 FOR 8)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'STUDENT'
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "TeacherProfile" (
  "userId",
  "legalName",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  COALESCE(NULLIF(BTRIM("name"), ''), "email"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'TEACHER'
ON CONFLICT ("userId") DO NOTHING;

CREATE INDEX "StudentProfile_legalName_idx"
  ON "StudentProfile"("legalName");
CREATE INDEX "StudentProfile_nicknameNormalized_idx"
  ON "StudentProfile"("nicknameNormalized");
CREATE INDEX "TeacherProfile_legalName_idx"
  ON "TeacherProfile"("legalName");

CREATE UNIQUE INDEX "AcademicYear_label_key"
  ON "AcademicYear"("label");
CREATE INDEX "AcademicYear_isCurrent_idx"
  ON "AcademicYear"("isCurrent");
CREATE UNIQUE INDEX "AcademicYear_one_current_key"
  ON "AcademicYear"(("isCurrent"))
  WHERE "isCurrent" = true;

CREATE INDEX "SchoolClass_academicYearId_grade_active_idx"
  ON "SchoolClass"("academicYearId", "grade", "active");
CREATE UNIQUE INDEX "SchoolClass_academicYearId_grade_classCode_key"
  ON "SchoolClass"("academicYearId", "grade", "classCode");
CREATE UNIQUE INDEX "SchoolClass_id_academicYearId_grade_key"
  ON "SchoolClass"("id", "academicYearId", "grade");

CREATE INDEX "StudentEnrollment_academicYearId_grade_isCurrent_idx"
  ON "StudentEnrollment"("academicYearId", "grade", "isCurrent");
CREATE INDEX "StudentEnrollment_classId_isCurrent_idx"
  ON "StudentEnrollment"("classId", "isCurrent");
CREATE UNIQUE INDEX "StudentEnrollment_studentId_academicYearId_key"
  ON "StudentEnrollment"("studentId", "academicYearId");
CREATE UNIQUE INDEX "StudentEnrollment_one_current_per_student_key"
  ON "StudentEnrollment"("studentId")
  WHERE "isCurrent" = true;

CREATE INDEX "TeacherClassAccess_classId_canViewProgress_idx"
  ON "TeacherClassAccess"("classId", "canViewProgress");

CREATE INDEX "RosterImportBatch_actorUserId_createdAt_idx"
  ON "RosterImportBatch"("actorUserId", "createdAt");
CREATE INDEX "RosterImportBatch_status_expiresAt_idx"
  ON "RosterImportBatch"("status", "expiresAt");
CREATE UNIQUE INDEX "RosterImportBatch_actorUserId_operationId_key"
  ON "RosterImportBatch"("actorUserId", "operationId");

CREATE UNIQUE INDEX "User_contactEmail_key"
  ON "User"("contactEmail");
CREATE INDEX "User_role_status_idx"
  ON "User"("role", "status");

ALTER TABLE "StudentProfile"
  ADD CONSTRAINT "StudentProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherProfile"
  ADD CONSTRAINT "TeacherProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolClass"
  ADD CONSTRAINT "SchoolClass_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_classId_academicYearId_grade_fkey"
  FOREIGN KEY ("classId", "academicYearId", "grade")
  REFERENCES "SchoolClass"("id", "academicYearId", "grade")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherClassAccess"
  ADD CONSTRAINT "TeacherClassAccess_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherClassAccess"
  ADD CONSTRAINT "TeacherClassAccess_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherClassAccess"
  ADD CONSTRAINT "TeacherClassAccess_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RosterImportBatch"
  ADD CONSTRAINT "RosterImportBatch_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
