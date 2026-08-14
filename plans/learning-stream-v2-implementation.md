# Learning Stream v2 實施計劃

> 類型：功能／跨頁面 UI／核心學習流程實施計劃
> 狀態：已完成（local product scope；external gates deferred）
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
- [x] 按 I-012 修正 V2 Learning Card：初始顯示並保留「先試著想一想這個詞的中文意思」，約 1 秒後
  追加「長按 3 秒揭示答案」；只有 stationary long-press 可揭示，低位移／左右拖動／發音 control
  不得揭示；揭示後左右掃及 rating actions 改用「和剛才想的一樣／不一樣」語義；
- [x] 按 I-012 visual feedback refinement 強化兩段提示嘅高亮／呼吸式提示；按住時顯示透明圓圈，
  進度越近 3 秒呼吸越快／越明顯；中途放手、移動或 pointer cancel 必須取消視覺進度並重新由
  3 秒計算；
- [x] 按 I-015 收斂 retrieval 提示視覺：移除 V2「可隨時離開，進度會安全保留」、將長按提示移到
  發音 button 下方、降低兩段提示嘅呼吸幅度／閃動強度，並以漸進 enter effect 顯示長按提示；
- [x] 按 I-016 對齊 EMM Style 02 study surface fidelity：恢復 V2 字卡嘅 level／category badge、加強
  「連續學習」及「認讀卡」層級、將發音改為圖示＋文字 control，並按 handoff 重整 Objective Probe／
  V1 QuizCard 題目／選項 hierarchy；只改 presentation 及 additive item metadata，不改學習／計分／gesture contract；
- [x] 按 I-017 依照使用者提供嘅 EMM choice-card reference 收斂選擇題 visual：題卡 meta／單詞／指示層級、
  選項尺寸及字母圓章、未作答／答錯／正確狀態色彩與 border 對齊 reference；只改 presentation，保留
  V1／V2 option selection、delayed answer、server scoring、locale／theme 及 rollback contract，並已完成相應驗證；
- [x] 按 I-018 依照使用者提供嘅 revealed Learning Card reference 收斂 V2 卡面：以右上四分之一圓內嘅
  stylized「認」取代「認讀卡」文字、front／back 預留音標位、調整 vertical composition、降低英文單詞過大感、
  強化揭示後中文意思 hierarchy，並移除卡內重複 swipe 語義文字；只改 presentation，保留 long-press／
  flip／audio／self-rating／server action／locale／theme contract；已完成相應驗證；
- [x] 按 I-019 修正 Learning Card／Objective Probe 嘅 follow-up presentation：將「認」置於右上半圓視覺中心、
  front 音標 slot 移到英文正下方、secondary long-press hint 固定預留高度避免既有文字移位；Objective Probe
  read-only feedback 移除確認 button，改以「輕點一下任意區域」提示及卡面 click／keyboard continuation；只改
  presentation／acknowledgement trigger，保留 `FEEDBACK_ACK`、server feedback、locale／theme／reduced-motion contract；已完成相應驗證；
- [x] 按 I-020 收斂 Objective Probe feedback presentation：答題後只以選項本身嘅 correct／wrong／dim 顏色表達結果，
  移除卡下可見結果文字及繼續文字提示；保留固定空白 affordance slot，於已回答狀態以低幅度、慢速呼吸嘅半透明圓形
  提示可點擊卡面繼續；保留卡面 click／keyboard `FEEDBACK_ACK`、a11y、locale／theme、reduced-motion 及 V1 rollback contract；已完成相應驗證；
- [x] 按 I-021 修正 Learning Card swipe feedback placement：左右拖曳中嘅兩個 direction badge 下移至 metadata 以下安全區，
  避免覆蓋 level／category badge；只改 visual placement，保留 swipe threshold／direction／release motion、locale／theme、responsive 及 V1 rollback contract；已完成相應驗證；
- [x] 按 I-022 修正普通 expand migration 環境下 V2 `Review` 寫入觸發 legacy bridge，導致同一 `OBJECTIVE_ANSWER` 產生重複
  `ReviewEvent`；V2 transaction 必須設定既有 writer guard，保留 `operationId`／global receipt／Serializable retry、V1 bridge 及 rollback semantics；完成
  CI reproduction、ordinary-migration regression、DB／V2／V1 驗證後已勾選；不新增 migration 或 contract cleanup；
