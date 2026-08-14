# Retrieval-first Learning Program 主計劃

> 類型：主計劃／Program Plan
> 狀態：進行中（local product-complete；external gates deferred）
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
- [x] visual review follow-up（Learning Card reveal／flip、卡下同寬 self-rating、學生名稱繁簡顯示）完成並驗證；
- [x] I-012 retrieval pause follow-up（持續保留思考提示、追加 3 秒 stationary long-press 提示、移動／發音排除、答案後一樣／不一樣 swipe 語義）完成並驗證；
- [x] I-012 visual feedback refinement（兩段提示高亮／呼吸、透明按住進度圈、接近 3 秒時加速、放手／移動重置及 reduced-motion regression）完成並驗證；
- [x] I-013 session-expiry recovery／bounded retry、outbox 保留、revoked fail-closed 及 V2 system copy zh-Hant／zh-Hans regression 完成並驗證；
- [x] I-014 item credential／expired lease recovery、refresh 後 bounded lineage resume、原 operationId 保留及未知 credential／revoked fail-closed regression 完成並驗證；
- [x] I-015 retrieval prompt presentation refinement（secondary prompt 置於發音 button 下方、低幅度呼吸、漸進出現、移除 V2 queue note）完成並驗證；
- [x] I-016 EMM Style 02 study surface fidelity refinement（level／category badge、study title／context、圖示＋發音文字、Objective Probe／V1 QuizCard 題目／選項 hierarchy）完成並驗證；
- [x] I-017 EMM choice-card reference visual refinement（題目／指示層級、選項 row／字母圓章、未作答／答錯／正確狀態）完成並驗證；
- [x] I-018 revealed Learning Card reference visual refinement（右上 stylized「認」、音標預留位、揭示答案 hierarchy、移除重複 swipe copy）完成並驗證；
- [x] I-019 Learning Card／Objective Probe follow-up refinement（「認」置中、音標 slot 緊貼英文、長按提示固定預留位、
  測試題改為「輕點一下任意區域」繼續而非確認 button）完成並驗證；
- [x] I-020 Objective Probe feedback presentation refinement（只用選項 correct／wrong／dim 顏色表示結果、移除可見結果／
  繼續文字，固定空白位顯示低幅度慢速半透明呼吸圓形作繼續 affordance）完成並驗證；
- [x] I-021 Learning Card swipe feedback placement refinement（左右拖曳提示下移至 level／category metadata 以下安全區，
  避免同 A1／分類 badge 重疊）完成並驗證；
- [x] I-024 首頁／統計進度範圍與導航修正（首頁只顯示已解鎖內容、統計頁補充 A1／A2／B1／B2 分級明細及解鎖狀態、帳戶選單改為「回到首頁」）完成並驗證；
- [x] I-025 共用進度條填色修正（ProgressBar 百分比文字與實際填色一致，首頁／統計共同驗證）完成並驗證；
- [ ] external pilot、production observation、正式 full rollout 及 threshold decision（延期，
  唔屬本地交付）；
- [x] Product-side 子計劃嘅 local scope（包括 I-011 visual correction、I-012 retrieval pause correction、I-013 session recovery／locale correction、I-014 item credential recovery、I-015 retrieval prompt refinement 及 I-016 EMM surface fidelity）完成並記錄實際驗證。
- [x] Product-side 子計劃嘅 local scope 包括 I-017 choice-card reference visual refinement 完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-018 revealed Learning Card reference visual refinement 完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-019 Learning Card／Objective Probe follow-up refinement 完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-020 Objective Probe color-only feedback affordance refinement 完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-021 Learning Card swipe feedback placement refinement 完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-024 首頁／統計進度範圍與導航修正完成並記錄實際驗證；external rollout gates 仍 deferred。
- [x] Product-side 子計劃嘅 local scope 包括 I-025 共用進度條填色修正完成並記錄實際驗證；external rollout gates 仍 deferred。

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
- [x] local V2 visual review follow-up 已完成：Learning Card reveal（現行為 stationary long-press，排除
  發音 control）、one-way flip、卡下同寬 self-rating actions 及 zh-Hant／zh-Hans 學生名稱 display regression；
