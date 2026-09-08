# 項目文件、目錄與學生交接整頓計劃

> 狀態：進行中（P1 文件入口）。
> 日期：2026-09-08。
> 現行及後續唯一開發主線：`codex/project-consolidation-and-student-handoff`（按本次使用者提供的審核前提）。
> 歷史盤點起點：`codex/student-leaderboard-motivation`／`b109fa7` 及當時工作樹。
> 審核及本次修訂起點：`f9ef66d39e7495eb7006d175cc98e09a5a9615c9`。
> 已確定方向：保留現行功能、只保留 V2、移除 V1 後備流程、中文維護文件統一繁體。
> 審視依據：[全庫維護報告](./artifacts/project-maintainability-audit-2026-09-08.md)。

## 1. 背景與目標

現有文件累積多輪設計與驗收，現況、規範、歷史和待辦交錯。根目錄入口包含過時分支、
舊 seed 說明及互相衝突的部署敘述；`output/` 與 `outputs/` 名稱相近但用途完全不同。
本計劃以文件與資料目錄整理為先，再清理 V1 和大型模組，令學生能按清楚路線繼續開發。

成功準則：新接手者能自行啟動、找到現行規範和程式入口、完成局部修改、選對測試；
不必先閱讀全部歷史計劃。不以刪檔數或減碼比例作硬性目標。

非目標：新增功能、改 V2 學習規則、改詞庫內容、重設現有示範資料庫、重寫技術棧、
發佈 production 或收集研究資料。
規劃交付不代表以下實施工作已完成。

本整頓不與舊 `main` 做功能整合，不恢復其架構或建立相容層。保留功能以現行開發主線
整頓開始時仍屬現行產品的功能為準，已決定退役的 V1 不在其內。
開發主線的決定不等於 GitHub default branch、ruleset 或部署 workflow 已同步改妥。
實施 P0 再固定當時完整 SHA、未提交差異清單／hash、資料 hash 及測試證據；
上述審核 SHA 不能冒充未來實施起點。本次已有排行榜未提交修改，須保留並記錄其差異，
獨立 clone 驗收不得偷偷依賴該修改或作者快取。

## 2. 本次已核對的目錄用途

| 現有位置 | 盤點結果 | 決定 |
|---|---|---|
| `output/` | 原有 103 個 tracked 檔案；101 個圖片及 2 份 Markdown，主要為 Playwright 歷史視覺證據 | 已移入 `plans/archive/evidence/playwright/`；未來測試輸出另放 ignored 目錄 |
| `outputs/` | 6 個 tracked 檔案：A1–B2 四份 CSV、identity JSON、initial-activation JSON | 全部屬目前 seed／驗證來源，保留，受控搬到 `data/catalog/` |
| `word list.md` | 歷史詞表，已不是目前 seed 來源 | 已移到 `docs/archive/word-list.md`，標明歷史來源，不放在新人入口 |
| `plans/` | 現行規範、計劃、審核日誌、證據混合 | 索引先分區，再逐批移走已完成／已取代計劃 |
| `.github/` | CI 和發佈 workflows | 保留，隨指令／路徑變更更新 |
| `.next/`、`src/generated/`、`node_modules/`、`*.tsbuildinfo` | 工具生成／安裝內容 | 繼續忽略，不手工重構；不為美觀刪除正在使用的快取 |
| `.env.local` | 本機設定 | 保持不提交；文件只列名稱和安全範例，不複製實值 |

### 正式詞庫搬移不是普通改名

`src/lib/catalog/seed.ts` 現在把檔案相對路徑納入 `sourceDigest`；
`src/lib/catalog/identity.ts` 把 `sourceFile` 納入 identity match key／fingerprint。
直接把 `outputs/` 改成 `data/` 並全庫替換字串，可能改變基線身份及啟用驗證結果。

搬移採最小的實體路徑與穩定來源名稱分離：四份來源以明確 mapping 指向新檔案位置，
解析與 digest 仍使用原有穩定來源名稱。不建立通用資源框架、不重新生成身份來遷就搬檔。
identity／activation manifest 內容保持原樣；資料中的歷史來源名稱屬識別資料，並非壞路徑。
如無法證明身份完全相同，該批停止搬移，先修正讀取設計，不 reset 資料庫。

