# Retrieval-first Learning Program 主計劃

> 類型：主計劃／Program Plan
> 狀態：進行中
> 父文件：[project-plan.md](./project-plan.md)
> 實作基線：`codex/retrieval-first-learning-stream-v2`
> 基線 commit：`cc7fd19`
> 設計來源：`/Users/hangwong/Documents/Design/emm_style_02`
> 產品里程碑：Learning Stream v2
> 研究里程碑：Research-ready telemetry；其後才是 experiment-ready

## 一、文件定位

本文件係 Retrieval-first Learning Program 嘅唯一總入口，負責記錄：

- 點解要重整核心學習流程；
- 邊啲現有成果必須保留；
- 各規格及子計劃嘅依賴關係；
- 跨文件里程碑、風險、發佈閘門及整體完成條件。

本文件唔重複定義詳細 gesture、scheduler、API、Prisma 欄位或研究 event；
呢啲內容由下面四份受控文件負責。任何 checklist 只可以由一份文件擁有，避免
主計劃同子計劃顯示互相矛盾嘅完成狀態。

## 二、背景及重整原因

目前開發分支已由一般學生項目進化成具有完整學生資訊架構、共用 design system、
成熟卡片 motion、server-issued study session、nonce、operationId、離線 outbox、
checkpoint、跨分頁／跨裝置 reconciliation、migration safety 及 multi-browser
regression 嘅正式學習平台。今次工作唔係推倒呢個基礎，而係喺佢上面重新定義核心
學習單位。

現有流程仍然以固定 queue 為中心：學生先判斷認識／不認識，再接受客觀選擇題，
最後完成一輪。呢個模式有三個根本問題：

1. swipe 自評同 tap 四選一不斷交替，學習節奏容易中斷；
2. 第一個 swipe 容易反映熟悉感，未必代表學生曾經由記憶提取詞義；
3. 固定題數、剩餘數及完成頁容易令碎片學習變成「要完成一份功課」。

另一方面，項目亦希望成為教育研究平台，研究學生詞彙弱點、主觀判斷校準、
retrieval opportunity、客觀認讀、投入行為及不同學習策略效果。現有 ReviewEvent
係可靠 scored ledger，但唔應直接承擔完整研究 telemetry。

因此本 Program 要將學生體驗改成：

```text
隨時進入 continuous stream
→ 遇到學習／回想卡或客觀檢查卡
→ 每張卡完成後都係合法停止點
→ 下次由 server 安排下一個最合理 item
```

## 三、已確認嘅產品取向

以下五項由使用者確認，屬 Contract v1 起點：

1. 已學而到期嘅成熟詞可以直接出 Objective Probe，唔需要每次先出 reveal card。
2. 唔係每個 Learning Encounter 都建立 future verification；由 server policy 判斷
   `requiresVerification`，並對 verification debt 實施 admission control。
3. 四選一 quick check 正式稱為客觀認讀／`objective recognition`，唔宣稱量度到
   可直接觀察嘅自由回憶成功。
4. objective result 到 SM-2 quality 嘅 mapping 屬 versioned learning policy，唔係
   永久寫死嘅教育 contract。
5. Global `/study` 採用無固定完成要求嘅 continuous stream；Unit mode 仍可保留
   有限內容及 summary，但學生任何時候都可以安全離開。

其他已確認原則：

- Tap card／明確控制＝揭示答案；
- 左滑永遠＝未想起；右滑永遠＝想起了；
- swipe 唔用作選擇客觀答案；
- self-rating 唔直接更新 Review、mastery、leaderboard 或單元解鎖；
- 客觀題只保存第一次答案；答錯後唔原地重試到啱再冒充成功；
- 正確答案只由 server 判定，唔將 `correctOptionId` 下發 client；
- production safety contract 高於 prototype fidelity；
- research telemetry 預設關閉，而且上傳失敗唔阻止正常學習。

## 四、目標

### 4.1 Product

- 建立低壓、可隨時開始／停止嘅 continuous learning stream；
- 將 Learning Card 同 Objective Probe 建立清楚穩定嘅心理模型；
- 保留並抽出現有 WordCard motion engine；
- 令每個完成 action 都可以安全重試、對賬及跨裝置接續；
- 將「自評」「客觀認讀」「已學」「長期掌握」分開顯示。

### 4.2 Learning

- 新詞、弱詞及 remediation 先提供 retrieval opportunity，再揭示答案；
- 已到期成熟詞可以直接接受客觀認讀 probe；
- V2 只有合法 operational objective first response 可以產生帶完整 provenance 嘅 scored
  ReviewEvent；來源不明 legacy rows 只保留歷史 continuity；
