# Vercel + Supabase 發佈與資料庫 Runbook

本項目使用 PostgreSQL；部署目標是 Vercel（應用程式）及 Supabase（資料庫）。本文件只說明
需要獲授權的發佈與 migration 操作，正式狀態以 `.github/workflows/deploy-production.yml` 及
遠端平台實際設定為準。

## 目前發佈邊界

- `codex/project-consolidation-and-student-handoff` 是現行及後續唯一開發主線；不需要同舊 `main` 做功能整合。
- 整頓分支的 V2 本地產品基線已完成；V1 退役仍在整頓計劃 P4，未完成前不能把它寫成已移除。
- Production deploy、正式 observation、真實學生 pilot、研究資料收集、原生裝置／完整 screen-reader 驗收及 destructive cleanup 尚未執行。
- Production workflow 必須先驗證、再 migration，最後部署同一個 checkout；migration 失敗不應觸發部署。
- `STUDY_V2_ASSIGNMENT_MODE=all` 只供 local／browser-test runtime；production 必須拒絕 `all`。
- `npm run db:contract` 是破壞性 contract cleanup，不能由一般部署自動執行；staging 授權不等於 production 授權。

不曾核對遠端 Vercel、GitHub ruleset 或 default branch 的設定時，不可由本文件推斷它們已完成。

## 連線分工

應用程式 runtime 和 migration／seed 使用不同連線字串：

| 變數 | 用途 | 建議連接 |
|---|---|---|
| `DATABASE_URL` | `src/lib/prisma.ts` runtime | Transaction pooler，通常是 6543，帶 `?pgbouncer=true` |
| `MIGRATE_URL` | migration、seed、資料檢查 | Direct connection 優先；IPv4-only runner 使用 5432 Session pooler，不加 `pgbouncer=true` |

兩者不能互相回退。Build 及 Vercel runtime 不應持有只供 migration 的 DDL 連線。
本地 Docker 可讓兩者同用：

```text
postgresql://english:english_dev_password@localhost:5432/english
```

## 新環境設定

### 1. 建立 Supabase 資料庫

1. 在 <https://supabase.com> 建立 project，保存資料庫密碼。
2. 從 Settings → Database 取得 Transaction pooler，填入 `DATABASE_URL`。
3. 取得 Direct connection；如執行環境只有 IPv4，改用 5432 Session pooler，填入 `MIGRATE_URL`。
4. 核對 hostname、port、database、user 及 password；不要把完整連線字串寫入 Git。

### 2. 建立本地環境

```powershell
npm ci
docker compose up -d
Copy-Item .env.example .env.local
```

在 `.env.local` 設定 `DATABASE_URL`、`MIGRATE_URL`、獨立的 `NEXTAUTH_SECRET`、
`SECURITY_AUDIT_HASH_SECRET`、`INITIAL_ADMIN_PASSWORD`、`DATABASE_ENVIRONMENT="development"` 及
第一次分類所需的 `CONFIRM_DATABASE_ENVIRONMENT="development"`。需要登入測試時再按 `.env.example` 設定
`SEED_STUDENTS=1`、`SEED_TEST_STUDENT=1` 及測試密碼。`.env.local` 永遠不提交。

### 3. 套用 schema 及正式 catalog

確認 `MIGRATE_URL` 的目標是預期資料庫後執行：

```powershell
npm run db:deploy
npm run seed
```

`npm run seed` 會讀取 `outputs/` 下 A1、A2、B1、B2 四份正式 CSV 及 identity／activation manifest；
`word list.md` 是歷史詞表，不是目前 canonical seed 來源。Seed 會建立大量資料及帳戶，必須按環境 marker 操作，
並安全保存一次性臨時密碼輸出。

不要用 `npx prisma db push`。已套用 migration 不可手工修改；`npm run db:deploy` 會檢查 checksum，
migration 必須能由空資料庫重播。改 schema 後重新執行 `npx prisma generate`。

### 4. 本地 V2 smoke

在本地 `.env.local` 設定 `STUDY_V2_ASSIGNMENT_MODE="all"`，啟動後開啟 <http://localhost:3000/login>，
以測試帳戶確認 Learning Card、Objective Probe、安全離開及續接。`all` 不可進入 Vercel preview／production；
V1 退役前的舊 assignment 設定只屬過渡檢查，不代表產品方向。

## GitHub Actions 發佈流程

