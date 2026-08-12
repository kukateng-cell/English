# Study Credential v2 安全及資料遷移計劃

> 類型：認證／資料模型／expand-contract Migration Plan
> 狀態：進行中
> 父文件：[retrieval-first-learning-program.md](./retrieval-first-learning-program.md)
> 產品規範：[retrieval-first-learning-contract.md](./retrieval-first-learning-contract.md)
> 消費者：[learning-stream-v2-implementation.md](./learning-stream-v2-implementation.md)

## 一、背景及問題

現有 study flow 已用 server-issued session、nonce、`operationId`、Serializable transaction、
retry、checkpoint 及 outbox 防止偽造同重複提交，呢啲安全屬性必須保留。

現有 outbox 已經以 `operationId` 分隔提交，並有測試證明同一詞可以保存多次獨立 review；
呢項能力應直接保留，唔需要重新發明。不過 v1 outbox payload 仍由 client 帶 `wordId` 同
`quality`，credential renewal／lookup 亦以 session + word provenance 為主，而資料模型有
`[sessionId, wordId]` 唯一性假設。Learning Stream v2 允許同一詞喺同一較長 session
出現為 Learning Card、Evidence Obligation Probe 或 Remediation；如果授權仍只靠 word
identity，就無法安全分辨邊個 item、邊種 action、邊個 policy decision 可以被提交。

因此 v2 將授權主體改成 server-issued session item，並以 expand → dual-flow → cutover →
另行 contract review 遷移，唔以一次 schema 變更同時打破舊 binary rollback。

## 二、目標

- client-facing item identity 統一為 opaque `streamItemId`（亦係 V2 table identity），唔接受
  `sessionItemId` alias；每次 action 綁定 action kind 同 session lineage；
- client 唔可以自行指定 word、verification task、correct answer、quality 或 score；
- 同一 item 第一次合法 commit 恰好一次；同一 `operationId` retry 回同一結果；
- v1／v2 session 以 `flowVersion` pinning 共存，route 唔接受混合 payload；
- session rotation、credential renewal、outbox replay、cross-device conflict 都可對賬；
- 所有 schema 先 expand，rollback 只關 assignment／保留資料；
- 放寬 `[sessionId, wordId]` 前，先證明所有 runtime lookup 已轉到 item identity。

## 三、非目標

- 唔修改 Auth.js 主體、role model 或 `tokenVersion` 撤銷語義；
- 唔由 client 產生可信 nonce、session item 或 verification task；
- 唔用 `prisma db push`；
- 唔修改已套用 migration；
- 未獲使用者明確授權、環境確認及 release gate 前唔執行 `npm run db:contract`；
- 唔喺 expand migration 刪欄、加不可回滾 constraint 或移除 v1 unique key。

## 四、安全不變條件

1. **Authorization**：每條 route 用現有 server authorization helpers，唔只靠 layout／UI。
2. **Scoped capability**：credential 綁 learner、StudySession、StudyStreamItem、action kind、expiry、
   flow version 及 server revision。
3. **One-time semantics**：nonce／item consumption 喺同一 Serializable transaction 完成。
4. **Idempotency**：`(userId, operationId)` 喺 V1／V2／所有 action kind 共用 global namespace；
   same key + different flow、item、kind 或 canonical payload 拒絕。
5. **Server authority**：word、item kind、option snapshot、correctness、quality、obligation transition
   全部由 server record 推導。
6. **Revocation**：帳戶、role、password／tokenVersion、session retirement 後舊 capability 無效。
7. **No secret leakage**：log／error／checkpoint 唔保存 raw token、credential、nonce 或答案。
8. **Safe concurrency**：兩裝置競答只有一個 winner，其餘收到 authoritative outcome。

## 五、V2 action contract

Client 提交概念上只包括：

```text
flowVersion
studySessionId (opaque)
streamItemId (opaque；唯一 client-facing item ID)
operationId
itemCredential (opaque random bearer nonce；server 只保存 digest)
actionKind
action payload：例如 selfRating 或 selectedOptionId
clientKnownRevision
```