- verification obligation 有上限、有期限、可恢復、唔會無限累積；
- 所有排程決策保存 version bundle、reason 同 candidate-state evidence，做到可解釋及審計；
  唔以單一 `policyVersion` 過度承諾完整重播。

### 4.3 Reliability

- 保留 auth、role guard、session、nonce、operationId、Serializable transaction、
  retry、outbox、reconciliation 及 migration safety；
- 將 credential 主體由 word-level 遷移到 canonical stream-item-level；
- v1 同 v2 flow 可以喺 feature flag 期間安全共存；
- rollback 唔需要 destructive downgrade migration。

### 4.4 Research readiness

- operational learning data 同 consent-gated research telemetry 分開；
- 先建立可靠、可去直接身份識別嘅 telemetry，再考慮正式 experiment；
- adaptive exposure 唔直接當成全校詞彙弱點；正式弱點分析使用分層 diagnostic／
  sentinel probes；
- 正式實驗另有倫理、permission／assent、sample-size、preregistration 及 analysis plan。

## 五、非目標

- 唔重新定義現有顏色、字體、spacing、radius、responsive breakpoint 或品牌語言；
- 唔重寫 SM-2 公式；今次只 version 其輸入 evidence policy；
- 唔將研究推論即時用作懲罰、作弊標記或差別待遇；
- 唔喺第一個產品版本同時上線完整 experiment engine；
- 唔將 global stream 重新包裝成隱藏式固定五題／二十詞 session；
- 唔執行 `prisma db push`，亦唔修改已套用 migration；
- 未有明確授權及 confirmation 前唔執行任何 contract migration。

## 六、受控文件及單一真相來源

| 文件 | 類型 | 負責範圍 | 唔負責 |
|---|---|---|---|
| [retrieval-first-learning-contract.md](./retrieval-first-learning-contract.md) | RFC／Normative Contract | 卡片分類、gesture、evidence、scheduler invariants、metric glossary、決策紀錄 | React、SQL、逐項 rollout |
| [learning-stream-v2-implementation.md](./learning-stream-v2-implementation.md) | 實施計劃 | UI state machine、API integration、outbox、checkpoint、測試、pilot | 改寫 Contract、credential schema 細節 |
| [study-credential-v2-migration.md](./study-credential-v2-migration.md) | 安全／遷移計劃 | session item credential、nonce、lineage、rotation、migration coexistence | 學生文案、研究問題 |
| [research-learning-framework.md](./research-learning-framework.md) | 研究框架計劃 | consent、telemetry、data governance、diagnostic、experiment gates | 正常學習排程、production credential |

其他單一真相來源：

- 當前實際行為：程式、測試、`prisma/schema.prisma`；
- production migration／deploy：`DEPLOY.md`、scripts、GitHub Actions；
- 視覺及互動 reference：versioned `emm_design_02` handoff；
- 長期產品願景及現況：[project-plan.md](./project-plan.md)。

如文件同可執行證據衝突，以可執行證據為準，並喺同一改動修正過時文件。

## 七、依賴關係及工作流

```text
Contract v1 確認
├── Prototype state manifest／interaction map
├── Learning Stream isolated harness
├── Credential v2 expand 及 dual-flow compatibility
└── Research operational boundary

Learning Stream harness + Credential v2 API
→ internal-account integration
→ checkpoint／outbox／cross-device reliability gate
→ limited student pilot
→ product rollout

Stable operational encounter contract + consent／governance
→ telemetry pilot
→ data-quality gate
→ 另行批准嘅正式 experiment protocol
```

### 7.1 Change control

- gesture、evidence、scheduler invariant 或 metric 定義改變：先更新 Contract；
- API／schema／migration／rollback 改變：先更新相應實施或 migration plan；
- research consent、retention、export 或 assignment 改變：先更新 Research Framework；
- 每一項工作 checklist 只喺擁有佢嘅子計劃更新；
- 主計劃只喺子計劃真正完成及驗證後勾選 milestone。

### 7.2 本地完整產品交付範圍（2026-08-13）

使用者已澄清本階段交付目標係「本機可完整使用嘅最終 V2 產品」，唔係正式
production rollout、真實學生 pilot 或 research-ready release。由此分開兩種完成狀態：

- **Local product-complete**：本地所有 authenticated study accounts 預設走 V2，完整
  Learning Card／Objective Probe／offline／cross-device／V1 rollback 及本地驗證全部完成；
- **External rollout**：production deploy、外部 observability window、真實學生 pilot、
  ethics／consent／研究資料收集及 destructive contract cleanup 仍然 deferred，唔阻塞
  本地產品完成。

