# 詞庫教師意見、真實題目預覽及工作待辦實施計劃

狀態：已完成（2026-08-25 第三輪 retry applicability／conflict persistence 加固完成；production rollout 仍延後）

建立日期：2026-08-24
所屬分支：`codex/word-catalog-governance-and-lifecycle`

## 背景及問題定義

現有詞庫已具備單筆／CSV 提交、獨立審核、版本比較、停用／重啟、完整歷史及權限邊界；但老師實際使用時仍有四個摩擦點：發現問題後要先理解完整修改表單、編輯時未能以正式出題器直接驗證干擾項、待處理工作分散於多個頁面，以及被拒絕／要求修正後要重新輸入或重新上載。

本計劃以「低門檻提出、正式流程批准、舊紀錄不可改寫」為原則，補齊日常使用閉環，而不增加新使用者角色或多重批准層級。

## 目標及成功準則

- 普通老師可由詞條或全域入口，以問題類型、說明及可選建議快速提交意見。
- 意見本身永遠不會修改學生使用中的詞庫；真正內容修改仍須建立正式 change request 並由一名有權限、且符合獨立審核規則的人批准。
- 編輯者及審核者可用與學生 Objective Probe 相同的 server-owned builder，按英譯中／中譯英方向預覽四選一題目、正確答案及重新抽樣結果。
- 老師可在一個「我的待辦」介面看到需要自己行動、等待別人處理及近期結果；導覽 badge 只計可行動工作，不冒充即時訊息或未讀系統。
- 被拒絕的單筆申請可一鍵帶入原提案及審核意見重新編輯；被要求修正而封存的 CSV 批次可一鍵建立新 preview。兩者均建立新 immutable lineage，不改寫舊紀錄。

## 非目標

- 不建立聊天室、留言串、電郵／推播通知或 SLA 升級機制。
- 不容許意見、預覽或重新提交繞過現有 validator、revision CAS、self-review separation、recent-auth 或 finalization transaction。
- 不改變學生 Objective Probe 判分、SM-2、排行榜、解鎖或 ReviewEvent 語義。
- 不在本輪執行 production deploy、staging rollout 或真實教師 UAT。

## 核心產品決策

1. `CatalogFeedback` 是獨立、非執行性記錄；只有回報人、詞庫審核者及管理員可查看完整內容。
2. 待辦由現有申請、批次、意見及 supersession 狀態即時計算；badge 表示「需要你行動」，不保存虛構 unread count。
3. 單筆重新提交必須由原提案人發起，並建立新的 `CatalogChangeRequest`；原 rejected request 保持終局狀態，兩者以 self-relation 連結。
4. CSV 重新提交由原 batch proposer／resolution owner 建立新 PREVIEW，沿用原提案 payload 作起點，再走完整 preview、submit、review、finalize 流程；專用 `retryOfBatchId` 與既有一對多 corrective lineage 分離。
5. 預覽 endpoint 只供已登入 TEACHER／ADMIN；答案 key 只在此教師專用 response 出現，學生 API contract 維持不變。
6. 題目預覽可明確指定方向，但候選過濾、同拼法 sibling 排除、accepted answer／synonym／antonym 排除、option ordering 全部共用正式 builder。

## 資料、路由及元件影響

### Prisma／migration

- 新增 `CatalogFeedback`，保存 reporter、sense／senseKey context、類型、問題描述、可選建議、處理狀態、resolution note、resolver、revision 及時間。
- `CatalogChangeRequest` 新增 `supersedesRequestId` self-relation，唯一 successor 防止重複一鍵重新提交。
- 新增唯一 `CatalogSubmissionBatch.retryOfBatchId` 表示被拒／STALE 批次重試；既有 `supersedesBatchId` 只保留反向修正一對多 lineage，避免取消一次 corrective 後永久阻塞日後修正。
- 所有新增欄位／表均用普通 expand migration；不執行 contract migration。

### API

