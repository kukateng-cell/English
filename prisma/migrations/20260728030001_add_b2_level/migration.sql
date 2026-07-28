-- AddLevelEnumB2: 新增 B2 级别，支持 word list.md 中 B2 区块的单词导入。
-- 之前 seed 的级别正则只识别 A\d（A1/A2），导致 B1/B2 被误归入 A2；
-- 本迁移在 enum Level 增加 B2，配合 seed.ts 的正则修正与 upsert 校正，
-- 使 B1/B2 单词能正确归类。
ALTER TYPE "Level" ADD VALUE 'B2';
