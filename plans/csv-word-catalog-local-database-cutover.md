# CSV 詞庫本地資料庫切換及示範資料重建計劃

> 狀態：進行中（Revision 3 local implementation／verification 已完成；GitHub rerun、browser storage及 production gates deferred）
>
> 日期：2026-08-19
>
> 修訂：Revision 3（2026-08-22 取消 test-only 詞庫，改用 digest-bound 正式初始啟用 manifest）
>
> 工作 branch：`codex/word-catalog-governance-and-lifecycle`
>
> 上游計劃：[詞庫詞義、CSV 匯入、審核及生命週期實施計劃](./word-catalog-governance-and-lifecycle.md)
>
> 範圍：只處理 local development／test 資料庫、A1–B2 CSV 詞庫切換及示範數據重建；本計劃不授權 production deploy 或立即清空資料庫
>
> Review 跟進：加入 V1 compatibility、逐表 identity transition、正式 ACTIVE-only runtime、真實解鎖 chronology、public answer-data protection 及可執行 phase 次序；未經主代理重現的 reviewer 估算不納入驗收

## 1. 背景及問題定義

目前 runtime 詞庫由 PostgreSQL `Word` 提供，但 `prisma/seed.ts` 仍以 `word list.md` 為來源。新建立的
A1、A2、B1、B2 CSV 則以「一行一個詞義」表示資料，能夠保存同一英文在不同程度的不同意思、兩個出題方向及各自的人工干擾項。

現有 `Word.term @unique` 只容許每個英文拼法有一行，舊 seed 遇到重複 term 會採用最低程度的一行。因此，直接把新 CSV 塞進舊
`Word` 表會丟失多義詞及高階新詞義，不能作為正式切換方法。

此外，學生示範資料不只保存「學生學過幾多個詞」，而是直接或間接連到舊 `Word.id`。如果只刪除單詞，現有 Review、排行榜、
學習事件、題目 snapshot、打卡、單元進度及教師分析會出現被 cascade 刪除、留下歷史 snapshot，或新舊 ID 混合等不同結果。
由於目前只有本地測試資料，而且使用者已確認不需要保留，最清晰及風險最低的方法是：完成新資料模型及所有 runtime reader 切換後，
受保護地重建整個本地 schema，再按新詞庫重新生成帳戶、班級及學生學習示範數據。

## 2. 已確認現況

### 2.1 新 CSV 盤點

| 程度 | CSV 詞義行數 | 英譯中可用 | 中譯英可用 | 兩方向均停用 | category 數 |
|---|---:|---:|---:|---:|---:|
| A1 | 355 | 355 | 353 | 0 | 20 |
| A2 | 1,447 | 1,447 | 1,444 | 0 | 23 |
| B1 | 1,743 | 1,576 | 1,312 | 51 | 24 |
| B2 | 2,096 | 1,936 | 1,638 | 56 | 24 |
| 合計 | 5,641 | 5,314 | 4,747 | 107 | — |

其他已確認事實：

- 5,641 行全部為 `CREATE_DRAFT`，`catalog_key`、`sense_key`、`catalog_status` 目前留空；
- 共有 4,967 個 normalized term、4,966 個 normalized lemma；唯一一個 `term != lemma` 的現有例子為 `swimming → swim`；
- 553 組 term 重複，涉及 1,227 行，即同一拼法首行以外另有 674 行「候選詞義」。呢 674 行不能未經檢查就全部宣稱為獨立 sense，但若沿用 `Word.term @unique`，它們必然無法逐行保存或進行 merge／keep-distinct 判斷；
- 兩方向均停用的 107 行不能產生 Objective Probe，切換時只可保留作待處理草稿，不能自動變成可學習項目；
- 5,534 只代表「至少一個出題方向開啟」，並不代表已通過內容驗證或可 ACTIVE；當中 5,332 行暫無 `example_en`，而多義、非字面或易混詞的例句屬條件必填，必須由可重現規則及人工 disposition 判斷，不能單靠方向 flag 推算可啟用數量；
- 規範共有 25 個合法 category code（包括 fallback `other`），目前四份 CSV 實際使用其中 24 個；
- 實作後 strict validator 額外封鎖 65 行：60 行有同一方向的 accepted／synonym／antonym 答案碰撞，2 行有中譯英 sibling-sense 正解碰撞，4 行有英譯中 sibling-sense 正解碰撞；因此目前可匯入 5,576 行，其中 5,469 行已由 digest-bound initial activation manifest 正式設為 ACTIVE。呢個係 fail-closed 結果，不把疑似危險干擾項靜默放入題庫；65 行仍保留喺 import report，待內容修訂後再重新產生 digest／manifest；
- 四份 CSV exact source digest 為 `6b8dee4f8cb9efe0ec71e173ac34a407031dc3967c2b290e4878fda83d5fa23a`；checked-in identity manifest 覆蓋 5,641 行，seed 同 rebuild dry-run 都已重新核對；
- CSV 是受控匯入及版本保存格式；runtime canonical source 仍然是 PostgreSQL，而不是每次 request 即場讀 CSV。

### 2.2 現有本地資料庫盤點（2026-08-19 read-only snapshot）

| 資料 | 現有數量 | 切換影響 |
|---|---:|---|
| Word | 5,532 | 全部由舊 Markdown seed 建立，會被新 sense-level 詞庫取代 |
| User | 155 | 全部為本地帳戶／示範資料，可重建 |
| 班級 | 18 | 可按相同 UI 測試規模重建 |
| Review | 552 | 綁定舊 `wordId`，不遷移 |
| ReviewEvent | 2,844 | 包含舊詞 snapshot，連同 demo 歷史重建 |
| StudyEncounter／StudyDay | 各 7,626 | 影響統計、排行榜及打卡，連同 demo 歷史重建 |
| StudySession | 144 | 舊 session 必須失效，不保留續接 |
| StudyStreamItem | 10,470 | 綁定舊詞及 credential lineage，不能映射到新詞 |
| EvidenceObligation | 2,955 | 舊 verification debt 不保留 |
| ObjectiveEvidenceTarget／QuestionSnapshot | 各 2,844 | 題目及正解以舊詞建立，全部重建 |
| OperationReceipt | 20,940 | 只屬舊 demo operation，全部重建 |

### 2.3 現有示範數據的限制

- `scripts/seed-demo-analytics.ts` 目前故意保留 `Word`，只清理使用者及 roster 相關資料；
- fixture 只抽每級最前面的少量 A1／A2／B1 詞條，沒有 B2 學習軌跡；
- 題目 snapshot 使用「其他答案／未選答案／示範選項」等假選項，沒有採用新 CSV 的人工干擾項；
- leaderboard、unit progress、student stats 及 teacher analytics 現時仍以 `Word`／`Review.wordId` 計算；
- A1 的舊單元次序寫死於現有 category 名稱，新 CSV category 已改變，不能直接沿用舊 taxonomy；
- 現有瀏覽器 cookie、checkpoint、outbox 或 Playwright storage state 可能仍保存舊 user／session／stream ID，reset 後必須失效及重建。