本地 all-user assignment 必須係明確 env mode；Vercel preview／production runtime 遇到該
mode 要 fail closed，local browser test 可由明確 `ENABLE_TEST_ROUTES=1` 例外啟用，並保留
`off`／internal allowlist 以便 V1 rollback。呢個係 rollout scope 決定，唔
改變 Contract v1 嘅 Learning Card、Objective Probe 或 evidence 語義。

## 八、整體里程碑

### Milestone P0：Framework freeze

- [ ] Contract v1 所有未決事項已處理；
- [x] Implementation Phase 0 擁有嘅 versioned handoff addendum 已記錄可重現 source、
  state manifest、precedence 及所有 intentional deviations，並通過 Contract gate；
- [x] 三份 product-side 文件獲使用者批准並改成「進行中」。

### Milestone P1：Foundations

- [x] 純 learning policy／state machine 通過 unit tests；
- [x] isolated UI harness 通過 mouse、touch、synthetic pointer、keyboard、reduced motion；
- [x] Credential v2 expand schema、dual-read／dual-flow compatibility 通過；
- [x] legacy production flow 無 regression。

### Milestone P2：Internal integration

- [x] V2 action API、operational outbox、StudyEncounter、EvidenceObligation 及
  ObjectiveEvidenceTarget 完成；
- [x] Global `/study` 已支援 internal／test assignment 及明確 local all-user assignment；
  production default 仍為 V1／allowlist；
- [x] Dashboard、streak、achievement、unit mode 使用新 glossary；
- [x] server-side scoring、idempotency、task lease recovery 通過。

### Milestone P3：Reliability gate

- [x] checkpoint v2、舊 checkpoint invalidation、session rotation 完成；
- [x] answered probe 唔會重做；pending action 唔會重複 scored；
- [x] cross-tab／cross-device／offline／storage unavailable 測試通過；
- [x] migration fresh replay、checksum、contract regression 通過；
- [x] rollback 演練通過。

### Milestone P4：Local product-complete；external rollout deferred

- [x] local all-user V2 assignment、pre-reveal gate 及完整 local browser／DB 驗證完成；
- [x] local V1 rollback mode 及 V1 compatibility regression 完成；
- [ ] visual review follow-up（卡面 tap-to-reveal／flip、卡下同寬 self-rating、學生名稱繁簡顯示）完成並驗證；
- [ ] external pilot、production observation、正式 full rollout 及 threshold decision（延期，
  唔屬本地交付）；
- [ ] Product-side 子計劃嘅 local scope（包括 I-011 visual correction）完成並記錄實際驗證。

### Milestone R1：Research-ready telemetry

- [ ] ethics／privacy／permission／assent／retention 已正式批准；
- [ ] 非參與者唔產生 research events；
- [ ] research upload failure 唔阻塞學習；
- [ ] timing、export、access audit、withdrawal 流程通過；
- [ ] telemetry pilot 達到 completeness gate。

### Milestone R2：Experiment-ready

- [ ] 具體研究 protocol、power、preregistration、analysis plan 獲批准；
- [ ] assignment reproducible 並有 balance／exposure audit；
- [ ] primary outcome、delay window、exclusion rule 及 data lock 已凍結；
- [ ] pilot 完成後先考慮正式 experiment。

Product rollout 唔依賴 R1／R2 完成；研究功能亦唔可以延遲正常學習修正。

## 九、跨計劃風險

| 風險 | 後果 | 緩解 |
|---|---|---|
| 每張 Learning Card 都建立 verification | backlog 無限增加 | policy-controlled obligation、debt cap、admission control、scheduler simulation |
| client 知道正確答案 | 可作弊、研究結果失真 | server-side option snapshot 及 scoring；client 只收 opaque option IDs |
| 兩個 session 同時出同一 due generation | SM-2／ReviewEvent 重複推進 | server-owned evidence target + expected Review revision CAS |
| legacy ReviewEvent 被誤稱 objective | accuracy／研究分母失真 | provenance expand；`LEGACY_UNKNOWN` 保留 continuity 但排除 V2 objective projection |
| recognition 被誤稱 recall | 教育結論過度推論 | glossary 固定用 objective recognition；另行批准 recall probe |
| 模糊／洩漏提示嘅 MCQ 仍推進 SM-2 | 錯誤 quality／mastery | immutable question snapshot、construction validator、invalid fail closed |
| v1/v2 credential 混用 | 重複提交或越權 | flowVersion pinning、canonical streamItemId credential、route-level kind validation |
| Phase 4 早過 reliability 完成就 pilot | 資料遺失／重複 | internal-only gate；P3 全部完成先學生 pilot |
| adaptive data 推論全校弱點 | selection bias | selectionReason／probability；分層 diagnostic／sentinel probes |
| research event 量過大 | 成本、私隱、效能 | consent gate、batch、payload allowlist、retention、completeness sampling |
| 非參與學生仍收到 research-only sentinel | 無同意研究 exposure | 出題同 ingestion 都要 permission、assent、protocol、kill-switch gate |
| prototype 同產品 contract 衝突 | UI 實作走回固定 session | state manifest 記錄 intentional deviations；Contract 優先 |

