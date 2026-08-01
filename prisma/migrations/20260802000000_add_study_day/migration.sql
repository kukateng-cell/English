-- AddStudyDay: 新增 StudyDay 打卡表。
-- 用途：记录「每日学习打卡」，支撑连续学习天数（streak），
--       并为后续的成就、排行榜等功能预留数据基础。
-- 说明：date 存本地日期字符串（Asia/Shanghai，YYYY-MM-DD），
--       按「用户 + 天」唯一约束实现幂等打卡，避免 DateTime UTC 时区跨日错乱。

-- CreateTable
CREATE TABLE "StudyDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：同一用户同一天最多一条打卡（幂等）
CREATE UNIQUE INDEX "StudyDay_userId_date_key" ON "StudyDay"("userId", "date");

-- CreateIndex：按用户查打卡记录（streak 计算）
CREATE INDEX "StudyDay_userId_idx" ON "StudyDay"("userId");

-- CreateIndex：按日期聚合（后续排行榜 / 统计用）
CREATE INDEX "StudyDay_date_idx" ON "StudyDay"("date");

-- 外键：用户删除时级联删除其打卡记录
ALTER TABLE "StudyDay" ADD CONSTRAINT "StudyDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