- `POST /api/catalog/feedback`：提交簡化意見。
- `GET /api/catalog/feedback`：只回傳 actor 有權查看的意見。
- `PATCH /api/catalog/feedback/[id]`：reviewer 以 revision CAS 解決／駁回，不能改詞庫。
- `POST /api/catalog/question-preview`：以正式 builder 產生指定方向教師預覽。
- `GET /api/catalog/work-items`：回傳我的待修正、待審核、等待中及近期結果摘要。
- 現有單筆 create route 接受可選 `supersedesRequestId` 並在同一交易驗證 owner、REJECTED 狀態及唯一 successor。
- `POST /api/catalog/submissions/[batchId]/retry-preview`：由 STALE／REJECTED 批次建立新 PREVIEW，保留 supersession lineage。

### UI

- 詞庫列表加入全域「提出詞庫意見」及逐詞「報告問題」入口。
- 編輯／審核 payload 區加入學生題目預覽，可選方向並重新抽一組。
- 詞庫工作區加入「我的待辦」頁籤；教師／管理員詞庫導覽顯示 actionable badge。
- rejected 單筆及 stale／rejected 批次顯示「修改後重新提交」入口，並帶出原審核意見。

## 分階段 checklist

### A. 契約及資料層

- [x] 加入 feedback enums/model、request supersession relation 及 migration。
- [x] 建立 feedback input／visibility／transition 純函數及測試。
- [x] 建立 request／batch retry lineage 規則及交易測試。

### B. 正式題目預覽

- [x] 在不改變既有呼叫結果下，令 official builder 可選指定方向。
- [x] 建立 teacher-only preview endpoint，讀取 current sibling senses 並執行現行 validator。
- [x] 在單筆編輯、單筆審核及批次 proposal detail 提供相同預覽元件。

### C. 意見及工作待辦

- [x] 實作 feedback create/list/resolve API，加入權限、body limit、same-origin、CAS、terminal replay 及 privacy tests。
- [x] 實作 work-items aggregate API；限制每組筆數、提供實際總數／顯示更多、穩定排序、feature flag 及 reviewer claim 篩選。
- [x] 實作意見 dialog、待辦 workspace、結果摘要及導覽 actionable badge（desktop／mobile 共用單一 polling source）。

### D. 一鍵重新提交

- [x] 單筆 rejected request 可載入舊 payload、review note 及 current revision，再經使用者確認提交新 request。
- [x] CSV stale／rejected batch 可建立新 preview；不得改寫原 batch、不得複製已失效 base revision 當成 current。
- [x] history／work item 顯示 retry／corrective lineage，已重新提交項目不再列作 actionable。

### E. 驗證及收尾

- [x] Unit：direction override、feedback validation／visibility、work-item classification、retry eligibility／lineage。
- [x] DB：feedback non-executable/CAS、single retry uniqueness、batch concurrent retry replay、stale latest-revision validation、corrective repeatability。
- [x] Browser：回報問題、兩方向正式題目預覽、未登入答案保護、feature flag、feedback privacy／replay、rejected 單筆重新提交及歷史 lineage。
- [x] 執行 lint、TypeScript、production build、migration checksum/fresh replay 及相關 catalog DB checks。
- [x] 兩個獨立、平衡、對抗 reviewer 分別審查安全／資料一致性及 UX／題目忠實度；跟進多輪所有成立問題並完成最終確認。
- [x] 更新計劃實際驗證、已知限制及狀態，commit 並 push 同一 branch。

## 風險及保護措施

