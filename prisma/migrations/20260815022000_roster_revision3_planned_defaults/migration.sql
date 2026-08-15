-- New writers must be able to create a PLANNED enrollment without inheriting
-- the legacy CURRENT-era startedAt default.  Keep the physical isCurrent
-- default for old binaries, but require canonical writers to project it
-- explicitly (all application paths do so) so the legacy partial index cannot
-- confuse a planned row with the current enrollment.
ALTER TABLE "StudentEnrollment"
  ALTER COLUMN "startedAt" DROP DEFAULT;
