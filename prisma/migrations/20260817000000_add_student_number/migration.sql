-- Student numbers are scoped to an academic year and class.  NULL is
-- intentional for students who have not been assigned to a class yet.
ALTER TABLE "StudentEnrollment"
  ADD COLUMN "studentNumber" INTEGER;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_studentNumber_check"
  CHECK ("studentNumber" IS NULL OR ("studentNumber" >= 1 AND "studentNumber" <= 999999));

CREATE UNIQUE INDEX "StudentEnrollment_year_class_student_number_key"
  ON "StudentEnrollment" ("academicYearId", "classId", "studentNumber")
  WHERE "studentNumber" IS NOT NULL;

-- PostgreSQL treats NULL class IDs as distinct.  Keep unassigned students'
-- numbers unique per academic year as well, so preview and commit have the
-- same invariant under concurrent writes.
CREATE UNIQUE INDEX "StudentEnrollment_year_unassigned_student_number_key"
  ON "StudentEnrollment" ("academicYearId", "studentNumber")
  WHERE "studentNumber" IS NOT NULL AND "classId" IS NULL;

CREATE INDEX "StudentEnrollment_academicYear_studentNumber_idx"
  ON "StudentEnrollment" ("academicYearId", "studentNumber");
