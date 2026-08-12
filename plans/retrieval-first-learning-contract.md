# Retrieval-first Learning Contract v1

> 類型：RFC／Normative Product & Learning Contract
> 狀態：進行中
> 父文件：[retrieval-first-learning-program.md](./retrieval-first-learning-program.md)
> 實作計劃：[learning-stream-v2-implementation.md](./learning-stream-v2-implementation.md)
> 生效方式：獲批准後由 `learningPolicyVersion = retrieval-v1` 明確選用

## 一、目的及優先次序

本文件固定 Learning Stream v2 嘅產品心理模型、學習證據語義及排程不變條件，
避免畫面、API、SM-2、統計及研究各自使用唔同定義。實作細節可以演進，但唔可以
靜默改變本文件嘅 gesture、證據或 metric 語義。

出現衝突時，優先次序如下：

1. authentication、authorization、one-time credential、idempotency、server scoring、
   migration safety 等 production safety contract；
2. 本文件已批准嘅 learning／interaction contract；
3. versioned design handoff 嘅 presentation 及 motion reference；
4. prototype 中為展示而寫死嘅題數、進度或 quick-check 節奏。

## 二、術語及計量單位

| 術語 | 規範定義 | 唔代表 |
|---|---|---|
| Learning Encounter | 學生嘗試回想、揭示答案並作 self-rating 嘅一次互動 | 客觀答啱、完成 Review |
| Learning Card | 承載 Learning Encounter 嘅 UI item | Objective Probe |
| Objective Probe | 由 server 發出、以第一次選擇判分嘅客觀認讀題 | 自由回憶測驗 |
| Objective Evidence Target | 每一個可 scored probe 都綁定嘅 server-owned 單一證據目標／review revision | 單一 client 卡片或 session |
| Objective recognition | 從選項中辨認正確詞義嘅表現 | observable free recall |
| Self-rating | 「想起了／未想起」嘅主觀報告 | mastery、accuracy 或 SM-2 quality |
| Evidence Obligation | policy 要求日後以 Objective Probe 驗證某次學習嘅未結工作 | 每次 Encounter 必然產生嘅題目 |
| Verification debt | 目前未完成、未過期或未取消嘅 Evidence Obligation 集合 | 任意無上限 queue |
| Remediation | Objective Probe 答錯後安排嘅重新學習機會 | 原題即時重答到啱 |
| First response | 同一 Objective Evidence Target 第一個由 server 接受嘅合法 commit | 兩部裝置中人類時間最早嘅 tap |
| V2 Objective ReviewEvent | objective first response 經 server 判分、帶完整 provenance 嘅 scored ledger event | reveal、swipe 或來源不明 legacy row |
| Operational Action | 保障學習續接所需嘅最小 durable action | consent-gated research telemetry |

產品文案、dashboard、教師端及研究匯出要沿用呢套 glossary。未經另一份已批准
contract，不得將 `objective recognition` 簡稱做「回憶成功」。

## 三、核心產品不變條件

### 3.1 Stream

- Global `/study` 無固定完成題數，唔顯示令人誤解嘅 `1/13` 或「仲差幾題完成」。
- 每個已確認 action 之後都係合法停止點；關閉、返回或稍後再開唔視為失敗。
- 可顯示「今次已學／已檢查」等描述性統計，但唔用 goal gradient 迫使完成一輪。
- Unit mode 可以有有限詞集及 summary；仍然容許安全離開，下次按 unit checkpoint 接續。

### 3.2 Gesture 及輸入

| Item／狀態 | Tap／主要按鈕 | 左滑 | 右滑 |
|---|---|---|---|
| Learning Card：未揭示 | 揭示答案 | 無效 | 無效 |
| Learning Card：已揭示 | 無提交副作用 | 提交「未想起」 | 提交「想起了」 |
| Objective Probe | 選擇／提交選項 | 無效 | 無效 |
| Feedback | 前往下一 item | 無效 | 無效 |

