# 詞庫 CSV 批量提交及詞條修改歷史界面實施計劃

> 狀態：待審批（兩個獨立 Subagent 最終 targeted re-check 均 PASS；未開始實作）
>
> 日期：2026-08-22
>
> 工作 branch：`codex/word-catalog-governance-and-lifecycle`
>
> 上游計劃：[詞庫詞義、CSV 匯入、審核及生命週期實施計劃](./word-catalog-governance-and-lifecycle.md)
>
> 資料規範：[英語詞庫編寫、匯入及質量檢查標準 v1](./artifacts/word-catalog-authoring-standard-v1.md)
>
> 範圍：CSV 批量草稿提交、批次審核／原子套用、修改歷史查詢及管理員／老師界面；不包括 production deploy 或 destructive migration

## 1. 背景

目前 `/admin/words` 及 `/teacher/words` 已經可以查看完整 current READY 詞庫、逐條建立／修改／停用／重啟申請，並由管理員或具有
`canManageWordCatalog` capability 的老師審核。正式學生 runtime 只讀 `ACTIVE + approved revision + READY catalog`，草稿不會直接影響學生。

尚欠兩個日常治理能力：

1. 老師及內容團隊只能逐條輸入，未能將按 `word-catalog-v1` 編寫的 CSV 一次過預覽、修正衝突及提交成待審申請；
2. 現有 `CatalogChangeRequest`、`WordSenseRevision` 及 `CatalogAuditEvent` 已保存部分審計資料，但沒有可搜尋、可比較 before／after、可按詞條追溯的歷史界面。

呢兩項功能互相依賴：批量提交會一次產生多個 change request；歷史頁必須能夠將每個詞義修改連回所屬批次，同時仍然正確顯示既有逐條提交。

## 2. 現況及可重用基礎

| 範圍 | 現況 | 本計劃處理方式 |
|---|---|---|
| CSV parser／validator | `src/lib/catalog/csv.ts` 已支援 39 欄 bootstrap CSV，但目前硬性只接受 `CREATE_DRAFT` | 抽出共用 parse／normalize／content validation，再新增 governance import mode，避免改壞 seed contract |
| 正式 seed batch | `CatalogImportBatch`／`CatalogImportRow` 代表 source digest 及 current READY baseline | 保持只供 canonical seed／reconciliation；另建 submission batch，避免將暫存上載誤當正式 catalog revision |
| 單條申請 | `CatalogChangeRequest` 支援 CREATE／UPDATE／RETIRE／REACTIVATE、operationId、revision CAS 及 self-review block | 批次由多個 source rows整理成 final proposal groups；每個 group建立一個immutable change request並保留完整source lineage |
| 單條批准 | `PATCH /api/catalog/requests/[id]` 會在同一交易即時建立 revision／改 lifecycle | 抽成共用 domain service；單條路由及批次 final commit 使用同一 validator、duplicate check、lock order 及 audit writer |
| Audit | `CatalogAuditEvent` 有 request、sense、actor、action、狀態及 metadata | 增加 batch linkage及穩定查詢索引；歷史 UI 以 request／revision／event 組合還原，不重寫 audit |
| 治理 UI | 一個大型 `CatalogGovernanceWorkspace` 同時載入全詞庫及最多 1,000 個 pending request | 拆成詞庫、批量提交、修改歷史三個 view；queue／history 改用 server cursor pagination |
| 權限 | ADMIN 可審核；TEACHER 由 `canManageWordCatalog` 決定；proposer 不得自批 | 完全沿用三角色及 capability，不新增角色 |

## 3. 目標

1. 一般老師、capability 老師及管理員可以上載 `word-catalog-v1` CSV，先預覽而不修改正式詞庫，再提交成 immutable 待審批次。
2. 新增及更新詞義可在同一 CSV 混合；新資料 keys 留空，更新資料必須來自系統匯出並帶 stable keys 及 expected revision。
3. 每行都有明確 disposition、database diff、錯誤／警告及 duplicate bundle；未解決 blocking conflict 不可提交。
4. 提交批次時所有 proposal-group change requests 全部成功或全部失敗；審核完成時，獲批准 proposal groups 亦以一個 Serializable transaction 全部套用或全部不套用。
5. preview 到提交、提交到批准之間均重跑權限、revision、identity、duplicate、taxonomy、answer-safety 及 sibling-sense checks，杜絕 TOCTOU／last-write-wins。
6. 管理員及老師可搜尋已生效修改歷史；審核人可以查看完整 pending／rejected／batch audit，提交者可以追蹤自己所有申請。
7. 歷史詳情可顯示 before／after、欄位差異、提交理由、審核備註、actor、時間、batch lineage及 lifecycle timeline。
8. 保持學生題目、Review、排行榜及統計 contract 不變；只有獲批准的 ACTIVE revision 才會影響新學習。

## 4. 非目標

- 不把上載 CSV 當成 runtime source；PostgreSQL approved revision 仍是唯一 canonical source；
- 不覆蓋或改變既有 digest-bound initial baseline manifest；日常 CSV 上載不重跑 seed；
- 使用者上載 CSV 第一版不支援 `REQUEST_RETIRE`、`REQUEST_REACTIVATE` 或緊急撤回；呢啲高影響 lifecycle 動作繼續使用逐條申請。唯一例外係由已COMMITTED批次產生的system corrective preview，可以為原CREATE group明確建立RETIRE proposal，仍須重新preview及另一人批准；
- 不因 CSV 缺行自動停用、刪除或隱藏任何詞義；
- 不接受 XLSX、Google Sheet URL、ZIP 或外部字典連線；
- 不自動生成、改寫、翻譯或補足詞義、例句、音標或干擾項；
- 不在歷史頁提供修改／刪除 audit 的能力；
- 不在本計劃完成 global monotonic catalog lifecycle revision／as-of analytics；歷史排序不冒充該項未完成能力；
- 不執行 production migration／deploy、真實教師 rollout、V1 destructive cleanup 或完整原生裝置矩陣。

## 5. 已定產品及安全決策

### 5.1 CSV 支援範圍

- 檔案必須係嚴格 UTF-8 CSV，可有且只可有檔首一個 BOM；header 必須包含 39 個精確 `word-catalog-v1` 欄名、每欄恰好一次，不要求上載檔跟 template 列序，但 template／export 固定使用規範標準次序；
- launch 上限為 5 MiB、200 個 data rows；0 行、超限、重複 header、未知欄、broken quoting、公式／CSV injection 或非支援 schema 一律拒絕；
- `CREATE_DRAFT`：`catalog_key`、`sense_key`、`record_revision`、`catalog_status` 必須留空；
- `UPDATE_DRAFT`：必須由系統匯出，保留 `catalog_key`、`sense_key`、`record_revision` 及只讀 `catalog_status`；lemma 不可越過既有穩定 headword boundary；
- 同一檔案可以混合 CREATE／UPDATE，但不接受其他 `requested_action`；
- launch cap 只服務日常治理，不取代 5,641 行 initial bootstrap。性能測試通過後可以調高 cap，但不得犧牲單批原子性；
- CREATE template 預填 `schema_version`／`requested_action`、保留 system／reserved 欄並附獨立繁簡說明、POS／category 對照及一行示例；示例不混入可上載資料；
- UPDATE template 只由使用者明確選取最多 200 個有 stable sense key／latest revision、而且沒有 pending content request 的既有 sense 產生；ACTIVE、DRAFT、RETIRED 均可匯出修訂，validation-failed source row、standalone pending CREATE及已有 pending UPDATE 的項目要排除並顯示原因；
- 全詞庫或 filter 結果超過 200 項時不產生一個無法重新上載的檔案，UI 要求再篩選／分批選取。

