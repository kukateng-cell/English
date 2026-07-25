-- AlterTable
-- 角色变更令牌版本号：管理员修改用户角色时 +1，
-- jwt 回调据此在下次请求时刷新缓存的角色（实时生效机制）。
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