影響位置至少包括 `seed.ts`、`identity.ts`、`initial-activation.ts`、
`scripts/rebuild-local-catalog.mjs`、identity builder／checker、相鄰測試及相關文件。
實施前再全庫搜尋，不把此清單當作完整 caller 證明。

### 截圖證據與測試暫存分離

`plans/archive/evidence/playwright/README.md` 明確把現有圖片列為保留的驗收證據；不可整個當快取刪除。
多個 `tests/e2e/*.spec.ts` 仍向 phase1／2／3／5／6 寫圖片，重跑會碰到 tracked 路徑。
將既有證據按原分組保留到 `plans/archive/evidence/playwright/`；新截圖寫至
`test-results/screenshots/`，只由明確挑選的驗收流程提升為 tracked 證據。

一併更新文件圖片連結、測試輸出位置、`.gitignore` 和 `scripts/check-roster-pii.mjs`
的掃描 roots。歷史 prototype 明確標為參考，不當成 V2 最新畫面規範。
只有確認不再有讀寫依賴後才移除空的 `output/`／`outputs/`；不採整個資料夾遞迴刪除。

## 3. 目標結構

```text
README.md                         新人總入口
AGENTS.md                         開發／AI 工作規則
DEPLOY.md                         唯一正式發佈與遷移指引
docs/
  current-product.md              現行功能、規範索引、已知限制
  architecture.md                 領域、路由、資料流、交易邊界
  development.md                  本地設定、demo、工具與環境
  testing.md                      改動與測試對照、fixture 使用方式
  archive/word-list.md            歷史詞表及來源說明
data/catalog/
  README.md                      正式資料用途、來源、識別及驗證方式
  a1-word-catalog-reference-v1/   原 CSV 檔名保留
  a2-word-catalog-reference-v1/
  b1-word-catalog-reference-v1/
  b2-word-catalog-reference-v1/
  catalog-identity/               原 identity／activation 檔名保留
plans/
  README.md                      現行規範／實施中／暫緩／歷史分區
  <現行規範與未完成計劃>.md
  archive/                       完成或被取代的計劃
    evidence/playwright/         不會被日常測試覆寫的歷史截圖
  artifacts/                     具日期與基線的審視／驗收報告
test-results/                    ignored，日常測試輸出
src/、tests/、scripts/、prisma/   保留原責任，後續按模組逐批整理
```

根目錄的 README／AGENTS／DEPLOY 保留熟悉名稱，不改成全中文檔名，不全部塞入 docs。
生效 contract 初期保留原址；只移動歷史計劃，避免同一時間大量改動規範引用。
不再維護另一份內容相同的總計劃或交接摘要。

## 4. 文件責任與更新內容

| 文件 | 唯一主要責任 | 要更新的內容 |
|---|---|---|
| `README.md` | 產品簡介與新人入口 | 撤下過時工作分支敘述；簡短啟動流程；連到四份指南；清楚寫實際實施狀態 |
| `AGENTS.md` | 如何安全地改這個項目 | 移除保留 V1 的舊要求；縮減重複產品敘述；按任務選讀；保留交易、認證、資料及驗證規則 |
| `DEPLOY.md` | 正式發佈／migration | 全文繁體；正式 workflow 在前，初次平台設定在後；刪過時 push 自動正式部署說法；核對每個指令 |
| `docs/current-product.md` | 現行行為與規範入口 | 學生／教師／管理員、詞庫、報表、排行榜；區分當前實作與已決定未實施的 V1 退役 |
| `docs/architecture.md` | 學生如何找到程式 | UI→API→service→transaction→DB 圖；每領域主要入口及不可跨越邊界 |
| `docs/development.md` | 可重現的本地開發 | CI 採用的 Node 版本、env 名稱、DB／seed／demo、Windows 指令、連結原 demo 手冊 |
| `docs/testing.md` | 如何證明改動正確 | 快速／DB／browser 層次；副作用與 fixture 範圍；改子目錄同步 test globs |
| `plans/README.md` | 工作與歷史索引 | 規範、未完成、暫緩、歷史分區；本地完成與外部 gates 分開，不根據舊 PASS 自動結案 |
| `plans/project-plan.md` | 願景與研究路線 | 去掉重複現況和多輪 implementation 日誌；歷史移到 archive，現況以連結帶入 |
| `.env.example`、`.gitignore`、設定檔註解 | 就地操作說明 | 中文註解繁體化；值、名稱及實際設定另按影響評估，不和翻譯混改 |

