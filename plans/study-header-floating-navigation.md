# 認字頁 Header 與 Floating Navigation 修正計劃

> 狀態：已完成
>
> 建立日期：2026-08-12
>
> 設計來源：`/Users/hangwong/Documents/Design/emm_style_01/learn.html`、
> `assets/see-word.css`、使用者提供的認字頁 reference screenshot
>
> 關聯計劃：`plans/student-ui-fidelity-corrections.md`（已完成；本文件只記錄後續視覺修正）

## 1. 背景及問題

目前 `/study` 認字頁的頂部仍使用一般小型 toolbar：返回按鈕、13px「今日學習」、打卡徽章及登出圖示分散在同一行，與 EMM Style 01 的 learn screen 不一致，也令核心頁面標題層級不足。

目前 mobile bottom navigation 雖然已固定在 viewport 底部，但仍是全寬、貼邊、直角上邊界的 bar。使用者希望導覽列像 reference 一樣浮在內容之上，讓內容在 scroll 時從其後方經過，同時保留 fixed positioning、safe-area、可操作目的地及 study navigation guard。

## 2. 目標

- 將認字 assess header 對齊 reference：清晰的大型「今日學習」標題、返回圓形按鈕、右側 progress label／count／track，以及保留可用的 theme control。
- 把目前認字階段的「認識／不認識」計數轉為 header progress 的輔助資訊，維持 live region 及可讀性，不改變 queue 或 study workflow。
- 將 mobile StudentNav 改為左右及底部有安全距離、圓角、半透明 blur、陰影的 floating surface；內容可在其後方滾動經過。
- 保持 desktop rail、study guard、dialog inert、safe callback、locale、light/dark、Forced Colors、reduced motion 及所有學習提交語義不變。
- 使用真實 queue length／current index，不加入 prototype 固定的 `13` 或任何示例資料。
- 維持 `/words` 既有 URL filter contract；修正快速連續變更 filter 時採用舊 query 的競速，不改變 API、資料或瀏覽器 back/refresh 語義。

## 3. 非目標

- 不改變 `GET /api/study`、study session、nonce、operationId、checkpoint、outbox、cross-tab lease、retry、rotation、Serializable transaction、SM-2 或單元解鎖。
- 不修改 Prisma schema、migration、資料、API cache policy 或 production config。
- 不把 navigation 改成會因 scroll 自動隱藏的 header；floating surface 仍固定在 visual viewport，確保學生隨時可離開或切換目的地。
- 不移除登出或主題切換能力；只調整其在 study header 的呈現方式。

## 4. 現況及 design contract

| 範圍 | 現況 | 修正 contract |
|---|---|---|
| Study header | assess title 為 13px `今日學習`，進度另置於下一行，右側為 streak／logout | header 對齊 `learn-topbar`：返回 control、`h1` 大標題、progress label/count/track、theme control；auth exit guard 保留 |
| Progress | 顯示認識／不認識計數及 progress track | 顯示真實 `currentIndex + 1 / queue.length`；認識／不認識計數保留為 screen-reader/live context，避免資料或行為改變 |
| Mobile nav | `position: fixed; left: 0; right: 0; bottom: 0`，全寬 surface | `left/right/bottom` 安全距離、`border-radius`、`backdrop-filter`、border、shadow；height／44px targets／safe-area 保留 |
| Content reachability | main bottom padding 約 96px | padding 足以讓最後內容在 floating nav 後仍可 scroll 到；不可用 overflow-x hidden 掩蓋問題 |
| Locale/theme | 新文案經 `tc()`；theme control 已存在於 AccountControls | 所有新增可見、ARIA、title 文案經 `tc()`；Hant/Hans 及 light/dark 均驗證 |
| Words filter transition | 快速連續點擊 filter 可能以舊 query 建立下一個 URL | 以最新 query ref 串接 filter 更新；保留既有 URL、refresh、back 及 read-only 行為 |

## 5. 實施步驟及 checklist

