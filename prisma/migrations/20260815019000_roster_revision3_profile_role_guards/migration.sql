-- Profile rows must never be attached to a User with the other roster role.
-- This expand-safe guard protects profile writers while the separate shared
-- contract migration still owns the legacy User.role writer retirement.

CREATE OR REPLACE FUNCTION roster_profile_role_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_role "Role";
BEGIN
  SELECT "role" INTO user_role FROM "User" WHERE "id" = NEW."userId";
  IF TG_TABLE_NAME = 'StudentProfile' AND user_role <> 'STUDENT'::"Role" THEN
    RAISE EXCEPTION 'student profile requires a STUDENT user' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'TeacherProfile' AND user_role <> 'TEACHER'::"Role" THEN
    RAISE EXCEPTION 'teacher profile requires a TEACHER user' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "StudentProfile_roster_role_guard" ON "StudentProfile";
CREATE TRIGGER "StudentProfile_roster_role_guard"
BEFORE INSERT OR UPDATE ON "StudentProfile"
FOR EACH ROW EXECUTE FUNCTION roster_profile_role_guard();

DROP TRIGGER IF EXISTS "TeacherProfile_roster_role_guard" ON "TeacherProfile";
CREATE TRIGGER "TeacherProfile_roster_role_guard"
BEFORE INSERT OR UPDATE ON "TeacherProfile"
FOR EACH ROW EXECUTE FUNCTION roster_profile_role_guard();
