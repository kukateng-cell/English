# 老師詞條表單指導、操作語義及重複預檢改善計劃

> 狀態：已完成（本地實作及驗證；雙 reviewer PASS；external gates deferred）
>
> 建立日期：2026-09-02
>
> 依賴計劃：[詞庫治理及生命週期](./word-catalog-governance-and-lifecycle.md)、[老師詞庫工作區可讀性重整](./word-catalog-teacher-workspace-usability-redesign.md)
>
> 範圍：老師／管理員逐詞新增及修改表單 UX；不改現有 sense-level 資料模型、獨立審核、soft retirement 或學生出題 contract

## 一、背景及問題

目前「新增詞條」直接打開一張接近全空白的長表單。大部分欄位只有名稱，沒有例子、必填／選填標示、持續可見說明或分段流程；`Lemma`、詞性、方向設定、其他可接受答案及干擾項等內容需要老師先理解內部詞庫 contract。

表單底部同時顯示「提交草稿」及「提交停用申請」，但未清楚說明前者會提交上方內容作 CREATE／UPDATE 審核，後者只提交生命週期狀態申請、唔會一併提交欄位修改。`提交草稿`亦容易被理解成「暫存、稍後再完成」，但目前實際行為係立即建立待審 change request。

系統現有 authoritative 重複保護會在提交及批准前，以 normalized lemma＋詞性＋normalized 中文釋義阻擋完全相同詞義，亦會阻擋相同 pending CREATE；同一英文但不同意思則可建立另一個 sense並歸入同一 headword。不過逐詞新增表單目前沒有輸入中預檢、現有詞義摘要或「修改現有／新增另一詞義」選擇；中文釋義字面不同但意思相近時亦沒有自動提示。

## 二、已確認需求及決定

- [x] 將老師表單標籤「中文正確答案」改為「其他可接受中文譯法」，並將「英文正確形式」改為「其他可接受英文形式」。
- [x] 為複雜欄位加入老師可理解的填寫指導；placeholder 可以作短例子，但不可成為唯一說明，因為輸入後會消失，亦不足以支援無障礙使用者。
- [x] 清楚分開「提交內容供審核」與「申請停止使用」兩種操作，避免並排而沒有後果說明。
- [x] 新增英文詞時主動顯示同 headword 現有詞義，協助老師選擇修改現有詞義或新增另一個意思。
- [x] 保留 server-side 提交／批准時重查，前端預檢只提供早期指導，不可成為唯一重複保護。

## 三、目標

1. 老師毋須先閱讀 CSV 規格，都能判斷每格填甚麼、是否必填及學生會在哪裏看到。
2. 老師能在按掣前理解提交內容修改及停用申請的不同後果。
3. 輸入英文詞後即時看到同詞現有 senses，減少重複建立相同或近似詞義。
4. 完全相同詞義及 pending duplicate 繼續由 server authoritative fail closed；並發新增不能繞過檢查。
5. 同一英文的真正新意思仍可安全建立獨立 sense，不因簡單 term duplicate 被錯誤阻擋。

## 四、非目標

- 不把相同英文一律視為重複；`run = 跑步`與`run = 經營`仍可為兩個詞義。
- 不以不透明 AI 判斷自動合併或刪除近義詞義。
- 不改 approved revision、review separation、revision CAS、soft RETIRED、history或audit contract。
- 不改 Objective Probe 每題一個 canonical correct option及人工干擾池規則。
- 不需要 schema migration；亦不包括 production deploy 或 destructive cleanup。

## 五、建議介面設計

### 5.1 先辨認詞目，再展開完整表單

新增流程先只要求輸入「英文詞」，未完成呢一步前不顯示其餘長表單。輸入停止或離開欄位後，以 server-side normalized term／lemma 搜尋現有詞義，顯示：

```text
詞庫已有 2 個 run 詞義

跑步 · 動詞 · A1 · 已啟用        [查看／修改]
經營 · 動詞 · B1 · 已啟用        [查看／修改]

[新增 run 的另一個意思]
```

