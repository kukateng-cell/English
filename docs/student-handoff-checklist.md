# 學生交接收尾 Checklist

> 本文把「真實學生使用前」的三項收尾工作——全新電腦接手、舊資料相容、不同裝置核驗——
> 拆成可逐項執行的 checklist。依據 [`plans/project-consolidation-and-student-handoff.md`](../plans/project-consolidation-and-student-handoff.md)
> 第 8.1、8.2、8.3／8.4 節及 deferred gates 整理。
> 完成標準：只有每項都實際跑過、並留下可重現的驗證證據，才可勾選；不要把「已寫代碼」當成「已驗證」。

## 使用說明

- 三項可並行，各自獨立結案。
- 每完成一項，在對應計劃書記錄實際執行的指令、結果、未執行項目與已知限制。
- 演練中發現文件卡點或流程矛盾，先修文件，再重新演練；不以 `|| true` 掩蓋內部失敗。

## A. 全新電腦接手（clean-clone 接手演練）

目標：證明不是只有原作者才跑得起來。

- [ ] 用已提交 SHA 做乾淨 clone；**不複製**原作者的 `.env.local`、`node_modules`、`.next`、未提交檔案或手工建好的資料。
- [ ] 只讀 5 份文件完成全程：`README.md` → `docs/development.md` → `docs/current-product.md` → `docs/architecture.md` → `docs/testing.md`，中途不翻歷史計劃。
- [ ] 依 `docs/development.md` 安裝依賴：`npm ci`。
- [ ] 起本地 PostgreSQL：`docker compose up -d`。
- [ ] 依 `.env.example` 新建 `.env.local`：密鑰由演練者本機產生、不記入證據；`DATABASE_URL` 與 `MIGRATE_URL` 指向本地庫。
- [ ] 設定並確認資料庫環境 marker：`DATABASE_ENVIRONMENT` 與 `CONFIRM_DATABASE_ENVIRONMENT`。
- [ ] 套用 migrations 並匯入詞庫：`npm run db:deploy` → `npm run seed`。
- [ ] 啟動並登入：`npm run dev`，開啟 `/login` 用測試帳戶登入成功。
- [ ] 找到一處簡單元件，做一處**可撤回**的局部顯示修改（文案／顏色）。
- [ ] 執行對應驗證：`npm run lint`、`npx tsc --noEmit`、相關 `npm test`。
- [ ] 能口頭說明「改了哪裡、入口在哪、該跑哪條測試」。
- [ ] 記錄 SHA、Node／npm 版本、每步指令、結果與閱讀卡點；卡點回饋後修文件。
- [ ] 獨立接手者完成演練並確認可獨立工作；自動 clean-clone smoke 只作先行檢查，不算真人接手驗收。

**驗收**：一個沒接觸過專案的人，照文件能自行啟動、局部修改、選對測試，不用作者口述或依賴快取。

## B. 舊資料相容（existing-DB regression + 舊 client cutover barrier）

目標：證明升級後，學校已有的名冊、學習記錄、歷史與報表不用重灌、數字不變。

### B1 已有資料直接可用（P3 §8.2）

- [ ] 用可重現的合成 fixture 建立「已有資料」隔離測試庫：含 approved revision、DRAFT、RETIRED、教師審核／歷史、學習記錄、objective evidence，以及排行榜／analytics 能讀到的資料。
- [ ] 固定 cutoff、時區、policy、角色與查詢範圍；暫停背景模擬／其他 writer；留可還原快照。
- [ ] 舊路徑程式建庫 → 同一庫改用新路徑程式啟動與正式 reader，**完全不 reseed**。
- [ ] 比對一致：sense ID／key、approved revision ID／數量、history、ACTIVE／DRAFT／RETIRED 集合、Review／evidence 外鍵與數量。
- [ ] 查詢行為：前後用相同身份、日期、cutoff、policy、filters 查詢，catalog reader、排行榜／analytics 結果一致（僅排除事前列明的非業務生成時間欄位）。

### B2 重跑 seed 差異回歸

- [ ] 同一快照還原到兩個隔離副本，分別用舊／新程式相同輸入 seed，再比較。
- [ ] 確認新程式不新增舊版沒有的身份／revision／狀態／歷史／報表變化。

### B3 舊 client / cutover barrier（P4 §8.3／8.4）

- [ ] 盤點 V1 UI／API／queue／session／outbox／設定及測試，區分 V2 共用依賴。
- [ ] 逐列補齊 route／storage key、響應 contract、測試案例與驗收指令，才開始退役。
- [ ] 舊請求明確拒絕（authenticated 410 retirement barrier），舊待同步資料有明確處理而不重開 V1。
- [ ] 每項舊 assertion 都有保留、移植或附理由退役的對應。

**驗收**：升級後既有資料直接可用、無需 reseed；舊 client 得到明確指引而非靜默錯亂。

## C. 不同裝置核驗（native device / screen-reader matrix）

目標：證明不同裝置、不同能力的學生都能正常使用。

- [ ] iOS／Android 真機（或等價設備棧）跑通 V2 學習流：長按 3 秒揭示、swipe、自評、客觀測評、中斷續學。
- [ ] 完整 screen-reader 矩陣：VoiceOver、TalkBack、NVDA 走通學習、測評、導覽、報表匯出。
- [ ] 兩種 locale（簡／繁）× 明／暗主題逐項確認。
- [ ] 低端機性能：學習流、排行榜、報表回應達標。
- [ ] production observation 與 research consent 各自獨立 gate，不與其他項混驗。

**驗收**：不是只在桌面瀏覽器 OK，而是真實裝置與輔助技術都可用。

## 完成定義（Definition of Done）

- 三項各自有可重現證據（SHA、指令、結果、卡點紀錄）。
- 對應計劃書 checklist 勾選與證據一致；未執行／未完成項目明確標示。
- production deploy、真實學生 pilot、destructive migration 等仍需各自授權，不因本 checklist 完成而自動放行。
