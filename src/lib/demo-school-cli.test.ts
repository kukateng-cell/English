import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("demo CLI refuses production, remote targets and future/ambiguous dates before DB access", () => {
  const base = { ...process.env, MIGRATE_URL: "postgresql://fixture:unused@127.0.0.1:1/disposable", DATABASE_ENVIRONMENT: "test", CONFIRM_DATABASE_ENVIRONMENT: "test" };
  const cases = [
    { env: { ...base, DATABASE_ENVIRONMENT: "production", CONFIRM_DATABASE_ENVIRONMENT: "production" }, args: [], message: /環境確認/ },
    { env: { ...base, MIGRATE_URL: "postgresql://fixture:unused@example.invalid:5432/disposable" }, args: [], message: /只容許本機/ },
    { env: base, args: ["--as-of", "2999-01-01T00:00:00Z"], message: /不在未來/ },
    { env: base, args: ["--as-of", "2026-09-01"], message: /必須有時區/ },
  ];
  for (const c of cases) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/demo-school.ts", "update", ...c.args], { env: c.env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, c.message);
  }
});