- [x] 按 I-023 將 Learning Card 左上 level／category badge 上移至同右上 stylized「認」標記視覺中心嘅水平線；只改 metadata
  presentation／responsive placement，保留 corner mark、phonetic slot、retrieval／long-press／swipe／server semantics；已完成
  desktop／mobile visual regression；
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
| UI correction | 持續思考提示、追加長按提示及高亮呼吸、stationary long-press 與發音 button 分離、透明按住進度圈及加速提示、低位移／拖動取消／放手重置、flip front／back、卡下同寬 self-rating、答案後一樣／不一樣 swipe 語義、Objective Probe color-only feedback／慢速呼吸 affordance、zh-Hant／zh-Hans account display | Phase 5 local correction |
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
| I-007 | Cross-tab credential rotation | item 保留 bounded credential digest lineage；仍有效 predecessor 可按 normal action 使用，已過期 predecessor 只可喺 I-014 explicit recovery proof 使用；action 仍由 item status、operation receipt、target／Review CAS authoritative 決定 | 已落實並驗證；需 expand migration，唔涉及 contract cleanup |
| I-008 | Shared rate-limit backend 故障策略 | production／Vercel production runtime 一律 fail closed；memory fallback 只限非-production local 或明確 `ENABLE_TEST_ROUTES=1` test runtime；login、password change、study queue／action／credential renewal 共用同一 runtime 判定；backend failure log 只記 allowlisted error type，唔記原始 exception／request details | Phase 2 security regression |
| I-009 | V2 CI／release preflight coverage | Study quality workflow 同 production verification job 必須喺 seed 後執行 `npm run test:db:stream-v2` 及 bounded `STUDY_STREAM_SOAK_ITERATIONS=3 npm run check:study-stream-v2:soak`；path filter 覆蓋 V2 source／tests；assignment 仍 deny-by-default | Phase 4 automation gate；唔等同 production deploy／student pilot |
| I-010 | Local full V2 cutover scope | `STUDY_V2_ASSIGNMENT_MODE=all` 只可喺 local development，或明確 `ENABLE_TEST_ROUTES=1` 且無 Vercel environment 嘅 local browser test runtime 啟用；`off` 強制 V1，internal allowlist 保留；Vercel preview／production all-user mode fail closed | Phase 5 local product-complete |
| I-011 | Visual review follow-up：Learning Card reveal／rating placement／account display | 不改 Contract 語義或 server action；V2 card body（排除發音 control）以 tap 揭示並以 one-way front／back flip 顯示答案；self-rating actions 移到卡下同寬 row；學生名稱 display 經 `tc()` 轉換，stored identity 不變；低位移 tap 唔可誤觸 swipe | Phase 5 local UI correction；完成前不得勾選相關 local DoD |
| I-012 | Retrieval pause before reveal | 不改 Contract 語義或 server action；V2 Learning Card 保留「先試著想一想這個詞的中文意思」，約 1 秒後追加 stationary long-press 3 秒提示；兩段提示需有清楚但不干擾嘅高亮／呼吸式視覺；按住時顯示透明圓圈並隨 3 秒進度加快／增強；audio button、移動、放手及 pointer cancel 必須取消並重置 reveal timer；reveal 後保留既有 flip／答案面，左右 swipe／rating actions 用「和剛才想的一樣／不一樣」語義 | Phase 5 local interaction correction；visual refinement 完成前不得勾選相關 local DoD |
| I-013 | Expired-session retry recovery／system locale | V2 action 遇到可恢復嘅 session expiry 時，保留原 `operationId`／item credential，經 server-authoritative session recovery 後只重送同一 typed action；revoked／無法證明 credential lineage 仍 fail closed，但唔可以無限重試；所有 V2 loading／fallback source literals 改用 canonical 簡體再交由 `tc()` 顯示，確保 zh-Hant 首屏一致 | 已落實並驗證；由 I-013 local reliability／locale correction 完成 |
| I-014 | Item credential expiry／resume recovery follow-up | 普通 action 對未知 credential 及 revoked session 繼續 fail closed；server 保留 bounded digest lineage 供 recovery-only proof，對同一 item／session／typed operation 嘅過期 credential 可經 explicit recovery route 恢復，並以 Serializable CAS 必要時重新租約；client 對 `ITEM_CREDENTIAL_EXPIRED`／`EXPIRED_ITEM_LEASE` 只作一次 recovery，保留原 `operationId`／outbox，唔清空或改寫學習結果 | 已落實並驗證；由 I-014 local reliability follow-up 完成 |
| I-015 | Retrieval prompt presentation refinement | 不改 retrieval gate／長按 timer／audio exclusion；V2 移除「可隨時離開，進度會安全保留」，保留思考提示，將約 1 秒後出現嘅「長按 3 秒揭示答案」移到發音 button 下方；兩段提示改用低幅度、慢速呼吸，secondary 以 progressive enter effect 出現，並保留 reduced-motion 可理解性 | 已落實並驗證；由 I-015 local UI refinement 完成 |
| I-016 | EMM Style 02 study surface fidelity refinement | 只改 V1／V2 presentation：item output additive 傳遞 level／category；header title、Learning Card metadata／context、V1／V2 audio label control、Objective Probe／V1 QuizCard 題目／選項 visual hierarchy 對齊 handoff；保留 retrieval gate、long-press、swipe、server scoring、outbox、V1 rollback 及 locale／theme 行為 | 已落實並驗證；由 I-016 local UI refinement 完成 |
| I-017 | EMM choice-card reference visual refinement | 只改 V1／V2 choice-card presentation：以 reference 收斂 prompt meta／單詞／instruction hierarchy、option row density／letter badge、idle／wrong／correct visual states；保留 option ids、delayed answer、server scoring、locale／theme、accessibility 及 V1 rollback contract | 已落實並驗證；由 I-017 local UI refinement 完成 |
| I-018 | Revealed Learning Card reference visual refinement | 只改 V2 Learning Card presentation：右上 stylized「認」corner mark、front／back phonetic reserved slot、lower composition、smaller term scale、revealed definition hierarchy、移除卡內 duplicate swipe copy；保留 long-press／flip／audio exclusion／self-rating／server action／locale／theme contract | 已落實並驗證；由 I-018 local UI refinement 完成 |
| I-019 | Learning Card geometry／Objective Probe continuation refinement | 只改 V2 card geometry／hint reservation 同 Objective Probe feedback continuation presentation：quarter-circle mark 對中、front phonetic slot 置於 term 下、secondary hint 固定 layout slot、feedback 由 click-anywhere／keyboard 觸發既有 `FEEDBACK_ACK`；保留 retrieval／scoring／server feedback／locale／theme／rollback contract | 已落實並驗證；由 I-019 local UI refinement 完成，唔涉及 migration／production／research gate |
| I-020 | Objective Probe color-only feedback affordance refinement | 只改 Objective Probe answered-state presentation：移除可見結果／繼續 copy，保留選項 correct／wrong／dim 色彩，於固定空白 slot 顯示低幅度慢速半透明呼吸圓形；保留卡面 click／keyboard `FEEDBACK_ACK`、a11y、locale／theme、reduced-motion 及 V1 rollback contract | 已落實並驗證；由 I-020 local UI refinement 完成，唔涉及 migration／production／research gate |
| I-021 | Learning Card swipe feedback placement refinement | 只改 `.word-card-drag-badge` placement：左右提示下移到 level／category metadata 以下嘅安全區，避免拖曳時重疊；保留 swipe threshold／direction／release motion、locale／theme、responsive、accessibility 及 V1 rollback contract | 已落實並驗證；由 I-021 local UI refinement 完成，唔涉及 migration／production／research gate |
| I-022 | V2 ReviewEvent／legacy bridge interaction | 普通 expand migration 仍保留 `Review` legacy bridge trigger；V2 objective answer 寫入 `Review` 前必須喺同一 transaction 設定 `app.review_event_writer=v2`，避免 bridge event 同 explicit V2 event 重複；保留 global `OperationReceipt`／`ReviewEvent` unique、Serializable retry、V1 writer 及 rollback，唔執行 contract migration | 已落實並驗證；由 CI run 26（`3031afd`）失敗證據觸發，ordinary-migration／DB／browser／remote regression 均通過 |
| I-023 | Learning Card metadata vertical alignment | 使用者指出左上 A1／Numbers 0 to 100 level／category badge 低於右上 stylized「認」標記；只將 badge 上移至同「認」標記視覺中心嘅水平線，保留 corner mark、phonetic slot、retrieval／long-press／swipe／server semantics 及 responsive 行為 | 已落實並驗證；由 local presentation refinement 完成，desktop／mobile visual regression 及 V1／V2 interaction regression 均通過 |

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
- [x] I-013 expired-session retry recovery 已通過 session-expiry／retry-loop regression、原 operationId idempotency、revoked／unknown credential fail-closed、outbox 保留及 V1／V2 regression；V2 system loading／fallback copy 已通過 zh-Hant／zh-Hans 首屏驗證；
- [x] I-014 item credential expiry／expired lease recovery 已通過 item credential／session 同時過期、bounded lineage、原 operationId idempotency、未知 credential／revoked fail-closed、outbox 保留及 V1／V2 regression；
- [x] I-015 retrieval prompt presentation refinement 已通過提示位置／間距、低幅度動畫、secondary 漸進出現、V2 queue note 移除及 reduced-motion／V1 regression；
- [x] I-016 EMM Style 02 study surface fidelity refinement 已通過 metadata／header／audio／Objective Probe／
  V1 QuizCard hierarchy、responsive visual、locale／theme／reduced-motion 及 V1／V2 interaction regression；
