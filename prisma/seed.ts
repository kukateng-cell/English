/**
 * Seed 脚本：解析 word list.md 导入单词到数据库
 * 运行：npx tsx prisma/seed.ts
 *
 * word list.md 格式：
 *   ## A1 Level / A1 级别
 *   ### Category Name (中文名)
 *   - english — 中文释义
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const WORD_LIST_PATH = new URL("../word list.md", import.meta.url).pathname;

// ── 学生账号预生成 ──
// 账号由老师统一发放给学生，不做自助注册。
// 格式：student01..studentNN，统一默认密码（后续可由业务层支持修改）。
const STUDENT_COUNT = 40;
const DEFAULT_PASSWORD = "english123";

async function seedStudents() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  let created = 0;
  let existed = 0;
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const account = `student${String(i).padStart(2, "0")}`; // student01, student02, ...
    const existing = await prisma.user.findUnique({ where: { email: account } });
    if (existing) {
      existed++;
      continue;
    }
    await prisma.user.create({
      data: { email: account, passwordHash: hash, name: `学生 ${i}` },
    });
    created++;
  }
  const last = `student${String(STUDENT_COUNT).padStart(2, "0")}`;
  console.log(
    `Students: ${created} created, ${existed} already exist | account: student01..${last}, password: ${DEFAULT_PASSWORD}`,
  );
}

async function main() {
  // 读文件（Node.js 兼容）
  const fs = await import("fs");
  const text = fs.readFileSync(WORD_LIST_PATH, "utf-8");

  let currentLevel = "A1";
  let currentCategory = "";
  const words: { term: string; definition: string; level: string; category: string }[] = [];

  for (const line of text.split("\n")) {
    // 级别标题
    const levelMatch = line.match(/^##\s+(A\d)\s+Level/i);
    if (levelMatch) {
      currentLevel = levelMatch[1].toUpperCase();
      continue;
    }

    // 分类标题
    const catMatch = line.match(/^###\s+(.+?)(?:\s*\(.+\))?\s*$/);
    if (catMatch) {
      currentCategory = catMatch[1].trim();
      continue;
    }

    // 单词行
    const wordMatch = line.match(/^-\s+(.+?)\s+[—–-]\s+(.+)$/);
    if (wordMatch) {
      const term = wordMatch[1].trim();
      const definition = wordMatch[2].trim();
      words.push({ term, definition, level: currentLevel, category: currentCategory });
    }
  }

  console.log(`Parsed ${words.length} words from word list.md`);

  // 按 term 去重
  const seen = new Set<string>();
  const unique = words.filter((w) => {
    const key = w.term.toLowerCase() + w.level + w.category;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`After dedup: ${unique.length} words`);

  // 批量插入
  let inserted = 0;
  let skipped = 0;
  for (const w of unique) {
    const existing = await prisma.word.findUnique({ where: { term: w.term } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.word.create({
      data: {
        term: w.term,
        definition: w.definition,
        level: w.level as "A1" | "A2" | "B1",
        category: w.category || null,
        synonyms: [],
        antonyms: [],
      },
    });
    inserted++;
  }

  console.log(`Done: ${inserted} inserted, ${skipped} skipped (already exist)`);

  await seedStudents();

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
