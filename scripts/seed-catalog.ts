import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { seedCatalog } from "../src/lib/catalog/seed";

dotenv.config({ path: ".env.local" });
dotenv.config();

const environment = process.env.DATABASE_ENVIRONMENT;
if (environment !== "development" && environment !== "test" && environment !== "production") {
  throw new Error("DATABASE_ENVIRONMENT must be development, test or production.");
}
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }) });

async function main() {
  const result = await prisma.$transaction(
    (tx) => seedCatalog(tx, {
      environment: environment as "development" | "test" | "production",
      localBootstrap: environment !== "production" && process.env.LOCAL_CATALOG_BOOTSTRAP === "1",
      actor: "scripts/seed-catalog",
      finalize: process.env.CATALOG_FINALIZE !== "0",
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