- **意見變相繞過審核**：feedback table 沒有 approved revision pointer；resolver action 只改 feedback 狀態。
- **預覽與正式題目漂移**：禁止前端自行抽選；server endpoint 直接呼叫 official builder，並以 regression 固定 production caller 行為。
- **答案洩露**：preview route 必須角色驗證及 private/no-store；學生 route／public snapshot 不加入 correct answer。
- **待辦查詢膨脹**：每組使用 indexed status/proposer/reviewer 查詢及固定上限；不掃描完整歷史或完整詞庫。
- **舊提案覆蓋新內容**：retry 只載入草稿；正式 submit 必須帶 current `expectedRevision` 並重新跑 validator。
- **重複重試**：request successor 唯一約束、batch `retryOfBatchId` 唯一索引及 operation ID idempotency 共同保護。
- **隱私**：普通老師只見自己 feedback／request；reviewer 才見其他人完整待審內容，沿用現有 catalog privacy model。

## 測試矩陣

| 範圍 | 最低驗收 |
|---|---|
| Question builder | 未指定方向結果不變；指定已啟用方向成功；指定停用方向回 null；不足三個安全干擾項回 null |
| Feedback | ordinary teacher 可提交；其他 ordinary teacher 不可讀；reporter/reviewer 可讀；resolver CAS；resolve 不改 catalog revision |
| Work items | reviewer 排除 self-review；rejected 未重試先列待辦；建立 successor 後移除；近期結果不計入 badge |
| Single retry | 只有 owner；只限 REJECTED；只可建立一次 successor；current revision stale 時 409；舊 request immutable |
| Batch retry | 只有 owner；只限可重開終局狀態；新 batch 為 PREVIEW；原 batch immutable；supersedes lineage 正確 |
| Browser/a11y | keyboard 可開啟／關閉 dialog、方向選擇有 label、error 與 focus 可讀、desktop/tablet/mobile 不溢出 |

## 發佈、觀察及 rollback

- 本輪只完成 local implementation／verification；production rollout 仍依既有 governance release gate。
- UI 入口受既有 catalog feature flags 控制；如要快速回退可隱藏新入口，但 migration 保持 additive。
- rollback application 時不刪除 feedback 或 lineage 資料；舊 binary 會忽略新增表／欄位。
- 正式上線後應觀察 feedback backlog、平均處理時間、重試成功率、preview failure reason 及 work-items p95；本輪不建立外部 telemetry。

## Definition of Done

- 四項功能均可由教師工作區完成，不需要直接操作資料庫或 CSV 以外工具。
- 所有內容 mutation 仍經現有一人獨立審核、revision CAS、validator 及 immutable history。
- 學生出題／判分 contract 無變更，preview 與 production builder 有自動回歸證據。
- 相關 unit、DB、browser、lint、typecheck、build、migration checks 通過；未執行 external gate 清楚記錄。
- 兩個獨立 reviewer 無未處理嘅成立 High／Medium 問題。

## 決策紀錄

- 2026-08-24：採用「actionable work items」而非完整 unread notification system，以保持老師流程簡單。
- 2026-08-24：feedback 與 change request 分離；發現問題可低門檻，但任何正式改動仍需完整提案及一次獨立批准。
- 2026-08-24：retry 永遠建立新版本，不提供 reopen／overwrite terminal record。
- 2026-08-24：題目預覽指定方向屬 teacher-only view；production random direction 預設行為不變。
- 2026-08-24：對抗審查後將 batch retry 從 corrective `supersedesBatchId` 分拆到唯一 `retryOfBatchId`，並加入並發 replay、terminal feedback replay、claimed-work 過濾、單一 badge polling 及 nested-modal accessibility 修正。
- 2026-08-24：最終審查將 `NEEDS_RESOLUTION` 待辦改成互斥分類：未領取屬審核、本人領取後只屬修正、由他人領取時提交者只屬等待，避免同一批次重複計入 badge。

## 實際驗證紀錄