## 3. 核心決定

### 3.1 不採用「CSV 壓平到舊 Word 表」

正式切換以 `CatalogEntry`／`WordSense`／immutable `WordSenseRevision` 模型為前提。同一 term 的多個詞義會有獨立 `senseKey`、程度、
答案、出題方向、干擾項及學習進度。現有 physical `Word` 只可在 expand compatibility window 暫時保留；完成 reader cutover 後，本地
重建不會再以舊 Markdown `Word` seed 作 canonical source。

### 3.2 不遷移舊學生學習資料

所有舊 Review、events、sessions、receipts、days、achievements、排行榜及分析數據都視為可棄置測試 fixture。新資料不嘗試按英文拼法把
舊 mastery 複製到新 sense，避免把 `run = 跑步` 的進度錯誤套用到 `run = 經營`。

### 3.3 使用完整本地 schema reset

執行階段採用受保護的 drop schema → replay migrations → seed catalog → seed accounts／roster → seed demo analytics 流程，不按 table
逐項 delete。原因是完整 reset 可以同時清除所有 FK、snapshot、session、idempotency receipt 及測試帳戶，避免漏網資料。

reset 必須沿用現有 local topology allowlist、development environment marker、dry-run 及明確 confirmation。不得使用 `prisma db push`，
不得連到非 allowlisted target，亦不得因本計劃獲批准而自動執行。

### 3.4 CSV bootstrap 正式啟用規則（Revision 3）

四份 CSV 仍以 `CREATE_DRAFT` 作匯入動作，但使用者已批准把現有已多輪整理的可用項目作正式初始 baseline，而不是建立另一個測試詞庫：

1. 通過 schema／identity validation 的行先建立 immutable revision；validation failed 行只進 import report，不能建立可引用 revision；
2. checked-in initial activation manifest 必須精確綁定 source digest、validator／normalization version、selection rule 及預期數量；不符即 fail closed；
3. 通過 blocking validator且至少一個方向可用的 5,469 行建立 `ACTIVE + approvedRevisionId`；兩方向均停用的 107 行保留 DRAFT；65 行 validation failed 保留 import issue；
4. development、test、CI 及未來 production 均只讀同一套 `ACTIVE + approved revision + READY catalog` 規則，不設 environment override；
5. 某一方向 disabled 時只禁止該方向，另一方向仍可按 CSV 設定出題；
6. seed 重跑不得覆寫其後老師批准內容、不得重新啟用 RETIRED、不得以缺行自動停用；日後修改仍必須經 DRAFT proposal及四眼審批；
7. 舊 `CatalogEligibility` table 暫留作 schema compatibility，但不再參與 runtime、seed 或治理 API；刪除要另行批准 contract migration。

### 3.5 V1 rollback compatibility

現行產品 contract 仍要求 `STUDY_V2_ASSIGNMENT_MODE=off` 可以 rollback 到 V1，而 V1 `StudySessionItem`、legacy Review 及部分 reader 仍要求
`Word`。因此「新 CSV 成為唯一 canonical source」不等於 reset 後令 physical `Word` 為空：

- 由 current-eligible sense 產生非 canonical、read-only `Word` compatibility projection；
- 每個 normalized term 只能透過 checked-in `LegacyWordSenseMap` 明確選擇一個 primary sense，不准重現 lowest-level-wins；未被選中的 sibling senses 必須列入報告；
- V1 只讀 compatibility projection；V2、單元、排行榜、統計及教師分析只讀 sense catalog；
- projection mastery 不可複製到 sibling sense，亦不可反過來成為 V2 current metric source；
- session 建立時固定 `catalogReadMode = LEGACY_WORD | SENSE_V1`，同一 session 不可混合兩種 identity；
- 除非另行批准正式退役 V1，fresh reset 後必須通過 `STUDY_V2_ASSIGNMENT_MODE=off` smoke test。

### 3.6 學習資料 identity transition

只新增 optional `senseId` 不足以令學習真正以詞義為單位。今次 expand window 採「V2 sense + matching Word projection pair」的 transition contract，
先保護資料一致性及 reader 邊界；因為現有 V1 contract 仍要求 `wordId`，今次唔會假裝已完成最終 exact-one contract migration。完成 V1 退役前，
仍要另開 contract migration，把 V2 寫入改為 sense-only，並按逐表資料策略收窄 legacy 欄位。

| 資料 | Compatibility window | 新 V2 canonical writer |
|---|---|---|
| `Review` | 保留必填 `wordId` 作 V1／compatibility projection；新增 nullable `senseId`；保留 `(userId, wordId)` 及 `(userId, senseId)` unique | V2 寫入 matching `wordId + senseId` pair；DB trigger 由 `wordId` 反查 projection，拒絕不一致 pair；reader／CAS 以 sense eligibility 作 current boundary，exact-one 退役 migration 後再落實 |
| `ReviewEvent` | 保留 legacy `submittedWordId`／可選 `wordId`；新增 `submittedSenseId`／`senseId`，不可把 sense ID 塞入 word 欄 | 保存 sense key、content revision、catalog revision、term／definition／level snapshot 及 objective lineage；matching pair 同樣由 DB guard 驗證 |
| `StudySessionItem` | V1 保持 compatibility `wordId` | V2 不新增呢類 row；session 固定 read mode |
| `StudySession` | 新增 `catalogReadMode`；既有 legacy session 固定為 `LEGACY_WORD` | 新 V2 session 固定為 `SENSE_V1`，中途不可轉換 |
| `StudyStreamItem`／`EvidenceObligation`／`ObjectiveEvidenceTarget`／`StudyEncounter` | V1／expand row 可有 `wordId`；V2 transition row 保存 matching pair | current V2 reader 以 `senseId`、READY revision 及 eligibility 過濾，並保存所需 content／catalog revision provenance |
| `ObjectiveQuestionSnapshot` | 舊 snapshot 原樣保留 | 新 snapshot 保存 sense／revision、direction、題幹、最終 options、correct option 及 construction version |

今次 migration 以 projection-consistency trigger 保證只要同時有 `wordId`／`senseId` 就一定指向同一個 sense，並由 current read predicates 排除
legacy Word-only、stale revision、RETIRED 及普通 DRAFT；`ReviewEvent` 同樣有 matching guard。呢個係可 rollback 的 expand-safe invariant，唔等同
最終 exact-one identity。sense writer 必須繼續使用現行 server-owned transaction、operationId、Serializable retry、Review revision CAS 及完整 lineage。

