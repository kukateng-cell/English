# 項目整理、重構與學生交接審視

日期：2026-09-08。類型：審視報告與建議；分析已完成，重構尚未實施。

審視對象：`codex/student-leaderboard-motivation`，HEAD `b109fa7`，以及當時工作樹。
已有未提交改動：`src/app/(student)/leaderboard/page.tsx`；本次保留原狀。
本報告不是新的產品規範、實施批准或 production 驗收。
以下程式路徑均相對 repository root，行數是本次快照，後續可能改變。

使用者其後明確決定：只保留現行 V2，不需要 V1 rollback。以下建議已按此更新，
原先「保留並隔離 V1」建議被取代。「保留功能」以現行 V2 及現行校務／詞庫功能為準，
不包括退役的 V1 體驗。程式尚未改動，現有文件中的 V1 規定亦列為後續同步更新範圍。

後續以[整頓主計劃 Revision 2](../project-consolidation-and-student-handoff.md)為實施依據：
目前整頓分支為唯一開發主線，並補入提前交接、已有資料庫回歸及 V1 切換／測試移植條件。
本報告的分支、行數及測試結果保留為原審視快照，不代表後續驗收已完成。

## 判斷

值得整理，而且文件入口應先於大型代碼重構。現有系統已有清楚的角色、學習證據、
詞庫治理與資料安全要求；不需要推倒重寫。主要維護負擔來自歷史與現况混在一起、
少數超大檔案、多項責任集中，以及少量已被取代的舊程式。

沒有證據支持「可以安全刪掉一半代碼」。把資料、測試和工具排除後，產品來源約六萬行。
初步找到約七百行可進一步確認刪除的產品候選；更大的收益是降低理解和改動成本，
未必表現為總行數大幅下降。保留必要測試、交易與現行資料完整性保護是交接品質的一部分。

## 範圍、方法與限制

- 盤點全部 Git tracked 路徑，按產品、測試、腳本、文件、schema 和資料分組。
- 閱讀 README、AGENTS、計劃索引、完整 V2 baseline、產品總計劃、contract 核心段落、
  部署指引與 workflows，並抽查近期詞庫、報表、排行榜及虛構學校相關實作／計劃。
- 以 TypeScript AST 掃描 `src` 非測試 TS／TSX 的靜態 imports、函數體重複及大型檔案，
  再用全庫文字搜尋區分產品 caller、測試 caller、腳本 caller 和 framework entrypoint。
- 深入抽查詞庫工作區、V1／V2 學習入口、V2 action transaction、報表及舊密碼重設模組。
- 執行單元測試、lint、typecheck 和本地 Markdown 檔案連結检查。

這是全庫結構盤點加重點代碼審讀，並非逐行完整安全／效能審計。
靜態零引用不等於已證明可刪除；dynamic import、工具讀檔、外部相容需求仍需在實施時核對。
未讀正式服務或真實學生資料，亦沒有根據歷史 PASS 推斷当前 production 狀態。

## 實際規模

初始盤點共 746 個 tracked files；以下為指定文字副檔名的實體行數，包含空行及註解，
以換行分割計數，尾端換行亦計一列。不是 executable SLOC，也不是 bundle 大小。
本報告及索引新增內容不計入快照。

| 類別 | 檔案 | 行數 | 解讀 |
|---|---:|---:|---|
| `src` 非測試來源 | 327 | 59,947 | 包含 TS、TSX、CSS 及型別等 |
| `src` 單元測試 | 89 | 8,791 | 功能保護，不能當冗餘直接刪除 |
| `tests` 瀏覽器測試 | 17 | 11,018 | 包含現有 gesture／workflow 驗收 |
| `scripts` 程式 | 52 | 11,983 | 驗證、fixture、seed、migration 工具 |
| `plans` 文件 | 48 | 16,280 | 現況、規範、計劃、歷史證據混合 |
| `prisma` 文字來源 | 72 | 6,624 | schema、seed、SQL 等 |
| `package-lock.json` | 1 | 12,502 | 依賴鎖定檔，非人工業務邏輯 |

