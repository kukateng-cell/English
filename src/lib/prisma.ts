import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, Prisma, type Word } from "@/generated/prisma";
import { databasePoolConfig } from "@/lib/database-pool";

// 重新导出 Prisma 命名空间与模型类型（含 WordUpdateInput / WordSelect / Word 等），
// 供 API 层引用，使 data/select/回传值都能得到原生类型推断。数据库固定为 Postgres。
export { Prisma, type Word };

// Prisma 7 移除了 Rust engine：必须用 driver adapter。
// 本地与生产都连 Postgres（Supabase / Vercel），统一用 PrismaPg 适配器。
function schemaFromConnectionString(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get("schema") ?? undefined;
  } catch {
    return undefined;
  }
}

const createPrismaClient = (pool: Pool, connectionString: string) =>
  new PrismaClient({
    // PrismaPg does not infer the URL's `schema` query parameter. Supplying it
    // explicitly keeps disposable-schema checks isolated while leaving the
    // normal public-schema runtime unchanged.
    adapter: new PrismaPg(pool, { schema: schemaFromConnectionString(connectionString) }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  postgresPool?: Pool;
};

const postgresPool =
  globalForPrisma.postgresPool ??
  new Pool(databasePoolConfig(process.env.DATABASE_URL ?? ""));

// Reuse a single PrismaClient across hot-reloads in development
// to avoid exhausting database connections.
const runtimeConnectionString = process.env.DATABASE_URL ?? "";
export const prisma = globalForPrisma.prisma ?? createPrismaClient(postgresPool, runtimeConnectionString);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.postgresPool = postgresPool;
}
