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
import { Prisma, PrismaClient, type Level } from "../src/generated/prisma";
import { ROLES } from "../src/lib/roles";
import { passwordPolicyError } from "../src/lib/password-policy";

// seed 是独立脚本（tsx 运行），不会自动读环境变量，手动加载 .env.local。
dotenv.config({ path: ".env.local" });

// Seed 会写入大量资料，必须显式使用 Session/direct connection；绝不回退 runtime URL。
if (!process.env.MIGRATE_URL) {
  throw new Error("执行 seed 必须显式设置 MIGRATE_URL。");
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATE_URL,
  }),
});

const WORD_LIST_PATH = fileURLToPath(
  new URL("../word list.md", import.meta.url),
);

// ── 学生账号预生成 ──
// 账号由老师统一发放给学生，不做自助注册。
// 格式：student01..studentNN，每个账号独立临时密码（首次登入强制修改）。
const STUDENT_COUNT = 40;
type DatabaseEnvironment = "development" | "test" | "production";

async function requireDatabaseEnvironment(): Promise<DatabaseEnvironment> {
  const declared = process.env.DATABASE_ENVIRONMENT;
  if (
    declared !== "development" &&
    declared !== "test" &&
    declared !== "production"
  ) {
    throw new Error(
      "执行 seed 必须把 DATABASE_ENVIRONMENT 显式设为 development、test 或 production。",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const row = await tx.databaseMetadata.findUnique({
        where: { key: "environment" },
      });
      const persisted = row?.value ?? "unclassified";
      if (persisted === "unclassified") {
        if (process.env.CONFIRM_DATABASE_ENVIRONMENT !== declared) {
          throw new Error(
            `数据库尚未分类。请确认目标后同时设置 CONFIRM_DATABASE_ENVIRONMENT=${declared}。`,
          );
        }
        const claimed = await tx.databaseMetadata.updateMany({
          where: { key: "environment", value: "unclassified" },
          data: { value: declared },
        });
        if (claimed.count === 1) return declared;
        const winner = await tx.databaseMetadata.findUnique({
          where: { key: "environment" },
        });
        if (winner?.value === declared) return declared;
        throw new Error(
          `数据库已被另一进程标记为 ${winner?.value ?? "unknown"}；已拒绝 seed。`,
        );
      }
      if (persisted !== declared) {
        throw new Error(
          `数据库环境标记为 ${persisted}，但 DATABASE_ENVIRONMENT=${declared}；已拒绝 seed。`,
        );
      }
      return declared;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function seedStudents() {
  let created = 0;
  let rotated = 0;
  let existed = 0;
  console.log("One-time temporary student credentials (store securely now):");
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const account = `student${String(i).padStart(2, "0")}`; // student01, student02, ...
    const credentialMarkerKey = `studentTemporaryCredential:${account}`;
    const existing = await prisma.user.findUnique({ where: { email: account } });
    const credentialMarker = await prisma.databaseMetadata.findUnique({
      where: { key: credentialMarkerKey },
    });
    if (
      existing &&
      (existing.role !== ROLES.STUDENT ||
        !existing.mustChangePassword ||
        credentialMarker !== null)
    ) {
      if (
        existing.role === ROLES.STUDENT &&
        !existing.mustChangePassword &&
        credentialMarker === null
      ) {
        await prisma.databaseMetadata.create({
          data: { key: credentialMarkerKey, value: "claimed-or-managed" },
        });
      }
      existed++;
      continue;
    }
    const temporaryPassword = randomBytes(18).toString("base64url");
    const policyError = passwordPolicyError(temporaryPassword);
    if (policyError) throw new Error(policyError);
    const hash = await bcrypt.hash(temporaryPassword, 12);
    if (existing) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: {
            id: existing.id,
            role: ROLES.STUDENT,
            mustChangePassword: true,
            tokenVersion: existing.tokenVersion,
          },
          data: { passwordHash: hash, tokenVersion: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new Error(`${account} 已被并发修改，请重新执行 seed。`);
        }
        await tx.databaseMetadata.upsert({
          where: { key: credentialMarkerKey },
          create: { key: credentialMarkerKey, value: "issued-v1" },
          update: { value: "reissued-after-account-recreation-v1" },
        });
      });
      rotated++;
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            email: account,
            passwordHash: hash,
            name: `学生 ${i}`,
            mustChangePassword: true,
          },
        });
        await tx.databaseMetadata.upsert({
          where: { key: credentialMarkerKey },
          create: { key: credentialMarkerKey, value: "issued-v1" },
          update: { value: "reissued-after-account-recreation-v1" },
        });
      });
      created++;
    }
    // Emit immediately after this account commits. A later failure cannot
    // leave already-created accounts with passwords that were never shown.
    console.log(`${account}\t${temporaryPassword}`);
  }
  const last = `student${String(STUDENT_COUNT).padStart(2, "0")}`;
  console.log(
    `Students: ${created} created, ${rotated} unclaimed rotated, ${existed} unchanged | ` +
      `account: student01..${last}`,
  );
}

