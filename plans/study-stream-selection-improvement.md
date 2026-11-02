# 學習流揀詞、短期重複與驗證進度改進方案

> 狀態：進行中（使用者於 2026-11-02 批准按方案實作）。
> 日期：2026-11-02；程式基線：`main`／`0dc8427`。
> 工作分支：`codex/study-stream-selection-analysis`（按本次使用者明確要求建立）。
> 本方案已獲實作批准；生效語義見已更新的 [Retrieval-first Contract](./retrieval-first-learning-contract.md)。
> 使用者已批准實作；本次修改本地 runtime、UI、版本 readers 及測試，未修改 schema 或線上資料。

## 1. 背景、目標與證據邊界

使用者在 Vercel 示範站以 `__test_student__local` 操作時，感到同幾隻字不斷出現。
目標是消除沒有學習目的的循環，確保需要客觀驗證的接觸有後續，並保留可隨時離開的 V2 流程。

本次已核對候選查詢、scheduler、admission、self-rating／objective writer、單元解鎖、
示範模擬器、版本 reader 及既有回歸測試。以下分清楚三種證據：

- **已確認的程式缺陷**：目前 main 可在記憶體 fixture 重現；不是只憑文件推測。
- **待查的線上個案**：登入頁曾回 HTTP 200、Vercel header 顯示東京區域；現有本機密碼登入失敗。
  尚未取得該帳戶最新派卡、待驗證、Review 資料或部署 SHA，不宣稱已找到線上個案的唯一根因。
- **待驗證的設計參數**：方案中的新時間門檻是工程／體驗起始值，不能宣稱是教育研究的最優值。

非目標：更換 SM-2、改 correct=4／wrong=2、把自評當 mastery、降低 80% 單元解鎖門檻、
開放未解鎖詞、恢復 V1、重設示範帳戶、部署、真實學生 pilot 或 research telemetry。

依賴：[現況快照](./artifacts/retrieval-first-v2-current-product-baseline.md)、
[既有一致性審核](./study-stream-consistency-and-recovery-audit.md)、
[整頓計劃](./project-consolidation-and-student-handoff.md)、
[部署紀錄](./vercel-demo-deployment.md)。過往審核的「公平性已驗證」只涵蓋其測試情境；本次補足連續輪換缺口。

## 2. 根因與重現

| ID／優先級 | 已確認行為 | 根因與影響 |
|---|---|---|
| SEL-01／高 | 已接觸但未有 Review 的 20 詞，第一輪後只循環最早 3 詞 | `learnerStreamHistory` 取最早 encounters，`contactTimes` 保存首次時間；完成卡片不改排序；避重只看最近 2 個 acknowledged items |
| SEL-02／高 | 20 個已有 Review、全部未到期的詞仍以認讀卡循環 3 詞 | `buildCandidates` 的 ordinary fallback 明確選 `nextReviewDate > now`，按 `lastReviewedAt` 排序；self-rating 不更新 Review，因此排序固定 |
| SEL-03／高 | 20 新詞全部 selfRecalled，只有 5 個建立驗證，15 個 `debt-cap` | cap 在提交時才檢查；發卡沒有容量節制。`requiresVerification` 又由「需要驗證」變成「是否成功建立任務」；沒有自動重排這些被拒任務的閉環 |
| SEL-04／中 | 待驗證尚未到 10 分鐘，仍可反覆出同詞認讀卡 | server 的 `activeWork` 只讀已 eligible 的任務；等待中的同詞沒有被排除，持續揭示也不重算驗證距離最後答案曝光的時間 |
| SEL-05／中 | 單元只剩到期題時，為滿足 probe 間隔製造同詞卡 | due／obligation gap filler 與正常卡一起競爭；來源不同卻共用排序欄位，沒有「只有沒有適合卡才補位」的嚴格界線 |
| SEL-06／驗證缺口 | 示範資料可能比真人流程更均勻 | `demo-school.ts` 每次更新最近接觸時間；runtime 的上述兩條排序路徑不會更新。模擬器健康不能證明 runtime 公平 |

