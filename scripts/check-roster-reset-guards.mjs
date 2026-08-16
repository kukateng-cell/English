import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const root = process.cwd();
const baseEnv = {
  ...process.env,
  DATABASE_ENVIRONMENT: "development",
  CONFIRM_DATABASE_ENVIRONMENT: "development",
  CONFIRM_LOCAL_RESET_TARGET: "english_dev/public",
  LOCAL_RESET_TOPOLOGY: "local-tcp-loopback-v6",
};

function run(env) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(command, ["run", "db:reset:roster"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

const dryRun = run(baseEnv);
assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
assert.match(dryRun.stdout, /"mode": "dry-run"/u);
assert.match(dryRun.stdout, /"marker": "development"/u);
assert.match(dryRun.stdout, /"migrationCount": 48/u);

const wrongTarget = run({ ...baseEnv, CONFIRM_LOCAL_RESET_TARGET: "wrong/public" });
assert.notEqual(wrongTarget.status, 0);
assert.match(`${wrongTarget.stdout}\n${wrongTarget.stderr}`, /精确|exact/iu);

const wrongEnvironment = run({
  ...baseEnv,
  DATABASE_ENVIRONMENT: "production",
  CONFIRM_DATABASE_ENVIRONMENT: "production",
});
assert.notEqual(wrongEnvironment.status, 0);
assert.match(`${wrongEnvironment.stdout}\n${wrongEnvironment.stderr}`, /development/i);

console.log("Roster reset guard checks passed");
