# 見字會 SeeWord

面向中文學校中學生嘅英語詞彙認讀平台。現行版本採用 Retrieval-first Learning Stream V2：
學生先嘗試回想英文詞義，再揭示答案；主觀 self-rating 同客觀認讀證據分開，只有
Objective Probe 第一次合法答案先由 server 判分並推進 SM-2。

## 目前狀態

- 工作分支：`codex/retrieval-first-learning-stream-v2`
- 本地產品基線：已完成（程式基線 `e43ed66`）
- Global `/study`：continuous stream，無固定完成題數
- V1：保留作 feature-off rollback
- Production deploy、真實學生 pilot、research telemetry／consent、Stage E destructive cleanup：未執行
- 未合併／推送到 `main` 就唔代表 main 或 production 已有 V2

完整現況先讀：

- [V2 Current Product Baseline](plans/artifacts/retrieval-first-v2-current-product-baseline.md)
- [計劃索引](plans/README.md)
- [產品總體計劃](plans/project-plan.md)
- [Retrieval-first Contract](plans/retrieval-first-learning-contract.md)
- [部署與遷移說明](DEPLOY.md)

## 學生流程

```text
Learning Card
→ 先想一想中文意思
→ 約 1 秒後漸進顯示長按提示
→ 原地長按非發音區域 3 秒
→ 翻卡揭示英文、音標位、發音及中文意思
→ 報告「和剛才想的一樣／不一樣」
→ self-rating 只記錄學習過程，不直接改變掌握度

Objective Probe
→ 第一次選擇由 server 判分
→ correct=SM-2 quality 4；wrong=quality 2
→ 選項顏色顯示結果，點卡面／keyboard acknowledgement 繼續
```

測試唔係固定每三個詞一次。Server scheduler 會按到期詞、成熟詞、remediation、
verification debt、delay、mode scope 及候選狀態決定下一個 item；成熟到期詞可以直接出
Objective Probe。

## 已有能力

- A1／A2／B1／B2 詞表、主題單元及順序解鎖
- Retrieval-first Learning Card、Objective Probe、SM-2 及 versioned learning policy
- Continuous global stream、bounded unit mode、安全離開／續接
- Offline outbox、checkpoint、cross-tab／cross-device reconciliation、expired credential recovery
- 學生／教師／管理員角色、首次改密、tokenVersion session 撤銷及最後管理員保護
- 首頁／詞表／統計、7 日柱狀圖、30 日熱力圖、打卡、成就及排行榜
- 繁體／簡體、明／暗 theme、mobile／tablet／desktop responsive layout
- PostgreSQL、Prisma migrations、Upstash production limiter 及 GitHub Actions／Vercel release gate

## 技術棧

Next.js 16、React 19、TypeScript、Tailwind CSS 4、Framer Motion、Auth.js、Prisma 7、
PostgreSQL、Upstash Redis、Node test 及 Playwright。

## 本地啟動

### 1. 安裝及啟動 PostgreSQL

```bash
npm ci
docker compose up -d
cp .env.example .env.local
```

本地 Docker 預設可以令 `DATABASE_URL` 同 `MIGRATE_URL` 都指向：

```text
postgresql://english:english_dev_password@localhost:5432/english
```

請喺 `.env.local` 設定獨立隨機 `NEXTAUTH_SECRET`、
`SECURITY_AUDIT_HASH_SECRET`、`INITIAL_ADMIN_PASSWORD` 及測試帳戶密碼。唔可以提交
`.env.local`、真實密碼、tokens 或連線憑證。

### 2. 建立 schema 及本地資料

```bash
npm run db:deploy
npm run seed
```

Migration／seed 只使用 `MIGRATE_URL`。第一次 seed 前核對
`DATABASE_ENVIRONMENT=development` 同 `CONFIRM_DATABASE_ENVIRONMENT=development`；
唔好用 `prisma db push` 代替 migrations。

### 3. 開啟完整本地 V2

喺 `.env.local` 設定：

```env
STUDY_V2_ASSIGNMENT_MODE="all"
```

`all` 只容許 local development／明確 browser-test runtime，Vercel preview／production
會 fail closed。`off` 強制 V1 rollback；`internal` 只對 allowlist 使用 V2。

```bash
npm run dev
```

開啟 <http://localhost:3000/login>。如使用本地專用測試學生，先按 `.env.example` 設定
`SEED_TEST_STUDENT=1`、`TEST_STUDENT_USERNAME` 及 `TEST_STUDENT_PASSWORD` 再執行 seed。

## 常用驗證

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

按改動範圍再選擇：

```bash
npm run test:db:stream-v2
npm run check:study-credential-v2
npm run test:e2e:study-stream-v2
npm run test:e2e:card-motion
npm run test:migrations
npm run test:migrations:contract
npm run test:migration-checksums
npm run check:production-config
```

局部文案／presentation 修正只需要比例相稱嘅 lint、typecheck、rendered visual review／build。
Gesture、study action、checkpoint、credential、scoring 或 migration 改動先需要相應高成本回歸。

## 安全及外部閘門

- Production 必須有共享 Upstash limiter；缺少或故障時 fail closed。
- 已套用 migration 不得修改；contract migrations 與一般 expand migrations 分開。
- `npm run db:contract` 係 destructive／irreversible cleanup gate，唔會由一般 deploy 自動執行。
- Staging contract migration 嘅個別授權唔等於 production cleanup 授權。
- 未獲明確批准唔執行 production deploy、真實學生 pilot、research collection、倫理／家長／
  學生同意流程，亦唔合併、切換或推送 `main`。
