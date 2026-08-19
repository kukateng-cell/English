# 詞庫詞義、CSV 匯入、審核及生命週期實施計劃

> 狀態：進行中（只完成 Phase 0 現況盤點及規範草案；功能程式、migration、轉換及 UI 尚未開始）
>
> 日期：2026-08-18
>
> 工作 branch：`codex/word-catalog-governance-and-lifecycle`
>
> Branch 起點：`codex/class-roster-import-and-access-control` @ `e04639d4469136d65dddb45d9b78bae3c316d551`
>
> 規範文件：[英語詞庫編寫、匯入及質量檢查標準 v1](./artifacts/word-catalog-authoring-standard-v1.md)
>
> 範圍：local product design／implementation／verification；不包括 production deploy、真實詞庫啟用或 destructive contract cleanup

## 1. 背景及問題定義

平台現時用 `word list.md` 作初始內容來源，但 runtime 實際讀 PostgreSQL `Word`。現行模型將 `term` 設為唯一，只有一個
`definition`、`level` 同 `category`；seed 遇到同一英文出現在多個程度時會保留最低 level。Objective Probe 再由其他 `Word`
動態抽三個干擾項。管理員可以直接新增／修改／hard delete，老師沒有提交或審核詞庫嘅正式流程。

呢個模型不能正確表示以下已確認需求：

- `run = 跑步` 可以係 A1，而 `run = 經營` 可以係 B1；
- 同一英文嘅不同詞義要有獨立學習進度、例句、方向設定及干擾項；Objective Probe 唔顯示額外 prompt；
- 英譯中同中譯英各自使用 5–6 個人工選定候選干擾項，出題只抽三個；
- 一般老師可以提交新詞／新詞義及停用建議，少數老師以 account-level capability 審核；
- 停用係可逆 soft retirement，不能刪除學生歷史、題目 snapshot 或統計 provenance；
- 多人 CSV 製作要有 schema、normalization、duplicate／conflict preview、revision 及審核紀錄；
- 現有 Markdown 要先轉成新格式草稿及質量報告，再決定人工補充工作量。

## 2. 現況盤點

### 2.1 可執行 baseline

| 範圍 | 現況 | 新需求衝突 |
|---|---|---|
| `prisma/schema.prisma` | `Word.term @unique`；單一 `definition`／`level`／`category` | 不能保存同一 term 嘅多個 sense 或跨 level 熟詞新義 |
| `Review` | `@@unique([userId, wordId])` | 目前 wordId 實際等於英文詞；未來要明確等於 sense learning item |
| `ReviewEvent` | 保存 `submittedWordId`、`wordTerm`、`wordLevel` snapshot，word FK 可 SetNull | 歷史保存基礎良好，但要加入 sense／catalog／content revision provenance |
| `prisma/seed.ts` | 解析 Markdown 四欄；同 term 最低 level 勝出；按 term upsert | 會靜默丟失高階新詞義，不能作新 canonical import |
| question builder | 由其他詞條動態推算三個 distractors；方向按 seed 二選一 | 同新草案「每個 sense 有兩組 5–6 個人工候選池」不符 |
| question snapshot | 保存題目顯示文字、direction、options、correct option、construction version | 可沿用 immutable snapshot 原則，但 construction version 必須更新 |
| admin word API | ADMIN-only 直接 create／patch／hard delete | 缺少 draft／review／retire、teacher capability、audit 及 revision CAS |
| `TeacherProfile` | 已有 account-level `canResetStudentPassword` capability pattern | 可沿用同類模式新增 `canManageWordCatalog`，不必新增角色 |
| UI／metrics | 多處稱「單詞」及以 Word／level denominator 計算 | Sense-level 後要分清「詞目數」同「已掌握詞義」 |

### 2.2 不可破壞嘅既有 contract

- Learning Card 仍採 3 秒 stationary long-press reveal；self-rating 不直接改 Review／mastery；
- 只有合法 Objective Probe first response 由 server scoring，correct=4／wrong=2；
- 每題仍然係 immutable snapshot、唯一無歧義正解、opaque option ID、server-owned order；
- 無法構造合法題目時 fail closed，不能當學生答錯；
- operationId、credential lineage、Review revision CAS、Serializable transaction、resume／outbox 語義保留；
- V2 historical metrics／ReviewEvent provenance 不能因詞庫修改或停用被重寫；
- 角色仍然只有 `ADMIN`、`TEACHER`、`STUDENT`；詞庫審核使用 teacher capability。

## 3. 目標

