// 把本機示範資料庫（english_demo）的精簡資料複製到雲端 Postgres（Supabase）。
//
// 用途：建立新 Supabase 專案後重新匯入資料，或日後遷移區域時重跑。
// 來源資料庫只讀，所有寫入只發生在 TARGET_URL。
//
// 用法：
//   SOURCE_URL="postgresql://postgres:PW@localhost:5432/english_demo" \
//   TARGET_URL="postgresql://postgres.<ref>:PW@aws-0-<region>.pooler.supabase.com:5432/postgres" \
//   node scripts/copy-demo-data-to-cloud.mjs
//
// 前置：
//   1. 已在目標庫執行 `npm run db:deploy`（建立 67 個 migration 的 schema）。
//   2. TARGET_URL 必須是 Session/direct（5432）連線，不能用 transaction pooler。
//
// 說明：Supabase 的 `postgres` 角色不是 superuser，無法 DISABLE TRIGGER。因此流程為
//   暫停全部外鍵約束與使用者觸發器 → 全量 COPY → 依原定義重建 → 核對數量。
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const BIN = process.env.PG_BIN ?? "/Applications/Postgres.app/Contents/Versions/18/bin";
const PSQL = `${BIN}/psql`;
const PG_DUMP = `${BIN}/pg_dump`;

const SOURCE = process.env.SOURCE_URL;
const TARGET = process.env.TARGET_URL;
if (!SOURCE || !TARGET) {
  console.error("必須提供 SOURCE_URL 及 TARGET_URL");
  process.exit(1);
}

// 執行期暫存表：OperationReceipt 無任何 FK 依賴，一律排除。
// StudyStreamItem / StudyEncounter 體積最大：預設完全排除；設定 SSI_SE_SINCE
// （如 2026-10-31，Asia/Shanghai 本地日）時，只匯入該日起的 StudyEncounter
// 及其依賴的 StudyStreamItem（含 sourceItemId 遞迴閉包），令首頁「今日認字」
// 有當日資料；歷史仍留在本機。免費方案 500MB 下，全量 SSI+SE 不可行。
const EXCLUDED = new Set(["OperationReceipt", "_prisma_migrations"]);
const WINDOW_TABLES = ["StudyStreamItem", "StudyEncounter"];
// SSI_SE_SINCE 可為日期字串（YYYY-MM-DD）或 "today"（取 Asia/Shanghai 今日）。
const WINDOW_SINCE_RAW = process.env.SSI_SE_SINCE ?? "";

const KEEP_MIGRATIONS = "_prisma_migrations";

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PGCONNECT_TIMEOUT: "30", PG_KEEPALIVES_IDLE: "30" },
  });
  if (r.status !== 0) throw new Error(`${label}: ${(r.stderr || "").slice(0, 800)}`);
  return r.stdout;
}
const q = (sql, url) => run(PSQL, [url, "-At", "-c", sql], "psql").trim();

const workDir = "/tmp/cloud-dumps";
// 並發鎖：兩個實例共用 workDir 會互刪檔案並留下未還原的 FK／觸發器。
const lockFile = `${workDir}.lock`;
if (fs.existsSync(lockFile)) {
  const pid = Number(fs.readFileSync(lockFile, "utf8").trim());
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* 已退出 */ }
  if (alive) throw new Error(`另一實例（PID ${pid}）仍在執行；共享 ${workDir} 會互相破壞，請先等它完成。`);
}
fs.writeFileSync(lockFile, String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(lockFile); } catch { /* 已清理 */ } });
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

// ── 1. 匯出來源資料 ──
const allTables = q(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  SOURCE,
)
  .split("\n")
  .filter(Boolean);
const wanted = allTables.filter((t) => !EXCLUDED.has(t) && !(WINDOW_SINCE_RAW && WINDOW_TABLES.includes(t)));

const plan = [];
for (const t of wanted) {
  const cnt = Number(q(`SELECT count(*) FROM public."${t}"`, SOURCE));
  if (cnt === 0) continue;
  const file = `${workDir}/${t}.sql`;
  run(
    PG_DUMP,
    ["--data-only", "--no-owner", "--no-privileges", `--table=public."${t}"`, SOURCE, "-f", file],
    `pg_dump ${t}`,
  );
  // pg_dump 會把 search_path 設成空字串，令未限定名稱的觸發器函數找不到 public 表。
  const sql = fs
    .readFileSync(file, "utf8")
    .replace(/^SELECT pg_catalog\.set_config\('search_path', '', false\);\s*$/gm, "");
  fs.writeFileSync(file, sql);
  plan.push([t, cnt, file]);
}
console.log(`來源 ${allTables.length} 表，要載入 ${plan.length} 表（排除 ${[...EXCLUDED].join(", ")}）`);

