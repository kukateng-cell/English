# Retrieval-first 教育研究框架計劃

> 類型：Research Governance／Telemetry／Experiment Readiness Plan
> 狀態：待審批（暫緩；未啟動，research feature off）
> 計劃方向：只保留未來方向；研究收集／exposure／pilot 未獲正式外部批准，唔屬目前工作
> 父文件：[retrieval-first-learning-program.md](./retrieval-first-learning-program.md)
> 術語規範：[retrieval-first-learning-contract.md](./retrieval-first-learning-contract.md)
> 產品依賴：穩定嘅 Learning Stream operational encounter contract
> 目前產品快照：[retrieval-first-v2-current-product-baseline.md](./artifacts/retrieval-first-v2-current-product-baseline.md)

## 一、定位

本文件規劃點樣由可靠嘅 production learning events，逐步建立可以進行教育研究嘅資料
治理、telemetry、diagnostic sampling 及 experiment gate。佢唔將一般產品分析包裝成研究，
亦唔因為技術上可以記錄 event，就假設已取得對未成年學生進行研究嘅合法／倫理基礎。

工作分兩個獨立里程碑：

- **R1 Research-ready telemetry**：permission／assent、privacy、資料品質及 withdrawal 流程可用；
- **R2 Experiment-ready**：有具體研究問題、protocol、power、assignment、preregistration 同
  analysis plan，獲另行批准先開始。

Product rollout 唔依賴 R1／R2；research ingestion／upload 失敗亦唔可以阻塞學習。

截至 2026-08-15，使用者選擇先結案本地產品基線，暫不進行 pilot、研究資料收集或
experiment。下列 checklist 全部保持未完成；後續 AI 唔可以因產品 V2 已完成而自行建立
research schema、開啟 telemetry、安排 diagnostic exposure，或者假定倫理／家長／學生同意。

## 二、研究目標

- 分析主觀「想起了／未想起」同之後客觀認讀表現嘅校準關係；
- 描述詞彙、單元、年級或 cohort 層面嘅 objective recognition 弱點；
- 測量不同 retrieval／spacing／feedback policy 對延遲 objective recognition 嘅影響；
- 區分 active interaction time、等待／隱藏時間及網絡延遲；
- 保存 exposure／selection context，避免將 adaptive sample 當成全體詞彙隨機樣本；
- 令分析可重現、可撤回、可 audit，而唔暴露日常 production credential 或直接身份資料。

## 三、非目標

- 唔宣稱 MCQ objective recognition 等同自由回憶、拼寫產出或長期 mastery；
- 唔用單次錯誤、反應慢或 self-rating 差異標記作弊、能力固定或懲罰學生；
- 唔喺 R1 自動隨機化學生到實驗條件；
- 唔將 raw research telemetry 直接提供排行榜、教師懲罰或即時個人化；
- 唔為「多收資料」而記錄 free text、password、token、nonce、credential、完整 IP 或
  無關裝置 fingerprint；
- 唔用 retrospective sample-size justification 取代預先 power／precision planning。

## 四、概念及資料邊界

| 類別 | 目的 | 是否所有學生都有 | 失敗可否阻塞學習 |
|---|---|---:|---:|
| Operational StudyEncounter | sync、resume、scheduler、support、產品統計 | 是 | 必要 action 可以 |
| V2 Objective ReviewEvent | SM-2、mastery、進度嘅 scored ledger | 合資格 operational-purpose objective answer | 合法提交時可以 |
| Aggregate product metric | production health／UX | 按現行私隱政策 | 否 |
| ResearchEncounter | consent-gated 分析單位 | 否 | 否 |
| ResearchInteractionEvent | event timing／interaction trace | 否 | 否 |
| ExperimentAssignment | 已批准 protocol 嘅 treatment record | 只限合資格參與者 | 否 |

Operational row 唔會因研究 opt-out 而刪除本來為提供服務所必需嘅內容；research copy／link
就必須按 withdrawal policy 停止新收集、撤回或去連結。兩者 retention 同 access role 分開。

## 五、治理及倫理進入條件

R1 開始任何 participant-level research telemetry 前，必須完成：

- [ ] 指定研究負責人、data controller／custodian、技術維護及 incident owner；
- [ ] 確認適用法規、學校政策、倫理／IRB 等正式審批需要，保存批准編號／版本／期限；
- [ ] 家長／監護人 permission 流程，以及符合年齡、易理解、非強迫嘅學生 assent；
- [ ] 學生明確 dissent／withdrawal 凌駕 guardian permission；無當前 assent 就唔收研究資料、
  亦唔施加 research-only sentinel／treatment exposure；