另有 `data/catalog/catalog-identity/word-catalog-v1.identity.json` **56,418 行**（資料 row 內的穩定 `sourceFile` 仍以 `outputs/...` 表示），
屬詞庫 identity 資料；`docs/archive/word-list.md` **6,881 行**（原檔名 `word list.md`），屬歷史詞表。
不能把這兩項誤算成幾萬行產品邏輯。Identity／activation manifest 有正式 baseline 用途，
不能因放在 outputs 就當作可丟棄輸出。

目前 schema 有 **48 個 models**、**67 個一般 migration SQL**；另有獨立 contract migration。
共有 **27 個 page entrypoints**、**105 個 route handlers**。這已是有校務及詞庫治理功能的
完整應用，不能只按「翻一張字卡」估計所需代碼量。

## 文件發現

### D1：現況入口過時，接手者需要自行拼湊

README 開頭和 AGENTS 的基線仍指向 `codex/retrieval-first-learning-stream-v2`／`e43ed66`。
V2 baseline 自稱 2026-08-15 快照；近期排行榜、詞庫、教師報表、名冊與 demo 已繼續演進。
歷史快照本身有價值，但不應繼續被當成全產品最新入口。

建議：README 只保留產品摘要、啟動方式及閱讀路線；建立一份短的「全產品現況」入口，
注明核對日期與已驗證 commit，連到各領域現行規範。舊 V2 快照保留日期和範圍。
AGENTS 保留工作規則、禁止破壞的不變條件及按任務選讀的連結，不再重複完整產品歷史。

### D2：同一文件內已有可核對的現況落差

- AGENTS 的 `prisma/seed.ts` 說明和 `plans/project-plan.md` 第 114、285 行附近仍說由
  歷史 `word list.md` 匯入；實際 `prisma/seed.ts` 呼叫 `seedCatalog`，
  `src/lib/catalog/seed.ts` 第 31 行起列出四份 A1–B2 CSV。
- `project-plan.md` 不同段落出現 48、49、24 個 migrations 等歷史數字，現在一般 migrations 為 67；
  舊附錄甚至用「當前」描述 16 models。歷史數字應標日期，現況數字只保留一處或改為可產生的盤點。
- `DEPLOY.md` 前段寫 GitHub 每次 push 自動部署，後段第 242 行起要求關閉 main 自動正式部署，
  由手動 workflow 先 migration 再部署同一 checkout。應把正式 runbook 放前面，
  初次平台連接教學移後，避免形成兩種發佈理解；本次未核對遠端實際配置。

優先修正上述指引，因為它們比檔案數量更直接影響學生是否會做錯事。

### D3：索引存在，但狀態與歷史負擔過高

`plans/README.md` 已有索引及狀態定義，这是良好基礎。問題是列表把現行 contract、
已完成視覺修正、待驗收功能、external gates 和多輪 reviewer 日誌並列。
例如 teacher reward、admin analytics 仍標進行中／review 狀態，而相關後續功能已有完成記錄。
不能單靠此現象把它們勾為完成，應逐項核對餘下驗收，將「本地實作」與「外部發佈」分欄。

建議將索引分成：現行規範、正在處理的工作、暫緩／外部 gates、歷史已完成計劃。
完成計劃保留，可逐批移到 `plans/archive/`；每次搬移同步更新 backlinks，必要時舊址留下短導向。
不要把曾批准的決策或測試證據直接刪走，也不必第一天搬完所有文件。

### D4：新人啟動與資料來源缺少單一閱讀路線

README 尚未引導到 `scripts/DEMO-SCHOOL.md` 的新 demo 流程；目前機器的 port 3200、
舊固定 fixture 與新 566 人名冊的差別，要讀近期計劃才知道。
一般開發、互動測試帳戶、批量模擬帳戶亦應分清，因為新 demo 會拒絕覆寫手動學習造成的衝突。

