# Vercel 評委示範部署

狀態：進行中（2026-10-31，使用者批准）

## 背景

使用者需要一個公開網址讓評委操作示範產品（學習流、統計、排行榜），並可同時查閱
已公開的 Supabase 資料庫。本部署為**示範（demo）性質**，使用使用者個人 Vercel 帳號
及現有 Supabase 東京示範庫；不是 `DEPLOY.md` 定義的正式 production workflow
（GitHub Actions `deploy-production.yml`），兩者不得混淆。

## 目標

- 以 Vercel 部署 `main` 工作樹，提供 `https://<project>.vercel.app` 供評委瀏覽。
- 評委可以示範帳號登入並操作 V2 學習流。
- 通過專案自身的 production configuration gate（next.config.ts 建置期檢查）。

## 非目標

- 不執行 GitHub Actions production workflow、不設定 `production` environment secrets。
- 不執行 `npm run db:contract` 或任何 schema 變更（東京庫 schema 已就緒）。
- 不做真實學生 pilot、研究數據收集或完整 observation window。
- 不代表正式 production 發佈；正式發佈仍按 `DEPLOY.md` 及整頓計劃授權。

## 依賴

- Vercel 帳號（使用者以 `vercel login` 瀏覽器授權）。
- Upstash 免費 Redis（必需：`next.config.ts` 在 VERCEL_ENV=production 時強制要求
  Upstash 限流；且 runtime 限流 fail-closed，缺 Upstash 連登入都被拒）。
- Supabase 東京庫（已就緒）：runtime 用 transaction pooler 6543。

## 環境變數（Vercel project settings）

必要（gate 強制）：
- `DATABASE_URL`＝Supabase transaction pooler（6543，`?pgbouncer=true`）
- `DATABASE_POOL_MAX=3`
- `NEXTAUTH_SECRET`（隨機 32 bytes base64）
- `NEXTAUTH_URL=https://<project>.vercel.app`（首次部署取得網域後補設並重新部署）
- `UPSTASH_REDIS_REST_URL`／`UPSTASH_REDIS_REST_TOKEN`（使用者 Upstash 帳號）
- `CRON_SECRET`（≥16 字元）
- `SECURITY_AUDIT_HMAC_SECRET`（≥32）＋`SECURITY_AUDIT_HMAC_KEY_ID=v1`
- `SECURITY_AUDIT_HASH_SECRET`
- `TEACHER_RESET_PRECONDITION_KEY_CURRENT(+_ID)`（32-byte base64url）
- `PASSWORD_RESET_PRECONDITION_KEY_CURRENT(+_ID)`（32-byte base64url）

禁止設定：`MIGRATE_URL`、`ENABLE_TEST_ROUTES`、`E2E_STUDY_QUEUE_LOAD_LIMIT`、
`SEED_*`、測試帳號變數。

密鑰來源：除 Upstash（使用者提供）與 Supabase（既有 `.env.supabase`）外，其餘均為
本機隨機產生，保存於 gitignored `.env.vercel`（只作記錄；權威值在 Vercel settings）。

## 分階段 checklist

- [x] 盤點 gate 要求與 runtime fail-closed 行為。
- [x] 建立計劃書。
- [x] 使用者完成 `vercel login` 並提供 Upstash 憑證（寫入 `.env.vercel`）。
- [x] `vercel link` 建立 project（`chao9/english-seeword`）。
- [x] 設定全部環境變數（Production環境，14 項）。
- [x] 首次部署、取得正式網域、補設 `NEXTAUTH_URL` 後重新部署。
- [x] 部署後 smoke test：首頁、登入、`/study`、`/stats`。
- [x] 執行 `npm run check:production-config`（通過）。
- [x] 更新計劃狀態與 `plans/README.md` 索引。

## 風險

- 免費 Vercel 部署無 SLA；僅供評審示範。
- 東京庫為虛構示範資料且已按計劃書公開唯讀；若任何人誤用真實資料須先撤下
  `public_read` 政策並停止公開網址。
