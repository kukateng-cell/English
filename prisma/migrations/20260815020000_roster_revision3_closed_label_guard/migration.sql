-- CLOSED years are immutable history, including their display label.
CREATE OR REPLACE FUNCTION roster_guard_year_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CLOSED'::"AcademicYearStatus" AND NOT roster_activation_enabled() THEN
      RAISE EXCEPTION 'closed academic year is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CLOSED'::"AcademicYearStatus" AND NOT roster_activation_enabled() THEN
    RAISE EXCEPTION 'closed academic year is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CURRENT'::"AcademicYearStatus"
     AND NEW.status = 'CLOSED'::"AcademicYearStatus"
     AND NOT roster_activation_enabled() THEN
    RAISE EXCEPTION 'only activation may close the current academic year' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> NEW.status
     AND NOT (
       OLD.status = 'PLANNED'::"AcademicYearStatus"
       AND NEW.status = 'CURRENT'::"AcademicYearStatus"
       AND roster_activation_enabled()
     )
  THEN
    RAISE EXCEPTION 'academic year status transition is not allowed' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('CURRENT'::"AcademicYearStatus", 'CLOSED'::"AcademicYearStatus")
     AND (NEW."label" IS DISTINCT FROM OLD."label"
       OR NEW."startsOn" IS DISTINCT FROM OLD."startsOn"
       OR NEW."endsOn" IS DISTINCT FROM OLD."endsOn")
     AND NOT roster_activation_enabled()
  THEN
    RAISE EXCEPTION 'current or closed academic year identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
