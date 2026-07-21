import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Next.js 本地用 .env.local；Prisma CLI（db push / migrate / seed）也要读到它。
// Vercel 上没有 .env.local（环境变量从平台注入），dotenv 找不到文件会静默忽略，无影响。
dotenv.config({ path: ".env.local" });

export default defineConfig({
  // Location of the Prisma schema file
  schema: path.join("prisma", "schema.prisma"),

  // Where generated migrations live
  migrations: {
    path: path.join("prisma", "migrations"),
  },

  // The datasource connection string is provided here (not in schema.prisma),
  // read from the environment. Prisma 7 requires this.
  // db push / migrate / seed 必须用 Session pooler（MIGRATE_URL，5432端口）——
  // Transaction pooler（DATABASE_URL，6543）是 PgBouncer 事务模式，不支持 DDL，会卡死。
  // 运行时（src/lib/prisma.ts）才用 6543 的 DATABASE_URL。
  datasource: {
    url: process.env.MIGRATE_URL ?? process.env.DATABASE_URL,
  },
});
