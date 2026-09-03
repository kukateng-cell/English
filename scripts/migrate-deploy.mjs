import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

if (!process.env.MIGRATE_URL) {
  console.error(
    "拒绝执行 migration：必须显式提供 MIGRATE_URL（Session/direct connection）。",
  );
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const audit = spawnSync(
  process.execPath,
  ["scripts/check-migration-checksums.mjs"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (audit.error) throw audit.error;
if (audit.status !== 0) process.exit(audit.status ?? 1);

const preflight = spawnSync(
  process.execPath,
  ["scripts/check-production-migration-safety.mjs"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (preflight.error) throw preflight.error;
if (preflight.status !== 0) process.exit(preflight.status ?? 1);

const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
  shell: process.platform === "win32",
  stdio: "inherit",
  env: {
    ...process.env,
    PGOPTIONS:
      process.env.PGOPTIONS ??
      "-c lock_timeout=10s -c statement_timeout=30min",
  },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const lineageCheck = spawnSync(
  process.execPath,
  ["scripts/check-study-lineage-compatibility.mjs"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if (lineageCheck.error) throw lineageCheck.error;
process.exit(lineageCheck.status ?? 1);
