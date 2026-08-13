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

本計劃負責將已批准 Contract 落實為可喺本機完整使用嘅 Learning Stream v2。local
product-complete 先於 external rollout；本計劃唔喺同一階段加入正式 research experiment，
亦唔以 production deploy／真實學生 pilot 作 local completion gate。

## 二、目標

- Global `/study` 轉為 continuous stream，每個 acknowledged item 都可安全停止；
- 抽出現有 motion engine，建立 Learning Card／Objective Probe 清晰 component 邊界；
- server 逐項選擇 item，client 唔預先決定 verification 或 score；
- operational actions 保留 one-time credential、idempotency、transaction、retry、outbox；
- v1 同 v2 由 server assignment 共存；local 可明確切換 all-user V2，production 仍可只關
  assignment rollback；
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
- feature assignment 可以喺 server 端按 internal account／cohort 固定 `flowVersion`；local
  另有 non-production-only all-user mode，session 仍然 pin `flowVersion`。

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

- [x] 建立 typed item／action／transition，非法 transition fail closed；
- [x] 建立 pure scheduler policy interface、quality mapping 同 deterministic fixtures；
- [x] 用 deterministic 長序列模擬 combined cap、per-word dedupe、eligible delay、
  active-user liveness、long absence、reopen gaming、mode switching、lease、remediation、no-candidate；
- [x] 由 Serializable transaction／integration tests 證明 atomic admission 同並發 cap protection；
- [x] 抽取 WordCard motion primitive，建立不接 production API 嘅 harness；
- [x] 完成 Learning Card／Objective Probe／Feedback／SyncBlocked components；
- [x] 測試 mouse、touch、synthetic pointer、keyboard、reduced motion、簡繁、明暗 theme。

### Phase 2：Operational API 及 Credential v2 integration

- [x] 完成 Credential v2 expand schema／generated client／legacy compatibility；
- [x] 建立 version-pinned session bootstrap 及 server-side assignment；
- [x] 實作 item selection／lease／obligation admission／remediation transaction；
- [x] 實作 evidence target／expected Review revision、probe purpose、immutable question snapshot、
  item-validity fail-closed、answer scoring及 ReviewEvent provenance／quality mapping；
- [x] `operationId` 重送回相同 authoritative result；
- [x] 所有 route 使用現有 authorization helper、rate limit 同 typed validation；
- [x] production 不可用 shared rate-limit storage 時，login、password-change、study queue／
  action／credential renewal paths 均 fail closed；local browser test 例外由 explicit flag 限定。

### Phase 3：Global stream internal integration

- [x] controller 接上 v2 API，支援 internal／test accounts 及 non-production all-user mode；
- [x] outbox 改用 stream-item action，支援 retry、rotation、authoritative supersession；
- [x] checkpoint v2 只保存安全 opaque pointer／revision／minimal presentation state；
- [x] global UI 移除固定 denominator／強制 done；加入合法 leave／resume；
- [x] dashboard／streak／achievement／leaderboard／unit projection 通過 metric audit，legacy
  unknown 同 V2 objective-recognition 分欄／分 denominator；
- [x] event／log allowlist 唔洩露 credential、nonce、正確答案或直接身份資料。

### Phase 4：Unit mode 及 reliability gate

- [x] Unit mode 使用同一 item/action contract，只限制 candidate scope；
- [x] unit summary 只陳述 coverage／objective evidence，唔將右滑當掌握；
- [x] refresh、offline、storage unavailable、outbox corruption 有明確恢復體驗；
- [x] cross-tab 同 cross-device race 只產生一個合法結果；
- [x] session expiry／rotation／revocation／tokenVersion change 可恢復或安全終止；
- [x] answered probe、expired lease、stale checkpoint 唔會重現為新可答題；
- [x] answered probe 未確認 feedback 時，resume 一次 read-only authoritative feedback；
- [x] migration、production config、build、card-motion E2E、rollback rehearsal 通過。
- [x] CI quality gate 已納入 V2 DB integration／bounded soak 及 student IA／accessibility
  regression；production workflow 仍保持 V2 assignment 關閉，唔將 CI gate 當成正式 rollout。

### Phase 5：Local full cutover（external rollout deferred）

- [x] 建立 internal allowlist、non-production all-user assignment、V2 structured request metric、
  support／incident runbook 及 kill switch；production 對 all-user mode fail closed；