### 5.2 批次原子性

- **Preview** 可以持久化暫存 row 及報告，但不得建立／更新 `WordSense`、approved pointer或 `Word` projection；
- **Submit** 將所有已納入且可提交的 final proposal groups 原子建立成 `CatalogChangeRequest`；任何 unresolved conflict、stale revision 或 request identity 問題令全批不提交；
- `NO_CHANGE` 及使用者明確 `EXCLUDE` 的 source rows 保留在批次報告但不進proposal group；至少要有一個可提交 proposal group；
- 審核決定以 final proposal group 為單位；一個 group 可以保留多個來源 rows，但只會建立一個 request；儲存決定不改正式詞庫；
- **Finalize** 只在所有 committable proposal groups 已有決定後進行。所有「批准」groups 在同一 Serializable transaction 重新驗證並套用；任何一組 stale／conflict，全部批准 groups 都不套用，批次標為 `STALE`；
- 拒絕 groups 同一交易轉為 REJECTED。已批准 subset 的「部分」係審核人明確逐組選擇的結果，不係交易中途失敗造成的 partial write；
- 每組保存 `payloadDigest`、`lastContentAuthorId`、所有 material author lineage、`reviewedPayloadDigest`、`decidedById` 及 `decidedAt`；payload 變更即清除舊 review decision／viewed state；
- batch final reviewer 不得係 uploader、任何 material proposal author或目前 reviewer 本人曾修改的 digest，即使係 ADMIN；finalize 需要仍然有效的 review capability及 recent-auth grant。
- submit 為每個 proposal group 產生 deterministic、互不相同的 request operation ID；batch operation ID 只識別批次，唔會直接複製到200個 requests；
- finalize 發現 stale 時，在確認零 canonical write 的同一交易將該批所有 `PENDING` requests 轉為 `CANCELLED`，並寫結構化 `BATCH_STALE` 原因；clone 建立全新 batch／requests並保存 supersedes lineage，terminal batch不得殘留普通 PENDING request。

Batch lifecycle 固定如下；`FINALIZING` 只係同一DB transaction內部guard狀態，不可以成為API可觀察的長期狀態：

```text
PREVIEW → NEEDS_RESOLUTION → PREVIEW → SUBMITTED → REVIEWING → REVIEWED
PREVIEW／NEEDS_RESOLUTION → EXPIRED／CANCELLED（未有child request，可直接terminal）

COMMIT:
lock actor／mutation state／batch
→ REVIEWED → FINALIZING
→ apply approved groups + terminalize all child requests
→ COMMITTED 或 REJECTED
→ deferred invariant check

STALE／CANCEL／SUPERSEDE after submit:
lock actor／mutation state／batch
→ SUBMITTED／REVIEWING／REVIEWED → FINALIZING
→ terminalize all PENDING child requests with structured reason
→ STALE／CANCELLED／SUPERSEDED
→ deferred invariant check
```

以上transition、child terminalization、audit及最終batch狀態全部同一transaction；失敗就全數rollback，唔可以留下一個持久化`FINALIZING` batch。

### 5.3 Duplicate／conflict resolution

Preview row 的 primary disposition 使用以下互斥值；`warnings[]` 另外保存，唔把 `WARNING` 當 primary disposition：

```text
VALID_NEW_DRAFT
VALID_UPDATE_DRAFT
NO_CHANGE
CONFLICT
ERROR
EXCLUDED
```

衝突按 normalized lemma 分組，並顯示 file row、目前資料庫 sense、同檔其他 rows及字段 diff。處理結果沿用 authoring standard：

```text
MERGE_SAME_SENSE
KEEP_DISTINCT_SENSES
LINK_AS_VARIANT
REPLACE_DRAFT
REJECT_SUBMISSION
ESCALATE_TO_REVIEWER
```

- 系統不得「自動揀較完整一行」；MERGE／LINK／REPLACE 先建立 `CatalogSubmissionProposalGroup`，保存所有來源 rows、row role、target sense、field-level final proposal、處理理由、處理人及 payload digest；
- 多個 duplicate rows merge 後只產生一個 proposal group／change request；每個原始 row 仍以 `CANONICAL_SOURCE`、`MERGED_SOURCE` 或 `EXCLUDED` 保留 lineage；`LINK_AS_VARIANT` 可以將原 CREATE 轉為對既有 sense 的 UPDATE proposal；
- 一般老師可以提出 resolution；授權 reviewer可以確認關聯或協助編輯 final payload，但任何 material 編輯都令該 reviewer成為 content author，proposal 轉為 `SECOND_REVIEW_REQUIRED`，必須由另一位未參與內容編寫的 capability老師／管理員批准；
- `ESCALATE_TO_REVIEWER` 會令 batch 進入 `NEEDS_RESOLUTION` queue。授權 reviewer要先 claim 才可處理，完成後交回 owner；未形成明確 final proposal 前阻擋 submit，但 owner可以明確 EXCLUDE衝突 rows後提交其餘groups；
- exact-sense duplicate、key collision、stale revision、同詞 sibling-answer collision及候選池多正解不可只用 warning 略過；
- 修正內容必須建立新 preview digest；已提交批次 immutable，若要改 payload 就 clone 成新 preview，原批次保留 superseded lineage；
- PREVIEW／NEEDS_RESOLUTION 由最後有效 author／reviewer activity 起計 7 日到期，creation起計最多30日；claim／release／轉交全部寫audit，唔可以無限期鎖住批次。

### 5.4 `catalog-review-risk-v1`

Review risk係versioned server policy，唔由UI或reviewer自行選：

| Risk | 定義 | 審核要求 |
|---|---|---|
| `MATERIAL_CONTENT` | CREATE；或者任何 term、lemma、POS、level、category、definition、accepted answers／forms、IPA、例句、synonym／antonym、direction flag、distractor pool、sense identity、lifecycle或學生啟用資格改動 | 必須逐group打開；reviewed digest要匹配；content author不得finalize |
| `MATERIAL_RESOLUTION` | MERGE、KEEP_DISTINCT、LINK、REPLACE、任何conflict disposition或system corrective RETIRE | 同上，而且finalizer要確認完整source lineage及target |
| `LOW_RISK_METADATA_ONLY` | 只有 `source_reference`、`contributor_ref` 或非canonical contributor/change note改動；不改任何學生內容、answer-safety、身份、狀態或資格，且零warning／conflict | 仍要reviewed digest；只有呢類group先可使用受限bulk approve |

任何未列明欄位或risk分類失敗一律當material。Batch／proposal保存`reviewRiskVersion`及分類理由；payload、resolution或policy version改變就清除已審狀態。邊界測試逐欄證明所有學生顯示／正解／程度／干擾／啟用相關改動都不能落入low-risk。

### 5.5 歷史可見性

| 使用者 | 可見內容 |
|---|---|
| ADMIN | 全部 batch、requests、proposal、review notes、actor及技術 audit |
| TEACHER + capability | 同 ADMIN 的詞庫治理歷史，但不因此取得其他管理員能力 |
| 一般 TEACHER | 全校已批准／已生效的 public catalog content diff、kind及生效時間，但不顯示其他人的 actor、batch note、reason、review note或技術 metadata；自己提交的 pending／rejected／cancelled可看完整payload、自己理由及結果備註 |
| STUDENT | 無詞庫治理歷史 API／UI 權限 |

