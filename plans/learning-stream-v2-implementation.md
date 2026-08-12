# Learning Stream v2 實施計劃

> 類型：功能／跨頁面 UI／核心學習流程實施計劃
> 狀態：進行中
> 父文件：[retrieval-first-learning-program.md](./retrieval-first-learning-program.md)
> 規範：[retrieval-first-learning-contract.md](./retrieval-first-learning-contract.md)
> 安全依賴：[study-credential-v2-migration.md](./study-credential-v2-migration.md)

## 一、背景

現有 `/study` 已包含可用嘅 WordCard gesture、checkpoint、study session、nonce、
`operationId`、離線 outbox、跨裝置 reconciliation、完成頁及客觀 quiz。呢啲係可保留
資產，但目前頁面、queue、assessment 及 sync 責任耦合，而且流程圍繞固定一輪完成。

外部 `emm_design_02` prototype 提供 Learning Card 視覺、tap reveal、左右滑文案及
Objective Probe 呈現參考；當中寫死 `1/13`、完成頁及每三次 retrieval 立即 quick check
只屬 demo，唔係 production scheduler contract。

本計劃負責將已批准 Contract 落實為可漸進發佈嘅 Learning Stream v2，唔喺同一階段
加入正式 research experiment。

## 二、目標

- Global `/study` 轉為 continuous stream，每個 acknowledged item 都可安全停止；
- 抽出現有 motion engine，建立 Learning Card／Objective Probe 清晰 component 邊界；
- server 逐項選擇 item，client 唔預先決定 verification 或 score；
- operational actions 保留 one-time credential、idempotency、transaction、retry、outbox；
- v1 同 v2 由 server assignment 共存，並可只關 flag rollback；
- Unit mode 保留 bounded scope／summary，但採用同一 interaction／evidence contract；
- 現有 dashboard、progress、achievement、leaderboard 只消費正確定義嘅 objective ledger。

## 三、非目標

- 唔改品牌、token 或全站資訊架構；
- 唔用 client state 取代 server-issued study session；
- 唔以 self-rating 更新 SM-2、mastery、unit unlock 或排行榜；
- 唔喺本計劃建立研究 participant、consent、experiment assignment 或研究匯出；
- 唔一次過刪除 v1 route、欄位或 checkpoint；
- 唔以 production 頁面作第一個 state-machine 試驗場。

## 四、依賴及進入條件

- Contract v1 gesture、evidence、quality mapping、debt invariant 已批准；
- design handoff 固定 commit／export date、asset hash、state manifest 同 intentional deviations；
- Credential v2 expand／coexistence 設計已通過 review；
- 現有 `/study` happy path、offline、cross-device、pointer motion regression 有基線結果；
- feature assignment 可以喺 server 端按 internal account／cohort 固定 `flowVersion`。

## 五、目標架構

### 5.1 責任分層

| 層 | 責任 | 唔可以做 |
|---|---|---|
| Learning policy | 選 item、admit obligation、mapping version、selection reason | 讀 React state |
| Study action service | 驗 credential、idempotency、判分、transaction、next cursor | 信任 client score／word ID |
| Stream controller | prefetch、狀態轉換、outbox、authoritative reconciliation | 自行排程或計算 SM-2 |
| Presentation components | motion、tap、swipe、options、feedback、a11y | 直接寫 DB／leaderboard |
| Operational projection | dashboard、progress、unit、streak | 將 self-rating 當 objective |
| Research adapter | consent-gated 複製合資格 operational reference | 阻塞 action acknowledgement |

### 5.2 建議檔案邊界

實作前按現況確認命名；預期分拆為：

```text
src/app/(student)/study/             route／server bootstrap
src/components/study-stream/         controller 及 presentation
src/lib/learning-policy/              pure selection／mapping／simulation
src/lib/study-actions/                credential validation／transaction
src/lib/study-checkpoint/             v1／v2 versioned resume
src/lib/study-outbox/                 durable operational action queue
```

