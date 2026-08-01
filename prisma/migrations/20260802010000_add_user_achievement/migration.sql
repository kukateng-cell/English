-- AddUserAchievement: 新增 UserAchievement 成就解锁记录表。
-- 成就「定义」放在代码常量（src/lib/achievements.ts），本表只记录
-- 「哪个用户解锁了哪个成就」，避免频繁改表。
-- 同一用户同一成就最多一条（幂等解锁）。

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：同一用户同一成就最多一条（幂等）
CREATE UNIQUE INDEX "UserAchievement_userId_key_key" ON "UserAchievement"("userId", "key");

-- CreateIndex：按用户查成就列表
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- 外键：用户删除时级联删除其成就记录
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