- [x] local I-012 interaction follow-up 已完成：思考提示持續保留，約 1 秒後追加長按提示，stationary
  long-press 3 秒先揭示，移動／發音 control 不揭示，揭示後左右掃語義為和剛才想的一樣／不一樣；
- [x] local I-012 visual feedback refinement 已完成：思考／長按提示有高亮呼吸，按住顯示透明圓圈並
  隨進度加快，放手／移動／pointer cancel 會重置 3 秒計算，reduced-motion 仍保持可理解提示；
- [x] local I-013 已完成：session expiry 後重試會以 server-authoritative recovery 恢復原 typed action
  或安全終止而唔循環；原 operationId／outbox 保留，revoked／unknown credential fail closed；V2
  assignment／loading／fallback system copy 已通過 zh-Hant／zh-Hans 驗證；
- [x] local I-014 已完成：item credential／lease 過期時以 matching server-recorded lineage
  進行一次 bounded recovery；未知 credential、revoked session 及不同 item／session 安全終止；
- [x] local I-015 已完成：retrieval prompt 位置／間距、低幅度動畫、secondary progressive enter、
  queue note 移除及 reduced-motion／V1 regression 已驗證；
- [x] local I-016 已完成：EMM Style 02 study surface fidelity、additive level／category metadata、
  Objective Probe／V1 QuizCard hierarchy 及 responsive／locale／theme regression 已驗證；
- [x] local I-021 已完成：左右 swipe direction badge 位於 level／category metadata 以下，320px／390px responsive、
  V2 swipe／release／locale／theme／reduced-motion 及 V1 rollback regression 已驗證；
- [x] local I-022 CI incident fix：ordinary expand migration 下 V2 objective answer 必須抑制既有 legacy bridge duplicate，
  已完成 ordinary-migration integration／bounded soak／V2 browser／V1 rollback regression 及 remote quality gate；
- [x] local I-023 Learning Card level／category badge 已上移至同右上 stylized「認」標記視覺中心水平線，並完成
  desktop／mobile visual regression；