- [x] I-017 EMM choice-card reference visual refinement 已通過 prompt／option hierarchy、idle／wrong／correct
  state visual、responsive／locale／theme／reduced-motion 及 V1／V2 selection regression；
- [x] I-018 revealed Learning Card reference visual refinement 已通過 corner mark、phonetic reserved slot、
  front／back hierarchy、duplicate copy removal、responsive／locale／theme／reduced-motion 及 V2 gesture regression；
- [x] I-019 Learning Card geometry／Objective Probe continuation refinement 已通過 quarter-circle mark 對中、
  front phonetic placement、secondary hint no-layout-shift、click-anywhere／keyboard `FEEDBACK_ACK`、responsive／
  locale／theme／reduced-motion 及 V1／V2 regression；
- [x] I-020 Objective Probe color-only feedback affordance refinement 已通過選項 correct／wrong／dim 色彩、可見結果／
  繼續文字移除、固定空白 slot 內低幅度慢速半透明呼吸圓形、click-anywhere／keyboard `FEEDBACK_ACK`、responsive／
  locale／theme／reduced-motion 及 V1／V2 regression；
- [x] I-021 Learning Card swipe feedback placement refinement 已通過左右 direction badge 避開 level／category metadata、
  desktop／mobile responsive、swipe threshold／direction／release motion、locale／theme／reduced-motion 及 V1／V2 regression；