### Phase 0：baseline 及計劃鎖定

- [x] 核對工作樹、branch、StudyPage、StudentShell、StudentNav、ThemeProvider 及現有 E2E。
- [x] 讀取 prototype `learn.html`／CSS 及使用者 reference screenshot，確認 header／floating nav contract。
- [x] 確認本修正不涉及 schema、migration、study API 或 submission pipeline。
- [x] 建立本計劃並同步 `plans/README.md`。

### Phase 1：Study header 視覺修正

- [x] 建立 semantic study header layout，將「今日學習」提升為正確 heading hierarchy 及 responsive display size。
- [x] 以真實 `currentIndex`／`queue.length` render progress label/count/track；避免固定數字及 prototype placeholder。
- [x] 保留退出連結的 `guardStudyNavigation`，保留 theme toggle 及 logout／account access，不新增 auth bypass。
- [x] 確認 assess、quiz、done、locked、error、loading state 不因 header 改動出現空白、layout shift 或 404。

### Phase 2：Floating mobile navigation

- [x] 將 mobile bottom nav 改為 floating surface，具左右／底部 safe-area gap、rounded corners、blur、shadow、theme／Forced Colors fallback。
- [x] 更新 student main bottom padding，讓長內容可 reach；確認 action buttons、speech-rate control、dialog 及 nav 不互相遮擋。
- [x] 保留四個真實目的地、active state、aria-current、navigation guard、dialog inert、keyboard／touch／synthetic pointer。
- [x] 驗證 desktop rail 不受影響；study route mobile nav 仍可見且不會 login loop。

### Phase 3：驗證、visual QA 及交付

- [x] 新增／更新 focused E2E：header semantics、真實 progress、floating geometry、scroll-through、safe-area、keyboard/focus、Hant/Hans、light/dark。
- [x] 在 320×568、360×800、390×844、430×932、844×390、820×1180、1440×900 產生 screenshots 並目視比較 reference。
- [x] 執行適用 unit、lint、typecheck、build、student IA、study navigation、card fidelity／motion 及 final QA。
- [x] 記錄 prototype 刻意偏差：progress 由真實 queue length 取代固定 `13`；auth controls 以產品安全需求保留；floating nav 覆蓋內容但 main padding 保證可 reach。
- [x] 更新本計劃實際結果、限制及 Definition of Done，建立單一可回退 checkpoint commit。

## 6. 風險及保護

- Floating nav 覆蓋卡片或 action：以 geometry assertions、scroll-to-last-content 及 speech-rate intersection test 防止。
- 半透明背景在 dark／Forced Colors 對比不足：提供 semantic surface、border、shadow fallback，並以 axe／forced-colors smoke 驗證。
- Header 改動誤觸 study navigation：只重用既有 guard/controller，不修改 submission 或 checkpoint code。
- 小屏標題／progress 擠壓：使用 responsive grid／min-width 及 320px screenshot；不得以 overflow-x:hidden 掩蓋 overflow。

## 7. 驗證矩陣

| 類別 | 命令／證據 | 完成條件 |
|---|---|---|
| Unit | `npm test` | 全部 pass |
| Static | `npm run lint`、`npx tsc --noEmit` | 全部 pass |
| Build | `npm run build` | production build pass |
| Student IA | `npm run test:e2e:student-ia` | nav／role／locale／study guard pass |
| Study workflow | `npm run test:e2e:card-motion` | gesture、checkpoint、outbox、nonce、retry、rotation pass |
| Focused UI | final QA／study navigation／card action suites | header、floating nav、action geometry、dialog inert pass |
| Visual | saved screenshots + manual comparison | reference hierarchy retained；偏差已記錄 |
| Accessibility | axe、keyboard-only、Forced Colors、reduced motion、ARIA | 無新增 WCAG 2.2 AA regression |

## 8. 實際驗證紀錄（2026-08-12）

