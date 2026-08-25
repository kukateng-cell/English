# 老師詞庫工作區可讀性、密度、篩選及歷史導覽重整計劃

> 狀態：待審批（需求方向及雙重獨立計劃審核已完成；尚未開始實作）
> 建立日期：2026-08-26
> 目標分支：`codex/word-catalog-governance-and-lifecycle`
> 依賴計劃：[詞庫治理及生命週期](./word-catalog-governance-and-lifecycle.md)、[CSV 批量提交及歷史](./word-catalog-bulk-submission-and-history.md)、[老師意見、題目預覽及待辦](./catalog-teacher-feedback-preview-and-work-items.md)

## 一、背景

詞庫治理後端已經具備 sense-level 詞義模型、正式／草稿／停用生命週期、逐條及 CSV 批量提交、單人審核、revision CAS、意見回報、個人待辦、題目預覽及修改歷史。現時主要問題唔係缺少治理能力，而係「完整詞庫」同「修改歷史」仍然過度呈現內部資料模型，令英文老師難以快速理解同操作。

目前介面可見以下具體問題：

- 一般列表直接顯示 `sense_...`、`revision 1`、來源檔案路徑等技術資料，老師無法由代碼判斷同一拼法下不同詞義。
- desktop 每個詞條卡片過高，資料沒有清晰欄目標題，三個主要操作採用不同樣式並垂直排列，一頁可見詞條太少。
- 「草稿」、「方向被阻擋」、「1 個問題」混合咗發布狀態、出題可用性同驗證結果；後兩者亦沒有解釋實際問題同修正方法。
- 逐詞「查看歷史」會切換並卸載完整詞庫工作區；返回後原有搜尋、篩選、已載入頁數、勾選及捲動位置全部消失。
- 歷史列表顯示 `STANDALONE_REQUEST`、`PENDING`、`APPROVED`、技術 key 等內部名稱，未有老師可讀嘅事件句子同前後差異摘要。
- 現有 server-side 查詢只支援搜尋、發布狀態、程度及出題方向，欠缺詞性、首字母、主題及排序；完整詞庫使用 cursor 分頁，所以不能只喺 browser 對已載入資料做局部排序。
- 繁體轉換層會將正確用詞「干擾項」轉成「幹擾項」，單純修改個別字串不足以永久修正。

本計劃只重整老師／管理員詞庫工作區嘅資訊架構、查詢能力同歷史導覽；既有審批、權限、並發、學生出題及資料生命週期 contract 保持不變。

## 二、已確認產品原則

### 2.1 老師先看教學語義，系統識別碼留在進階資料

- 普通列表不顯示 `senseKey`、database ID、raw revision 或完整 source path。
- 同一英文拼法嘅不同詞義，以老師可理解嘅組合標示，例如：

  ```text
  run · 動詞 · 跑步 · A1
  run · 動詞 · 經營 · B1
  ```

- 系統仍以 immutable `senseKey` 作路由、審核、歷史及並發識別；只係唔將佢當主要 UI 文案。
- 需要支援或核對時，可在「進階資料」摺疊區複製 technical key。

### 2.2 將生命週期、工作流程、出題狀態及問題範圍分開

老師介面不得再用一個 badge 同時表達詞條係咪正式生效、有冇修改等待審核、兩個測試方向係咪可用及內容有冇驗證問題。四者係正交維度，可以同時存在；例如一個 ACTIVE 詞義可以繼續供學生使用，同時有一份 UPDATE 等待審核。

| 維度 | 老師可見值 | 意思 |
|---|---|---|
| 生命週期 | 已啟用 | 目前正式版本已供學生 runtime 使用 |
| 生命週期 | 草稿（未供學生使用） | 尚未有正式啟用版本 |
| 生命週期 | 已停用 | 詞義保留歷史，但不再供學生 runtime 使用 |
| 工作流程 | 有修改等待審核 | 有正式申請等待處理；不取代目前生命週期，普通老師只見符合既有 privacy contract 嘅內容 |
| 工作流程 | 無待審修改 | 目前沒有 pending change request |
| 出題狀態 | 兩種題型可用 | 英譯中及中譯英均可出題 |
| 出題狀態 | 只可英譯中 | 只有英譯中方向符合要求 |
| 出題狀態 | 只可中譯英 | 只有中譯英方向符合要求 |
| 出題狀態 | 暫不可出題 | 兩個方向都未啟用或無法安全出題 |
| 內容問題 | 目前正式版本需修正 | current approved／import內容有一項或以上具體問題 |
| 內容問題 | 待審版本需修正 | pending draft有一項或以上問題；不得暗示學生目前使用嘅正式版本已損壞 |
| 內容問題 | 匯入草稿需修正 | 尚未建立正式詞義嘅import draft有一項或以上問題 |

「方向被阻擋」只係內部判斷概念，不直接顯示畀老師。

畫面容許同時顯示：

```text
已啟用　有修改等待審核
目前正式版本可正常出題；待審版本有 1 項內容需修正
```

### 2.3 問題提示必須講明原因同下一步

- 將「1 個問題」改成「1 項內容需修正」。
- 展開後顯示中文、欄位導向、可行動嘅原因，例如：

  ```text
  中譯英干擾項：只有 4 個有效選項，至少需要 5 個。
  請補充不重複、不是正確答案或同義答案的英文干擾項。
  ```

- 不直接顯示 raw validator code、英文 exception 或資料庫錯誤。
- 相同驗證規則由共用 presentation helper 翻譯，避免列表、編輯器、CSV 預覽及題目預覽使用不同說法。

### 2.4 正確術語係「干擾項」

