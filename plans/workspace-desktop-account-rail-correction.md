# 教師／管理員 Desktop 側欄帳戶控制修正

狀態：已完成（local verification；authenticated browser smoke deferred）
日期：2026-08-15

## 背景及目標

教師及管理員共用 `WorkspaceShell`。目前 desktop sidebar 只有 `min-height: 100svh`，
當主要內容比 viewport 高時，側欄會跟住 document 拉長，帳戶控制因而跌到頁面最底，
無法一直在左下角使用。要令兩個角色工作台同學生 rail 一樣，帳戶控制固定喺 viewport 左下。

## 範圍及非目標

- 範圍：`WorkspaceShell` desktop sidebar 及相關 CSS；教師／管理員頁面共用。
- 非目標：不改 mobile header/nav、權限、帳戶選單內容、API、資料庫或學習流程。

## 實施 checklist

### Phase 1 — Layout contract

- [x] desktop `.workspace-sidebar` 以 viewport 高度、`position: sticky; top: 0` 呈現。
- [x] sidebar 可在極窄 desktop viewport 內獨立垂直滾動，帳戶控制仍保持底部可見。
- [x] mobile breakpoint 繼續隱藏 desktop sidebar，維持原有 mobile account control。

### Phase 2 — 驗證

- [x] `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run build`。
- [x] source／CSS review 確認 teacher/admin 長頁 sidebar 不再隨 document height 下移。
- [x] 已記錄 authenticated browser smoke 未執行；本機 login limiter 未配置共享 Upstash，避免虛報通過。

## 風險、rollback 及 DoD

- 風險：sidebar 內容過多時需要自身滾動；只允許 sidebar 滾動，不影響 main content。
- rollback：回退 workspace sidebar layout CSS 即可；不涉及資料或 migration。
- DoD：教師及管理員 desktop 長頁捲動時，姓名／帳戶控制一直喺左下 viewport 內；mobile 行為不變，
  lint、typecheck、unit test 及 build 通過。

## 實際驗證及限制

- `npm run lint`：通過。
- `npx tsc --noEmit`：通過。
- `npm test`：166/166 通過。
- `npm run build`：通過（需要本機 process 權限）。
- `git diff --check`：通過。
- 已加入 teacher/admin desktop sidebar geometry smoke；完整 authenticated Playwright 執行 deferred，
  因本機 login limiter 未配置 Upstash backend，登入會 fail closed。
