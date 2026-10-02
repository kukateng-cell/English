-- PostgreSQL current_setting(..., true) returns NULL when a request has not
-- opted into an exceptional transaction.  Coalesce both escape hatches so a
-- missing setting cannot make lifecycle guards silently allow a write.

CREATE OR REPLACE FUNCTION roster_activation_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.roster_activation', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION roster_guard_closed_children()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  year_status "AcademicYearStatus";
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'TeacherClassAccess' THEN
    IF TG_OP = 'DELETE' THEN
      SELECT y.status INTO year_status
      FROM "SchoolClass" c JOIN "AcademicYear" y ON y."id" = c."academicYearId"
      WHERE c."id" = OLD."classId";
    ELSE
      SELECT y.status INTO year_status
      FROM "SchoolClass" c JOIN "AcademicYear" y ON y."id" = c."academicYearId"
      WHERE c."id" = NEW."classId";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      SELECT "status" INTO year_status FROM "AcademicYear" WHERE "id" = OLD."academicYearId";
    ELSE
      SELECT "status" INTO year_status FROM "AcademicYear" WHERE "id" = NEW."academicYearId";
    END IF;
  END IF;

  IF year_status = 'CLOSED'::"AcademicYearStatus"
     AND NOT roster_activation_enabled()
     AND NOT (TG_OP = 'DELETE' AND COALESCE(current_setting('app.roster_hard_delete', true), '') = 'on')
  THEN
    RAISE EXCEPTION 'closed academic data is immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'StudentEnrollment' THEN
    IF TG_OP = 'UPDATE'
       AND OLD."status" = 'ACTIVE'::"EnrollmentStatus"
       AND NEW."status" = 'ENDED'::"EnrollmentStatus"
       AND NOT roster_activation_enabled()
    THEN
      RAISE EXCEPTION 'only activation may end an active enrollment' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