- [x] local I-024 首頁 progress 只計目前已解鎖內容、統計頁顯示 A1／A2／B1／B2 明細及解鎖狀態、帳戶選單顯示「回到首頁」，並完成必要嘅 unit／lint／typecheck 驗證；
- [x] local I-025 共用 ProgressBar 填色會按實際百分比顯示，並完成必要嘅 lint／typecheck／diff 驗證；
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
| P-005 | V2 item credential rotation 以 server-recorded digest lineage 保留 bounded grants；仍有效 predecessor 可作 normal action，已過期 predecessor 只供 I-014 explicit recovery，action 仍以 item／revision／target CAS 決定唯一結果 | 已落實並驗證；expand-only migration，未涉及 contract cleanup |
| P-006 | 本階段先完成 local product-complete；local all-user mode 只限 non-production，external pilot／production／research／destructive contract cleanup deferred | 已確認；由 Implementation I-010 落實 |
| P-007 | Visual review follow-up 仍屬同一 V2 implementation scope：tap-to-reveal／flip、卡下同寬 self-rating 及學生名稱 display localization；唔改 learning／evidence semantics | 已落實並驗證；由 Implementation I-011 完成 |
| P-008 | I-012 係同一 V2 presentation／interaction scope 嘅 retrieval pause 修正：延遲提示、stationary long-press、提示／按住進度視覺回饋及答案後一樣／不一樣 swipe 語義；唔改 learning／evidence semantics | 已落實並驗證；由 Implementation I-012 完成 |
| P-009 | 實際 local smoke 發現 session expiry 後 V2 outbox retry 會重試同一失效 session，並有 V2 loading source literal 漏出簡體；以 server-authoritative recovery 保留原 operationId／outbox，對 revoked／無 lineage credential fail closed，並統一 V2 system copy 由 canonical 簡體經 `tc()` 顯示 | 已落實並驗證；由 Implementation I-013 完成，唔涉及 migration／production／research gate |
| P-010 | 實際 local smoke 發現 item credential 過期／refresh 輪換後，V2 outbox action 未能進入 I-013 recovery；以 bounded digest lineage + explicit item recovery + lease CAS 修正，普通 action 對未知 credential／revoked session 仍 fail closed | 已落實並驗證；由 Implementation I-014 完成，唔涉及 migration／production／research gate |
| P-011 | 使用者視覺 review 指出兩段 retrieval prompt 呼吸過強、間距過窄、secondary prompt 出現突兀及 V2 queue note 不需要；維持 long-press／audio／learning contract，只調整 prompt placement、低幅度 motion、progressive enter 同 copy | 已落實並驗證；由 Implementation I-015 完成，唔涉及 migration／production／research gate |
| P-012 | 使用者要求以 EMM Style 02 handoff 收斂 V1／V2 study surface：恢復 level／category metadata、放大連續學習／認讀卡 hierarchy、發音圖示加文字，並重整 Objective Probe／V1 QuizCard 題目／選項 hierarchy；只改 presentation 及 additive output metadata | 已落實並驗證；由 Implementation I-016 完成，唔涉及 migration／production／research gate |
| P-013 | 使用者以兩張 choice-card reference 要求進一步收斂選擇題視覺：保留現有 option／answer contract，只調整題卡 prompt hierarchy、選項 row／letter badge 尺寸，以及 idle／wrong／correct 狀態色彩與層次 | 已落實並驗證；由 Implementation I-017 完成，唔涉及 migration／production／research gate |
| P-014 | 使用者以 revealed Learning Card reference 要求移除「認讀卡」文字、以右上四分之一圓內 stylized「認」作標記，預留 front／back 音標位、改善答案面 hierarchy、減少英文過大感及移除卡內重複 swipe copy；只改 presentation，不改 retrieval／gesture／server action semantics | 已落實並驗證；由 Implementation I-018 完成，唔涉及 migration／production／research gate |
| P-015 | 使用者指出「認」未置中、front 音標 slot 未緊貼英文、長按提示出現會令既有文字移位，並要求 Objective Probe 移除確認／「我看到了，繼續」button，改用「輕點一下任意區域」繼續；只改 presentation／既有 `FEEDBACK_ACK` trigger，不改 retrieval／scoring／server semantics | 已落實並驗證；由 Implementation I-019 完成，唔涉及 migration／production／research gate |
| P-016 | 使用者要求 Objective Probe 答題後只以選項顏色表達正誤，移除卡下可見結果／繼續文字，改用固定空白位內低幅度慢速半透明呼吸圓形作點擊 affordance；只改 presentation，保留既有卡面 click／keyboard `FEEDBACK_ACK`、a11y、locale／theme、reduced-motion 及 V1 rollback | 已落實並驗證；由 Implementation I-020 完成，唔涉及 migration／production／research gate |
| P-017 | 使用者指出 swipe 中嘅「和剛才想的不一樣／一樣」direction badge 同 A1／category metadata 重疊；只將 `.word-card-drag-badge` 下移至 metadata 以下安全區，保留 swipe／release／locale／theme／rollback semantics | 已落實並驗證；由 Implementation I-021 完成，唔涉及 migration／production／research gate |
| P-018 | CI run 26 暴露 ordinary expand migration 下 V2 objective answer 同 legacy `Review` bridge 互相作用，產生 duplicate `ReviewEvent`；只喺 V2 objective-answer transaction 設定既有 `app.review_event_writer=v2` guard，保留 V1 bridge、global receipt／unique、Serializable retry 及 rollback，唔執行 contract cleanup | 已落實並驗證；由 Implementation I-022 完成，ordinary-migration、DB／browser／V1 regression 及 remote quality gate 均通過 |
| P-019 | 使用者要求將 Learning Card 左上 A1／Numbers 0 to 100 level／category badge 上移至同右上 stylized「認」標記視覺中心水平線；只改 presentation，不改 retrieval／gesture／server semantics | 已落實並驗證；由 Implementation I-023 完成，desktop／mobile visual regression 及 V1／V2 interaction regression 均通過 |
| P-020 | 使用者要求首頁清楚標示進度只計已解鎖內容、統計頁按 A1／A2／B1／B2 顯示詳細進度及解鎖狀態，並將帳戶選單「回到今日」改為「回到首頁」；只改 metrics projection／student UI／navigation copy，不改學習、解鎖、schema、migration 或 rollback semantics | 已落實並驗證；由本次 local UI／metrics correction 完成 |
| P-021 | 使用者指出 ProgressBar 顯示 71% 文字但無填色；根因係填色 `<span>` 未設定可套用 width／height 嘅 display，修正只限共用 CSS presentation，不改百分比計算、metrics、學習或 rollback semantics | 已落實並驗證；由本次 local CSS correction 完成 |

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