- 完全沒有結果：顯示「詞庫暫未有這個英文詞」，繼續新增新詞目。
- 有同詞結果：先讓老師查看／修改現有詞義，或明確選擇新增另一個意思。
- 老師選「新增另一個意思」後，保留英文詞並預填／建議 lemma，再展開其餘欄位。
- 預檢 request要有 debounce、AbortController及intent freshness；慢回應不可覆蓋較新輸入。

### 5.2 分段、必填狀態及例子

將長表單分成三段：

1. 基本資料：英文詞、lemma、詞性、程度、主題；
2. 學習內容：中文釋義、音標、英／中文例句、其他可接受譯法、近反義詞；
3. 出題設定：方向開關、兩組干擾項、學生題目預覽。

每個欄位使用：清楚標籤＋必填／選填標記＋短 placeholder＋持續可見 helper text。建議例子：

| 欄位 | Placeholder／持續說明方向 |
|---|---|
| 英文詞 | `例如：run`；學生會看到或選擇的標準英文形式 |
| Lemma | `例如：run`；字典原形，一般與英文詞相同；`ran`的lemma為`run` |
| 中文釋義 | `例如：跑步`；只填這一個詞義的主要顯示答案 |
| 音標 | `例如：rʌn`；不用輸入外層斜線 |
| 例句英文 | `例如：I run every morning.`；要清楚呈現本詞義 |
| 例句中文 | `例如：我每天早上跑步。`；對應英文例句 |
| 其他可接受中文譯法 | `例如：奔跑 | 跑（沒有可留空）`；不會顯示成另一個答案按鈕，只防止誤列為干擾項 |
| 其他可接受英文形式 | `例如：color | colours（沒有可留空）`；例如英美拼寫或可接受形態變體 |
| 干擾項 | 顯示5–6個獨立輸入槽／chips及目前數量，不要求老師手動理解`｜`分隔 |

詞性應評估改為受控下拉選單；主題應顯示中文名稱及簡短解釋，而唔只顯示內部英文代碼。空白示例不可預填入真正 value，避免老師誤提交示例內容。

### 5.3 將兩個提交動作分區

內容表單底部主要動作按情境顯示：

- 新詞義：`提交新詞義，送交審核`
- 修改正式詞義：`提交內容修改，送交審核`

按鈕上方持續顯示：「會提交上方內容；批准前不會改變學生目前使用的正式版本。」

停用不再作為無解釋的相鄰同級按鈕，移入獨立「狀態管理」區：

```text
停止使用這個詞義
停用申請不會提交上方內容修改。批准前詞義仍可供學生使用；批准後不再發出新題，歷史記錄會保留。
[申請停用這個詞義]
```

具審核權限者維持`立即停用`，但要顯示即時後果並二次確認。若表單有未提交修改，狀態操作先提示老師完成或放棄內容修改，不可令人以為兩者會一併送出。

### 5.4 分層重複檢查

- **Headword 預檢**：輸入英文詞後列出所有 normalized term／lemma 相符的現有 senses；相同英文不是硬錯誤。
- **Exact sense 硬阻擋**：lemma＋詞性＋中文釋義 normalization完全相同，或已有相同 pending CREATE時，禁止再次提交，並提供「查看現有詞義／查看待審申請」。
- **近似詞義警告**：同 lemma＋詞性但中文釋義不同時，列出現有意思並要求老師確認係真正新詞義。字面不同不代表語義不同，因此只作人工判斷提示，不自動合併。
- **最終 authoritative recheck**：提交 transaction及批准 transaction繼續重查，以處理兩位老師同時新增的競態。

## 六、API及資料影響

- 優先重用現有catalog server-side搜尋／detail能力；如現有DTO不能有界地返回同headword senses，新增受教師／管理員守衛的精確precheck endpoint。
- 預檢只回老師可讀摘要：sense key由client內部保留作導覽，不顯示raw technical metadata；pending內容遵守owner／reviewer privacy。
- 不需要schema migration；authoritative duplicate規則及stable identity保持現有contract。
- 如新增近似比對，只可回`warning`及候選摘要；不得取代exact fingerprint或直接決定合併。