## 4. 目標、非目標及成功準則

### 4.1 目標

1. 令 A1–B2 新 CSV 成為 fresh local database 唯一詞庫 seed input；
2. 完整保存同 term 多 sense，不再出現 lowest-level-wins；
3. 所有學生學習、單元及 current metrics 只讀 current-eligible sense；歷史 analytics 按事件當時 snapshot；
4. 按新詞義及真實人工干擾項重建可重現的學生示範資料；
5. 提供 dry-run、digest、數量 reconciliation、reset guard 及 post-seed checker；
6. 切換後不留下任何引用舊 Word ID 的 local demo 資料或瀏覽器測試狀態。

### 4.2 非目標

- 不保留或轉換目前任何本地學生 mastery／streak／ranking；
- 不在此計劃完成老師提交、四眼審核、停用 UI 的全部產品功能；該範圍仍由上游詞庫治理計劃管理；
- 不把 DRAFT 或兩方向均停用的詞義強行放入學生學習 queue；
- 不執行 production migration、production seed、production reset 或真實學生 rollout；
- 不更改 Retrieval-first V2 的 long-press、self-rating、objective first-response、SM-2 quality 或 credential contract；
- 不為了兼容舊 fixture 而保留 Markdown 作第二個 runtime truth source。

### 4.3 成功準則

- fresh local DB 可以只靠 migrations、四份 CSV、受控 manifest 及 seed scripts 完整重建；
- 每個 CSV 原始行都有 primary import disposition（例如 `CREATED_DRAFT`、`MERGED`、`NO_CHANGE`、`CONFLICT`、`VALIDATION_FAILED`）及獨立 activation result（`ACTIVATION_ELIGIBLE`／`DRAFT_BLOCKED`），不能靜默略過；
- import reconciliation 可證明輸入 5,641 行全部有 disposition、stable keys 唯一，並清楚記錄同 term 候選係 keep-distinct、merge 定 conflict，沒有靜默丟失；
- V2 runtime 查詢、題目建立、unit denominator、mastery、排行榜及分析沒有再依賴 legacy `Word`；V1 只可經 compatibility projection 運作；
- demo fixture 有 A1 → A2 → B1 → B2 的合理差異，班與班、學生與學生排名明顯但不機械一致；
- demo Objective QuestionSnapshot 使用 production question builder 及 CSV 人工干擾池，沒有假選項捷徑；
- 未答題 public Objective payload 不包含 canonical definition、accepted answers、correct option ID 或其他答案資料；
- fresh reset 後 V1 rollback smoke 及 V2 sense-level flow 都可獨立通過，同一 session 無 mixed identity；
- reset 後不存在 open session、未消耗 target、孤兒 FK、舊 ID 或跨 generation checkpoint；
- migration、catalog validator、seed reproducibility、DB invariants、排行榜、統計、build 及相關 browser flow 全部通過。

## 5. 目標資料及重建流程

```text
A1–B2 CSV
  → parse／normalize／blocking validation
  → checked-in identity assignment + file digest + import report
  → immutable revisions
  → digest-bound initial activation manifest
  → 正式 ACTIVE／DRAFT 狀態（所有環境一致）
  → ACTIVE-only current catalog view
  → accounts／academic year／classes／enrolments
  → deterministic student learning histories
  → post-seed integrity／analytics／UI checks
```

本計劃統一使用 `current sense`：所有環境只包括正式 ACTIVE、有 approved revision且所屬 catalog revision 為 READY 的 sense。
DRAFT 只供治理工作區檢視、修訂及審批，不會因為在 development／test 執行而進入學生流程。

### 5.1 CSV blocking validation

每一行至少檢查：

- schema version、欄數、UTF-8 BOM、boolean、level、part of speech 及 category 格式；
- `term`、`lemma`、`definition_zh`、normalized identity 及 deterministic key collision；
- 同 lemma／term／POS／level／definition 的 exact duplicate 及近似 conflict；
- enabled direction 有完整正解，並有 5–6 個非空、去重、不是正解／accepted answer／同義正解的人工干擾項；
- 英譯中及中譯英各自只有一個可接受答案集合，其他同 term sense 的正解不得混入該 sense 的干擾池；
- phonetic、accepted answers／forms、例句等欄位按 authoring standard 正規化；多義、非字面或易混詞缺例句屬 blocking，不能一律當 optional；
- 每行產生明確 disposition；`VALIDATION_FAILED` 不寫 revision，valid conflict 進 resolution bundle，不能靠排序自動 merge；
- 同一輸入及同一 normalization／validator version 必須產生相同 digest、disposition 及 import report。

### 5.2 Stable identity 及 import idempotency

- `catalogKey`／`senseKey` 是系統分配的 opaque stable identity，不能由 CSV 行號、匯入順序、整行 content hash、可修改中文解釋、level 或 category 反覆推算；
- 第一次 bootstrap 產生 checked-in identity assignment manifest，保存 source-row fingerprint、已分配 keys、resolution disposition 及 manifest version；
- 後續 export／update 必須帶回 stable keys；typo、level、category、例句或干擾項修正保留 sense key，改變核心意思／詞性／詞義邊界先建立新 sense key；
- DRAFT import 同正式 approval commit 是兩個獨立 operation；各自使用 operationId＋request digest 冪等，同 operationId 不同 payload 固定回 409；
- approved pointer、audit、CatalogRevision 及 import result 在 Serializable transaction 內提交；retry 不得建立第二份 revision 或第二個 key。

### 5.3 39 欄資料去向