## 十、整體測試矩陣

| 層級 | 最少驗證 |
|---|---|
| Contract／policy | state transition、scheduler invariant、debt boundedness、quality mapping、metric glossary |
| Component | reveal gating、fixed swipe semantics、probe tap、feedback、keyboard、reduced motion |
| API／DB | idempotency、one-time credential、server scoring、lease recovery、concurrent devices |
| Migration | Prisma generate、fresh replay、checksums、legacy regression、expand／contract gate |
| Browser | mouse、emulated touch、synthetic pointer、offline、cross-tab、cross-device、resume |
| Research | consent disabled、event idempotency、active time、pseudonymous export、withdrawal、assignment |
| Production | build、production config、feature flag targeting、observability、rollback |

實際指令及完成結果由各子計劃記錄；主計劃唔以「已寫 code」代替驗證。

## 十一、發佈及 rollback 總策略

1. 所有 schema 先 expand；legacy flow 繼續運行。
2. V2 只由 server-side feature assignment 開啟，並將 `flowVersion` pin 喺 study session。
3. 先 internal accounts，再小 cohort，再分階段擴大。
4. 發佈期間同時觀察 error rate、sync blocked、duplicate conflict、verification debt age、
   probe completion、abandonment 及 latency。
5. Rollback 只關閉新 assignment；已簽發 v2 session 按明確策略完成、退休或失效。
6. 已寫入嘅 objective ReviewEvent 保留；self-rating／encounter 可暫時唔參與 legacy UI。
7. 新 tables／nullable fields 保留，唔做 destructive downgrade。

## 十二、整體 Definition of Done

### Product release complete

- [ ] Contract v1 已確認而且無未解決 blocking decision；
- [ ] Learning Stream v2 Implementation 已完成；
- [ ] Credential v2 Migration 嘅 product-release 範圍已完成；
- [ ] P0–P4 全部通過；
- [ ] 實際測試、未執行項目、已知限制及 rollback 演練已記錄；
- [x] [project-plan.md](./project-plan.md) 已按實際新行為校準。

### Local product-complete

- [x] local all-user V2 assignment 只喺 development／local test 生效，production fail closed；
- [x] local `/study` 完整通過 Learning Card reveal gate、self-rating、Objective Probe、
  feedback ACK、resume、offline、cross-device 及 V1 rollback 驗證；
- [ ] local V2 visual review follow-up 已完成：卡面 tap（排除發音）揭示、one-way flip、卡下同寬
  self-rating actions 及 zh-Hant／zh-Hans 學生名稱 display regression；
- [x] local scope 完成後，production／pilot／research／contract-cleanup deferred 狀態有明確
  記錄，唔將未執行外部 gate 誤報為本地缺陷。

### Research-ready complete

- [ ] Research Framework R1 已完成；
- [ ] telemetry pilot 已通過 privacy 及 data-quality gate；
- [ ] Product release 唔依賴 R2 experiment-ready。

### Program complete

- [ ] Product release complete；
- [ ] Research-ready complete；
- [ ] R2 已完成，或者由另一份已索引計劃正式接手並將本計劃標記「已取代」。

## 十三、決策紀錄

| ID | 決策 | 狀態 |
|---|---|---|
| P-001 | 採用一份主計劃、四份受控子文件；所有文件放喺 `plans/` | 已確認 |
| P-002 | Product rollout 同 Research rollout 使用獨立完成閘門 | 已確認 |
| P-003 | Contract 變更先於 dependent implementation 變更 | 已確認 |
| P-004 | Prototype 只負責 presentation／interaction reference，唔覆蓋 production safety | 已確認 |
| P-005 | V2 item credential rotation 以 server-recorded digest lineage 保留短效並行 grants，容許跨分頁／跨裝置 bootstrap 唔互相撤銷；action 仍以 item／revision／target CAS 決定唯一結果 | 實作中；expand-only migration，未涉及 contract cleanup |
| P-006 | 本階段先完成 local product-complete；local all-user mode 只限 non-production，external pilot／production／research／destructive contract cleanup deferred | 已確認；由 Implementation I-010 落實 |
| P-007 | Visual review follow-up 仍屬同一 V2 implementation scope：tap-to-reveal／flip、卡下同寬 self-rating 及學生名稱 display localization；唔改 learning／evidence semantics | 已確認；由 Implementation I-011 落實 |

