-- 指定帳戶的唯讀盤點。使用現有授權連線，不把密碼寫入命令或輸出。
-- psql <連線選項> -v account='__test_student__local' -f scripts/audit-study-selection.sql
-- Prisma URL 的 ?schema=public 不能直接傳予 psql。
\set ON_ERROR_STOP on
\if :{?account}
\else
\set account '__test_student__local'
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

-- createdAt 表示建立 presentation；不代表每次恢復或真實看見的時間。
SELECT i."createdAt", w."term", i."senseId", i."itemKind", i."status",
       i."selectionReason", i."selectionOverrideReason", i."policyVersion",
       i."revealedAt", i."usedAt", i."feedbackAcknowledgedAt"
FROM "StudyStreamItem" i
JOIN "StudySession" s ON s."id" = i."sessionId"
JOIN "User" u ON u."id" = s."userId"
LEFT JOIN "Word" w ON w."id" = i."wordId"
WHERE u."email" = :'account'
ORDER BY i."createdAt" DESC, i."id" DESC
LIMIT 100;

-- 已確認的最近 100 items，避免把未完成／被替換的卡算成已學。
WITH recent AS (
  SELECT w."term", i."senseId", i."itemKind", i."selectionReason"
  FROM "StudyStreamItem" i
  JOIN "StudySession" s ON s."id" = i."sessionId"
  JOIN "User" u ON u."id" = s."userId"
  LEFT JOIN "Word" w ON w."id" = i."wordId"
  WHERE u."email" = :'account' AND i."usedAt" IS NOT NULL
    AND i."feedbackAcknowledgedAt" IS NOT NULL
  ORDER BY i."feedbackAcknowledgedAt" DESC, i."id" DESC
  LIMIT 100
)
SELECT "term", "senseId", "itemKind", "selectionReason", count(*) AS completed_items
FROM recent GROUP BY "term", "senseId", "itemKind", "selectionReason"
ORDER BY completed_items DESC, "term";

SELECT w."term", e."kind", e."status", e."policyVersion",
       e."admittedAt", e."eligibleAt", e."expiresAt", e."terminalReason"
FROM "EvidenceObligation" e
JOIN "User" u ON u."id" = e."userId"
LEFT JOIN "Word" w ON w."id" = e."wordId"
WHERE u."email" = :'account'
ORDER BY e."createdAt" DESC, e."id" DESC LIMIT 100;

SELECT w."term", e."selfRating", e."requiresVerification", e."verificationDisposition",
       e."acknowledgedAt", r."nextReviewDate", r."lastReviewedAt", r."repetitions"
FROM "StudyEncounter" e
JOIN "User" u ON u."id" = e."userId"
LEFT JOIN "Word" w ON w."id" = e."wordId"
LEFT JOIN "Review" r ON r."userId" = e."userId" AND r."wordId" = e."wordId"
WHERE u."email" = :'account'
ORDER BY e."acknowledgedAt" DESC, e."id" DESC LIMIT 100;

-- Review 是目前狀態，不能反推某歷史卡發出時的 due 狀態。
ROLLBACK;
