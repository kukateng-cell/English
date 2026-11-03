# 單元解鎖改用「已學過」而非「已答對」（#94）

## 狀態

已完成（本地實作及驗證；Playwright e2e 需本機資料庫及 seed，未執行並已列明）

## 背景

GitHub issue #94：新學生第一天可能長時間沒有新詞可學。

按現行規則推算：

1. 全域學習只派發已解鎖單元的詞；新學生只有 A1 第一個單元（約 20 詞）。
2. 下一個單元要當前單元 80% 的詞「已認字」（`Review.repetitions >= 1`，即客觀題答對過）才解鎖。
3. 初次驗證答錯的詞會排到隔天複習，不會同日再出。

所以學生如果答錯超過 4 個，第二單元未解鎖、第一單元又沒有未接觸的新詞，畫面只會顯示
「進度已保留，可以稍後再回來複習」，要等到隔天。對基礎較弱的學生，第一天就被擋住。

issue 列出三個可能方向：解鎖條件改用「已學過」、首日放寬、或答錯的詞同日再檢查。

## 目標

1. 學生只要完成某單元的「初次驗證」（不論答對或答錯），即可累積解鎖進度；單元解鎖不再要求答對。
2. 「認字／長期掌握」的語義完全不變：仍然是客觀題答對後由 SM-2 推進，仍然用於顯示認字率、已完成
   標記、統計、排行榜及教師端。
3. 消除「已解鎖內容全部學過但下一個單元仍鎖住」的死局，不需要等到隔天。

## 非目標

- 不改 SM-2 演算法、`retrieval-v1`／`retrieval-v3` scoring、Review 間隔（初次驗證後首次複習仍為一天）。
- 不改 `maxPendingInitialWords`、初驗間隔、服務輪次或任何 study stream 選題／outbox／receipt／CAS 行為。
- 不改排行榜、教師端、學習分析對「掌握」的定義。
- 不引入「首日」為單位的特殊狀態或每日重置邏輯。
- 不改 `src/lib/mastered.ts` 的長期掌握門檻（interval >= 22 天）。

## 決策

採用 issue 第一個方向：**解鎖條件改用「已學過」**。定義：

- 「已學過」（learned）= 該詞已有 `Review` 記錄，即已完成第一次合資格的 operational Objective Probe，
  不論答對或答錯。答錯會留下較低 ease 及一天後複習，仍然計入「已學過」。
- 「已認字」（mastered）= `Review.repetitions >= 1`，即至少答對一次。維持現行語義。
- 單元解鎖：`learned / total >= UNIT_UNLOCK_RATIO（0.8）`。
- 級別解鎖：前一級別全部單元都達到上述解鎖門檻。
- 單元「已完成」及顯示的認字進度：仍然用 `mastered`。

### 為何不採用另外兩個方向

- **首日放寬**：需要引入以本地日曆日為單位的特殊狀態，第二天仍然會撞上同一個死局，只是延後一天；
  亦無法解釋為何同一份內容在第二天規則不同。
- **答錯的詞同一天再安排一次檢查**：與 `plans/study-stream-learning-phases.md` 的既定設計衝突
  （「初次驗證正誤都結束該詞的初學工作；首次 Review 間隔為一天，答錯保留失敗及較低 ease」），
  會改動排程及 SM-2 輸入語義，風險遠高於解鎖條件的顯示層改動，而且不是問題根因。

### 語義邊界

- 解鎖門檻仍然只由 server 判分後寫入的 `Review` 推動，不會因為 Learning Card 自評、reveal 或
  research event 而推進；`plans/retrieval-first-learning-contract.md` 的 provenance 規則不變。
- 學生未完成初次驗證的詞不會計入 learned，所以「未學過」的詞仍然要經 Learning Card 及客觀題。
  因此不會出現「未接觸就可以解鎖」的情況。
- 解鎖只代表可以接觸更深的內容；是否「認字／掌握」仍然由客觀答題結果決定，學習證據不會被放寬。