- 左滑永遠只有「未想起」；右滑永遠只有「想起了」，不得因 mode 或題型反轉。
- reveal 前 swipe 唔提交亦唔令卡片離場；UI 要給出可理解提示。
- Objective Probe 只用 tap、keyboard 或等價 accessible control，唔借用 swipe 選答案。
- 每個動作只有一次語義；動畫結束唔可以產生第二次網絡提交。

### 3.3 Accessibility 及 motion

- 所有核心操作可用 keyboard 及 screen-reader-labelled controls 完成。
- reduced-motion 仍保留狀態轉換同 feedback，只移除非必要位移／彈性效果。
- touch、mouse、pen 同 synthetic pointer 必須產生相同語義。
- 顏色唔係正誤或方向嘅唯一提示；簡繁文案意思保持一致。

## 四、卡片狀態模型

### 4.1 Learning Card

```text
PROMPT
  └─ reveal ─> REVEALED
                  ├─ left/selfForgot ─> SUBMITTING
                  └─ right/selfRecalled ─> SUBMITTING
SUBMITTING ─> ACKNOWLEDGED ─> NEXT
           └> RETRYABLE_SYNC_BLOCKED
```

規則：

- `PROMPT` 只顯示提取線索，唔洩露答案；
- server acknowledgement 先容許永久離場；optimistic motion 可以先行，但要可復原；
- self-rating 寫 operational encounter，但唔寫 scored ReviewEvent；
- server response 明確回傳有冇建立 Evidence Obligation，client 唔自行猜測。

### 4.2 Objective Probe

```text
PROMPT ── first option ─> SUBMITTING ─> FEEDBACK ─> NEXT
                         └───────────> RETRYABLE_SYNC_BLOCKED
```

規則：

- option order 由 server snapshot；client 只收到 opaque option IDs 及可顯示文字；
- client payload 唔包含 `correctOptionId`，server 由 credential 綁定題目並判分；
- 只有第一次已接受答案寫 scored ReviewEvent；同一 `operationId` 重送只回同一結果；
- 答錯可以睇正確答案及解釋，但唔原地重答到啱並覆蓋第一次結果；
- refresh、重連或另一裝置唔可以令已答 probe 再次可答；
- 已 scored 後嘅 authoritative feedback 係 durable read-only state：學生未確認睇過 feedback
  就離開，下次先恢復一次 feedback；確認後先進下一 item，任何情況都唔重新開放答案。

## 五、排程及證據政策

### 5.1 Item 選擇原則

Server scheduler 每次只承諾下一個或一個細小 prefetch window，按以下優先語義安排：

1. 已 lease 畀目前 session 但未完成嘅 item；
2. 到期或接近最長期限嘅 Evidence Obligation；
3. 已學而到期嘅成熟詞，可建立單一 Objective Evidence Target，再直接成為 Objective Probe；
4. failed probe 需要嘅 remediation Learning Card；
5. 新詞、弱詞或正常 Learning Card；
6. operational diagnostic item（只喺服務品質／公平性目的、現行產品政策合法時）；
7. research-only sentinel（只可喺 server 確認有效 permission、當前 assent、approved
   protocol/version 同 research kill switch 開啟時出現）。

呢個次序係安全優先次序，唔係要求每次都耗盡高層先可顯示低層。scheduler 可以用
spacing、疲勞、內容多樣性及最近曝光作 tie-break，但必須滿足下列 boundedness。
拒絕、撤回或無研究資格嘅學生既唔產生 research events，亦唔會接受純為研究而加入嘅
sentinel exposure；正常 Learning／Review candidate pool 不受影響。

### 5.2 Evidence Obligation admission

- 唔係每個 Learning Encounter 都建立 obligation。
- `requiresVerification` 只由 server `learningPolicyVersion` 決定，client 顯示結果但
  唔控制 admission。
- 已到期成熟詞嘅直接 Objective Probe 本身唔先建立另一條 obligation，但仍然必須綁定
  一個 server-owned Objective Evidence Target；同一 learner + word + review revision 只可有
  一個有效 target，避免兩個 session 各自將同一輪 due review 推進一次。