建議以簡短 local development guide 說明：需要的 Node 版本、PostgreSQL、env 名稱、
migrate／seed 的順序、可選 demo、Windows Git Bash 測試路線及常見故障。
一般啟動不得隱式 reset 或更新 fixture；沿用既有 `dev`／`dev:demo` 分工。

### D5：連結可用，但 CI 不會阻止壞連結

本次基本掃描未發現 Markdown 相對檔案連結失效；未檢查 heading anchors 或外部 URL。
`.github/workflows/markdown-check.yml` 的 link-check 結尾有 `|| true`，失敗不會令 job 失敗。
文件搬移前應先加可離線、會失敗的 repository 內部連結檢查；外部網站可另作非阻斷檢查。

## 代碼發現與排序

### C1：詞庫工作區是最高價值的重構位置

`src/components/catalog/CatalogGovernanceWorkspace.tsx` 共 **3,971 行**。
`CatalogOverviewWorkspace` 由第 660 行開始，集中列表／分頁、選取、詳情、表單、
重複預檢、審核、retry conflict、匯出、focus 與 scroll 恢復。
檔案並非完全未拆：toolbar、results、history drawer、bulk workspace 已有獨立元件，應沿用。

建議依次抽出純表單正規化與 browser-safe DTO、詳情表單、審核面板，再處理 list query／
selection 與 precheck 的 hooks。由最少副作用的一部分開始，每步維持 props、狀態生命週期及 UI。
不要引入一套通用表單框架，或把全部狀態搬進另一個 3,000 行 hook。

驗收要覆蓋：輸入不丟失、filter／cursor／selection、返回 history 後 focus／scroll、
過期 precheck 不覆寫新表單、重送不重複提交、review freshness、全 `NO_CHANGE` retry closure。

### C2：退役 V1，學習入口只保留 V2

`src/app/(student)/study/page.tsx` **2,962 行**。`StudyFlowRouter` 在第 609 行，
按 server assignment 選 `StudyStreamV2` 或 `LegacyStudyPage`；後者由第 671 行開始。
大部分複雜度因此是仍保留的 V1 client，不應把整個檔案當成新的 V2 實作讀。

使用者已明確不需要 V1 rollback，因此應移除 V1 專用 UI、helpers、API、測試及切換設定，
不是搬進 legacy 資料夾繼續維護。學習頁直接組裝現行 V2。

實施先盤點呼叫鏈：`src/lib/study-stream/assignment.ts` 現在預設回 V1，
`src/app/api/study/stream/route.ts` 亦按 assignment 分流，不能只刪掉 `LegacyStudyPage`。
需一併整理 assignment endpoint／client、V1-only env、production config checks、CI 與文件，
讓已獲授權的學習入口一致使用 V2；認證與角色限制仍保留。這不代表現在執行 production 發佈。

V1 專用 queue／checkpoint／outbox／session helpers 逐項查證後刪除；V2 使用的共用
WordCard、session、receipt、credential、operationId 與恢復能力照常保留。
歷史資料中的版本／provenance 欄位與 V1 執行流程分開處理：移除舊流程不必同時刪歷史資料，
亦不能把 V2 仍使用的 `retrieval-v1` policy 名稱誤判成舊流程。
如有舊 session／待同步資料，明確定義退休後的拒絕或失效處理，不再重新開啟 V1。

這項退役可能比六個零引用候選減少更多代碼，但需要先完成共用依賴盤點才可量化；
不能把整個學習頁 2,962 行都算作可刪除，也不需要建立另一套 V1 相容機制。

### C3：V2 server 可以分責任，但不能拆散交易

`src/lib/study-stream/server.ts` **2,633 行**，包含 credential lineage、候選讀取、
題目建立、DTO、四種 action、receipt replay 與 recovery。
第 2279 行起的 action transaction 保持 user lock → receipt preflight → load item → action，
並以 Serializable transaction 和限定 retry 包住整體。