## 依賴

- `src/lib/units.ts` 的 `computeUnlocks` 是單一計算點：`/api/units`、`/api/study`（`resolveScope`）、
  `/words`、統計頁及 demo 模擬全部經 `aggregateUnitStatRows`／`aggregateAllLevels` 取得解鎖狀態。
- `src/lib/unit-progress-server.ts` 已回傳 `learned`、`mastered` 兩個獨立計數，無需改 SQL。

## 分階段 checklist

### P1 核心邏輯

- [x] 新增 `UNIT_UNLOCK_RATIO` 及 `isUnitUnlockedByProgress(total, learned)`
- [x] `computeUnlocks` 的單元鏈及級別鏈改用 learned 門檻
- [x] `completed`、`progress` 維持 mastered 語義
- [x] 更新 `units.ts`／`mastered.ts` 的註解，說明解鎖與認字的區分

### P2 學生端顯示

- [x] 單元卡改以「已學過」顯示解鎖進度，並保留認字／已完成標記
- [x] 級別未解鎖提示文案改為「每個單元至少學過 80% 的詞」
- [x] 鎖定單元提示改為說明解鎖條件
- [x] 繁簡及明暗主題都要可用

### P3 測試

- [x] 單元測試：learned 達門檻但全錯仍解鎖下一單元
- [x] 單元測試：learned 未達門檻仍然鎖住
- [x] 單元測試：級別鏈同樣用 learned
- [x] 單元測試：`completed` 仍以 mastered 判定
- [x] 既有 `units.test.ts` 全部維持通過

### P4 文件

- [x] 更新 `plans/retrieval-first-learning-contract.md` 的解鎖語義說明
- [x] 更新 `plans/retrieval-first-v2-current-product-baseline.md` 的解鎖描述
- [x] 更新 `plans/student-reported-issue-fixes-91-96.md` 的 #94 備註（改由本計劃處理）
- [x] 更新 `plans/README.md` 索引

## 實作結果

### 核心邏輯（`src/lib/units.ts`）

- 新增 `UNIT_UNLOCK_RATIO = 0.8` 及 `isUnitUnlockedByProgress(total, learned)`：
  `learned / total >= 0.8`；空單元（0 詞）視為已達門檻，避免解鎖死鎖。
- `computeUnlocks` 的單元鏈（`previousUnitChainUnlocked`）及級別鏈
  （`previousLevelChainUnlocked`）都改用 learned 門檻；`isUnitCompleted` 只保留給
  `AggregatedUnit.completed` 及級別 `completed` 顯示，仍然以 mastered 判定。
- `progress` 欄位語義不變（mastered 認字進度），沒有新增或移除 API 欄位，
  因此 `/api/units`、`/api/words`、`/api/study/stats`、study stream `resolveScope`、
  demo 模擬及既有測試 fixtures 全部沿用同一份 contract。
- `src/lib/mastered.ts` 的註解更新為三層區分：已學過／認字／長期掌握。

### 學生端顯示（`src/app/(student)/units/page.tsx`）

- 單元卡的進度條改用 `learned / total`（解鎖進度），底部文字改為
  「已學 X/Y · 認字 Z」，令學生看到解鎖依據之外仍然看到認字數。
- 級別未解鎖提示改為「把每個單元至少 80% 的詞學過（完成初次驗證）」。
- 鎖定單元提示由「完成上一單元解鎖」改為「學過上一單元 80% 詞即可解鎖」；
  級別 tab tooltip 同步改為「請先學過上一個級別每個單元 80% 的詞」。
- 級別總覽卡標籤由「級別總進度」改為「級別認字進度」，避免與解鎖進度混淆；
  數字仍然沿用 mastered。
- 「已完成」徽章仍然以 mastered 80% 判定，所以「已學完但未認字」的單元會顯示
  滿的解鎖進度而沒有已完成徽章，符合新語義。

### 行為變化

