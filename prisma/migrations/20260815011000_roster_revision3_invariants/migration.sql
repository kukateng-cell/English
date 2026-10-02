-- Deferred database invariants for the Revision 3 roster lifecycle.

CREATE OR REPLACE FUNCTION roster_immediate_successor(
  source_year_id TEXT,
  target_year_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  source_end DATE;
  target_start DATE;
  target_key TEXT;
BEGIN
  SELECT "endsOn" INTO source_end FROM "AcademicYear" WHERE "id" = source_year_id;
  SELECT "startsOn", "id" INTO target_start, target_key FROM "AcademicYear" WHERE "id" = target_year_id;
  IF source_end IS NULL OR target_start IS NULL THEN RETURN FALSE; END IF;
  IF target_start <= source_end THEN RETURN FALSE; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM "AcademicYear" earlier
    WHERE earlier."status" = 'PLANNED'::"AcademicYearStatus"
      AND earlier."startsOn" > source_end
      AND (earlier."startsOn", earlier."id") < (target_start, target_key)
  );
END;
$$;

CREATE OR REPLACE FUNCTION roster_validate_final_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  bad RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" e
    JOIN "AcademicYear" y ON y."id" = e."academicYearId"
    WHERE (e."status" = 'ACTIVE'::"EnrollmentStatus" AND y."status" <> 'CURRENT'::"AcademicYearStatus")
       OR (e."status" = 'PLANNED'::"EnrollmentStatus" AND y."status" <> 'PLANNED'::"AcademicYearStatus")
       OR (e."status" = 'ENDED'::"EnrollmentStatus" AND y."status" <> 'CLOSED'::"AcademicYearStatus")
  ) THEN
    RAISE EXCEPTION 'enrollment status/year lifecycle invariant violated' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" e
    JOIN "SchoolClass" c ON c."id" = e."classId"
    WHERE e."status" IN ('ACTIVE'::"EnrollmentStatus", 'PLANNED'::"EnrollmentStatus")
      AND c."active" = FALSE
  ) THEN
    RAISE EXCEPTION 'active or planned enrollment cannot reference inactive class' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "TeacherClassAccess" a
    JOIN "SchoolClass" c ON c."id" = a."classId"
    JOIN "AcademicYear" y ON y."id" = c."academicYearId"
    WHERE c."active" = FALSE OR y."status" = 'CLOSED'::"AcademicYearStatus"
  ) THEN
    RAISE EXCEPTION 'teacher access must reference an active non-closed class' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SchoolClass" c
    WHERE c."active" = FALSE
      AND (
        EXISTS (SELECT 1 FROM "StudentEnrollment" e WHERE e."classId" = c."id" AND e."status" IN ('ACTIVE'::"EnrollmentStatus", 'PLANNED'::"EnrollmentStatus"))
        OR EXISTS (SELECT 1 FROM "TeacherClassAccess" a WHERE a."classId" = c."id")
      )
  ) THEN
    RAISE EXCEPTION 'class cannot be deactivated while enrollment or teacher access remains' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" e
    JOIN "AcademicYear" y ON y."id" = e."academicYearId"
    LEFT JOIN "StudentYearTransition" t ON t."sourceEnrollmentId" = e."id"
    WHERE e."status" = 'ENDED'::"EnrollmentStatus"
      AND (t."id" IS NULL OR t."activatedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'ENDED enrollment must be produced by an activated transition' USING ERRCODE = '23514';
  END IF;

  FOR bad IN
    SELECT t."studentId" AS transition_student_id,
           t."sourceEnrollmentId" AS transition_source_enrollment_id,
           t."sourceAcademicYearId" AS transition_source_year_id,
           t."targetAcademicYearId" AS transition_target_year_id,
           t."disposition" AS disposition,
           t."targetEnrollmentId" AS transition_target_enrollment_id,
           t."activatedAt" AS activated_at,
           t."activatedTargetGrade" AS activated_target_grade,
           t."activatedTargetClassCode" AS activated_target_class_code,
           se."studentId" AS source_student_id,
           se."academicYearId" AS source_year_id,
           se."status" AS source_status,
           sy."status" AS source_year_status,
           te."studentId" AS target_student_id,
           te."academicYearId" AS target_year_id,
           te."status" AS target_status,
           ty."status" AS target_year_status,
           te."grade" AS target_grade,
           c."classCode" AS target_class_code,
           se."grade" AS source_grade
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    JOIN "AcademicYear" sy ON sy."id" = t."sourceAcademicYearId"
    JOIN "AcademicYear" ty ON ty."id" = t."targetAcademicYearId"
    LEFT JOIN "StudentEnrollment" te ON te."id" = t."targetEnrollmentId"
    LEFT JOIN "SchoolClass" c ON c."id" = te."classId"
  LOOP
    IF bad.source_student_id <> bad.transition_student_id
       OR bad.source_year_id <> bad.transition_source_year_id
       OR bad.target_year_id <> bad.transition_target_year_id
       OR (bad.target_student_id IS NOT NULL AND bad.target_student_id <> bad.transition_student_id)
       OR NOT roster_immediate_successor(bad.transition_source_year_id, bad.transition_target_year_id)
    THEN
      RAISE EXCEPTION 'transition identity or immediate-successor invariant violated' USING ERRCODE = '23514';
    END IF;

    IF bad.activated_at IS NULL THEN
      IF bad.source_status <> 'ACTIVE'::"EnrollmentStatus"
         OR bad.source_year_status <> 'CURRENT'::"AcademicYearStatus"
         OR bad.target_year_status <> 'PLANNED'::"AcademicYearStatus"
      THEN
        RAISE EXCEPTION 'pre-activation transition source/target lifecycle invariant violated' USING ERRCODE = '23514';
      END IF;
      IF bad.disposition IN ('PROMOTE'::"RolloverDisposition", 'REPEAT'::"RolloverDisposition", 'HOLD_UNASSIGNED'::"RolloverDisposition")
         AND (bad.transition_target_enrollment_id IS NULL OR bad.target_status <> 'PLANNED'::"EnrollmentStatus")
      THEN
        RAISE EXCEPTION 'non-terminal pre-activation transition requires planned target enrollment' USING ERRCODE = '23514';
      END IF;
      IF bad.disposition IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition")
         AND bad.transition_target_enrollment_id IS NOT NULL
      THEN
        RAISE EXCEPTION 'terminal pre-activation transition cannot link target enrollment' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF bad.source_status <> 'ENDED'::"EnrollmentStatus"
         OR bad.source_year_status <> 'CLOSED'::"AcademicYearStatus"
      THEN
        RAISE EXCEPTION 'activated transition source must be ended in a closed year' USING ERRCODE = '23514';
      END IF;
      IF bad.disposition IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition") THEN
        IF bad.transition_target_enrollment_id IS NOT NULL OR bad.activated_target_grade IS NOT NULL OR bad.activated_target_class_code IS NOT NULL THEN
          RAISE EXCEPTION 'activated terminal transition must not have target or snapshots' USING ERRCODE = '23514';
        END IF;
      ELSE
        IF bad.transition_target_enrollment_id IS NULL OR bad.activated_target_grade IS NULL
           OR bad.target_status NOT IN ('ACTIVE'::"EnrollmentStatus", 'ENDED'::"EnrollmentStatus")
           OR bad.target_year_status NOT IN ('CURRENT'::"AcademicYearStatus", 'CLOSED'::"AcademicYearStatus")
        THEN
          RAISE EXCEPTION 'activated non-terminal transition target invariant violated' USING ERRCODE = '23514';
        END IF;
        IF bad.disposition = 'PROMOTE'::"RolloverDisposition"
           AND bad.activated_target_grade <> (CASE bad.source_grade
             WHEN 'JUNIOR_1'::"StudentGrade" THEN 'JUNIOR_2'::"StudentGrade"
             WHEN 'JUNIOR_2'::"StudentGrade" THEN 'JUNIOR_3'::"StudentGrade"
             WHEN 'JUNIOR_3'::"StudentGrade" THEN 'SENIOR_1'::"StudentGrade"
             WHEN 'SENIOR_1'::"StudentGrade" THEN 'SENIOR_2'::"StudentGrade"
             WHEN 'SENIOR_2'::"StudentGrade" THEN 'SENIOR_3'::"StudentGrade"
             ELSE NULL
           END)
        THEN
          RAISE EXCEPTION 'activated PROMOTE snapshot grade is invalid' USING ERRCODE = '23514';
        END IF;
        IF bad.disposition = 'REPEAT'::"RolloverDisposition"
           AND (bad.activated_target_grade <> bad.source_grade OR bad.activated_target_class_code IS NULL)
        THEN
          RAISE EXCEPTION 'activated REPEAT snapshot is invalid' USING ERRCODE = '23514';
        END IF;
        IF bad.disposition = 'HOLD_UNASSIGNED'::"RolloverDisposition"
           AND (bad.activated_target_grade <> bad.source_grade OR bad.activated_target_class_code IS NOT NULL)
        THEN
          RAISE EXCEPTION 'activated HOLD snapshot is invalid' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" source
    JOIN "AcademicYear" sy ON sy."id" = source."academicYearId" AND sy."status" = 'CURRENT'::"AcademicYearStatus"
    JOIN "AcademicYear" ty ON ty."status" = 'PLANNED'::"AcademicYearStatus"
      AND roster_immediate_successor(sy."id", ty."id")
    JOIN "StudentEnrollment" target ON target."studentId" = source."studentId"
      AND target."academicYearId" = ty."id" AND target."status" = 'PLANNED'::"EnrollmentStatus"
    LEFT JOIN "StudentYearTransition" t ON t."studentId" = source."studentId"
      AND t."sourceAcademicYearId" = sy."id" AND t."targetAcademicYearId" = ty."id"
    WHERE source."status" = 'ACTIVE'::"EnrollmentStatus" AND t."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'current plus immediate planned enrollment requires a pre-activation transition' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "AcademicYear_roster_final_state"
AFTER INSERT OR UPDATE ON "AcademicYear"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_final_state();
CREATE CONSTRAINT TRIGGER "SchoolClass_roster_final_state"
AFTER INSERT OR UPDATE OR DELETE ON "SchoolClass"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_final_state();
CREATE CONSTRAINT TRIGGER "StudentEnrollment_roster_final_state"
AFTER INSERT OR UPDATE OR DELETE ON "StudentEnrollment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_final_state();
CREATE CONSTRAINT TRIGGER "StudentYearTransition_roster_final_state"
AFTER INSERT OR UPDATE OR DELETE ON "StudentYearTransition"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_final_state();
CREATE CONSTRAINT TRIGGER "TeacherClassAccess_roster_final_state"
AFTER INSERT OR UPDATE OR DELETE ON "TeacherClassAccess"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION roster_validate_final_state();

CREATE OR REPLACE FUNCTION roster_bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "RosterMutationState" SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION roster_bump_calendar_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "RosterMutationState"
  SET "revision" = "revision" + 1, "calendarRevision" = "calendarRevision" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 1;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "User_roster_revision"
AFTER INSERT OR DELETE ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "User_status_role_roster_revision"
AFTER UPDATE OF "role", "status" ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "TeacherProfile_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "TeacherProfile"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "TeacherClassAccess_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "TeacherClassAccess"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "AcademicYear_roster_calendar_revision"
AFTER INSERT OR UPDATE OR DELETE ON "AcademicYear"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_calendar_revision();
CREATE TRIGGER "SchoolClass_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "SchoolClass"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "StudentEnrollment_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "StudentEnrollment"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
CREATE TRIGGER "StudentYearTransition_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "StudentYearTransition"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
