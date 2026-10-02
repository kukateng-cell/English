-- TeacherClassAccess rows are historical roster records after their academic
-- year closes.  Runtime teacher queries already scope to CURRENT/PLANNED
-- years, while the closed-year write guard keeps these rows immutable.  The
-- final-state check must therefore reject inactive classes but retain access
-- rows attached to a CLOSED year instead of treating the historical row as a
-- live authorization.
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('roster_validate_final_state()'::regprocedure)
    INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'roster_validate_final_state() is missing';
  END IF;
  IF position(
    'WHERE c."active" = FALSE OR y."status" = ''CLOSED''::"AcademicYearStatus"'
    IN definition
  ) = 0 THEN
    RAISE EXCEPTION 'unexpected roster_validate_final_state() definition';
  END IF;
  definition := replace(
    definition,
    'WHERE c."active" = FALSE OR y."status" = ''CLOSED''::"AcademicYearStatus"',
    'WHERE c."active" = FALSE'
  );
  EXECUTE definition;
END;
$$;