1. 凍結 `word-catalog-v1` 團隊編寫及 CSV data contract。
2. 將 learning item 由唯一英文 term 改為穩定 sense；同一 lemma 可有多個 level／meaning。
3. 為每個 sense 建立獨立雙向 enable flag 同 5–6 個人工 distractors；題幹固定由 `term`／`definition_zh` 衍生，唔另設 prompt。
4. 建立 CSV parse → normalize → validate → conflict preview → idempotent draft commit 工作流。
5. 建立 DRAFT／ACTIVE／RETIRED soft lifecycle、revision CAS、change request 及 audit。
6. 一般老師可提交；`canManageWordCatalog` 老師及管理員可審核／啟用／停用／重啟。
7. 現有 Markdown 可 dry-run 轉成帶 provenance 嘅新格式草稿，完整列出重複及缺漏。
8. 學習、單元、統計、排行榜及教師分析正確處理新增／停用 sense。

## 4. 非目標

- 不新增第四種產品角色；
- 不畀學生 app 帳號直接修改 production 詞庫；學生內容團隊只交受控 CSV；
- 不以 AI／其他詞條臨場生成或補足干擾項；
- 不在本期建立外部字典 runtime API、圖片搜尋、錄音或內容版權抓取管線；
- 不以 CSV 缺行表達停用，亦不保留日常 hard-delete 詞庫 API；
- 不自動把舊 Markdown 缺少嘅 POS、必要例句或 distractors 當成已審核內容；
- 不執行 production deploy、production DB migration、真實教師 rollout 或 destructive contract migration；
- 不改變 Retrieval-first V2 gesture、quality mapping 或 objective first-response contract。

## 5. 成功準則

- 同一 lemma 可以存在 A1「跑步」及 B1「經營」等獨立 sense，兩者 Review／mastery 不互相覆蓋；
- 每個 enabled direction 有 5–6 個人工候選項，server 只從該池選三個並保存 immutable snapshot；
- 多義詞每次只簽發一個 sense；同一英文其他 sense 嘅正確中文答案不得出現在該題候選池，final options 必須只有一個可接受答案；
- 兩人提交同一 `run` 時會進同一 headword conflict bundle，不能 last-write-wins 或產生未察覺 duplicate；
- 新 CSV keys 可以留空；更新既有資料必須以 stable keys + expected revision CAS；
- 一般老師不能批准自己嘅 capability 權限或直接啟用／停用；新／material change 提交者不能自批；未授權 URL／API mutation 一律 403；
- RETIRED sense 不再出新題，但 ReviewEvent、issued snapshot、歷史 activity 及 audit 全部保留；
- 新增 ACTIVE sense 不會把同 lemma 已有 mastery 複製過去；
- current mastery／unit denominator 只計 ACTIVE sense，歷史事件報表保留原 snapshot 並可解釋 catalog revision；
- 現有 Markdown converter 可以完整列出所有原始行，沒有 lowest-level-wins 靜默資料丟失；
- fresh database migration／seed、unit、DB、question construction、authorization 及 browser checks 通過。

## 6. Canonical data contract

### 6.1 Conceptual model

```text
CatalogRevision（全域單調遞增 activation／retirement sequence）
  └── CatalogEntry / Lexeme
        catalogKey
        canonical lemma / normalized lemma
        └── WordSense / Learning Item identity
              senseKey
              DRAFT | ACTIVE | RETIRED
              approvedRevisionId
              ├── immutable WordSenseRevision（內容、answer sets、direction flags、pools）
              ├── CatalogChangeRequest（base approved revision／digest）
              ├── Review / ReviewEvent
              ├── Study stream / obligation / target
              └── immutable question snapshots
```

### 6.2 Prisma transition decision

雙審查指出，將現有 `Word` row 原地改成完整新 sense 會令 legacy seed／hard-delete／rollback reader 誤讀 DRAFT 或 RETIRED 內容。
expand 階段改採以下 physical strategy：

- 新增獨立 `CatalogEntry`、`WordSense`、immutable `WordSenseRevision`、`CatalogRevision`、change request／import／audit tables；
- `WordSense.approvedRevisionId` 只指向已批准 revision；DRAFT proposal 永不原地覆寫 approved row，runtime 只讀 approved pointer；
- 現有 physical `Word` 及 `wordId` FK 在 compatibility window 保留為 legacy read-only；先封鎖舊 seed、直接 update 及 hard-delete，再開始新 catalog 寫入；
- expand migration 為 `Review`、target／obligation／stream／snapshot 加 optional sense provenance，唔將舊 `wordId` 嘅語義靜默改名；新資料用 sense identity；
- 建立 `LegacyWordSenseMap`：只有人工確認一對一 exact mapping 可以承接舊 Review；一對多／含糊 mapping 只保留 historical provenance，新 sense 由未掌握開始；
- 學習歷史關係採 soft-only／RESTRICT 思路，日常 catalog 操作不可 cascade 刪 mastery；
- local disposable data 可在使用者批准嘅 protected reset 後直接用新 catalog seed 重建；production-safe migration 仍保留上述 mapping／dual-read 證據；
- rollback 只可回到識別 lifecycle gate 嘅 compatibility reader，唔可以重新啟用會發出 DRAFT／RETIRED 項目嘅舊 builder。