保留 WordCard 中已驗證 motion primitives，逐步抽取，唔先重寫動畫數學再接 API。

### 5.3 Item envelope

Client-visible item 至少包含：

- 唯一 client-facing opaque `streamItemId`、`kind`、`flowVersion` 同 version bundle；
- prompt／answer presentation（Learning Card）或者 shuffled opaque options（Probe）；
- opaque one-time action credential／expiry、evidence target／probe purpose（可顯示必要部分）、
  server revision、accessible labels；
- presentation hints，例如 direction labels、motion variant；
- 唔包含 `correctOptionId`、SM-2 quality、任意可提交 word ID 或 obligation owner。

Exact payload 由實作時以 TypeScript schema 同 route contract tests 固定；本文件唔將
示意欄位當成已存在 API。

## 六、狀態及資料流

### 6.1 Bootstrap／next item

```text
server resolves learner + mode + assignment
→ create／resume version-pinned StudySession
→ recover leased item or select next item
→ issue canonical stream-item credential
→ render first item + small bounded prefetch metadata
```

### 6.2 Action

```text
input intent
→ freeze duplicate input
→ append operational outbox action
→ POST action with operationId + item credential
→ server validates lineage／kind／revision
→ Serializable transaction commits encounter／review／obligation／cursor
→ authoritative response removes outbox entry
→ controller enters feedback／next item
```

Network failure 保持 `RETRYABLE_SYNC_BLOCKED`；可以顯示離線提示及離開，但唔可以將未
acknowledged item 當完成並發另一個會破壞次序嘅 scored action。

### 6.3 API 邊界

預期新增 versioned route（exact path 喺 Phase 1 決定）：

- `GET /api/study/stream`：bootstrap／resume／next item；
- `POST /api/study/actions`：reveal（如需 durable）、self-rating、probe answer 等 typed mutation；
- leave／resume telemetry 只可 best-effort／non-blocking；學生離開權唔依賴成功 POST，authoritative
  resume 由已 acknowledged item／checkpoint pointer 推導；
- `POST /api/study/sessions/renew`：只按合法 stream-item lineage reissue credential。

若沿用現有 route，仍要以 `flowVersion` 做明確 schema dispatch，唔准接受 v1/v2 混合 payload。

## 七、分階段 checklist

### Phase 0：Handoff、基線及契約凍結

- [x] 建立本 Phase 唯一擁有嘅
  `plans/artifacts/learning-stream-v2-handoff-addendum.md`，記錄 repo branch／commit、prototype
  commit／export、asset hashes、state inventory 及 precedence；
- [x] addendum 具名覆蓋原 handoff 中固定進度、完成頁、每三張 quick check、demo scoring 等
  behavior，但保留原 handoff 作 presentation／motion reference；
- [x] Contract／Program 只以 gate 引用 addendum，唔另建重複 checklist；
- [x] 跑現有 unit／lint／typecheck／card-motion 基線並保存結果；
- [x] 將 Contract 參數同 API 未決項目收斂，獲批准先進 Phase 1。

### Phase 1：Pure policy、state machine 及 isolated harness

- [ ] 建立 typed item／action／transition，非法 transition fail closed；
- [x] 建立 pure scheduler policy interface、quality mapping 同 deterministic fixtures；
- [x] 用 deterministic 長序列模擬 combined cap、per-word dedupe、eligible delay、
  active-user liveness、long absence、reopen gaming、mode switching、lease、remediation、no-candidate；
- [ ] 由 Serializable transaction／integration tests 證明 atomic admission 同並發 cap protection；
- [ ] 抽取 WordCard motion primitive，建立不接 production API 嘅 harness；
- [ ] 完成 Learning Card／Objective Probe／Feedback／SyncBlocked components；
- [ ] 測試 mouse、touch、synthetic pointer、keyboard、reduced motion、簡繁、明暗 theme。

### Phase 2：Operational API 及 Credential v2 integration