- [x] internal soak 無 high／critical defect；20 次 cleanup-backed V2 integration soak 全部通過；
- [x] local all-user browser／DB／resume／rollback acceptance 通過；
- [x] 按 visual review 修正 V2 Learning Card：卡面任意非發音區域 tap-to-reveal、front／back
  flip presentation、答案面保留英文／音標／中文意思／例句／發音，self-rating actions 移到卡下
  並與卡片同寬；reveal 前不提供 self-rating；
- [x] 學生帳戶名稱及 avatar initial 於 zh-Hant 顯示繁體、zh-Hans 顯示簡體；只改 display layer，
  不改 stored identity；
- [x] 按 I-012 修正 V2 Learning Card：初始先顯示思考提示，約 1 秒後顯示「長按 3 秒揭示答案」；
  只有 stationary long-press 可揭示，低位移／左右拖動／發音 control 不得揭示；揭示後左右掃及
  rating actions 改用「和剛才想的一樣／不一樣」語義；
- [x] 按 I-012 visual feedback refinement 強化兩段提示嘅高亮／呼吸式提示；按住時顯示透明圓圈，
  進度越近 3 秒呼吸越快／越明顯；中途放手、移動或 pointer cancel 必須取消視覺進度並重新由
  3 秒計算；
- [ ] 真實學生 pilot、production rollout、外部 observation window 及 threshold decision（延期，
  唔屬 local product-complete）；
- [x] 更新 project plan 現況、實際測試、已知限制及後續工作。

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
| UI correction | 延遲思考提示及高亮呼吸、stationary long-press 與發音 button 分離、透明按住進度圈及加速提示、低位移／拖動取消／放手重置、flip front／back、卡下同寬 self-rating、答案後一樣／不一樣 swipe 語義、zh-Hant／zh-Hans account display | Phase 5 local correction |
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

### Local delivery

1. local development 以 `STUDY_V2_ASSIGNMENT_MODE=all` 將所有 authenticated account pin 到 V2；
2. session 建立後唔中途轉 flow，V1 仍由 `off`／internal allowlist 保留作 rollback；
3. local browser／DB／offline／cross-device 驗證及後續 UI correction acceptance 通過後，視為
   local product-complete。

### External delivery（deferred）

1. production 仍保持 V1 default／allowlist；
2. 真實學生 pilot、production observation、全量 external rollout 及 legacy contract cleanup
   另行處理，唔阻塞 local product-complete。

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
| I-007 | Cross-tab credential rotation | item 保留 bounded、短效 credential digest lineage；bootstrap／renew 發出 successor 時不撤銷仍有效的 predecessor，action 仍由 item status、operation receipt、target／Review CAS authoritative 決定 | Phase 4 reliability；需 expand migration |
| I-008 | Shared rate-limit backend 故障策略 | production／Vercel production runtime 一律 fail closed；memory fallback 只限非-production local 或明確 `ENABLE_TEST_ROUTES=1` test runtime；login、password change、study queue／action／credential renewal 共用同一 runtime 判定；backend failure log 只記 allowlisted error type，唔記原始 exception／request details | Phase 2 security regression |
| I-009 | V2 CI／release preflight coverage | Study quality workflow 同 production verification job 必須喺 seed 後執行 `npm run test:db:stream-v2` 及 bounded `STUDY_STREAM_SOAK_ITERATIONS=3 npm run check:study-stream-v2:soak`；path filter 覆蓋 V2 source／tests；assignment 仍 deny-by-default | Phase 4 automation gate；唔等同 production deploy／student pilot |
| I-010 | Local full V2 cutover scope | `STUDY_V2_ASSIGNMENT_MODE=all` 只可喺 local development，或明確 `ENABLE_TEST_ROUTES=1` 且無 Vercel environment 嘅 local browser test runtime 啟用；`off` 強制 V1，internal allowlist 保留；Vercel preview／production all-user mode fail closed | Phase 5 local product-complete |
| I-011 | Visual review follow-up：Learning Card reveal／rating placement／account display | 不改 Contract 語義或 server action；V2 card body（排除發音 control）以 tap 揭示並以 one-way front／back flip 顯示答案；self-rating actions 移到卡下同寬 row；學生名稱 display 經 `tc()` 轉換，stored identity 不變；低位移 tap 唔可誤觸 swipe | Phase 5 local UI correction；完成前不得勾選相關 local DoD |
| I-012 | Retrieval pause before reveal | 不改 Contract 語義或 server action；V2 Learning Card 先顯示思考提示，約 1 秒後提示 stationary long-press 3 秒；兩段提示需有清楚但不干擾嘅高亮／呼吸式視覺；按住時顯示透明圓圈並隨 3 秒進度加快／增強；audio button、移動、放手及 pointer cancel 必須取消並重置 reveal timer；reveal 後保留既有 flip／答案面，左右 swipe／rating actions 用「和剛才想的一樣／不一樣」語義 | Phase 5 local interaction correction；visual refinement 完成前不得勾選相關 local DoD |