建議先抽純 parser／DTO／credential helpers，再拆候選讀取和 transaction 內 action handlers；
所有需要一致性的 helper 接受同一個 transaction client，由同一 service 擁有 commit。
不可改成數個各自提交的 service，亦不可合併 normal action 和 explicit recovery 的授權條件。
這是較高風險階段，安排在文件與低風險清理之後。

### C4：有具體零產品引用候選，先處理這些

靜態 imports 加 `src`／`scripts`／`tests` 文字交叉搜尋結果如下；數字不含對應測試。

| 候選 | 行數 | 觀察與刪除前條件 |
|---|---:|---|
| `src/components/admin/WordFormModal.tsx` | 253 | 未發現 caller；核對目前 catalog 入口和歷史工具引用 |
| `src/lib/teacher-reset-precondition.ts` | 187 | 只見舊專用測試引用；正式 teacher/admin routes 用 `password-reset-precondition` |
| `src/components/StudyStats.tsx` | 135 | 未發現 caller；核對首頁現行 dashboard |
| `src/lib/teacher-reset-limiter.ts` | 60 | 未發現 caller；正式 routes 用 `password-reset-limiter` |
| `src/components/NavTabs.tsx` | 51 | 未發現 caller；核對三種角色導覽 |
| `src/components/LanguageToggle.tsx` | 26 | 未發現 caller；語系能力本身仍要保留 |

這批約 **712 行**，是具體清理候選，不是已刪除成果。
舊 reset 的測試要先核對現行 audience、rotation、TTL、撤銷等測試是否涵蓋原保護，
再決定淘汰或移植斷言，不能只為令測試變綠而刪測試。

### C5：報表有可共用部分，也有必須分開的政策

`learning-reward-analytics.ts` **1,324 行**、`learning-analytics.ts` **915 行**。
AST 比對發現 `readRewardActor`／`readAnalyticsActor` 函數體相同，
`validDate` 和 `dateDistance` 亦相同。可先抽小型日期驗證和 actor reader，保留參數型別及原錯誤語義。
例如兩份相同 `validDate` 可改成同一 import，不需要建立通用 report engine。

不建議把報表分數、來源分類、歷史版本常數一律合併：reward 檔案第 36 行起明確註明
歷史 projection 故意固定支援的 policy literals，防止新學習政策改寫舊報表。
共用 plumbing 與保留 versioned policy 應分開判斷。

### C6：state-machine 測試與實際 UI 存在理解落差

`src/lib/learning-policy/state-machine.ts` 只由 `learning-policy.test.ts` 引用；
實際 `StudyStreamV2.tsx` 以自身 state、refs、callbacks 管理行為。
這不等於 UI 沒有其他測試，但該純函數 suite 不能被當作實際 UI state machine 的覆蓋證明。

建議先把它明確歸類為規範模型或歷史實驗；若保留，注明產品未使用。
若日後採 reducer 重構 UI，應由實際 UI 的行為案例建立測試，再決定是否重用模型；
不要為消除「unused」而強行接入一套較簡化的 state machine。

### C7：命名和領域分組應逐步整理

`roster-client.ts` 的 CSRF／timeout helpers 已用於 catalog 與 V2 study，名称範圍落後於用途。
`src/lib` 同時有平鋪的 roster／analytics／reward／reset 模組及已有良好分組的 catalog／study-stream。
建議先給共用 HTTP helpers 中性命名，再按實際領域逐批移動；初期保持 import re-export 相容亦可。
不要另建大量只有一個實作的 interfaces、repositories 或 factories。

`review-queue.ts`（1,792 行）、`submission-server.ts`（1,692 行）、`WordCard.tsx`（1,640 行）
亦列第二輪候選；目前未逐段證明可縮減多少，不能僅憑檔案長度宣稱過度設計。

### 精簡審核摘要