- 示範帳號密碼已知（`__test_student__local`）；示範結束後可停權或改密。
- Upstash 免費額度 10k commands/日，足夠評審使用。
- `vercel.json` cron（每日清理過期 StudySession）在 production 部署自動生效；
  缺 `CRON_SECRET` 會被 gate 擋下，已在必要變數中。

## 測試矩陣

| 項目 | 方式 |
|---|---|
| 建置 gate | Vercel build 成功即通過 next.config.ts 檢查 |
| 登入 | 瀏覽器以示範帳號登入 |
| 學習流 | `/study` 出現 Learning Card / Objective Probe |
| 統計 | `/stats` 活動圖表與詞庫進度 |
| 限流 | Upstash 主控台可見 login 鍵計數 |
| 資料庫 | Supabase 唯讀 API 仍可查（與部署獨立） |

## 回退

- `vercel rm <project>` 刪除專案即完全下線；資料庫不受影響。
- 環境變數錯誤可即時在 Vercel settings 修正後 redeploy。

## Definition of Done

正式網域可公開訪問、示範帳號可登入並完成學習操作、統計頁正常渲染、
production config 檢查通過，並在本文件記錄實際結果與網域。

## 執行紀錄

### 部署結果（2026-10-31）

- 正式網域：**<https://english-seeword.vercel.app>**（Vercel project
  `chao9/english-seeword`，projectId `prj_0wp8aRY5l83xzr72RqNFBHat3ChY`）。
- 環境變數：Production 共 14 項（全部 Encrypted），含 `DATABASE_URL`、
  `DATABASE_POOL_MAX=3`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`、Upstash 兩項、
  `CRON_SECRET`、audit HMAC 三項、兩組 reset keyring。未設定 `MIGRATE_URL`
  及任何測試開關。
- `npm run check:production-config`：Production security configuration is valid。
- `vercel.json` 新增 `"regions": ["hnd1"]`（東京）與既有每日 cron。

### 遇到的問題：`/study` 回 503（P2028 事務逾時）

1. 首次部署後首頁與 `/stats` 正常，但 `/study` 回 503。
2. 部署日誌顯示 `[study-stream] bootstrap failed`，Prisma 錯誤 `P2028`
   （interactive transaction timeout）。
3. 根因：Vercel function 預設 region 為 `iad1`（美國東部），與東京 Supabase
   來回延遲約 150–200 ms；學習流的互動事務 round trip 較多，超過 Prisma 預設
   5 秒上限。
4. 處理：`vercel.json` 加 `"regions": ["hnd1"]` 後重新部署 → `/study` 恢復，
   Objective Probe 正常渲染。**這是配置問題，未改動任何應用代碼。**

### 驗證結果

| 項目 | 結果 |
|---|---|
| 登入（`__test_student__local`） | 成功，顯示司徒芷晴 |
| 首頁 | 已學 88%、長期掌握 15%、17 個待複習、1 個新詞 |
| `/stats` | 活動圖（10/27=5）、詞庫 88%、打卡紀錄正常 |
| `/study` | Learning Card／Objective Probe 正常（`uncle` 四選項） |
| 答題寫入 | 成功；Supabase 新增 2026-10-31 15:32 `uncle` REVIEW quality=4 |
| 限流 | 登入經 Upstash 生效（未見 fail-closed 拒絕） |

### 未執行項目

- 未跑 `npm run test:e2e:card-motion` 或完整瀏覽器矩陣（部署為示範用途）。
- 未設定 GitHub Git 整合（CLI 直推），因此不會有 push 自動部署。
- 未執行 `DEPLOY.md` 的正式 production workflow 及 observation window。
- 免費方案：Vercel／Supabase 免費額度與 7 天無活動暫停風險仍在。

### 評委使用方式

- 網址：<https://english-seeword.vercel.app>
- 帳號：`__test_student__local`（密碼見 `.env.supabase`／`.env.vercel`，不寫入本文件）
- 資料庫唯讀查詢：見 `supabase-cloud-database-provisioning.md`「評委唯讀公開」。