- 繁體顯示「干擾項」，簡體顯示「干扰项」；兩者均不得出現「幹擾項」或「幹扰项」。
- 修正 OpenCC／字詞轉換後置規則，避免 canonical 文案經轉換後再變錯。
- 新增轉換 regression test，涵蓋標籤、錯誤訊息、題目預覽同歷史差異。

### 2.5 不改變正式審核流程

- 同一詞義仍只容許一個正式 pending change request。
- 多位老師可以各自提交非執行性 feedback；feedback 不會直接改詞庫。
- 任何一位具有審核權限嘅人批准後即可生效，不增加第二人覆核。
- revision CAS、stale／retry、self-review separation、draft privacy、immediate retire 同 immutable history 保持原有 contract。

## 三、目標

1. 老師毋須理解內部 key、enum 或來源路徑，都能辨認詞義、狀態、出題能力及下一步操作。
2. desktop 一頁顯示明顯更多詞條；tablet 同手機仍保持可讀、可操作及無水平溢出。
3. 所有詞條操作使用一致層級、尺寸、位置同文案。
4. 詞性、首字母、主題、程度、生命週期、工作流程、出題狀態、內容問題及排序全部由 server 對完整資料集執行。
5. 從某詞條查看歷史後，可以準確返回原詞條及原本列表狀態。
6. 歷史以老師可讀嘅事件、人物、時間、狀態及差異呈現，技術資料降到進階區。
7. 保持現有權限、draft privacy、cursor integrity、request freshness 同大型詞庫效能基線。

## 四、非目標

- 不修改學生學習流程、Objective Probe、排行榜、統計或 SM-2。
- 不改詞庫 CSV 34 欄格式、sense-level schema、正式 baseline 或 ACTIVE／DRAFT 判定。
- 不新增角色、第二人覆核、緊急撤回或另一套審核流程。
- 不容許多個正式 pending request 同時競逐同一詞義。
- 不在今輪重寫批量提交、feedback、retry 或 history visibility 後端語義。
- 不執行 production migration、deploy、staging 或 destructive legacy cleanup。
- 不因為隱藏 technical metadata 而刪除 audit／revision／source 資料。

## 五、現況 contract 及依賴

### 5.1 現有查詢

`GET /api/catalog` 現時接受：

- `q`
- `status`
- `level`
- `direction`
- `limit`
- `cursor`

現有 cursor 由 filter fingerprint 簽署；新增任何排序或篩選欄位時，必須一併加入 fingerprint，避免舊 cursor 被錯誤套用到另一種結果次序。

### 5.2 現有排序

目前 server 主要按 `sortGroup`、`sourceFile`、`sourceRow`、`term`、`senseKey`、`id` 排序。呢個順序適合重建來源，但不適合作為老師瀏覽詞庫嘅預設順序。

### 5.3 現有歷史可見性

必須保留三層 history DTO：

- reviewer／admin：可看完整審核資料；
- owner：可看自己提交而未公開嘅申請；
- 其他普通老師：只看 approved／公開歷史，或按既有規則只見 redacted pending summary。

UI 重整不得用 client-side hide 取代 server-side redaction。

### 5.4 預期資料庫影響

不改現有業務真相、審核關係或 approved revision schema。新增排序／篩選先以現有 approved projection、normalized term、part of speech、category、level、timestamps 及 validator結果完成。若現有資料不足以用單次有界查詢產生完整資料集 readiness／issue facets，可新增由正式 validator 產生、以 sense revision綁定、可重建嘅 additive read projection；若 `EXPLAIN (ANALYZE, BUFFERS)` 證明需要，亦可新增 additive index。任何 projection／index 都要另建 migration、記錄重建／一致性 contract及完成 migration checklist，不可把快取或投影變成另一個業務真相來源。

## 六、介面設計

### 6.1 Desktop：緊湊式語義列表

desktop 固定採用有語義欄頭嘅 native table；每個 breakpoint 只 render 一套 interactive DOM，避免以 CSS 隱藏另一套按鈕而令 screen reader 重複讀取。欄位如下：

| 欄位 | 主要內容 |
|---|---|
| 選取 | CSV 匯出用 checkbox；bulk flag 關閉時隱藏 |
| 詞條及詞義 | `term`、中文主要釋義、必要時發音 |
| 分類 | 詞性、程度、主題；以短標籤顯示 |
| 狀態 | 生命週期 badge＋獨立工作流程 badge，例如「已啟用」＋「有修改等待審核」 |
| 出題狀態 | 兩種題型／單一方向／暫不可出題；內容問題另列 |
| 操作 | 三個操作水平排列，固定順序為「查看／修改」、「報告問題」、「查看歷史」 |

要求：

- 使用 `<table>`、`<thead>`、`<th scope="col">` 等正確語義；desktop header 可 sticky，但不得遮住頁面導覽。
- 每行預設只顯示必要摘要；長釋義、主題及狀態可合理截斷並提供 accessible full text。
- 三個操作同一高度、同一對齊方式，不再垂直堆疊三個不同形態嘅按鈕；feature flag關閉嘅入口直接移除。
- technical revision/source 不佔列表欄位。
- 目標 row 高度約 80–96 px；以真實繁體中文長內容驗證，不以硬裁切達標。
- 密度基線固定用 1440 × 900 CSS px、browser 100% zoom、同一組20個代表詞條，由列表欄頭底部至viewport底部計完整可見行；首屏可見詞條數至少為現況基線兩倍。

### 6.2 Tablet 同 mobile

