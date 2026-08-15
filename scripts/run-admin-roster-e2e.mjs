import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "node_modules/.bin/playwright.cmd" : "node_modules/.bin/playwright";
const args = ["test", "--project=admin-roster"];
// Large fixtures intentionally run in isolated fresh-DB invocations.  Keeping
// them out of the serial functional smoke prevents a prior 500-row promotion
// from changing trigger-scan cost for the independent 500-row import budget.
if (process.env.ROSTER_SCALE_FIXTURE !== "1") args.push("--grep-invert", "500|5,000|5,001");
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    ENABLE_TEST_ROUTES: "1",
    STUDY_V2_ASSIGNMENT_MODE: process.env.STUDY_V2_ASSIGNMENT_MODE ?? "all",
    // npm start runs the optimized app with NODE_ENV=production.  Keep this
    // local smoke reproducible without ever committing or printing a secret;
    // a real configured value wins when one is supplied by CI/local setup.
    SECURITY_AUDIT_HMAC_SECRET: process.env.SECURITY_AUDIT_HMAC_SECRET ?? randomBytes(32).toString("hex"),
    SECURITY_AUDIT_HMAC_KEY_ID: process.env.SECURITY_AUDIT_HMAC_KEY_ID ?? "e2e-v1",
  },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
