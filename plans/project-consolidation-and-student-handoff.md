# 項目文件、目錄與學生交接整頓計劃

> 狀態：規劃完成，實施待開始。
> 日期：2026-09-08。
> 基線：`codex/student-leaderboard-motivation`，HEAD `b109fa7` 及既有工作樹。
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

## 2. 本次已核對的目錄用途

| 現有位置 | 盤點結果 | 決定 |
|---|---|---|
| `output/` | 103 個檔案，全部 tracked；101 個圖片及 2 份 Markdown，主要為 Playwright 歷史視覺證據 | 保留有來源的證據，移入歷史證據區；未來測試輸出另放 ignored 目錄 |
| `outputs/` | 6 個 tracked 檔案：A1–B2 四份 CSV、identity JSON、initial-activation JSON | 全部屬目前 seed／驗證來源，保留，受控搬到 `data/catalog/` |
| `word list.md` | 歷史詞表，已不是目前 seed 來源 | 移到 `docs/archive/word-list.md`，標明歷史來源，不放在新人入口 |
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

`output/playwright/README.md` 明確把現有圖片列為保留的驗收證據；不可整個當快取刪除。
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
- [ ] 實施前固定當時 commit／工作樹、完整檔案搬移表、資料 hash 及現有測試結果。

### P1：建立可信的閱讀入口

- [ ] 更新 README／AGENTS／DEPLOY，建立四份短指南；正文不再重複多輪歷史。
- [ ] 索引按現行／未完成／暫緩／歷史分區，逐項核對過時狀態。
- [ ] 根目錄、現行指南及設定說明繁體化；V1 明確標為待退役直至實作完成。
- [ ] 先加入離線本地 Markdown 路徑／anchor 檢查，再開始搬檔；不以 `|| true` 吞掉內部連結錯誤。

### P2：歷史文件與視覺證據歸位

- [ ] 依搬移表逐批歸檔已完成／已取代計劃，保留決策與驗收證據；更新相對連結。
- [ ] 將歷史詞表歸檔並標明非正式來源；檢查 Markdown 程式碼中的路徑提示。
- [ ] 搬移保留截圖；新測試輸出改用 ignored 路徑，更新 PII scanner 和生成者。
- [ ] 歷史中文說明繁體化；核對日期、數字、勾選狀態及引文不被改意。

### P3：正式詞庫目錄整理

- [ ] 以最小明確 mapping 分開檔案位置與穩定來源名稱，更新所有讀取工具。
- [ ] 搬六份資料到 `data/catalog/`，保留檔名及內容 bytes，加入用途 README。
- [ ] 證明前後 sourceDigest、identity fingerprints、sense keys、ACTIVE／DRAFT 集合一致。
- [ ] 在指定隔離測試庫驗證 seed／重跑與正式 reader；不寫入現有 demo 庫。
- [ ] 全庫讀寫路徑檢查通過，才移除空舊目錄；識別資料中的舊來源名稱列為有意保留。

### P4：V1 退役與舊碼清理

- [ ] 盤點 V1 UI／API／queue／session／outbox／設定及測試，區分 V2 共用依賴。
- [ ] 移除 V1 執行分支，統一 V2；舊請求明確拒絕，舊待同步資料有明確處理而不重開 V1。
- [ ] 移除後備切換、V1 專用 CI 和文件；保留 V2 現行 policy、歷史資料解讀與可靠性。
- [ ] 驗證六個零產品引用候選後分批清理；測試保障先移植到現行實作。
- [ ] V2 DB／browser／角色與兩種 locale 回歸通過，才把現況文件寫成已完成 V1 退役。

### P5：模組重構與交接驗收

- [ ] 先拆 catalog 表單／預檢／列表／審核責任，再整理 V2 server 純 helpers／transaction handlers。
- [ ] 合併確定重複的報表日期及 actor reader，保持不同歷史計分政策分離。
- [ ] 更新架構圖及測試入口，移動測試時核對明確 globs，不產生漏跑。
- [ ] 新接手者按文件完成啟動、局部改動、測試與說明；記錄真實卡點再修文件。
- [ ] 記錄每階段實際驗證、未完成／未執行項目、已知限制及外部 gates；完成後才結案。

每階段可拆成少量獨立 commit；一份主計劃管理全程，不為每次字句修正另寫一份計劃。

## 8. 測試矩陣、風險及回退

| 改動 | 必要驗證 | 主要風險與控制 |
|---|---|---|
| 文件翻譯／歸檔 | 內部路徑與 anchors、Markdown、繁體候選人工覆核、diff check | 不變更技術值、歷史日期與驗收狀態 |
| 截圖目錄 | 原檔 hash、引用檢查、針對性 screenshot run、scanner roots | 重跑不覆寫 tracked 證據；舊原型不冒充最新基線 |
| 詞庫來源搬移 | bytes/hash、sourceDigest、identity／activation 相等測試、隔離 DB seed | 防止改路徑變成新身份、重建詞義或改啟用集合 |
| V1 退役 | unit／lint／typecheck／build、V2 DB／browser、舊入口處理 | 不刪仍被 V2 使用的 helpers；不把 `retrieval-v1` 當 V1 流程 |
| V2／catalog 重構 | 對應 unit／DB／browser、UI locale／theme／focus | 不改交易範圍、冪等、憑證恢復、審批與報表語義 |
| CI／production 設定 | 核對 workflow、`check:production-config` 及相關 guards | 不聲稱遠端已配置／部署，不因退役 V1 放鬆角色與認證 |

資料路徑改動與 V1 退役分開提交；文件搬移與翻譯亦分批，便於追蹤。
一般整理按 Git commit 回退，與保留 V1 後備產品流程無關。
本計劃優先不改 DB schema；若退役確需 schema contract／刪資料，先補具體資料清單及驗收方案，
不把破壞性 cleanup 混入純文件整理。已套用 migrations 保持不變。
production 發佈、實體裝置／完整 screen-reader matrix、研究 gates 保持分開，未驗不勾選。

## 9. Definition of Done

- 根目錄三份指引分工明確，現況與程式一致，學生不需要閱讀歷史全集。
- 可維護中文文件及說明使用繁體，資料／測試／migration 的必要例外有明確用途。
- 正式資料、歷史證據及暫存只有各自清楚的位置；測試不污染 tracked 截圖。
- 詞庫移動前後身份、digest 和正式啟用集合一致，既有示範資料未被重設。
- 學習產品只保留 V2；V1 專用碼、切換與維護要求均退出，現行功能驗收通過。
- 本地啟動、測試、工具說明可供學生在自己的電腦重現；沒有無用途的新指導文件。
- 所有勾選有當次可查證結果；未執行驗收及 external gates 另列。

## 10. 本次規劃交付紀錄

已完成只讀目錄、caller、文件和詞庫身份邏輯核對，新增本計劃與索引。
本次未搬資料／截圖、未翻譯現有全庫、未刪 V1、未改設定或資料庫；不冒稱實施完成。
上輪審視已有 429 項 unit、lint、typecheck 通過，但只作其當時基線，不取代各實施階段驗證。