- `npm test`：318／318 通過。
- `npm run lint`：零 warning；`npx tsc --noEmit`：通過。
- `npm run build`：83 個 App Router route production build 通過。
- `npm run test:migration-checksums`：通過。
- `npm run test:migrations`：62 個 ordinary migration fresh／interrupted replay 通過。
- `npm run check:catalog-teacher-workflow`：feedback non-executable／CAS、request supersession、retry unique indexes 通過。
- `npm run check:catalog-submission`：batch retry 並發 replay、corrective 取消後重建、claim／transfer／finalize 等交易回歸通過。
- `npm run check:catalog-governance`、`check:catalog-workspace-pagination`、`check:catalog-immediate-retire`：通過。
- `npm run test:e2e:catalog-workspace`：4／4 通過；涵蓋 feature flags、題目預覽、privacy、feedback、retry、CSV round-trip、retire／reactivate 及 history。
- 兩個獨立 reviewer 最終確認：無未處理 High／Medium findings；成立嘅 retry lineage、並發 replay、待辦互斥分類、feature flag、privacy 及 accessibility 問題已跟進。
- 本機 disposable `english_dev/public` 已經由受保護 rebuild 工具按正式四份 CSV 重建，狀態 READY：5,469 ACTIVE、107 DRAFT。

## 已知延後項目

- 真實英文老師代表性 UAT、正式裝置／screen-reader 人手矩陣、staging／production rollout 及 production observation 仍屬外部 gate，未在本輪執行。

## 2026-08-25 第三輪 retry applicability／conflict persistence 加固

### 背景及決策

固定 `fc550a5` 的後續審核指出：批次 retry 的 three-way merge 衝突未持久化，取消／過期後建立下一代 retry 會遺失未解決欄位；已不再適用的 standalone 狀態申請仍會留在待辦；狀態型 retry 顯示舊 payload，而普通狀態操作亦可能靜默丟棄表單修改；本機 checker 只按固定檔名清理一層 retry。四項意見均成立，本輪採用以下 contract：

- `CatalogSubmissionProposalGroup` 持久保存 unresolved retry conflict fields；下一代 retry 必須繼承並與新衝突合併，只有使用者完成 proposal resolution 才可清空；
- standalone retry 必須按目前 `WordSense` 身份、狀態及 approved revision 評估可行性；失效申請保留歷史但不再計入待辦，retry endpoint fail closed；
- `RETIRE`／`REACTIVATE` retry 永遠顯示目前 approved revision；任何 status request 均不可攜帶 payload，前端如偵測到未提交內容修改會先阻止狀態操作；
- checker 由 root fixture 沿 `retriedBy`／`supersededBy` child-first 遞迴清理，不再依賴有限檔名列表或父先子後順序。

### Checklist

- [x] 新增 conflict metadata 欄位及 ordinary expand migration；建立 retry preview 時保存、下一代繼承／合併，完成 resolution 後清空。
- [x] 建立 shared standalone retry eligibility，令待辦 count／list 與 retry GET 使用相同規則。
- [x] 狀態 retry 改用 current approved payload；前後端共同拒絕 status operation 靜默丟棄內容修改。
- [x] checker 使用 lineage tree child-first cleanup，並驗證 retry-of-retry 中途殘留可於下次啟動清理。
- [x] 執行 unit、zero-warning lint、TypeScript、migration checksum／fresh replay、catalog DB checker 及相關 browser regression。
- [x] 更新實際驗證、已知限制及計劃狀態。

### 測試矩陣補充

| 範圍 | 必須證明 |
|---|---|
| Conflict persistence | 衝突 retry 取消／過期後再 retry 仍為 `NEEDS_RESOLUTION`；舊、新 conflict fields 合併去重；未解決不可 submit |
| Standalone applicability | rejected RETIRE 已被其他流程停用、rejected REACTIVATE 已被其他流程啟用、CREATE identity 已存在時均不計待辦且 retry GET 回 409 |
| Status payload | rejected status retry 顯示 current approved revision；一般表單改內容後 status action 被前端阻止；API status + payload 回 422 |
| Checker cleanup | root → retry → retry-of-retry 殘留由 child-first 遞迴完整刪除，重複 discovery／cleanup 保持冪等 |

### 本輪實際驗證