// ── 2. 清空目標資料（保留 migration 記錄）──
const clearList = allTables.filter((t) => t !== KEEP_MIGRATIONS);
run(
  PSQL,
  ["-v", "ON_ERROR_STOP=1", TARGET, "-c",
    `TRUNCATE ${clearList.map((t) => `public."${t}"`).join(", ")} CASCADE;`],
  "truncate",
);
console.log(`已清空 ${clearList.length} 表`);

// ── 3. 暫停外鍵約束 ──
// 定義一律取自來源（同源 schema）再套用到目標：目標的 FK 可能因前次失敗已被刪除，
// 只從目標取定義會令 _fks.sql 為空、還原 0 條。
const fkAdd = q(
  `SELECT format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s;', n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid))
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype='f' AND n.nspname='public' ORDER BY c.relname, con.conname`,
  SOURCE,
);
const fkDrop = q(
  `SELECT format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I;', n.nspname, c.relname, con.conname)
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype='f' AND n.nspname='public' ORDER BY c.relname, con.conname`,
  TARGET,
);
const fkCount = fkAdd ? fkAdd.split("\n").length : 0;
fs.writeFileSync(`${workDir}/_fks.sql`, fkAdd + "\n");
if (fkCount) run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET, "-c", fkDrop], "drop fks");
console.log(`已暫停 ${fkCount} 個外鍵`);

// ── 4. 暫停使用者觸發器（定義取自來源同源 schema）──
const trgDefs = q(
  `SELECT pg_get_triggerdef(t.oid) || ';'
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY c.relname, t.tgname`,
  SOURCE,
);
const trgLines = trgDefs ? trgDefs.split("\n").filter(Boolean) : [];
fs.writeFileSync(`${workDir}/_triggers.sql`, trgLines.join("\n") + "\n");
const existingTrg = Number(
  q(
    `SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname='public'`,
    TARGET,
  ),
);
console.log(`來源觸發器 ${trgLines.length}，目標現有 ${existingTrg}`);
if (existingTrg > 0) {
  const drops = q(
    `SELECT format('DROP TRIGGER IF EXISTS %I ON %I.%I;', t.tgname, n.nspname, c.relname)
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public'`,
    TARGET,
  );
  run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET, "-c", drops], "drop triggers");
}

// ── 5. 載入 ──
const results = [];
for (const [t, cnt, file] of plan) {
  run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET, "-f", file], `load ${t}`);
  const got = Number(q(`SELECT count(*) FROM public."${t}"`, TARGET));
  results.push([t, cnt, got]);
  console.log(
    `${t.padEnd(34)} src=${String(cnt).padStart(8)}  dst=${String(got).padStart(8)}${cnt === got ? "" : "  <<< MISMATCH"}`,
  );
}