新表最終命名可在 Phase 1 schema review 確認，但必須同 legacy physical `Word` 清楚分開；外部 CSV 同產品語義一律以
`catalog_key`／`sense_key` 為準。

### 6.3 Planned fields

Sense identity／approved revision 至少要支援：

- stable keys：catalog／sense；
- canonical + normalized term／lemma／display definition／structured accepted-answer sets；
- POS、level、category、IPA、例句、accepted forms、synonyms、antonyms；
- `enableEnToZh`、`distractorsZh[5..6]`；
- `enableZhToEn`、`distractorsEn[5..6]`；
- status、immutable content revision、`approvedRevisionId`、`baseApprovedRevisionId`／digest、source reference；
- created／updated／approved／retired metadata；
- retirement reason、emergency-withdraw metadata 及 current approved revision provenance；
- versioned normalization／繁簡轉換版本，保留原 display value，簡體只係 UI derivative，唔反寫 approved canonical 繁體；
- 全域 `CatalogRevision` 及每個 activate／retire／reactivate／emergency-withdraw 嘅 effective revision。

`CatalogChangeRequest`／`CatalogImportBatch` 類模型要保存 immutable proposal、proposer、peer checker、approver、validator／normalization version、
schema version、file hash、`(actorUserId, operationId)`、request digest、preview expected revisions、逐項 resolution、before／after revision 及 timestamps。
Audit 不保存學生個人資料或無必要原檔內容。

## 7. Question construction contract

- Construction version 必須由目前 dynamic-distractor version bump；舊 snapshot 保留舊 version；
- target 只可係 ACTIVE sense，方向只可從 enabled directions 中 deterministic 選擇；
- 唔接受或顯示自訂 prompt；英譯中顯示 `term` 並以 `definition_zh` 為 canonical correct，中文譯英顯示 `definition_zh` 並以 `term` 為 canonical correct；
- 對應 5–6 個 curated distractors 經 structural validation 後，以 server seed無放回選三個；
- correct + 3 distractors 再按 server seed排序；client 只收到 opaque option IDs；
- snapshot 加入 catalog key、sense key、content revision、direction、derived display stem、word／definition snapshot及 final options；
- runtime 不由其他 Word 補候選池，亦不因 pool 更新重寫已發出 snapshot；
- validator 先建立兩方向完整 normalized answer sets；final options 只可以有一個 acceptable answer，唔要求自然語言全球唯一譯法；
- 英譯中 validator 要將同一 normalized term／lemma 所有 sibling senses 嘅 canonical／accepted 中文答案加入禁止集合；例如 `run=跑步`
  候選池不得有「經營」，反之亦然；
- pool 少於五個／多於六個、重複、撞目前或 sibling-sense answer set、方向未啟用，或者 final options 有多個合理答案時 fail closed；
- question unit tests覆蓋 `C(5,3)=10` 及 `C(6,3)=20` 候選組合可被抽到、order穩定、snapshot immutable及無 cross-direction 混用。

## 8. Lifecycle、權限及審核

### 8.1 權限矩陣

| 動作 | ADMIN | TEACHER + capability | 一般 TEACHER | STUDENT |
|---|---:|---:|---:|---:|
| 查看 ACTIVE 詞庫 | 是 | 是 | 是 | 只限學生詞表產品視圖 |
| 查看審核 queue／內部 metadata | 是 | 是 | 只限自己提交／允許摘要 | 否 |
| 逐個／CSV 提交 DRAFT | 是 | 是 | 是 | 否 |
| 提交停用／重啟申請 | 是 | 是 | 是 | 否 |
| 修改別人草稿／解決 conflict | 是 | 是 | 否 | 否 |
| 批准／拒絕／啟用 | 是 | 是 | 否 | 否 |
| 停用／重新啟用 | 是 | 是 | 否 | 否 |
| 緊急撤回 | 是 | 是 | 否 | 否 |
| hard delete | 否（正常流程） | 否 | 否 | 否 |

新增 `TeacherProfile.canManageWordCatalog Boolean @default(false)`；ADMIN 由 role 永遠具完整權限。呢個 capability 係全校詞庫權限，
不放入 class-scoped `TeacherClassAccess`。管理員授予／撤銷時 increment access revision、撤銷適用 session capability cache並寫安全 audit。

### 8.2 State transitions

```text
new proposal → DRAFT → ACTIVE → RETIRED
                    ↑        └→ ACTIVE（同一詞義重新啟用）
                    └── material replacement 以新 DRAFT／sense 處理
```

