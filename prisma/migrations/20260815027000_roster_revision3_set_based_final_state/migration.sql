-- Large academic-year activation can queue thousands of deferred row triggers.
-- The final-state predicates are transaction-wide, so only the first deferred
-- invocation needs to evaluate them.  A transaction-local marker keeps later
-- trigger invocations cheap while preserving fail-closed behavior: if the
-- first evaluation raises, the transaction aborts and the marker is discarded.

CREATE OR REPLACE FUNCTION roster_validate_final_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.roster_final_state_checked', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.roster_final_state_checked', 'on', true);

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
    LEFT JOIN "StudentYearTransition" t ON t."sourceEnrollmentId" = e."id"
    WHERE e."status" = 'ENDED'::"EnrollmentStatus"
      AND (t."id" IS NULL OR t."activatedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'ENDED enrollment must be produced by an activated transition' USING ERRCODE = '23514';
  END IF;

  -- Identity and immediate-successor checks are expressed as set predicates
  -- instead of calling a SQL function once per transition row.
  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    JOIN "AcademicYear" sy ON sy."id" = t."sourceAcademicYearId"
    JOIN "AcademicYear" ty ON ty."id" = t."targetAcademicYearId"
    LEFT JOIN "StudentEnrollment" te ON te."id" = t."targetEnrollmentId"
    WHERE se."studentId" IS DISTINCT FROM t."studentId"
       OR se."academicYearId" IS DISTINCT FROM t."sourceAcademicYearId"
       OR (te."studentId" IS NOT NULL AND te."studentId" IS DISTINCT FROM t."studentId")
       OR ty."startsOn" <= sy."endsOn"
       OR EXISTS (
         SELECT 1
         FROM "AcademicYear" earlier
         WHERE earlier."status" = 'PLANNED'::"AcademicYearStatus"
           AND earlier."startsOn" > sy."endsOn"
           AND (earlier."startsOn", earlier."id") < (ty."startsOn", ty."id")
       )
  ) THEN
    RAISE EXCEPTION 'transition identity or immediate-successor invariant violated' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    JOIN "AcademicYear" sy ON sy."id" = t."sourceAcademicYearId"
    JOIN "AcademicYear" ty ON ty."id" = t."targetAcademicYearId"
    LEFT JOIN "StudentEnrollment" te ON te."id" = t."targetEnrollmentId"
    WHERE t."activatedAt" IS NULL
      AND (se."status" <> 'ACTIVE'::"EnrollmentStatus"
        OR sy."status" <> 'CURRENT'::"AcademicYearStatus"
        OR ty."status" <> 'PLANNED'::"AcademicYearStatus")
  ) THEN
    RAISE EXCEPTION 'pre-activation transition source/target lifecycle invariant violated' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    LEFT JOIN "StudentEnrollment" te ON te."id" = t."targetEnrollmentId"
    WHERE t."activatedAt" IS NULL
      AND t."disposition" IN ('PROMOTE'::"RolloverDisposition", 'REPEAT'::"RolloverDisposition", 'HOLD_UNASSIGNED'::"RolloverDisposition")
      AND (t."targetEnrollmentId" IS NULL OR te."status" <> 'PLANNED'::"EnrollmentStatus")
  ) THEN
    RAISE EXCEPTION 'non-terminal pre-activation transition requires planned target enrollment' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    WHERE t."activatedAt" IS NULL
      AND t."disposition" IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition")
      AND t."targetEnrollmentId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'terminal pre-activation transition cannot link target enrollment' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    JOIN "AcademicYear" sy ON sy."id" = t."sourceAcademicYearId"
    WHERE t."activatedAt" IS NOT NULL
      AND (se."status" <> 'ENDED'::"EnrollmentStatus" OR sy."status" <> 'CLOSED'::"AcademicYearStatus")
  ) THEN
    RAISE EXCEPTION 'activated transition source must be ended in a closed year' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    WHERE t."activatedAt" IS NOT NULL
      AND t."disposition" IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition")
      AND (t."targetEnrollmentId" IS NOT NULL OR t."activatedTargetGrade" IS NOT NULL OR t."activatedTargetClassCode" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'activated terminal transition must not have target or snapshots' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    LEFT JOIN "StudentEnrollment" te ON te."id" = t."targetEnrollmentId"
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    JOIN "AcademicYear" ty ON ty."id" = t."targetAcademicYearId"
    WHERE t."activatedAt" IS NOT NULL
      AND t."disposition" NOT IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition")
      AND (t."targetEnrollmentId" IS NULL
        OR t."activatedTargetGrade" IS NULL
        OR te."status" NOT IN ('ACTIVE'::"EnrollmentStatus", 'ENDED'::"EnrollmentStatus")
        OR ty."status" NOT IN ('CURRENT'::"AcademicYearStatus", 'CLOSED'::"AcademicYearStatus"))
  ) THEN
    RAISE EXCEPTION 'activated non-terminal transition target invariant violated' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    WHERE t."activatedAt" IS NOT NULL
      AND t."disposition" = 'PROMOTE'::"RolloverDisposition"
      AND t."activatedTargetGrade" IS DISTINCT FROM CASE se."grade"
        WHEN 'JUNIOR_1'::"StudentGrade" THEN 'JUNIOR_2'::"StudentGrade"
        WHEN 'JUNIOR_2'::"StudentGrade" THEN 'JUNIOR_3'::"StudentGrade"
        WHEN 'JUNIOR_3'::"StudentGrade" THEN 'SENIOR_1'::"StudentGrade"
        WHEN 'SENIOR_1'::"StudentGrade" THEN 'SENIOR_2'::"StudentGrade"
        WHEN 'SENIOR_2'::"StudentGrade" THEN 'SENIOR_3'::"StudentGrade"
        ELSE NULL
      END
  ) THEN
    RAISE EXCEPTION 'activated PROMOTE snapshot grade is invalid' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    WHERE t."activatedAt" IS NOT NULL
      AND t."disposition" = 'REPEAT'::"RolloverDisposition"
      AND (t."activatedTargetGrade" IS DISTINCT FROM se."grade" OR t."activatedTargetClassCode" IS NULL)
  ) THEN
    RAISE EXCEPTION 'activated REPEAT snapshot is invalid' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentYearTransition" t
    JOIN "StudentEnrollment" se ON se."id" = t."sourceEnrollmentId"
    WHERE t."activatedAt" IS NOT NULL
      AND t."disposition" = 'HOLD_UNASSIGNED'::"RolloverDisposition"
      AND (t."activatedTargetGrade" IS DISTINCT FROM se."grade" OR t."activatedTargetClassCode" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'activated HOLD snapshot is invalid' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" source
    JOIN "AcademicYear" sy ON sy."id" = source."academicYearId" AND sy."status" = 'CURRENT'::"AcademicYearStatus"
    JOIN "AcademicYear" ty ON ty."status" = 'PLANNED'::"AcademicYearStatus"
      AND ty."startsOn" > sy."endsOn"
      AND NOT EXISTS (
        SELECT 1 FROM "AcademicYear" earlier
        WHERE earlier."status" = 'PLANNED'::"AcademicYearStatus"
          AND earlier."startsOn" > sy."endsOn"
          AND (earlier."startsOn", earlier."id") < (ty."startsOn", ty."id")
      )
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

CREATE OR REPLACE FUNCTION roster_validate_planned_successor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.roster_planned_successor_checked', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.roster_planned_successor_checked', 'on', true);
  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" e
    JOIN "AcademicYear" y ON y."id" = e."academicYearId" AND y."status" = 'PLANNED'::"AcademicYearStatus"
    JOIN "AcademicYear" current_year ON current_year."status" = 'CURRENT'::"AcademicYearStatus"
    WHERE e."status" = 'PLANNED'::"EnrollmentStatus"
      AND (
        y."startsOn" <= current_year."endsOn"
        OR EXISTS (
          SELECT 1 FROM "AcademicYear" earlier
          WHERE earlier."status" = 'PLANNED'::"AcademicYearStatus"
            AND earlier."startsOn" > current_year."endsOn"
            AND (earlier."startsOn", earlier."id") < (y."startsOn", y."id")
        )
      )
  ) THEN
    RAISE EXCEPTION 'planned enrollment must belong to the immediate successor year' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
