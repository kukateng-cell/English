# 學生端今日／詞表導覽修正計劃

> 狀態：已完成
>
> 建立日期：2026-08-15
>
> 範圍：學生端「今日」快捷入口及「詞表」頁面切換控制

## 1. 背景及目標

桌面版「今日」頁面右側欄位太窄，令「單元闖關」及「統計與成就」標題換行；同頁亦未直接提供排行榜及成就入口。「詞表」頁面右上角的詞表／單元闖關切換控制又比其他學生端入口細。今次只修正資訊架構與 presentation，讓 desktop 入口清晰、同一列保持協調，並保留 mobile 的可讀性。

## 2. 目標、非目標及成功準則

- 目標：今日頁面顯示單元闖關、統計與成就、排行榜、成就四個快捷入口；desktop 標題不因欄位設計而換行。
- 目標：詞表／單元闖關切換控制於 desktop 使用與其他次要入口一致的 hit target、字級及內距。
- 非目標：不修改 API、資料、權限、學習流程、路由語義、mobile 導覽或現有 locale／theme 文案規則。
- 成功準則：1440px 及 tablet desktop layout 無不必要換行或水平溢出；四張今日入口卡尺寸協調；詞表切換掣可見、可點及高度一致。

## 3. 實施 checklist

### Phase 1：今日入口及版面

- [x] 將今日入口擴充為單元闖關、統計與成就、排行榜、成就四個獨立 Link card。
- [x] desktop 大寬度改用完整下方 row 排列快捷卡，並以不換行標題及一致 min-height 保持比例；中等 desktop 使用兩欄；mobile 保持單欄。

### Phase 2：詞表切換控制

- [x] 放大詞表／單元闖關切換控制的 padding、字級、gap 及最小高度，與統計頁次要入口一致。
- [x] 以現有 desktop／mobile／tablet screenshot smoke 確認沒有水平溢出；沿用既有 `tc`、active state 及 theme token，沒有改動 locale／theme contract。

### Phase 3：驗證

- [x] 更新 targeted desktop geometry test，驗證四張快捷卡、標題不換行及詞表切換控制尺寸。
- [x] 執行必要的 lint、TypeScript、build 及 targeted browser test；檢查 rendered screenshot。
- [x] 記錄未執行的高成本／非本次範圍測試及 rollback 方法。

## 4. 風險與 rollback

- 風險：窄 desktop 或字體放大時入口卡可能再次擠壓；以 breakpoint、grid minmax、nowrap 及 targeted overflow assertion 防止。
- 風險：新入口文案可能受 locale 轉換影響；沿用 `tc`，不改翻譯 contract。
- rollback：只需回退本計劃涉及的 Dashboard JSX、globals.css、targeted test 及本計劃／索引文件；不涉及資料或 migration。

## 5. Definition of Done

- 今日頁面四個入口在 desktop 清楚呈現，單元闖關及統計與成就不再因右欄過窄而換行。
- 今日頁面可直接前往排行榜及成就；詞表右上角控制與其他 desktop 次要入口視覺及 hit target 一致。
- Targeted test、lint、typecheck、build 通過，且計劃記錄實際驗證及限制。

## 6. 實際驗證紀錄（2026-08-15）

- `npm run lint`：passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：passed（Next.js production build，58 pages）。
- `git diff --check`：passed。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=off npx playwright test tests/e2e/student-spacing.spec.ts --project=student-spacing-desktop --grep "desktop student surfaces"`：2 passed（含 auth setup；四張入口卡、標題不換行、排行榜／成就連結、詞表切換掣尺寸及 overflow assertion）。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=off npx playwright test tests/e2e/student-spacing.spec.ts --project=student-spacing-desktop --grep "dashboard spacing references"`：2 passed（含 auth setup；mobile／tablet／desktop screenshots）。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=off npx playwright test tests/e2e/student-spacing.spec.ts --project=student-spacing-desktop --grep "student page stacks"`：2 passed（含 auth setup；`/`、`/words`、`/stats` 於 320–1440px responsive stack／overflow regression）。
- rendered evidence：`output/playwright/phase3/home-spacing-desktop-1440x900.png` 已檢查，四張入口卡同一 desktop row 且標題保持單行。

未執行 native VoiceOver／TalkBack、完整跨裝置回歸及 study gesture suite，因本次只涉及學生端 desktop／responsive presentation，沒有改動學習行為、API 或資料。