一般老師完全看不到其他人的 pending／rejected／cancelled request或batch，猜中 id 時 detail endpoint 固定回404，避免資源存在性洩漏；自己申請亦不顯示 reviewer技術identity。所有權限都由 Route Handler／service 再驗證，不能只靠 UI 隱藏。回應使用 `private, no-store`，不在 log、URL query或下載檔名放完整詞義內容或個人資料。

API及UI固定使用三種不同DTO，唔先回完整資料再由client隱藏：

- `PublicApprovedHistoryDTO`：sense key、public before／after catalog fields、kind、生效時間、batch group摘要；不含proposer／reviewer、reason、batch note、review note、operationId或file metadata；
- `OwnerHistoryDTO`：只供自己的申請，在public fields之外加自己提交payload、reason、batch狀態及結果備註；不含reviewer技術identity或其他老師內容；
- `ReviewerHistoryDTO`：capability老師／ADMIN可見完整actor、proposal、reason、review note、resolution、audit及技術metadata。

## 6. 使用者流程及界面

`/admin/words` 及 `/teacher/words` 共用同一 responsive workspace，頂部改為三個可直接連結的 view：

```text
詞庫總覽 | CSV 批量提交 | 修改歷史
```

只有 view、status、kind、level、category及不含actor的日期等非敏感 enum filter寫入 URL query，重新整理／返回時可恢復；自由文字、actor及內部備註搜尋留在頁面／session state並以JSON body送到受權限保護的search endpoint。不建立兩套 admin／teacher UI。

### 6.1 CSV 批量提交 wizard

1. **下載／選擇格式**：下載新增 template，或按目前詞庫 filter 匯出 UPDATE template；清楚標示只接受 CSV、200 行及不支援批量停用；
2. **上載**：drop zone＋檔案選擇器，顯示檔名、大小、row count及 schema version；
3. **預覽**：摘要卡顯示新增、更新、無變更、警告、衝突、錯誤；row table 可按 disposition／level／category／action／lemma filter；
4. **比較／解衝突**：desktop 使用左右 before／after diff，tablet／mobile 使用逐欄堆疊卡；duplicate bundle 顯示同詞其他 sense，唔只顯示「有重複」；
5. **提交草稿**：顯示來源 rows、final proposal groups、實際會建立的 request 數及不會提交的 rows，要求 batch note；提交後顯示 receipt、狀態及審核入口；
6. **錯誤報告**：可下載 UTF-8 BOM CSV，包含 row number、Excel column、field、term、action、disposition、stable error code、跟目前locale的訊息、具體修正方法及 target sense key；所有儲存格做 formula neutralization。

「我的批次」列表可重新找到 PREVIEW、NEEDS_RESOLUTION、SUBMITTED、STALE、COMMITTED及CANCELLED項目；授權老師另有「待解衝突／待審批次」queue。UI 顯示7日activity expiry及30日absolute expiry。失效、取消或 stale 批次提供「重新上載／複製成新批次」，不容許修改 frozen submitted payload。

### 6.2 批次審核

- reviewer queue 先顯示 batch 摘要，不將 200 行全部擠入首頁；同一時間由一位 reviewer claim整批，release／transfer要有audit；
- batch detail 可按未決／批准／拒絕／警告／create／update filter；每行顯示 before／after、validation、resolution及提交理由；
- 批量批准只可用於已逐組打開、`reviewedPayloadDigest` 等於目前 digest、無warning且由 `catalog-review-risk-v1` 判定為 `LOW_RISK_METADATA_ONLY` 的group；`MATERIAL_CONTENT`、`MATERIAL_RESOLUTION`及CREATE必須逐組打開確認，server finalize再硬性檢查；
- 批量拒絕可以保留，但必須填batch-level理由；每個group保存繼承理由，審核人仍可另填逐組備註；
- reviewer 可以儲存進度，最後按「完成審核並套用」；按鈕旁明示批准／拒絕數、原子性及 recent-auth 要求；
- self-review、stale preview、current capability 被撤銷或其中一行驗證失敗時，畫面保留決定並指出要重新 preview／交另一位 reviewer；
- focus management、keyboard table controls、error summary、screen-reader status announcement、zh-Hant／zh-Hans及 light／dark theme 必須同現有產品一致。

### 6.3 修改歷史

預設 feed 將逐條提交顯示為一個 request，將 CSV 批量提交顯示為一個 batch group，避免200行批次立即淹沒四頁歷史；group先顯示新增／更新／批准／拒絕數，再展開 individual requests。每個request仍有permalink，每個sense仍有獨立timeline。支援：

- filters：英文詞／normalized lemma、sense key、catalog key、CREATE／UPDATE／RETIRE／REACTIVATE、PENDING／APPROVED／REJECTED／CANCELLED、level、category、提交者、審核者、batch、日期欄位（提交／決定／最後活動）及日期範圍；日期邊界及顯示一律採Asia/Shanghai；
- cursor pagination：預設 50、最大 100，按共同immutable `(occurredAt, sourceKind, feedEntryId)` 穩定倒序並綁定 snapshot cutoff，不再一次載入 1,000 項；
- summary row按DTO scope裁剪：所有人可見term、中文釋義摘要、kind、result、生效／提交時間及batch badge；只有Reviewer DTO顯示提交者／審核者，Owner DTO只標示「我的申請」；
- detail drawer／page按DTO scope裁剪：public只顯示public before／after、revision及lifecycle；owner另見自己payload／reason及結果備註；reviewer先可見完整reason、review note、actor及event timeline技術資料；
- arrays／候選池以 added／removed 顯示，忽略純排序噪音；文字、level、category、方向 flag及 lifecycle 以真正 before／after 顯示；
- CREATE 顯示「由無到 revision 1」；RETIRE／REACTIVATE 顯示 status transition；rejected proposal 使用 base revision 對 proposed payload 比較；
- 沒有 change request 的 initial baseline revision 顯示為一個「初始正式詞庫匯入」來源事件，不製造 5,469 個虛假 proposer／reviewer；
- actor 帳戶日後停用或名稱改動時，audit identity 仍保留，UI 清楚標示目前帳戶狀態，唔把目前名稱當成歷史時點名稱；
- 技術資料（operationId、file hash、validator version、normalization version）放入 reviewer-only 摺疊區，唔佔一般歷史主畫面；
- 詞庫列表及詞義detail提供「查看修改歷史」入口，直接開啟該sense timeline；recent-auth流程返回後保留原本filter、已儲存decision及未送出的本地note。

## 7. 資料模型及 migration

### 7.1 新 submission models

使用新 normal expand migration，新增明確 enum／models；不修改已套用 migration：