- [ ] 完成 Credential v2 expand schema／generated client／legacy compatibility；
- [ ] 建立 version-pinned session bootstrap 及 server-side assignment；
- [ ] 實作 item selection／lease／obligation admission／remediation transaction；
- [ ] 實作 evidence target／expected Review revision、probe purpose、immutable question snapshot、
  item-validity fail-closed、answer scoring及 ReviewEvent provenance／quality mapping；
- [ ] `operationId` 重送回相同 authoritative result；
- [ ] 所有 route 使用現有 authorization helper、rate limit 同 typed validation；
- [ ] production 不可用 shared rate-limit storage 時仍然 fail closed。

### Phase 3：Global stream internal integration

- [ ] controller 接上 v2 API，只對 internal／test accounts 開啟；
- [ ] outbox 改用 stream-item action，支援 retry、rotation、authoritative supersession；
- [ ] checkpoint v2 只保存安全 opaque pointer／revision／minimal presentation state；
- [ ] global UI 移除固定 denominator／強制 done；加入合法 leave／resume；
- [ ] dashboard／streak／achievement／leaderboard／unit projection 通過 metric audit，legacy
  unknown 同 V2 objective-recognition 分欄／分 denominator；
- [ ] event／log allowlist 唔洩露 credential、nonce、正確答案或直接身份資料。

### Phase 4：Unit mode 及 reliability gate

- [ ] Unit mode 使用同一 item/action contract，只限制 candidate scope；
- [ ] unit summary 只陳述 coverage／objective evidence，唔將右滑當掌握；
- [ ] refresh、offline、storage unavailable、outbox corruption 有明確恢復體驗；
- [ ] cross-tab 同 cross-device race 只產生一個合法結果；
- [ ] session expiry／rotation／revocation／tokenVersion change 可恢復或安全終止；
- [ ] answered probe、expired lease、stale checkpoint 唔會重現為新可答題；
- [ ] answered probe 未確認 feedback 時，resume 一次 read-only authoritative feedback；
- [ ] migration、production config、build、card-motion E2E、rollback rehearsal 通過。

### Phase 5：Pilot 及 rollout

- [ ] 建立 cohort assignment、exposure log、support runbook、kill switch；
- [ ] internal soak 無 high／critical defect；
- [ ] 小比例學生 pilot，監察 sync、duplicate、latency、leave、debt size／age；
- [ ] 按預先定義 threshold 擴大、暫停或 rollback；
- [ ] 全量後保留 v1 observation window，另開 contract cleanup review；
- [ ] 更新 project plan 現況、實際測試、已知限制及後續工作。

## 八、測試矩陣

| 類別 | Cases | Gate |
|---|---|---|
| Pure policy | combined debt／liveness、purpose side effects、quality、construction validity、mode scope | Phase 1 |
| Component | reveal gating、swipe threshold／cancel、probe single-select、feedback、a11y | Phase 1 |
| API | auth、payload kind、nonce、expiry、idempotency、wrong option、concurrency | Phase 2 |
| Transaction | first answer、global operation receipt、兩 session 同 target／Review revision、lease、retry | Phase 2 |
| Projection | self-rating 零 mastery effect；objective event 正確更新現有 projection | Phase 3 |
| Resume | refresh、offline replay、checkpoint v1/v2、rotation、cross-device | Phase 4 |
| Browser | mouse、emulated touch、synthetic pointer、完整登入學習流程 | Phase 4 |
| Production | lint、typecheck、unit、build、production config、migration suites | Phase 4 |

按改動範圍最少執行：

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

高成本／需外部服務項目如未執行，必須記錄原因，唔可勾選相應 gate。

## 九、Observability 及 pilot threshold

發佈前要先建立 dashboard／alert，至少覆蓋：

- action success／retry／conflict／stale credential rate；
- outbox oldest age、sync-blocked sessions、checkpoint recovery failure；
- scheduler no-candidate、debt cap hit、oldest obligation age、consecutive probes；
- p50／p95 next-item latency、client render error、abandonment point；
- first-response accuracy、remediation rate（只作 aggregate health，唔作個人懲罰）。