- `npm test`：333／333 通過；涵蓋 conflict metadata parser／union 及 standalone CREATE／UPDATE／RETIRE／REACTIVATE applicability。
- `npm run lint -- --max-warnings=0`、`npx tsc --noEmit`：通過。
- `npm run build`：83 個 App Router routes production build 通過；sandbox 內首次因 Turbopack helper 不可綁定 loopback port 而失敗，以獲准本機權限重跑後通過。
- `npm run test:migration-checksums`、`npm run test:migrations`：通過；65 個 ordinary migrations fresh／interrupted replay 成功。
- `npm run db:deploy`、`npx prisma migrate status`：新增 ordinary migration 已套用到本機 `english_dev/public`，schema up to date。
- `npm run check:catalog-submission`：conflict metadata 在取消／過期後跨代保留、未解決不可 submit、完成 resolution 後清空、submitted metadata immutable，以及 retry tree child-first cleanup 零殘留均通過。
- `npm run check:catalog-teacher-workflow`、`check:catalog-governance`、`check:catalog-immediate-retire`：通過。
- `npm run test:e2e:catalog-workspace`：4／4 通過；涵蓋普通表單未提交修改阻止 status action、status + payload 422、狀態 retry 顯示 current approved revision、失效 RETIRE 不再出現於待辦／badge且 retry GET 409。
- production／staging migration、production deploy 及真實老師 UAT 未執行，仍屬明確延後項目。

## 2026-08-25 合併前資料一致性加固

### 背景及決策

固定 `93cedee` 的後續審核指出 retry rebase、client operation ID、preview validator、待辦聚合、資料庫 immutable guard、feedback list 及本機 checker 仍有 contract 缺口。七項意見均成立，本輪以以下方式修正：

- 單筆／批次 retry 必須由原 base、原 proposal 及目前 approved revision 作 server-side three-way merge；無衝突欄自動 rebase，有衝突欄只接受 `CURRENT`／`PROPOSAL` 明確決定，server 重新計算並再次核對 current revision；
- client 同一 request body 的網絡重試重用 operation ID，body 改變先換 ID，成功後先清除；server 對已存在 successor 回 authoritative replay；
- 題目預覽、standalone submit 及批准／重啟共用同一 sibling validation loader，preview 不可比正式提交寬鬆；
- 待辦 section 使用全域交錯排序及單一 section limit，top-level recent 排除 batch child；
- 新 ordinary expand migration 鎖定 request／batch retry lineage，並以 constraint／trigger 保護 feedback 狀態及 immutable content；
- feedback list 加 signed keyset cursor、scope／limit，同時嚴格限制 kind／target 組合；
- 本機教師工作流程 checker 改用 runtime `DATABASE_URL`，並核對兩重 non-production marker 及持久 `DatabaseMetadata.environment`。

### 非目標及 rollback

- 不改學生出題、判分、SM-2、排行榜或學習事件；teacher preview 仍然係唯一會回答案 key 的新介面；
- 不重寫或刪除既有 terminal request／batch／feedback；所有 migration 只做 additive／`CREATE OR REPLACE FUNCTION` guard；
- 不執行 production migration／deploy。Application rollback 可隱藏 UI，但最低 rollback binary 必須保留新增 lineage／feedback DB guard compatibility。

### Checklist

- [x] 實作單筆及批次 retry three-way merge、衝突 DTO／決定、READY source row 重綁及 server current-revision recheck。
- [x] feedback、單筆 retry、批次 retry client 保存 stable operation ID；補 response-lost replay regression。
- [x] 抽出 sibling validation loader，令 preview／submit／final review／reactivate 使用一致 normalized rows。
- [x] recent request 排除 batch child；四個 work-item sections 共用全域排序及單一總上限，totals 使用相同 filters。
- [x] 新增 request／batch lineage immutable trigger、feedback consistency constraint／transition trigger及 direct mutation negative tests。
- [x] feedback GET 支援 scope／limit／signed cursor；parser 嚴格限制 MISSING_WORD／field-specific target，UI 只顯示合適類型。
- [x] checker 改用 `DATABASE_URL` 並加入 non-production／DatabaseMetadata guard；已核對現有 CI 使用獨立 test database 及一致 environment markers，毋須修改 workflow invocation。
- [x] 執行 unit、zero-warning lint、TypeScript、production build、migration checksum／fresh replay、catalog DB checks及 browser lifecycle regression。
- [x] 更新實際驗證、恢復計劃「已完成」並提交同一功能分支；GitHub push／quality gate 結果由本輪交付記錄核對。