未決項目未收斂前唔可以開始其 dependent phase；改變 Contract 語義就先更新 Contract，
唔喺 Implementation plan 偷渡決定。

## 十四、Definition of Done

- [x] Local Phase 0–4 及 Local Phase 5 cutover checklist 全部完成並有對應證據；
- [ ] Contract acceptance matrix 全部通過；
- [x] v1 未獲 cleanup approval 前仍可安全使用（V1 DB／browser regression、V1 default 及 feature-off rollback evidence）；
- [ ] production feature flag、runbook、alerts、rollback rehearsal 已驗證；
- [x] 無 client-controlled word／item／score／correct-answer boundary（typed parser、route validation、server-owned scoring 及 DB assertions）；
- [x] visual review follow-up 已通過 card-body reveal、audio exclusion、flip、same-width rating actions、簡繁 account display 及 V1／V2 gesture regression；
- [x] I-012 retrieval pause follow-up 已通過 delayed prompt、3 秒 stationary long-press、movement／audio exclusion、reveal 後 swipe semantics 及 V1／V2 gesture regression；
- [x] I-012 visual feedback refinement 已通過 prompt highlighter／breathing、按住透明進度圈、進度加速、放手重置及 reduced-motion／V1／V2 gesture regression；
- [x] local 實際測試、未執行項目及已知限制已記錄；external pilot 結果仍 deferred；
- [x] `project-plan.md` 同 `plans/README.md` 已按實際狀態更新；
- [ ] 狀態只喺完成以上驗證後改為「已完成」。

External pilot／production／research gates 係 deferred scope，唔會因未執行而阻塞 local
product-complete；但本計劃仍保持「進行中」，直到 local acceptance 證據完成。

## 十五、實際驗證紀錄

### 2026-08-13：Local product-complete V2 cutover evidence

其後 visual review 發現現有 V2 Learning Card 雖然已符合 retrieval reveal gate，但仍以卡下獨立揭示掣、
卡內 self-rating hint 及未轉換嘅學生 display name 呈現；因此新增 I-011 local UI correction
scope。I-011 已按以下證據完成，唔改 learning、evidence 或 server action contract。

其後使用者要求避免學生一見卡便立即揭示答案；因此新增 I-012 interaction correction scope。
I-012 已按以下證據完成；上一輪 I-011 嘅 tap-to-reveal 係 presentation baseline，現行 V2 以
stationary long-press 取代即時 tap，唔改 learning、evidence 或 server action contract。

2026-08-13 使用者再要求 I-012 visual feedback refinement：兩段提示要更突出，按住時要有透明
圓圈呼吸及接近 3 秒時加速嘅進度回饋；以下證據完成後已補齊新增 DoD。

- 新增 `STUDY_V2_ASSIGNMENT_MODE=all`：只喺 local development，或明確
  `ENABLE_TEST_ROUTES=1` 且無 Vercel environment 嘅 local browser test runtime 生效；
  `off` 強制 V1，internal allowlist 保留；Vercel preview／production all-user mode fail
  closed，production configuration check 已驗證。
- 更新共享 `WordCard`：V2 Learning Card 未揭示前隱藏 self-rating affordance、移除不可用
  keyboard shortcut metadata，並以 accessible label 明確提示「請先揭示中文意思」；reveal
  後先顯示左右 self-rating。
- 新增 `study-stream-v2` Playwright project／script；local all-user V2 browser regression
  3/3 passed，覆蓋 assignment、resume read-only feedback ACK、Objective Probe、Learning Card
  reveal gate、self-rating 及下一 item transition。
