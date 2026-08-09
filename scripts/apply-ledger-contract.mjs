import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

if (process.env.CONFIRM_LEDGER_BRIDGE_CONTRACT !== "REMOVE_LEGACY_BRIDGE") {
  throw new Error(
    "Ledger contract requires CONFIRM_LEDGER_BRIDGE_CONTRACT=REMOVE_LEGACY_BRIDGE",
  );
}

const runScript = (script) => {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

runScript("scripts/check-migration-checksums.mjs");
runScript("scripts/check-ledger-contract-window.mjs");

const migrationPath = await mkdtemp(
  join(process.cwd(), ".contract-migrations-"),
);
try {
  for (const root of ["prisma/migrations", "prisma/contract-migrations"]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      await symlink(
        join(process.cwd(), root, entry.name),
        join(migrationPath, entry.name),
        "dir",
      );
    }
  }
  const configPath = join(migrationPath, "prisma.contract.config.ts");
  await writeFile(
    configPath,
    `import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(join(process.cwd(), "prisma", "schema.prisma"))},
  migrations: { path: ${JSON.stringify(migrationPath)} },
  datasource: { url: process.env.MIGRATE_URL ?? "postgresql://invalid" },
});
`,
  );
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    ["prisma", "migrate", "deploy", "--config", configPath],
    {
    stdio: "inherit",
    env: {
      ...process.env,
      PGOPTIONS:
        process.env.PGOPTIONS ??
        "-c lock_timeout=10s -c statement_timeout=30min",
    },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(migrationPath, { recursive: true, force: true });
}