- [x] I-022 V2 objective answer 喺 ordinary expand migration 下只產生一條 provenance-complete `ReviewEvent`，同一 operation 重送
  回相同 authoritative response，並通過 DB／bounded soak／V2 browser／V1 rollback regression；
- [x] I-023 level／category badge 同「認」標記完成垂直對齊，並通過 desktop／mobile visual regression 及既有 V1／V2 interaction regression；
- [x] local 實際測試、未執行項目及已知限制已記錄；external pilot 結果仍 deferred；
- [x] `project-plan.md` 同 `plans/README.md` 已按實際狀態更新；
- [x] 狀態只喺完成以上驗證後改為「已完成」。

External pilot／production／research gates 係 deferred scope，唔會因未執行而阻塞 local
product-complete；I-023 local acceptance 證據已完成，本計劃標記為已完成。

## 十五、實際驗證紀錄

### 2026-08-13：Local product-complete V2 cutover evidence

其後本機實際驗證發現，待同步 V2 action 遇到已過期 session 時，controller 只會以同一個
失效 session 重送，造成 `SyncBlocked` 嘅「重試」循環；同一條 V2 assignment／loading path
亦有 source literal 直接使用簡體，令 zh-Hant 首屏出現簡體系統提示。因此新增 I-013，先完成
server-authoritative recovery／bounded retry 及 locale regression 後，先可將 local completion
evidence 視為完整。此修正唔涉及 contract migration、production deploy 或研究資料收集。

其後 visual review 發現現有 V2 Learning Card 雖然已符合 retrieval reveal gate，但仍以卡下獨立揭示掣、
卡內 self-rating hint 及未轉換嘅學生 display name 呈現；因此新增 I-011 local UI correction
scope。I-011 已按以下證據完成，唔改 learning、evidence 或 server action contract。

其後使用者要求避免學生一見卡便立即揭示答案；因此新增 I-012 interaction correction scope。
I-012 已按以下證據完成；上一輪 I-011 嘅 tap-to-reveal 係 presentation baseline，現行 V2 以
stationary long-press 取代即時 tap，唔改 learning、evidence 或 server action contract。

2026-08-13 使用者 local smoke 再發現 V2 Objective Probe／待同步 action 顯示「學習項目憑證無效或已過期」；
I-013 嘅 recovery 只覆蓋 `SESSION_EXPIRED`，未覆蓋 item credential／lease 同時過期或 refresh
輪換後嘅合法 predecessor。新增 I-014：normal action 仍拒絕 expired credential，只有 matching
server-recorded lineage 經 explicit recovery route 才可原子恢復；未知 credential、revoked session
及無法證明 item identity 仍 fail closed。以下驗證完成後已將 I-014 local checklist 勾選；呢個
follow-up 唔涉及 contract migration、production deploy 或研究資料收集。

2026-08-13 使用者再提出 I-015 retrieval prompt presentation refinement：現有兩段提示呼吸幅度過大、
間距過窄，secondary prompt 直接出現於主提示旁邊，並要求移除 V2 queue note。I-015 只改
presentation CSS／DOM placement／copy，不改 long-press timing、audio exclusion、swipe 或 server
action contract；以下證據完成後已收斂。

- V2 `LearningCardView` 移除 queue note；primary prompt 保留喺字詞下方，secondary prompt 由
  hints grid 移到發音 button 後方，並保留固定 slot 以避免 layout jump。
- retrieval prompt breathe 由原本約 2.2／1.35 秒及 2.5% scale／5px halo 收斂至約 4.8／4.4 秒、
  0.6% scale／2px halo；secondary slot 以 max-height／opacity／translate transition 漸進顯示，
  reduced-motion 會停用 transition／breathe 但保留可見文字。
- `npm test`：126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；
  `npm run build`：43/43 static pages generated，compiled／TypeScript passed。