- tablet將「分類」同「出題狀態」合併為兩行摘要，只保留「查看／修改」主要按鈕；「報告問題」同「查看歷史」放入固定「更多操作」選單。
- mobile 改用緊湊 card：第一行詞條＋生命週期，第二行詞義，第三行分類／工作流程／出題狀態，最後一行「查看／修改」＋同一個「更多操作」選單。
- 三種 breakpoint 嘅操作順序及命名一致；不可為同一 viewport 同時 render desktop table按鈕同mobile card按鈕。
- 不以縮細字體或隱藏核心狀態換取密度。
- 所有 interactive control 至少符合現有設計系統觸控尺寸，keyboard focus 清晰。
- 320、768、1024、1440 px 代表 viewport 均不得水平溢出；200% zoom 要正確 reflow，但不套用desktop兩倍密度要求。

### 6.3 詞義識別

普通列表顯示：

```text
run
經營 · 動詞 · B1
```

若同頁同拼法仍可能混淆，可增加非技術序號：

```text
run（詞義 2）
經營 · 動詞 · B1
```

序號只可由同一組穩定排序產生，唔可以因分頁或篩選而變動。實作前要先確認是否真有必要；首選仍係「詞性＋主要釋義＋程度」，避免引入另一個老師要理解嘅代碼。

### 6.4 正式版本及來源

- 列表不顯示 raw revision 同 source path。
- detail 內顯示「目前正式版本：第 1 版」。
- source 只在進階資料顯示友善摘要，例如「初始詞表 A1，第 2 行」；完整 path／import row ID 只畀有需要嘅 reviewer 複製。
- 「第 N 版」只係人類可讀標籤；server mutation 仍使用真正 expected revision。

### 6.5 篩選同排序控制

保留現有搜尋、程度及方向相容能力，將混合式發布status拆成以下正交篩選，並新增：

- 詞性：名詞、動詞、形容詞、副詞等 canonical values；空值用「未分類」。
- 首字母：A–Z 及「其他」；按畫面顯示嘅 normalized `term` 判斷，不按lemma，避免 `better` 被放到 G。
- 主題：由詞庫現有 category taxonomy 產生，顯示老師可讀標籤。
- 生命週期：已啟用、草稿、已停用。
- 工作流程：全部、有修改等待審核、無待審修改。
- 出題狀態：兩種可用、只可英譯中、只可中譯英、暫不可出題。
- 內容問題：全部、目前正式版本需修正、待審版本需修正、匯入草稿需修正、沒有問題。
- 排序：A–Z（預設）、Z–A、最近修改、程度 A1→B2、需要處理優先。

篩選器採 responsive toolbar：desktop 單行主篩選＋「更多篩選」，mobile 用可關閉 drawer／sheet；已套用條件顯示 chips 並可逐一清除。

### 6.6 問題詳情

列表按問題scope顯示「目前正式版本有 N 項內容需修正」、「待審版本有 N 項內容需修正」或「匯入草稿有 N 項內容需修正」。按下後展開／popover 顯示：

- 影響欄位；
- 影響方向；
- 老師可讀原因；
- 建議處理方法；
- 「查看／修改」捷徑。

若問題只係 draft 未完成，必須分辨「尚待老師補充」同「正式版本目前不可出題」，並明示「目前正式版本仍可正常出題」（如適用），避免令人誤以為 ACTIVE 詞義已損壞。

## 七、歷史導覽及呈現

### 7.1 逐詞歷史不離開完整詞庫

- 從某行按「歷史」時，開啟 `CatalogSenseHistoryDrawer`（desktop 側邊 drawer；窄屏 full-screen sheet）。
- 逐詞 drawer 打開期間完整詞庫 component 保持 mounted。
- 為咗全域「修改歷史」tab返回後亦能還原，將 catalog query、rows、cursor、selection、scroll anchor及active-row key提升到最外層 `CatalogGovernanceWorkspace`嘅 typed reducer；子workspace卸載唔會清除呢份state。
- 進入全域歷史前保存來源row anchor；返回後先重建已載入列表，再以anchor還原scroll及focus。若資料已改變令來源row不再符合篩選，保留原filters並顯示「原詞條已不在目前結果」提示，唔自動清空篩選。
- 關閉歷史後將 focus 還原到原按鈕，來源詞條短暫 highlight；如行因背景刷新消失，顯示清楚提示而唔跳回頂部。
- drawer 內可提供「在完整歷史中查看」連結；全域「修改歷史」tab 繼續負責跨詞條搜尋、批次及 baseline 事件。

### 7.2 共用 request freshness

- 逐詞歷史 request 需要 AbortController、generation／intent freshness，同現有 detail、retry、question preview pattern 一致。
- 開 A 歷史後立即開 B，A 嘅慢回應不得覆蓋 B。
- 關閉 drawer、切 tab、component unmount 必須 abort。
- 全域 action notice 保持最外層 owner，不因切換子 workspace 遺失。

### 7.3 老師可讀歷史詞彙

| 內部值 | 老師顯示 |
|---|---|
| `STANDALONE_REQUEST` | 逐條修改 |
| `BATCH` | CSV 批量修改 |
| `INITIAL_BASELINE` | 最初匯入 |
| `CREATE` | 新增詞義 |
| `UPDATE` | 修改詞義 |
| `RETIRE` | 停用詞義 |
| `REACTIVATE` | 重新啟用詞義 |
| `PENDING` | 等待審核 |
| `APPROVED` | 已批准 |
| `REJECTED` | 已拒絕 |
| `CANCELLED` | 已取消 |
| `STALE` | 需要重新比對 |
| `EXPIRED` | 已過期 |