- policy 至少考慮：詞彙成熟度、首次／最近 objective evidence、self-rating calibration、
  remediation 狀態、debt size／age、近期同詞 exposure 及 mode。
- admission／selection decision 保存一個 version bundle：selection、admission、quality mapping、
  item construction／config version，連同 `selectionReason`、decision time、candidate-state
  revision／eligible-set digest 同 deterministic seed（如有）。目標係可解釋、可 audit，唔承諾
  單靠一個 version 字串就可以喺已改變嘅資料上逐項重播；self-rating 可以影響正常排程，
  但唔直接變成 quality。

### 5.3 Bounded debt：`retrieval-v1` 起始參數

| 參數 | v1 起始值 | 行為 |
|---|---:|---|
| `maxCombinedWorkDebt` | 5 | obligation + remediation active work 嘅 learner-wide 硬上限 |
| `softDebtThreshold` | 3 | 到達後提升現有 obligation 優先度 |
| `maxConsecutiveProbes` | 2 | UX soft cap；之後先提供休息出口／合法 Learning Card |
| `minInterveningItems` | 2 | 同一詞最少隔開兩個其他 acknowledged items；重開 app 不清零 |
| `minVerificationDelay` | 10 分鐘 | `eligibleAt` 同時滿足 elapsed delay；唔靠 session boundary |
| `maxObligationAge` | 24 小時 | active user service deadline；長期離線按 explicit expiry rule |
| `maxEligibleServiceGap` | 6 個 acknowledged items | 持續活躍且有合法題目時，最舊 work 最多隔 6 個 acknowledged items；由 Phase 1 deterministic simulation 固定 |

以上係 versioned operational defaults，唔係不可修改嘅教育常數。任何調整要更新
policy version、simulation fixture、監控 threshold 同決策紀錄，唔可以只改 magic number。

必須永久成立嘅 invariant：

- 每個 learner 嘅 obligation + remediation combined work debt 有硬上限；
- 每個 learner × word × evidence goal 最多一個 active obligation，同類重複要求只可
  coalesce／supersede 並保留 lineage；remediation 亦 per-word dedupe；
- admission 以 learner-scoped lock／revision 喺 Serializable transaction 原子檢查 cap；
- soft／hard threshold 後，原本 policy 判定「需要驗證」嘅新詞唔可以靜默改成
  `requiresVerification=false`；要 defer 新詞 admission、服務舊 work 或提供安全離開；
- obligation 有 `pending → leased → answered | expired | cancelled` 明確生命週期；
- crash／lease expiry 後可恢復，而且同一 obligation 最多產生一個 scored result；
- 所有 Objective Probe 都以 target consumption compare-and-set；會更新 operational Review 嘅
  purpose（包括 direct due）再以 expected Review revision CAS。第二個 session item只會收到
  stale／superseded authoritative outcome；research-only purpose 唔 mutation Review；
- scheduler 唔因 debt 滿而阻止學生離開，亦唔用假「完成」作 coercion；
- learner 持續活躍、work 已到 `eligibleAt` 且可構造合法題目時，最舊 work 必須喺
  `maxEligibleServiceGap` 內獲 service；離線期間唔承諾 liveness；
- `expired` 保存 terminal reason，計入 verification-missed／coverage，絕不當完成證據；
  如轉成普通 due target，要用 supersession link 保留 lineage；
- 無合資格 probe 時可以繼續合資格 Learning Card，唔需硬湊固定 quick-check 比例；
  當 probe 係唯一合法 item，`maxConsecutiveProbes` 可暫時超過，但先顯示非強迫休息／離開
  出口並記錄 override reason，唔顯示假完成。

### 5.4 Probe 結果及 remediation

- 正確：完成 obligation（如有），寫一次 ReviewEvent，再由 SM-2 計算下次複習。
- 錯誤：保存第一次答案；對 operational purpose 寫一次 ReviewEvent，完成原 obligation，
  並喺 combined cap 內 coalesce／建立 remediation；下一步唔必然即刻再問同一題。