- `npm run test:e2e:study-stream-v2`：6 passed；檢查 queue note 移除、prompt animation duration、
  secondary transition、發音 button 下方位置及既有 stationary long-press／movement／audio exclusion。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`：primary 73 passed／4 skipped；
  WebKit study shards 17 + 16 passed；V1 rollback、mouse／synthetic pointer／touch、offline／
  cross-tab／cross-device regression 無回歸。

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
  labels 完成；思考提示會一直保留，約 1 秒後追加長按提示。重新執行 `npm run test:e2e:study-stream-v2`
  4/4 passed，並以 local browser smoke 影像確認兩句提示同時存在及答案面；ordinary tap 唔會揭示，
  3 秒原位按實先會揭示。
- I-012 visual feedback refinement 已完成並驗證：提示 class 有 highlighter／breathing 視覺，按住
  indicator 以按下位置定位，進度由 0 增至 1 時 pulse duration 由約 1050ms 減至 260ms；放手後
  indicator active／進度清空，重新按 2100ms 仍未揭示。`npm run test:e2e:study-stream-v2` 4/4 passed，
  `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` 通過（Chromium／Firefox／WebKit／mobile
  73 passed／4 skipped，WebKit study shards 17 + 16 passed），V1 student IA 24 passed／2 skipped、
  QA 21 passed／1 skipped；manual visual smoke 亦確認 reduced-motion CSS 保持提示可見並停用動畫。
- I-013 已收斂使用者實際遇到嘅 session expiry retry loop 及 V2 system locale 漏字：普通
  `/api/study/actions` 對過期／撤銷 session 仍 fail-closed 並回傳 allowlisted code；只有 client
  持有同一 item credential／typed action 並明確進入 `/api/study/actions/recover`，server 先喺
  Serializable transaction 延長未撤銷 session並重放原 operationId。recovery 失敗時 durable outbox
  保留並停喺可見 blocker，client 每次只作一次 recovery request，唔會無限重送；同 operationId
  重試回相同 authoritative receipt。V2 assignment router／stream loading literal 已統一由
  canonical 簡體經 `tc()` 轉換，zh-Hant／zh-Hans 首屏 regression 通過。
- `npm test`：126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；
  `npm run build`：43/43 static pages generated，compiled／TypeScript passed。
- `npm run test:db:stream-v2`：passed；覆蓋普通 expired session rejection、explicit recovery、
  duplicate operation replay、revoked session fail-closed 及 ledger／metrics consistency。
- `npm run test:e2e:study-stream-v2`：6 passed；包括 simulated blocker → 重試 recovery、原
  operationId、outbox rows 清空、V2 retrieval／long-press／locale display。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`：Chromium 73 passed／4 skipped，
  WebKit study shards 17 + 16 passed；V1 rollback、offline／cross-device／gesture regression
  無回歸。無 schema／migration 改動，未執行 `npm run db:contract`。
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

### 2026-08-13：I-014 item credential／lease recovery follow-up evidence

使用者 local smoke 再現 V2 Objective Probe 顯示「學習項目憑證無效或已過期」；I-014 已補上
item credential／session／lease 嘅 bounded recovery，而唔改 typed action、scoring、review 或
資料庫 schema contract：

- normal action 先驗證 item、user、session、credential digest lineage；current／predecessor
  credential 過期時回傳 allowlisted `ITEM_CREDENTIAL_EXPIRED`，unknown credential 仍以 generic
  403 fail closed；revoked session 仍回傳 `SESSION_REVOKED`。
- credential rotation 保留最多 8 條 digest lineage（包括已過期 grant，但只供 explicit recovery
  proof；normal action 仍嚴格檢查 expiry）；recovery route 只喺同一 user／session／stream item／
  typed operation 通過 Serializable transaction 後接受，expired session／credential／unused-item
  lease 必要時以 CAS 一次恢復。
- `StudyStreamV2` 對 `SESSION_EXPIRED`、`ITEM_CREDENTIAL_EXPIRED`、`EXPIRED_ITEM_LEASE` 各只發一次
  `/api/study/actions/recover`；原 `operationId`／outbox row 保留，recovery 失敗唔會無限重試或清空。
- `npm test`：126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；
  `npm run build`：43/43 static pages generated，compiled／TypeScript passed。
- `npm run test:db:stream-v2`：passed；覆蓋 expired lease recovery、refresh rotation 後 expired
  predecessor recovery、expired session＋credential、duplicate receipt、revoked fail-closed 及
  ledger consistency。