- 學生把某單元 80% 的詞做過初次驗證（正誤都算）後，下一單元即解鎖，不再需要答對。
- 學生未做初次驗證的詞不計入 learned，所以仍然要經 Learning Card 及客觀題。
- 級別解鎖同樣放寬到 learned；單元／級別的「已完成」及所有認字、掌握、排行榜、
  教師端統計維持原狀。
- 已在使用的學生進度不需回填，下次讀取 `/api/units` 或學習流時即按新規則重算。

## 實際執行的驗證（2026-11-03）

| 指令 | 結果 |
|---|---|
| `npm test` | 429 pass / 0 fail（本分支基線 420，新增 9 個 `units.test.ts` 測試） |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run build` | exit 0 |
| `npm run check:markdown-links` | 72 files passed |
| `npm run check:plan-index` | 46 direct plans / 48 unique targets passed |
| `markdownlint-cli2`（CI 同版本 0.24.0） | 73 files, 0 issues |

新增測試覆蓋：learned 100% 但全錯仍解鎖下一單元、剛好 80% 解鎖而 79% 仍鎖、
未做初驗不計入、級別鏈用 learned、級別要全部單元達標才解鎖、
`completed` 及 `progress` 仍要求答對、空單元解鎖死鎖保護。

## 未執行項目及原因

- Playwright e2e 未執行：`playwright.config.ts` 需要 production build 起
  `127.0.0.1:3100`，且多數 spec 要求本機 PostgreSQL 及 `npm run seed` 建立的測試帳戶；
  目前 `.env.local` 指向雲端示範庫，未獲授權寫入。`/units` 的既有 e2e 只檢查版面
  （`student-spacing.spec.ts`、`student-shell.spec.ts` 的 API/page 一致性），沒有斷言
  解鎖數字或本次改動的文案。
- 未做登入後的瀏覽器視覺覆核（需要測試帳戶及資料庫）；版面改動屬既有卡片內的文字與
  進度條數值，風險已由 lint／typecheck／build 覆蓋。
- `scripts/backfill-demo-realism.ts` 的 demo 解鎖推算仍以掌握為準，只影響 demo 資料的
  隨機分佈，不影響 runtime；未改。

## 風險

- 學生可能在未認字的情況下推進到更高級別，令「認字率」看起來偏低。這是刻意的取捨：解鎖代表曝露進度，
  掌握仍然獨立顯示；排行榜、教師端及統計頁的掌握口徑完全不變。
- 若日後要改回以掌握解鎖，只需調整 `computeUnlocks` 的 predicate 及 `UNIT_UNLOCK_RATIO`。
- `scripts/backfill-demo-realism.ts` 自帶一份以掌握為準的 demo 解鎖推算；只影響 demo 資料回填的
  隨機分佈，不影響 runtime，未在本次改動。
- e2e 未在本計劃範圍執行（需本機 PostgreSQL 及 seed）；`/units` 的 e2e 只檢查版面，未斷言解鎖數字。

## 測試矩陣

| 改動 | 驗證 |
|---|---|
| `src/lib/units.ts` 解鎖 predicate | `npm test`（含新增單元測試）、`npx tsc --noEmit` |
| 學生端 `/units` 顯示及文案 | `npm run lint`、`npx tsc --noEmit`、`npm run build` |
| 文件 | `npm run check:markdown-links`、`npm run check:plan-index` |

資料庫／migration／Playwright gesture suite 不在本計劃必要範圍。

## 發佈／退役處理

純 runtime 計算與顯示改動，不改 schema、migration 或資料。已部署環境下一次部署即生效；
已存在的學生進度不需回填，解鎖狀態會在下次讀取時按新規則即時重算。

## Definition of Done

- [x] 解鎖改用 learned，`completed`／認字仍用 mastered
- [x] 單元測試覆蓋解鎖、級別鏈及完成判定
- [x] `npm test`、`npm run lint`、`npx tsc --noEmit`、`npm run build` 通過
- [x] 計劃書及相關文件已更新並記錄實際驗證