定位：[`server.ts`](../src/lib/study-stream/server.ts) 的 `learnerStreamHistory`、`activeWork`、
`buildCandidates`、`processSelfRating`；[`history.ts`](../src/lib/study-stream/history.ts) 的
`compareNewWordCandidates`；[`scheduler.ts`](../src/lib/learning-policy/scheduler.ts) 的 `spacedCandidates`、
`selectNextItem`；[`admission.ts`](../src/lib/learning-policy/admission.ts) 的 `admitWork`。

可重跑：`node --import tsx scripts/audit-study-selection.mjs`。
工具在記憶體匯出原有 `buildCandidates`，以限定 fixture 代替 Prisma 查詢，並呼叫真實 scheduler／admission。
不連資料庫、不讀密碼、不修改原程式。它驗證的是候選及 policy 組合，不是完整 transaction 或瀏覽器測試。

本次結果：

- 20 新詞，每張 12 秒、全部 selfRecalled：首次 20 張皆不同；隨後 15 張只出第 1、2、3 詞；5 accepted、15 debt-cap。
- 20 已有 Review、全未到期：35 張只出 3 詞，原因為 `spaced-learning-card`。
- 單純把避重窗口改為 10 的概念對照：固定排序仍只輪換前 11 詞，不能保證 20 詞公平覆蓋。
- 最近接觸時間排序的局部對照：同級且一直合資格的 20 詞，40 次選取覆蓋每詞兩次。
  此對照只證明排序方向，未驗證下方整套提案。

### 2.1 需要修正的先前解讀

字母排序不是三字循環的充分原因：未接觸詞在其分區本來優先，第一次接觸後會離開該分區。
「詞庫還有很多字」亦不等於當刻有很多合資格字；必須扣除未解鎖單元、待驗證、冷卻及失效內容。
「立即 eligible 的補救」也不等於下一張必定出同詞，仍受 scheduler 及避重影響。

目前 `minInterveningItems` 同時用於同詞避重及兩次 probe 間隔，不能直接改成 8–10。
`softDebtThreshold=3` 有設定，但現行選取／admission 沒有以該值落實新詞節制。
補位卡不等於第二次 scored answer，但可能在驗證前重新提供答案；單純防止重複計分並不足以保障間隔品質。

## 3. 建議採用的產品方向

採用「有目的的候選、按最近接觸公平輪換、驗證容量節制、沒有合適題就可暫停」。
SM-2 仍負責客觀答題後的長期日期；短期曝光及工作容量由獨立 operational state 處理。

先不設定 40% 新詞／60% 複習，也不把隨機抽選當主要修正。先消除可重現缺陷，
讓比例由到期量、可用容量、已解鎖內容自然形成；同級公平選取仍可以完全 deterministic。
如日後需要更有變化，可在同一優先級、同一接觸狀態內以穩定 learner／catalog seed 打破平手，
不能每次 GET 重新 shuffle，也不能越過 eligibility／期限／容量規則。

### 3.1 必須正面接受的產品取捨

**「最多 5 個未結任務」＋「新詞驗證至少等 10 分鐘」＋「全新帳戶可一直不停學新詞」三者不能同時保證。**
假設每卡 12 秒，5 詞約 1 分鐘已用完容量；沒有舊詞時，嚴格保留前兩項就會有等待。
現行程式靠漏建任務及重複填充掩蓋這個矛盾。

本方案首版建議保留 5／10 分鐘，容許短次學習後離開，下次直接驗證；
不要求學生在頁面等足 10 分鐘，不把暫停寫成「全部完成」。已有大量到期詞的學生仍可處理合法候選。
這是保守的正確性修復，**不承諾新帳戶每次連續 10 分鐘都有新詞**。
若產品要求後者，應另行批准提高容量或重新定義初次測驗時機，並驗證積壓及學習效果；
不以新增一條不計入 debt 的無上限佇列迴避限制。

## 4. 具體選取與進度規則

### 4.1 狀態與候選來源