### 測試矩陣補充

| 範圍 | 必須證明 |
|---|---|
| Retry merge | 中途批准修改未被舊 payload 還原；同欄不同值產生 conflict；決定只接受 current／proposal；current revision 再變即 stale |
| Stable operation | response 遺失後同 body 重送只得一個 feedback／successor request／successor batch；改 body 先換 operation ID |
| Sibling validation | 一個候選撞 sibling accepted answer，即使 builder 仍有三個安全選項，preview／submit／final validation均拒絕 |
| Work items | 3-group committed batch只出一個 top-level batch；section 合併後最多 limit 項並按跨類型時間排序 |
| DB guards | lineage FK不可更新；terminal feedback不可重開／改內容；OPEN不可寫 resolver；合法 terminal transition revision恰好加一 |
| Feedback list | mine desc／review asc cursor無重複遺漏；target-kind非法組合422；UI入口只顯示適用類型 |
| Checker | 缺 marker、production marker、確認不符或DB metadata不符全部 fail closed；不使用 migration credential |

### 本輪實際驗證

- `npm test`：326／326 通過，包括 three-way merge、stable operation、sibling validation、feedback cursor／target 及跨類型 work-item 排序。
- `npm run lint -- --max-warnings=0`、`npx tsc --noEmit`：通過。
- `npm run build`：83 個 App Router route production build 通過；首次 sandbox process spawn／port 限制失敗後，以獲准本機權限重跑通過。
- `npm run test:migration-checksums`、`npm run test:migrations`：通過；63 個 ordinary migrations fresh／interrupted replay 成功。
- `npx prisma migrate status`：本機 `english_dev/public` 已套用全部 63 個 migrations。
- `npm run check:catalog-teacher-workflow`：feedback transition／terminal guards、request retry lineage、batch retry lineage 及 unique retry lineage 全部通過。
- `npm run check:catalog-submission`：duplicate retry authoritative replay、reviewer takeover／transfer race、finalize／corrective lifecycle 全部通過。
- `npm run check:catalog-governance`：通過。
- `npm run test:e2e:catalog-workspace`：4／4 通過；包括中途正式 revision 合併、同欄 conflict 人手決定、response-lost operation ID replay、metadata round-trip、privacy、review、retire／reactivate 及 history。
- production／staging migration、production deploy 及真實老師 UAT 未執行，仍屬明確延後項目。

## 2026-08-25 第二輪 retry／feedback lineage 加固

### 背景及決策

固定 `5a6ebac` 的後續審核指出，批次 retry 仍可能遺失 `CREATE + REPLACE_EXISTING → UPDATE` 的實際操作語義，亦未完整處理 `REJECT` proposal、retry preview 取消／過期、feedback target FK、狀態型單筆 retry、feedback 建議可見性及同時間排序。六項意見均成立，本輪採用以下 contract：