| CSV 欄位 | Canonical 去向 | Runtime／規則 |
|---|---|---|
| `schema_version` | import batch metadata | 只接受支援版本 |
| `requested_action` | import request／change request | 不進學生 payload |
| `catalog_key`、`sense_key` | CatalogEntry／WordSense identity | 新增可留空由系統分配；更新必須保留 |
| `record_revision`、`catalog_status` | CAS／WordSense lifecycle | contributor 不可直接令內容 ACTIVE |
| `term`、`lemma` | CatalogEntry identity/content | term 是題幹或中譯英正解；lemma 只作歸組 |
| `part_of_speech`、`level`、`category` | immutable WordSenseRevision | category 必須符合 versioned taxonomy |
| `definition_zh` | immutable WordSenseRevision | 該 sense canonical 中文正解 |
| `accepted_answers_zh` | immutable answer set | 碰撞檢查及人工審核；不在未答題 payload 暴露 |
| `prompt_en`、`prompt_zh` | 不保存 | 必須留空；非題幹，validator 遇非空即 blocking |
| `phonetic_ipa` | immutable WordSenseRevision | Learning Card 答案揭示後可顯示 |
| `example_en`、`example_zh` | immutable example pair | Learning Card reveal 後使用；Objective Probe 不顯示；條件必填規則適用 |
| `accepted_forms_en`、`synonyms_en`、`antonyms_en` | immutable answer-safety sets | 用於碰撞／唯一正解檢查，不當作即場生成答案 |
| `enable_en_to_zh`、`distractor_zh_1`…`6` | revision 的方向設定及 curated pool | enabled 時必須有 5–6 個合格項，server 每題抽 3 個 |
| `enable_zh_to_en`、`distractor_en_1`…`6` | revision 的方向設定及 curated pool | enabled 時必須有 5–6 個合格項，server 每題抽 3 個 |
| `source_reference`、`contributor_ref` | provenance／import audit | 不進學生 payload；外部來源按規範另行驗證 |
| `change_note`、`retirement_reason` | change request／audit | CREATE_DRAFT 可空；修改／停用按 lifecycle 規則必填 |

現有 `Word.examples`／`phonetic` 等欄可以作 compatibility projection，但新 canonical 內容必須附屬於 immutable sense revision，不能再附屬於整個 term。

### 5.4 Runtime read rule

- V2 學生 queue 只選 current-eligible sense 及該 sense 已啟用的 direction；V1 只讀 compatibility projection；
- question builder 使用新 construction version，只從該 sense 對應方向的 5–6 個 curated candidates 抽 3 個，排除 canonical／accepted answers、accepted forms 及 sibling-sense 正解；
- current unit／mastery denominator 只計 current-eligible sense；RETIRED／普通 DRAFT 不計；
- 歷史 snapshot 永遠讀事件提交時文字及 catalog revision，不以後來內容回寫；
- UI 數字代表「已掌握詞義」而不是 unique English spelling；需要時把舊「單詞數」文案改為「詞義數」或加說明。

### 5.5 Objective public payload 安全

現行 `PublicObjectiveQuestion` 會同時傳送 `wordTerm` 及 `wordDefinition`，其中一項可能係 canonical answer。Sense cutover 前必須修正：

- 未提交答案前只回傳題幹、direction、四個 opaque options 及 construction version；
- `wordTerm`、`wordDefinition`、accepted-answer sets、`correctOptionId` 只保存在 server snapshot；
- 答案確認後只經既有 feedback contract 回傳需要顯示的結果，不在初始 item 偷渡 answer metadata；
- contract test 直接檢查 response JSON，證明 canonical answer、accepted answers、answer key 及 CSV reserved prompt 欄沒有外洩。

### 5.6 Rebuild generation 與客戶端狀態

- 每次 local rebuild 產生新的 dataset generation marker，寫入 rebuild manifest、`DatabaseMetadata` 及 seed report，並以 `BUILDING → READY／FAILED` 管理可用狀態；
- reset 完成後撤銷舊 session，重新產生測試 storage state；
- 開發者瀏覽器須登出／清除舊 checkpoint 及 outbox；reset command 要明確打印提醒。新 user ID 會自然分隔舊 localStorage key；仍要測試舊 JWT／session／item ID fail closed；
- generation marker 不加入 credential 或 checkpoint payload。除非另開 credential contract migration，今次只用於 rebuild 狀態、報告、checker 及 storage-state 提示。

## 6. 示範學生數據重建設計

### 6.1 保留測試規模，重做學習內容

為避免排行榜、教師工作區及 responsive UI 測試失去現有覆蓋，首輪保留約 18 班、150 名學生、教師及管理員的規模；帳戶可以沿用易測試的
登入名稱，但所有 database ID、password hash、session 及學習歷史重新建立。

### 6.2 學習軌跡

fixture 使用固定 random seed 及 catalog revision，按班級混合以下軌跡，而不是每組只重複相同兩三個詞：

| 軌跡 | 建議狀態 | 程度進展 |
|---|---|---|
| NEW | 剛加入／未開始 | 0 或少量 A1 encounter |
| DEVELOPING | 有規律但仍在基礎階段 | A1 部分 recognized，少量 verification debt |
| STEADY | 穩定中段 | A1 每個單元達 80% recognition gate，合法開始 A2 |
| ADVANCED | 明顯領先 | A1／A2 recognition gate 完成，合法開始 B1；long-term mastery 只係其中一部分 |
| LEADING | 全校前列 | A1／A2／B1 recognition gate 完成，合法開始少量 B2；另有較高 long-term mastery |
| FOLLOW_UP／INTERMITTENT | 需要教師跟進 | 有學習日但錯題率、逾期複習或中斷明顯 |

重建規則：

- 明確分開 `recognizedForUnlock`（`repetitions >= 1`）及 `longTermMastered`（`interval >= 22`），唔再用同一個「掌握」字眼混合兩者；
- 先 A1、再 A2、再 B1、再 B2；高階事件發生時間必須晚於 production unlock condition 成立時間，checker 不可以只看最後狀態；
- 以目前 direction-eligible denominator 作未驗證估算，開始 B2 前約需 A1 292＋A2 1,168＋B1 1,362＝2,822 個 recognition gates；正式數量須在 current-eligible catalog 及 taxonomy 凍結後重算；
- 同一軌跡內每名學生使用不同但可重現的 current-eligible sense sample，避免全班共用完全相同詞組；
- category、POS、兩個出題方向及多義詞要有代表性覆蓋；
- demo progress 必須重用 production question construction、objective quality resolver、admission／delay／verification debt、operation fingerprint、Review revision helper、`updateSM2At()`、policy／construction version及 terminal rules；不可只手寫最終 Review；
- self-rating 不直接加 recognition 或 mastery；只有合法 Objective first response 先可以推進 Review；
- 日期採用 `Asia/Shanghai`，建立合理的連續學習、間斷、逾期複習及近期活動；
- 班級組成刻意混合不同軌跡，令本班、全年級、全校排行榜都能顯示有意義但不完全相同的名次；
- fixture spec 要 checked-in 並量化每個 track 人數、recognition／mastery band、B2 學生數、benchmark accounts 預期 rank band、tie／distinct-value 門檻、每日事件及總 row budget；各 analytics collection 必須低於現行 200,000-row hard cap；
- fixture 完成後不保留 open session、live target、未確認 operation 或可續接 checkpoint；checker 要由事件重播最終 Review，並雙向核對 event、encounter、StudyDay、snapshot、receipt 及 obligation chronology。

### 6.3 排行榜及分析口徑

Current stock 同歷史 activity 必須分開，不能將 ACTIVE-only 套用到所有報表：

