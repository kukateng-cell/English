import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma, type Word } from "@/generated/prisma";

// 重新导出 Prisma 命名空间与模型类型（含 WordUpdateInput / WordSelect / Word 等），
// 供 API 层引用，使 data/select/回传值都能得到原生类型推断。数据库固定为 Postgres。
export { Prisma, type Word };

// Prisma 7 移除了 Rust engine：必须用 driver adapter。
// 本地与生产都连 Postgres（Supabase / Vercel），统一用 PrismaPg 适配器。
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Reuse a single PrismaClient across hot-reloads in development
// to avoid exhausting database connections.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