歷史文件保留日期、決策、原驗收結果和未執行項目。可精簡入口及歸檔，不抹掉歷史。
部署文件更新只核對本地 workflow 與指令；未核對遠端平台設定時明確注明，不暗示已發佈。

## 5. 開發指引與個人環境的界線

- 項目必要規則集中在根目錄 AGENTS；子目錄只有確實需要額外規則才新增指引。
- 將目前機器的 Git Bash／Playwright 經驗保留為 Windows 說明，避免當成所有學生的固定絕對路徑。
- 清楚列出必要開發工具與安裝步驟，讓學生可在自己的電腦重現一般 npm 開發及測試。
- 舊個人機器路徑只可作有日期的歷史來源，現行操作說明使用相對路徑或可設定的範例。

## 6. 繁體中文統一規則

所有供開發者閱讀、可維護的中文敘述統一繁體中文，以香港常用語為基準：
檔案、資料夾、帳戶、登入、載入、設定、發佈、干擾項。
先做根目錄及現行指南，再做現行計劃、歷史說明、腳本／設定／程式註解；英文技術名稱可保留。

不可對整個 repository 做無差別 OpenCC 覆寫。轉換只產生候選 diff，再人工核對語意及格式。
特別檢查「干／乾／幹」、「余／餘」、姓名、專有名詞及程式碼區塊。
保留產品現有繁簡切換；把維護文件改成繁體不等於刪除 `zh-Hans` 功能。

以下不是可任意翻譯的敘述：env 名稱、API 路徑、enum、JSON keys、policy identifiers、
hash／簽章資料、CSV／manifest、測試中的簡體輸入／預期輸出及原始錯誤樣本。
已套用 migration 連註解也不改，以免破壞 checksum。歷史詞表作原始資料保留，不偷偷轉字改內容；
其標題／導讀用繁體。歷史截圖不修圖，另附繁體說明。
例外須按用途列明，不用大範圍忽略來掩蓋未完成翻譯。

參照[既有繁體原文計劃](./traditional-chinese-source-copy-baseline.md)，
產品文案原有保護保持有效；本計劃新增文件及註解範圍，不覆寫其資料完整性要求。

## 7. 分階段 checklist

### P0：固定清單及搬移規則

- [x] 核對兩個 output 目錄的實際檔案、tracked 狀態與主要 callers。
- [x] 核對根目錄文件，以及詞庫路徑參與 digest 的事實。
- [x] 建立本計劃及索引，記錄只保留 V2 和繁體文件方向。
- [x] 分清歷史盤點與現行開發主線，記錄本次審核完整 SHA；不加入舊 main 整合工作。
- [x] 固定實施前 commit、工作樹差異 hash、資料目錄 inventory 及基本測試結果（見第 10 節）。

### P1：建立可信的閱讀入口

- [x] 更新 README／AGENTS／DEPLOY，建立四份短指南；正文不再重複多輪歷史。
- [ ] 索引按現行／未完成／暫緩／歷史分區，逐項核對過時狀態。
- [x] 根目錄、現行指南及設定說明繁體化；V1 明確標為待退役直至實作完成。
- [x] 先加入離線本地 Markdown 路徑／anchor 檢查，再開始搬檔；不以 `|| true` 吞掉內部連結錯誤。
- [ ] 完成第 8.1 節第一次 clean-clone 演練並修正文檔卡點；未完成獨立接手演練，不把 P1 標為完成。

### P2：歷史文件與視覺證據歸位