## 七、分階段Checklist

### Phase 0：確認文案及流程

- [x] 確認兩個主要提交按鈕最終名稱及狀態管理區文案。
- [x] 確認所有表單欄位必填／選填、placeholder、helper text及例子。
- [x] 確認`英文正確形式`同步改為`其他可接受英文形式`。
- [x] 確認詞性受控選單及category中文顯示範圍。
- [x] 確認新增流程先只問英文串法並完成預檢，之後先展開完整表單。

### Phase 1：表單指導及操作語義

- [x] 實作已確認標籤修改、分段、必填／選填標示、placeholder及helper text。
- [x] 實作情境化內容提交按鈕及獨立狀態管理區。
- [x] 保留zh-Hant／zh-Hans、light／dark、keyboard、screen-reader語義及mobile layout。

### Phase 2：重複預檢及決策入口

- [x] 實作normalized headword lookup、debounce、abort及stale-response保護。
- [x] 顯示現有sense摘要及`查看／修改`、`新增另一個意思`入口。
- [x] 顯示exact duplicate／pending duplicate hard block及near-duplicate人工判斷提示。
- [x] 確認server submit及approval authoritative checks沒有被client結果取代。

### Phase 3：驗證及文件

- [x] 更新相鄰unit及catalog workspace route／component browser tests。
- [x] 執行lint、typecheck、build、unit suite及catalog workspace browser regression。
- [x] 完成320／768／1024／1440 px overflow、繁簡、明暗、keyboard focus及screen-reader語義自動檢查，並檢視320 px簡體深色截圖。
- [x] 記錄實際測試、未執行external gates及known limitations。
- [x] 兩個獨立subagents均確認沒有未解決問題。

## 八、測試矩陣

| 情境 | 預期 |
|---|---|
| 全新英文詞 | 顯示無現有結果，容許建立新詞目 |
| `run`已有兩個不同詞義 | 列出兩個摘要，容許開啟修改或明確新增另一意思 |
| lemma＋詞性＋中文釋義完全相同 | 前端提前阻擋；直接繞過前端仍由server拒絕 |
| 中文釋義只係字面近似 | 顯示現有詞義及人工確認警告，不自動合併 |
| 已有相同pending CREATE | 顯示等待審核並阻擋第二份相同申請 |
| 兩位老師並發新增 | 只有一份可通過authoritative提交／批准檢查 |
| ACTIVE詞義提交內容修改 | 正式版本批准前保持不變 |
| 普通老師申請停用 | 只提交理由／狀態；批准前保持ACTIVE |
| reviewer立即停用 | 顯示後果、確認後soft RETIRED；歷史保留 |
| 表單有未提交修改再按停用 | 明確提示兩者不會一併提交，避免資料誤解 |

## 九、風險及控制

| 風險 | 控制 |
|---|---|
| Placeholder輸入後消失或screen reader語義不足 | 保留label、必填狀態及持續helper text；placeholder只作例子 |
| 相同英文被錯誤硬擋 | headword只提示；只有exact sense／pending exact先hard block |
| 近義自動判斷誤合併 | 只列候選及交老師／reviewer判斷，不自動改資料 |
| 預檢結果過期 | submit及approval transaction authoritative recheck |
| 預檢洩露其他老師私人草稿 | 沿用catalog pending visibility及server-side redaction |
| 停用被誤解為同時儲存修改 | 狀態管理分區、後果文案、dirty-form guard |
| 長表單加入說明後更擁擠 | 分段／漸進展開、進階欄摺疊、mobile visual regression |

## 十、發佈、Rollback及Definition of Done

- 使用者已批准實作；本地改動已完成，但未執行production deploy。
- 實作應以additive precheck同presentation改動為主；出現問題可隱藏預檢／回退表單文案，而不回滾catalog資料。
- 不執行production deploy；如日後獲准發佈，跟`DEPLOY.md`完成build、catalog regression、staging／production觀察及rollback。