1. 已發出且仍合法的 item／待確認 feedback 先續接；刷新不換題、不另計一次接觸。
2. 只在 current ACTIVE catalog、已解鎖 scope 內建立候選。
3. 任務分「所有未結（含等待中）」及「目前可派」兩份；前者計容量及排除重複認讀，後者供服務排序。
4. 正常來源只保留：到期 objective、可派 verification、明確 remediation、有容量的新詞、需要處理的既有未驗證接觸。
5. 已有客觀 evidence、未到期、沒有明確 remediation 的詞，不再自動當普通填充卡。
6. 待驗證的詞不重複發普通認讀卡，不用 `work-card` 提前給答案。
7. 真正無候選時回傳休息／等待狀態，不把候選不存在當 API error。

### 4.2 公平排序與曝光歷史

區分「看過答案」與「完成一個 item」：

- `lastAnswerExposureAt`：同詞最近 Learning Card reveal、objective answer feedback 的 server 時間；
  只揭示未 self-rate 也要防止立刻測驗。重播相同 receipt 不刷新時間。
- `lastAcknowledgedAt`：同詞最近 encounter acknowledgement 或 objective feedback acknowledgement，供輪換排序。
- 最近若干 acknowledged item 的 word／sense 身份：供短期項目距離；跨 session、global／unit、裝置共用。

在**同來源、同緊急程度、持續合資格**的候選內，先選最久未接觸，最後才以穩定 ID 打破平手。
未接觸的新詞仍在其來源內優先；到期題保留最早 due／deadline 的次序。
公平性不表示必須先出所有未解鎖或未 eligible 的詞，也不覆蓋安全續接與迫近期限任務。

資料庫須先按 learner＋word／sense 聚合 `MAX`，再排序／分頁；不能先 `take: 640` 最早 encounters 才做 Map，
亦不能先取固定字母前綴再公平排序。候選不足時按 keyset 補查，分清 exhausted 與查詢 budget 用完。
建議第一版用既有 durable 表及必要 expand indexes；先跑實際 query plan。
只有量測證明 aggregate 不合格才加可重建 projection，不直接新增每日全詞掃描。
舊資料缺少曝光時間時標為 unknown，不能假造為從未學過；以現有可靠來源及穩定 tie-break 排序，
新的合法接觸會更新 operational history。雲端曾精簡歷史資料，backfill 完整度須另行盤點。

### 4.3 拆開三種間隔，移除強制補位

提案初始參數及適用範圍：

| 規則 | 初始建議 | 性質 |
|---|---|---|
| `minSameWordInterveningItems` | 2 | 有其他合法詞時保留原值；公平排序解決大詞池循環，不靠增大窗口 |
| `minVerificationDelayMs` | 10 分鐘 | 沿用既有基線；驗證須同時滿足任務 eligibleAt 及距最後答案曝光的間隔 |
| `preferredItemsBetweenProbes` | 2 | 有合法卡時穿插；改為 preference，不能為湊數製造同詞卡 |
| `maxConsecutiveProbes` | 2 | 保留 soft cap；不同詞且合法時可連續兩題 |
| `probeBurstRestMs` | 60 秒 | 提議的 UX 起始值；兩題後無適合卡則暫停，elapsed rest 後可重開 burst |
| 重複 remediation 的冷卻 | 10 分鐘 | 保守沿用答案曝光窗口；同次錯題 feedback 已提供答案，不立即再展示同一答案 |

只有 probe、沒有合法卡時，可略過 preferred item gap；達 burst cap 就休息。
細單元的同詞 item gap 無法湊足時，只有時間冷卻已滿且無其他合法詞才可 override，並記原因。
不能突破尚未到期的 Review、驗證 elapsed delay、容量、scope 或 score CAS。
同詞距離與 probe burst 是兩個獨立 gate，不能互相抵銷。

60 秒與 remediation 冷卻是待驗收的政策建議，並非已生效設定。
實作前更新 Contract 的 hard probe-gap／補位語義及 policy version。
用 `[30, 60, 120]` 秒做節奏模擬比較；選定值再固定驗收，不能把模型結果當真實學生教學成效。

### 4.4 容量在發卡前檢查，並保留遲交操作

- 容量計全部 PENDING／LEASED work，包括未到 eligibleAt 的工作；上限仍為 5。
- 發出可能新增工作的 item 前，在 learner lock／Serializable transaction 內計入尚未完成的發卡預留。
  work-linked item 使用原工作名額；同詞多 scope 須 coalesce，不能各佔一個名額。