- [ ] 參與／拒絕唔影響正常教學、分數、解鎖或可用功能；
- [ ] 說明收集項目、用途、風險、保存期、分享／發表、撤回限制及聯絡方法；
- [ ] role-based access、audit log、retention／deletion、breach response、data export policy；
- [ ] 第三方服務／跨境傳輸評估；無批准前唔上傳外部 analytics vendor；
- [ ] protocol／consent version pinning，過期後停止新研究收集或重新取得同意。
- [ ] 建立 data-class disposition matrix，逐項列 identity link、client offline queue、raw event、
  derived table、analysis extract、已發 export、publication aggregate、backup 嘅保存期、起算點、
  刪除／去連結方式、不可追回例外及責任人。

本計劃唔提供法律結論；正式 pilot 必須由有權限嘅人按實際司法管轄及機構程序批准。

## 六、研究資料模型（概念）

Exact schema 要喺 R1 實作計劃再定，最低責任如下：

### ResearchParticipant

- pseudonymous research ID；
- eligibility、permission／assent status 及 version；
- cohort／strata 只保存研究必需範圍；
- withdrawal／data disposition timestamp；
- identity link 放喺更高權限、獨立保護嘅映射，唔進分析 export。

### ResearchAppSession

- participant、flow／policy／UI version、locale、device class（粗粒度）；
- client monotonic time origin metadata、visibility／focus summary；
- operational StudySession 只用 pseudonymous／opaque reference 連結。

### ResearchEncounter

- item／word research key、item kind、probe purpose、selection reason／candidate-state evidence、
  selection probability（可得時）；
- exposure history summary、condition／assignment、eligible／visible／answer timestamps；
- self-rating、first objective response、correctness、flow／quality／item-construction version；
- research event completeness／late-arrival flags。

### ResearchInteractionEvent

- allowlisted event kind、monotonic offset、minimal interaction fields；
- batch／sequence ID、idempotency key、client／server receive time；
- 不保存 raw pointer path、keylogging、free text 或 credential。

## 七、時間及 event contract

- client interaction duration 使用 `performance.now()` 等 monotonic clock；wall-clock 只作對齊。
- 分開記錄 request sent、server received、response、item actually visible／interactive；唔用 API
  response time 當學生開始睇題時間。
- tab hidden、window blur、screen locked／長 idle 從 active time 排除或另行標記。
- 每個研究 event 有 deterministic idempotency key；離線 batch 重送唔重複計數。
- event 可以遲到，但 data lock 前按預定 watermark／late-arrival rule 處理。
- telemetry queue 有硬容量、TTL 同 drop policy；queue 滿或 upload 失敗只記 aggregate health，
  唔阻止下一張卡。
- event schema、UI build、learning policy、flow、experiment version 全部保存。
- operational `first response` 係 server 第一個 accepted commit；research 如分析人類點選先後，
  另存 allowlisted client first-selection monotonic offset、late／cross-device conflict flag，唔將佢
  冒充 authoritative scored order。

## 八、Adaptive selection 偏差及 diagnostic 設計

Learning scheduler 會優先選弱詞、到期詞及 obligations，所以一般 stream accuracy 唔係學生
全部詞彙能力嘅無偏估計。所有分析最少保存／考慮 `selectionReason`、eligibility set 或其摘要、
近期 exposure 同 policy version。

Diagnostic 必須先分兩類：`OPERATIONAL_DIAGNOSTIC` 只可為服務品質／公平性產品目的，
`RESEARCH_DIAGNOSTIC` 係純研究 exposure，必須同 telemetry 一樣受 server-side eligibility、
有效 permission、當前 assent、approved protocol/version 及獨立 kill switch 約束。拒絕／撤回者
既唔收 event，亦唔會出 research-only item；後者預設唔寫 ReviewEvent、SM-2、unlock、
leaderboard 或 remediation。

若要回答「邊啲詞整體最弱」或跨 cohort 比較，R1 要加入獨立 diagnostic／sentinel 設計：

- 從明確 sampling frame 分層抽詞，覆蓋難度、單元、頻率／詞性等預先指定 strata；
- diagnostic 頻率有上限，唔顯著破壞正常學習體驗；
- sampling probability／weight 可重現；無法取得 probability 時唔作無偏 population claim；
- sentinel exposure 同 adaptive remediation 要有時間隔離，避免剛教完即測造成污染；
- 未答／退出同答錯分開；報告 missingness、coverage 同 uncertainty；
- diagnostic 結果可回饋正常學習前，要另作產品／公平性 review，避免研究改變觀察對象。
- self-rating calibration 另抽一個唔依 rating 值決定是否驗證嘅 sentinel subsample，預先固定
  pairing window、第一個合資格 probe、未答處理及 sampling weight；正常 adaptive 配對另行報告。

