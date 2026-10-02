-- A user deleted in the narrow interval between 090100 and 090150 no longer
-- has a relation from which to derive uid-v1. Replace any such email-derived
-- legacy value with a per-event, opaque tombstone so it is not dictionary
-- reversible. Linked subjects were already converted to uid-v1 by 090150.
UPDATE "SecurityEvent"
SET "subjectAccountHash" =
  'orphan-v1:' || md5("id" || ':' || "subjectAccountHash")
WHERE "subjectAccountHash" LIKE 'legacy:%';
