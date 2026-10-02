# 管理端／學生排行榜成就圖示及導覽修正計劃

> 狀態：已完成（瀏覽器 smoke 受本機 production rate-limit 設定阻擋）
>
> 建立日期：2026-08-15
>
> 範圍：管理員工作台概覽、用戶管理、單詞庫，以及學生排行榜／成就圖示

## 1. 背景及問題

- 管理員工作台用 `/admin` 父路徑做 prefix matching，令概覽在其他管理頁仍維持 active。
- 概覽角色分布使用相對比例條；學生數量較大時，教師及管理員視覺上幾乎消失。
- 管理概覽、用戶管理及單詞庫仍混用 emoji 與頁面內嵌 SVG，線條、尺寸及語義不一致。
- 學生排行榜／成就已有 reward SVG，但需要與同一套 EMM Style 02 icon token、容器及對齊規則一致。

## 2. 目標、非目標及成功準則

- 目標：只有目前 route 對應的管理導覽項目 active；概覽只在 `/admin` active。
- 目標：角色分布以三個等寬、可讀的角色指標呈現人數及百分比，不依賴看不見的細條段。
- 目標：管理端常用圖示全部使用共用 inline SVG icon component；學生排行榜／成就維持 reward icon 語義並統一線條與容器。
- 非目標：不修改 API、權限、角色資料、排行榜計算、成就解鎖、資料庫或學習流程。
- 成功準則：桌面及 mobile workspace active state 正確；管理頁無 emoji icon；角色三種數值在任何比例仍可讀；排行榜／成就圖示無水平溢出及視覺回歸。

## 3. 實施 checklist

### Phase 1：導覽及角色概覽

- [x] 修正 WorkspaceShell active route 判定，避免 `/admin`／`/teacher` 父路徑誤亮於子頁。
- [x] 將角色分布改為等寬 metric cards，保留總數及百分比，移除不可讀的比例條依賴。

### Phase 2：共用圖示及頁面替換

- [x] 擴充共用 `Icon` glyphs，覆蓋 users、user、shield、clock、plus、search、edit、trash 等管理端語義。
- [x] 替換管理概覽、用戶管理、單詞庫的 emoji 及頁面內嵌 SVG；保留 aria-label、hit target 及 hover／danger state。
- [x] 統一學生排行榜／成就 reward icon 的線條、display block、容器尺寸及對齊；不改 icon meaning 或資料。

### Phase 3：驗證

- [x] 新增 targeted route／icon geometry assertions，檢查 active state、emoji absence、role metrics 及 icon sizing。
- [x] 執行 lint、TypeScript、build；browser smoke 已加入測試但本機 `npm run start` 沒有分散式 login limiter 時 fail-closed，故未能完成登入後瀏覽器驗證。
- [x] 記錄未執行的高成本測試及 rollback 方法。

## 4. 風險及 rollback

- 風險：icon glyph 改動會影響共用元件；只新增明確 glyph，並保留既有 icon name 行為。
- 風險：角色比例極端時仍可能誤導；每張 metric card 同時顯示 count 及 percentage，數值不靠圖形面積閱讀。
- rollback：只回退 WorkspaceShell、AdminDashboard、admin user／word pages、Icon／RewardIcon、targeted tests 及本計劃文件；不涉及資料或 migration。

## 5. Definition of Done

- 管理員切換概覽、名單／用戶管理、單詞庫時 active highlight 唯一且正確。
- 角色分布三種角色均清楚可讀；管理端相關圖示不再出現 emoji 或風格分裂的 inline SVG。
- 學生排行榜及成就圖示與 EMM Style 02 線條／容器一致。
- Targeted assertions 已編寫；lint、typecheck、build 通過。需配置本機測試用 rate-limit backend 後再執行登入後 browser smoke／視覺檢查。

## 6. 實際驗證及限制

- `npm run lint`：通過。
- `npx tsc --noEmit`：通過。
- `npm run build`：通過（Turbopack production build）。
- `git diff --check`：通過。
- `npx playwright test ... --project=role-redirects --grep "admin workspace"`：未完成；本機 `npm run start` 在沒有 Upstash rate-limit backend 時對登入 fail-closed，測試帳號收到 60 秒 login limiter 拒絕。
- `student-spacing` reward icon smoke 同樣被 auth setup 的本機 login limiter 阻擋；未修改任何 limiter／資料庫設定。
- 如需重跑 browser smoke，先在 local browser-test runtime 配置測試用 shared rate-limit backend，或用開發模式 server，再執行新增的兩個 targeted tests。
