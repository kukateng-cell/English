-- AddReviewEvent: 每次评测一条不可变事件，同时作为客户端重试的幂等日志。
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "quality" INTEGER NOT NULL,
    "newlyUnlockedKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewEvent_userId_operationId_key"
    ON "ReviewEvent"("userId", "operationId");
CREATE INDEX "ReviewEvent_userId_createdAt_idx"
    ON "ReviewEvent"("userId", "createdAt");
CREATE INDEX "ReviewEvent_wordId_idx" ON "ReviewEvent"("wordId");

ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_wordId_fkey"
    FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 旧资料没有逐次时间／quality，但 Review.totalReviews 保存了准确次数。
-- 为每次历史复习补一条事件，令总次数统计迁移后不会突然归零；时间只能回退到
-- 该词最后复习时间（之后的新事件会有准确时间）。
INSERT INTO "ReviewEvent" (
    "id", "operationId", "userId", "wordId", "quality", "createdAt"
)
SELECT
    'legacy:' || r."id" || ':' || s.n,
    'legacy:' || r."id" || ':' || s.n,
    r."userId",
    r."wordId",
    0,
    COALESCE(r."lastReviewedAt", CURRENT_TIMESTAMP)
FROM "Review" r
CROSS JOIN LATERAL generate_series(1, r."totalReviews") AS s(n);