### 2026-08-14：I-016 EMM Style 02 local product-complete evidence

- I-016 只改 V1／V2 presentation 同 additive level／category metadata；retrieval gate、long-press、swipe／
  self-rating、server scoring、credential、outbox、locale／theme contract、V1 rollback 及所有 external
  gates 保持不變。
- EMM handoff 對齊已驗證：level／category badge、較大「連續學習」header、右上「認讀卡」context、
  圖示＋「發音」control，以及 Objective Probe／V1 QuizCard 嘅 intro／prompt／direction metadata／四個選項 hierarchy。
- `npm test` 126 passed；lint、typecheck、diff check、production build（43/43 static pages）passed。
  V2 browser regression 7 passed；V1 `study-card-fidelity` desktop／mobile 8 passed／1 skipped；另以
  390×844／1440×900 local visual smoke 檢查 V2 probe，無 viewport overflow。
- 未執行 contract migration、production deploy、真實學生 pilot、研究資料收集、ethics／家長 permission／
  學生 assent；以上仍然係 external deferred gate。

### 2026-08-14：I-017 EMM choice-card reference visual evidence

- I-017 按使用者提供嘅兩張 choice-card reference 收斂 V1／V2 客觀題面；只改 presentation，保留 option／
  answer contract、server scoring、delayed answer、locale／theme、accessibility、V1 rollback 及 retrieval／
  credential／outbox 行為。
- 題卡 direction label 改為單行 plain label，prompt／instruction 左對齊；option row／A–D letter badge／
  spacing 放大；idle 保持白底薄框，wrong 用淡暖紅＋紅框／紅 badge，correct 用淡綠＋綠框／綠 badge，
  其餘未選答案保持白底及完整 opacity。
- desktop／390×844 local visual smoke 已核對 reference hierarchy；computed check 顯示無橫向 overflow，
  option `min-height: 68px`、`border-radius: 22px`、letter badge `44px`；reduced-motion option transition
  明確停用。
- 驗證：`npm test` 126 passed；lint、typecheck、diff check、build（43/43 static pages）passed；V2
  `test:e2e:study-stream-v2` 7 passed；V1 `study-card-fidelity` 8 passed／1 skipped；V1 choice-card
  transition targeted `study-workflow` 2 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、
  research telemetry／consent 或 ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-018 revealed Learning Card reference visual evidence

- I-018 按使用者提供嘅 revealed Learning Card reference 收斂 V2 卡面；只改 presentation／既有 additive `pos`
  display，保留 retrieval gate、stationary long-press、audio exclusion、flip、self-rating、server action、
  locale／theme、V1 rollback 及既有 item contract。
- 右上 quarter-circle 只顯示 stylized「認」，`role="img"`／accessible label 仍保留「認讀卡」而唔顯示 hover tooltip；front／back 固定保留
  音標 slot；答案面展示英文、音標 slot、圖示＋「發音」及 soft definition panel，中文意思 hierarchy 加強，
  卡內重複 keyboard／swipe copy 移除，rating actions 保持卡外同寬。
- desktop 1200×672／mobile 390×844 local visual smoke 及 computed layout check 通過：卡片分別為 `416×496`／
  `342×520`，mobile `scrollWidth = 390`，提示順序、答案 panel、底部 actions 均無 overflow。
