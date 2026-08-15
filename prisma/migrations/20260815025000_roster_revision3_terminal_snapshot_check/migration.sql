-- Terminal transitions intentionally have no target enrollment or activation
-- snapshot. Non-terminal transitions still require an activation grade; the
-- deferred lifecycle trigger validates the detailed disposition shape.

ALTER TABLE "StudentYearTransition"
  DROP CONSTRAINT "StudentYearTransition_activation_snapshot_check";

ALTER TABLE "StudentYearTransition"
  ADD CONSTRAINT "StudentYearTransition_activation_snapshot_check" CHECK (
    ("activatedAt" IS NULL AND "activatedTargetGrade" IS NULL AND "activatedTargetClassCode" IS NULL)
    OR (
      "activatedAt" IS NOT NULL
      AND (
        "activatedTargetGrade" IS NOT NULL
        OR (
          "disposition" IN ('GRADUATE'::"RolloverDisposition", 'LEAVE'::"RolloverDisposition")
          AND "targetEnrollmentId" IS NULL
          AND "activatedTargetClassCode" IS NULL
        )
      )
    )
  );
