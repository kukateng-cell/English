# English 本地開發

## 需要的工具

- Node.js 22（CI 使用的版本）。
- npm、Docker Desktop 及 Docker Compose。
- Git；瀏覽器回歸另需要 Playwright browsers。

## 第一次建立

在 repository 根目錄執行：

```powershell
npm ci
docker compose up -d
Copy-Item .env.example .env.local
```

編輯 `.env.local`，至少設定獨立的 `NEXTAUTH_SECRET`、`SECURITY_AUDIT_HASH_SECRET`、
`INITIAL_ADMIN_PASSWORD`。`DATABASE_URL` 是 runtime 連線；migration 及 seed 必須另設 `MIGRATE_URL`。
本地 Docker 可讓兩者指向 `postgresql://english:english_dev_password@localhost:5432/english`。
不要把 `.env.local`、密碼、tokens 或真實連線字串提交到 Git。

```powershell
$env:DATABASE_ENVIRONMENT = "development"
$env:CONFIRM_DATABASE_ENVIRONMENT = "development"
npm run db:deploy
npm run seed
npm run dev
```

開啟 <http://localhost:3000/login>。`/study` 直接使用 V2，不需要 assignment 開關；舊 V1
writer 已由 authenticated 410 retirement barrier 取代，P4 完成前保留拒絕回應供舊 client 明確失效，
不得以舊 endpoint 重開學習流程。

## 資料庫及 seed 安全

`npm run db:deploy` 和 `npm run seed` 會使用 `MIGRATE_URL`，並要求資料庫環境 marker。
第一次分類要同時確認 `DATABASE_ENVIRONMENT` 和 `CONFIRM_DATABASE_ENVIRONMENT`；先核對實際目標。
不要使用 `npx prisma db push`。

`npm run demo:init -- --confirm-reset` 會清除本地帳戶、學年、名冊及相關學習資料，只保留 catalog。
平日開發使用 development DB；DB／migration／browser checks 使用 disposable test DB；只有重建虛構學校才使用
demo reset DB。遇到普通程式問題，不要直接 reset 正在使用的資料庫。

虛構學校流程及限制見 [`scripts/DEMO-SCHOOL.md`](../scripts/DEMO-SCHOOL.md)：

```powershell
npm run demo:init -- --seed school-2026 --days 90 --dry-run
npm run demo:update
npm run demo:check
```

`dev:demo` 會先補資料再啟動，屬明確選用的本地工具，不是一般 `npm run dev` 的隱式步驟。

## 常用命令

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run check:markdown-links
npm run check:plan-index
```

改 schema 後先重新生成 Prisma Client；改 migration 前閱讀 `DEPLOY.md` 及相關計劃。
涉及 production、contract migration、seed 大量資料或 reset 時，先確認目標及授權。

在這台 Windows 電腦執行 Playwright CLI，使用 AGENTS 所述的 Git Bash wrapper 路線，避免誤用沒有 WSL distro
的 `bash.exe`；其他電腦可按 Playwright 官方安裝方式執行。測試輸出預設放 ignored 的 `test-results/`。
