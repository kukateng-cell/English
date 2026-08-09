import test from "node:test";
import assert from "node:assert/strict";
import { databasePoolConfig } from "./database-pool";

test("database pool uses bounded serverless defaults", () => {
  assert.deepEqual(databasePoolConfig("postgresql://db", {}), {
    connectionString: "postgresql://db",
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  assert.equal(
    databasePoolConfig("postgresql://db", { DATABASE_POOL_MAX: "999" }).max,
    10,
  );
});
