-- Revision 3 lifecycle write guards.  The existing deferred invariant trigger
-- proves the final shape; these BEFORE guards prevent ordinary writers from
-- mutating immutable CLOSED history or performing half an activation.

CREATE OR REPLACE FUNCTION roster_activation_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.roster_activation', true) = 'on';
$$;

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
     AND NOT (OLD.status = NEW.status)
  THEN
    RAISE EXCEPTION 'academic year status transition is not allowed' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('CURRENT'::"AcademicYearStatus", 'CLOSED'::"AcademicYearStatus")
     AND (NEW."label" IS DISTINCT FROM OLD."label"
       OR NEW."startsOn" IS DISTINCT FROM OLD."startsOn"
       OR NEW."endsOn" IS DISTINCT FROM OLD."endsOn")
     AND NOT roster_activation_enabled()
  THEN
    RAISE EXCEPTION 'current or closed academic year dates are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
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
    SELECT y.status INTO year_status
    FROM "SchoolClass" c
    JOIN "AcademicYear" y ON y.id = c."academicYearId"
    WHERE c.id = COALESCE(NEW."classId", OLD."classId");
  ELSE
    SELECT status INTO year_status
    FROM "AcademicYear"
    WHERE id = COALESCE(NEW."academicYearId", OLD."academicYearId");
  END IF;
  IF year_status = 'CLOSED'::"AcademicYearStatus"
     AND NOT roster_activation_enabled()
     AND NOT (TG_OP = 'DELETE' AND current_setting('app.roster_hard_delete', true) = 'on')
  THEN
    RAISE EXCEPTION 'closed academic data is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'StudentEnrollment'
     AND TG_OP = 'UPDATE'
     AND OLD.status = 'ACTIVE'::"EnrollmentStatus"
     AND NEW.status = 'ENDED'::"EnrollmentStatus"
     AND NOT roster_activation_enabled()
  THEN
    RAISE EXCEPTION 'only activation may end an active enrollment' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION roster_guard_transition_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."activatedAt" IS NOT NULL THEN
    IF NEW."studentId" IS DISTINCT FROM OLD."studentId"
       OR NEW."sourceEnrollmentId" IS DISTINCT FROM OLD."sourceEnrollmentId"
       OR NEW."sourceAcademicYearId" IS DISTINCT FROM OLD."sourceAcademicYearId"
       OR NEW."targetAcademicYearId" IS DISTINCT FROM OLD."targetAcademicYearId"
       OR NEW."disposition" IS DISTINCT FROM OLD."disposition"
       OR NEW."targetEnrollmentId" IS DISTINCT FROM OLD."targetEnrollmentId"
       OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt"
       OR NEW."activatedTargetGrade" IS DISTINCT FROM OLD."activatedTargetGrade"
       OR NEW."activatedTargetClassCode" IS DISTINCT FROM OLD."activatedTargetClassCode"
    THEN
      RAISE EXCEPTION 'activated transition is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AcademicYear_roster_write_guard" ON "AcademicYear";
CREATE TRIGGER "AcademicYear_roster_write_guard"
BEFORE UPDATE OR DELETE ON "AcademicYear"
FOR EACH ROW EXECUTE FUNCTION roster_guard_year_write();

DROP TRIGGER IF EXISTS "SchoolClass_roster_closed_guard" ON "SchoolClass";
CREATE TRIGGER "SchoolClass_roster_closed_guard"
BEFORE UPDATE OR DELETE ON "SchoolClass"
FOR EACH ROW EXECUTE FUNCTION roster_guard_closed_children();

DROP TRIGGER IF EXISTS "StudentEnrollment_roster_closed_guard" ON "StudentEnrollment";
CREATE TRIGGER "StudentEnrollment_roster_closed_guard"
BEFORE UPDATE OR DELETE ON "StudentEnrollment"
FOR EACH ROW EXECUTE FUNCTION roster_guard_closed_children();

DROP TRIGGER IF EXISTS "TeacherClassAccess_roster_closed_guard" ON "TeacherClassAccess";
CREATE TRIGGER "TeacherClassAccess_roster_closed_guard"
BEFORE UPDATE OR DELETE ON "TeacherClassAccess"
FOR EACH ROW EXECUTE FUNCTION roster_guard_closed_children();

DROP TRIGGER IF EXISTS "StudentYearTransition_roster_immutable_guard" ON "StudentYearTransition";
CREATE TRIGGER "StudentYearTransition_roster_immutable_guard"
BEFORE UPDATE ON "StudentYearTransition"
FOR EACH ROW EXECUTE FUNCTION roster_guard_transition_write();

-- A student incoming row is allowed without a transition only while it has no
-- current source.  Once a current year exists, every planned enrollment must
-- belong to its immediate successor; this also makes year date reordering
-- fail closed rather than silently changing the meaning of a batch.
CREATE OR REPLACE FUNCTION roster_validate_planned_successor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" e
    JOIN "AcademicYear" y ON y.id = e."academicYearId" AND y.status = 'PLANNED'::"AcademicYearStatus"
    JOIN "AcademicYear" current_year ON current_year.status = 'CURRENT'::"AcademicYearStatus"
    WHERE e.status = 'PLANNED'::"EnrollmentStatus"
      AND NOT roster_immediate_successor(current_year.id, y.id)
  ) THEN
    RAISE EXCEPTION 'planned enrollment must belong to the immediate successor year' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "AcademicYear_roster_planned_successor" ON "AcademicYear";
CREATE CONSTRAINT TRIGGER "AcademicYear_roster_planned_successor"
AFTER INSERT OR UPDATE OR DELETE ON "AcademicYear"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_planned_successor();

DROP TRIGGER IF EXISTS "StudentEnrollment_roster_planned_successor" ON "StudentEnrollment";
CREATE CONSTRAINT TRIGGER "StudentEnrollment_roster_planned_successor"
AFTER INSERT OR UPDATE OR DELETE ON "StudentEnrollment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_planned_successor();