Server 必須由 `streamItemId`／credential 查出 learner、word、item kind、question snapshot、
verification task、policy version 及 allowed transition。Payload 若加入 word ID、quality、
`correctOptionId`、task owner 或 arbitrary timestamp，route 必須忽略或拒絕，唔可採信。
Route 唔接受 `sessionItemId`／其他 item alias；credential 同 stream item 唔匹配一律拒絕。

每個 action canonicalize 後建立 idempotency fingerprint；同一 `operationId` 只可配同一
session item、action kind 及 payload。Response 保存／重建足夠資料，令 retry 唔再執行副作用。

## 六、目標資料模型（概念）

Exact Prisma 名稱喺實作 review 決定；以下係責任而唔係可直接貼入 schema 嘅 migration：

### StudySession expand

- `flowVersion`：建立時 pin，default 保持 legacy；
- `learningPolicyVersion`：v2 policy snapshot；
- `revision`／`retiredAt`／rotation lineage reference；
- mode／unit scope 由 server 保存，唔信 client 切換。

### Review state expand

- 加入 monotonic `revision`（或等價 CAS token），每次 operational scored update 同 SM-2
  transaction 原子遞增；
- Objective Evidence Target 保存 expected revision；stale target 唔可再推進 Review；
- research-only purpose 可以保存 candidate-state revision 作分析，但唔 CAS／修改 Review。

### Legacy StudySessionItem（V1 原表）

- expand／pilot 階段保留現有欄位、nonce、lineage 同 `[sessionId, wordId]` unique；
- V1 route 繼續只讀寫呢張表，避免新資料改變舊 binary 嘅 uniqueness 假設；
- 唔用 nullable tricks 或特殊 word ID 將 V2 item 塞入呢張表。

### StudyStreamItem（V2 新表，名稱待 schema review）

- opaque primary identity及 `streamItemKey`（session 內唯一）；
- `itemKind`、word reference、selection reason、policy version、status、lease／expiry；
- objective evidence target reference（nullable）、immutable server-owned question snapshot reference；
- one-time credential digest／expiry、rotation lineage、accepted operation／outcome reference；
- 容許同一 StudySession + word 有多個 item，但每個 item identity／credential 獨立；
- V2 route 只讀寫呢張表，唔依賴 legacy composite unique。

### EvidenceObligation

- learner + word + source encounter；
- `pending／leased／answered／expired／cancelled`；
- eligible time、max age、lease owner／expiry、policy version；
- objective evidence target reference；obligation 本身唔直接等同 scored result。

### ObjectiveEvidenceTarget／ProbeAttempt

- 每個 Objective Probe 都必須有 target，包括無 Evidence Obligation 嘅 direct due probe；
- learner、word、purpose、expected Review revision（research-only 可 nullable）、policy version、question snapshot；
- 同一 learner + word + expected Review revision + purpose 只有一個 active target；
- `open／leased／consumed／superseded／cancelled` lifecycle、winning operation／ReviewEvent；
- submit transaction 以 target consumption 同 Review revision compare-and-set，保證兩個 session
  各自持不同 stream item／operationId 都只可以推進一次。

### ObjectiveQuestionSnapshot

- probe 發出前固定 prompt、word／meaning snapshot、option IDs／order、correct option、內容版本；
- scoring 永遠讀 snapshot，唔讀提交當刻最新 Word；client 只收可顯示內容及 opaque option IDs；
- operational foreign key 可 `SetNull`，詞庫刪除後 snapshot／audit 按 retention 保留；一般內容
  修改唔影響已 lease 題目；安全／法律撤回可由 server 明確 cancel target；
- snapshot retention 至少覆蓋 credential、outbox retry、ReviewEvent audit 同 dispute window，
  exact period 喺 production data-retention review 決定。

### OperationReceipt／result

- `(userId, operationId)` global unique，覆蓋 V1 Review、V2 Learning／Probe 等 typed action；
- canonical request fingerprint、authoritative response／outcome reference；
- 新 V2 開啟前 backfill 現有 ReviewEvent operation IDs，receipt-aware V1／V2 code 必須已部署；
- 通過身份驗證後，committed receipt replay 喺 live credential expiry／retirement 同 mutation rate
  limit 前返回 stable result；未 commit action先進行完整 credential／revision validation；
