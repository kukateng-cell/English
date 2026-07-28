-- AlterTable
-- 首次登入強制改密碼：seed 的學生帳號預設 true，使用者重設密碼後更新為 false。
-- 由於 ADD COLUMN ... DEFAULT true 會把所有已存在的使用者一併標記為「需要改密碼」，
-- 這裡隨後把 admin / teacher / 測試帳號改回 false，避免特權帳號被鎖在重設頁。
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;

-- 既有特權帳號（管理員 / 教師 / 測試帳號）不應被強制改密碼。
UPDATE "User" SET "mustChangePassword" = false
  WHERE email IN ('admin', 'teacher', 'qa-4347e0aa14');