正式發佈只使用手動 workflow `Migrate and deploy production`：

1. 確認要發佈的 branch／SHA、備份、maintenance window、migration 內容及部署退回方案。
2. 在 GitHub `production` environment 設定 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`、
   `MIGRATE_URL`、audit HMAC、reset keyring 及其他 production gate secrets。
3. `MIGRATE_URL` 只放 GitHub workflow secret，不放 Vercel runtime。
4. workflow 先跑 dependency audit、migration checksum／fresh replay、catalog baseline、credential／ledger、
   DB stream、browser、workspace 及 production config checks。
5. 所有 verification 成功後，workflow 對同一個 exact checkout 執行 migration，再由 Vercel CLI 部署。
6. migration、deployment、post-deploy smoke 及 observation 結果保留 SHA、時間、操作者和未完成事項。

完整 quality matrix 目前由 `card-motion.yml` 的 `Required quality gate` 匯總；主線 protection、default branch、
required checks 的遠端狀態另按整頓計劃第 8.6 節核對，未核實前不把設定寫成完成。

## Production 環境變數

Vercel runtime 需要 `DATABASE_URL`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`、audit HMAC、password-reset keyring、
Upstash REST credentials、`CRON_SECRET` 及 `DATABASE_POOL_MAX` 等。以 `.env.example` 作變數清單；
每次 rotation 保留 current／previous key pair 直到相應 TTL 結束。

下列值不可進 production runtime：`MIGRATE_URL`、`STUDY_V2_ASSIGNMENT_MODE=all`、`ENABLE_TEST_ROUTES=1`、
`SEED_TEST_STUDENT=1` 及本地測試帳戶，以及未獲批准的 research／diagnostic 開關。

Production limiter 必須使用共享 Upstash；缺少或故障時 fail closed，不能靜默改用 memory fallback。
`NEXTAUTH_URL` 必須是正式 HTTPS 網域；變更後按 Vercel 的 production redeploy 流程重新部署。

## Migration 與 contract cleanup

一般 expand migration 由 `npm run db:deploy` 執行；`prisma/contract-migrations/` 是獨立 contract 歷史。
執行任何 contract cleanup 前，必須另有明確授權、資料庫 snapshot／backup、maintenance window、精確 target、
回歸結果及 post-deploy audit。`npm run db:contract` 不會因普通 deploy 自動執行。

production V1／V2 credential inventory、legacy ledger bridge 及歷史資料 cleanup，待整頓 P4／外部 gate 另行決定。
V1 執行流程退役不等於刪除仍供 V2 provenance 或歷史 reader 使用的欄位。

## 上線後檢查

只在已批准的 production observation window 內執行：登入、角色導向、首頁及 `/study` V2 入口；Learning Card
stationary long-press reveal、self-rating、Objective Probe 首答及 feedback acknowledgement；offline outbox／checkpoint、
expired credential recovery、duplicate replay、登出及停權邊界；catalog ACTIVE-only reader、教師工作區、analytics／reward／
leaderboard 及必要匯出；migration SHA、production config、Upstash limiter、cron、錯誤率及資料庫連線。

發現錯誤先停止 promotion／後續 migration，保留 logs、SHA、request／operation correlation（不得包含密鑰或 PII），
按事前批准的部署退回方案處理；不要用 `db push` 或手工改表補救。

## 常見問題

### 為甚麼需要兩個連線字串？

Vercel runtime 使用 transaction pooler；migration／seed 需要能執行 DDL 的 direct 或 session 連線。
分開可避免 build 或一般 runtime 意外取得 migration 權限。

### 重新匯入詞庫要做甚麼？

目前 seed 來源是 `outputs/` 下受控 CSV 和 manifest。先閱讀詞庫治理及 catalog cutover 計劃，確認 source digest、
identity、revision 及目標資料庫，再用隔離環境驗證；不要直接修改 `word list.md` 當作正式來源。

### 本地資料庫空白或 schema 不一致怎麼辦？

先核對 `MIGRATE_URL`、`DATABASE_ENVIRONMENT`、marker 及 `npx prisma migrate status`。保留資料庫快照，按
`npm run db:deploy` 套用 pending migrations；不要執行 `prisma db push`。若是示範資料，先確認正在使用 demo reset DB，
才按 [`scripts/DEMO-SCHOOL.md`](scripts/DEMO-SCHOOL.md) 的明確 reset 流程。