- unique constraint 保證 retry 同 concurrent commit 只執行一次；ReviewEvent 原有 unique 保留。

### ReviewEvent provenance expand

- 新增 `evidenceKind`、`flowVersion`、`qualityPolicyVersion`、`probePurpose`、
  `itemConstructionVersion`、evidence target／question snapshot reference（exact nullability待 schema review）；
- 所有 V2 objective rows 必須完整填寫，database／service invariant 拒絕 provenance 不完整嘅 V2 row；
- 無可執行證據證明來源嘅既有 `REVIEW` rows backfill 為 `LEGACY_UNKNOWN`；保留原 SM-2／
  mastery history，但 metric projection／research export 唔將佢計入 V2 objective recognition；
- dual-flow 期間 legacy mastery continuity 同 V2 objective projection 分開，唔覆寫歷史 quality。

Operational event 同 consent-gated ResearchEncounter 分開；前者唔因研究 opt-out 而停止。

## 七、遷移策略

### Stage A：Inventory 及 expand design

- [x] 全面搜尋 `[sessionId, wordId]`、word-keyed nonce、checkpoint、outbox、API lookup；見
  `plans/artifacts/study-credential-v2-compatibility-inventory.md`；
- [x] 盤點 ReviewEvent 所有產生路徑，定義可證明 provenance 同 `LEGACY_UNKNOWN` backfill；
- [x] 建立 v1/v2 data-flow diagram 同 compatibility matrix；見 compatibility inventory；
- [x] 以本地 production-shaped data profile 檢查同一詞多 item 對 index／query 嘅影響；正式
  production profile 仍屬 deployment gate；
- [x] 寫 expand migration、backfill／validation script、rollback-of-code 說明；
- [x] 新欄位 nullable 或 safe default；receipt-aware V1 rollback binary 可繼續讀寫，pre-expand
  binary 不列為 expand 後 rollback target。
- [x] Credential rotation lineage expand 欄位以 bounded digest grants 表達多裝置短期並行；
  舊 binary 可忽略 nullable 欄位，但只使用 receipt-aware V1 build 作 code rollback。

### Stage B：Deploy expand；v1 仍為 default

- [x] Prisma Client 重新生成，lint／typecheck／unit 通過；
- [x] fresh database replay、existing database upgrade、migration checksum 通過；
- [x] legacy seed、login、study、checkpoint、review ledger regression 通過；
- [x] expand backfill 以 idempotent set-based migration 完成；checksum／row-limit preflight、
  migration exit status、post-deploy lineage／inventory validation 提供 failure evidence。
  目前資料量未達 staged-batch gate；如 production 超過 row limit，必須另行批准分批方案；
- [x] backfill／驗證 global OperationReceipt；所有 active runtime 已用 receipt-aware V1 code；
- [x] validation 比對 row counts、nullability、orphan、duplicate candidate；
- [x] metric projection regression 證明 legacy continuity 保留、V2 objective denominator 排除 unknown；
- [x] production default remains V1；V2 只接受 `STUDY_V2_INTERNAL_USER_IDS` internal/test
  allowlist，未建立學生 cohort 或 research assignment；

### Stage C：Dual-flow application

- [x] session 建立時 server pin `flowVersion`，session 中途唔自動切換；
- [x] v1 request 只經 legacy validator；v2 request 只經 item validator；
- [x] v1 只寫 legacy `StudySessionItem`；v2 只寫新 `StudyStreamItem`，兩者唔共享
  item-identity constraint；
- [x] v2 outbox／checkpoint 按 item identity，v1 data 保持原 decoder；
- [x] 每個 Objective Probe 建立／引用唯一 evidence target 同 immutable question snapshot；
- [x] dashboards／jobs／admin tools 兼容新 item kind，未知 kind fail visible；
- [x] internal accounts 完成 soak，production 默認仍 v1。

### Stage D：證明 V2 獨立性及準備 V1 retirement

