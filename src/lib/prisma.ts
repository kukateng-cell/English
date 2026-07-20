import { PrismaClient } from "@/generated/prisma";

// Prisma 7 移除了 Rust engine：所有 provider 都需要 driver adapter。
// 本地预览用 SQLite；生产 Postgres 时把这里的 adapter 换成 PrismaPg。
const createPrismaClient = () => {
  // 故意用 require() 动态加载 SQLite adapter，避免生产 Postgres 部署时
  // 把 better-sqlite3 原生模块打进 bundle（Vercel 上没有它，静态 import 会构建失败）。
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaBetterSqlite3 } =
    require("@prisma/adapter-better-sqlite3") as {
      PrismaBetterSqlite3: new (opts: { url: string }) => unknown;
    };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
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
