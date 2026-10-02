# 全站帳號介面圖標審查與重設計

狀態：已完成（local source/build verification；完整登入瀏覽器矩陣 deferred）
日期：2026-08-15

## 背景

學生、教師及管理員頁面仍有少量舊 inline SVG、emoji、Unicode 箭頭／勾號／叉號，
令圖標筆畫、尺寸和語意不一致，亦同 EMM Style 02 嘅共用元件系統不一致。今次只處理
可見介面嘅圖標表達，不改學習、權限、資料或 API 行為。

## 目標與非目標

目標：

- 全面盤點學生、教師、管理員可見頁面及共用狀態元件。
- 所有 utility、navigation、action、status 圖標統一使用 `Icon`；獎勵、排行榜及成就
  圖標只使用 `RewardIcon`。
- 移除可見 emoji 及以 `←`、`→`、`✓`、`✕` 等字元充當圖標嘅做法，改為圖標元件加本地化文字。
- 新增必要語意圖標時保持 currentColor、1.8 stroke、keyboard／screen-reader 隱藏語意，
  同時保留可見文字作理解及無障礙名稱。

非目標：

- 不改 Prisma、API、權限判斷、學習流程、分數、資料格式或登入行為。
- 不把 `Icon.tsx`／`RewardIcon.tsx` 內部嘅 canonical SVG 定義誤當成頁面內舊圖標。

## 現況盤點

- 共用來源：`src/components/ui/Icon.tsx`、`src/components/ui/RewardIcon.tsx`。
- 需要清理嘅可見 inline SVG：教師概覽、學生單元／學習頁、`ErrorBanner`、登出按鈕。
- 需要清理嘅可見 pictograph：教師 CTA、教師學生操作、Quiz 結果、連續學習日曆及
  單元／學習頁狀態和箭頭。
- 相關入口：學生 `今日`／`學習`／`詞表`／`統計`／`單元闖關`／`排行榜`／`成就`，教師概覽／
  學生列表，管理員概覽／用戶／單詞庫／名單管理，以及共用錯誤與登出元件。

## 分階段 checklist

### Phase 1 — 規範及盤點

- [x] 建立 canonical icon contract：utility/action/status 用 `Icon`，reward 用 `RewardIcon`。
- [x] 列出非 canonical inline SVG、emoji 及視覺 Unicode 字元位置。
- [x] 凍結驗收規則：可見頁面不得新增 inline `<svg>` 或 emoji／視覺箭頭字元。

### Phase 2 — 元件及圖標補齊

- [x] 為教師統計及 CTA 補齊語意化 `trending-up`、`clipboard` 圖標。
- [x] 保持共用圖標筆畫、尺寸、currentColor、focus／aria 行為一致。

### Phase 3 — 學生、教師、管理員及共用頁面替換

- [x] 清理教師概覽及教師學生列表嘅 inline SVG／emoji。
- [x] 清理學生單元、學習、Quiz、Streak、StudyStats 嘅 inline SVG／emoji／Unicode 圖標。
- [x] 清理共用錯誤及登出元件。
- [x] 檢查管理員、排行榜、成就及既有 `RewardIcon` 使用仍符合分類，避免混用舊圖標。

### Phase 4 — 驗證及交付

- [x] 以 source audit 確認 canonical 元件以外無可見 inline SVG、emoji 或視覺箭頭／勾叉字元。
- [x] 執行針對性 `npm test -- --runInBand`、`npm run lint`、`npx tsc --noEmit` 及 `npm run build`。
- [x] 完成 source-level rendered contract review；完整 desktop／mobile 登入瀏覽器矩陣 deferred，原因係本機
  login limiter 未配置共享 Upstash，登入流程會 fail closed，未把未跑嘅 E2E 標記為通過。
- [x] 記錄實際驗證、限制、rollback 方法及後續工作，完成計劃書。

## 風險與回滾

- 風險：替換 translation 內嘅箭頭／emoji 可能影響斷行；以 flex layout、`gap` 及獨立文字節點
  控制，並保留原有 link/button 語意。
- 風險：圖標改動可能令 snapshot／selector 失效；只改 presentation，必要時更新精確 selector。
- 回滾：只需回滾本計劃涉及嘅 `Icon`、共用元件及頁面 patch；不觸碰資料庫或帳號資料。

## 驗收矩陣

| 範圍 | 驗收 |
|---|---|
| Source contract | canonical 元件以外無 `<svg>`；無可見 emoji／`←→✓✕` 圖標字元 |
| Visual consistency | Icon currentColor、1.8 stroke、尺寸與 gap 一致；reward 保持獨立 style |
| Accessibility | 圖標預設 `aria-hidden`；操作仍有文字／aria-label；keyboard focus 不變 |
| Regression | `npm test`、lint、typecheck、build 通過；相關頁面可正常 render |

## 決策紀錄

- D1：採用共用 `Icon`／`RewardIcon`，不在頁面重新手寫 SVG。
- D2：emoji 及視覺 Unicode 箭頭／勾叉不作 UI 圖標；文字與圖標分離，方便本地化及無障礙。
- D3：本次不需要 migration、資料清理或 production rollout。

## 實際驗證及限制

- `npm test -- --runInBand`：166/166 通過。
- `npm run lint`：通過。
- `npx tsc --noEmit`：通過。
- `npm run build`：通過（需要本機 process 權限；sandbox 首次執行被 Turbopack process bind 限制）。
- `git diff --check`：通過。
- source audit：canonical 元件以外無 inline SVG；可見 account UI 無 emoji／`←→✓✕`。
- 未執行完整 authenticated Playwright desktop／mobile visual matrix；現有本機 login limiter 未配置
  Upstash backend，會在登入邊界 fail closed。後續只需在本地安全測試環境配置 limiter 後重跑相關頁面 smoke。