- 一般老師提交只建立 proposal／DRAFT；
- ACTIVE sense 嘅修改建立 immutable candidate revision，approved revision pointer 喺批准前保持不變；
- reviewer approval transaction 內硬性檢查 `approver != proposer`（純非語義 typo 例外）、重跑 current validator、base revision／digest CAS、authorization同 duplicate check，再原子切換 approved pointer；
- 一般 RETIRED 後禁止新 stream item／target／obligation；「已簽發」定義為 snapshot 同 bounded lease 已成功寫入，只容許 `issuedAt < retiredAt` 項目完成；retire 交易取消未 snapshot 嘅 OPEN work；
- 嚴重錯譯、冒犯或安全風險使用緊急撤回：未完成 snapshot 中性取消、唔計錯／唔產生 scored event，保留 audit，並要求第二位授權人事後覆核；
- material meaning change唔直接改 active sense identity；用新 draft／sense替代並明確 retire舊 sense；
- 所有 transitions 寫 actor、reason、before／after revision及 audit。

## 9. Import、duplicate 及 conflict workflow

Importer 必須實作標準文件第 9–12 節，最少包含：

- UTF-8 CSV、exact header／schema version、size／row caps、formula／CSV injection防護；
- parse同commit分離，preview預設 read-only；
- NFKC／whitespace／case／Chinese canonical normalization；
- headword、exact-sense、question及content fingerprints；
- file內同database內 duplicate、stale revision、key collision、level／category disagreement；
- row status：`VALID_NEW_DRAFT`、`VALID_UPDATE_DRAFT`、`NO_CHANGE`、`WARNING`、`CONFLICT`、`ERROR`；
- explicit resolution：merge、keep distinct senses、link variant、replace draft、reject、escalate；
- atomic／idempotent commit；以 `(actorUserId, operationId)` 唯一並綁定 `requestDigest(schemaVersion + fileHash + orderedRows + resolutions + expectedRevisions)`；同 ID／不同 digest 回 409；
- preview 到 commit 間重跑 current revision、duplicate及authorization checks；receipt、batch mutations及 final result 同一 Serializable transaction 寫入；
- 任何 conflict未解決時不可以部分啟用；draft commit可按明確 batch contract決定全批 atomic；
- 缺行永不 retire；retire／reactivate必須 explicit action + stable keys + expected revision + reason；
- preview／commit audit保存hash同統計，敏感資料及完整未必要原檔按 retention policy處理。

## 10. 學習、統計及 UI 影響

### 10.1 學生流程

- Learning Card 以 sense 為目標，顯示 term、該 sense 定義、POS、level及學習用 example；Objective Probe 唔顯示 example 或額外提示；
- 同 lemma 高階新義可顯示「熟詞新義」，但唔顯示未解鎖答案；
- Objective Probe 一次只考一個 sense，唔把所有 level 意思合併成一個答案；
- retired sense 不再進新學習／due candidate；already-issued feedback／snapshot仍可恢復。

### 10.2 Unit、mastery、排行榜及分析

- unit eligibility／unlock denominator 改為 ACTIVE senses；
- Review unique identity實際變成 user + sense；同 lemma 兩個 sense可有獨立SM-2狀態；
- UI 數量文案分開「詞目」與「詞義」，mastery 類指標預設稱「已掌握詞義」；
- current mastery排行榜只計 ACTIVE senses；period activity／accuracy仍計發生時合法 ReviewEvent；
- teacher／admin analytics顯示全域 catalog revision／content update提示，排行榜同統計保存 as-of revision，避免新詞啟用後進度下降無法解釋；
- ReviewEvent／snapshot補 sense key、catalog key、content revision snapshot；舊 event維持 legacy provenance；
- retirement及definition修改唔重寫歷史 event／answer text。

### 10.3 管理及教師 UI

需要建立：

- 詞庫列表：headword grouping、sense rows、level、POS、status、direction readiness、revision；
- DRAFT／conflict／retirement review queue；
- 逐個新增／修改表單，只要求一般老師處理內容欄，keys只讀／隱藏；
- CSV upload → preview → error download → commit drafts；
- duplicate comparison與merge／keep-distinct／variant disposition；
- 5–6 個干擾項嘅兩方向 preview，可模擬隨機抽三個並顯示完整 answer-set collision；
- 方向審核 workspace：唯一正解 disposition、disabled reason、逐項 distractor review 及 reviewer sign-off；
- 生命週期申請 workspace：retire／reactivate 只要求 stable keys、expected revision、reason 及 reviewer result；
- category dictionary 及 level／core-extension guidance；
- retire／reactivate confirmation，要求理由並顯示受影響 active reviews／pending work aggregate；另有高警示緊急撤回流程及事後覆核 queue；
- responsive、zh-Hant／zh-Hans、light／dark、keyboard／screen-reader支援。

## 11. 現有 Markdown 轉換策略

### 11.1 Converter 原則

- 建立 read-only converter，逐行保存原檔 line number、level heading、category及raw text；
- 唔再 lowest-level-wins；同 term所有出現先分組；
- exact normalized definition候選可以提出 merge，但 level disagreement仍報 conflict；
- 不同 definition保留為 potential distinct senses，唔由程式猜語義；
- 產生 `word-catalog-v1` DRAFT CSV候選、category mapping report、缺欄報告及完整 quality summary；
- keys由導入器產生；未經人工審核唔變 ACTIVE；
- converter output要 deterministic，同一 input／version產生同一 fingerprint及報告。

