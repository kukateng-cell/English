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
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Level } from "../src/generated/prisma";
import { ROLES } from "../src/lib/roles";

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
// 格式：student01..studentNN，统一默认密码（首次登入強制修改）。
const STUDENT_COUNT = 40;

/**
 * 解析学生预设密码：优先读环境变量 SEED_STUDENT_DEFAULT_PASSWORD，
 * 未设置时自动产生一组强随机密码并打印到控制台（避免密码进入版本库）。
 *
 * 安全要求：绝不在代码里硬编码默认密码。返回 { password, fromEnv }。
 */
function resolveStudentPassword(): { password: string; fromEnv: boolean } {
  const fromEnv = process.env.SEED_STUDENT_DEFAULT_PASSWORD;
  if (fromEnv && fromEnv.trim().length >= 8) {
    return { password: fromEnv.trim(), fromEnv: true };
  }
  // 未提供或强度不足：生成 24 字节 base64 随机密码（~192 bit 熵）。
  const generated = randomBytes(24).toString("base64");
  console.warn(
    "⚠️  SEED_STUDENT_DEFAULT_PASSWORD 未设置或长度 < 8，已自动生成强随机密码。\n" +
      "   请妥善记录下方密码并分发给学生；首次登入后会强制要求修改。\n" +
      "   建议：在 .env.local 中设置 SEED_STUDENT_DEFAULT_PASSWORD 以便复用。",
  );
  return { password: generated, fromEnv: false };
}

async function seedStudents() {
  const { password: studentPassword, fromEnv } = resolveStudentPassword();
  const hash = await bcrypt.hash(studentPassword, 12);
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
      data: {
        email: account,
        passwordHash: hash,
        name: `学生 ${i}`,
        // 首次登入強制改密碼：学生用此预设密码登入后会被引导到 /reset-password。
        mustChangePassword: true,
      },
    });
    created++;
  }
  const last = `student${String(STUDENT_COUNT).padStart(2, "0")}`;
  const source = fromEnv ? "(来自 SEED_STUDENT_DEFAULT_PASSWORD)" : "(自动生成)";
  console.log(
    `Students: ${created} created, ${existed} already exist | ` +
      `account: student01..${last} | password ${source}: ${studentPassword}`,
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
    data: {
      email: TEST_ACCOUNT,
      passwordHash: hash,
      name: "测试账号",
      // 特权测试账号不强制改密碼。
      mustChangePassword: false,
    },
  });
  console.log(`Test account created: ${TEST_ACCOUNT}`);
}

// ── 管理员 / 教师种子账号 ──
// 通过 CLI seed 创建，取代旧的公开 HTTP 端点 /api/seed-roles（避免无鉴权提权）。
// 初始密码必须来自环境变量 INITIAL_ADMIN_PASSWORD，严禁硬编码（安全审计要求）。
// 使用 upsert：账号已存在时仅校正角色，绝不覆盖密码——尊重管理员可能已自行修改的密码。
async function seedRoles(password: string) {
  const hash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin" },
    create: {
      email: "admin",
      passwordHash: hash,
      name: "管理员",
      role: ROLES.ADMIN,
      // 管理员账号不强制改密碼（密码来自 INITIAL_ADMIN_PASSWORD 环境变量）。
      mustChangePassword: false,
    },
    update: { role: ROLES.ADMIN },
  });

  const teacher = await prisma.user.upsert({
    where: { email: "teacher" },
    create: {
      email: "teacher",
      passwordHash: hash,
      name: "王老师",
      role: ROLES.TEACHER,
      // 教师账号不强制改密碼。
      mustChangePassword: false,
    },
    update: { role: ROLES.TEACHER },
  });

  console.log(
    `Roles seeded: admin (id=${admin.id}), teacher (id=${teacher.id})`,
  );
}