- self-rating 時把預留轉為 verification／remediation；已存在同詞工作則維持 lineage 並合併。
  只有有容量才引入下一個新詞。正確答題釋放工作／預留，錯答可把該名額轉為 remediation。
- 到期 probe 可能答錯，因此其補救容量也要納入；不能只預留 Learning Card。
- 預留不能因 15 分鐘 lease 過期就盲目釋放：目前 recovery 仍可能接受遲交。
  第一版可由既有可恢復 item 推算預留；只有正式 terminal／已確認移交才釋放，並提供返回未完成項目的入口。
- 舊版已派 item、跨裝置或離線 recovery 造成沒有名額的合法遲交時，仍保留原 receipt／operationId。
  明確記錄「需要驗證但延後入列」或「補救待入列」及來源，不能寫成不需要，也不能因容量拒絕已合法的客觀成績。
  此類例外先於再發新詞處理；不是新詞持續超量派發的第二條 queue。

**實作 gate**：先用雙裝置、切單元、session／lease 過期及舊 outbox 測試證明預留可釋放且不遺失合法遲交。
若現有 item 狀態無法同時滿足這兩點，應加入明確 reservation／transfer expand model，
補齊每種 terminal reason，不能用固定 timeout 或清空 outbox 草率解決。

### 4.5 未驗證歷史、補救與離開後再回來

- 恢復舊的 `debt-cap`／expired 且未取得客觀證據的需求時，以最新有效 self-rating、Review revision、
  最後曝光及 catalog 狀態判定；按最早仍未解決需求時間公平服務。
- selfRecalled 可重新入 verification；selfForgot 走 remediation，不把主觀不一致當成客觀失敗。
- 到 24 小時只終結舊工作，不等於已驗證或永久放棄該詞。若仍需驗證，建立有 predecessor／source link 的新工作；
  `eligibleAt` 可為現在（原接觸已超過 10 分鐘），不用先重看答案再等 10 分鐘。
- 舊 scored target 不重開；新 target 以當前 Review revision 建立，仍只接受一次答案。
- 上述 reconciliation 按 scope、容量及候選有效性分批執行；跨 scope 未結工作佔容量時，
  回傳可轉往該未完成 scope 的入口，不能顯示一個永遠不會自行解除的等待倒數。
- 不新增 learner state 的 mastery 捷徑；必須客觀答題才可增加解鎖進度。

### 4.6 新詞與重溫的服務公平性

不設定固定百分比。依序處理合法續接、迫近期限工作、到期／可驗證工作、補救／新詞等來源，
再按服務年齡避免同一來源無限霸佔。
保留 eligible work 最多等待 6 個其他已確認 items 的目標；等待時間冷卻、容量或離線不計作「有合法題卻沒服務」。
若有新詞容量、且非緊急工作長期佔據，首版建議在 6 個其他 acknowledged items 後保留一次新詞機會；
到期任務迫近 expiry 時先處理，並記錄例外。兩種保證衝突時，安全與迫近期限優先，不能聲稱無條件同時保證。

## 5. API、版本及資料變更範圍

### 5.1 等待是正常結果

`PublicStreamResponse` 增加可選 `availability`：

```ts
type Availability =
  | { state: "ready" }
  | {
      state: "waiting";
      reason: "verification-delay" | "capacity" | "cooldown" | "probe-rest" | "other-scope";
      nextEligibleAt: string | null;
    }
  | { state: "no-content" };
```

`nextEligibleAt` 是 server 計算的最早可能時間，重試仍重新判定；若容量取決於其他 scope／裝置就為 null。
HTTP 503／offline／同步 blocked 仍是錯誤，不能包裝成 waiting。
文案例如「進度已保留，可以稍後再回來複習」及「返回首頁」；有其他 scope 工作就提供入口。
保留重新檢查動作，避免高頻 polling；無強迫倒數、固定總題數或假完成頁。繁簡、明暗、鍵盤及讀屏同步驗收。

### 5.2 版本相容不能只改一個常數

