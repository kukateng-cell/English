/**
 * Seed 脚本：解析 word list.md 导入单词到数据库
 * 运行：npx tsx prisma/seed.ts
 *
 * word list.md 格式：
 *   ## A1 Level / A1 级别
 *   ### Category Name (中文名)
 *   - english — 中文释义
 */
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Level } from "../src/generated/prisma";

// seed 是独立脚本（tsx 运行），不会自动读环境变量，手动加载 .env.local。
dotenv.config({ path: ".env.local" });

// Seed 用 Session pooler（MIGRATE_URL，5432，支持长事务）；运行时才用 6543 的 DATABASE_URL。
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATE_URL ?? process.env.DATABASE_URL,
  }),
});

const WORD_LIST_PATH = fileURLToPath(
  new URL("../word list.md", import.meta.url),
);

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

// ── 测试 / 管理员种子账号 ──
// 账号名随机生成、难以被猜中，专供内部测试功能使用；未来需要时可升级为管理员。
// 生产环境可通过环境变量 TEST_ACCOUNT_PASSWORD 覆盖密码，避免密码进入版本库。
const TEST_ACCOUNT = "qa-4347e0aa14";
const TEST_ACCOUNT_PASSWORD =
  process.env.TEST_ACCOUNT_PASSWORD ?? "e8yJ4F+bZso&aKxnC3pjzBVp";

async function seedTestAccount() {
  const hash = await bcrypt.hash(TEST_ACCOUNT_PASSWORD, 12);
  const existing = await prisma.user.findUnique({
    where: { email: TEST_ACCOUNT },
  });
  if (existing) {
    console.log(`Test account already exists: ${TEST_ACCOUNT}`);
    return;
  }
  await prisma.user.create({
    data: { email: TEST_ACCOUNT, passwordHash: hash, name: "测试账号" },
  });
  console.log(`Test account created: ${TEST_ACCOUNT}`);
}

async function main() {
  // 读文件（Node.js 兼容）
  const fs = await import("fs");
  const text = fs.readFileSync(WORD_LIST_PATH, "utf-8");

  let currentLevel: Level = "A1";
  let currentCategory = "";
  const words: { term: string; definition: string; level: Level; category: string }[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    // 级别标题
    const levelMatch = line.match(/^##\s+(A\d)\s+Level/i);
    if (levelMatch) {
      currentLevel = levelMatch[1].toUpperCase() as Level;
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
        level: w.level,
        category: w.category || null,
        // Postgres 原生 String[]：用空数组
        synonyms: [],
        antonyms: [],
      },
    });
    inserted++;
  }

  console.log(`Done: ${inserted} inserted, ${skipped} skipped (already exist)`);

  // 学生账号默认不创建；需要时在 .env 设 SEED_STUDENTS=1 重新跑 seed 即可。
  if (process.env.SEED_STUDENTS === "1") {
    await seedStudents();
  }
  await seedTestAccount();

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
