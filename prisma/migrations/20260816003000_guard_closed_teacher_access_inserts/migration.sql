-- CLOSED-year TeacherClassAccess rows are retained as immutable history, but
-- new rows must still fail closed.  The original child guard covered only
-- UPDATE/DELETE because the deferred final-state trigger rejected inserts;
-- the history-preserving final-state migration removes that broad rejection,
-- so add the explicit INSERT guard here.
DROP TRIGGER IF EXISTS "TeacherClassAccess_roster_closed_insert_guard" ON "TeacherClassAccess";
CREATE TRIGGER "TeacherClassAccess_roster_closed_insert_guard"
BEFORE INSERT ON "TeacherClassAccess"
FOR EACH ROW EXECUTE FUNCTION roster_guard_closed_children();