- I-011 visual correction 以共享 `WordCard` front／back flip、排除發音 control 嘅 card-body
  tap、卡下同寬 self-rating row 及 `tc()` display-layer conversion 完成；
  `npm run test:e2e:study-stream-v2`：4/4 passed，覆蓋 audio exclusion、中文答案／例句、
  back-face 發音、flip 後先出現兩個 rating actions、同寬及非卡內 nesting，並逐一驗證
  `zh-Hant`／`zh-Hans` account heading／avatar display。
- I-012 interaction correction 已以共享 `WordCard` 嘅 delayed prompt、3 秒 stationary
  long-press、movement／pointer cancel、發音 control exclusion 及答案後「和剛才想的一樣／不一樣」
  labels 完成；重新執行 `npm run test:e2e:study-stream-v2` 4/4 passed，並以 local browser smoke
  影像確認初始思考提示、約 1 秒後長按提示及答案面；ordinary tap 唔會揭示，3 秒原位按實先會揭示。
- I-012 visual feedback refinement 已完成並驗證：提示 class 有 highlighter／breathing 視覺，按住
  indicator 以按下位置定位，進度由 0 增至 1 時 pulse duration 由約 1050ms 減至 260ms；放手後
  indicator active／進度清空，重新按 2100ms 仍未揭示。`npm run test:e2e:study-stream-v2` 4/4 passed，
  `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` 通過（Chromium／Firefox／WebKit／mobile
  73 passed／4 skipped，WebKit study shards 17 + 16 passed），V1 student IA 24 passed／2 skipped、
  QA 21 passed／1 skipped；manual visual smoke 亦確認 reduced-motion CSS 保持提示可見並停用動畫。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:student-ia`：24 passed／2 skipped；
  `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:student-qa`：21 passed／1 skipped；
  舊版 student shell、study navigation、card/action fidelity、keyboard、locale、theme、
  forced-colors、axe 及 mobile regression 通過。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`：Chromium suite 73 passed／4
  skipped，WebKit study shards 33 passed；涵蓋 mouse、synthetic pointer、emulated touch、
  reduced motion、offline／cross-tab／cross-device study integration 及 V1 rollback path。
- `npm test`：126 passed；lint、typecheck、optimized build（42/42 pages）及 `git diff --check`
  passed。card-motion／V1 fixture 必須明確以 `STUDY_V2_ASSIGNMENT_MODE=off` 執行；local
  `.env.local` 的 `all` run 唔會當作 V1 regression evidence。
- 既有 V2 DB
  integration、V1 ledger regression、fresh replay、temporary-schema contract regression、
  checksum、Prisma status 及 V1 student IA／QA regression 均 passed（V1 IA 24 passed／2 skipped，
  V1 QA 21 passed／1 skipped）。
- Local manual browser smoke confirmed ordinary test student receives `flowVersion=v2` under
  `all` and returns to V1 with `STUDY_V2_ASSIGNMENT_MODE=off`; no production deploy、student
  pilot、research collection or destructive contract migration performed。

### 2026-08-12：V2 product implementation handoff／reliability closure

- `npm test`：124 passed；`npm run lint`、`npx tsc --noEmit`：passed。
- `npx prisma validate`、`npx prisma generate`、`npm run db:deploy`：passed；新增
  expand migration 已套用，本地 preflight 顯示無 lineage gap。
- `npm run test:db:stream-v2`：passed；涵蓋 global／unit scope、server-issued item
  credential、reveal gate、objective first response、correct／wrong quality、feedback
  resume／ack、V2 provenance、remediation work completion、combined cap under concurrent
  admission、global operation receipt 及同一 learner 嘅 V1／V2 dual-flow coexistence。
- `npm run test:db`：passed；V1 review ledger、idempotency、concurrency 及 receipt bridge
  regression 通過。
- `npx prisma migrate status` 顯示 24 migrations 已套用；`npm run test:migration-checksums`、
  `npm run test:migrations`、`npm run test:migrations:contract` 均 passed。Contract regression
  只喺 temporary schema 執行，未對本地正式資料庫執行 `npm run db:contract`。