| 驗證 | 實際結果 |
|---|---|
| `npm test` | 97 passed、0 failed |
| `npm run lint` | passed |
| `npx tsc --noEmit` | passed |
| `npm run build` | passed；39 routes；由最終 `npm run test:e2e:card-motion` build stage 驗證 |
| `npm run test:db` | passed；Review ledger／idempotency／concurrency check |
| `npm run test:e2e:student-ia` | 24 passed、2 skipped；涵蓋 student shell、words filter、role、locale、study navigation |
| `npm run test:e2e:card-motion` | primary 73 passed、4 skipped；WebKit study shard 1 為 17 passed、shard 2 為 16 passed |
| focused navigation/action/card regression | 26 passed、3 skipped |
| `student-final-qa` | 8 passed；header、viewport matrix、private/no-store、keyboard、dialog/live region、400% zoom、locale/theme |
| spacing／accessibility suites | 16 passed、1 skipped；包括 student spacing axe WCAG 2A/2AA、study-card axe、forced-colors、reduced-motion |
| Visual evidence | 重新產生 phase 1／2／3／5／6 screenshots；人工檢查 320×568、390×844、820×1180、1440×900；header hierarchy、floating inset／blur／shadow、desktop rail 均符合 contract |

### 實作結果及刻意偏差

- Header 使用真實 queue `currentIndex + 1 / queue.length`；reference 的 `1 / 13` 只作比例與層級參考，沒有固定數字或 prototype sample data 進入 production。
- reference 只展示 theme control；production 仍保留 logout control，並沿用既有 Auth.js／guard 行為，避免因視覺收斂移除安全能力。
- Mobile nav 仍為 fixed visual-viewport surface，但改成 inset rounded floating panel；`student-main` 增加 bottom reachability padding，最後內容不會被遮住，scroll 時內容可在其後方經過。
- 320px 寬度將 speech-rate control 上移，避免與 action buttons 或 floating nav 相交；這是 responsive 可用性修正，不是 prototype content contract 改動。
- 驗證期間發現 `/words` filter 快速連點會因舊 query closure 丟失前一個 filter；已用最新 query ref 修正，保留原有 URL-addressable／refresh／back contract，未改 schema 或 API。

### 已知限制及未執行項目

- 沒有 iOS 實機／simulator；已用 Chromium mobile viewport、visual viewport／safe-area geometry、WebKit study workflow 及 keyboard／ARIA evidence 作等價驗證。本次 follow-up 沒有另外啟動 VoiceOver／NVDA native device smoke。
- 本地測試會顯示 Upstash Redis 未配置的 development-only in-memory limiter warning；`npm run check:production-config` 的既有 production policy 未被本次改動觸碰，沒有執行 push、PR、部署或 destructive DB command。
- 沒有修改 Prisma schema、migration、API response 或 cache policy，因此不需 migration checksum／fresh replay；`npm run test:db` 已確認既有 review ledger contract。

## 9. Rollback、發佈及限制

- 本次只改 UI、component props／markup、CSS 及測試／計劃文件；不需 migration 或資料 rollback。
- 建立一個內容單一 checkpoint commit；rollback target 為本計劃開始前的 clean HEAD。
- 未獲明確授權不 push、開 PR、部署 production 或執行 destructive database command。
- 如無 iOS 實機／simulator，記錄 mobile emulation、visual viewport resize、WebKit 及 safe-area 等價證據，不把它描述成原生 device smoke。

## 10. Definition of Done

- [x] Study assess header 視覺及 hierarchy 符合 reference，主標題清晰可見。
- [x] Progress 使用真實 queue 資料，沒有固定 `13`／prototype example 進入 production。
- [x] Mobile nav 是 floating surface，內容可在其後方 scroll，且最後內容仍可 reach。
- [x] 所有導覽、guard、auth、dialog inert、locale/theme/accessibility 行為無回歸。
- [x] 指定測試及 viewport screenshots 已通過並記錄。
- [x] 計劃狀態、checklist、限制及 checkpoint commit 已更新；工作樹沒有未解釋改動。