```text
CatalogSubmissionBatch
  proposerId / resolutionOwnerId / reviewerId / finalizerId
  operationId / fileName / fileHash / requestDigest
  schemaVersion / validatorVersion / normalizationVersion / taxonomyDigest
  readyCatalogRevisionId / baseMutationRevision
  status / revision / rowCount / summary
  expiresAt / submittedAt / reviewedAt / committedAt / supersedesBatchId

CatalogSubmissionRow
  batchId / rowNumber / rowDigest
  requestedAction / primaryDisposition / warnings / errors
  normalizedTerm / normalizedLemma
  normalizedSourcePayload / proposalGroupId
  rowRole (CANONICAL_SOURCE | MERGED_SOURCE | EXCLUDED)

CatalogSubmissionProposalGroup
  batchId / groupNumber / resolution / resolutionReason
  targetCatalogKey / targetSenseKey / targetSenseId / baseRevision / baseStatus
  dependencyDigest / finalProposalPayload / payloadDigest / lastContentAuthorId
  reviewRisk / reviewRiskVersion / reviewRiskReason
  decision / decidedById / decidedAt / reviewedPayloadDigest / reviewNote

CatalogSubmissionProposalAuthor
  proposalGroupId / actorUserId / payloadDigest / contributionKind / createdAt

CatalogSubmissionOperationReceipt
  actorUserId / operationKind (SUBMIT | FINALIZE) / operationId
  requestFingerprint / outcomeStatus / summary / createdAt
  @@unique([actorUserId, operationKind, operationId])

CatalogMutationState
  singleton id / revision / updatedAt

CatalogHistoryFeedEntry
  occurredAt / sourceKind (STANDALONE_REQUEST | BATCH | INITIAL_BASELINE)
  requestId? / submissionBatchId? / initialImportBatchId?
  immutable source identity；exact-one source DB check
```

Batch status 至少包括：

```text
PREVIEW | NEEDS_RESOLUTION | SUBMITTED | REVIEWING | REVIEWED |
FINALIZING | COMMITTED | REJECTED | STALE | EXPIRED |
CANCELLED | SUPERSEDED
```

Review decision 屬於 final proposal group，值為 `PENDING | APPROVE | REJECT`；source row disposition、proposal resolution及 reviewer decision 三者分開，避免將「資料有效」誤當成「內容已批准」。同一 batch 內可以多 row 對一 group，但一個 group 只對一個 change request。

### 7.2 擴充現有 request／audit

- `CatalogChangeRequest` 只新增一個 owning FK：optional unique `submissionProposalGroupId`；batch 由 proposal group 關係推導，不同時保存可互相矛盾的 batch／row FK；逐條申請保持 null；
- batch `@@unique([proposerId,operationId])`；每個 request 使用由 batch id＋proposal group id digest 產生的 deterministic operation ID，繼續符合現有 `@@unique([proposerId,operationId])`；submit／finalize另外各有永久 receipt；
- `CatalogChangeRequest` 新增 optional `resultRevisionId`，批准後直接指向實際 `WordSenseRevision`；history 不靠 senseId＋revision number 猜結果；
- 新增 immutable search snapshots：`beforeTermSnapshot`／`afterTermSnapshot`及兩者normalized值、definition／level／category before／after snapshots，讓歷史搜尋同時覆蓋改名前後，唔依賴目前 sense 或低效 JSON 全表掃描；
- 現有 request 以 payload／base revision 可重現 backfill；無法可靠補值的欄保持 null，history presenter 有 fallback，migration 不猜內容；
- `CatalogAuditEvent` 增加 optional `submissionBatchId`，保存 `BATCH_PREVIEWED`、`RESOLUTION_REQUESTED`、`RESOLUTION_CLAIMED`、`BATCH_SUBMITTED`、`REVIEW_PROGRESS_SAVED`、`BATCH_COMMITTED`、`BATCH_STALE`、`BATCH_CANCELLED` 等事件；
- batch、proposal author、review decision、request及audit保存 immutable actor pseudonym／HMAC key version；當時顯示名稱不額外永久複製。UI可以另查目前帳戶名稱／狀態，並清楚分開「immutable audit identity」同「目前帳戶資料」；
- 新增 DB consistency trigger：有 `submissionProposalGroupId` 的 request 只可在 parent batch 為 `FINALIZING` 的同一交易由 PENDING 進入 terminal result，舊單條 writer不能繞過batch atomic gate；terminal batch不得有PENDING child request；
- `CatalogMutationState` 只係全catalog writer的lock／mutation counter，唔冒充未完成的global lifecycle revision。preview保存target／sibling／pending-conflict dependency digest，finalize在同一mutation lock內重建比較；
- `CatalogHistoryFeedEntry` 為top-level feed提供一個共同immutable排序來源：standalone request一entry、CSV batch一entry、initial baseline一entry；batch child requests不再重複出現在top-level，只在batch展開及sense timeline顯示；
- 增加 history cursor／filter indexes，例如 request `(createdAt,id)`、`(status,createdAt,id)`、`(kind,createdAt,id)`、`(normalizedTermSnapshot,createdAt,id)`、proposer／reviewer及 batch 關聯索引；
- submitted／reviewed／committed row payload、proposal groups、requests、revisions、receipts及 audit 正常流程永不 hard delete。

### 7.3 Retention

- 原始 CSV bytes 永不寫入 database；只保存安全檔名、hash、normalized proposal、必要 diff及報告；
- PREVIEW／NEEDS_RESOLUTION 採7日activity expiry及30日absolute expiry；EXPIRED／未提交 CANCELLED 的 normalized source payload、diff及errors可在7日後清除；
- 一經 SUBMITTED 的 batch、rows、requests、review decisions及 audit 長期保留；取消只改狀態，不刪歷史；
- preview tombstone 的 batch id、operationId、request digest、file hash、status、counts、timestamps、receipt及supersedes lineage永久保留，任何cleanup都不能破壞idempotency或歷史關係；
- cleanup 由受保護排程／maintenance script 執行，production 未配置 shared scheduler 時不得假裝已清理；
- cleanup 使用batch revision CAS／row lock，與submit、resolution及clone並發時fail closed；
- log 只記 batch id、counts、duration、error code及 hash prefix，不記完整 term、definition、檔案內容或老師備註。

### 7.4 Versioned proposal payload及39欄去向

Governance proposal payload 要升級成 versioned完整snapshot，足以重建實際批准內容及來源：

| CSV 欄位 | Proposal／批准去向 |
|---|---|
| schema／action／keys／revision／status | batch／group metadata及CAS；status只讀，唔由CSV直接改 |
| term至antonyms的內容欄 | normalized proposal；獲批後完整寫入immutable revision |
| `prompt_en`／`prompt_zh` | 必須留空，不保存 |
| direction flags／12個distractor欄 | proposal arrays；獲批後完整寫入immutable revision |
| `source_reference` | proposal及獲批revision provenance |
| `contributor_ref` | proposal provenance；不代替登入actor audit |
| `change_note` | contributor note；正式變更理由仍使用batch／proposal reason並寫audit |
| `retirement_reason` | CREATE／UPDATE governance CSV必須留空；批量lifecycle不在launch範圍 |

現有逐條 `CatalogGovernancePayload` 要同步擴充source／contributor／change-note語義或明確server取代，唔可以在payload conversion時靜默清空真正獲批provenance。

## 8. Domain service 設計

新增 `src/lib/catalog/submission.ts`、`history.ts` 及共用 change application service，Route Handler 只做 request parsing、auth、rate limit及 response mapping。

### 8.1 Mode-aware validator

