# Supabase 雲端資料庫建立及示範資料上載

狀態：進行中（2026-10-31，使用者批准）

## 背景

現時所有資料只存在本機 Postgres.app（860 MB），未有任何雲端資料庫。使用者需要把
資料放到 Supabase，以便在雲端瀏覽及日後配合 Vercel 部署。

Supabase 免費方案資料庫上限 500 MB，完整 `english_demo` 的 860 MB 無法容納。
經使用者確認，採用「精簡示範資料」方案：保留名冊、班級、詞庫、答題事件及統計，
移除純屬模擬產物的大型暫存表。

## 目標

- 在 Supabase（`eu-west-1`，專案 ref `assiaxezhijeqzeeylsk`）建立與現行 migration
  一致的 schema（67 個 migration）。
- 上載精簡後的示範資料，總量控制於免費方案 500 MB 以內。
- 匯入後可正常登入及瀏覽學生／教師／管理員介面。

## 非目標

- 不部署 Vercel、不開放公開網域。
- 不執行 `npm run db:contract` 或任何破坏性 contract cleanup。
- 不修改 production 學習規則、不建立研究數據。
- 不改動本機 `english_demo` 原始資料（只在複製出的資料庫上精簡）。

## 依賴及限制

- `MIGRATE_URL` 的 Direct connection（`db.<ref>.supabase.co:5432`）在本機只有 IPv6
  而無法解析，改用 **Session pooler**（`aws-0-eu-west-1.pooler.supabase.com:5432`）。
- 本機 PostgreSQL 18、Supabase PostgreSQL 17.11；因此不直接還原本機 schema dump，
  改由 `npm run db:deploy` 建立 schema，只傳輸資料。
- 連線字串保存於已被 `.gitignore` 忽略的 `.env.supabase`，不進入版本控制或對話紀錄。

## 精簡範圍

| 資料表 | 大小 | 處理 |
|---|---|---|
| `StudyStreamItem` | 289 MB | 移除（學習流執行期暫存） |
| `OperationReceipt` | 212 MB | 移除（冪等收據，屬模擬產物） |
| `StudyEncounter` | 127 MB | **保留**（統計 reader 使用） |
| `ReviewEvent` | 55 MB | 保留（答題及統計核心） |
| 其餘表 | 約 177 MB | 保留 |

外鍵皆為 `ON DELETE SET NULL` 或 `CASCADE`，移除兩張大表不會破壞其餘資料完整性。
預估匯入後約 359 MB。

## 分階段 checklist

- [x] 建立計劃書並記錄決策。
- [x] 以 Session pooler 執行 `npm run db:deploy` 建立 67 個 migration。
- [x] 在來源庫直接匯出精簡資料（不建立本機副本，來源庫保持唯讀）。
- [x] 逐表傳輸資料至 Supabase（暫停外鍵與觸發器後全量載入，再還原）。
- [x] 核對各表 row count 與來源一致（除已移除表）。
- [x] `npx prisma migrate status` 確認無 pending migration。
- [x] 以 `__test_student__local` 登入 smoke test，確認首頁、`/stats`。
- [x] 記錄實際資料庫大小（235 MB）。

## 風險

- **免費方案 7 天無活動會暫停專案**，需定期連線或升級。
- **區域延遲**：`eu-west-1` 對香港／台灣學生延遲較高（約 180–250 ms），日後可遷移
  至 `ap-southeast-1`。
- **示範帳號可登入**：`__test_student__local` 密碼已知；由於未有公開部署，暫不構成
  外洩，但正式上線前必須更換或停用。
- **Session pooler 與 transaction pooler 混用**：runtime 用 6543，migration 用 5432，
  不可互換。
- 資料傳輸中斷：可重跑；目標庫為空，重跑前先清空 public schema。

## 測試矩陣

| 項目 | 方式 |
|---|---|
| schema 完整性 | `npx prisma migrate status`、`prisma migrate diff` 比對 |
| 資料完整性 | 逐表 `count(*)` 比對來源 |
| 外鍵完整性 | 匯入後查詢 `pg_constraint` 及 orphan 檢查 |
| 應用可用性 | 測試學生登入、首頁儀表板、統計頁 |
| 容量 | `pg_database_size` 確認 < 500 MB |

## 回退

- 本機 `english_demo` 全程未被修改，可重新匯出。
- Supabase 目標庫可 `DROP SCHEMA public CASCADE` 後重建。
- 計劃書及腳本保留作重跑依據。

## Definition of Done

schema 與 67 個 migration 一致、精簡資料 row count 核對通過、測試學生可登入瀏覽、
資料庫大小 < 500 MB，並在本文件記錄實際測試結果及未執行項目。

## 執行紀錄

### 執行結果（2026-10-31）

- 目標：Supabase 專案 `assiaxezhijeqzeeylsk`，`eu-west-1`，PostgreSQL 17.11。
  （使用者原選新加坡，實際建立的專案在愛爾蘭；不影響功能，僅延遲較高。）