- `npm run test:e2e:study-stream-v2`：6 passed；新增 item credential error → 一次 recovery →
  retry／outbox 清空 regression，並保留 V2 retrieval／locale tests。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`：primary 73 passed／4 skipped；
  WebKit study shards 17 + 16 passed；V1 rollback、mouse／synthetic pointer／touch、offline／
  cross-tab／cross-device study integration 無回歸。
- 無 schema／migration 改動，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、
  research telemetry／consent，以上 external gates 仍 deferred。

### 2026-08-14：I-016 EMM Style 02 study surface fidelity evidence

使用者以 EMM Style 02 handoff 要求修正 V1／V2 認讀卡、header、發音 control 及客觀題面；
I-016 只改 V1／V2 presentation 同 additive item metadata，唔改 retrieval gate、long-press timer、swipe／
self-rating semantics、server scoring、credential、outbox、locale／theme contract 或 V1 rollback：

- `PublicStreamItemBase`／server projection 新增 optional `level`／`category` presentation metadata；
  V2 Learning Card 恢復 level／category badge 及右上「認讀卡」context，`連續學習` 改用較大粗體
  header，V1／V2 發音 control 統一為音量圖示＋「發音」文字。
- Objective Probe／V1 QuizCard 按 handoff 重整為 eyebrow／intro、題面 direction／metadata、大 prompt、
  instruction 及四個 rounded option rows；答案 key 仍唔下發，native radios／legacy option semantics、
  read-only feedback／ACK 及 server authoritative transition 保持不變。
- `npm test`：126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；
  `npm run build`：compiled／TypeScript passed，43/43 static pages generated。
- `npm run test:e2e:study-stream-v2`：7 passed，覆蓋 retrieval／stationary long-press／audio exclusion、
  self-rating、Objective Probe 四選一／recovery、zh-Hant／zh-Hans、metadata／title／audio、dark／
  reduced-motion 及 viewport overflow。
- V1 `study-workflow` full run 有 31 passed；第 32 個 case 只因同一 local test user 累積 queue
  rate-limit，未進入頁面便 timeout，單獨重跑該 case（連 auth setup）2 passed；新增 V1 QuizCard
  EMM intro／level badge／四選一／發音 assertions 已包含並通過。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=off npx playwright test tests/e2e/study-card-fidelity.spec.ts
  --project=study-card-fidelity-chromium --project=study-card-fidelity-mobile`：8 passed／1 skipped；
  V1 level／category、dark／reduced-motion／forced-colors、axe、desktop／mobile reference capture 通過。
- local visual smoke capture 檢查 V2 Objective Probe 390×844／1440×900，題目／選項 hierarchy 正常且
  `scrollWidth` 無超出 viewport。未執行 contract migration、production deploy、真實學生 pilot 或研究資料收集。

### 2026-08-14：I-017 EMM choice-card reference visual evidence

使用者以兩張 choice-card reference 要求進一步收斂 V1／V2 客觀題面；I-017 只改
`src/app/globals.css` presentation rules，保留 option id、delayed answer、server scoring、locale／theme、
accessibility、V1 rollback 及所有 retrieval／credential／outbox contract：

- 題卡內 direction label 改為參考圖式不帶 pill 嘅單行 label；prompt／instruction 左對齊，level／category
  badge、option row 同 A–D letter badge 放大，rounded row／spacing 以 EMM reference 收斂；較長 category
  仍可自然換行，而「看英文／看中文」保持不換行。
- idle option 保持 white surface／薄 border；答錯 row 使用淡暖紅底＋紅 border＋紅 letter badge；正確 row
  使用淡綠底＋綠 border＋綠 letter badge；其餘未選 option 維持 white surface 同 opacity 1，避免錯誤狀態
  將未選答案過度壓暗。
- reduced-motion 下 choice option 明確停用 transition；local browser smoke 以 desktop／390×844 mobile
  capture 及 computed layout check 驗證 `scrollWidth <= viewport width`、option `min-height: 68px`、
  `border-radius: 22px`、letter badge `44px`，並以 wrong selection 即時確認 correct／wrong state colors。
- `npm test`：126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build`：
  43/43 static pages generated，compiled／TypeScript passed。
- `npm run test:e2e:study-stream-v2`：7 passed；V2 retrieval／probe／metadata／locale／dark／reduced-motion
  regression 通過。V1 `study-card-fidelity` desktop／mobile：8 passed／1 skipped；V1
  `study-workflow` targeted choice-card transition：2 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、
  research telemetry／consent 或 ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-018 revealed Learning Card reference visual evidence

使用者以 revealed Learning Card reference 要求進一步收斂 V2 卡面；I-018 只改 presentation，保留
retrieval gate、stationary long-press／hold indicator、audio exclusion、flip、self-rating、server action、
locale／theme、V1 rollback 及既有 item contract：

- 右上 quarter-circle 內只顯示 stylized「認」，保留 `role="img"`／`aria-label`「認讀卡」作 accessibility 語義，唔再顯示 hover tooltip；
  front／back 均固定 render 音標 slot，資料未有音標時保留隱藏 layout slot，資料有值時可直接顯示。
- 調整 V2 卡片 vertical composition 及英文 term scale；答案面依次保留英文、音標 slot、圖示＋「發音」control，
  並以 soft definition panel 突出中文意思，接收既有 `pos`／例句資料而唔改 API／schema；移除卡內 keyboard／swipe
  duplicate copy，self-rating 仍然係卡外同寬 buttons。
- local visual smoke：desktop 1200×672 及 mobile 390×844；desktop card `416×496`、mobile card `342×520`，
  mobile `scrollWidth = 390`，rating actions 與卡同寬，front secondary hint 位於發音 control 下方，揭示面 panel／
  bottom content 未超出 card surface。
- 驗證：`npm test` 126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build`
  compiled／43/43 static pages generated；V2 `test:e2e:study-stream-v2` 7 passed；V1
  `study-card-fidelity` desktop／mobile 8 passed／1 skipped；WordCard 320px／390px fixtures 4 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、
  research telemetry／consent 或 ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-019 Learning Card geometry／Objective Probe continuation evidence