所有 enum 必須經 exhaustive mapping；未知值以安全 fallback 顯示「未能識別的記錄狀態」，並記錄 diagnostic，唔直接把 raw value 顯示畀普通老師。

### 7.4 Timeline 內容

每項歷史優先顯示完整句子：

```text
你在 25/8/2026 11:12 提交修改：把中文釋義由「朋友」改為「好朋友」。
審核老師在 25/8/2026 11:18 批准修改；第 2 版正式生效。
```

並提供：

- 提交者、審核者（按既有 privacy／pseudonym contract）；
- 提交、審核、生效時間；
- 中文 review note／reason；
- before／after field diff，只顯示有改動嘅欄位；
- 大型干擾項陣列以 added／removed 摘要呈現；
- technical keys、payload digest、operation ID、source row 放入 reviewer-only「進階資料」。

Actor名稱沿用現有DTO可見性，不因重整擴大披露：

- reviewer／admin按現有完整DTO顯示姓名；
- owner本人顯示「你」，其他角色顯示「提交老師」或「審核老師」；
- public approved歷史只顯示「提交老師／審核老師」；
- pseudonym／deleted actor沿用既有安全fallback。

相同 request 因提交、批准產生多個事件時，可以在 UI 組合成一個 timeline group，但不可刪失 immutable audit event 或令人誤解實際次序。

### 7.5 逐詞歷史分頁 contract

逐詞drawer不再一次載入全部歷史，使用：

```text
GET /api/catalog/:senseKey/history?limit=25&cursor=...
```

- server先按request／batch lineage組成完整timeline group，再以group `occurredAt DESC, groupKey DESC`作穩定keyset；cursor指向group key，唔可以先分頁raw events再組合，亦不得將同一request拆到兩頁。
- signed cursor綁定 `senseKey`、actor visibility scope、排序版本、snapshot cutoff及workspace/history visibility signature。
- page size預設25、server最大50；cursor不可跨sense或跨身份重用。
- 第一頁建立snapshot cutoff；載入期間新增嘅事件不插入舊snapshot，重新整理先開新snapshot。
- cursor失效／visibility改變時回指定可恢復code，drawer清除舊page後由第一頁重新載入。
- history DTO繼續先喺server做PUBLIC_APPROVED／OWNER／REVIEWER redaction，先再組timeline；cursor本身不得包含可讀PII或raw payload。

## 八、API、查詢及 presentation contract

### 8.1 `GET /api/catalog` 新增參數

建議擴充 `CatalogWorkspaceFilters`：

```ts
type CatalogWorkspaceSort =
  | "SOURCE_ORDER"
  | "TERM_ASC"
  | "TERM_DESC"
  | "UPDATED_DESC"
  | "LEVEL_ASC"
  | "ACTION_REQUIRED_FIRST";

type CatalogWorkspaceFilters = {
  q: string;
  lifecycle: "ALL" | "ACTIVE" | "DRAFT" | "RETIRED";
  workflow: "ALL" | "PENDING" | "NONE";
  level: CatalogLevelFilter;
  direction: CatalogDirectionFilter;
  partOfSpeech: string | "ALL" | "UNCLASSIFIED";
  initial: "ALL" | "OTHER" | UppercaseLetter;
  category: string | "ALL" | "UNCLASSIFIED";
  readiness: CatalogReadinessFilter;
  issues: "ALL" | "CURRENT" | "PENDING_DRAFT" | "IMPORT_DRAFT" | "NONE";
  sort: CatalogWorkspaceSort;
};
```

實際 union 應使用既有 canonical taxonomy／normalizer，唔好複製另一套自由字串規則。

現有 `status=ACTIVE|DRAFT|RETIRED|BLOCKED|VALIDATION_FAILED|PENDING` 保留一個compatibility window；若同時傳新舊互相衝突參數就回422。新老師UI只傳新參數，舊status cleanup另開contract change，唔在本輪刪除。舊值必須保留現有精確predicate，唔可以粗略映射後擴大結果：

| 舊status | compatibility predicate |
|---|---|
| `ACTIVE`／`DRAFT`／`RETIRED` | 原有row `status`完全相等 |
| `BLOCKED` | `eligibilityResult = DRAFT_BLOCKED` |
| `VALIDATION_FAILED` | `primaryDisposition = VALIDATION_FAILED` |
| `PENDING` | actor可見row嘅`pendingRequest IS NOT NULL` |

### 8.2 Cursor 及穩定排序

- filter fingerprint 必須包括所有新欄位及排序版本。
- 每種排序都要有 deterministic tie-breaker，最終至少落到 immutable `senseKey`／row ID。
- 未傳 `sort`嘅舊client固定保留現有 `SOURCE_ORDER`；新老師UI明確傳 `TERM_ASC`作畫面預設。
- 舊cursor v1只配合legacy query／`SOURCE_ORDER`；新cursor v2包含sort、完整filters、workspace signature及snapshot。版本或條件不相容時回 `CATALOG_CURSOR_CONTEXT_MISMATCH`，client清除cursor後重新載入，不可錯頁或重複資料。
- `UPDATED_DESC`嘅actor-visible `lastChangedAt`固定為：已建立sense取`GREATEST(approvedRevision.createdAt, sense.updatedAt)`，approved revision為null時取`sense.updatedAt`；source-only draft取import batch `updatedAt`；只有owner／reviewer可見嘅pending CREATE取request `updatedAt`。排序為`lastChangedAt DESC, stableRowId DESC`，null永遠最後；其他老師hidden pending絕不可影響排序或時間。
- `ACTION_REQUIRED_FIRST` 只可以使用 actor 可見、server 已 redacted 嘅 actionable summary，避免排序本身洩露其他老師草稿。