- [ ] 依搬移表逐批歸檔已完成／已取代計劃，保留決策與驗收證據；更新相對連結。
- [x] 將歷史詞表歸檔並標明非正式來源；檢查 Markdown 程式碼中的路徑提示。
- [x] 搬移保留截圖；新測試輸出改用 ignored 路徑，更新 PII scanner 和生成者。
- [ ] 歷史中文說明繁體化；核對日期、數字、勾選狀態及引文不被改意。

### P3：正式詞庫目錄整理

- [x] 以最小明確 mapping 分開檔案位置與穩定來源名稱，更新所有讀取工具。
- [x] 搬六份資料到 `data/catalog/`，保留檔名及內容 bytes，加入用途 README。
- [x] 以六份檔案的 Git blob hash 及 frozen baseline unit test 證明 source bytes、sourceDigest、
  identity assignment 及 ACTIVE／DRAFT selection digest 的 source-layer 結果沒有改變。
- [ ] 證明前後 sourceDigest、identity fingerprints、sense keys、ACTIVE／DRAFT 集合一致。
- [ ] 在全新隔離測試庫驗證 seed／重跑與正式 reader；不寫入現有 demo 庫。
- [ ] 執行第 8.2 節已有合成歷史資料庫回歸：不用 reseed 就能直接讀取，身份／歷史／狀態／報表一致。
- [ ] 在另外的 fixture 副本做舊／新版本同輸入 seed 差異回歸，區分既有 seed 副作用與搬移引入的差異。
- [ ] 全庫讀寫路徑檢查通過，才移除空舊目錄；識別資料中的舊來源名稱列為有意保留。

### P4：V1 退役與舊碼清理

- [ ] 盤點 V1 UI／API／queue／session／outbox／設定及測試，區分 V2 共用依賴。
- [ ] 開始刪碼前，補齊第 8.3／8.4 節每列的實際入口、測試名稱及驗收指令；沒有未分類案例才開始退役。
- [ ] 移除 V1 執行分支，統一 V2；舊請求明確拒絕，舊待同步資料有明確處理而不重開 V1。
- [ ] 移除後備切換、V1 專用 CI 和文件；保留 V2 現行 policy、歷史資料解讀與可靠性。
- [ ] 驗證六個零產品引用候選後分批清理；測試保障先移植到現行實作。
- [ ] V2 DB／browser／角色與兩種 locale 回歸通過，才把現況文件寫成已完成 V1 退役。
- [ ] 每項舊 assertion 都有保留、移植或附理由退役的對應；不能按 `off` 指令整組刪除有效保障。

### P5：模組重構與交接驗收

前置條件：P4 退役矩陣及測試移植已驗收，V2 回歸無未解釋失敗。

- [ ] 按 catalog → 共用純 helpers → V2 server 次序，每批只拆一種責任，保留 transaction ownership。
- [ ] 合併確定重複的報表日期及 actor reader，保持不同歷史計分政策分離。
- [ ] 更新架構圖及測試入口，移動測試時核對明確 globs，不產生漏跑。
- [ ] 新接手者按文件完成啟動、局部改動、測試與說明；記錄真實卡點再修文件。
- [ ] 記錄每階段實際驗證、未完成／未執行項目、已知限制及外部 gates；完成後才結案。

每階段可拆成少量獨立 commit；一份主計劃管理全程，不為每次字句修正另寫一份計劃。

主線治理列為交接設定：依第 8.6 節核對 CI triggers、required checks、default branch 與發佈限制，
不以舊 main 合併作解法，也不把尚未核實的遠端設定記為完成。

## 8. 測試矩陣、風險及回退

| 改動 | 必要驗證 | 主要風險與控制 |
|---|---|---|
| 文件翻譯／歸檔 | 內部路徑與 anchors、Markdown、繁體候選人工覆核、diff check | 不變更技術值、歷史日期與驗收狀態 |
| 截圖目錄 | 原檔 hash、引用檢查、針對性 screenshot run、scanner roots | 重跑不覆寫 tracked 證據；舊原型不冒充最新基線 |
| 詞庫來源搬移 | bytes/hash、sourceDigest、identity／activation 相等測試、fresh DB 及 existing DB 回歸 | 防止改路徑變成新身份、重建詞義或改啟用集合；不可只證明重新 seed 成功 |
| V1 退役 | unit／lint／typecheck／build、V2 DB／browser、cutover／測試移植矩陣逐列驗收 | 不刪仍被 V2 使用的 helpers；不把 `retrieval-v1` 當 V1 流程 |
| V2／catalog 重構 | 對應 unit／DB／browser、UI locale／theme／focus | 不改交易範圍、冪等、憑證恢復、審批與報表語義 |
| CI／production 設定 | 核對 workflow、`check:production-config` 及相關 guards | 不聲稱遠端已配置／部署，不因退役 V1 放鬆角色與認證 |

