-- Replace predictable legacy email hashes with a stable pseudonymous key
-- derived from the user's high-entropy opaque id. New application events use
-- the same uid-v1 format, so subject correlation survives account deletion.
UPDATE "SecurityEvent" AS event
SET "subjectAccountHash" = 'uid-v1:' || md5(account."id")
FROM "User" AS account
WHERE event."subjectUserId" = account."id";