### 8.3 Response DTO

在不暴露 hidden draft 嘅前提下，為每行提供 presentation 所需嘅結構化資料：

```ts
type CatalogWorkspacePresentation = {
  displayIdentity: {
    term: string;
    definitionZh: string;
    partOfSpeechLabel: string | null;
    levelLabel: string | null;
  };
  lifecycleState: "ACTIVE" | "DRAFT" | "RETIRED";
  workflowState: "NONE" | "PENDING";
  contentPresentations: Array<{
    scope: "CURRENT_CONTENT" | "PENDING_DRAFT" | "IMPORT_DRAFT";
    readinessState:
      | "BOTH"
      | "EN_TO_ZH_ONLY"
      | "ZH_TO_EN_ONLY"
      | "UNAVAILABLE";
    issueSummary: {
      count: number;
      issues: Array<{
        field: string | null;
        direction: "EN_TO_ZH" | "ZH_TO_EN" | null;
        code: string;
      }>;
    };
  }>;
  currentRevisionNumber: number | null;
  lastChangedAt: string;
};
```

- API 傳 stable code／structured facts；繁簡文案由共用 presentation layer產生。
- 若 issue detail 本身可能包含未公開 draft 資料，server 必須先按 actor redaction。
- 現有 technical fields可暫時保留以兼容舊 client，但新 UI 不直接 render；日後移除要另開 compatibility cleanup。

同一row可以同時有CURRENT_CONTENT同PENDING_DRAFT，唔可以用單一scope覆蓋。列表主要出題badge取CURRENT_CONTENT；沒有current content先取actor可見IMPORT_DRAFT／PENDING CREATE。pending draft readiness同問題另以「待審版本」標示。`readiness` filter沿用呢個「current優先、無current先用可見draft」規則；要找pending draft問題使用`workflow=PENDING`及`issues=PENDING_DRAFT`，避免ACTIVE詞因未生效草稿而被誤列為目前不可出題。

#### Readiness同問題摘要嘅權威來源

列表不得解析現有英文 `validationErrors` 字串或只靠enable flags推斷「安全出題」。各類row採用以下effective payload：

- 已建立sense：目前approved revision係CURRENT_CONTENT；actor可見pending request另作PENDING_DRAFT，兩者分開驗證及顯示。
- source-only baseline draft：以目前import row payload作IMPORT_DRAFT。
- standalone pending CREATE：只對owner／reviewer以request payload作PENDING_DRAFT；其他老師完全不可見。

正式catalog validator要原生回傳stable structured issue code、field及direction；preview、submit、finalize、reactivate同workspace presentation共用同一validator入口。page rows嘅sibling context要一次批量載入／normalize，禁止逐row N+1。完整資料集readiness／facet若無法由現有projection準確、安全且有界地計算，就按第5.4節建立revision-bound可重建read projection；唔可以以不完整嘅 `validationErrors=[]` 當作「沒有問題」。

### 8.4 Filter option metadata

詞性及主題選項不得只由當前 page rows 推算。可選方案：

1. 在列表 response 同時回 actor 可見完整資料集嘅 facet counts；或
2. 新增受同一權限守衛保護嘅 `/api/catalog/facets`。

採用self-excluding facet counts：計算某一維度時套用其他filters，但暫時移除該維度本身條件；已選中但目前為0嘅值仍保留，並顯示0。選擇實作方式嘅準則：

- 查詢一次可重用；
- 不洩露 hidden draft；
- cache key至少包含 `workspaceSignature`（包括catalog mutation revision及pending digest）、`actorScope`、facet dimension及「移除自身維度後」嘅canonical filters；普通老師actor scope必須包含user ID，reviewer先可共用reviewer scope。亦可共用public catalog facets，再request-local合併該老師自己可見草稿；不可只按角色或catalog revision共用cache；
- category／part-of-speech label 經相同 canonical mapping；
- 5,000+ sense 下不造成每次 filter 都 full-table Node.js aggregation。

## 九、文案、i18n 及可存取性

- 建立集中式 `catalog teacher presentation` mapping，統一 status、kind、source、part of speech、category、direction、validator issue 文案。
- `src/lib/i18n/convert.ts` 在 zh-Hant conversion 後套用窄範圍 canonical correction，保證「干擾項」不被轉為「幹擾項」；不可全域任意替換會影響「干涉／干預」等其他字。
- raw API code 仍可留於 log／diagnostic，但畫面必須有老師可行動訊息。
- table／list 使用正確 heading、row label、button accessible name；只靠顏色不可表達狀態。
- drawer／sheet 要有 dialog semantics、focus trap、Esc 關閉、focus return；更新結果以適當 `status`／`alert` 通知。
- overflow menu 必須可用 keyboard 操作，並避免同一行重複相同 accessible name。
- 繁體及簡體文案均驗證；產品 canonical 規格同計劃以繁體為準。

## 十、實施階段

### Phase 0：建立現況基線及 presentation contract

- [ ] 保存 desktop／tablet／mobile 現況截圖、首屏 row 數、列表 request 數及代表性長內容樣本。
- [ ] 盤點所有 raw enum、technical key、validator message 同「幹擾」出現位置。
- [ ] 盤點現有 part-of-speech／category 真實 distinct values、空值及非英文字首詞條。
- [ ] 定義生命週期、工作流程、出題狀態、問題scope、歷史文案及欄位 label exhaustive mappings。
- [ ] 建立 teacher-facing sense identity contract；確認毋須另加詞義序號。
- [ ] 記錄現有 `/api/catalog` cursor／privacy contract，建立 backward compatibility 測試。
- [ ] 確認每類row嘅effective payload及structured validator issue來源；量度批量sibling validation，決定需唔需要additive read projection。