### 11.2 Local cutover

目前無正式 production、現存內容及學生資料都係測試用途，所以 local cutover可以在使用者另行確認後採 protected reset + new seed。
不過 converter、schema、migration同audit仍要能支援日後production soft lifecycle，唔將一次性可刪資料假設寫入普通 migration。

## 12. 分階段實施

### Phase 0 — Contract freeze（目前）

- [x] 確認 branch 起點及建立專用 branch；
- [x] 盤點現有 Word／Review／seed／question／admin API／teacher capability；
- [x] 建立 `word-catalog-v1` authoring／CSV／conflict／lifecycle 草案；
- [ ] 使用者確認每行一 sense、canonical 中文、category taxonomy、每方向 5–6 個 distractors及其餘欄目；
- [x] 使用者確認 Objective Probe 唔顯示自訂 prompt；題幹由 `term`／`definition_zh` 衍生，同詞其他 sense 正解不得成為干擾項；
- [ ] 凍結 sample template、valid／invalid fixture及決策紀錄；
- [ ] 更新 Retrieval-first construction contract，批准 sense-level item及新版 distractor contract。

### Phase 1 — Pure contract、validator及 converter

- [ ] TypeScript strict schema／enum／normalization library；
- [ ] CSV parser、header／encoding／formula／size checks；
- [ ] row validator、fingerprints、duplicate／conflict engine；
- [ ] deterministic current-Markdown converter及provenance report；
- [ ] valid／invalid／duplicate／polysemy fixtures；
- [ ] 純函數 tests及完整 current word list dry-run report；
- [ ] 根據報告更新 data standard／mapping decisions，再進 schema。

### Phase 2 — Expand schema及 data services

- [ ] 更新 Prisma schema及新增一般 forward migration；
- [ ] 建立 catalog parent、sense identity、immutable sense revision／approved pointer、全域 catalog revision、change request、import batch／audit；
- [ ] 新增 teacher account-level capability及授權 audit；
- [ ] 保留既有 physical Word 為 read-only compatibility，建立 `LegacyWordSenseMap`、optional sense provenance及 legacy／new read boundary；
- [ ] Prisma generate、checksum、fresh replay、DB invariants及migration tests；
- [ ] local protected reset／seed方案另行確認後先執行。

### Phase 3 — Question、scheduler及 learning integration

- [ ] bump item construction version；
- [ ] 改用 sense-level derived stem + exact direction candidate pool；禁止讀取／顯示 prompt 保留欄；
- [ ] ACTIVE-only issuance、snapshot + lease 線性化、一般 RETIRED／緊急撤回行為及invalid fail-closed；
- [ ] Review／target／obligation dedupe語義改為 sense；
- [ ] snapshot／ReviewEvent加入 content provenance；
- [ ] unit、mastery、leaderboard、teacher analytics口徑更新；
- [ ] pure／DB／V2 study regression通過。

### Phase 4 — Submission、review及 lifecycle UI/API

- [ ] 一般老師 create／update draft、change／retire requests；
- [ ] capability teacher/admin review、approve、reject、retire、reactivate、emergency withdraw及post-review；
- [ ] server-side authorization、CSRF、rate limit、revision CAS及audit；
- [ ] admin／teacher responsive catalog workspace；
- [ ] zh-Hant／zh-Hans、theme、keyboard、screen-reader驗收。

### Phase 5 — CSV preview／commit及 conflict resolution

- [ ] upload caps、preview batches、downloadable error report；
- [ ] database diff、duplicate grouping、explicit dispositions；
- [ ] request-digest-bound idempotent atomic draft commit及 preview→commit TOCTOU regression；
- [ ] stale revision同 concurrent approval tests；
- [ ] import retention／cleanup及operational metrics；
- [ ] full-size performance測試。

### Phase 6 — 現有詞庫轉換及內容補充

- [ ] 執行 converter dry-run並保存summary artifact；
- [ ] 決定175個legacy headings到v1 category mapping；
- [ ] 人工處理同 term跨 level／definition conflict；
- [ ] 分批補POS、必要 examples同雙向 distractors；prompt 保留欄一律留空；
- [ ] authorized teacher review後先標ACTIVE；
- [ ] 對比舊詞數、原始行數、new headwords／senses及所有未處理項，零 silent loss。

### Phase 7 — Release／rollback readiness

- [ ] lint、typecheck、unit、DB、migration、build、relevant Playwright全部通過；
- [ ] feature-off／old-reader rollback或dual-read窗口驗證；
- [ ] backup、deploy、observation、alerts、runbook及rollback checklist；
- [ ] production migration／deploy另行取得明確授權；
- [ ] 完成後更新project plan、README index、actual verification同known limitations。

## 13. 測試矩陣