- delete: 舊 `WordFormModal`／`StudyStats`／`NavTabs`／`LanguageToggle`；確認無 caller 後不需替代。
- delete: 舊 teacher-only reset helpers；正式 routes 已有共用 password-reset 服務，先核對測試保障。
- shrink: 兩套 analytics 的相同日期驗證及 actor reader；用小型共用函數替代重複函數體。
- shrink: catalog 工作區與 study entrypoint；按職責分拆，預期主要降低理解成本，並不承諾減總行數。

net: -712 lines, -0 deps possible.

上式僅加總六個零產品引用候選，尚未實施／驗證刪除；未計可能需要保留的相容內容或測試搬移，
亦未把重複 helper 的小幅收益計入。本次没有足夠證據建議移除任何依賴。

## 建議的文件結構與閱讀順序

不需要再寫十幾份大計劃。第一輪建立少量短指南，內容從現有文件整理，避免再複製一套規範。

```text
README.md                    產品簡介、啟動摘要、閱讀路線
AGENTS.md                    AI／開發工作規則及任務選讀
DEPLOY.md                    正式發佈唯一 runbook
docs/
  current-product.md         全產品現況、已驗證範圍、現行規範連結
  architecture.md            領域圖、資料流、入口及 transaction 邊界
  development.md             本地設定、資料來源、demo、Windows 指令
  testing.md                 改哪裏要跑哪些測試、fixture 與環境分工
plans/
  README.md                  現行規範／工作中／暫緩／歷史分區索引
  <active-plan>.md           只放需要繼續做的計劃
  archive/                   已完成／已取代計劃及日期
  artifacts/                 有來源、有日期的驗證證據
```

現有生效 contract 初期可留原址，由 current-product 連結；不必為美觀一次改遍所有路徑。
若日後集中 contracts，必須搬移唯一原文並更新所有連結，不可同時維護兩份。
規範描述「應該如何」，程式／測試證明「目前如何」；兩者不符時記錄落差並解決，
不應只因實作存在就靜默改寫已批准的政策。

學生閱讀順序：README → development → current-product → architecture → 正在改的領域規範。
不要求先閱讀 16,000 行計劃歷史。長篇研究背景及過去審核輪次由連結按需查閱。

## 分階段實施建議

下列工作尚未執行；開始時建立一份有範圍及逐批驗收的整頓計劃，避免每個小修正再開新計劃。

| 階段 | 產出 | 功能保護及完成條件 |
|---|---|---|
| 0 固定基線 | 記錄 commit、工作樹差異、env 名稱、fixture／catalog 版本和目前測試結果 | 清楚分開既有失敗和重構引入的失敗；不自動提交使用者改動 |
| 1 文件交接 | 短入口、修正 seed／部署落差、領域圖、索引狀態整理 | 新人可按文件啟動；本地連結檢查通過；external gate 狀態不被誤勾完成 |
| 2 小型清理 | 每批少量零引用舊碼、相同純 helpers、中性命名 | 全庫 caller 核對、unit／lint／typecheck／build；涉及 reset 加相應 auth regression |
| 3a V1 退役 | 移除 V1 專用流程與切換，統一 V2 入口，同步 CI／設定／文件 | V2 全流程及舊入口拒絕行為驗收；保留 V2 共用依賴，不恢復 V1 |
| 3b 模組拆分 | catalog 工作區及 V2 transaction／recovery 按責任拆分 | 每個 PR 只改一個責任邊界，對應 DB／browser regression 通過；不可同時改 V2 產品規則 |
| 4 學生交接 | 經驗收的範例改動、已知限制、後續任務清單 | 新接手者能自行找入口、改一項局部功能、跑對測試並說明資料流 |

每批保留可獨立 revert 的 commit，這是修改回退，不是保留 V1 產品流程。
純整理階段不改 schema、migration、V2 API、V2 storage key 或 policy version；
V1 退役所需的舊 API／切換設定移除另列明確清單。不要一次全面改目錄再混入 bug fix，
否則差異太大，難以證明功能相等。