## 十四、計劃審查紀錄

### 2026-08-12：兩路獨立 Subagent review

| Reviewer focus | 主要 finding | 跟進結果 |
|---|---|---|
| 產品／教育／scheduler | legacy provenance、probe construction、combined debt liveness、spacing、mode scope、feedback resume | 已加入 Contract invariants、purpose／validity contract、長序列 simulation及 metric transition |
| 安全遷移／研究治理 | legacy unique 阻礙 multiple items、direct due 雙重 scored、global idempotency、research exposure gate、withdrawal／power | 已改用獨立 V2 item table、evidence target + Review CAS、global receipt、disposition matrix及 clustered power |

兩個 review 都確認 C-001–C-005 五項使用者決定已完整落實，亦認為 Program + 四份子文件
嘅 ownership 合理。所有 P0 finding 已轉成 normative contract／migration gate；P1 finding中涉及
outbox、snapshot、metrics、diagnostic bias、handoff ownership、決策紀錄及實際驗證指令亦已納入。
C-006 quality mapping 同 C-007 policy 起始參數其後已獲使用者批准。仍然留作實作 gate
收斂嘅項目包括 service-gap simulation、exact API path、credential attachment、retention 日數
及個別 experiment protocol；呢啲唔會由開發者喺寫 code 時自行猜測。

### 2026-08-12：使用者批准開始實作

- 批准 C-001–C-010；
- `correct → quality 4`、`wrong → quality 2`；
- v1 起始 combined debt cap 5、soft threshold 3、正常最多連續 2 個 probes；
- 同詞 verification 至少相隔 2 個其他 acknowledged items及 10 分鐘；24 小時 expiry
  保留 missing evidence，唔當成功；
- personal learning-day streak 同 objective leaderboard 分開；
- internal → small cohort → full rollout；legacy cleanup 另行批准；
- research collection／research-only exposure 保持關閉，直至所有正式外部 gate 完成。

## 十五、實際驗證紀錄

### 2026-08-12：獲授權 product implementation handoff／internal reliability closure

- Product-side V2 implementation 已在 `codex/retrieval-first-learning-stream-v2` 完成至
  internal／test gate；V1 default、server assignment、flowVersion pinning、expand-only
  migration 及 feature-off rollback path 保留。
- Unit／lint／typecheck、Prisma generate／validate、DB stream integration、V1 ledger
  regression、fresh migration replay、checksum、temporary-schema contract regression、
  production-config fixture、Chromium／WebKit browser regression 及 feature-off rollback
  smoke 均已通過；credential compatibility inventory、lineage scan、20-run bounded internal soak
  及 V2 structured observability／support runbook 亦已完成；詳細結果見四份 controlled
  sub-plans 及 `plans/artifacts/`。
- shared login、password-change、study queue／action／credential limiter 嘅 runtime guard
  已統一為 production／Vercel production fail-closed，只有明確 local browser-test runtime
  可使用 memory fallback；production build、shape-only config gate 及 child-process guard
  checks 均通過；`npm run audit:production` 經 network-enabled retry 報告 0 vulnerabilities。
- Study quality／production verification workflow 已補上 V2 DB integration、3-iteration
  bounded soak、student IA／accessibility QA 及 V2 source／test path filters；本地按 workflow
  順序驗證 integration passed、soak 3/3 passed、student-qa 21 passed／1 skipped、unit 124
  passed、lint／typecheck 及兩份 workflow YAML parse。這只證明 automation coverage，未構成
  GitHub production deployment、學生 pilot 或正式 observability observation。
- 已驗證的核心行為包括 C-001 direct mature probe、C-002 admission control、C-003
  objective recognition wording、C-004 versioned quality、C-005 global／unit stream、
  C-006 quality 4／2、C-007 bounded debt／spacing、C-008 target＋immutable snapshot、
  C-010 legacy unknown projection。C-009 research-only path 沒有實作，保持關閉。

仍未完成或未獲授權的 gate：Contract 全量 review／原生 screen-reader 及手機實機 matrix、
production deploy、正式學生 pilot、外部 observability threshold、
research ethics／家長 permission／學生 assent／資料收集，以及 `npm run db:contract`。
因此 P4、R1、R2 及 Program DoD 保持未完成；不可把本次 internal handoff 說成正式 rollout
或 research-ready。