- Production config default local env 按預期拒絕缺少 secrets；不落盤 shape-only synthetic
  env 通過。production 無 Upstash 或誤帶
  `ENABLE_TEST_ROUTES=1` 會 fail closed／fail validation。login、password-change、study
  queue／action／credential limiter 的 production runtime guard 亦以缺少 backend 的
  child-process check 驗證；browser test 只喺明確 `ENABLE_TEST_ROUTES=1` 時使用 local
  fallback；backend failure logging 只保留 allowlisted error type，唔寫原始 exception／request
  details。`npm run audit:production` 經 network-enabled retry 通過，報告 0 vulnerabilities；
  未進行正式部署。
- `npm run test:e2e:card-motion`：Chromium 73 passed／4 skipped；WebKit 33 passed。
  另以 V2 internal assignment 執行 study-integration Chromium 32 passed，並手動驗證
  objective answer、read-only feedback ack、learning-card reveal／self-rating、合法離開、
  unit summary、簡繁／明暗、keyboard、offline outbox recovery、storage corruption
  fail-closed、cross-tab checkpoint／credential lineage 及 V1 feature-off rollback smoke。
- 新增 `credentialLineage` expand 欄位只保存 bounded digest grants；log allowlist 測試確認
  raw credential／答案唔會進入 unexpected-error log。Token-version revocation 亦由 V2 DB
  integration callback check 覆蓋。
- 新增 `src/lib/study-stream/observability.ts` request-level structured metric，三條 V2 route
  只記錄 allowlisted route／flow／status／outcome／duration／action kind，唔記 user、IP、
  credential、operation、word 或 answer；`plans/artifacts/learning-stream-v2-internal-soak-runbook.md`
  記錄 extraction、hard integrity pause conditions、V1 rollback 及 support procedure。
- `STUDY_STREAM_SOAK_ITERATIONS=20 npm run check:study-stream-v2:soak`：20/20 bounded internal
  iterations passed，p50 869 ms、p95 1,137 ms、max 1,309 ms；`npm run check:study-credential-v2`
  及 lineage compatibility scan 均 passed，
  0 receipt gap、0 V2 provenance gap、0 lineage gap。內部 browser semantic check verified
  labelled keyboard group、native radio options、checked／disabled state 及 `aria-live` feedback。
- Production build（42/42 static pages）及完整 `npm run test:e2e:card-motion` 重新通過：
  Chromium 73 passed／4 skipped、WebKit 33 passed；同一輪亦驗證 V1 rollback／offline／
  cross-device browser paths。`pg@9` warning 已以 traced run 定位至 Prisma PostgreSQL
  adapter transaction path，仍係 non-fatal runtime hygiene limitation，唔係 application
  assertion failure。
- 補充執行 `npm run test:e2e:student-ia`：24 passed／2 skipped，覆蓋 student shell、role
  boundary、locale／theme、study navigation、dialog focus／inert 及 Pixel 7 emulation
  geometry；另執行 `student-final-qa`、study action fidelity、study card fidelity projects：
  21 passed／1 skipped，包含 axe WCAG 2A/2AA、accessibility tree、skip link、live status、
  keyboard、400% zoom、forced-colors 及 desktop／mobile emulation。
- Temporary internal-only V2 browser smoke（命令環境注入單一 test user allowlist，未寫入
  `.env`）通過：V2 objective radiogroup／native radios、server-scored answer、checked／
  disabled feedback、read-only ACK、Learning Card reveal／self-rating 及 authoritative
  next-item transition；V2 route metrics 只出現 allowlisted route／flow／status／outcome／
  action kind。此項仍不等同 native screen-reader 或 physical-device acceptance。
- CI／release automation gate 已補上 V2 source／test path filters、`npm run test:db:stream-v2`、
  `STUDY_STREAM_SOAK_ITERATIONS=3 npm run check:study-stream-v2:soak`、`test:e2e:student-ia`
  及 `test:e2e:student-qa`。本地按 workflow 順序重跑：V2 integration passed、3/3 soak
  passed（p50 1,311 ms、p95 2,133 ms、max 2,133 ms）、student-qa 21 passed／1 skipped；
  兩份 workflow YAML、package JSON、lint、typecheck 及 `npm test` 124 passed。CI 尚未喺
  GitHub production workflow 實際執行，故 production deploy gate 仍保持未完成。

未勾選項目及限制：原生 screen-reader／手機實機驗收、production observability threshold、
正式 production deploy、學生 pilot、研究 telemetry／consent、old-binary compatibility
window 及 contract cleanup 尚未完成。