- [x] 搜尋及 code review 證明所有 V2 runtime 都唔用 legacy composite unique 作 item identity；
- [x] query／job／cleanup／analytics 明確 dispatch V1／V2，或按 stream item／explicit word aggregation；
- [x] 同一 session 同一詞多 item integration tests 通過；
- [x] old binary rollback matrix 已記錄：`plans/artifacts/study-credential-v2-compatibility-inventory.md`
  指定 receipt-aware V1-default build 為唯一 code rollback target；
- [ ] 觀察期內 v1 同 v2 都可以正常完成／退休 session。

### Stage E：Legacy cleanup／contract migration（另行批准）

- [ ] 另建／更新 contract migration 文件及 exact SQL review；
- [ ] 明確決定保留兩表歷史、合併資料，或刪除 legacy table／unique；列出 exact dependency proof；
- [ ] production snapshot／backup、maintenance／compatibility window、confirmation 準備好；
- [ ] contract regression、fresh replay、checksum、old-version incompatibility gate 通過；
- [ ] 只有使用者明確授權先執行 `npm run db:contract`；
- [ ] 執行後保存 audit evidence，唔宣稱可用 schema downgrade rollback。

Stage E 唔係 Product v2 初次 pilot 必需。V2 新表已安全表達 multiple items，legacy table
同 unique 可以保留至所有 V1 session、jobs 同 rollback window 完全退役，降低 rollback 風險。

## 八、Session rotation、renewal 及 lineage

- rotation 建立 server-recorded parent／successor lineage；只可 reissue 未 consumed item。
- renewal 要重新驗 auth、tokenVersion、session status、item status、revision、expiry。
- old credential 被 successor 取代後，重送只可查 authoritative status，唔可再次 consume。
- outbox entry 保存 item identity、operationId、action intent 及最少版本資料；唔保存答案 key。
- 如果 session retired 但 operation 已 commit，server 回原結果；未 commit action 要明確標示
  `reissueable`、`superseded` 或 `terminal`，client 唔盲目改綁新 session。
- cross-tab 使用 server revision／broadcast 只作刷新提示；local last-write-wins 唔具權威。

### 8.1 V1 → V2 outbox contract 對照

| 現有可靠性屬性 | V2 規定 |
|---|---|
| user-scoped storage | key、row owner 同讀寫全部按 authenticated user 隔離 |
| operationId exactly-once | 保留 global `(userId, operationId)`；先 durable intent，再動畫／POST |
| credential provenance | row 保存 `streamItemId`／source session；opaque credential可保存，或 crash 後只按 lineage attach／renew |
| storage unavailable | durable write 失敗就唔提交後靜默前進；顯示 `SYNC_BLOCKED` |
| response-loss replay | server 已 commit、local remove 失敗時以同一 ID 重送並收 stable result |
| cross-tab mutation lease | 保留 lease／server revision；另一 tab 唔自行 last-write-wins |
| blocked row retained | `blocked／superseded／terminal` 均 fail visible，唔靜默刪除 |
| account switch | 舊 owner row 唔由新帳戶提交、attach 或 purge |
| unknown／corrupt version | quarantine／fail visible，絕不降級成 word-keyed V1 action |

Credential 如落 localStorage，只可係短效 opaque capability，唔包含 server secret／correct answer；
如選擇 crash 後重新 attach，server 必須由 stream item lineage 同 operation state 決定，兩種策略
喺實作前由 Decision M-003 固定並以 threat model review。

## 九、Checkpoint 兼容

| Checkpoint | Decoder | 恢復規則 |
|---|---|---|
| v1 | legacy schema | 只恢復 v1 session，唔升級 payload |
| v2 | versioned opaque item pointer | 向 server 查 item／operation authoritative state |
| unknown／corrupt | fail closed | 清除本地 presentation state，server 安全 bootstrap |
| expired credential | lineage renew | 唔由 word ID 自行建立提交能力 |
| answered item | authoritative advance | 唔再呈現可答 UI |

Checkpoint migration 唔需要將 v1 localStorage 批次改寫成 v2；新 session 用新版本，舊資料由
兼容 decoder 收斂／過期。

## 十、測試矩陣