### Phase 1：術語及老師可讀 presentation layer

- [ ] 修正「干擾項」轉換規則及 regression tests。
- [ ] 新增集中式 status／action／source／POS／category／issue label helper。
- [ ] 將 raw validator message 轉成 structured issue code＋老師可讀說明。
- [ ] 為未知 enum／issue code 加安全 fallback 及 diagnostic。
- [ ] 確保普通老師看不到 technical key／未授權 draft detail，reviewer advanced view仍可查核。

### Phase 2：完整資料集 server-side 篩選及排序

- [ ] 擴充 query parser，嚴格驗證 lifecycle、workflow、POS、initial、category、readiness、issues、sort，並保留舊status compatibility window。
- [ ] 實作 A–Z／其他 initial normalization，涵蓋大小寫、空白、符號及非拉丁字首。
- [ ] 實作self-excluding facet metadata，cache綁定workspace signature、actor-specific visibility、dimension及canonical filters。
- [ ] 為所有排序建立 deterministic DB order、cursor payload及filter fingerprint v2。
- [ ] 實作「需要處理優先」而不洩露其他老師 pending draft。
- [ ] 以正式 5,000+ baseline 執行 `EXPLAIN`／query count；只有準確性／效能證據需要時才新增revision-bound read projection或index migration。

### Phase 3：響應式緊湊列表及一致操作

- [ ] 重構 desktop native table、header、欄目及 row density；每個breakpoint只render一套interactive DOM。
- [ ] 實作 tablet／mobile compact card layout。
- [ ] 統一「查看／修改」、「報告問題」、「歷史」操作層級、尺寸、順序及 feature-flag visibility。
- [ ] 隱藏 ordinary list technical metadata；detail 加入友善版本及 reviewer-only進階資料。
- [ ] 實作生命週期、工作流程、出題狀態及按scope區分嘅「N 項內容需修正」詳情。
- [ ] 實作篩選 toolbar、chips、清除、排序及 loading／empty／error states。
- [ ] 保留 CSV 勾選、bulk export、pending draft、immediate retire、feedback、retry 及 question preview 原有能力。

### Phase 4：逐詞歷史 drawer 及全域歷史可讀化

- [ ] 抽出可共用嘅 history timeline／diff presentation components。
- [ ] 從列表開啟逐詞 history drawer，不卸載完整詞庫。
- [ ] 以最外層typed reducer保存搜尋、篩選、排序、loaded pages、checkbox selection、scroll anchor及focus，覆蓋drawer同全域history tab返回。
- [ ] 為逐詞history建立signed keyset cursor、25／50 page limit、snapshot cutoff及actor／sense scope。
- [ ] 為 history request 加 AbortController、generation／intent freshness及unmount cleanup。
- [ ] 將 source kind、request kind、status及actor action全部翻譯成老師文案。
- [ ] 將 request／audit事件組合成老師可讀 timeline，同時保留 immutable event evidence。
- [ ] technical metadata只放 reviewer advanced details，並維持原本 history DTO privacy。
- [ ] 全域歷史頁返回完整詞庫時保留父層 catalog view state；直接 URL 進入則使用安全預設狀態。

### Phase 5：驗證、文件及本地驗收

- [ ] 完成 unit、API／DB、browser、a11y、responsive及regression matrix。
- [ ] 由至少一名不參與開發嘅英文老師以任務腳本試用搜尋、修改、問題、歷史及返回流程；未有代表性老師時標記為 deferred，不以開發者自測冒充。
- [ ] 比較改動前後首屏 row 數、查詢延遲、rows read、response size及keyboard操作步數。
- [ ] 更新相關操作指引、計劃索引、總計劃P7狀態及實際測試紀錄。
- [ ] 確認無 schema／migration 時清楚記錄；若新增 index，完成 checksum、fresh replay及rollback證據。
- [ ] 本地 UAT 通過後先將本計劃狀態改為「已完成（本地 implementation／verification）」；production仍獨立審批。

## 十一、測試矩陣

### 11.1 Unit

- 繁體「干擾項」及簡體「干扰项」轉換後仍正確，均不出現「幹」字。
- 所有 status／kind／source／POS／category／issue code 有預期 label；未知值安全 fallback。
- lifecycle、workflow、readiness同issue scope四者不互相覆蓋；ACTIVE＋pending UPDATE仍同時顯示兩個狀態。
- initial normalization：A／a、前置空白、hyphen、數字、中文、空值。
- 每個 sort 嘅 filter fingerprint、cursor version及tie-breaker穩定。
- teacher-facing identity對同拼法不同詞義有足夠辨識度。
- structured validator issue直接由共用validator產生，不解析raw英文錯誤字串。

### 11.2 API／DB

- lifecycle、workflow、POS、initial、category、readiness、issues及組合篩選作用於完整資料集，不只當前 page。
- A–Z、Z–A、最近修改、程度、需要處理排序跨 page 無重複、無漏項。
- 改篩選或排序後重用舊 cursor會被安全拒絕。
- 普通老師、提案 owner、reviewer三種身份嘅 pending／history／issue detail visibility不變。
- self-excluding facet count同移除自身維度後嘅實際total一致；已選中0-result值仍保留。
- facet cache不能喺兩個普通老師之間洩露owner-only pending CREATE嘅category／詞性／count。
- 5,000+ senses查詢不做全量 Node.js aggregation，query count有上限。
- 逐詞history跨頁無重複／漏項；cursor不可跨sense、actor scope或snapshot重用。
- ACTIVE＋pending UPDATE、RETIRED＋pending REACTIVATE、DRAFT＋pending CREATE，及批准／拒絕後四個presentation維度同步更新。