建議新政策 ID `retrieval-v2`（學習政策，不是 UI flow；UI 仍是 V2）。
保持現有 quality mapping 與 item-construction version；用明確允許的版本組合驗證 provenance。
已建立的 work、target、item、receipt 按原版本處理；只在新的 issuance 邊界採新政策，不重寫歷史版本。
新 session 處理舊 work 時，target／item 的證據版本應沿用該 work 的合法組合；
不能由當前全域常數強制覆寫。跨版本容量與同詞冷卻仍是 learner-wide，舊工作也計入上限。

必須先更新雙版本 readers，再開新版 writer，包括：

- `catalog/runtime.ts` 的 objective provenance eligibility；
- `learning-reward-analytics.ts` 的 `REWARD_SUPPORTED_POLICY_VERSION`、encounter／target／obligation 檢查；
- 學生統計、weekly leaderboard、教師報表、export、API DTO 與 policy simulation；
- session pinning／rotation、global receipt replay 及舊 item recovery。

目前不少 reader 只接受 `retrieval-v1`；直接換常數會令舊成績或新版成績被排除。
不可為兼容接受任意字串。新版 admission／selection／quality／construction 的合法組合須列成表測試。

### 5.3 Schema 與 migration

本次分析未修改 schema。實作預計只需 expand：曝光查詢索引、工作 predecessor／deferred lineage（若現有來源欄不足），
以及實作 gate 證明必要的 reservation 表／欄位。先以具體查詢及併發 fixture 決定，不預設「完全不需 migration」。
新欄 nullable、歷史可讀；新 row 完整寫入；保留舊 receipt、target 及事件。不得 `db push`、改舊 migration 或 reset。

## 6. 驗證矩陣與 Definition of Done

| 情境 | 必須驗收的結果 |
|---|---|
| 20 同級合法卡／40 次選取 | 沒有固定 3 詞或 11 詞循環；同級持續合資格詞公平輪換 |
| 全新帳戶／全 selfRecalled／低於 10 分鐘 | 不超量引入新詞；每個接觸有明確任務或可追蹤延後；沒有靜默 debt-cap |
| 等待中反覆 reload／跨 scope | 不重複曝光同詞、不重設等待、不刷新公平排序 |
| 全部 Review 未到期 | 沒有普通填充卡；正常 waiting／no-content，無假完成 |
| 只剩 1、2、3 詞；只剩 due／obligation | 時間門檻可到達、能退出再回來；不靠兩張同詞填充卡解鎖 probe |
| 只有 probes，或大量 backlog＋新詞 | burst／休息規則、最舊 eligible work 服務及新詞機會符合版本規範 |
| 持續 selfForgot／客觀答錯 | 補救 dedupe、冷卻；不重答同 target，不直接增加 mastery |
| 離開 5 分鐘／11 分鐘／25 小時／7 日 | 保留進度；過期工作不冒充完成；回來可合法重新驗證 |
| 先 reveal 未自評，再換裝置 | 最後曝光冷卻仍有效；無法藉換裝置提早拿驗證 |
| 超過 640 encounters／640 候選 | 最新接觸聚合與 keyset 公平性成立；無固定前綴飢餓 |
| 兩個 scope／兩裝置同時發卡與提交 | 容量預留正確；無重複工作、重複得分、永久名額佔用 |
| 舊離線 action 在滿容量時恢復 | 原 action receipt 保留；成績不遺失；後續需求有 durable disposition |
| 混合舊／新 policy 及版本 rollback | 舊新有效成績皆保留；不支持的版本 fail closed |
| 題目不能構造、catalog 退役 | 有明確無合法候選原因；不重複洩漏答案或無限派壞題 |
| 繁簡／明暗／鍵盤／touch／恢復流程 | 等待可理解、可離開、重試不重送分數 |

指標分開看：最近 30 個已確認 items 的 distinct sense 數、同詞間隔分佈、各 selectionReason 佔比、
需要驗證但未入列數、最舊 eligible work 等待量、等待原因及錯誤率。
按候選池大小、global／unit、帳戶類型分層，不能要求一詞單元達到 20 個不同詞。
建立卡數不能冒充實際觀看次數；同詞不同 sense 也要另列 term-level 集中度。

完成定義：上述矩陣通過；新版 runtime 與模擬器共用 candidate policy 或通過等價 fixture；
單元解鎖、SM-2、獎勵及歷史統計無非預期變化；完整 required regression 與實際性能證據記錄在本文件。
本次模型重現不等於上述 DoD 已達成。

