# 示範學校進度真實化及學習流穩定性

狀態：已完成（本地驗證，2026-11-02）

## 背景

比賽演示前檢查發現兩類問題：

1. 示範學校的虛擬學生進度偏低，大部分學生停留在 A1，演示時排行榜、教師進度及帳號管理頁面不夠有說服力；
   模擬仍按 `retrieval-v1` 政策產生資料，與現行 `retrieval-v3` 學習流不一致，教師端「初次驗證／到期複習」
   分項全部落入「歷史階段不明」。帳號名稱（`school-01-05`）及所有帳戶的建立日期均為初始化當天，
   帳號管理截圖不像真實學校。
2. 學習流在 `buildV3Candidates` 中，其他 session 留下、租約已過期但未自評的字卡會永久佔用詞語及初驗名額；
   學生在幾個單元各留下一張未完成字卡後，全域學習流可能長期沒有新詞可學。每次取題亦會讀取整個詞庫及
   全部 Review，手機網絡較慢時回應時間較長。

## 目標

- 虛擬學生分為穩定、一般、隨意及停用四類習慣，約一成半學生進度明顯領先，演示帳戶屬穩定類。
- 模擬改用現行 `retrieval-v3` 政策，寫入的 session、item、obligation、target 及 encounter 版本一致。
- 帳號改為按入學年、班別及學號編排的學生編號；帳戶建立時間早於開學日，按學生錯開。
- 模擬後按現有規則計算成就，避免 `/achievements` 全為 0。
- 學習流退役其他 session 中租約過期的未自評字卡，釋放詞語及初驗名額。
- 量度取題回應時間，如有明顯瓶頸，在不改學習語義的前提下減少重複讀取。

## 非目標

- 不改 SM-2、評分、解鎖或排行榜規則；不改 schema。
- 不直接寫入雲端資料庫；雲端更新由持有憑證的組員按 `scripts/copy-demo-data-to-cloud.mjs` 執行。
- 不把虛擬資料描述為真實學生研究數據。

## 依賴

- 本地 PostgreSQL、READY catalog、`.env.local` 的 development marker。
- 現有 `simulateStudent` 的 `retrieval-v3` 路徑及其單元測試。

## 分階段 checklist

- [x] 學習流：退役過期的跨 session 未自評字卡，並加入資料庫回歸。
- [x] 量度取題時間並優化讀取（見實際執行紀錄）。
- [x] 模擬：學生習慣分類、演示帳戶固定為進階／穩定類、改用 `retrieval-v3`。
- [x] Writer：版本欄位跟隨模擬政策；帳號編號及建立時間；模擬後計算成就；批次寫入。
- [x] 本地重新初始化示範學校並記錄進度統計。
- [x] 手機及桌面尺寸檢查學生主頁、統計、排行榜及管理員帳號管理頁。
- [x] 單元、lint、typecheck、build、資料庫及瀏覽器回歸。

## 風險

- `DEMO_VERSION` 改變後舊 manifest 不能 `demo:update`，必須重新 `demo:init`（會清除本地帳戶及學習資料）。
- 雲端資料需整庫重新複製，複製期間示範網站可能短暫不一致。
- 退役過期字卡後，學生回到原單元會看到新的字卡，而不是之前未自評的那張；已揭示的曝光仍按揭示時間計入。

## 測試矩陣

| 範圍 | 驗證 |
|---|---|
| 模擬純函數 | `npm test`（`demo-school.test.ts`） |
| 學習流 | `npm run test:db:stream-v2`、`npm run test:db:selection` |
| 示範資料 | `npm run demo:init`、`npm run demo:check` |
| UI | 手機（375px）及桌面瀏覽器檢查 |
| 整體 | `npm run lint`、`npx tsc --noEmit`、`npm run build` |

## 發佈處理

合併後在本機執行 `demo:init` 及 `demo:check`，再由組員以 `copy-demo-data-to-cloud.mjs` 更新雲端示範庫。
演示前一天執行 `demo:update` 並重新複製，保持最近活動。

## Definition of Done

- 示範學校中位數學生已學詞數及長期掌握數較基線明顯提高，至少一成學生進入 A2 或以上。
- 最近七日平均活躍日數不低於 4 日。
- `demo:check` 通過；上述測試通過或明確記錄未執行原因。

## 實際執行紀錄

### 學習流

- 回歸 `test:db:selection` 新增「其他 session 留下五張過期未自評字卡」案例：未修正前全域學習流
  沒有新詞（斷言失敗），修正後即時派發新字卡，五張舊卡均為 `SUPERSEDED`。
- 取題時間（本機 PostgreSQL、600 個 Review 的測試帳戶、示範學校約 26 萬筆學習紀錄，12 次取中位數）：
  修改前 524 ms，修改後 108 ms。主要瓶頸是單元範圍條件被 Prisma 展開成約百個 catalog join，
  規劃時間約 300 ms；改為按 `userId` 走索引後在記憶體按已載入的範圍詞語篩選，語義不變。
  `learnerStreamHistory` 中 v3 已不使用的 `contactTimes` 查詢一併移除。出題可行性按詞條內容快取。

### 示範學校

- 基線（舊模型，先完成的 108 名學生）：已學詞中位數 24、最多 89、平均長期掌握 7、無人進入 A2、
  最近七日平均活躍 3.4 日。
- 新模型（305 名學生）：已學詞中位數 85、平均 133、最多 615、平均長期掌握 47、31 人（約一成）進入 A2
  或以上、零進度 10 人（停用型）、最近七日平均活躍 4.2 日；生成當日 201 人有活動。
- 使用者決定學生人數暫時足夠：停止生成後刪除未生成活動的 261 名學生及 8 個空班（同時刪除其教師班級權限），
  manifest 只保留 305 名學生（初一至初三及高一甲班，共 10 班）。`demo:check` 通過，report validation gap 為 0。
- Writer 改為批次寫入後，每名學生由約 18 秒降至約 3 秒。

### 已執行測試

- `npm test`（402 pass）、`npm run lint`、`npx tsc --noEmit`、`npm run build`。
- `npm run test:db:selection`、`npm run test:db:stream-v2`（本機 development 庫，只建立及清理隨機測試帳戶）。
- `npm run test:e2e:card-motion`（獨立 `english_test` 庫）：68 pass／4 skipped，WebKit study 兩個 shard 各 14 pass。
- `npm run demo:check`（305 名學生）。

### 未執行及已知限制

- 未更新雲端示範庫：需要持有 Supabase 憑證的組員按 `scripts/copy-demo-data-to-cloud.mjs` 複製。
- 未在實體手機上測試；手機尺寸只以瀏覽器模擬（375×812）及 Playwright mobile emulation 驗證。
- 每日活動需要每天執行 `demo:update`（未安裝排程）；演示前一天執行並重新複製到雲端。