- 保持 bootstrap seed mode 現有 `CREATE_DRAFT`、manifest及 deterministic identity 行為；
- governance mode 只接受 CREATE／UPDATE contract，system keys 規則按 action 驗證；
- upload endpoint使用 `text/csv` raw request body及streaming byte counter，在完整buffer／parser allocation前同時檢查可信平台body cap及實際5 MiB上限；不以會先materialize全檔的`formData()`作安全邊界；
- UTF-8 decoder使用fatal mode，拒絕replacement character、NUL、embedded BOM及規範不容許的control characters；strict parser拒絕unclosed quote、closing quote後雜字及unquoted field中途開quote；
- formula檢查要field-aware，唔因合法hyphen文字一律誤拒；任何下載CSV仍對所有儲存格做formula neutralization；
- 共用 NFKC、taxonomy、POS、level、prompt-empty、answer sets、5–6 distractors、sibling-sense、pool diversity及 content digest；
- 先做 row validation，再做 file-level duplicate／pool overlap，再以 targeted database query 比較 current READY catalog；
- database comparison 只取相關 normalized lemmas／terms／sense keys，分批查詢，唔將整個詞庫及歷史載入每個 request；
- preview、submit及finalize均使用相同 versioned validator；版本改變或 taxonomy digest 改變會令舊 preview stale。

### 8.2 共用批准 service

把目前單條批准路由內 CREATE／UPDATE／RETIRE／REACTIVATE 的 domain mutation 抽出：

- `validateAndPlanCatalogChange(...)`：無寫入，回傳 target、before、next revision、next status、projection及 warnings；
- `applyCatalogChange(tx, plan, auditContext)`：只接受 transaction client及已驗證 plan；建立 immutable revision、切 approved pointer、更新／保留 lifecycle、重建 projection及 audit；
- 全catalog writer固定lock order為 actor `User` → exact `RecentAuthGrant`（如需要）→ `TeacherProfile` → singleton `CatalogMutationState` → batch（如有）→ 按normalized lemma排序的transaction advisory locks → 按id排序的senses／requests → projection／audit；新lemma未有row亦由advisory lock保護；
- final transaction 內重新讀 actor role／status／tokenVersion／credentialRevision、teacher accessRevision／capability、recent-auth snapshot、batch revision、每個 request base revision、dependency digest及 current READY catalog；
- 所有成功改動canonical catalog的單條CREATE／UPDATE／RETIRE／REACTIVATE，以及至少批准一個canonical change的batch finalize，都在持有singleton lock時恰好將`CatalogMutationState.revision`遞增一次；純preview／submit／reject／cancel／stale／supersede不遞增；
- preview保存`baseMutationRevision`。submit及finalize都先比較目前revision；如有變動，不因全域其他詞條更新直接判stale，而係在同一lock內重建每個group的target／sibling／pending-conflict dependency digest，只有依賴真正改變先阻擋，否則可用新observed revision繼續；
- CREATE 在 transaction 內再次做 normalized lemma headword reuse及 exact-sense duplicate check；UPDATE 再檢查 stable CatalogEntry lemma；
- retry 只處理已知 serialization／deadlock conflict；request digest及唯一 constraints保證 retry 不建立第二份 revision／audit。

### 8.3 Batch-only approval bridge

- schema／domain service上線後，先修改現有 `PATCH /api/catalog/requests/[id]`：遇到有 `submissionProposalGroupId` 的request固定回 `CATALOG_BATCH_REVIEW_REQUIRED`，普通逐條request維持現行流程；
- 現有pending queue不再將batch child request當作可逐條批准按鈕，而係連到batch review；
- DB trigger只容許batch child request在parent batch `FINALIZING`交易內轉terminal，防止舊binary或其他writer繞過；
- batch finalize feature仍關閉時，bridge guard及DB guard都要先存在；rollback最低版本必須包含bridge，不能退回可逐條批准batch child request的舊程式；
- checker驗證 terminal batch無PENDING child、非FINALIZING batch無APPROVED child，以及單條／batch route使用同一apply service。

## 9. API contract

所有 mutation 使用 same-origin CSRF、streaming body cap、strict JSON／CSV parsing及 catalog-specific rate limit；所有 response `private, no-store`。

Preview raw body contract：

- `Content-Type: text/csv; charset=utf-8`；body只含CSV bytes；
- `Idempotency-Key` 必須係canonical UUID，由client `crypto.randomUUID()`產生，server不trim／NFKC後再當另一個ID；缺失、重複或非canonical格式拒絕；
- `X-Catalog-File-Name` 使用UTF-8 percent-encoding，decode一次後最多180 bytes；server只取basename、拒絕control／path separator並另產生安全顯示名，唔信任任意`Content-Disposition`；
- schema version由CSV欄位讀取；preview fingerprint綁actor、operation ID、安全檔名、實際file hash、schema／validator／normalization／taxonomy versions及row contract；
- submit／review／finalize使用strict JSON；submit body至少有`operationId`、`expectedBatchRevision`及batch note，finalize body至少有獨立`operationId`、`expectedBatchRevision`，review progress亦帶expected revision。

| Endpoint | 權限 | 用途 |
|---|---|---|
| `GET /api/catalog/templates/create.csv` | teacher/admin | 下載空白 CREATE template |
| `POST /api/catalog/export` | teacher/admin | 以JSON body提交最多200個selected sense keys，匯出UPDATE template及排除報告 |
| `POST /api/catalog/submission-batches/preview` | teacher/admin | `text/csv` streaming上載、建立7日activity／30日absolute preview |
| `GET /api/catalog/submission-batches?scope=mine\|reviewable` | owner／reviewer | 找回自己的批次或待解衝突／待審queue |
| `GET /api/catalog/submission-batches/[id]` | owner／reviewer | cursor 讀 batch、rows、diff及狀態 |
| `GET /api/catalog/submission-batches/[id]/errors.csv` | owner／reviewer | 下載安全錯誤報告 |
| `PATCH /api/catalog/submission-batches/[id]/resolutions` | owner／claimed resolver | 以batch revision CAS儲存proposal groups／resolution；material editor記入author lineage |
| `POST /api/catalog/submission-batches/[id]/request-resolution` | owner | 轉入NEEDS_RESOLUTION queue |
| `POST /api/catalog/submission-batches/[id]/claim`／`release` | reviewer | claim、交回或轉交resolution／review責任並寫audit |
| `POST /api/catalog/submission-batches/[id]/submit` | owner | 原子建立 requests；operationId＋requestDigest 冪等 |
| `POST /api/catalog/submission-batches/[id]/cancel` | owner／reviewer | 按狀態取消；已 commit 不可取消 |
| `PATCH /api/catalog/submission-batches/[id]/review` | claimed reviewer | 儲存逐proposal決定、reviewed digest及備註，不改canonical catalog |
| `POST /api/catalog/submission-batches/[id]/finalize` | reviewer＋recent auth | 原子批准 subset／拒絕其餘，重跑全部 current checks |
| `POST /api/catalog/submission-batches/[id]/corrective-preview` | reviewer／batch owner | 建立system corrective preview：原UPDATE回復before payload，原CREATE建立明確RETIRE proposal；不直接undo |
| `GET /api/catalog/history` | teacher/admin | 權限過濾後的 cursor history feed及 filters |
| `POST /api/catalog/history/search` | teacher/admin | 以JSON body提交free-text／actor filters，避免敏感search落URL |
| `GET /api/catalog/history/[requestId]` | teacher/admin | before／after、timeline、batch lineage及 audit detail |
| `GET /api/catalog/[senseKey]/history` | teacher/admin | 單一詞義 revision／lifecycle timeline |

共同錯誤語義：422 檔案／row 無效；403 權限／self-review；409 idempotency／stale／unresolved conflict；410 expired；413 檔案超限；429 rate limit；503 auth／DB／limiter backend fail-closed。