## 7. 分階段 checklist

### A. 本次分析交付

- [x] 建立獨立分支及定位現行 runtime，而非照歷史 prototype 推斷。
- [x] 重現未驗證詞及未到期舊詞循環、驗證容量缺口。
- [x] 核對參數耦合、模擬器差異、版本 reader 與解鎖限制。
- [x] 寫出修正方案、產品取捨、測試矩陣及發布方式。
- [ ] 取得 Vercel 部署 SHA 及測試帳戶近期派卡／work／Review 證據（憑證未具備）。

### B. 實作開始前

- [x] 使用者已確認方案，實作狀態改為進行中並更新生效 Contract。
- [x] 固定版本組合及等待／gap override／容量預留／遲交狀態表。
- [x] 以 cross-scope recovery fixture 確認既有 item 足以保存預留；本次無 schema migration。query plan 規模驗收仍列發布 gate。

### C. 本地實作與驗收

- [x] 補真正 DB 新政策回歸，修正 runtime 候選及公平歷史。
- [x] 完成容量、deferred／expired reconciliation、等待 API／UI 及版本 readers。
- [ ] 對齊 demo 模擬器與 runtime，補完整矩陣及多裝置長序列。
- [x] `npm test`、lint、typecheck、build、`test:db:stream-v2`、`test:e2e:card-motion`。
- [ ] 如有 migration：checksum、fresh replay、適用的 contract regression、Prisma generate。

### D. 發布與觀察（另行授權）

- [ ] 先部署雙版本 reader／相容 migration，再開新版 writer；確認實際 Vercel SHA。
- [ ] 以指定虛構帳戶驗證，與唯讀 baseline 比較上述分層指標。
- [ ] 通過 production config gate 並核對正式 workflow；示範手動部署另外記錄。

回退：關閉新版 issuance，使用仍能讀取兩版成績及重播兩版 receipt 的相容版本；
已派新 item 繼續按版本 drain／恢復，不回退到不認識新版 evidence 的舊 binary，不恢復 V1。
expand schema 保留，不做 destructive down migration。上線前必須演練此回退。

## 8. 實際驗證、限制及研究依據

本次分支已執行：

- `node --import tsx scripts/audit-study-selection.mjs`：完成兩個 runtime 候選 fixture 及兩個局部輪換對照；
  已確認 3 詞循環、5／15 admission 結果、窗口 10 只輪換 11 詞，以及最近接觸排序覆蓋 20 詞各兩次。
- `npx eslint scripts/audit-study-selection.mjs`：通過。
- `npm run check:plan-index`：通過，42 份 direct plans。
- `npm run check:markdown-links`：通過，68 份 tracked Markdown；另以路徑檢查覆蓋本次尚未 tracked 的新計劃 10 個本地連結。
- `git diff --check`：通過；沒有 runtime 或 schema 差異。
- 同一 `0dc8427` 基線在本次對話前一輪已執行 `npm test`：389／389 通過。
  本輪新增文件及獨立分析工具，沒有再次跑相同全套單元測試；既有 PASS 未覆蓋本次發現的長序列缺陷。

`audit-study-selection.sql` 已按 schema 靜態核對，尚未對線上帳戶執行。
診斷腳本刻意斷言舊缺陷仍存在，不能加入產品 PASS gate；修正後應以新的行為回歸取代它，保留此基線記錄。
本機沒有 `markdownlint-cli2`，未執行該工具；未以額外安裝改動開發依賴。
尚未進行完整 DB／browser integration、managed PostgreSQL 性能、
新版政策實作或真實學生評估；本地 `.env.local` 指向的庫不能冒充 Vercel Supabase。
線上可用 [`audit-study-selection.sql`](../scripts/audit-study-selection.sql) 作指定帳戶唯讀盤點；
SQL 的 `User.email` 是現行 Prisma `accountName @map("email")` 的實體欄名。

研究只支持方向，不直接給出本項目的比例／分鐘數：