// ── 本地测试学生 ──
// 与批量 student01..40 的「首次登入预设密码」分开：测试学生视为已经完成改密，
// mustChangePassword=false，可直接进入学习页。必须显式 opt-in，生产默认不创建。
async function seedTestStudent(
  username: string,
  password: string,
  databaseEnvironment: DatabaseEnvironment,
) {
  if (databaseEnvironment === "production") {
    throw new Error("生产环境禁止建立本地测试学生账号。");
  }
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(policyError);
  const hash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({
    where: { email: username },
  });
  if (existing) {
    throw new Error(
      `测试学生账号「${username}」已经存在；seed 不会覆盖现有账号或改变其角色。` +
        "请使用新的保留测试账号，或先由管理员明确删除该账号。",
    );
  }
  await prisma.user.create({
    data: {
      email: username,
      passwordHash: hash,
      name: "本地测试学生",
      role: ROLES.STUDENT,
      // 这组独立测试凭证视为已经完成首次改密，可直接进入学习页。
      mustChangePassword: false,
    },
  });
  console.log(`Test student ready: ${username} (created)`);
}

// ── 管理员 / 教师种子账号 ──
// 通过 CLI seed 创建，取代旧的公开 HTTP 端点 /api/seed-roles（避免无鉴权提权）。
// 初始密码必须来自环境变量 INITIAL_ADMIN_PASSWORD，严禁硬编码（安全审计要求）。
// 账号已存在时仅校正角色，绝不覆盖密码；角色变化会撤销旧 JWT。
async function seedRoles(password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(`INITIAL_ADMIN_PASSWORD：${policyError}`);
  const hash = await bcrypt.hash(password, 12);

  const ensureRole = async (
    email: string,
    name: string,
    role: typeof ROLES.ADMIN | typeof ROLES.TEACHER,
  ) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      return prisma.user.create({
        data: {
          email,
          passwordHash: hash,
          name,
          role,
          mustChangePassword: false,
        },
      });
    }
    if (existing.role === role) return existing;
    if (existing.role === ROLES.ADMIN && role !== ROLES.ADMIN) {
      console.warn(
        `保留现有管理员账号 ${email}，不会因 seed 的教师角色配置将其降级。`,
      );
      return existing;
    }
    return prisma.user.update({
      where: { id: existing.id },
      data: { role, tokenVersion: { increment: 1 } },
    });
  };

  const admin = await ensureRole("admin", "管理员", ROLES.ADMIN);
  const teacher = await ensureRole("teacher", "王老师", ROLES.TEACHER);

  console.log(
    `Roles seeded: admin (id=${admin.id}), teacher (id=${teacher.id})`,
  );
}

async function main() {
  const databaseEnvironment = await requireDatabaseEnvironment();
  // 初始密码必须由环境变量提供，严禁硬编码（安全审计要求）。
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const initialPasswordError = passwordPolicyError(initialPassword ?? "");
  if (!initialPassword || initialPasswordError) {
    throw new Error(`INITIAL_ADMIN_PASSWORD：${initialPasswordError}`);
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
  // 推荐新变量；保留旧 SEED_TEST_ACCOUNT / TEST_ACCOUNT_PASSWORD 一个发布周期，
  // 让已有本地环境升级后不会突然失效。
  if (
    process.env.SEED_TEST_STUDENT === "1" ||
    process.env.SEED_TEST_ACCOUNT === "1"
  ) {
    const testUsername = (
      process.env.TEST_STUDENT_USERNAME ?? "__test_student__local"
    ).trim();
    const webkitTestUsername = (
      process.env.TEST_STUDENT_WEBKIT_USERNAME ??
      `${testUsername.slice(0, 56)}_webkit`
    ).trim();
    const testPassword =
      process.env.TEST_STUDENT_PASSWORD ??
      process.env.TEST_ACCOUNT_PASSWORD ??
      "";
    for (const [name, username] of [
      ["TEST_STUDENT_USERNAME", testUsername],
      ["TEST_STUDENT_WEBKIT_USERNAME", webkitTestUsername],
    ] as const) {
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
        throw new Error(
          `${name} 必须为 3–64 位，只可包含字母、数字、点、下划线或连字符。`,
        );
      }
      if (!username.startsWith("__test_student__")) {
        throw new Error(
          `${name} 必须使用保留前缀 __test_student__，避免误用现有账号。`,
        );
      }
    }
    const testPasswordError = passwordPolicyError(testPassword);
    if (testPasswordError) {
      throw new Error(`TEST_STUDENT_PASSWORD：${testPasswordError}`);
    }
    await seedTestStudent(testUsername, testPassword, databaseEnvironment);
    if (webkitTestUsername !== testUsername) {
      await seedTestStudent(
        webkitTestUsername,
        testPassword,
        databaseEnvironment,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