Catalog-specific limiter launch policy：preview 每 user 10 次／10 分鐘兼每 IP 30 次／10 分鐘；submit／finalize 每 user 10 次／10 分鐘；review progress 60 次／10 分鐘。production 使用 shared Upstash並 fail closed，本地才可 memory fallback。

### 9.1 Idempotency及request lifecycle

- `CatalogSubmissionBatch @@unique([proposerId,operationId])`；同preview operation ID＋同file／contract fingerprint回原batch，同ID異payload回409；
- submit request digest包括schema／validator／normalization／taxonomy versions、file hash、ordered included rows、proposal groups、resolutions、final payload digests、base revisions及batch note；
- 每個child request operation ID由batch id＋proposal group id作deterministic digest，200個groups全部唯一且重播穩定；
- finalize要求獨立 operationId；fingerprint包括batch id／revision、ordered decisions、reviewed payload digests、review notes及recent-auth precondition；永久receipt保存terminal outcome；
- 同ID同fingerprint回原結果；同ID異fingerprint固定409；即使preview payload cleanup，最小receipt／tombstone仍永久保留；
- stale、superseded、cancelled batch的PENDING child requests在同一零canonical-write交易轉為CANCELLED並帶結構化reason；普通request queue不可再顯示為待審。

### 9.2 History pagination contract

- `CatalogHistoryFeedEntry` 將standalone request、batch group及initial baseline統一成immutable `(occurredAt,sourceKind,feedEntryId)`；standalone用request `createdAt`，batch用`submittedAt`，initial baseline用import `createdAt`；
- batch child requests從top-level standalone feed排除，避免同一改動出現兩次；展開batch及sense timeline各自使用獨立child cursor；
- 決定時間／最後活動只作filter及顯示，唔做會變動的cursor key；cursor綁filter fingerprint、visibility scope及request開始時的snapshot cutoff；權限裁剪在pagination前完成；
- term搜尋同時覆蓋before／after normalized term snapshots，改名後舊term仍可找到；
- 無權detail固定404，list唔先取全量再由application裁剪。

## 10. 分階段實施

### Phase 0 — Contract freeze及 fixtures

- [ ] 使用者批准本計劃；批准計劃不等於批准 production deploy；
- [ ] 凍結 CREATE／UPDATE governance CSV action contract、200-row／5-MiB cap、7日activity／30日absolute preview及 retention；
- [ ] 建立 valid create、valid update、mixed、BOM、broken quoting、formula、duplicate、polysemy、stale revision、unknown taxonomy及 200-row fixtures；
- [ ] 補充 authoring standard：bootstrap mode 同 governance submission mode 的差異、template/export規則及批量 lifecycle 非目標；
- [ ] 記錄歷史field-level可見性及 batch finalizer 不得等於uploader／任何material author的決策。

### Phase 1 — Pure parser、diff及 conflict engine

- [ ] 將 CSV parser 分成共用 parse／normalize及 mode-aware action validation，按header名稱讀取且保持 seed tests不變；
- [ ] 加入streaming byte／row cap、fatal UTF-8、NUL／control、embedded BOM、field-aware formula、safe filename、duplicate header及 strict quoting checks；
- [ ] 實作 row／file／database dispositions、headword conflict bundles及 explicit resolution validation；
- [ ] 實作 canonical request digest、row digest、before／after diff及 set-aware array diff；
- [ ] 實作`catalog-review-risk-v1`逐欄分類、共同history feed projection及before／after search snapshots；
- [ ] 純函數 tests覆蓋 deterministic result、ordered rows、同 ID 異 payload及所有 blocking rules。

### Phase 2 — Expand migration、dual-write及 persistence

- [ ] Migration A只新增nullable submission／proposal／author／receipt／mutation-state models、request／audit relations、history snapshot fields及必要FK／unique；舊binary可安全忽略；
- [ ] 先發布單條approval compatibility bridge及batch-only DB transition guard，batch finalize feature保持off；
- [ ] 新程式對既有逐條requests dual-write immutable search／actor／result lineage，reader仍保留fallback；
- [ ] 執行resumable、idempotent backfill；不可重現欄位保持null並輸出reconciliation，重跑結果一致；
- [ ] Migration B建立concurrent／低鎖history indexes，驗證query plan後先開history reader；本期不加NOT NULL、不刪fallback，收窄留待另批contract migration；
- [ ] 新增 preview expiry／retention helper、永久tombstone及 cleanup dry-run；
- [ ] Prisma validate／generate、migration checksum、fresh replay、existing-data replay、舊binary compatibility及 DB constraints通過；
- [ ] checker證明 seed `CatalogImportBatch` 同 teacher `CatalogSubmissionBatch` 永不混用，terminal batch無PENDING child request。

### Phase 3 — Preview、resolution及submit API

- [ ] 實作 template／current export，確保 UPDATE metadata只讀且 CSV formula-safe；
- [ ] 實作 preview streaming upload、我的批次／reviewable queue、pagination、summary、error download、expiry及cancel；
- [ ] 實作 database diff、many-row-to-one proposal grouping、resolution CAS、request-resolution及claim／release／transfer；
- [ ] submit transaction重跑 current checks、為proposal groups原子建立互不相撞的requests、permanent receipt及 batch audit；
- [ ] 凍結preview headers、submit／review／finalize JSON schema、canonical UUID及所有operation receipt composite unique；
- [ ] 加入 catalog limiter、CSRF、body caps、private cache headers及 structured error codes；
- [ ] route／DB tests覆蓋 owner isolation、general teacher、capability teacher、admin、student、expiry、retry及TOCTOU。

### Phase 4 — Shared approval service及batch review

- [ ] 從現有單條 approval route抽出共用 validate／plan／apply service，先以原有單條 regression鎖定行為；
- [ ] 實作 reviewer claim、progress CAS、reviewed payload digest、material author lineage、第二審核要求及所有proposal groups decided gate；
- [ ] finalize transaction按共用lock order驗證 recent auth、credential／capability concurrent revoke、batch/request revision、dependency digest、identity／duplicate／validator version；
- [ ] 批准 subset 全批 atomic；故障時零 approved pointer／projection／revision partial write；
- [ ] stale batch保留 reviewer decisions、terminalize child requests並提供 clone/re-preview；
- [ ] cancel／stale／supersede及commit全部按`FINALIZING`同交易transition，deferred invariant證明無持久化FINALIZING及terminal batch無PENDING child；
- [ ] existing single PATCH對batch request固定拒絕；concurrent single approval、相反lemma次序batch、missing-lemma CREATE及同 sense UPDATE tests通過。

### Phase 5 — 批量提交／審核 UI

- [ ] 將治理 workspace 拆成可維護的 catalog／bulk／history components，保持 admin／teacher共用；
- [ ] 完成 upload wizard、summary、row filters、before／after、duplicate bundle、resolution editor、error download及receipt；
- [ ] 完成 reviewer batch queue、save progress、final confirmation、recent-auth recovery及stale UX；
- [ ] template guidance、欄名＋Excel列＋修正方法、category／POS對照及代表性非技術老師10行UAT完成；
- [ ] 320px mobile卡片／detail、768px tablet compact table、1280px desktop table均無頁面水平溢出；狀態非純顏色、native semantics、focus、keyboard、screen-reader async announcement、繁簡及light／dark驗收；
- [ ] 避免全量 5,576 rows 同 200-row review 同時留在 client state，按 view lazy load及取消 stale requests。

