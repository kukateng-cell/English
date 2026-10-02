-- Fix polymorphic trigger access: TG records do not expose enrollment-only
-- fields when the same function is attached to SchoolClass/Access.

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
    SELECT y.status INTO year_status
    FROM "SchoolClass" c
    JOIN "AcademicYear" y ON y.id = c."academicYearId"
    WHERE c.id = CASE WHEN TG_OP = 'DELETE' THEN OLD."classId" ELSE NEW."classId" END;
  ELSE
    SELECT status INTO year_status
    FROM "AcademicYear"
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."academicYearId" ELSE NEW."academicYearId" END;
  END IF;

  IF year_status = 'CLOSED'::"AcademicYearStatus"
     AND NOT roster_activation_enabled()
     AND NOT (TG_OP = 'DELETE' AND current_setting('app.roster_hard_delete', true) = 'on')
  THEN
    RAISE EXCEPTION 'closed academic data is immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'StudentEnrollment'
     AND TG_OP = 'UPDATE'
     AND OLD."status" = 'ACTIVE'::"EnrollmentStatus"
     AND NEW."status" = 'ENDED'::"EnrollmentStatus"
     AND NOT roster_activation_enabled()
  THEN
    RAISE EXCEPTION 'only activation may end an active enrollment' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