- 連線：Direct connection（`db.<ref>.supabase.co:5432`）只有 AAAA 記錄，本機無法解析；
  改用 Session pooler 完成 migration 與匯入。runtime 仍使用 6543 transaction pooler。
- `npm run db:deploy`：67 個 migration 全部成功，lineage compatibility scan 全為 0。
- 資料匯入：26 張有資料的表全部載入，**row count 逐表核對 0 個不符**；
  118 個外鍵、47 個使用者觸發器已還原並核對數量。

| 項目 | 數量 |
|---|---|
| 學生帳號 | 566 |
| 教師／管理員 | 6 / 1 |
| 班級 | 18 |
| 詞彙（Word） | 5,469 |
| ReviewEvent | 55,417 |
| Review | 12,355 |
| StudySession | 10,847 |
| StudyDay | 9,408 |
| **資料庫大小** | **235 MB**（免費方案上限 500 MB） |

### 過程中遇到的問題及處理

1. `pg_dump --data-only` 會把 `search_path` 設成空字串，導致未限定名稱的觸發器函數
   （`roster_bump_calendar_revision`）找不到 public 表 → 匯入前移除該行。
2. migration 會預先寫入 `CatalogMutationState`／`RosterMutationState`／`DatabaseMetadata`
   單例列，與匯入資料主鍵衝突 → 匯入前 TRUNCATE 全部表（保留 `_prisma_migrations`）。
3. 守衛觸發器（`assert_word_sense_projection` 等）與 `Word ↔ WordSense` 等循環外鍵
   使任何拓撲排序都無法完成 → 改為先暫停全部使用者觸發器與 118 個外鍵約束，
   載入完成後再重建。
4. 首次嘗試失敗時把觸發器備份檔覆寫成空檔 → 改由本機同源 schema 重新取得 47 個
   觸發器定義後重建，並核對數量。

### 已知限制

- **`StudyEncounter` 只載當日視窗**：歷史 encounters（62,539 筆/14日）連同其
  `StudyStreamItem` 閉包（87,260 列）會令庫超出 500 MB，故只載 Asia/Shanghai
  當日資料；跨日查詢 encounters 的頁面只反映當日。活動圖表以 `ReviewEvent`
  為源（已全量），不受影響。
- 示範資料截止 2026-10-06，`demo:update` 只在本地庫執行，雲端不會自動更新。
- 未執行 `npm run test:e2e:card-motion`、未部署 Vercel、未做完整瀏覽器矩陣驗收。
- `.env.supabase` 的 `MIGRATE_URL` 仍指向不可用的 direct connection，日後執行
  migration 前需改為 session pooler。

### 實際執行的驗證

- `npm run db:deploy`：成功（67 migration）。
- `npx prisma migrate status`：Database schema is up to date。
- 逐表 `count(*)` 比對：26 表全部一致。
- `pg_database_size`：235 MB。
- 瀏覽器 smoke test（dev server 連 Supabase）：`/` 首頁（已學進度 70%、20 個待複習）、
  `/stats`（A1 308／A2 1429／B1 1692／B2 2040 詞、打卡 10/3）正常渲染。

## 後續：遷移區域至亞洲

### 區域遷移執行結果（2026-10-31）

使用者實際建立的專案為 **`ogxdoezdhixgahlfylmf`，`ap-northeast-1`（東京）**，
不是建議的 Singapore。東京對香港約 50–70 ms，仍遠優於愛爾蘭 180–250 ms，予以接受；
若日後要換成 Singapore 可按同一流程再跑一次（`scripts/copy-demo-data-to-cloud.mjs`）。

- 新庫：67 個 migration 全部成功；26 張表全部載入，row count **0 個不符**；
  118 外鍵、47 觸發器還原並核對通過；資料庫大小 **235 MB**。
- `npx prisma migrate status`：Database schema is up to date。
- dev server 連新庫 smoke test：`/` 首頁（70%、20 個待複習）正常渲染。
- 舊 `eu-west-1` 專案（`assiaxezhijeqzeeylsk`）**保留未刪**，待使用者確認後刪除。

### 遷移步驟（已固化）

使用者要求把區域由 `eu-west-1` 改到香港。經核對 Supabase 官方區域清單
（<https://supabase.com/docs/guides/platform/regions>），**Supabase 沒有香港
（`ap-east-1`）區域**，亞洲可選只有 Mumbai、Singapore、Tokyo、Seoul、Sydney。
最近香港的選擇是 Singapore `ap-southeast-1`（約 35–50 ms）。

Supabase 專案建立後**不可更改區域**，只能「建新專案 → 遷移 → 刪舊專案」。免費方案
容許 2 個 active 專案，因此可以並存至驗證完成。

遷移步驟（重複使用本次流程，腳本已固化作 `scripts/copy-demo-data-to-cloud.mjs`）：

1. 建立新專案，Region 選 **Southeast Asia (Singapore)**，記下資料庫密碼。
2. Project Settings → Database 取得連線字串，寫入 `.env.supabase`：
   - Transaction pooler（6543，帶 `?pgbouncer=true`）→ `DATABASE_URL`
   - **Session pooler（5432）** → `MIGRATE_URL`（Direct connection 只有 IPv6，本機不可用）
