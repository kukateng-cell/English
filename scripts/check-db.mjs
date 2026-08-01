// 开发工具：验证 .env.local 中的 DATABASE_URL 能否正常连接（Neon / Postgres）。
//
// 用法：
//   node scripts/check-db.mjs
//
// 输出：
//   - 目标数据库 host / 用户
//   - 连接是否成功
//   - 用户表可读性（账号数量）
//
// 退出码：0 = 正常；1 = 连接失败或未配置。

import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// 与 Next.js 一致：从项目根目录加载 .env.local
loadEnvFile(resolve(import.meta.dirname, "..", ".env.local"));

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("❌ .env.local 中未找到 DATABASE_URL，请先配置");
  process.exit(1);
}

// 隐藏密码，只显示 host 与用户名
const u = new URL(url);
console.log(`🔌 目标数据库: ${u.host}`);
console.log(`👤 用户: ${u.username}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

try {
  await prisma.$queryRaw`SELECT 1 as ok`;
  console.log("✅ 数据库连接正常");
  const count = await prisma.user.count();
  console.log(`✅ 用户表可读，共 ${count} 个账号`);
} catch (e) {
  console.error("❌ 数据库连接失败：", (e.message ?? e).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