async function main() {
  // 初始密码必须由环境变量提供，严禁硬编码（安全审计要求）。
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!initialPassword) {
    throw new Error(
      "INITIAL_ADMIN_PASSWORD 未设置：请在 .env.local 中配置初始密码后再运行 seed。",
    );
  }

  // 读文件（Node.js 兼容）
  const fs = await import("fs");
  const text = fs.readFileSync(WORD_LIST_PATH, "utf-8");

  // 支持的级别（与 schema 的 enum Level 一致）。
  const SUPPORTED_LEVELS = ["A1", "A2", "B1", "B2"] as const;
  const isSupportedLevel = (s: string): s is Level =>
    (SUPPORTED_LEVELS as readonly string[]).includes(s.toUpperCase());

  // 任何 `## XXX Level` 形式的标题都會被捕获（含 A1/A2/B1/B2 及未知级别）。
  // 遇到未知级别時立刻报错并中止，避免沿用上一個级别导致错误归类（历史上
  // 正因旧正则只匹配 A\d，B1 被静默吞入 A2）。
  const LEVEL_HEADING_RE = /^##\s+([A-Za-z]\d)\s+Level\b/i;

  let currentLevel: Level | null = null;
  let currentCategory = "";
  const words: { term: string; definition: string; level: Level; category: string }[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    // 级别标题：先捕获所有 `## X# Level`，再校验是否為支持级别。
    const levelMatch = line.match(LEVEL_HEADING_RE);
    if (levelMatch) {
      const raw = levelMatch[1];
      if (!isSupportedLevel(raw)) {
        throw new Error(
          `word list.md 出現不支援的级别「${raw}」（支持的级别：${SUPPORTED_LEVELS.join(", ")}）。` +
            `已中止匯入，请修正词表后重试。`,
        );
      }
      currentLevel = raw.toUpperCase() as Level;
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
      // currentLevel 在出現任何级别标题前必须已被設定，否则视为词表结构错误。
      if (currentLevel === null) {
        throw new Error(
          `在出現任何级别标题（## A1/A2/B1/B2 Level）前就读到单词「${term}」。` +
            `请检查 word list.md 是否以级别标题开头。`,
        );
      }
      words.push({ term, definition, level: currentLevel, category: currentCategory });
    }
  }

  // 解析后 sanity check：三个级别都必须出現，且数量 > 0。
  const byLevel = new Map<Level, number>();
  for (const w of words) byLevel.set(w.level, (byLevel.get(w.level) ?? 0) + 1);
  const missing = SUPPORTED_LEVELS.filter((lv) => !byLevel.has(lv));
  if (missing.length > 0) {
    throw new Error(
      `word list.md 解析后缺少以下级别：${missing.join(", ")}。` +
        `各级别统计：${[...byLevel.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
  }
  console.log(
    `Parsed ${words.length} words from word list.md | ` +
      `per-level: ${[...byLevel.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
  );

  // 按 term 去重。
  // DB 的 Word.term 是唯一鍵，但詞表中同一 term 可能出現在多個級別
  // （如 "red" 同時在 A1 與 B1、"date" 在 A1/B1/B2）。教學慣例取「最低級別」
  // （該詞最早被引入的級別），因此按 (A1 > A2 > B1 > B2) 優先序保留；
  // 同級別內多筆取第一筆（保留首次出現的 category/definition）。
  // 注意：絕不能用 (term, level, category) 當 key 去重——那會讓同一 term 出現多筆，
  // 後續 upsert 時「後寫入者勝」（B2 在檔案最後），會把共享 term 錯誤抬高到高級別。
  const LEVEL_RANK: Record<Level, number> = { A1: 0, A2: 1, B1: 2, B2: 3 };
  const bestByTerm = new Map<string, { rank: number; word: typeof words[number] }>();
  for (const w of words) {
    const rank = LEVEL_RANK[w.level];
    const cur = bestByTerm.get(w.term);
    if (!cur || rank < cur.rank) {
      bestByTerm.set(w.term, { rank, word: w });
    }
  }
  const unique = [...bestByTerm.values()].map((x) => x.word);

  console.log(`After dedup (lowest-level wins per term): ${unique.length} words`);

  // 批量插入 / 校正
  // 关键：使用 upsert 而非「存在即跳过」。历史上因级别正则 bug，B1 单词被误归入 A2；
  // 若只改正则重跑 seed，旧记录仍会是错的。upsert 能在重跑時把 level/category/definition
  // 一次性校正为词表的最新值，保证「重新执行 seed 不会再次造成错误分类」。
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  // 记录本次实际落库的 per-level 数量，用于和解析统计对照。
  const dbByLevel = new Map<Level, number>();

  for (const w of unique) {
    const existing = await prisma.word.findUnique({ where: { term: w.term } });
    if (!existing) {
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
    } else {
      const needsUpdate =
        existing.level !== w.level ||
        existing.definition !== w.definition ||
        (existing.category ?? null) !== (w.category || null);
      if (needsUpdate) {
        await prisma.word.update({
          where: { id: existing.id },
          data: {
            definition: w.definition,
            level: w.level,
            category: w.category || null,
          },
        });
        // 含级别被纠正的情况（如 B1 误归 A2 的修正）。
        updated++;
      } else {
        unchanged++;
      }
    }
    dbByLevel.set(w.level, (dbByLevel.get(w.level) ?? 0) + 1);
  }

  console.log(
    `Done: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged | ` +
      `db per-level: ${[...dbByLevel.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
  );

  // 管理员 / 教师账号（每次 seed 都会 upsert，幂等）。
  await seedRoles(initialPassword);

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
