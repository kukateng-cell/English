import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Location of the Prisma schema file
  schema: path.join("prisma", "schema.prisma"),

  // Where generated migrations live
  migrations: {
    path: path.join("prisma", "migrations"),
  },

  // The datasource connection string is provided here (not in schema.prisma),
  // read from the environment. Prisma 7 requires this.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
