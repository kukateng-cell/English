-- The legacy foundation check only understood isCurrent=true/false and
-- treated every false row as historical.  Revision 3 has a third planned
-- state, so remove that obsolete check and maintain the legacy projection
-- from the canonical status for every new writer.
ALTER TABLE "StudentEnrollment"
  DROP CONSTRAINT IF EXISTS "StudentEnrollment_current_dates_check";

UPDATE "StudentEnrollment"
SET "isCurrent" = ("status" = 'ACTIVE'::"EnrollmentStatus");

CREATE OR REPLACE FUNCTION roster_project_legacy_enrollment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."isCurrent" := (NEW."status" = 'ACTIVE'::"EnrollmentStatus");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "StudentEnrollment_legacy_projection" ON "StudentEnrollment";
CREATE TRIGGER "StudentEnrollment_legacy_projection"
BEFORE INSERT OR UPDATE OF "status", "isCurrent"
ON "StudentEnrollment"
FOR EACH ROW EXECUTE FUNCTION roster_project_legacy_enrollment();