資料路徑改動與 V1 退役分開提交；文件搬移與翻譯亦分批，便於追蹤。
一般整理按 Git commit 回退，與保留 V1 後備產品流程無關。
本計劃優先不改 DB schema；若退役確需 schema contract／刪資料，先補具體資料清單及驗收方案，
不把破壞性 cleanup 混入純文件整理。已套用 migrations 保持不變。
production 發佈、實體裝置／完整 screen-reader matrix、研究 gates 保持分開，未驗不勾選。

### 8.1 P1 提前進行的獨立交接演練

使用已提交 SHA 的乾淨 clone、全新安裝依賴及獨立本地資料庫；只讀 README、development、
current-product、architecture、testing，依序完成安裝、按模板設定、啟動、登入測試帳戶、
找到簡單元件、做可撤回的局部顯示修改、執行對應驗證，再解釋修改入口。
不複製作者 `.env.local`、`node_modules`、`.next`、未提交檔案或手工建好的資料。
密鑰由演練者依文件本機產生，不記入證據；記錄 SHA、工具版本、指令、結果與閱讀卡點。

自動 clean-clone smoke 可以先行，但不能冒稱真人接手驗收。沒有獨立接手者時標明待演練，
保留 P1 此項未完成；可先進行不依賴真人回饋的已授權工作。P5 再做完整結案演練，
確認整理後仍能獨立工作，不能用 P1 的舊紀錄替代。

### 8.2 P3 已有資料庫回歸

P3 開始前固定實際搬移前 SHA，用可重現的合成 fixture 建立已有資料庫：包括 approved revision、
尚未批准的 DRAFT、RETIRED、教師審核／歷史、學習記錄、objective evidence，
以及排行榜／analytics 能讀取的資料。固定 cutoff、時區、policy、角色和查詢範圍。
暫停背景模擬／其他 writer，取得可還原的隔離測試快照；不使用真實學生或現有 demo DB。

| 驗收 | 步驟 | 必須相等的證據 |
|---|---|---|
| 已有資料直接可用 | 舊路徑程式建立 fixture → 同一 DB 改用新路徑程式 → 啟動與正式 reader，完全不 reseed | sense ID／key、approved revision ID／數量、history、ACTIVE／DRAFT／RETIRED 集合、Review／evidence 外鍵與數量 |
| 查詢行為 | 前後用相同身份、日期、cutoff、policy 及 filters 查詢 | catalog reader、排行榜／analytics 業務結果一致；僅排除事前列明的非業務生成時間等欄位 |
| 重跑 seed 的差異 | 將同一快照還原到兩個隔離副本，各用舊／新程式相同輸入 seed，再比較 | 新路徑不新增舊版沒有的身份／revision／狀態／歷史／報表變化 |

重跑 seed 不是純 reader：現行 `seed.ts` 有 upsert、revision 關聯更新、DRAFT 啟用及 audit 寫入。
因此不假設任何 seed 都零副作用，亦不因舊版同樣改資料就掩蓋問題。
若只有 reseed／reset 後 reader 才能工作，或新版本額外改變身份與歷史，P3 不通過；
若發現既有 seed 不適合已有庫，記錄並限制用途，另立修正決策，不擴成這次搬檔的隱性資料修復。

### 8.3 P4 切換行為矩陣

此表定義目標行為；P4 刪碼前補齊具體 route／storage key、響應 contract、測試案例及執行結果。
退役處理只負責停止舊請求及提示，不構成另一套 V1 學習引擎。