## 保留功能的驗收矩陣

| 修改範圍 | 核心案例 | 既有驗證入口 |
|---|---|---|
| 純 helpers／DTO | 邊界值、錯誤語義、日期及格式 | `npm test`、lint、typecheck |
| Catalog UI／service | proposal／review、revision conflict、retry closure、篩選／選取／focus、CSV／XLSX | catalog unit、`check:catalog-governance`／`check:catalog-submission`／`check:catalog-teacher-workflow`、`test:e2e:catalog-workspace` |
| V2 學習、手勢、recovery 及 V1 退役 | 3 秒 reveal、取消、首答唯一、重送、斷線、多分頁、expired／revoked、feedback ACK、舊入口不再啟動 V1 | 沿用 V2 DB／browser suites；先盤點 `test:browser:outbox`／`test:e2e:card-motion` 的 V1 專用案例，移植必要共用保障並移除退休案例 |
| Auth／reset／roster | 三種角色、越權、首次改密、tokenVersion、近期驗證、最後管理員、prepare／commit | `test:roster:auth`、`test:roster:invariants`、`test:e2e:admin-roster` 及相關 unit |
| Analytics／reward／leaderboard | 同一固定資料的前後分數、日期、scope、匯出及歷史政策一致 | analytics／reward unit、`test:db:weekly-leaderboard`、`test:e2e:weekly-leaderboard` 及現有 fixture checker |
| 所有可見 UI | 繁／簡、明／暗、desktop／mobile、keyboard／focus | 相應 rendered browser matrix；原生裝置未驗不可稱完成 |

資料庫測試先核對指定本地／test 目標，使用隔離 fixture，避免破壞正在示範的學校資料。
改測試目錄時亦要改 `package.json` 的明確 test globs：目前只列 root lib、catalog、i18n，
新增其他子目錄後測試不會自動獲同樣指令涵蓋。這是重組時的風險，不是已確認現有漏測。
Playwright 在這台 Windows 機器沿用 AGENTS 所列 Git Bash 路線。

## 不應以精簡名義改動的內容

- Server scoring、global receipt、operationId、credential lineage、CAS、Serializable 與 retry。
- Learning encounter 和 objective evidence 分層；教師 reward／學生 weekly score 的各自版本語義。
- V2 共用依賴及歷史資料的正確解讀；V1 執行流程按使用者決定退役，不保留 rollback。
- 已套用 migrations、identity／initial-activation manifest、正式資料來源及歷史審核證據。
- 真實學生 pilot、production deploy、research collection 和 destructive contract cleanup 的外部 gates。

不引入新 ORM、state framework、通用 workflow engine、微服務或全面架構重寫。
現有 Next.js／Prisma 分工足以作為學生繼續開發的基礎。

## 本次實際驗證與交付

- `npm test`：**429 passed，0 failed，0 skipped**。
- `npm run lint`：通過。
- `npx tsc --noEmit --incremental false`：通過；避免因這次只讀審視更新 incremental cache。
- 基本 Markdown 本地檔案連結掃描：初始 56 份 Markdown 未發現失效目標，未檢查 anchors／外部網站。
- 全庫路徑／行數盤點、AST 靜態 imports／相同函數體掃描及上述候選交叉搜尋已完成。
- 未執行 production build、資料庫／migration、完整瀏覽器、原生裝置、效能或依賴線上安全審計。
  本次沒有修改產品代碼；上述未執行項目不影響「報告完成」，但不能據此宣稱重構已驗收。
- 本次僅新增這份報告及索引入口；沒有刪碼、搬檔、改資料庫、改現行規範或發佈。

建議把首個交付目標定為「新人能啟動、知道去哪裏改、懂得如何驗證」，
再以可独立驗收的小批次逐步縮小複雜度；行數只作觀察指標，不作硬性減碼配額。