## 九、研究問題到 outcome 嘅對應

| 研究問題 | 建議 primary measure | 重要限制／covariate |
|---|---|---|
| self-rating 是否校準 | rating 與後續 first-response objective recognition | delay、word、exposure、selection |
| 邊類詞較弱 | stratified diagnostic accuracy／uncertainty | sampling weight、cohort coverage |
| retrieval policy 有冇幫助 | 預先 delay window 嘅 objective recognition | baseline、assignment、attrition |
| engagement 有冇改變 | active encounters、valid active time、return | 唔以總開頁時間代替 |

若 primary construct 需要自由回憶或拼寫，必須另訂 probe contract；唔可以將現有 MCQ rename
成 recall test。

## 十、R1：Research-ready telemetry checklist

### R1.1 Protocol-lite 及 governance

- [ ] 定義最少研究問題、資料字典、purpose limitation、retention 及 access matrix；
- [ ] 完成 Section 5 全部批准；
- [ ] consent／assent／withdrawal UX 通過學生、家長及 accessibility review；
- [ ] 非參與者、dissent／撤回者、過期 consent 嘅 server exposure／ingestion tests fail closed；
- [ ] withdrawal 即時撤銷 research upload capability、purge client offline research queue，
  server 拒絕撤回後遲到 batch，並按 disposition matrix 追蹤 derived／export／backup 處理。

### R1.2 Technical foundation

- [ ] 建立 research schema／service account／role boundary，唔共用 production credential；
- [ ] operational-to-research adapter 只複製 allowlisted、合資格、已 consent reference；
- [ ] client event queue bounded、idempotent、non-blocking、可觀察 drop／late events；
- [ ] `performance.now()`、visibility、visible-start、answer timing contract tests；
- [ ] export 以 pseudonymous ID，small-cell／re-identification risk 有處理規則。

### R1.3 Diagnostic 及 data-quality pilot

- [ ] 定義 sampling frame、strata、frequency cap、selection probability／weight，同時建立
  不依 self-rating 值抽樣嘅 calibration sentinel subsample；
- [ ] internal／synthetic pilot 驗證 completeness、duplicates、ordering、clock anomalies；
- [ ] limited consented pilot 驗證 missingness、attrition、device／locale coverage；
- [ ] data-quality gate 喺 pilot 前填入數值：event completeness、duplicate、late、unknown version、
  active-time anomalies；
- [ ] withdrawal／deletion／access audit／incident drill 通過；
- [ ] R1 report 記錄可回答及不可回答嘅研究問題。

## 十一、R2：Experiment-ready checklist

每一個正式 experiment 都要另建 `research/protocols/<study-name>.md`（該目錄喺有第一份
已批准 protocol 時先建立），並更新 `plans/README.md`／本計劃連結。Protocol 至少包括：

- [ ] primary／secondary research question、theory、ITT／per-exposure estimand、outcome、delay window；
- [ ] inclusion／exclusion、recruitment、permission／assent、stopping／harm rule；
- [ ] prospective power／precision simulation 使用同實際 assignment、adaptive selection 及分析模型
  一致嘅 data-generating process；列明 student／word crossed clustering、ICC／design effect、
  scheduler-induced missing outcome、multiple testing；
- [ ] assignment unit（預設 participant × word 或研究理由支持嘅其他 unit）、strata／block；
- [ ] deterministic server-side HMAC assignment、allocation concealment、balance audit；
- [ ] contamination、spillover、carryover、compliance、learning exposure、attrition、
  scheduler-induced missingness 同 post-treatment selection handling；
- [ ] 分析模型處理 participant 內重複、word 內相關（crossed random effects／cluster-robust
  或 protocol 證明嘅等價方法）；
- [ ] preregistration／timestamped protocol、code／analysis version、data lock；
- [ ] pilot／A-A test、randomization validation、kill switch、incident owner；
- [ ] publication／sharing、small-cell、de-identification 及 reproducibility package。

只有 deterministic hash 唔保證樣本 balance；要配合 blocking／stratification 同 pre-treatment
balance audit。Assignment 一經 exposure 就不可因 outcome 或裝置切換重抽。

## 十二、測試及驗證矩陣