使用者實際操作指出右上「認」未對準半圓、front 音標空間未緊貼英文、secondary hint 出現會推動既有文字，並要求
Objective Probe 移除確認 button，改為輕點卡面任意區域繼續；I-019 只改 presentation／既有 acknowledgement trigger，
保留 retrieval gate、long-press timer、`FEEDBACK_ACK`、server feedback／scoring、outbox、locale／theme、reduced-motion
及 V1 rollback：

- 將 front DOM 順序改為 term → phonetic slot → 思考提示 → 發音；即使資料未提供 phonetic，slot 仍保留固定高度。
- 以固定 `52px` secondary hint layout slot 取代 height／padding collapse；提示仍以 opacity／transform progressive enter，
  因而顯示前後 term／音標／思考提示／發音 control 的 y／height 均保持在 1px 內。
- 以實際 desktop geometry 對齊 quarter-circle 可見區：desktop card `416×496`，context box 置於 `x=849,y=89,w=76,h=76`；
  mobile `390×844` visual smoke 無水平溢出。
- Objective Probe read-only feedback 移除「我看到了，繼續」button 及確認式 copy；顯示「輕點一下任意區域」，答題卡面 click
  或 Enter／Space keyboard continuation 仍只呼叫既有 `FEEDBACK_ACK`，disabled／sync-blocked 時不會繼續。
- 驗證：`npm test` 126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build`
  compiled／43/43 static pages generated；`npm run test:e2e:study-stream-v2` 7 passed，包含 mark alignment、phonetic
  placement、no-layout-shift 及 feedback click-anywhere；WordCard 320px／390px fixtures 4 passed。
- V1 rollback regression：`STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` Chromium 73 passed／4 skipped，
  WebKit shard 1 17 passed、shard 2 16 passed；涵蓋 mouse／touch／synthetic pointer、offline／cross-tab／cross-device／
  reconciliation。較早用 `.env.local=all` 誤跑嘅 V1 suite 只因 legacy test 等待 V2 不會發出嘅 `/api/study` 而 timeout，
  已按計劃以 `off` 重跑並以通過結果為準。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、research
  telemetry／consent 或 ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-020 Objective Probe color-only feedback affordance evidence

使用者要求答對／答錯只用選項顏色表達，移除卡下可見結果及「繼續」文字，改以空白位內半透明慢速呼吸圓形作點擊 affordance。
I-020 只改 answered-state presentation，保留 option ids、server scoring、read-only feedback、既有 `FEEDBACK_ACK`、keyboard
continuation、locale／theme、reduced-motion 及 V1 rollback：

- 移除 Objective Probe 可見 `quiz-result`／「答對了」／錯誤結果文案及 `study-stream-feedback-hint`；correct／wrong／dim
  狀態仍直接套用喺四個選項及字母圓章。
- 始終預留固定 `64px` affordance slot，只有 `item.feedback` 出現時以 opacity 漸進顯示 `48px` 半透明圓形；呼吸週期為
  `4.8s`、幅度低，reduced-motion 改為靜態可見圓形，避免答案回來時推動原有題面／選項。
- 卡面 click、Enter／Space 仍只觸發既有 `FEEDBACK_ACK`；同步／disabled 狀態唔可繼續；保留非視覺 `aria-live` 狀態及卡面
  continuation role／label，視覺上不增加任何文字提示。
- 驗證：`npm test` 126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build` compiled／
  43/43 static pages generated；`npm run test:e2e:study-stream-v2` 7 passed，新增 option state、無可見 result／hint、affordance
  visibility／4.8s motion、card click continuation 斷言，並覆蓋 locale／dark／reduced-motion。
- V1 rollback regression：`STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` Chromium 73 passed／4 skipped，WebKit
  shard 1 17 passed、shard 2 16 passed；涵蓋 mouse／touch／synthetic pointer、offline／cross-tab／cross-device／reconciliation。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、研究資料／consent、
  ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-021 Learning Card swipe feedback placement evidence