| 範圍 | 必須證明 |
|---|---|
| CSV contract | exact header、UTF-8、quoting、enum、Boolean、length、formula、unknown column、row cap |
| Normalization | case／NFKC／space／apostrophe／Chinese canonical穩定，保留display value |
| Polysemy | 同 lemma多 senses／levels合法；同 sense跨 levels報衝突；Review獨立 |
| Distractors | 每方向 5–6 個、直接抽三個、無fallback、與完整 answer set 零碰撞、兩方向不交叉、all combinations reachable |
| Multi-sense options | 同 term多 senses可以顯示同一裸詞；目前／sibling answer sets不得入候選池；final options唯一；disabled direction不被選 |
| Import | preview無寫入、duplicate grouping、stale revision、request digest、同ID異payload 409、TOCTOU重查、idempotent commit、atomic failure |
| Authorization | general teacher submit-only；capability teacher review；material change approver≠proposer；student／unauthorized fail closed |
| Lifecycle | DRAFT/RETIRED無新item；snapshot+lease issuance邊界；一般停用可完成舊lease；緊急撤回中性取消；reactivate continuity；無hard delete |
| Evidence | first response、Review CAS、operationId、snapshot、ReviewEvent provenance維持 |
| Metrics | active denominator、historical event retention、word-vs-sense copy、catalog revision可追溯 |
| Migration | Prisma generate、checksum、fresh replay、legacy read-only boundary、LegacyWordSenseMap、含糊 mastery 不複製、no destructive normal migration |
| UX／a11y | responsive、keyboard、screen reader、locale、theme、error summary及focus management |

