# AGENTS.md

## 項目概覽

這是一個面向中學生的英語詞彙認讀平台。現行核心係 Retrieval-first Learning Stream V2：
學生先嘗試回想詞義，以 3 秒 stationary long-press 揭示 Learning Card 答案，再報告同剛才
所想是否一致；只有 Objective Probe 第一次合法答案先由 server 判分並按 versioned policy
推進 SM-2。Global stream 無固定完成題數，每個已確認 action 後都可以安全離開。

技術棧為 Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、
Auth.js、Prisma 7、PostgreSQL，以及 Framer Motion。部署目標是 Vercel。

`plans/project-plan.md` 記錄產品計劃和研究背景，`plans/` 亦集中保存各項功能及
重構實施計劃，但計劃書不是現況的唯一真相。實作行為以程式、測試及
`prisma/schema.prisma` 為準；生產部署流程以 `DEPLOY.md` 和 GitHub Actions
workflow 為準。

## 目前產品基線（2026-08-15）

- 工作分支係 `codex/retrieval-first-learning-stream-v2`；local product code baseline 係
  `e43ed66`。未合併／推送到 `main` 就唔可以假定 main 或 production 已有 V2。
- 開始任何學生流程、UI、排程、統計、可靠性或設計工作前，先完整閱讀
  `plans/artifacts/retrieval-first-v2-current-product-baseline.md`；規範性語義再以
  `plans/retrieval-first-learning-contract.md` 為準。
- EMM Style 02 係設計起點；Program I-011–I-035 係使用者其後批准嘅 final overrides。
  唔可以按舊 prototype 恢復 tap-to-reveal、固定 `1/13`、每三詞一測、完成頁、
  「我會／還不會」直接計 mastery，或者 Objective Probe 原地重答。
- Learning Card 思考提示持續保留；約 1 秒後長按提示漸進出現，只有非發音區域 stationary
  long-press 3 秒揭示。放手／移動／cancel 要重置，揭示後 self-rating 唔直接更新 Review、
  mastery、排行榜或單元解鎖。
- Objective Probe 由 server snapshot／scoring；`retrieval-v1` correct=4、wrong=2，quality 5
  暫不使用。答題後用選項狀態及半透明 continuation affordance，保留 keyboard／a11y action。
- 本地可明確用 `STUDY_V2_ASSIGNMENT_MODE=all` 驗證所有帳戶；production 拒絕 `all`。
  `off` 保留 V1 rollback，`internal` 只供 allowlist。
- Local product baseline 已完成。Production deploy／observation、真實學生 pilot、完整原生
  mobile／screen-reader matrix、research telemetry／consent 同 Stage E destructive cleanup
  全部 deferred；未有新授權唔可以自行執行或勾選。

## 目錄導覽

- `src/app/`：頁面、layouts 和 Route Handlers。
- `src/components/`：共用 UI；`WordCard.tsx` 提供 motion primitive，
  `study-stream/StudyStreamV2.tsx` 負責現行 Learning Card／Objective Probe 體驗。
- `src/lib/`：認證、SM-2、`learning-policy/`、`study-stream/`、學習 session、限流、
  單元進度、統計及純函數測試。
- `plans/`：產品總體計劃、功能／重構實施計劃、checklist 及計劃書索引。
- `prisma/schema.prisma`：目前的 PostgreSQL 資料模型。
- `prisma/migrations/`：一般 expand migrations。
- `prisma/contract-migrations/`：需要明確確認、獨立執行的 contract migrations。
- `prisma/seed.ts`：解析 `word list.md`，建立詞庫及可選測試／預設帳戶。
- `tests/e2e/`：Playwright 字卡和完整學習流程回歸測試。
- `scripts/`：資料庫、遷移、production config 及 ledger 驗證工具。

## 計劃書工作流程

- 新功能、資料模型改動、跨頁面 UI 重構、認證／學習流程改動及 production 發佈
  改動，在寫代碼前必須先建立或更新 `plans/<feature-name>.md`。
- 開始工作前先閱讀 `plans/README.md`、
  `plans/artifacts/retrieval-first-v2-current-product-baseline.md`、`plans/project-plan.md` 及與任務
  直接相關的實施計劃。新計劃、改名、完成或取代計劃時，要同步更新 `plans/README.md` 索引。
- 計劃書要列明背景、目標、非目標、依賴、分階段 checklist、風險、測試矩陣、
  發佈／rollback 及 Definition of Done；檔名使用小寫 kebab-case。
- 獲准開始實作後把計劃狀態改為「進行中」。只有對應工作完成且已通過相應驗證，
  才可把 checklist 由 `[ ]` 改為 `[x]`；不要以「已寫代碼」當成「已驗證」。
- 實作途中如改變 scope、API／資料 contract、migration 策略或驗收方式，先更新
  計劃書及決策紀錄，再繼續實作。
- 完成時在計劃書記錄實際執行的測試、未執行項目、已知限制及後續工作，並把狀態
  改為「已完成」。已完成計劃保留作歷史記錄，不要刪除。
- 小型、局部、低風險修正不必另開計劃；如已有相關計劃，仍應更新對應 checklist。
- 計劃書與程式、測試或 schema 不一致時，以可執行證據為準，並在同一改動內修正
  過時的計劃內容。