### 11.3 Browser／E2E

- desktop列表欄目清楚、操作水平排列、首屏密度達標。
- tablet／mobile無overflow，overflow menu、drawer及filter sheet可用keyboard／touch。
- 篩選草稿後開某詞歷史，關閉後仍停留同一 filters／sort／scroll／row。
- 完整詞庫開某詞 → 全域修改歷史 → 返回，仍保留loaded pages、selection、filters、sort、scroll anchor及focus。
- A history慢回應後開B，A不得覆蓋B；關閉後舊回應不得重開drawer。
- 全域歷史顯示老師文案、before／after diff，不出現 raw enum／technical key。
- feature flags關閉 bulk／history時所有相關入口一致隱藏。
- 「N項內容需修正」可展開實際中文原因及修正方法。
- 普通老師不得從列表、drawer、DOM或network response取得其他老師未批准payload。
- 逐條修改、審核、停用、重新啟用、feedback、題目預覽及CSV匯出原有流程無回歸。
- native table header／cell關聯、keyboard focus order、更多操作menu開關／Esc／focus return、drawer title／description／來源詞accessible name及200% zoom reflow通過。

### 11.4 建議驗證指令

```bash
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit
npm run build
npm run check:catalog-workspace-pagination
npm run check:catalog-governance
DATABASE_ENVIRONMENT=development \
CONFIRM_DATABASE_ENVIRONMENT=development \
npm run test:e2e:catalog-workspace
git diff --check
```

若涉及 index migration，另執行：

```bash
npm run test:migration-checksums
npm run test:migrations
```

任何需要本機 PostgreSQL嘅指令先核對環境；sandbox連線失敗要按項目規則以獲准權限重試，不得誤報資料庫不存在。

## 十二、效能預算

- catalog list初次 request維持單一主要資料查詢＋有界facet查詢；避免每個 row額外查詢。
- 50-row page response不新增完整payload／完整history；issue只傳有界structured summary。
- 固定使用同一個5,000+ sense database snapshot、同一部本機、普通老師及reviewer兩種scope、至少8組代表查詢（page 1及深頁；A–Z、level、lifecycle、workflow、readiness、issues、category、UPDATED_DESC），cold cache與warm cache分開，每組至少30次量度。
- 常用查詢warm-cache p95不可較現有server-pagination同scope基線惡化超過20%；同時記錄絕對時間、SQL query count、rows、buffers、response bytes及query plan。若環境波動，以同一run內before／after交錯量度，唔單靠單一毫秒門檻。
- drawer只在使用者開啟時載入該sense history，並有pagination；不可預先載入全頁所有歷史。
- facet cache必須包括workspace signature及actor-specific scope；任何cache key不得忽略owner-only draft可見性或pending digest。

## 十三、風險及控制

| 風險 | 控制方法 |
|---|---|
| server排序改變造成cursor重複／漏項 | cursor v2、完整filter fingerprint、穩定tie-breaker、跨頁DB測試 |
| 「需要處理優先」洩露其他老師草稿 | server先套用visibility／redaction再產生actionable summary |
| 隱藏technical key後支援人員難查 | reviewer-only進階資料提供copy key；audit資料不刪除 |
| lifecycle、workflow、readiness、issues再次混合 | 使用四個正交typed presentation fields同組合測試矩陣 |
| validator文案與正式規則漂移 | 共用issue code mapping；preview、submit、list使用相同validation來源 |
| history drawer慢回應覆蓋新選擇 | shared intent／generation、AbortController、close/unmount invalidation |
| 返回位置只保存filter但失去loaded pages | 父層typed reducer持有完整view state；drawer overlay；全域tab browser test覆蓋cursor、selection、scroll、focus |
| OpenCC修正影響其他中文字 | 窄範圍canonical post-conversion replacement＋精確unit tests |
| desktop密度改善犧牲可讀性／觸控 | 真實長文案、四種viewport、keyboard、screen-reader及touch target驗收 |
| facet或排序拖慢5,000+詞庫 | DB aggregation、query plan、cache；有證據先加index |
| facet cache洩露owner-only草稿分類 | workspace signature＋actor-specific scope，或public cache加request-local owner merge |
| URL保存自由文字搜尋造成私隱／history洩露 | URL只保存非敏感enum filters；自由文字及loaded cursor留在父層state |

## 十四、發布及 rollback

### 14.1 本地發布順序

1. presentation／i18n helper及測試；
2. additive query／DTO contract；
3. 緊湊列表及filters；
4. history drawer／timeline；
5. DB／browser／a11y驗證；
6. 代表性老師UAT；
7. 更新計劃狀態。

### 14.2 Compatibility

- 新query params同response presentation fields採additive方式。
- 未帶`sort`嘅舊client固定保留現有`SOURCE_ORDER`；新老師UI明確傳`TERM_ASC`。
- 舊`status`filter保留compatibility window並由server轉譯；新UI只傳正交filters，cleanup另行審批。
- 舊cursor v1只配合legacy query；新cursor v2綁定完整filters、sort、workspace signature及snapshot。不兼容時回`CATALOG_CURSOR_CONTEXT_MISMATCH`，client清除cursor重新載入。
- 不改寫已批准revision、history或學生current reader。

### 14.3 Rollback