| 指標 | 詞庫口徑 |
|---|---|
| 新題、due queue、單元 denominator | 查詢時 current-eligible sense |
| 單元解鎖 | current-eligible denominator + `repetitions >= 1` recognition |
| Current mastered count／排行榜掌握量 | current-eligible sense + `interval >= 22`，不按 unique term 合併 |
| 歷史答題、期間 accuracy、活動 | 事件發生時合法 immutable snapshot；日後 RETIRED 不刪除 |
| StudyDay／期間 streak | 合資格 historical operational Objective events 的 `Asia/Shanghai` 日期，不受日後停用影響 |
| Teacher analytics／export | 使用同一 metric projection，回傳 `catalogRevision` 及 `asOf` |

- 建立共用 `eligibleOperationalObjectiveEvent` predicate，畀 leaderboard、student stats、teacher analytics 及 export 使用；
- negative fixtures 覆蓋 non-winning event、diagnostic／research、missing snapshot／version、unsupported purpose 及 historical backfill；
- 班級、年級、全校 scope 只計 current ACTIVE student enrolment；
- checker 以 fixture spec 驗證 participant counts、benchmark rank bands、tie ratio、teacher summary＝detail＝export，以及 orphan／invalid snapshot／lineage delta 全部為 0。

## 7. 受影響範圍

### 7.1 資料及 scripts

- `prisma/schema.prisma` 及 expand migrations；
- `prisma/seed.ts`：移除 Markdown canonical seed，接入 catalog seed orchestrator；
- 新 CSV parser／validator／normalizer／bootstrap manifest／reconciliation report；
- `scripts/reset-local-roster.mjs`：不直接改變舊語義；另建清晰命名的 catalog rebuild command，或抽出共用 guard；
- `scripts/seed-demo-analytics.ts` 及 `scripts/check-demo-analytics-fixture.ts`；
- migration checksum、fresh replay、production safety 及 lineage checker。

### 7.2 Runtime consumers

至少要逐一盤點及切換：

- `src/lib/study-stream/server.ts`、`src/lib/study-session-server.ts`、`src/lib/review-queue.ts`；
- `src/lib/learning-policy/question.ts`、`src/lib/study-stream/contracts.ts` 及 public payload contract tests；
- `src/lib/unit-progress-server.ts`、`src/lib/units.ts`、`src/lib/mastered.ts`；
- `src/lib/leaderboard.ts`、`src/lib/student-metrics.ts`、`src/lib/teacher-workspace.ts`；
- `src/lib/learning-analytics.ts` 及 analytics export；
- `/api/study`、`/api/words`、student words／stats／units／leaderboard pages；
- V1 session／queue path 必須只讀 `Word` compatibility projection，並有 `off` mode smoke test；
- admin word APIs 在 compatibility window 必須停止直接修改／hard-delete legacy `Word`，後續由治理 workflow 接替。

### 7.3 單元 taxonomy

新 CSV category 數量及名稱與舊 A1 ordering 不相同。實作前須建立 checked-in `catalog-taxonomy-v1`，列明 25 個合法 code（目前 CSV 使用 24 個）、
每級 unit 次序、繁簡 label、`other`／缺失處理及 taxonomy digest。Validator 要拒絕未知 category；unit unlock／denominator 測試要以
current-eligible sense 計算，不能依賴舊 Markdown category 常數。

## 8. 分階段實施計劃

### Phase 0 — 批准 contract 及凍結輸入

- [ ] 使用者批准本切換方法；批准計劃不等於批准執行 destructive reset；
- [ ] 凍結四份 CSV 的 exact path、SHA-256、schema version 及 normalization version；
- [ ] 決定 107 行兩方向均停用資料的修訂責任及暫存為 DRAFT 的規則；
- [ ] 批准 `catalog-taxonomy-v1`、25 個合法 code、每級 unit 次序及 digest；
- [ ] 凍結 sense identity／stable key lifecycle、accepted-answer／方向規則及逐表 Review transition matrix；
- [ ] 確認保留 V1 rollback，批准 `LegacyWordSenseMap` compatibility projection；如要退役 V1，必須另行修改產品 contract；
- [x] 在上游詞庫治理計劃記錄所有環境共用 digest-bound 正式 ACTIVE／DRAFT baseline，並取消 environment-scoped 詞庫資格；
- [ ] 更新 Retrieval-first contract：sense identity、curated pool construction version、public answer-data boundary、retire／revision snapshot 及 mixed-identity prohibition。

驗收：上游 blocking contract、輸入 manifest、identity transition、V1 compatibility、eligibility policy 及 unit taxonomy 有書面版本；任何 CSV 改動都會令 digest gate 失敗。

### Phase 1 — 建立 CSV validator 及 import preview

- [ ] 實作 strict parser、normalizer、checked-in identity assignment manifest 及 blocking／warning 規則；
- [ ] 產生逐行 disposition、duplicate／conflict bundle、條件性例句、方向資格及總數 reconciliation；
- [ ] 為同 term 多 sense、正解排除、5–6 distractors、disabled direction、BOM 及 key collision 建立測試；
- [ ] 建立只讀 dry-run command，沒有 DB write 亦可完成報告；
- [ ] 測試 DRAFT import／正式 approval 各自的 operationId＋request-digest 冪等性及 409 conflict；
- [ ] 確認同一輸入重跑會產生 byte-stable manifest／logical-stable result，而且修改非 identity 內容不會換 sense key。

驗收：5,641 行全部有明確結果；沒有 lowest-level-wins、靜默 skip 或自動補造內容。

### Phase 2 — Sense-level schema、migration 及 seed

- [ ] 按上游治理計劃新增 CatalogEntry、WordSense、WordSenseRevision、CatalogRevision 及 import provenance；
- [ ] 按 3.6 transition matrix 修改 Review／ReviewEvent／stream／obligation／target／snapshot／encounter，加入 partial unique、projection-consistency guard 及 content revision provenance；最終 exact-one contract migration 仍待 V1 退役後另行處理；
- [ ] 修改 legacy ReviewEvent ledger trigger，只處理 legacy Word Review；sense writer 保留 operationId、CAS、Serializable retry 及 lineage；
- [x] 實作 digest-bound initial activation manifest、正式 ACTIVE／DRAFT seed 及所有環境 ACTIVE-only runtime；
- [x] 由 current ACTIVE catalog 建立 read-only `Word` compatibility projection 及 checked-in `LegacyWordSenseMap`；
- [ ] 封鎖 legacy Markdown canonical seed、legacy Word direct write／hard delete；
- [ ] 保持普通 migration 為 expand-safe，destructive cleanup 不放入一般 deploy migration；
- [ ] 驗證 fresh migration replay、Prisma Client generation、FK、unique constraint 及 checksum。