## 常用指令

```bash
npm ci
npm run dev
npm test
npm run lint
npx tsc --noEmit
npm run build
```

涉及資料庫或瀏覽器流程時，再按改動範圍執行：

```bash
npm run db:deploy
npm run seed
npm run test:db
npm run test:migrations
npm run test:migrations:contract
npm run test:migration-checksums
npm run test:e2e:card-motion
```

`test:e2e:card-motion` 會先建立 production build，並需要可用的 PostgreSQL、測試
帳戶環境變數及已安裝的 Playwright browsers，成本比單元測試高。

## 環境與資料庫規則

- 由 `.env.example` 建立本地 `.env.local`；不得提交 `.env.local`、密碼、tokens
  或真實連線字串。
- `DATABASE_URL` 只供應用 runtime 使用。migration 和 seed 必須明確使用
  `MIGRATE_URL`，不可退回 runtime URL。
- 本地 Docker PostgreSQL 可讓兩個 URL 指向同一個 `localhost:5432` 資料庫。
- 不要用 `prisma db push` 取代 migrations；schema 改動必須新增 migration。
- 不要任意修改已套用 migration。checksum、expand／contract 和正式發布規則見
  `DEPLOY.md` 及相關 `scripts/check-*.mjs`。
- `npm run db:contract` 是具破壞風險的獨立發布步驟；沒有使用者明確授權和所需
  confirmation 時不得執行。
- Seed 會寫入大量資料，並以 `DATABASE_ENVIRONMENT` 和
  `CONFIRM_DATABASE_ENVIRONMENT` 防止寫錯環境；執行前必須核對目標資料庫。
- 沙箱內連不到 `localhost:5432` 不代表 PostgreSQL 未運行。遇到
  `Operation not permitted`、`no response` 或一般 localhost 連線錯誤時，先以獲准的
  escalated 權限重試，再判定資料庫不可用。
- Prisma URL 可以包含 `?schema=public`，但手動執行 `psql` 時要移除 query string，
  或分別傳入 host、database 和 user。
- 測試若出現 missing column 或 schema mismatch，先執行
  `npx prisma migrate status`，並在確認目標後套用 pending migrations。

## 實作規則

- 保持 TypeScript strict-safe；不要用 `any` 避開 Prisma、API payload 或 session
  型別檢查。
- Server Components、Route Handlers 和 client components 要維持清晰邊界；只在需要
  browser API、state 或事件處理時使用 `"use client"`。
- 受保護 API 使用現有 `src/lib/session.ts` 授權 helpers；不要只依賴 UI、layout 或
  proxy 守衛。
- 認證和角色變更必須保留 `tokenVersion` session 撤銷、首次改密及最後一名管理員
  保護。不要在 log 或 API response 洩露憑證和可識別安全資料。
- 學習提交必須保留 server-issued study session、nonce、`operationId` 冪等性、
  Serializable transaction 和 retry 行為。不要把 SM-2 更新移到只由客戶端決定。
- V2 action 必須保留 opaque `streamItemId`、typed action、credential digest lineage、global
  receipt、Review revision CAS 及 server-owned objective scoring；唔接受 v1/v2 mixed payload。
- Self-rating 只係 operational encounter；只有合資格 Objective Probe first response 先可以產生
  provenance-complete scored ReviewEvent。唔可以用 swipe／reveal／research-only event 推進 mastery。
- 限流在 production 必須使用共享 Upstash 儲存；不要靜默降級 production 安全設定。
- 日期／打卡語義採用 `Asia/Shanghai` 本地日曆日；避免直接以 UTC 日期代替。
- 修改滑動或 release motion 時，要同時檢查 mouse、emulated touch、synthetic pointer
  和完整登入學習流程。
- UI 現時支援簡繁轉換和明暗主題。新增文案及樣式時，兩種 locale 和 theme 都要可用。

## 測試期望

- 純邏輯改動：新增或更新相鄰的 `src/lib/*.test.ts`，至少執行 `npm test`。
- TypeScript、component、Route Handler 改動：執行 lint、typecheck 和相關測試。
- 純文案／局部 presentation 修正只做針對性 lint、typecheck、rendered visual review／build（按風險
  選擇）；唔需要為無關範圍重跑 DB／migration／完整學習 suite。Gesture、study action、
  checkpoint、credential 或 scoring 改動先需要相應高成本 regression。
- Prisma schema 或 migration 改動：執行 migration checksum、fresh replay、contract
  regression（如適用），並驗證 Prisma Client 可重新生成。
- 字卡手勢、study API、checkpoint 或 study session 改動：執行相關單元測試和
  `npm run test:e2e:card-motion`。
- 生產設定或部署改動：執行 `npm run check:production-config`，並核對
  `.github/workflows/deploy-production.yml`。

## 生成檔及改動範圍

- 不要手動編輯 `src/generated/`、`.next/`、`next-env.d.ts`、`*.tsbuildinfo` 或測試輸出。
- 保留工作樹內與當前任務無關的使用者改動。
- 避免為小型修正順帶重寫整個 `plans/project-plan.md`、`README.md` 或 migration
  歷史；只更新與任務直接相關的計劃 checklist 及決策。
- 完成後列出實際執行的驗證；若高成本或需外部服務的測試未執行，要明確說明。