- 外語詞彙實驗顯示，學會後重複提取對延遲回憶有幫助，自我預測不等於實際表現。
  本項目是選擇式認讀，不能直接聲稱相同效果量或視為自由回憶測量。
  [Karpicke & Roediger, 2008，原作者大學 PDF](https://learninglab.psych.purdue.edu/downloads/2008/2008_Karpicke_Roediger_Science.pdf)。
- 間隔效果取決於希望保留多久；沒有從該研究直接推出 40/60 或最近 10 題不重複的依據。
  [Cepeda et al., 2008，期刊論文](https://doi.org/10.1111/j.1467-9280.2008.02209.x)。

決策：保留已驗證的 server scoring／長期排程邊界，先修復短期候選、需求完整性與等待行為；
具體新參數作版本化驗收，教學有效性留待另外獲授權的評估。


## 9. 實作決策與本輪結果（2026-11-02）

- 新 issuance 使用 `retrieval-v2`；舊 item／work 採其原政策，quality／construction 不變。
- 由既有未提交且可恢復 item 推算容量預留，不另建 reservation 表；過期 session 如有未完成 item，
  GET 可原身份續接，撤銷的 session 仍不可恢復。跨 scope 入口及並發派卡已新增 PostgreSQL 驗證。
- 需求補入使用 `StudyEncounter.operationId`／scored `ReviewEvent.operationId` 作來源，
  保留舊 work 作歷史；明確 CANCELLED／SUPERSEDED 的來源不自行復活。
- 查詢不再先截斷 640 個最早接觸；目前按 scope 載入候選及最新 encounters，曝光以 groupBy MAX 聚合。
  大量資料的 managed PostgreSQL query plan／容量量測仍是發布前 gate，不能以小型本地 fixture 冒充。
- 同級候選依最近接觸排序；同詞在等待驗證中不重發普通卡，未到期 Review 不再補位。
- demo 模型以可選 `retrieval-v2` 參數測試新政策節奏；預設舊模擬版本保持可重播，未重建或覆寫既有示範資料。
  尚需增加 runtime／simulation 完整等價 fixtures，不能宣稱兩者已完全等價。
- 基線 audit 工具改為讀取 `git show 0dc8427` 的舊 server source，仍可重跑原缺陷；新政策行為由新回歸驗收。

目前已通過：新增 PostgreSQL capacity／delay／冪等／跨 scope 預留／過期 session／expired work renewal 回歸、
395 個單元測試、既有字卡及瀏覽器回歸 90 passed／4 skipped。新增等待畫面測試、最終建置及既有大型 DB suite 亦已通過，詳見下方紀錄。
計劃保留完整 simulation 等價及大型資料效能 gate，尚未標成整體完成。

本次不需要 schema migration，故沒有執行 db push、migration deploy 或資料庫 reset。
Production／Vercel 部署、線上帳戶核實、真實學生及完整原生讀屏驗收仍未執行。


### 最終本地驗收紀錄

- `npm test`：395 passed；`npm run lint`、`npx tsc --noEmit`：通過。
- `npm run build`：通過；首次沙箱禁止 Turbopack worker port，使用獲准權限重跑成功。
- `npm run test:db:stream-v2`：通過。已把舊強制補位卡 fixture 改為驗證合法 probe、pending work 身份；
  手動回撥到期日的 fixture 同時推進曝光時間，保留 stale target、CAS、credential 及 recovery 競態測試。
- `node --import tsx scripts/check-study-selection-v2.ts`：通過，容量、延遲、客觀冪等、未到期不補位、
  跨 scope 並發預留、過期 Learning Card session 續接及 expired work renewal。
- `npm run test:e2e:card-motion`：90 passed／4 skipped（Chromium／Firefox synthetic／WebKit／mobile motion 及 study）。
- 大型 DB suite 首次被 Node assert 的 source extraction 卡住；擷取堆疊後中止，加入明確 assertion 訊息再遷移 fixture。
  該次殘留的單一隨機測試帳戶已按精確 ID／隨機帳戶名清理，其餘測試均以 finally 清理。

保留未勾選的完整 simulation 等價／大型 managed PostgreSQL 性能與發布 gate；本地核心實作通過不代表線上已更新。

- 最終等待 UI Chromium 專項：2 passed（含登入）；返回首頁、未完成單元入口及無卡狀態均通過。