驗收：fresh DB 可保存同 term 多 sense；DRAFT／blocked 不會被 V2 query 選中；V1 compatibility projection 可獨立運作而不污染 V2 mastery。

### Phase 3 — Runtime reader 及題目建立切換

- [x] 將 V2 study selection、queue、review、unit、words、stats、leaderboard、teacher analytics 及 export 改為 current ACTIVE sense read model；
- [ ] question builder bump construction version，使用每個 sense、每個方向的 curated distractor pool，保存 immutable sense／content／catalog revision snapshot；
- [ ] 收窄 `PublicObjectiveQuestion`，未答題 payload 只保留題幹、direction、opaque options 及 construction version；
- [ ] 對無合法題目或 pool 驗證失敗的 sense fail closed，不計學生答錯；
- [x] 建立共用 `eligibleOperationalObjectiveEvent` predicate，統一 leaderboard、student／teacher analytics 及 export；
- [ ] 更新「單詞／詞義」顯示語義及 active denominator 說明；
- [ ] 增加 legacy Word dependency inventory gate、mixed-identity negative tests 及 V1 `off` smoke test。

驗收：V2 student／teacher runtime 不再以 legacy Word 作 canonical learning item；V1 rollback、V2 sense flow及 pre-answer payload contract 分別通過。

### Phase 4 — 重建學生示範資料 factory 及 checker

- [ ] 改寫 demo factory，按 current-eligible sense、direction eligibility 及 production learning contract 產生資料；
- [ ] 建立 NEW、DEVELOPING、STEADY、ADVANCED、LEADING、FOLLOW_UP／INTERMITTENT 軌跡；
- [ ] 增加 B2 小規模領先者覆蓋，並按事件時間驗證 A1 → A2 → B1 → B2 production unlock；
- [ ] 每名學生採用不同 deterministic sample，消除小型重複詞池；
- [ ] 使用 production quality、SM-2、operation fingerprint、revision、obligation及 question helpers 建立 provenance-complete histories；
- [ ] 建立 checked-in quantitative fixture spec，凍結 track counts、rank bands、tie門檻、row／performance budget；
- [ ] checker 由事件重播 Review，核對 recognition／long-term mastery、ranking、teacher summary＝detail＝export、真實 distractors及完整 lineage；
- [ ] fixture 完成後關閉所有 sessions／targets，並驗證 orphan／unexplained delta 為 0。

驗收：canonical demo factory／checker 可以在已完成 schema 及 catalog seed 的 fresh test DB 獨立通過，先可接入 destructive orchestrator。

### Phase 5 — 受保護的本地 rebuild orchestrator

- [x] 建立明確命名的 dry-run／execute command，所有 destructive 入口重用同一 exact local topology guard；
- [ ] 同時解析 `MIGRATE_URL` 及 `DATABASE_URL`，確認兩者指向同一 allowlisted database／schema；輸出不得包含密碼或完整 URL；
- [x] dry-run 顯示 server-observed target／role／address／port、現有 counts、CSV／taxonomy／identity digest、預期動作及不保留資料；
- [x] execute confirmation 綁定 exact DB target 及上述 digests，並要求 development markers 及額外 local catalog reset confirmation；
- [x] 全程持有 database-scoped advisory lock；流程固定為 drop schema → migrations → catalog／projection seed → roster seed → demo factory → checker；
- [x] migration 完成後標記 `BUILDING`；只有全部 checker 通過才標 `READY`，失敗標 `FAILED` 並停止，不以半完成資料當成功；
- [ ] dataset generation 只進 manifest／metadata／checker，打印 browser／storage-state 失效提示，不改 credential payload；
- [ ] 測試 production／remote host／兩 URL 不同 target／錯 database／缺 confirmation／digest mismatch／並發 rebuild 全部 fail closed。

驗收：未帶 execute 只能預覽；非 allowlisted／不一致 target 無法執行；同一 inputs 已由空 schema 重建成 `READY`，並通過 post-seed checker。

### Phase 6 — 執行本地切換（需要另一次明確授權）

- [x] 核對並記錄 dry-run target／CSV digest 及四份 CSV digest；
- [x] 使用者明確批准指定 local target `english_dev/public` 的 execute；
- [x] 執行完整 schema rebuild；
- [ ] 重新建立瀏覽器測試登入狀態，清除舊 browser checkpoint／outbox／storage state（本次只重建 DB 帳戶，未操作瀏覽器 storage state）；
- [x] 執行 post-seed checker、V1 ledger／rollback targeted smoke、V2 sense targeted smoke 及數量 reconciliation；
- [x] 記錄每種 import disposition、正式 ACTIVE／DRAFT、blocked／failed、compatibility mapping 及 dataset generation。

驗收：所有舊 local data 已被取代，應用只顯示新 CSV 詞庫及新 demo histories。本次指定 local target 已完成；browser storage state 及完整 authenticated browser matrix 仍屬後續驗證。

### Phase 7 — 文件及收尾

- [ ] 更新 `plans/project-plan.md` 中過時的 Markdown seed／Word 模型描述；
- [ ] 更新 `DEPLOY.md`／README 中 local seed、reset、browser state 及 troubleshooting 指引；
- [x] 在本計劃記錄實際測試、未執行項目、已知限制及後續 production gates；
- [ ] 只有全部必要驗證通過後，才把狀態改為「已完成」；目前仍有 browser storage／full browser matrix 及 V1 retirement contract gate。

### Revision 2 實際執行結果（詞庫資格部分已由 Revision 3 取代）

本次已完成並驗證以下 implementation scope：

- CSV parser／normalizer、39 欄 strict validation、prompt 保留空白、方向干擾項及 sibling-sense 答案安全檢查；
- checked-in opaque identity manifest。manifest 會以既有 source locator／match key 作 authority，新 row 明確分配 opaque key；duplicate term 需要明確 `KEEP_DISTINCT`／`MERGE`／`CONFLICT` resolution，並保存 `legacyPrimary`，不再用 lowest-level-wins；
- CatalogEntry／WordSense／WordSenseRevision／CatalogRevision／舊 eligibility compatibility table／import report migration 及 read-only Word compatibility projection；
- READY／DRAFT／RETIRED current read rule及 stale projection detach；當時採用的 environment-scoped eligibility 已由 2026-08-22 Revision 3 取代；
- Word／sense projection-consistency DB guard（包括 ReviewEvent），防止 matching pair 以外的 mixed identity；V1 physical `wordId` 尚未退役，所以最終 exactly-one contract 留作下一個 contract migration；
- V2 queue、unit、leaderboard、student／teacher／admin metrics 及 insights 的 current-sense／eligible-event readers；admin Word API 改為 read-only governance boundary；
- sense-level curated question builder、四個唯一 options 的 snapshot validation 及未答題 public payload answer-data boundary；
- deterministic A1→A2→B1→B2 demo factory／chronology checker、guarded rebuild orchestrator 及 actual CSV digest lock；本次 full rebuild 已完成並通過 demo checker。