- UI有問題可回退到現有catalog row component，同時保留additive API fields。
- history drawer可回退到全域history tab，不涉及資料回滾。
- 若新filter／sort查詢效能未達標，暫時隱藏對應控制並保留既有server pagination。
- 若新增index，只可用獨立、經批准嘅rollback migration；不得修改已套用migration。
- 本計劃不授權production deploy，production rollback另按`DEPLOY.md`。

## 十五、Definition of Done

- [ ] 一般老師完整詞庫畫面不再顯示 raw `senseKey`、raw enum、raw revision或完整source path。
- [ ] 同拼法不同詞義可由詞性、主要中文釋義及程度清楚區分。
- [ ] 繁體老師介面使用「干擾項」、簡體使用「干扰项」，並有轉換regression。
- [ ] lifecycle、workflow、readiness及issue scope分開呈現，沒有「方向被阻擋」或含糊「1個問題」。
- [ ] 1440×900、100% zoom固定基線下desktop首屏詞條密度至少為現況兩倍；mobile／tablet無overflow及操作退化。
- [ ] lifecycle、workflow、POS、A–Z、category、readiness、issues及sort由server對完整詞庫運作，跨cursor無漏項／重複。
- [ ] 從某詞條查看歷史後，原filters、sort、loaded pages、selection、scroll及focus全部保留。
- [ ] 逐詞history使用signed pagination，同一cursor不可跨sense／actor重用。
- [ ] 歷史顯示老師可讀事件、狀態及before／after差異；technical資料只在適當進階區。
- [ ] 普通老師／owner／reviewer可見性同現有privacy contract一致。
- [ ] 原有提交、單人審核、immediate retire、feedback、retry、題目預覽及CSV流程無回歸。
- [ ] unit、lint、typecheck、build、catalog DB checks及代表browser matrix通過；未執行external gate清楚記錄。
- [ ] 相關操作指引、計劃索引及總計劃P7已同步更新。

## 十六、決策紀錄

| ID | 決策 | 理由 |
|---|---|---|
| CTW-001 | 普通列表隱藏technical sense key | 老師需要辨認詞義，不需要背資料庫識別碼 |
| CTW-002 | 以term＋詞性＋主要釋義＋程度識別詞義 | 可直接對應教學語義，亦能處理同拼法多詞義 |
| CTW-003 | lifecycle、workflow、readiness及issue scope分拆 | 四者語義同處理方法不同，而且ACTIVE可以同時有pending UPDATE |
| CTW-004 | desktop採native table，tablet／mobile採單一compact responsive結構 | 同時提高desktop密度、保持窄屏可讀性及避免重複interactive DOM |
| CTW-005 | 逐詞歷史使用drawer；全域歷史tab保留 | 返回準確位置，同時保留跨詞／批次歷史搜尋 |
| CTW-006 | 所有新增篩選及排序由server執行 | cursor分頁下client-side排序只會處理局部資料，結果不正確 |
| CTW-007 | canonical術語固定為「干擾項」 | 符合產品用詞並避免OpenCC誤轉 |
| CTW-008 | 不改正式審批、權限及並發模型 | 現有單一pending＋revision CAS已處理衝突，本輪只改善可用性 |
| CTW-009 | 不改業務真相；準確性／效能證據支持先加read projection或index | 保持治理模型穩定，同時不以不完整資料假裝readiness準確 |
| CTW-010 | facet cache綁workspace signature及actor-specific scope | 普通老師可見自己私人草稿，單按角色共用cache會洩露分類資訊 |
| CTW-011 | 舊client保留SOURCE_ORDER，新老師UI明確使用TERM_ASC | 保持additive compatibility，同時提供老師預期嘅A–Z預設 |
| CTW-012 | 全域tab view state由最外層typed reducer持有 | 現有條件式掛載會卸載子workspace，必須明確保存loaded pages及返回位置 |

## 十七、尚待外部驗收

- 代表性英文老師完成搜尋、修改、審核、問題回報及歷史任務UAT。
- VoiceOver／TalkBack及實體iOS／Android完整裝置矩陣。
- staging／Vercel 5,000+詞庫查詢、facet cache及並發驗證。
- production migration／deploy／monitoring及rollback演練。

以上項目未完成前，只可宣稱「本地 implementation／verification完成」，不可宣稱production-ready。

## 十八、計劃審核紀錄

2026-08-26 由兩個獨立sub-agents以唯讀方式完成對抗式審核：

- Reviewer A（老師UX／資訊架構／responsive／a11y）原判定`REQUEST CHANGES`，指出pending唔可取代lifecycle、問題需要scope、全域history返回state owner未定、breakpoint操作及密度基線含糊。
- Reviewer B（API／cursor／privacy／效能／rollback）原判定`REQUEST CHANGES`，指出同一狀態問題、facet cache actor leakage、readiness權威來源、逐詞history pagination、舊status／sort compatibility、actor display及量測方法未定。

本版已逐項跟進：

- 將lifecycle、workflow、readiness、issue scope改成四個正交contract；
- facet採workspace signature＋actor-specific scope，並定義self-excluding counts；
- 明確effective payload、structured validator及可選revision-bound read projection；
- 明確signed逐詞history cursor、snapshot、privacy及page limit；
- 固定舊client `SOURCE_ORDER`、新UI `TERM_ASC`同status compatibility window；
- 固定父層view-state ownership、三種breakpoint操作、a11y、術語、密度及效能量測基線；
- 確認不修改既有審批、權限、revision、學生學習或詞庫生命週期。

兩位reviewer其後再對修訂版進行delta覆核，最終均判定`PASS`，沒有未解決blocker；最後一輪非阻擋精確化（正式狀態名稱、舊status原predicate、`lastChangedAt`公式、timeline group cursor及DoD欄位）亦已納入本版。
