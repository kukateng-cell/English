import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, Prisma } from "@/generated/prisma";

// 重新导出 Prisma 命名空间（含 WordWhereInput 等查询输入类型），
// 供 API 层在两种 schema（Postgres enum / SQLite string）下统一引用类型。
export { Prisma };

// Prisma 7 移除了 Rust engine：必须用 driver adapter。
// 根据 DATABASE_URL 的协议自动选择适配器：
//   - file:./... → SQLite（本地预览，搭配 schema.sqlite.prisma + dev.db）
//   - postgres:// / postgresql:// → Postgres（Supabase / Vercel 生产）
// 这样本地开发与生产部署都能用同一份 lib/prisma.ts。
const createPrismaClient = () => {
  const url = process.env.DATABASE_URL ?? "";
  const adapter =
    url.startsWith("file:")
      ? new PrismaBetterSqlite3({ url })
      : new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Reuse a single PrismaClient across hot-reloads in development
// to avoid exhausting database connections.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
