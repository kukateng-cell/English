# 見字會 SeeWord

English 是面向中文學校中學生的英語詞彙認讀平台。現行產品採用 Retrieval-first Learning Stream V2：
學生先嘗試回想詞義，再揭示答案；主觀 self-rating 與客觀認讀證據分開，只有 Objective Probe
第一次合法答案由 server 判分並推進 SM-2。

## 現行狀態

- 唯一現行開發主線：`codex/project-consolidation-and-student-handoff`
- 項目整頓現正進行 P1 文件入口；歷史盤點及修訂記錄見[整頓計劃](plans/project-consolidation-and-student-handoff.md)
- Global `/study` 是 continuous stream，沒有固定完成題數
- 產品方向不保留 rollback；V1 退役仍待 P4 實施及驗收
- Production deploy、真實學生 pilot、research telemetry／consent、完整原生裝置驗收及 destructive cleanup 尚未執行

## 學生流程

```text
Learning Card
→ 先嘗試回想中文意思
→ 約一秒後顯示長按提示
→ 非發音區域 stationary long-press 3 秒揭示
→ 報告和剛才所想是否一致
→ server 確認 operational action

Objective Probe
→ 第一次合法選擇由 server 判分
→ correct=quality 4；wrong=quality 2
→ 選項狀態顯示結果，確認 feedback 後繼續
```

## 開始閱讀

新接手者按以下次序閱讀：

1. [現行產品](docs/current-product.md)
2. [本地開發](docs/development.md)
3. [架構導覽](docs/architecture.md)
4. [測試指南](docs/testing.md)
5. [Retrieval-first Contract](plans/retrieval-first-learning-contract.md)
6. [計劃索引](plans/README.md)

根目錄指引各有單一責任：`AGENTS.md` 說明如何安全修改項目，`DEPLOY.md` 是正式發佈與 migration
runbook。文件與程式／測試／schema 不一致時，以可執行證據為準，並在同一批修正文件。

## 主要能力

- A1／A2／B1／B2 sense-level 詞庫、主題、解鎖及學習進度
- Retrieval-first Learning Card、Objective Probe、versioned learning policy 及 SM-2
- Study session、opaque credential、operationId、receipt、CAS、Serializable transaction、
  offline outbox、checkpoint 及 bounded recovery
- 學生／教師／管理員角色、首次改密、session 撤銷、名冊權限及最後管理員保護
- 學生首頁／詞表／統計／打卡／成就／排行榜，教師工作區及管理員工具
- 詞庫治理、sense revision、審核歷史、CSV／XLSX 匯入匯出及正式 catalog baseline
- 繁體／簡體、明／暗 theme、mobile／tablet／desktop responsive layout

## 技術棧

Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Framer Motion、Auth.js、Prisma 7、
PostgreSQL、Upstash Redis、Node test、Playwright、GitHub Actions 及 Vercel。

## 本地快速啟動

```powershell
npm ci
docker compose up -d
Copy-Item .env.example .env.local
npm run db:deploy
npm run seed
npm run dev
```

先按 [本地開發](docs/development.md) 設定 `MIGRATE_URL`、資料庫環境 marker、密鑰及測試帳戶；
不要把 `.env.local` 或任何憑證提交。開啟 <http://localhost:3000/login>。

完整本地 V2 驗證可在 `.env.local` 設定 `STUDY_V2_ASSIGNMENT_MODE="all"`；production 會拒絕此值。
`demo:init --confirm-reset` 會清除指定本地帳戶、學年、名冊及學習資料，只有在確認使用 demo reset DB 時才執行。

## 常用驗證

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

按改動範圍選擇 DB／catalog／V2／browser 測試，詳見[測試指南](docs/testing.md)。
Production migration 只按 `DEPLOY.md` 及 `.github/workflows/deploy-production.yml` 執行，
不得以 `prisma db push` 取代 migrations。