- 將 `.word-card-drag-badge` 由原本嘅 `top: 72px` 下移至 `top: 96px`，並移除 narrow viewport 另外嘅 `56px` override；左右文案、opacity／direction frame、swipe threshold、release motion、locale／theme、a11y 及 V1 rollback semantics 均不變。
- V2 e2e 於 flip transition 完成後斷言左右 direction badge 嘅 bounding box 均位於 back-face level／category metadata 底部至少 `3px` 以下；320px／390px WordCard fixture 同樣覆蓋兩個 badge，避免 responsive 重疊。
- 驗證：`npm test` 126 passed；`npm run lint`、`npx tsc --noEmit`、`git diff --check` passed；`npm run build` compiled／43/43 static pages generated；`npm run test:e2e:study-stream-v2` 7 passed；WordCard 320px／390px fixtures 4 passed；V1 rollback `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion` Chromium 73 passed／4 skipped，WebKit shard 1 17 passed、shard 2 16 passed。
- 無 schema／migration／contract change，未執行 `npm run db:contract`；無 production deploy、真實學生 pilot、研究資料／consent、ethics／家長 permission／學生 assent，以上 external gates 仍 deferred。

### 2026-08-14：I-022 CI failure／V2 ledger bridge incident (completed)

- GitHub `Study quality gate` run 26（commit `3031afd`）於 `Run V2 stream integration and bounded soak` 失敗：
  `scripts/check-study-stream-v2.ts:503` 見到同一 fresh user 有 `2 !== 1` 個 `ReviewEvent`；同一 operation 的第二次提交仍回傳
  `duplicate: true`，所以 failure 係 ledger row duplication，而唔係 UI assertion 或 retry response mismatch。
- PostgreSQL job log 同時顯示 ordinary migration 保留嘅 `Review_capture_legacy_event` bridge；V2 `processObjectiveAnswer` 寫入 `Review`
  時未設定 `app.review_event_writer=v2`，trigger 會新增一條 `LEGACY_BRIDGE`，再由 V2 explicit writer 新增一條
  `OBJECTIVE_PROBE` event。已確認 local contract-migrated DB 可能因 trigger 已清理而未能重現，故唔以 local-only pass 取代 CI evidence。
- I-022 修正範圍限於 V2 objective-answer transaction 先設定既有 writer guard；不改 schema、migration、contract cleanup、V1 writer、
  `operationId`／receipt semantics 或 rollback。完成後要喺 ordinary migration 狀態重跑 integration、bounded soak、相關 DB／V2／V1 regression，
  再 push 新 commit 觸發 GitHub workflow；production、contract migration、pilot、research／consent gates 仍 deferred。
- 本地 ordinary temporary schema（24 ordinary migrations、legacy bridge 保留）重播後，`npm run test:db:stream-v2` 通過；integration
  fixture 另外斷言 event `operationId` 同 `eventKind=REVIEW`。`npm test` 126 passed、lint、typecheck、migration checksum、V1 DB ledger
  regression 及 `STUDY_STREAM_SOAK_ITERATIONS=20 npm run check:study-stream-v2:soak`（20/20，p50 1324ms／p95 1718ms／max 1973ms）通過。
- V2 browser full rerun 7/7 passed；fresh temporary student fixture 下 V1 rollback Chromium 73 passed／4 skipped、WebKit shard 1 17 passed、
  shard 2 16 passed；production build 43/43 static pages generated。第一次 V2 full run 的 1 個 badge bounding-box assertion 只在單次
  animation sampling 失敗，isolated rerun 及 full rerun 均通過；第一次 V1 run 使用已被舊測試消耗嘅本地帳戶而有 4 個 queue-fixture failures，
  fresh fixture rerun 已全數通過。新 commit `f1ccc92` 觸發 GitHub `Study quality gate` run 27，job
  `94714925771` 於 2026-08-14 08:32 UTC 以 `success` 完成；I-022 現已勾選。

### 2026-08-14：I-023 Learning Card metadata alignment (completed)

- 使用者要求將左上 level／category badge（例如 `A1 · Numbers 0 to 100`）上移，令佢嘅視覺位置同右上 stylized「認」標記對齊。
- 實作範圍只限 `.word-card-top` metadata presentation；不改 corner mark、phonetic slot、retrieval／long-press／swipe、server action、locale／theme 或 rollback semantics。
- `.word-card-top > .level-badge` 只作 `translateY(-37px)` presentation adjustment；保留共用 `WordCard` interaction、locale／theme、phonetic slot、corner mark 及 rollback semantics。
- `word-card-fidelity-fixtures` 320px／390px：4 passed，中心對齊誤差不超過 2px，無水平溢出；build 43/43 static pages、unit 126 passed、lint／typecheck passed。
- V2 authenticated study stream：7 passed；V1 desktop／mobile card fidelity：8 passed／1 skipped；desktop 1440×900 及 mobile 390×844 visual captures 已檢視。

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