- 批次 retry 以 child request `kind` 為首要 effective kind；未建立 child 時才由 `requestedAction + resolution` 推導。`REJECT` proposal 不會復活，只有真正 `CREATE` 才清除 identity，真正 `UPDATE` 必須 three-way merge；含 status-only `RETIRE`／`REACTIVATE` 的批次不提供一般 CSV retry。
- 保留 `retryOfBatchId` 唯一關係，採 retry chain：`CANCELLED`／`EXPIRED` retry successor 在內容尚未 purge 且未有下一個 successor 時，可成為下一次 retry source；同一 source 仍最多一個直接 successor。
- `CatalogFeedback.senseId` 與 snapshot 一樣 immutable，FK 改為 `ON DELETE RESTRICT`，避免 trigger 與 `SET NULL` contract 互相矛盾。
- 被拒絕的 `RETIRE`／`REACTIVATE` retry 只可修改理由；詞條內容欄鎖定，server 拒絕 status-only retry payload patch。內容修訂必須另行提交 `UPDATE`。
- feedback work item 必須顯示 `suggestedValue`；work-item merge 的 timestamp 及 ID tie-breaker 必須同資料庫查詢方向一致。

### Checklist

- [x] 以 effective kind 重建 batch retry，排除 `REJECT` proposal，保留 `REPLACE_EXISTING` target identity 並套用 three-way merge。
- [x] 加入 retry chain eligibility；取消／過期且未 purge 的 retry 可再建立 successor，並發仍只建立一個直接 successor。
- [x] 新增普通 migration：feedback `senseId` immutable、FK `RESTRICT`；補 direct DB negative tests。
- [x] 狀態型單筆 retry 鎖定內容 editor，只容許修改 reason；server fail closed 拒絕內容 patch。
- [x] work-items 傳回及顯示 feedback `suggestedValue`；修正 DESC tie-breaker 並補同 timestamp 邊界測試。
- [x] 執行 unit、zero-warning lint、TypeScript、production build、migration checksum／fresh replay、catalog DB checks及 browser regression。
- [x] 更新實際驗證並恢復計劃「已完成」；commit／push 及 GitHub quality gate 狀態於交付紀錄另行核對。

### 測試矩陣補充

| 範圍 | 必須證明 |
|---|---|
| Effective retry | `CREATE + REPLACE_EXISTING` 以 `UPDATE` retry；current 未被 proposal 改動欄保持；同欄衝突仍需解決 |
| Excluded/status groups | `REJECT` group 不復活；含 `RETIRE`／`REACTIVATE` 的 source 不出現在一般 retry 待辦且 endpoint fail closed |
| Retry chain | retry cancel／expire 後可由 terminal successor 再開；同時 restart 只產生一個直接 successor |
| Feedback lineage | resolve 同時改 `senseId`、terminal 改 target、刪除被 feedback 引用 sense 均由明確 DB guard／FK 拒絕 |
| Status retry UX | `RETIRE`／`REACTIVATE` 內容控制不可編輯，只有 reason 會提交；惡意 patch 422 |
| Work items | reviewer／reporter 可見原建議；超過 limit 且 timestamp 完全相同時，DB 與 merge top-N 次序一致 |

### 實際驗證

- `npm test`：331／331 通過。
- `npm run lint`：zero-warning 通過。
- `npx tsc --noEmit`：通過。
- `npm run build`：83 routes production build 通過；首次 sandbox 執行因 Turbopack helper 不可綁定 loopback port 而失敗，按本機規則以 escalated 權限重跑後通過。
- `npm run test:migration-checksums`：通過。
- `npm run test:migrations`：64 個 ordinary migrations fresh／interrupted replay 通過。
- `npm run check:catalog-teacher-workflow`：feedback target immutable、terminal guard、`WordSense` delete `RESTRICT` 及 retry lineage 通過。
- `npm run check:catalog-submission`：effective retry、取消後 retry chain、同 operation ID 並發 replay、claim／transaction guards 通過。
- `npm run check:catalog-governance`、`npm run check:catalog-immediate-retire`：通過。
- `npm run test:e2e:catalog-workspace`：4／4 通過；包括 feedback 建議可見、status-only retry editor disabled、惡意 retry patch 422、重新提交及完整歷史。
- production／staging migration、production deploy 及真實老師 UAT 未執行，仍屬明確延後項目。