3. 執行 `npm run db:deploy`（以 shell 覆寫 `MIGRATE_URL`）。
4. 執行：

   ```bash
   SOURCE_URL="postgresql://postgres:<本機密碼>@localhost:5432/english_demo" \
   TARGET_URL="<session pooler 連線字串>" \
   node scripts/copy-demo-data-to-cloud.mjs
   ```

5. 核對 row count、外鍵及觸發器數量，再以 dev server 做登入 smoke test。
6. 確認新庫正常後，在 Dashboard 刪除舊 `eu-west-1` 專案。

- [x] 建立亞洲區專案（實際建立為 **Tokyo `ap-northeast-1`**，非 Singapore）。
- [x] 套用 migration 並匯入資料（26 表零不符、118 外鍵、47 觸發器、235 MB）。
- [x] 以 dev server 連新庫完成登入 smoke test。
- [x] 使用者確認後刪除舊 `eu-west-1` 專案（`assiaxezhijeqzeeylsk`）。
  （待確認；舊專案仍保留）

### 評委只讀公開（2026-10-31，使用者授權）

使用者表明此庫供評委查看，授權開放公開存取。因全部為虛構示範資料，採「公開唯讀」：

- 25 張資料表（名冊／詞庫／學習紀錄／統計來源）建立 `public_read` 政策：
  `FOR SELECT TO anon, authenticated USING (true)`。
- `User` 表以**欄位級權限**公開非敏感欄（id、email、role、status、createdAt、
  mustChangePassword、name、suspendedAt）；`passwordHash`、tokenVersion、
  contactEmail 等未授欄 → 對 anon 呈現為欄位不存在。
- 維持關閉（無政策 = 0 列）：SecurityEvent、DatabaseMetadata、OperationReceipt、
  AdminOperationReceipt、AdminMutation*、RosterMutationState、CatalogMutationState、
  CatalogAuditEvent、CatalogChangeRequest、CatalogFeedback、CatalogHistoryFeedEntry、
  CatalogImport*、CatalogSubmission*、RecentAuthGrant。
- 寫入全部被 RLS 拒絕（已驗證 INSERT 報 row-level security錯誤）。
- 驗證（`SET ROLE anon`）：User=573、ReviewEvent=103,940、Word=5,469、
  StudentProfile=566、StudyDay=16,998；敏感表均 0 列；無金鑰 HTTP 401。
- 存取方式：任何人持專案 anon key（Dashboard → Settings → API，可公開）可經
  `https://<ref>.supabase.co/rest/v1/<table>?apikey=<anon_key>` 唯讀查詢。
- ⚠️ 此授權僅適用於虛構示範資料；真實學生資料（PII）絕不可如此公開。
  未來若轉作真實 pilot，必須先移除 `public_read` 政策。

### 安全修復：RLS（2026-10-31）

- 發現：以 migration 建立的 49 張表全部未啟用 RLS，且 Supabase 預設把
  `SELECT` 權限授予 `anon`（PostgREST REST API 角色）；即任何人持有專案
  anon key（設計上可公開）即可經 `https://<ref>.supabase.co/rest/v1/` 讀取
  全部資料，包括 `User.passwordHash`。
- 修復：對 49 張表全部 `ENABLE ROW LEVEL SECURITY`（無政策 = 預設全拒）。
  應用程式以 `postgres`（表 owner）連線，owner 不受 RLS 限制（未用 FORCE），
  故 Prisma runtime / migration 不受影響；已以瀏覽器登入驗證。
- 無金鑰直接請求 REST API 回 HTTP 401；啟用 RLS 後縱使持有 anon key 也
  取得零列。
- 後續新建表（未來 migration）需一併 `ENABLE ROW LEVEL SECURITY`；正式
  接入 Supabase Auth/Storage 前另立計劃。

### 活動數據補回（2026-10-31）

- `demo:update` 因 `__test_student__local` 手動學習記錄與 checkpoint 衝突
  而中止；改用 `demo:init --confirm-reset`（seed `school-2026`、61 日）重建
  名冊並模擬至 2026-10-31，密碼沿用既有值。`demo:check` 全過：566 學生、
  380,502 actions、`reportValidationGaps: 0`。
- 同步至東京庫：25 表零不符；`SSI_SE_SINCE=today` 只載當日（Asia/Shanghai）
  `StudyEncounter` 及其 `StudyStreamItem` 遞迴閉包（今日 791+791 列，約 2MB）；
  FK 118/118、觸發器 47/47 還原；庫大小 396 MB。
- 修正腳本三項缺陷：FK 定義改由來源取得（前次目標 FK 已被刪光令還原為 0）；
  遞迴閉包輸出只取最後一行（先前解析錯位誤報「閉包不完整」）；加並發鎖
  避免兩實例共用工作目錄互刪檔案。
- 瀏覽器驗證（登入 `__test_student__local`）：首頁待複習 17／新詞 1；
  `/stats` 活動圖顯示 10/27=5、詞庫 88%、長期掌握 15%、打卡至 10/27。