- timeout／離開但未提交：唔寫 scored ReviewEvent；item 保持可恢復或 lease expiry。
- option-level feedback 唔可以洩露其他未答 probe 嘅答案。

### 5.5 Probe purpose 及副作用

每個 target、stream item、credential 同 immutable question snapshot 都綁定 server-owned
`probePurpose`，client 唔可以改：

| Purpose | 寫 operational ReviewEvent／SM-2 | Remediation／unlock | Research eligibility |
|---|---:|---:|---|
| `DUE_REVIEW` | 是 | 按 learning policy | 唔需要研究資格 |
| `EVIDENCE_OBLIGATION` | 是 | 按 learning policy | 唔需要研究資格 |
| `OPERATIONAL_DIAGNOSTIC` | 只按另行批准產品 policy；預設否 | 預設否 | 唔作 research-only exposure |
| `RESEARCH_DIAGNOSTIC` | 否 | 否 | 有效 permission + assent + protocol + flag |

Research diagnostic 只寫 consent-gated research result，唔改 SM-2、unit unlock、leaderboard、
mastery、remediation 或正常 scheduler state；feedback／retention 由 approved protocol 明訂。

### 5.6 Probe Construction Contract

- 每題保存 item-construction version、prompt direction、template／generator version、內容版本；
- immutable snapshot 只可有一個無歧義正解；顯示選項經 normalization 後互不重複，
  排除同義正解、cue leakage、無意義／跨語言 distractor；
- option ID 係 per-item nonsemantic opaque token，位置由 server 以可 audit seed／snapshot 固定；
- validator 檢查 option 數量、唯一性、答案存在、position distribution、distractor similarity
  同 prompt／answer 洩漏；exact thresholds 由 construction policy version 控制；
- 無法產生合法題目時 fail closed：唔簽發 scored probe、唔寫 ReviewEvent，target／obligation
  保留、轉移或以 explicit terminal reason 處理，絕不當答錯；
- pilot 監察 invalid-item rate、position bias、direction-specific accuracy 同被 challenge 題目；
- correct=4／wrong=2 只喺 item validity tests 同 SM-2 trajectory simulation 通過後生效。

## 六、Objective evidence → SM-2 quality

`retrieval-v1` 預設 mapping：

| 合資格 operational probe first response | SM-2 quality | 理由 |
|---|---:|---|
| 正確 | 4 | 有客觀 recognition evidence，但唔足以聲稱完美自由回憶 |
| 錯誤 | 2 | objective failure，要進入 remediation／短 interval |
| 無答案／只揭示／self-rating／research-only result | 不產生 quality | 無合資格 operational first response |

- quality 5 保留畀日後更強且經批准嘅 evidence contract，v1 唔會由反應快、右滑或
  高 confidence 自動升到 5。
- response time、self-rating、hint exposure 可以作分析或 scheduler feature，但 v1 唔加入
  scored quality。
- 每個 ReviewEvent 保存 mapping policy version；重算報表時唔用最新 mapping 覆蓋歷史。

## 七、Metric contract

| 顯示／指標 | 計算依據 | 禁止混入 |
|---|---|---|
| 已學 encounters | acknowledged Learning Encounters | Objective accuracy |
| V2 客觀認讀正確率 | provenance 完整、operational purpose 嘅 first-response correct／answered probes | self-rating、legacy unknown、research-only |
| 自評校準 | self-rating 與其後合資格 probe 嘅配對 | 未經驗證 encounter |
| 到期複習 | SM-2 due state | pending research-only probes |
| Legacy／mixed mastery continuity | 現有 Review state，另標 legacy provenance | 宣稱成純 V2 objective accuracy |
| V2 掌握／單元解鎖 | 合資格 operational Objective ReviewEvent policy | 單次右滑、research diagnostic |
| verification coverage | answered／expired／cancelled／eligible work | 將 expired 當答啱 |
| probe completion／abandonment | issued、visible、answered、left／expired | 未顯示 item |
| personal learning-day streak | 現行 `Asia/Shanghai` operational calendar rules | research upload 成功與否 |
| leaderboard scored streak | 只使用合資格 objective ledger | 只有 Learning Encounter 嘅日子 |