| 情況 | 退役後行為 | 驗收重點 |
|---|---|---|
| 新／已有學生進入 `/study` | 經現有認證授權直接 V2 | 無 assignment fallback 可重新啟動 V1 |
| 舊 V1 分頁仍開着 | 舊 action 端點明確拒絕且無寫入，提示重新載入；核對已發出的舊 client 能理解的回應，必要時保留最小拒絕端點 | 實際舊 build 開頁後切換 server 測試，不能只測新 client |
| V1 queue 尚未送出 | 不轉成 V2 action／evidence；舊 namespace 停用，需有明確提示及限定清理規則 | 不將未知結果說成已同步，不清到 V2 namespace |
| Server 已提交，browser 未收回應 | 不重送評分；既有 ledger／receipt 保留，不偽造新成功結果 | 中斷回應後重試，ReviewEvent／Review 不重複改動 |
| 舊 V1 request 在切換時仍在執行 | 以明確 cutover barrier 等待／中止舊 writer，才驗收新行為 | 以延遲 transaction 測 race；barrier 後無舊 writer 新增學習結果 |
| V2 outbox／checkpoint | 正常切換完整保留，pending 可繼續排空與續接 | 不因移除 V1 cleanup import 而誤刪 V2；refresh／離線／多分頁驗證 |
| V2 credential／receipt／recovery | 保持原過期恢復、撤銷拒絕及首次結果唯一 | expired／revoked／duplicate／reconcile 測試通過 |
| 登出／停權清理 | 保持現有 account-scoped 清理與跨帳戶隔離 | `clearStudyClientState`／`clearAllStudyClientState` 仍按認證邊界清理 V2；正常切換不可借用全清理 |
| V1 歷史 DB rows／indexes | 歷史可解讀；僅支援資料完整性的欄位不等同執行流程 | inventory 分清歷史完整性與已退休 writer；保留 V2 provenance／identity 保護 |
| V1-only env／CI／browser cases | 移除切換與退休行為案例；有效保障先移植 | 第 8.4 節逐項對應，不按 `v1`／`off` 字串批量刪除 |

切換期間已送出但未確認的 V1 操作不得自動宣稱成功，也不得當作 V2 objective 重新評分。
舊 client 的支援能力及 cutover barrier 實作在 P4 前鎖定；不能以「反正會 reload」代替測試。

### 8.4 P4 測試移植矩陣

以下為已找到的來源分組；實施前展開至每個 test title／assertion，填寫處置、目標檔案、
Playwright project／npm command 和結果。不預先把整份 spec 判為可刪除。

| 來源 | 必須保留／移植的保障 | 退役界線 |
|---|---|---|
| `test:e2e:student-ia`：student shell、role redirects、locale、study navigation | 導覽、角色跳轉、兩種 locale、離開頁面與 mobile 入口，改以 V2 執行 | V1 quiz 階段或固定完成頁的專用預期另列退役，不保留其產品語義 |
| `test:e2e:student-qa`：student final QA、action／card fidelity | keyboard、skip link、focus、dialog、logout、responsive、theme、實際 V2 卡片行為 | 舊 prototype 文案／布局不覆蓋 V2 現況；仍有用的 a11y 斷言移植 |
| `test:e2e:card-motion`：release／fixture／study workflow | mouse、touch、synthetic pointer、共用 WordCard motion、登入後 V2 流程 | V1 計分與完成節奏退役；共用 motion 仍驗收 |
| `test:browser:outbox` 及相關 queue／checkpoint tests | 先區分 storage 實作；V2 排空、故障保留、多分頁與帳戶隔離有直接測試 | V1 引擎退休案例可刪；不得把僅測 V1 的通過結果當成 V2 覆蓋 |
| `test:e2e:study-stream-v2`／`test:db:stream-v2` | 原有首答、receipt、CAS、過期／撤銷、feedback 恢復全保留，補 cutover 邊界 | 移除分流設定依賴，不減少核心安全斷言 |
| credential compatibility inventory／production verification | V2 identity index、receipt／provenance gap，及保留歷史資料的完整性 | 舊 writer 必須繼續可用的要求退役，不按檔名整支刪除 |