預計驗證指令包括：

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:db
npm run test:migrations
npm run test:migration-checksums
npm run test:e2e:card-motion
```

實際執行以每個 Phase 改動範圍為準；未涉及 gesture 前唔因詞庫表單改動重跑不相干高成本 matrix，但 question／study action cutover
必須跑相應 V2 DB及browser regression。

## 14. 風險及緩解

| 風險 | 緩解 |
|---|---|
| 多義詞變成多個正解 | 一 sense一題、同詞 sibling-answer exclusion、final-option collision check、review gate、invalid fail closed |
| 團隊填表太複雜 | system fields留空、工作包、controlled enums、template、preview report、一般老師只提交 |
| 兩人製作同一詞 | lemma grouping、exact-sense fingerprint、無last-write-wins、explicit merge disposition |
| 干擾項語義錯誤 | 5–6 項全由人手選定、完整 answer-set collision、兩方向獨立、同儕＋老師審核、random preview |
| 停用破壞學生資料 | soft RETIRED、snapshot+lease boundary、緊急撤回中性取消、history／snapshot保留、無hard delete |
| 新詞令進度突然下降 | active denominator＋catalog revision、UI content-update提示、teacher analytics解釋 |
| 由word轉sense破壞可靠性 | 新 sense tables、legacy Word read-only、人工一對一 mapping先承接 mastery、expand-first、construction version、DB／V2 regression |
| CSV／草稿覆蓋已批准內容 | immutable revisions、approved pointer、stable keys、base revision／digest CAS、stale conflict、preview先行 |
| 舊Markdown資料被靜默丟失 | converter保留每個source line、唔lowest-level-wins、零silent-loss reconciliation |
| 外部來源版權／私隱 | 只有引用／改編外部材料時先要求可追溯 source reference；禁止未授權抄錄，CSV contributor code選填且無學生個資 |

## 15. 發佈及 rollback

- 先完成純 validator／converter，未改 runtime；
- schema採expand-first，legacy `Word` 喺觀察窗口只讀保留；舊 seed／update／hard-delete 先停用，new catalog由feature flag選用；
- 啟用前檢查 ACTIVE sense coverage、invalid question rate、scheduler no-candidate及metrics denominator diff；
- rollback只關閉new catalog reads／issuance並返回識別 lifecycle gate 嘅 compatibility reader，唔刪新tables、change requests或歷史events；
- 已由new construction version簽發嘅snapshot仍按snapshot完成，唔轉回舊builder重建；
- destructive drop、rename、legacy column removal另開contract migration，無明確production批准不執行；
- 正式deploy要有backup、migration status、post-deploy audit、alert thresholds及觀察窗口。

## 16. 決策紀錄

| ID | 決策 | 狀態 |
|---|---|---|
| WC-001 | 每行／每個Review target代表一個sense；同lemma可跨level有新義 | 待使用者確認 |
| WC-002 | catalog key、sense key、revision由系統產生，老師／團隊不手填 | 待使用者確認 |
| WC-003 | canonical中文使用繁體香港用語，簡體由系統生成 | 待使用者確認 |
| WC-004 | 每個enabled direction有 5–6 個人工候選干擾項，runtime只抽三個，無global fallback | 待使用者確認 |
| WC-005 | Objective Probe 唔使用 prompt；英譯中顯示 `term`，中譯英顯示 `definition_zh`，兩方向仍有獨立 enable flag及candidate pool | 使用者已確認（2026-08-18） |
| WC-006 | 多義詞以獨立 sense 處理；同詞其他 sense 正解禁止成為干擾項，final options 唯一，否則方向停用／fail closed | 使用者已確認（2026-08-18） |
| WC-007 | 保持三角色；teacher account-level `canManageWordCatalog`控制審核／停用 | 待使用者確認 |
| WC-008 | DRAFT／ACTIVE／RETIRED；停用soft-only，缺行永不代表停用 | 待使用者確認 |
| WC-009 | CSV係受控交換格式，PostgreSQL係runtime canonical source | 待使用者確認 |
| WC-010 | 現有Markdown完整轉DRAFT及conflict report，唔沿用lowest-level-wins | 待使用者確認 |
| WC-011 | mastery／unit以sense計；UI分開詞目數與已掌握詞義 | 待使用者確認 |
| WC-012 | 中文 canonical 顯示答案同 structured accepted answers 分開；兩方向建立 versioned normalized answer set | 待使用者確認 |
| WC-013 | ACTIVE 內容採 immutable `WordSenseRevision` + approved pointer；proposal 唔原地覆寫 | 待使用者確認 |
| WC-014 | 新 sense tables同legacy Word物理隔離；只有人工一對一 mapping承接舊 mastery | 待使用者確認 |
| WC-015 | 一般停用以 snapshot+lease 作 issuance 邊界；嚴重內容另設緊急撤回中性取消 | 待使用者確認 |
| WC-016 | 新／material change禁止自批；import operation ID綁 request digest並喺commit重查 | 待使用者確認 |
| WC-017 | activate／retire／reactivate使用全域單調遞增 catalog revision，統計保存 as-of revision | 待使用者確認 |

## 17. Definition of Done

- [ ] v1 standard及所有WC decisions獲明確批准；
- [ ] sample CSV、fixtures、validator及current Markdown dry-run report完成；
- [ ] schema／migrations／Prisma Client／fresh replay驗證完成；
- [ ] direct curated distractor construction及immutable provenance完成；
- [ ] teacher submit／capability review／retire／reactivate完成；
- [ ] CSV preview／conflict／idempotent commit完成；
- [ ] student learning、unit、stats、leaderboard、teacher analytics完成sense-level cutover；
- [ ] current Markdown零silent-loss轉換及人工 unresolved report完成；
- [ ] 測試矩陣按scope通過並記錄實際結果；
- [ ] rollout／rollback/runbook完成；production gate未授權項保持未勾選。

## 18. 實際驗證紀錄

### 2026-08-18：Phase 0 文件及 baseline 盤點

- 由 `codex/class-roster-import-and-access-control` @ `e04639d` 建立本專用 branch；
- 完整閱讀 current product baseline、project plan、Retrieval-first contract及plans workflow；
- 核對現有 Prisma Word／Review／ReviewEvent、Markdown seed、Objective question builder、admin word APIs及teacher capability pattern；
- 建立 `word-catalog-v1` 團隊標準草案；
- 曾建立配套 XLSX prototype；其後按使用者決定改以 CSV 作主要團隊交換格式，A1 參考檔已產生；39 欄保留相容性，其中
  `prompt_en`／`prompt_zh` 係必須留空嘅 reserved columns，唔屬學生要編寫內容；
- 兩個獨立 sub-agent 已完成技術及教學／操作審查；原草案識別嘅 ACTIVE proposal 隔離、legacy rollback、mastery mapping、issuance race、import TOCTOU、answer collision、自批及填表負擔問題已納入本計劃；
- 2026-08-18 再按使用者決定取消 Objective Probe prompt：英譯中只顯示 `term`，中譯英只顯示 `definition_zh`；同一英文其他
  sense 嘅中文正解不得成為干擾項。A1 參考 CSV 已清空 prompt、source、contributor及change-note值，355行／39欄結構驗證通過；
- 2026-08-18 以同一 contract 產生 A2 參考 CSV：由原 Markdown 1,581 個 A2 項目整理成 1,447 個 DRAFT 詞義；移除畸形、重複、
  已收錄於 A1、無語境不可可靠測試及明顯偏高階項目。兩個獨立 sub-agent 完成教學內容及資料／干擾池審核，並已跟進近義答案
  碰撞、詞性、英式／香港用語、錯 sense 例句及 phrasal verb 例句問題。最終檔 39 欄、prompt／來源／貢獻者／change-note 留空、
  每方向六個候選項、A1 exact overlap 為 0、44 個 phrasal verbs 全部有雙語例句，結構及 collision validator 通過；
- 2026-08-18 按候選池重用報告重整 A1 參考 CSV 嘅兩方向干擾池；保留 355 行及所有非干擾項欄位，將不計次序完整重複池由
  英譯中 4 組／中譯英 1 組降至 0，同 category 共享至少五項候選嘅 pair 由 131／121 降至 0，最大重疊降至 4／6；候選仍受
  answer set、synonym、同詞 sibling sense、語言及詞性大類檢查。規範同步加入 unordered signature 及同 category overlap gate；
- 2026-08-18 按 A1／A2 干擾項審核再修訂兩份參考 CSV：重建候選池時對同 category 的 5／6 項重疊採 blocking gate，並修正
  A2 `ski` 的 sibling-sense 中文答案碰撞；另人工修正 A1 `passport`／`Earth`／`far`／determiner、A2 `screen`／`well`／
  `suggestion` 等明顯近義或類型提示。A2 `twin bed`／`single bed` 因同一裸中文題幹「單人床」可對應兩個英文答案，另
  `traveller` 因「旅客」可對應多個常用英文，暫停三行中譯英方向並清空其候選池。當前檢查已確認兩份檔案均為 39 欄、單一 UTF-8 BOM、
  無同分類 5／6 重疊、無完整不計次序重複池、
  無目前／sibling 正解碰撞；三個獨立 sub-agent 已完成 A1、A2 及跨檔案審核，發現的 exact pool／5-6 overlap 及近義項
  問題已跟進，並由本地 final validator 再次確認上述 blocking checks 通過。
- 2026-08-18 按同一標準由現存 `word list.md` 產生 B1／B2 DRAFT 參考 CSV：原始 B1／B2 行先移除缺少可靠中文釋義的畸形項，並以 A1／A2 優先保留完全相同詞義；共移除 122 個已在較低程度出現的 exact sense，最後 B1 1,743 行、B2 2,096 行。修正可確認的來源錯譯／詞性及香港用語，包括 `die for`、`lift weights`、`iced tea`、`Mardi Gras`、`DNA`、`Skype`、`major`、`modeling`、`image`、`counter`、`paramedic`、`tomato paste`、`presentation`、`opening`、`wind machine`、`contract`、`database`、`mouse pad`、`landfill` 等。
- 2026-08-18 B1／B2 干擾池按全域 answer-set、同詞跨 sense、形態相關詞、語言、詞性大類、完整 pool signature 及同 category 重用 gate 重建；三個獨立 sub-agent 已完成 B1、B2 及跨檔案審核，發現的答案碰撞、詞性／釋義及機械重用問題已跟進。最終 B1 英譯中 1,576 啟用／167 停用、中譯英 1,312 啟用／431 停用；B2 英譯中 1,936 啟用／160 停用、中譯英 1,638 啟用／458 停用。兩份均為 39 欄、單一 UTF-8 BOM、每個啟用方向六項候選；跨 A1–B2 無 exact sense duplicate，B1／B2 無 direct／sibling answer collision、無完整 pool duplicate，同分類最大候選重疊為 3 項。
- B1／B2 參考檔所有行保持 `CREATE_DRAFT`，`prompt_en`／`prompt_zh`、來源、貢獻者及 change note 均留空；舊 Markdown 未提供的 IPA／例句沒有虛構填寫，故仍須英文老師逐行覆核詞義、詞性、干擾項、例句及音標後，先可進入 ACTIVE。上述中譯英停用方向係有意 fail closed，不能當成內容已完成啟用。
- 2026-08-19 由官方 [ECDICT](https://github.com/skywind3000/ECDICT) `ecdict.csv`（770,611 行；其中 218,065 行有 `phonetic`）補入四份參考 CSV 的 `phonetic_ipa`；只修改音標欄，其他 38 欄均與合併前一致。以 normalized `term` 作精確對應，A1 加入 345／355、A2 1,375／1,447、B1 1,620／1,743、B2 1,859／2,096；沒有 ECDICT 可用音標的行保持空白，沒有以相似詞猜配。ECDICT 只有單一 `phonetic` 欄，沒有美式／英式標記，故本次只能採用其唯一可用值，不能聲稱已完成可靠的美式優先選擇；正式 ACTIVE 前仍需英文老師覆核音標格式及讀音。
- 2026-08-19 再以 [Cambridge English Dictionary](https://dictionary.cambridge.org/us/dictionary/english/date-of-birth)（美式優先、英式後備）及 [Oxford Learner’s Dictionaries](https://www.oxfordlearnersdictionaries.com/definition/english/friend)（只接受頁面詞頭完全匹配）補回 ECDICT 未提供的音標；只修改 `phonetic_ipa`，CSV 的來源欄仍保持空白。今次新增 Cambridge US 283、Cambridge UK 2、Oxford US 21，共 306 條；四份表的音標覆蓋率由 A1 345/355、A2 1,375/1,447、B1 1,620/1,743、B2 1,859/2,096 提升至 A1 352/355、A2 1,416/1,447、B1 1,719/1,743、B2 2,018/2,096。其餘 136 條因官方頁面沒有可可靠取得的完整詞組音標而保留空白，沒有按拼字估音；正式 ACTIVE 前仍需英文老師覆核音標格式及讀音。
- 尚未修改 Prisma schema、migration、runtime code、database或production；尚未執行功能測試。