Dashboard 文案要講清楚 denominator；例如只有兩題 probe 時，不用 100% 放大暗示長期掌握。
現有來源不明嘅 `REVIEW` rows 保留 SM-2／歷史 continuity，但標為 `LEGACY_UNKNOWN`，唔進
V2 objective-recognition 分子／分母。每個 V2 scored row 至少保存 evidence kind、probe purpose、
flow version、quality mapping version、item-construction version及 evidence target provenance。
如 personal learning-day streak 納入 acknowledged Learning Encounter，必須同 leaderboard scored
streak 分名、分欄、分 projection，避免右滑間接加排行榜。

## 八、中斷、續接及跨裝置

- acknowledged item 係唯一可以前移 server pointer 嘅事件；純 client animation 唔算完成。
- pending submission 要透過 operational outbox 使用同一 `operationId` 重送。
- checkpoint 只保存 opaque session／item pointer、最小 presentation state 同 revision，
  唔保存正確答案或用 word ID 重新建立 credential。
- 兩個裝置同時回答：第一個合法 commit 勝出；另一個收到 authoritative result 並前進，
  唔產生第二個 ReviewEvent；即使兩邊用唔同 `operationId`、唔同 stream item，亦由共同
  Objective Evidence Target／Review revision 阻止雙重 scored update。
- credential 過期後只可按 server lineage renew／reissue，client 唔自行換 word ID 再提交。

詳細安全及 migration 規則見
[study-credential-v2-migration.md](./study-credential-v2-migration.md)。

## 九、Mode contract

### Global mode

- continuous、無固定終點；server 可混合 Learning Cards、due probes 同 obligation probes；
- combined work debt 係 learner-wide；Global 可以服務任何合資格 unit 來源嘅 work；
- 「離開」永遠可用，亦唔因 debt 尚有項目而警告失敗。

### Unit mode

- 候選內容限於 unit contract；可以顯示 unit coverage 同 summary；
- 同樣採固定 gesture、server scoring、first-response、safe stop；
- Unit 只服務同一 unit 詞彙；所產生 work 之後可由 Global 服務。其他 unit work 唔會插入
  當前 Unit，但 learner-wide cap 要有 versioned per-scope reservation／admission rule，避免
  其他 unit 填滿 cap 後令當前 unit 永久無法驗證；
- unit boundary 無合資格新 item 時可以顯示自然 summary，唔偽裝 global stream 完成。

## 十、Observability contract

Operational logs／metrics 至少要觀察：

- item kind、selection reason、policy version、flow version、evidence target／review revision；
- debt size、oldest debt age、lease expiry／recovery；
- duplicate／stale／conflict action、outbox retry age、sync blocked；
- probe first-response result、remediation created、scheduler no-candidate；
- stream leave point、active item time（只作 operational aggregate，唔自動成研究 event）。

Log 唔保存 password、raw session token、nonce、完整 credential 或直接身份識別資料。

## 十一、驗收矩陣

| 範圍 | 必須證明 |
|---|---|
| State model | reveal 前 swipe 無提交；reveal 後左右語義固定；probe 只可 tap／keyboard |
| Evidence | self-rating 零 ReviewEvent；operational target first answer恰好一個；research purpose 零 operational 副作用 |
| Scheduler | property／長序列 simulation 覆蓋 combined cap、並發 admission、dedupe、liveness、reopen gaming、mode switching |
| Construction | 唯一正解、duplicate／synonym／cue leakage、position、invalid fail-closed、word 改／刪 snapshot |
| Quality | valid operational item correct=4、wrong=2、其他無 quality；歷史保存 version bundle |
| Resume | refresh／offline／cross-device 唔遺失 action；兩個 session 同一 due generation 只 scored 一次 |
| Metrics | legacy unknown 排除 V2 accuracy；分母／provenance 可追溯；recognition 唔說成 recall |
| Accessibility | keyboard、screen reader、reduced motion、touch／mouse 等價 |