完成條件：舊測試清單每列都有 disposition、目標與理由；有效斷言已在 V2 執行通過，
無測試只因改了目錄／project／glob 而消失。以 test discovery 清單和實際執行結果核對，
不以「總測試數下降是正常」代替逐項說明。

### 8.5 開發、測試與 demo 三種資料庫用途

| 用途 | 資料生命週期 | 可執行操作 |
|---|---|---|
| Development DB | 保留人工開發及示範狀態 | 日常 app；有明確目標才做增量操作，不用 reset 排查普通故障 |
| Disposable test DB | 專供回歸，可重現、可還原 | DB／migration／browser checks，P3 existing-history fixture 亦放此類隔離庫 |
| Demo reset DB | 專供重新產生虛構學校 | 只有確定此用途與目標時才 `demo:init --confirm-reset`，不拿一般開發庫代替 |

指南列明 env 模板、目標 database／schema、持久環境 marker 和確認方式；不記憑證實值。
每個 writer／測試開始前核對連線目標，不能只見 `localhost` 就假定安全，三種用途不能共用可破壞資料。

### 8.6 主線治理與 CI 設定

本地可證實 `card-motion.yml` 有 `Required quality gate`，依賴 dependency audit 與整個 quality matrix，
會在非 success 結果失敗。其 push trigger 沒有限定分支，但 pull_request 目前只列 main／staging；
另外多份獨立 workflow 仍只針對 main，production workflow 仍驗證 exact current main commit。
因此「開發主線改為本分支」後必須另核對 triggers，不能只更新 README。

- [ ] 核對及更新本地主線相關 CI triggers，使新主線 PR 有完整必需 checks，不需合回舊 main。
- [ ] 讀取 GitHub default branch／ruleset／required checks 的實際值，保存日期與可核對結果。
- [ ] 主線保護納入 `Required quality gate` 或等價完整 gate，確認失敗確實阻止受保護整合；
  檢查 skip／cancel／bypass 行為，不單看 CI 有執行。
- [ ] 列明所需遠端設定差異再按授權套用；本次不更改 default branch／ruleset 或發佈。
- [ ] 在正式發布準備階段把 exact-SHA gate 對準已確認主線，保持先驗證／migration 後部署。

附件提到遠端 required checks 缺少完整 gate，本次未重新取得遠端證據，僅列為待核實發現。
此治理項不是 P1／P2 開始的阻礙；未完成時不可聲稱已交付受保護主線，也不自動放鬆部署限制。

## 9. Definition of Done

- 所有新人入口指向本整頓分支這一條現行開發基線，歷史 SHA 與實施前 SHA 分清。
- 根目錄三份指引分工明確，現況與程式一致，學生不需要閱讀歷史全集。
- 可維護中文文件及說明使用繁體，資料／測試／migration 的必要例外有明確用途。
- 正式資料、歷史證據及暫存只有各自清楚的位置；測試不污染 tracked 截圖。
- 詞庫移動前後身份、digest 和正式啟用集合一致，既有示範資料未被重設。
- 已有合成 catalog／學習歷史的隔離 DB 不需重建即可使用新程式，history／RETIRED／報表亦一致。
- 學習產品只保留 V2；V1 專用碼、切換與維護要求均退出，現行功能驗收通過。
- V1 cutover／測試移植矩陣逐項閉合，舊請求不能重開流程或重複評分，V2 outbox／receipt／recovery 不受損。
- 本地啟動、測試、工具說明可供學生在自己的電腦重現；沒有無用途的新指導文件。
- P1 首次及結案的獨立 clean-clone 演練完成，不依賴作者路徑、快取、未提交檔、手工資料、隱藏 env 或 shell history。
- 所有勾選有當次可查證結果；未執行驗收及 external gates 另列。

## 10. 實施紀錄