### Phase 6 — 歷史 API及 UI

- [ ] 實作權限-aware immutable cursor、snapshot cutoff、batch-group history、JSON search、filters、request detail及sense timeline；
- [ ] 正確還原 approved／rejected／pending／retire／reactivate／initial baseline before／after；
- [ ] 完成 history列表、filter bar、batch badge、detail diff、timeline及 reviewer-only technical metadata；
- [ ] 測試 actor缺失／改名、null backfill、old request無batch、rejected無proposed revision及retired update仍保持RETIRED；
- [ ] 5,000+ requests performance fixture下驗證 query plan、pagination穩定及回應大小。
- [ ] 完成committed batch corrective preview：原UPDATE group以before payload建立UPDATE候選；原CREATE group以該sense建立明確RETIRE候選。只在current revision／status仍等於原batch result時自動建立；否則標stale／conflict，仍須另一位未參與修正的reviewer批准，無直接undo。

### Phase 7 — 驗證、文件及 release readiness

- [ ] 更新上游治理計劃、project plan、plans index、API錯誤文案、操作指引及rollback runbook；
- [ ] 執行按本計劃測試矩陣需要的unit／DB／migration／lint／typecheck／build／targeted browser tests；
- [ ] 兩位獨立 reviewer 分別由資料／安全及產品／操作角度審核實作，blocker／high問題歸零；
- [ ] bulk submit／finalize gate只可在batch history、request lineage、field-level visibility及bridge guard可用後開啟；preview-only可以較早開；
- [ ] 記錄實際性能、retention job狀態、未執行外部裝置／production項目；
- [ ] production migration／deploy／觀察另行取得明確授權。

## 11. 測試矩陣

| 範圍 | 必須證明 |
|---|---|
| CSV file | fatal UTF-8、replacement／NUL／control、單一檔首BOM、39欄名每欄一次兼可換序、malformed quoting、空檔、oversized／偽Content-Length、5 MiB、200 rows、field-aware formula、safe error CSV |
| Action contract | CREATE keys空白；UPDATE keys／revision完整；mixed合法；RETIRE／REACTIVATE拒絕；缺行零副作用 |
| Content | taxonomy、POS、level、prompt-empty、accepted answers、例句pair、5–6 distractors、pool diversity、sibling collision |
| Preview | 無 canonical write、disposition總數對數、database diff、duplicate bundle、7日activity／30日absolute expiry、owner isolation、pagination |
| Resolution | target sense及final payload明確、兩duplicate rows→一proposal/request但保留兩row lineage、LINK轉UPDATE、material editor不能finalize、unresolved阻擋、submitted payload frozen |
| Idempotency | canonical UUID header／body contract、receipt composite unique、batch operation unique、200 child request IDs全唯一、submit／finalize permanent receipts、同ID同digest replay、同ID異digest 409、cleanup後仍可replay |
| Submit | 所有 requests全有或全無、NO_CHANGE／EXCLUDED不建立request、request／proposal／source row lineage完整、單條PATCH固定拒絕batch child |
| Review | uploader／material authors≠finalizer、一般老師403、capability／account／credential concurrent revoke、recent-auth precheck後過期、claim／transfer audit、reviewed digest、拒絕理由 |
| Review risk | `catalog-review-risk-v1`逐欄邊界；所有學生display／answer／level／category／direction／distractor／identity／lifecycle改動均material，只有明列metadata-only可bulk approve |
| Atomic finalize | 第1／中間／最後一組失敗均零approved pointer／revision／projection／approval audit partial write；stale child全terminal；同lemma／同sense／missing lemma並發無duplicate／deadlock |
| Batch state | PREVIEW direct cancel；submitted cancel／stale／supersede／commit均同交易經FINALIZING；外部永不觀察持久化FINALIZING；deferred invariant通過 |
| History | 三種DTO field-level visibility、共同feed cursor＋cutoff＋filter fingerprint、batch child top-level去重、狀態跨頁轉換、before／after term search、actor改名／缺失、approved／rejected／pending／lifecycle diff、initial baseline、batch grouping及lineage |
| Mutation state | 每次成功canonical單條change及有approved change的batch恰好increment一次；純reject／cancel／stale不increment；global revision變但dependency未變可安全revalidate |
| Corrective | 原UPDATE產生before-content UPDATE；原CREATE產生explicit RETIRE；current revision／status已變則stale；全部重新審批且無direct undo |
| Migration | nullable expand、old binary bridge、dual-write、resumable backfill重跑、index query plan、fresh／existing replay、FK／unique／DB trigger、seed／submission batch隔離、checksum |
| UX／a11y | responsive、keyboard、focus、screen-reader status、error summary、locale、theme、large batch rendering |
| Regression | 單條申請／批准、學生 ACTIVE-only runtime、question snapshot、V1 projection及catalog checker不變 |
| Production safety | shared limiter fail closed、cleanup同submit／clone競態、feature flags／rollback floor、permanent tombstone、no raw file retention、no production action |
| Performance | 200-row preview／finalize在實際Vercel max duration下的p95／worst-case、query count、lock wait及history 5,000+ fixture；超標則開gate前降低row cap |

預計按改動範圍執行：

```bash
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit
npm run build
npm run test:db
npm run test:migrations
npm run test:migration-checksums
npm run check:catalog
npm run check:catalog-governance
```

本計劃不改 study gesture／credential／action；除非實作實際觸及相關路徑，否則不為詞庫管理 UI 無目的重跑完整 `test:e2e:card-motion`。

## 12. 風險及緩解

| 風險 | 緩解 |
|---|---|
| 暫存 upload 被當正式 seed | 使用獨立 submission models，runtime／seed checker禁止混用 |
| 批次只成功一半 | submit及finalize分別有清晰原子邊界；批准 subset在單一Serializable交易套用 |
| preview後資料已變 | 保存base revision／validator version／dependency digest；CatalogMutationState鎖內重建target／siblings／pending conflicts，stale全批停止；唔誤用READY CatalogRevision當current snapshot |
| 單條與批量驗證漂移 | 兩者共用validate／plan／apply service及同一lock order |
| 自批或capability撤銷後仍批准 | 保存全部material authors／reviewed digest；final transaction重讀actor、credentials、accessRevision及capability，任何作者≠finalizer、recent-auth |
| 200 rows交易過長 | launch cap、targeted query、預計算diff、transaction內只做authoritative recheck；性能gate不過就降低cap |
| duplicate／多義詞被錯誤merge | 無自動merge；明確target、final payload、reason及reviewer確認；exact／sibling checks fail closed |
| 歷史只反映目前內容 | 以immutable request payload、base／proposed revision及audit event還原；不用latest row代替歷史 |
| 歷史查詢愈來愈慢 | immutable search snapshots、compound indexes、cursor pagination、最大page size及performance fixture |
| CSV injection／不必要原檔保留 | input公式拒絕、下載neutralize、原始bytes不落DB、preview有限retention |
| 一般老師看到未批准內容 | API按角色／ownership裁剪；approved history同internal review history分開 |
| rollback令已提交歷史消失 | expand migration不刪表；關閉UI／mutation endpoints仍保留readable audit及approved catalog |
| 舊單條API繞過batch atomicity | bridge route固定拒絕batch child、DB只准FINALIZING transition、rollback floor必須保留guard |
| stale child requests阻塞clone | stale零寫入交易將全部child轉CANCELLED＋結構化原因，checker禁止terminal batch留PENDING |
| 誤批整批內容 | system corrective preview對原UPDATE建立before-content UPDATE，對原CREATE建立explicit RETIRE；不可直接undo、刪audit或跳過另一人批准 |