Go／pause／rollback 數值要喺 pilot 前用基線及 internal soak 寫入 runbook；未有基線前
唔喺本計劃虛構固定百分比。

## 十、發佈策略

1. deploy expand schema，同時保持 v1 默認；
2. internal accounts pinned v2；
3. small cohort server-side assignment，session 建立後唔中途轉 flow；
4. cohort 擴大只喺 reliability gate 同 metrics 維持健康時進行；
5. 全量後 observation window 完成，先考慮移除 legacy contract。

Research telemetry 使用獨立 flag；Product rollout 唔等待 research experiment。

## 十一、Rollback

- 關閉新 v2 assignment，唔做 destructive schema downgrade；
- 已存在 v2 session 按 incident severity：容許完成、server retire 並安全重開，或撤銷；
- pending outbox action 先由 server 查 authoritative status，唔直接轉成 v1 word payload；
- objective ReviewEvent 保留；未 scored encounter 唔補造成 ReviewEvent；
- rollback 後驗證 v1 login、study、checkpoint、dashboard、unit、teacher／admin flow；
- incident 後更新本計劃、決策紀錄及 cleanup entry criteria。

## 十二、風險

| 風險 | 緩解 |
|---|---|
| 巨型 study page 再度集中責任 | pure policy、controller、presentation、action service 邊界 |
| optimistic motion 掩蓋提交失敗 | durable outbox、authoritative ack、SyncBlocked state |
| prototype demo 邏輯誤入 production | Phase 0 deviations、Contract tests、review checklist |
| v1/v2 payload 混淆 | flowVersion pin、typed dispatch、route-level fail closed |
| Reliability 太遲處理 | Phase 4 係 pilot 前硬 gate，唔係 rollout 後優化 |
| 計量名稱漂移 | glossary audit + projection tests |

## 十三、決策及未決事項

| ID | 決策／問題 | 目前取向 | 收斂 gate |
|---|---|---|---|
| I-001 | Prototype override artifact owner | Phase 0 建立 `plans/artifacts/learning-stream-v2-handoff-addendum.md` | Phase 0 |
| I-002 | Client item identity | 只公開 `streamItemId`，唔提供 alias | Contract 已定；Phase 1 type test |
| I-003 | Scored 後 feedback resume | 未確認時恢復一次 read-only feedback | Phase 1 state test |
| I-004 | Exact API path：新 `/api/study/stream|actions` 或現 route version dispatch | 已決定使用新 `/api/study/stream`、`/api/study/actions`、`/api/study/sessions/renew`；保留 `/api/study` 作 V1 | Phase 0 |
| I-005 | Reveal 要唔要 operational durable action | self-rating／probe answer 必定 durable；reveal 先保持 presentation state，只有 resume／獨立 operational requirement 才另加 typed durable action | Phase 1 state/data review |
| I-006 | Pilot go／pause 數值 | 唔虛構；用 V1 baseline + internal soak 預先寫 runbook | Phase 5 前 |

未決項目未收斂前唔可以開始其 dependent phase；改變 Contract 語義就先更新 Contract，
唔喺 Implementation plan 偷渡決定。

## 十四、Definition of Done

- [ ] Phase 0–5 checklist 全部完成並有對應證據；
- [ ] Contract acceptance matrix 全部通過；
- [ ] v1 未獲 cleanup approval 前仍可安全使用；
- [ ] production feature flag、runbook、alerts、rollback rehearsal 已驗證；
- [ ] 無 client-controlled word／item／score／correct-answer boundary；
- [ ] 實際測試、未執行項目、已知限制、pilot 結果已記錄；
- [ ] `project-plan.md` 同 `plans/README.md` 已按實際狀態更新；
- [ ] 狀態只喺完成以上驗證後改為「已完成」。

## 十五、實際驗證紀錄

> 尚未開始實作。獲批准開始後先將狀態改為「進行中」。