| 範圍 | 必須證明 |
|---|---|
| Consent | opt-out 零 research event；version expiry；withdrawal；正常學習無影響 |
| Privacy | allowlist、RBAC、audit、pseudonymous export、retention／deletion、small-cell |
| Event quality | idempotency、offline batch、ordering、visibility、active time、late／drop |
| Selection | reason／probability、diagnostic strata、sampling weights、coverage |
| Assignment | reproducibility、balance、no reroll、cross-device consistency、A-A |
| Analysis | frozen outcome／delay、missingness、exposure、policy version、data lock |
| Resilience | research DB／network unavailable 時 product action 正常完成 |

按實作範圍最少執行；另由 R1 實作新增 research ingestion／privacy／withdrawal test suite：

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:db
npm run test:migrations
npm run test:migration-checksums
npm run check:production-config
npm run build
```

涉及 browser consent／offline queue／normal-learning isolation 時要加入相應 Playwright E2E；
未執行嘅外部審批、資料刪除 drill 或高成本測試必須明確記錄。

## 十三、Rollout 及 kill switch

1. schema／ingestion deployed but global research collection disabled；
2. synthetic events 驗證；
3. internal test accounts；
4. small consented telemetry pilot（R1）；
5. 通過 privacy／data-quality gate先擴大 telemetry；
6. 每個 R2 experiment 另有 flag、cohort、protocol 同 kill switch。

Kill switch 停止新 research collection／assignment，但唔停止 Learning Stream。已收資料按 approved
incident／withdrawal／retention policy 處理，唔因關 flag 任意刪除或繼續使用。

## 十四、風險

| 風險 | 緩解 |
|---|---|
| 未成年參與者被默認納入 | explicit permission + assent、server eligibility、opt-out tests |
| adaptive selection 造成錯誤弱點排行 | diagnostic sampling、probability／weight、uncertainty |
| telemetry 影響效能／學習 | separate bounded queue、batch、non-blocking kill switch |
| 反應時間混入網絡／hidden time | visible-start、monotonic clock、visibility／idle rules |
| hash assignment 不平衡 | stratified／blocked assignment、balance audit、A-A pilot |
| 研究指標反過來懲罰學生 | purpose limitation、access controls、禁止直接 operational use |
| export 被重新識別 | pseudonymization、coarse fields、small-cell rule、access audit |

## 十五、決策及未決事項

| ID | 決策／問題 | 目前取向 | 收斂 gate |
|---|---|---|---|
| R-001 | Operational diagnostic vs research sentinel | purpose 明確分開；research-only 零 operational 副作用 | Contract 已納入；R1 tests |
| R-002 | Research exposure eligibility | permission + current assent + protocol/version + flag；dissent 優先 | governance approval |
| R-003 | Withdrawal disposition | queue、raw、derived、export、backup 分類處理 | R1 前完成 matrix |
| R-004 | Calibration bias | 建立不依 self-rating 值嘅 sentinel subsample | R1 diagnostic design |
| R-005 | Experiment assignment unit | participant × word 只係預設候選，protocol 要以 contamination／power 證明 | 每份 R2 protocol |
| R-006 | Exact retention／small-cell／backup exception | 唔喺無治理資料時虛構日數 | R1 ethics／privacy approval |

R-002／R-003 未獲正式批准前，research collection 同 research-only exposure 必須保持關閉。

## 十六、Definition of Done

### R1 complete

- [ ] governance、permission／assent、privacy、retention、withdrawal 全部獲批准並驗證；
- [ ] telemetry non-blocking、idempotent、versioned，而且非參與者無研究 event／exposure；
- [ ] offline queue、raw／derived／export／backup disposition matrix 同 withdrawal drill 通過；
- [ ] diagnostic／selection bias contract 及 data-quality pilot 通過；
- [ ] 可回答／不可回答嘅推論邊界已寫入研究資料字典；
- [ ] 實際測試、未執行項目、已知限制及 incident drill 已記錄。

### R2 complete

- [ ] 至少一份具體 protocol 完成 Section 11 並獲正式批准；
- [ ] preregistration、power、assignment validation、data lock、kill switch 已驗證；
- [ ] experiment 尚未獲批准時，本框架可以 R1 complete／R2 deferred 狀態結案，並由新計劃接手。

## 十七、實際驗證紀錄

### 2026-08-12：Product handoff boundary

本次只交付 operational Retrieval-first V2；沒有新增 research schema、telemetry、sentinel
exposure、研究 assignment 或資料收集。研究 feature flag 保持關閉，未參與者不會因本次
product flow 取得 research-only exposure。R1／R2 的倫理、privacy、家長 permission、
學生 assent、retention、withdrawal、pilot 及 protocol gate 全部仍待正式批准，不能以本次
product 測試代替。