| 類別 | 必須覆蓋 |
|---|---|
| Credential | wrong learner／session／item／kind、expired、retired、tampered、replayed |
| Idempotency | same key same payload、same key different payload、兩 keys 同一 item、network timeout |
| Scoring | opaque options、immutable snapshot、server correct answer、first response、zero duplicate ReviewEvent |
| Transaction | 兩 session 同一 due revision／不同 operation IDs、serialization retry、lease expiry、rotation |
| Checkpoint/outbox | v1/v2、corrupt、storage unavailable、rebind、authoritative supersession |
| Migration | fresh replay、upgrade、checksum、backfill rerun、orphan／duplicate validation |
| Legacy／projection | login、study、SM-2、dashboard、seed、jobs；legacy unknown 排除 V2 accuracy／research export |
| Contract | multiple same-word items、old-binary matrix、explicit confirmation guard |
| Content lifecycle | lease 後改／刪 Word、option reorder、延遲 outbox、snapshot retention／target cancellation |

按實際改動至少執行：

```bash
npx prisma migrate status
npx prisma generate
npm test
npm run lint
npx tsc --noEmit
npm run test:db
npm run test:migrations
npm run test:migrations:contract
npm run test:migration-checksums
npm run check:production-config
npm run build
```

本地 PostgreSQL 如 sandbox 連線失敗，按 repo 指示用 escalated 權限重試先判定 unavailable。
手動 `psql` 不直接使用帶 `?schema=public` 嘅 URL。

## 十一、發佈、觀察及 rollback

### 發佈

1. deploy expand migration；
2. deploy receipt-aware dual-flow code，v2 assignment 關閉；呢個版本先成為 pilot 後 rollback target；
3. internal v2，監察 credential reject、duplicate、lease、outbox age；
4. small cohort，再按 Learning Stream rollout 擴大；
5. 長觀察期後另行批准 contract cleanup。

### Rollback

- 關閉新 v2 assignment；pilot 開始後只 rollback 到 receipt-aware V1-default build，唔回到
  完全唔識 OperationReceipt／V2 session 嘅 pre-expand binary；
- 保留 expand tables／columns／indexes，唔 downgrade schema；
- 已 commit outcome 保留並可查；
- 已發 v2 session 依 incident runbook 完成、retire 或 revoke；
- 未證明可轉換嘅 v2 outbox action唔轉成 v1 word action；
- rollback build 必須列喺 compatibility matrix 並預先驗證。

## 十二、風險

| 風險 | 緩解 |
|---|---|
| 放寬 unique 太早，舊 code 查錯 item | Stage D dependency proof；Stage E 獨立批准 |
| dual writes 形成半新半舊資料 | single transaction、validation job、explicit flow dispatch |
| retry 喺 rotation 後重複 | lineage + stable operation result + consumed guard |
| client 借 selected option 改指定 word | credential 綁 item；server option snapshot／scoring |
| contract migration 無法 binary rollback | 延後 cleanup、compatibility window、feature rollback only |
| 研究 schema 污染 operational auth path | separate adapter／tables；research failure non-blocking |

## 十三、決策及未決事項

| ID | 決策／問題 | 目前取向 | 收斂 gate |
|---|---|---|---|
| M-001 | multiple occurrence model | Expand 新增 `StudyStreamItem`；V1 原表／unique 不動 | 已納入計劃，schema review 確認 |
| M-002 | operation namespace | global `(userId, operationId)` receipt，V1／V2 共用 | Stage A threat／migration review |
| M-003 | outbox credential attachment | V2 outbox durable 保存短效 opaque item credential；server 只保存 digest，crash 後以同一 credential／operationId retry；唔保存答案 key | Phase 0 handoff；Phase 1 threat model 驗證 |
| M-004 | probe snapshot lifecycle | immutable snapshot 判分；一般詞庫改／刪不改已發題，安全撤回可 cancel | Stage A retention review |
| M-005 | legacy ReviewEvent provenance | 無法證明者標 `LEGACY_UNKNOWN`，保留 continuity、排除 V2 accuracy | Stage A data audit |
| M-006 | legacy table cleanup | 唔阻塞 pilot；所有 V1 flow／rollback window 退役後另行 contract approval | Stage E |
| M-007 | snapshot exact retention／delete behavior | 至少覆蓋 retry、audit、dispute；exact 日數、SetNull／cancel cleanup 仍屬 production data-retention review，product release 不執行 destructive cleanup | production data-retention review |