- 驗證：`npm test` 126 passed；lint、typecheck、diff check、build（43/43 static pages）passed；V2
  `test:e2e:study-stream-v2` 7 passed；V1 `study-card-fidelity` 8 passed／1 skipped；WordCard 320px／390px
  fixtures 4 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、
  research telemetry／consent 或 ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-019 Learning Card geometry／Objective Probe continuation evidence

- 只改 V2 card geometry、提示預留位及既有 `FEEDBACK_ACK` continuation trigger；retrieval／scoring／server feedback、
  outbox、locale／theme、reduced-motion、V1 rollback 及所有 external gate 保持不變。
- 「認」框以 quarter-circle 可見區對中；front DOM 順序改為英文 → 音標 slot → 思考提示 → 發音，資料缺 phonetic 時仍保留
  固定 slot；secondary long-press hint 固定 `52px` 高度並只用 opacity／transform 漸進顯示，避免既有文字 y 位移。
- Objective Probe 移除「確認」／「我看到了，繼續」button，改為「輕點一下任意區域」；read-only feedback 卡面 click、Enter／Space
  都觸發原有 `FEEDBACK_ACK`，同步中／blocked 時維持不可繼續。
- 驗證：`npm test` 126 passed；lint、typecheck、diff check、build（43/43 static pages）passed；V2
  `test:e2e:study-stream-v2` 7 passed（包括 mark alignment、phonetic placement、no-layout-shift、feedback click-anywhere）；
  WordCard 320px／390px fixtures 4 passed；V1 rollback `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`
  Chromium 73 passed／4 skipped，WebKit shard 1 17 passed、shard 2 16 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、研究資料／consent、
  ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-020 Objective Probe color-only feedback affordance evidence

- I-020 只改 Objective Probe answered-state presentation：correct／wrong／dim 顏色保留喺四個選項及字母圓章，移除可見
  `quiz-result`、答對／答錯結果文案及 `study-stream-feedback-hint`；固定 `64px` 空白 slot 內只於 answered state 漸進顯示
  `48px` 半透明呼吸圓形，週期 `4.8s`，reduced-motion 轉為靜態可見。
- 卡面 click、Enter／Space 仍觸發既有 `FEEDBACK_ACK`；同步／disabled 狀態不可繼續；非視覺 `aria-live` 及 continuation
  role／label 保留，視覺上不再增加任何文字提示；option state、affordance visibility／motion、無 result／hint 及 click continuation
  已加入 V2 e2e 斷言。