Revision 2 當時 local catalog seed／checker 結果：5,641 行輸入、5,576 行通過 validator、65 行 `VALIDATION_FAILED`、5,469 個可用項目及 5,469 個 current Word projections；Revision 3 將呢 5,469 項正式設為 ACTIVE，107 項維持 DRAFT。

已通過：fresh／interrupted migration replay、migration checksum、Prisma validate／generate、`npx tsc --noEmit`、`npm run lint`、225 個 unit tests、`npm run build`、`npm run test:db`、`npm run test:db:stream-v2`、catalog／demo checker、完整 guarded local rebuild 及其 READY transition。兩個獨立 reviewer（資料模型／migration reviewer 及 demo／analytics／testing reviewer）已完成只讀審查；上述 guards、manifest、strict validator、current predicates、deterministic fixture、snapshot validation 及 admin read model 已按其主要 findings 跟進。

未執行／未宣稱完成：browser storage-state 清理、完整 authenticated browser／native device matrix、最終 V1 retirement exact-one contract migration 及 production rollout。DB-level V1 ledger smoke、V2 sense stream smoke、demo event chronology／lineage checker 已通過；因此本計劃仍然係「進行中」，但指定 local DB cutover 已完成。

## 9. 測試矩陣

| 範圍 | 必要驗證 |
|---|---|
| CSV contract | parser／BOM／39 欄、normalization、identity manifest、duplicate、同 term 多 sense、條件性例句、direction、答案唯一性、5–6 distractors |
| Import | dry-run 無寫入、digest／selection-set mismatch fail、primary disposition＋activation reconciliation、operationId冪等、409 conflict、transaction rollback |
| Migration | projection-consistency guard／partial unique／legacy trigger tests、`npm run test:migration-checksums`、`npm run test:migrations`、`npm run test:migrations:contract`（最終 exact-one contract migration 另行驗證） |
| Reset guards | dry-run default、兩 URL target 一致、advisory lock、BUILDING／READY／FAILED、錯 target／remote host／production markers／缺 confirmation 全部拒絕 |
| Study／policy | `npm test`、`npm run test:db`、`npm run test:db:stream-v2`、V1 off smoke、V2 sense、mixed identity、pre-answer payload、snapshot／lineage／idempotency tests |
| Demo fixture | seed preview、event replay、unlock chronology、fixture budget、`npm run check:demo-analytics-fixture`、重跑結果分布一致 |
| 排行榜／分析 | metric projection matrix、eligible-event negative cases、class／grade／school scopes、streak、mastered senses、study days、unit denominator、teacher summary＝detail＝export |
| 靜態驗證 | `npm run lint`、`npx tsc --noEmit`、`npm run build` |
| Browser | words、units、study、stats、leaderboard overview、teacher dashboard／analytics；如改動 study credential／action，執行 `npm run test:e2e:card-motion` |
| Production safety | `npm run check:production-config`；確認 reset／bootstrap 路徑在 production 不可用 |

### Post-seed 必查 invariants

- 輸入 5,641 行 = 所有互斥 primary import dispositions；activation 統計另行 reconciliation，兩者都沒有 unexplained delta；
- `catalogKey`／`senseKey` 唯一，approved pointer 只指 immutable approved revision；
- RETIRED 及所有 DRAFT 不出現在 queue、unit denominator 或 current mastery；所有環境只接受 ACTIVE approved sense；
- enabled direction 的 final options 只有一個 accepted correct answer；
- 未答題 public payload 不含 canonical answer、accepted answer set 或 `correctOptionId`；
- Review、ReviewEvent、StudyEncounter、stream、target、snapshot、receipt lineage 完整；
- 沒有 open session、live target、orphan FK、projection-mismatched identity、legacy Word-backed V2 review 或舊 dataset generation；physical exact-one identity 仍屬下一個 V1 retirement contract；
- `LegacyWordSenseMap` 每個 projection row 有且只有一個 primary sense，V1 off smoke 通過；
- A1、A2、B1、B2 coverage 符合 fixture spec，高階事件 timestamp 不早於低階 production unlock；
- 班級、年級、全校排行榜符合 participant／rank／tie bands，teacher summary、detail、export 同一 `asOf` 數值一致；
- `DatabaseMetadata` rebuild state 最終為 `READY`。

## 10. 風險及緩解

| 風險 | 緩解 |
|---|---|
| 直接沿用 Word 導致多義詞丟失 | sense-level schema 先行；inventory gate 禁止 canonical reader 回退 |
| sense 欄只做 optional，writer 仍混用 word | matching projection-consistency DB guard、partial unique、session read mode、writer／trigger tests；V1 退役後再做 exact-one contract migration |
| 切走 Word 令 V1 rollback 失效 | checked-in `LegacyWordSenseMap`＋read-only projection＋fresh-reset `off` smoke test |
| 未經控制把全部 CREATE_DRAFT 當已正式批准 | exact-digest initial activation manifest 鎖定規則及數量；5,469 ACTIVE、107 DRAFT、65 validation failed；digest 或數量不符即拒絕 seed |
| Stable key 跟內容改動而漂移 | checked-in identity assignment；更新帶回 keys；material meaning change 先建立新 sense |
| 新增／停用 sense 令 current／歷史 metric 混亂 | versioned catalog revision＋metric projection matrix＋`catalogRevision`／`asOf` |
| 只刪 Word 留下 stale events／receipts | full schema rebuild，不做局部 delete |
| reset 錯資料庫或並發重建 | 兩 URL 同 target、allowlist、server-observed metadata、advisory lock、digest-bound confirmation、production hard deny |
| 舊 browser state 指向新 DB 不存在 ID | session invalidation、storage-state 重建及舊 JWT／item fail-closed test；generation 不擴入 credential contract |
| 題目前端 payload 暴露 canonical answer | 收窄 public contract，答案資料只留 server snapshot，response JSON negative test |
| demo 直接寫假題目／假進度令測試失真 | 重用完整 production learning helpers；event replay、unlock chronology及 curated-pool checker |
| fixture 太規律、過大或排名失真 | checked-in quantitative fixture spec、每人 deterministic variation、rank／tie／row-budget checker |
| category 改名破壞單元解鎖 | versioned taxonomy mapping 及 unknown-category blocking validator |
| migration 同本地 reset 混為一談 | schema 採 expand-safe migration；destructive reset 只存在明確 local command |

## 11. 發佈、觀察及 rollback

