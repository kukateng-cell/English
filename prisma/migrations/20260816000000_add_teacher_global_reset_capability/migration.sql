-- Teacher reset permission is now an explicit account-level capability.
-- Existing per-class flags remain untouched during the expand window; no
-- legacy TRUE value is promoted automatically.
ALTER TABLE "TeacherProfile"
  ADD COLUMN "canResetStudentPassword" BOOLEAN NOT NULL DEFAULT false;