// ── 5b. 視窗表：自 SSI_SE_SINCE 起的 StudyEncounter 及其 StudyStreamItem（含閉包）──
if (WINDOW_SINCE_RAW) {
  const sinceDay = WINDOW_SINCE_RAW === "today"
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())
    : WINDOW_SINCE_RAW;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDay)) throw new Error("SSI_SE_SINCE 必須是 YYYY-MM-DD 或 today");
  const cutoff = `${sinceDay}T00:00:00+08:00`; // 專案日期語義固定 Asia/Shanghai
  const cols = (table) =>
    q(
      `SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position)
       FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}'`,
      SOURCE,
    );

  // 來源：以遞迴 CTE 計算完整閉包（沿 sourceItemId 向上追溯到頂），一次算齊。
  const buildSet = `
    CREATE TEMP TABLE ssi_set AS
    WITH RECURSIVE need AS (
      -- 種子：視窗內 StudyEncounter 引用的 item
      SELECT DISTINCT se."streamItemId" AS id
      FROM "StudyEncounter" se
      WHERE se."createdAt" >= '${cutoff}'
      UNION
      -- 遞迴：需要的 item，其 parent 也需要
      SELECT s."sourceItemId"
      FROM "StudyStreamItem" s
      JOIN need n ON s.id = n.id
      WHERE s."sourceItemId" IS NOT NULL
    )
    SELECT DISTINCT id FROM need WHERE id IS NOT NULL;
    ALTER TABLE ssi_set ADD PRIMARY KEY (id);
    SELECT (SELECT count(*) FROM "StudyEncounter" se
            WHERE se."createdAt" >= '${cutoff}'
              AND NOT EXISTS (SELECT 1 FROM ssi_set k WHERE k.id = se."streamItemId")) AS se_dangling,
           (SELECT count(*) FROM "StudyStreamItem" s
            JOIN ssi_set k ON s.id = k.id
            WHERE s."sourceItemId" IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ssi_set k2 WHERE k2.id = s."sourceItemId")) AS ssi_dangling,
           (SELECT count(*) FROM ssi_set) AS ssi_total;
  `;
  // -At 多語句輸出會混入命令標籤（CREATE TABLE / ALTER TABLE），只取最後一行。
  const lastLine = run(PSQL, ["-v", "ON_ERROR_STOP=1", SOURCE, "-At", "-F", "|", "-c", buildSet], "build ssi_set")
    .trim()
    .split("\n")
    .pop();
  if (!lastLine) throw new Error("ssi_set 建構無輸出");
  const [seDangling, ssiDangling, ssiTotal] = lastLine.split("|").map(Number);
  if (!(seDangling === 0 && ssiDangling === 0)) {
    throw new Error(`視窗閉包不完整：seDangling=${seDangling} ssiDangling=${ssiDangling}`);
  }
  console.log(`視窗（>= ${cutoff}）：StudyStreamItem ${ssiTotal} 列（含 sourceItemId 遞迴閉包）`);

  // 匯出視窗資料（單一 session 重建 temp table 後 \copy）。
  const ssiFile = `${workDir}/window-StudyStreamItem.csv`;
  const seFile = `${workDir}/window-StudyEncounter.csv`;
  const dumpScript = `
    ${buildSet}
    \\copy (SELECT ${cols("StudyStreamItem")} FROM "StudyStreamItem" WHERE id IN (SELECT id FROM ssi_set)) TO '${ssiFile}' WITH (FORMAT csv)
    \\copy (SELECT ${cols("StudyEncounter")} FROM "StudyEncounter" WHERE "createdAt" >= '${cutoff}') TO '${seFile}' WITH (FORMAT csv)
  `;
  const dumpFile = `${workDir}/window-export.sql`;
  fs.writeFileSync(dumpFile, dumpScript);
  run(PSQL, ["-v", "ON_ERROR_STOP=1", SOURCE, "-f", dumpFile], "dump window");

  // 載入目標：先 SSI（父）後 SE（子）。
  for (const [table, file] of [["StudyStreamItem", ssiFile], ["StudyEncounter", seFile]]) {
    run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET,
      "-c", `\\copy "public"."${table}" (${cols(table)}) FROM '${file}' WITH (FORMAT csv)`], `load window ${table}`);
    const got = Number(q(`SELECT count(*) FROM public."${table}"`, TARGET));
    console.log(`視窗載入 ${table.padEnd(20)} dst=${got}`);
  }
}

// ── 6. 還原約束與觸發器 ──
run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET, "-f", `${workDir}/_fks.sql`], "restore fks");
const fkAfter = Number(
  q(
    `SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE con.contype='f' AND n.nspname='public'`,
    TARGET,
  ),
);
console.log(`外鍵已還原 ${fkAfter}/${fkCount}`);
if (fkAfter !== fkCount) throw new Error("外鍵數量不符");

run(PSQL, ["-v", "ON_ERROR_STOP=1", TARGET, "-f", `${workDir}/_triggers.sql`], "restore triggers");
const trgAfter = Number(
  q(
    `SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname='public'`,
    TARGET,
  ),
);
console.log(`觸發器已還原 ${trgAfter}/${trgLines.length}`);
if (trgAfter !== trgLines.length) throw new Error("觸發器數量不符");

const mismatch = results.filter(([, a, b]) => a !== b);
console.log(`\n=== 完成：${results.length} 表，不符 ${mismatch.length} ===`);
if (mismatch.length) {
  console.log(JSON.stringify(mismatch));
  process.exit(1);
}
