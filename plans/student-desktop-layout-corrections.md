# 學生端 Desktop Layout 修正計劃

> 狀態：已完成
>
> 建立日期：2026-08-15
>
> 範圍：學生端認字卡、桌面側欄、首頁快捷卡、單元闖關頁、統計頁入口

## 1. 背景及目標

根據學生測試帳號於 desktop viewport 的實際截圖及回饋，修正以下 presentation 問題：

- 認字卡揭示後的中文意思區塊必須在卡面內容軸上置中；
- desktop 左側 rail 的學生資料／帳戶控制必須固定於 viewport 左下，不因長頁內容推到頁尾；
- 單元闖關頁不可沿用 mobile 420px 窄欄，desktop 要使用寬版內容及多欄單元卡；
- 首頁「單元闖關」及「統計與成就」快捷卡要填滿同一 desktop grid row，避免高度失衡；
- 統計頁「排行榜／成就」入口要有足夠的字體、按鈕高度及視覺對比。

## 2. 非目標及不變條件

- 不修改 study session、long-press reveal、swipe／self-rating、queue、scoring、API、schema 或資料。
- 不改變 mobile 導覽、mobile 單元闖關單欄及既有 locale／theme 語義。
- 不新增 production config、migration 或部署操作。

## 3. 實施 checklist

### Phase 1：局部 layout 修正

- [x] 置中 `word-card-answer-definition`，保留 answer content、flip、drag 及 reduced-motion 結構。
- [x] 令 desktop `.student-rail` 以 viewport-height sticky rail 呈現，帳戶控制始終可見。
- [x] 將單元闖關頁 desktop 外框改為寬版，單元卡於中／大 desktop 使用 2／3 欄；mobile 保持原有單欄。
- [x] 令首頁下方快捷卡與詞庫進度卡同 row stretch，並提高快捷卡可用高度。
- [x] 提高統計頁排行榜／成就入口 desktop hit target、字體及對比。

### Phase 2：比例相稱驗證

- [x] `git diff --check`
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] 針對性 student desktop／visual smoke，確認 1440px 及 1024px layout、認字卡揭示、長頁 rail、units grid、stats links。

## 4. Definition of Done

- 認字卡中文意思置中，沒有左偏或內容軸錯位。
- desktop rail 左下帳戶控制固定可見，長頁捲動不影響。
- 單元闖關 desktop 使用寬版空間；首頁快捷卡高度協調；統計入口清晰可點。
- 既有 mobile、study gesture、locale/theme 及 accessibility 基本行為無回歸。
- 計劃記錄實際修改及測試結果。

## 5. 實際驗證紀錄（2026-08-15）

- `npm run lint`：passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：passed（Next.js production build，58 pages）。首次 sandbox build 因 Turbopack subprocess／port 權限失敗，escalated local retry passed。
- `git diff --check`：passed。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=off npx playwright test tests/e2e/student-spacing.spec.ts --project=student-spacing-desktop --grep "student page stacks|dashboard spacing"`：3 passed。
- 新增 desktop geometry smoke（rail sticky、首頁快捷卡高度、stats links、units 2／3 欄）：2 passed（含 auth setup）。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=all npx playwright test tests/e2e/study-stream-v2.spec.ts --project=study-stream-v2-chromium --grep "V2 gives a retrieval opportunity"`：2 passed（含 auth setup；揭示答案區置中 assertion passed）。
- visual evidence：`output/playwright/phase3/home-spacing-desktop-1440x900.png` 及既有 desktop study card screenshot 已檢查；desktop rail 帳戶控制可見，首頁快捷卡與進度卡同 row 拉齊。

## 6. 限制及 rollback

- 沒有做 VoiceOver／TalkBack 原生測試；今次只涉及 desktop presentation，既有 browser／axe／keyboard contract 未改動。
- 沒有修改 API、schema、migration、資料、production 或部署狀態。
- Rollback 只需回退本次 CSS、units markup、targeted test 及計劃文件改動。
