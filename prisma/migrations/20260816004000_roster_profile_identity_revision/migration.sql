-- Profile identity edits participate in the same directory/cursor revision as
-- the rest of the roster.  These are statement-level bumps so a bulk import
-- invalidates a cursor once, rather than once per row.
CREATE OR REPLACE FUNCTION roster_bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "RosterMutationState"
  SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 1;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "StudentProfile_roster_revision" ON "StudentProfile";
CREATE TRIGGER "StudentProfile_roster_revision"
AFTER INSERT OR UPDATE OR DELETE ON "StudentProfile"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();

DROP TRIGGER IF EXISTS "User_identity_roster_revision" ON "User";
CREATE TRIGGER "User_identity_roster_revision"
AFTER UPDATE OF "name", "contactEmail", "contactEmailCanonical" ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION roster_bump_revision();