M-003、M-004、M-007 未收斂前唔實作相應 storage／foreign key；任何 cleanup 都唔因本文
狀態改變而取得 `db:contract` 執行授權。

## 十四、Definition of Done

### Product-release scope

- [ ] Stage A–D 完成並有驗證證據；
- [x] v1/v2 compatibility matrix、rotation、outbox、checkpoint tests 通過；
- [x] multiple same-word items 唔受 legacy unique assumption 影響；
- [x] global OperationReceipt、evidence target／Review revision CAS、immutable snapshot 競態測試通過；
- [x] V2 provenance 完整、legacy unknown projection／research exclusion 已驗證；
- [x] client 無法指定 word、kind、correctness、quality 或第二次 scored result；
- [x] expand rollback rehearsal 通過；v1 flow 無 regression；
- [x] 實際 migration commands、結果、未執行項目、限制已記錄於本文及
  `plans/artifacts/study-credential-v2-compatibility-inventory.md`。

### Contract-cleanup scope

- [ ] Stage E 獲獨立批准並完成；
- [ ] contract migration audit evidence、backup／recovery 同 post-deploy validation 已保存；
- [ ] 只有兩個 scope 都完成，本文先可標記「已完成」；否則註明 product-release complete、
  contract cleanup deferred。

## 十五、實際驗證紀錄

### 2026-08-12：Product-release expand／dual-flow／reliability evidence

- 已完成並驗證 `20260812000000_add_retrieval_stream_v2`、
  `20260812010000_add_retrieval_encounter_feedback`、
  `20260812020000_add_retrieval_reveal_state`、`20260812030000_link_stream_work` 及
  `20260812040000_add_stream_credential_lineage` expand migrations；Prisma validate／generate、fresh
  replay、existing upgrade、checksum 及 production migration preflight 通過。
- V1 `/api/study` 以 global `OperationReceipt` bridge 保留 idempotency；review ledger
  regression、V1 browser workflow 及 V2 integration 均通過。V2 assignment 由
  `STUDY_V2_INTERNAL_USER_IDS` deny-by-default allowlist 控制，未建立學生 cohort 或研究
  assignment，production 預設仍為 V1。
- V2 action validator、stream-item credential digest、session pinning、immutable
  objective snapshot、evidence target、Review revision CAS、server scoring、outbox／
  checkpoint、lease completion 及 concurrent admission cap 已有 code review／unit／DB
  evidence。
- `npm run test:migrations`、`npm run test:migration-checksums`、`npm run test:migrations:contract`、
  `npx prisma migrate status` 均通過；contract regression 只在 temporary schema 做
  expand／contract regression，未執行 `npm run db:contract`，亦未進行 production snapshot、
  正式部署或 schema cleanup。
- `npm run test:db:stream-v2` 新增同詞多 item、bounded credential lineage、expired／retired
  session、tokenVersion revocation callback、metrics／leaderboard provenance 及 unit summary
  assertions；V1 `npm run test:db` 及 feature-off browser smoke 通過。
- `npm run check:study-credential-v2` 通過：final post-E2E local profile 顯示 51,787 個 V1
  `StudySessionItem`、8 個 V2 `StudyStreamItem`、1 組同詞多 item、735 個 global receipts（V1
  724、V2 11）、0 receipt gap、0 V2 provenance gap；V1 composite identity index 同 V2
  stream-item index 均存在。測試流程會增加本地測試資料，數字不代表 production snapshot。
- `node scripts/check-study-lineage-compatibility.mjs` 通過：0 lineage gap；
  `npm run check:study-stream-v2:soak` 3/3 通過，p50 917 ms、p95 1,059 ms。

Stage D 長 observation window、production database profile／backup、正式 deployment、學生
pilot 及 Stage E contract cleanup 尚未完成；因此本文保持「進行中」。Expand migration 並無
獨立 application batch writer，因為現行 set-based backfill 已由 migration preflight、checksum、
failure exit status 及 post-deploy inventory gate 保護；production 超過 row limit 時仍須另行
批准 staged rollout。