完成標準：老師能由空白表單自行判斷每個主要欄位點填；兩個提交動作的對象、審核及生效後果入頁可見；輸入既有英文時會列出現有詞義及清楚下一步；完全相同／pending duplicate在UI提前提示並仍由server最終阻擋；真正新詞義可以保留；所有既有審核、停用、privacy、history及學生出題語義無回歸。

## 十一、決策紀錄

| ID | 決定 | 狀態 |
|---|---|---|
| CEF-001 | `中文正確答案`改為`其他可接受中文譯法` | 已實作及驗證 |
| CEF-002 | `英文正確形式`同步改為`其他可接受英文形式` | 已實作及驗證 |
| CEF-003 | Placeholder只作短例子，複雜欄位另有持續helper text | 已實作及驗證 |
| CEF-004 | `提交草稿`改成按新增／修改情境顯示的`送交審核`動作 | 已實作及驗證 |
| CEF-005 | 停用移入獨立狀態管理區，不與內容提交作無說明並列 | 已實作及驗證 |
| CEF-006 | 新增先只問英文串法，預檢並列出現有senses後先展開完整表單；相同英文不同意思仍可新增 | 已實作及驗證 |
| CEF-007 | Exact duplicate hard block；近似詞義只警告並交人工判斷 | 已實作及驗證 |

## 十二、實作及驗證紀錄（2026-09-03）

- 新增受老師／管理員權限保護的`GET /api/catalog/precheck`，按normalized term及lemma返回有界現有詞義摘要；普通老師只可見自己的完整pending CREATE摘要，exact pending檢查不回傳其他老師內容。
- 抽出共用`catalogSameSense`，讓預檢、CREATE提交及批准流程沿用相同lemma＋詞性＋中文主要釋義規則；原有transaction內authoritative檢查保持不變。
- 新增流程改為兩步：第一步只輸入英文串法及查看現有詞義；第二步先顯示完整分段表單。Exact precheck期間會暫停提交，但API失效時最終POST仍會authoritative fail closed。
- 「其他可接受中文譯法／英文形式」持續說明已明確指出其用途係答案安全／避免誤列為干擾項；目前客觀題仍只顯示canonical主要答案。
- 實際通過：`npm test`（359 passed）、`npm run lint -- --max-warnings=0`、`npx tsc --noEmit`、`npm run build`、`git diff --check`，以及`DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run test:e2e:catalog-workspace`（23 passed）。
- Browser regression包括全新英文、現有headword、term／lemma變體exact conflict、完整資料庫CREATE→approve→UPDATE→retire／reactivate生命週期、私隱邊界、競態、320／768／1024／1440 px overflow、zh-Hant light、zh-Hans dark及keyboard focus trap。
- 首輪雙重獨立審核提出的pending lemma／50項邊界／response freshness，以及modal錯誤、重試、改詞清理、live announcement、可辨識操作名稱及常駐填寫規則，已全部修正並加入相應unit／browser regression。
- 後續覆核再發現precheck不應載入全庫pending payload，以及父詞條dialog focus trap不應攔截巢狀feedback dialog；前者已改為parameterized PostgreSQL exact候選篩選，後者已在父dialog inert期間停用父focus trap並補足子dialog focus recapture及Tab／Shift+Tab regression。
- 最終兩位獨立reviewer已分別明確確認backend／security／data correctness，以及UX／accessibility／i18n／mobile／product semantics均為PASS，沒有未解決問題。
- 未執行external gates：production deploy／production觀察、真實老師pilot、實體mobile裝置及原生screen reader人工矩陣；以上留待另行批准或具備相應環境後處理。
- 已知限制：近似中文意思只列出同headword候選供老師判斷，不以AI自動判定或合併；client precheck係早期提示，安全及一致性的最後依據仍為server提交／批准檢查。