已完成只讀目錄、caller、文件和詞庫身份邏輯核對，新增本計劃與索引；審核跟進已納入 Revision 2。
整頓開始前固定 commit `cfcf7170acccb3d9e26ad1298d1db07fa1e7d5b5`，
工作樹有一項未提交 `src/app/(student)/leaderboard/page.tsx`，其 binary diff SHA-256 為
`ee17953d6349470b3e2a21de07c11b1b2db083ce524b5e888206ed0b309ef3eb`；整頓提交不包含它。
開始 P1 文件入口實作後，新增 `docs/current-product.md`、`docs/architecture.md`、
`docs/development.md`、`docs/testing.md`，更新 README／AGENTS／DEPLOY／`.env.example`，
加入 `scripts/check-markdown-links.mjs` 並接入 Markdown workflow；快速閱讀分區已加入，
完整索引的逐項狀態覆核及 clean-clone 演練仍未完成。
P3 詞庫來源已按明確 mapping 搬到 `data/catalog/`，新增用途 README；資料 row 的 `outputs/...`
穩定識別名及 digest 計算保持不變。六份檔案與實施前 Git blob hash 全部相等，source-layer
baseline test 通過；existing／fresh DB 回歸仍待隔離資料庫驗證。
P2 已把歷史 `word list.md` 原 bytes 搬到 `docs/archive/word-list.md`，Git blob hash
`cb02172639517f91b79f1c960a3bb6a0b22ec6c0` 保持不變；根目錄已不再放置該歷史詞表。
P2 亦已把 101 張 screenshot 及 `phase6/visual-qa.md` 搬到
`plans/archive/evidence/playwright/`；102 份非 README 證據逐一對比實施前 Git blob hash 全部相等。
五個 Playwright 生成者改寫到 ignored `test-results/screenshots/`，PII scanner 已更新，兩個空舊目錄
在確認無檔案及無讀寫引用後移除。
本次檔案／計劃驗證：`npm test` 429 passed、`npm run lint` passed、
`npx tsc --noEmit --incremental false` passed、`npm run check:markdown-links` passed（64 files）、
`git diff --check` passed。未執行 production build、DB／migration、完整 browser、native device 或 performance suites。
自動 clean-clone 已建立並通過 clone 及 Markdown 檢查；`npm ci` 兩次均受本機 Windows npm cache／npm
自身 `EPERM`／`Exit handler never called` 阻擋，未把依賴未安裝造成的測試錯誤當成產品失敗；P1 clean-clone
仍待在可用 Node／npm 環境完成。

### Revision 2：2026-09-08 審核跟進

來源：使用者提供的《English 項目整頓與學生交接計劃審核報告》，審核對象 SHA 為上述 `f9ef66d`。
審核判斷為方向通過；本修訂補足規劃條件，不代表審核者或本次已執行驗收。

| 審核意見 | 處理結果 | 後續驗收 |
|---|---|---|
| 明確 canonical baseline | 採納；標頭／第 1 節／P0 區分主線、歷史盤點、審核及實施起點 | P0 固定當次 SHA／工作樹差異與證據 |
| 交接演練提前 | 採納；P1 加入第 8.1 節，P5 保留結案演練 | 真正獨立演練未執行，不提前勾選 |
| P3 existing-DB regression | 採納並細分直接 reader 與 seed 差異回歸，見第 8.2 節 | fresh／existing／reseed 三路各有證據 |
| P4 cutover／test migration matrix | 採納；第 8.3／8.4 節列出行為、來源與刪碼前條件 | 實施前補逐測試對應，之後逐列執行 |
| 主線 required quality gate | 採納作治理待辦；本地 trigger／gate 已核對，遠端 ruleset 敘述未重新核實 | 第 8.6 節讀取與設定驗證，非舊 main 整合 |
| DB 用途分離 | 採納；第 8.5 節明確三類環境，不把 demo reset 當排錯方式 | P1 指南及 P3–P5 執行時落實 |
| 限制 P5 範圍及四項 DoD | 保留不重寫策略，新增上述 DoD；P5 以 P4 已驗收為前置 | 每批測試與最終獨立交接 |

本次僅修改計劃、索引及舊審視的後續指向。已核對本地 cleanup、seed、測試指令及 CI gate；
未執行 P1–P5、未讀遠端 ruleset、未改資料庫或產品程式，原排行榜修改保留。
本次文件驗證：三份修改文件的本地 Markdown 目標檢查通過、六個新增驗收章節及七項跟進記錄已核對、
`git diff --check` 通過；純計劃修訂未重跑 unit／build／DB／browser suites。