- 驗證：`npm test` 126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build` compiled／43/43
  static pages generated；`npm run test:e2e:study-stream-v2` 7 passed（locale／dark／reduced-motion 覆蓋）；V1 rollback
  `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` Chromium 73 passed／4 skipped，WebKit shard 1 17 passed、shard 2 16 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、研究資料／consent、
  ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-021 Learning Card swipe feedback placement evidence

- 使用者指出左右 swipe feedback badge 同 A1／category metadata 重疊；I-021 只將 `.word-card-drag-badge` `top` 由 `72px` 調整至 `96px`，移除 narrow viewport `56px` override，保留 swipe／release／locale／theme／rollback semantics。
- V2 e2e 於 flip transition 完成後驗證左右 badge 均避開 back-face level／category metadata 至少 `3px`；320px／390px WordCard fixtures 同樣驗證兩個 badge，並保留 dark reduced-motion visible-face coverage。
- 驗證：`npm test` 126 passed；lint、typecheck、diff check、build（43/43 static pages）passed；`npm run test:e2e:study-stream-v2` 7 passed；WordCard fixtures 4 passed；V1 rollback `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` Chromium 73 passed／4 skipped，WebKit shard 1 17 passed、shard 2 16 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、研究資料／consent、ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-022 CI failure／V2 ledger bridge incident (completed)

- `Study quality gate` run 26（`3031afd`）喺 V2 stream integration assertion 失敗：同一 fresh user 嘅 objective answer
  replay 已正確回傳 `duplicate: true`，但 `ReviewEvent` count 係 2 而唔係 1。
- Root cause 已定位為 ordinary expand migration 仍有 `Review_capture_legacy_event` trigger；V2 objective answer 寫入 `Review`
  時未設定 `app.review_event_writer=v2`，所以 legacy bridge event 同 explicit V2 objective event 同時落 ledger。local 20-run soak
  已通過，但 local contract cleanup 狀態唔能代表 CI ordinary-migration 狀態。
- 修正只會重用既有 writer guard；唔改 schema／migration、唔執行 `npm run db:contract`、唔改 V1／rollback semantics。完成證據需包括
  ordinary-migration integration、bounded soak、V2 browser、V1 rollback regression 及新 push 後 GitHub quality gate；production／pilot／research／
  consent gates 仍 deferred。
- 本地 ordinary temporary schema（24 ordinary migrations、legacy bridge 保留）重播後 V2 integration 通過，並新增 `eventKind=REVIEW`／
  operation identity assertion；unit 126 passed、lint／typecheck／migration checksum、V1 ledger DB regression、20/20 bounded soak、V2
  browser 7/7、fresh-fixture V1 rollback Chromium 73 passed／4 skipped、WebKit 17+16 passed 及 build 43/43 均通過。第一次使用舊本地帳戶
  嘅 V1 run 有 4 個 queue fixture failures，已以明確 temporary student 重跑全數通過；第一次 V2 badge assertion 為單次 animation sampling
  flake，isolated／full rerun 通過。新 commit `f1ccc92` 觸發 GitHub `Study quality gate` run 27，job
  `94714925771` 於 2026-08-14 08:32 UTC 以 `success` 完成；P-018 現已完成。

### 2026-08-14：I-023 Learning Card metadata alignment (completed)

- 使用者要求將左上 A1／Numbers 0 to 100 badge 上移至同右上 stylized「認」標記視覺中心水平線。
- `.word-card-top > .level-badge` 只作局部垂直位置調整；320px／390px fixture 4 passed，V2 study stream 7 passed，V1 desktop／mobile card fidelity 8 passed／1 skipped。
- 無 schema／migration／contract／production／pilot／research scope change；external gates 仍按原計劃 deferred。

### 2026-08-14：I-024 首頁／統計進度範圍與導航修正 (completed)

- 首頁 library projection 改為只計目前已解鎖單元；卡片標題直接標示「已解鎖內容進度」，並在同一位置提供「詳細統計」入口，原有詞表入口保留。
- 統計 API／頁面保留已解鎖內容總覽，另按 A1／A2／B1／B2 顯示每級詞數、已學、長期掌握百分比及「已解鎖／未解鎖」狀態；解鎖規則、SM-2 口徑及排行榜／教師端查詢不變。
- 帳戶選單預設文案由 canonical 簡體來源「回到首页」轉換為繁體顯示「回到首頁」，簡體 locale 顯示「回到首页」。
- 必要驗證：`npm test` 127 passed；指定檔案 `npm run lint` passed；`npx tsc --noEmit` passed；`git diff --check` passed。
- 無 schema／migration／contract change，未執行 contract migration、production deploy、browser E2E／build、真實學生 pilot 或 research／consent gate；以上 external gates 仍 deferred。

### 2026-08-14：I-025 共用進度條填色修正 (completed)

- 根因係 `.ui-progress-value` 使用 inline `<span>`，React 已正確輸出 `width: 71%`，但 inline 元素唔會套用寬度，所以畫面只見百分比文字而無填色。
- 共用 CSS 加上 `display: block`；首頁同統計頁均沿用同一 `ProgressBar`，因此兩處一併修正。百分比計算、已解鎖 scope、SM-2、學習流程及 rollback semantics 不變。
- 必要驗證：`npm run lint` passed；`npx tsc --noEmit` passed；`git diff --check` passed；CSS diff review 確認 `display: block` 已存在。
- 無 schema／migration／contract change，未執行 production deploy、browser E2E、真實學生 pilot 或 research／consent gate；以上 external gates 仍 deferred。

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