### 11.1 本地執行前

- 本計劃獲批准後只代表可以開始實作；真正 drop local schema 前仍要由使用者再次明確批准；
- 因使用者已確認資料可棄置，不要求保存舊 data dump；dry-run 仍保存 counts、target 及 input digests 作審計；
- 若將來發現任何資料其實要保留，必須在 Phase 6 前停止，另開 mapping／backup 決定。

### 11.2 Rollback

- reset 前：沒有資料改動，停止即可；
- reset 中失敗：清理同一個已確認 local schema，從空 DB 重跑固定流程，不在半完成資料上修補；
- reset 後功能回歸：切回最後可用 commit，以舊 migrations／seed 重新建立另一個 disposable local DB；不嘗試還原已棄置 demo history；
- production：本計劃沒有 rollout，所以不存在 production rollback 行動。

### 11.3 觀察

切換後至少核對 catalog dispositions／activation、blocked／failed reasons、study queue construction failure、各方向出題比例、public payload、
V1／V2 smoke、leaderboard 分布、unlock chronology、unit denominator、teacher analytics load 及 fixture checker。任何 unexplained count delta、
孤兒 lineage、mixed identity、current-eligible sense 無合法題目或 rebuild state 非 `READY` 均視為 blocking failure。

## 12. 決策紀錄

| 日期 | 決定 | 理由 |
|---|---|---|
| 2026-08-19 | 不保留舊本地學生或詞庫資料 | 全部為測試資料，映射會增加錯誤 sense mastery 風險 |
| 2026-08-19 | 採完整 local schema rebuild | 一次清除舊詞 FK、snapshot、session、receipt 及 demo 帳戶，較逐表 delete 完整 |
| 2026-08-19 | 不把 CSV 壓平到 legacy Word | 會丟失至少 674 個同 term 額外詞義 |
| 2026-08-19 | Canonical CSV revision 保持 DRAFT；local manifest 只授予 environment-scoped eligibility | 已由 2026-08-22 使用者決定取代 |
| 2026-08-22 | 所有環境共用 digest-bound 正式初始詞庫：5,469 ACTIVE、107 DRAFT；取消 test-only eligibility | 測試與 production 不應有兩套詞庫語義；其後修改仍走草稿及四眼審批 |
| 2026-08-19 | 兩方向均停用的 107 行不進 runtime learning | 無法產生合法 Objective Probe，強行啟用會破壞 mastery contract |
| 2026-08-19 | demo 由 current-eligible sense 及完整 production learning helpers 重建 | 確保 Review、排行榜、統計及題目反映真實產品 contract |
| 2026-08-19 | 保留 read-only Word compatibility projection | 現行產品仍要求 V1 `off` rollback，不能在本切換默認退役 |
| 2026-08-19 | Review 等學習表先採 matching word／sense projection transition | 現行 V1 仍要求 `wordId`；今次先阻止不一致 pair，最終 exact-one 於 V1 退役後另開 contract migration |
| 2026-08-19 | 分開 recognition unlock 與 long-term mastery | 現行單元門檻是 repetitions ≥ 1，排行榜／教師掌握量是 interval ≥ 22 |
| 2026-08-19 | dataset generation 不加入 credential／checkpoint | 完整 reset 已令舊 ID fail closed；避免無必要擴大安全 contract |
| 2026-08-19 | 修正 pre-answer Objective payload 列為 cutover prerequisite | 現行 public type 同時帶 term／definition，會暴露其中一個 canonical answer |

## 13. 未決事項

開始實作前要完成以下 blocking decisions；唔再將問題縮減成只有三項：

1. 批准 sense identity、逐表 Review transition、stable key lifecycle 及 material-meaning-change 規則；
2. 批准保留 V1 rollback 及 `LegacyWordSenseMap` primary-sense compatibility；如要退役 V1，先修改產品 contract；
3. 批准 accepted-answer／direction／curated-pool／public payload contract 及新 construction version；
4. 接受所有環境只讀 ACTIVE approved sense；現有 baseline 由 exact-digest manifest 正式啟用 5,469 項，107 項保持 DRAFT；
5. 接受 107 行兩方向均停用及其他未通過條件性內容／conflict 的資料不出現在學生詞庫；
6. 批准 `catalog-taxonomy-v1`、current／historical metric matrix及 recognition／long-term mastery 兩套門檻；
7. 確認保留約 18 班／150 名學生的 demo 規模、少量 B2 領先學生及 checked-in quantitative fixture budget；
8. 同意 Phase 6 前另行預覽 exact local target＋input digests，再獨立批准 destructive reset。

## 14. Definition of Done

- [x] 四份 CSV 經 versioned validator、identity assignment、primary dispositions、activation report、exact source digest及 ACTIVE／DRAFT set digests控制；
- [ ] sense-level schema、matching projection-consistency transition、V1 compatibility projection及 trigger／writer guards 完成；最終 exactly-one identity contract migration 尚未完成；
- [ ] V2 runtime readers、new-version curated question builder、safe public payload及 common metric projection 完成；
- [ ] 新 guarded local rebuild command 通過正反 guard tests；
- [ ] 新 demo fixture 及 checker 覆蓋 A1–B2 unlock chronology、recognition／mastery、班／級／校排名及教師分析；
- [ ] 使用者另行批准並成功完成指定 local DB rebuild；
- [ ] 所有 post-seed invariants、測試矩陣及 browser smoke 通過；
- [ ] 實際 import dispositions、ACTIVE／DRAFT／blocked、compatibility mapping、dataset generation、測試結果及未執行項目已記錄；
- [ ] 沒有 production deploy、production reset 或未獲批准的 destructive contract cleanup。

### Revision 3 實際驗證結果（2026-08-22）

- 正式 baseline manifest 鎖定 5,641 source rows、5,576 valid、5,469 ACTIVE、107 DRAFT、65 validation failed，以及 ACTIVE／DRAFT sense-key set digest；
- 本地 catalog reseed 冪等完成：5,469 current projections、4,861 legacy primary mappings；因原本 5,469 sense 已正式 ACTIVE，本次 `activated=0`，沒有覆寫 approved pointer；
- `check:catalog-governance`：ACTIVE missing lineage 0、projection mismatch 0、DRAFT approved pointer 0、obsolete `CatalogEligibility` row 0；
- GitHub 曾失敗的 `test:db:stream-v2` 已在同一正式 catalog 上重跑通過；233 個 unit tests、lint zero warnings、typecheck及 production build亦通過；
- workflows 已在 seed 後加入 `check:catalog`／`check:catalog-governance`。本次未獲 commit／push 指示，所以 GitHub 尚未用新 commit rerun；dependency audit advisory 仍係獨立未解項。