## 13. 發佈及 rollback

- 先落 nullable expand migration；部署batch-only compatibility bridge／DB guard後先開始建立batch child request，rollback最低只可回到仍識別batch request並拒絕單條批准的bridge版本；
- 以 `CATALOG_BULK_SUBMISSION_ENABLED`、`CATALOG_HISTORY_ENABLED` 兩個獨立 server gates staged開啟；關閉時API fail closed、UI隱藏入口，但不刪已提交資料；
- 先在 local／CI 驗證單條 approval regression，再開 bulk preview；bulk submit／finalize必須等batch history、request lineage及field-level visibility可用後先開，history read-only可以獨立較早開啟；
- rollback application時停止新preview／submit／review，保留所有batch、request、revision及audit；已COMMITTED內容仍係正常approved revision，不反向重寫；
- schema rollback不做 destructive down migration；新增tables／columns等另行contract cleanup，無明確批准不刪；
- production rollout前另行核對backup、migration status、Upstash、cleanup scheduler、metrics、max function duration及觀察門檻。
- 錯誤內容修正使用新system corrective batch：原UPDATE從before revision生成候選，原CREATE生成explicit RETIRE；按目前revision／status重新preview／rebase，再由未參與修正編寫的reviewer批准；絕不提供破壞性undo。

## 14. Definition of Done

- [ ] 本計劃及相應 authoring contract獲批准；
- [ ] CREATE／UPDATE template、strict streaming preview、diff、many-to-one duplicate grouping、resolution queue及安全error report完成；
- [ ] submit原子建立proposal requests，batch review progress、作者／reviewer separation、permanent receipts及finalize原子套用完成；
- [ ] 單條及批量批准共用domain service，單條route／DB guard不能繞過batch，並發／TOCTOU／idempotency測試通過；
- [ ] 修改歷史支援固定field visibility、batch-group feed、JSON search／filters、immutable cursor、before／after、timeline、batch／source row／sense lineage及corrective workflow；
- [ ] nullable expand、dual-write、resumable backfill、indexes、retention tombstone及catalog-specific limiter完成並有可執行驗證；
- [ ] admin／teacher responsive、繁簡、theme、keyboard及screen-reader驗收完成；
- [ ] 測試矩陣按scope通過，實際指令、性能及未執行項目已記錄；
- [ ] 兩位獨立實作 reviewer 的 blocker／high findings歸零；
- [ ] production migration／deploy仍保持未執行，直至另行授權。

## 15. 決策紀錄

| ID | 決策 | 狀態 |
|---|---|---|
| CBH-001 | seed `CatalogImportBatch` 與老師 `CatalogSubmissionBatch` 分開 | 計劃建議，待批准 |
| CBH-002 | launch只支援CREATE／UPDATE；批量停用／重啟留在逐條流程 | 計劃建議，待批准 |
| CBH-003 | launch cap 5 MiB／200 rows；preview採7日activity／30日absolute expiry | 計劃建議，待批准 |
| CBH-004 | submit原子建立requests；finalize原子套用 reviewer明確批准的subset | 計劃建議，待批准 |
| CBH-005 | batch final reviewer不得為uploader或任何material author，review綁payload digest並要求recent auth | 計劃建議，待批准 |
| CBH-006 | 一般老師可看全校approved history及自己全部申請；internal未批准內容只供owner／reviewer | 計劃建議，待批准 |
| CBH-007 | submitted audit長期保留；raw CSV不保存；preview採有限retention | 計劃建議，待批准 |
| CBH-008 | standalone history一行一request、批量history一batch group；initial baseline以batch事件呈現，不製造虛假逐詞審核記錄 | 計劃建議，待批准 |
| CBH-009 | duplicate採多source rows→一proposal group→一change request，完整保留source lineage | 計劃建議，待批准 |
| CBH-010 | batch child request不可經單條PATCH批准；bridge＋DB FINALIZING guard係release／rollback floor | 計劃建議，待批准 |
| CBH-011 | stale batch零canonical write並terminalize所有child requests；clone建立新batch及supersedes lineage | 計劃建議，待批准 |
| CBH-012 | 錯誤批量批准以system corrective batch修正：原UPDATE回復before、原CREATE明確RETIRE；無直接undo／delete audit | 計劃建議，待批准 |
| CBH-013 | `catalog-review-risk-v1`將所有學生內容／答案／程度／身份／lifecycle改動列為material，只有明列metadata-only可受限bulk approve | 計劃建議，待批准 |
| CBH-014 | History API固定分PublicApproved／Owner／Reviewer三種DTO，client不得收到超出scope欄位 | 計劃建議，待批准 |
| CBH-015 | SUBMITTED後所有commit／cancel／stale／supersede同交易經內部FINALIZING terminalize children；FINALIZING不可持久外露 | 計劃建議，待批准 |
| CBH-016 | Preview使用raw `text/csv`＋canonical UUID `Idempotency-Key`＋安全filename header；submit／finalize各有獨立receipt | 計劃建議，待批准 |
| CBH-017 | `CatalogMutationState`每次成功canonical mutation恰好increment一次；dependency digest避免無關變更造成假stale | 計劃建議，待批准 |
| CBH-018 | Top-level history由immutable feed entry統一standalone／batch／initial排序，batch child不重複出現 | 計劃建議，待批准 |

## 16. 實際驗證紀錄

尚未開始實作；本節只可在執行後填寫實際指令、結果、性能、review findings及未執行項目。

## 17. 計劃審核紀錄（2026-08-22）

- 資料／安全 reviewer 初評 `NEEDS_CHANGES`：指出單條approval可繞過batch atomic gate、child operationId unique衝突、STALE child lifecycle、missing-lemma lock、current CatalogRevision誤用、actor snapshot、39欄payload、CSV parser及migration／cursor／retention缺口；
- 產品／操作 reviewer 初評 `NEEDS_CHANGES`：指出duplicate many-to-one、ESCALATE流程死結、material editor自批、visibility未凍結、history被batch淹沒、bulk approve質量風險、老師39欄負擔、corrective workflow及responsive acceptance缺口；
- 本版已加入proposal group／author lineage、我的批次及resolution claim queue、第二reviewer gate、固定field visibility、batch-group history、corrective template、streaming CSV安全、bridge＋DB guard、permanent receipts、STALE terminalization、global writer lock order、dependency digest、actor pseudonym、完整payload mapping、expand／dual-write／backfill次序及相應測試／release gates；
- targeted re-check確認初稿blockers已清，並再指出risk分類、DTO描述、corrective CREATE、FINALIZING terminal transition、raw CSV metadata、mutation-state increment及混合history cursor等high項；本版已用`catalog-review-risk-v1`、三種DTO、corrective RETIRE、同交易state table、canonical UUID header contract、exact-once mutation counter及`CatalogHistoryFeedEntry`跟進；
- 最終 targeted re-check：資料／安全 reviewer `PASS`，產品／操作 reviewer `PASS`；兩邊均確認未再發現 blocker／high；
- 本輪只審核及修訂計劃，沒有實作schema、API、UI、migration或production變更。