## 十二、風險及緩解

| 風險 | 緩解 |
|---|---|
| debt 參數太進取，quick checks 太密 | server versioned config、soft threshold、consecutive cap、pilot monitoring |
| 參數太寬鬆，驗證太遲 | oldest-age alert、24h max-age、scheduler simulation |
| self-rating 被 UI／統計當 objective | typed event／metric glossary、contract tests、文案 review |
| MCQ 高估真正詞彙能力 | 明確稱 objective recognition；quality 4；日後另訂 stronger probe |
| prototype 固定節奏滲入 production | manifest 標記 intentional deviation；integration acceptance test |

## 十三、決策紀錄

| ID | 決策 | 狀態 |
|---|---|---|
| C-001 | 成熟到期詞可直接接受 Objective Probe | 已確認 |
| C-002 | Evidence Obligation 由 server admission policy 建立，唔係每次 encounter 必建 | 已確認 |
| C-003 | MCQ 指標稱 objective recognition | 已確認 |
| C-004 | quality mapping 使用 versioned policy | 已確認 |
| C-005 | Global continuous；Unit 可 bounded 但可隨時離開 | 已確認 |
| C-006 | `retrieval-v1` 用 correct=4、wrong=2；quality 5 暫不使用 | 已確認 |
| C-007 | combined cap=5、soft=3、consecutive soft cap=2、intervening=2、delay=10m、age=24h、service gap=6；由 deterministic simulation 固定 | 已確認為 v1 起始值 |
| C-008 | 所有 scored probes 綁唯一 evidence target、purpose、immutable valid question snapshot | 已確認 |
| C-009 | research-only diagnostic 零 operational 副作用，出題本身亦受 permission／assent／protocol gate | 已確認 |
| C-010 | legacy unknown 保留 mastery continuity，但排除 V2 objective accuracy | 已確認 |

## 十四、Definition of Done

- [x] C-001 至 C-010 已獲批准；
- [x] glossary 已同步到 implementation、migration、research plan；
- [ ] Implementation Phase 0 擁有嘅 versioned handoff addendum 已獲 Contract review；
- [x] scheduler simulation 規格包含 combined cap、atomic admission、dedupe、delay、age、
  active-user liveness、mode switching、remediation、reopen gaming及無候選情況；
- [x] API／schema review 證明 client 無法自行指定 word、item kind、正確答案或 score；
- [x] metrics 及 reliability acceptance criteria 已由 unit／DB／browser／manual evidence 驗證；
- [ ] 原生 screen-reader、手機實機及完整 accessibility acceptance matrix 已驗證；
- [x] 文件經兩路 review，由「草擬中」轉為「待審批」；
- [x] 使用者已明確批准本 Contract 同 dependent plans；Implementation 可按 gate 開始。

## 十五、實際驗證紀錄

### 2026-08-12：Contract acceptance evidence

- `npm test` 120 passed，涵蓋 state machine、scheduler long sequence、combined cap、
  per-word dedupe、eligible delay、mode scope、remediation、construction fail-closed、
  correct=4／wrong=2 及 typed action boundary。
- `npm run test:db:stream-v2` passed，補充 Serializable admission lock、V2 provenance、
  immutable snapshot、Review revision CAS、feedback resume／ack、lease completion、unit
  scope 及 global idempotency evidence。
- Contract boundary review 已確認 client 不可指定 word、item kind、quality、correctness
  或第二次 scored result；V1 legacy unknown 保留 continuity，未計入 V2 objective
  recognition 分母。研究功能及 research-only exposure 仍關閉。
- `npm run test:e2e:card-motion`、V2 Playwright CLI manual matrix、offline outbox recovery、
  cross-tab credential／checkpoint reconciliation 及 feature-off V1 rollback smoke 已通過。

仍未完成：原生 screen-reader／手機實機驗收、長時間 production observability、正式文案
review、production deployment／student pilot 及 research governance gate；相關 checklist
保持未勾選。
