# 新詞引入、初次驗證與間隔複習重設計

> 狀態：已完成（本地實作及驗收；使用者已批准測試後 commit 及 push）。
> 日期：2026-11-02；基線：`codex/study-stream-selection-analysis`／`45b67be`。
> 使用者要求：重新設計三個階段，避免新用戶完成五個詞後被迫等待十分鐘。
> 現行程式及歷史驗收見 [上一版方案](./study-stream-selection-improvement.md)；生效規範仍見
> [Learning Contract](./retrieval-first-learning-contract.md)。本提案不代表已發布。

## 1. 問題與決策

上一版修好了無目的補位及遺漏驗證，卻把「未做首次驗證」和「等日後複習」共用五個工作名額，
再加十分鐘硬延遲，與產品的 1–10 分鐘碎片學習場景衝突。只增加名額或縮短分鐘數仍會保留相同耦合。

建議把五個名額改為**尚未完成首次客觀試答的新詞窗口**。首次試答以其他詞的穿插作間隔，
答對或答錯都移出窗口，並安排日後的到期複習。初次答對只代表一次短期認讀成功；
長期掌握仍須多次到期答對，不能靠同一場不斷重答取得。

目標：有已解鎖、可構題的新詞時，學生能持續「接觸 → 試答 → 引入下一詞」；
每個引入的新詞有可追蹤後續；失敗不鎖住窗口；到期複習有穩定服務機會。

非目標：無限供應新詞、開放未解鎖單元、更換 SM-2、改正誤 quality 4／2、
自評計掌握、把詞彙認讀當自由回憶測試、研究收集、重設資料或部署。
「持續前進」以仍有合法內容為前提；整個已解鎖詞集用盡且尚未到期時，合理地暫停。

依賴：[現況基線](./artifacts/retrieval-first-v2-current-product-baseline.md)、
[項目計劃](./project-plan.md)、[一致性及恢復](./study-stream-consistency-and-recovery-audit.md)、
[整頓計劃](./project-consolidation-and-student-handoff.md)。

## 2. 三階段規則

| 階段 | 做甚麼 | 完成條件及後續 |
|---|---|---|
| 新詞接觸 | Learning Card：先回想、長按揭示、如實自評 | 兩種自評都安排一次初次驗證；不改 Review 或掌握 |
| 初次驗證 | 穿插其他詞後出選擇題，由 server 判第一次答案 | 正誤都結束該詞的初學工作；首次 Review 間隔為一天，答錯保留失敗及較低 ease |
| 到期間隔複習 | 到期直接出選擇題，事前不展示同詞答案 | 答對按現有 SM-2 延長；答錯回到一天、重置連續成功；feedback 糾錯後繼續其他詞 |

### 2.1 窗口與進入條件

- `maxPendingInitialWords=5` 是尚未試答詞數的上限，不是本次／每日最多學五詞，也不是要五詞全對。
- 包括已發但未提交的首次 Learning Card 預留；跨 session、scope、裝置共用、按 sense 去重。
- 已有未來 `Review.nextReviewDate` 的詞不佔這五個名額；到期題亦不預留初學名額。
- 客觀答案成功提交時，初學工作即終結；該 session 仍須確認 feedback 才前進。
  交易失敗、無效答案、只揭示或只離開，不會假裝完成。
- `selfForgot` 代表揭示前沒有想起，學生已經看過答案；不能因此永遠只派認讀卡而不給第一次試答。
- 初學工作不會因過二十四小時自動變成已完成。離開再回來續接原需求；技術 lease 可過期，
  需求不能消失。沒有分鐘倒數要求學生一直留在頁面。

### 2.2 初次驗證：隔詞，取消十分鐘硬門檻

初始政策 `initialOtherTermGap=2`：自最後已知答案曝光後，完成至少兩個**不同的其他英文詞**，
便可試答。Learning Card 完成及其他詞的 objective feedback 確認各可提供一個間隔；
同一詞重複操作、同拼寫不同 sense、reload、receipt replay、未完成項目不增加不同詞數。

這是每個詞自己的就緒條件，不是固定「每三張卡測一次」；中間可以是新詞或到期複習。
初次驗證不再要求同時等十分鐘。離開滿十分鐘可作另一個就緒條件，避免返回時還要刻意湊詞。
時間和不同詞間隔是 **OR**，不是 **AND**；此十分鐘是返回時的後備條件，不是正常操作的等待。

細詞集／尾段：如果沒有其他合法項目可補足間隔，出最早未試答詞的一次初次練習，
記 `small-pool-initial-check` 及實際間隔；不得抽未到期詞補數。只有一詞時可以是零間隔，
它仍只是一道初學認讀練習，不能稱為延時保留測驗。只做一次後等待真正到期，不能 ABAB 填充。
跨裝置未提交項目或其他 scope 的預留不是「詞集用盡」；應續接或提供未完成項目入口。

### 2.3 答錯如何處理

- 保存第一次錯誤，顯示正確選項及既有詞義 feedback；不原地重答、不覆寫錯誤。
- 釋放初學名額，把下一次客觀複習排到一天後；不重新建立會佔初學窗口的 remediation。
- 本提案第一版以 feedback 完成當次糾錯，**不自動安排同一輪的第二次計分測驗或反覆認讀卡**。
  這是限制無效循環的產品取捨，並非宣稱所有錯詞一天後才重學是教學最優。
- 反覆失敗的詞仍按日後到期結果反映困難；不可因窗口釋放而標成認得、長期掌握或取消未來複習。
- 若未來加專項補強，應是明確、有限次的練習流程，與到期計分分開；本次不順帶實作。

### 2.4 長期間隔與統計

- 保留 `updateSM2At` 的正確 quality 4／錯誤 quality 2；初次正常建立 Review 時兩者的 interval 都是一天。
  正確 repetitions=1；錯誤 repetitions=0 並降低 ease，故後續間隔不相同。
- 例如一路正確：初答後隔 1 天、下一次後隔 6 天、再後隔 15 天、再後隔 38 天。
  這是相鄰複習的間隔，不是第 1／6／15／38 天；遲到以實際作答時間重排，不補刷遺漏次數。
- 只有到了 `nextReviewDate` 的新 target 才能再推進間隔，不能在同一場連答幾次便升到 6／15 天。
- 初次驗證與到期驗證必須可分辨：按 target purpose／policy 保存或明確增加 phase；
  初答正確率和延時複習正確率分開展示，既有合計須明稱整體認讀表現。
- 現行單元解鎖使用 repetitions≥1 的「認字率」80%；長期掌握是 interval≥22 天。
  首答成功仍可貢獻認字率，不能改名成長期掌握；首答錯誤不能解鎖。
- 到期題避免先展示同詞答案；若並發或舊 action 又曝光答案，須記錄曝光、重新判斷 target eligibility，
  不把受提示的短期表現誤當完整長間隔證據。這項須以真實 DB race 驗收，概念模擬不涵蓋。

## 3. 新舊內容如何穿插

首版採可跳過空來源的服務輪次：`初次驗證 → 到期複習 → 到期複習 → 新詞`。
首次進入從新詞位置開始；cursor 按 learner 的已確認 action 持久化，GET／重送不推進。

- 沒有舊詞時自然跳過兩個複習位置，先引入足夠其他詞，再交替初驗與新詞。
- 有積壓時，給到期複習較多服務機會，同時保留新詞位置；新詞仍受五個初學名額限制。
- 滿五詞時只跳過新詞位置，繼續服務初驗／到期題；首次試答不論正誤都可釋放名額。
- 初驗選最早仍待試答者，到期題選最早到期者，新詞按現有合法 scope、未接觸及穩定排序。
  維持最新接觸公平排序修正，不藉純隨機掩蓋候選缺漏。
- 所有來源沒有合法項目，才考慮細詞集的一次初驗降級或真正暫無內容。
- 取消「連兩道選擇題後強制等六十秒」。只有到期題時可繼續答，學生始終可安全離開。

這是來源服務次序，空來源會跳過，並非對每個學生強制固定百分比。兩個複習位置是保護舊詞服務量的
初始工程取捨，並非研究得出的最佳比例；仍需觀察實際到期工作量，不能保證任意新增速度的 backlog 都下降。
暫不加入根據幾次錯誤就鎖新詞的規則，避免又出現「不答對不能前進」。

穩定候選、無續接／安全阻擋時，每個來源最長一輪有一次機會；最多五個初驗詞依 FIFO，
已持續合資格的初驗詞最多經過 19 個其他已確認項目便服務。這取代舊的六項服務承諾，
不可同時聲稱仍有六項上限；真實 runtime 還須驗證跨 scope、舊工作及構題失敗的排除條件。

### 3.1 全新用戶例子

```text
學 apple → 學 book → 學 cat → 驗 apple
→ 學 dog → 驗 book → 學 egg → 驗 cat → 學 fish …
```

驗 apple 答錯也能繼續 dog；apple 的錯誤被保存，feedback 提供糾正，一天後再試。
這條線不是固定一批五詞，也不用等十分鐘。未試答詞維持小窗口，已試答詞累積到未來複習池。

## 4. 實作範圍與相容處理

建議新政策 `retrieval-v3`，UI flow 仍為 V2。不要改寫已推送 `retrieval-v2` 的歷史定義。

1. 先更新 Contract 及版本 readers，再接新版 issuance；quality／題目構造版本維持明確 allowlist。
2. 拆開初學容量與未來 Review，將新詞兩種 self-rating 統一到首次驗證；移除新版答錯自動建立 remediation。
3. 來源輪次 cursor、最後曝光後不同詞數及首次試答 phase 需要 durable、跨裝置一致的依據。
   須由 prototype 決定沿用 ledger 推算或加小型 expand projection；不能用 session 陣列或僅看最近兩項代替。
4. 舊未發出的工作可在新 issuance 邊界作具來源連結的 supersession，再進新版初驗／Review 路徑；
   保留原 row、原原因及未解決需求。已有 target／item 按原 version 恢復與結算，不換題覆寫。
5. 舊 remediation 若已有客觀錯誤和未來 Review，不占新版初學窗口；若從未客觀試答，轉初驗需求。
   已被正式 cancelled／superseded 的需求不得盲目復活。舊未發 work 不能以十分鐘 gate 永久卡住新版窗口。
6. 中斷、過期、兩裝置搶答、離線舊 self-rating 均須保留 receipt、credential lineage、Review CAS、
   一 target 一次分數；初驗角色與預期 Review revision 衝突時重新協調，不能把成熟詞當初學重設。
7. 首答／到期分析、獎勵、單元認字率、教師 export 及 demo simulator 一併核對。歷史缺 phase 留 unknown，
   不追溯假設所有舊證據都是延時驗證。

發布：僅在下方 runtime gates 完成後才考慮合併；Vercel 部署另行處理。
相容版本須能讀取三版及重播舊 receipt；回退只停止新 issuance，保留已派 v3 item 的恢復能力。
如需 schema 只做 expand migration；不改已套用 migration，不 reset，不 destructive cleanup。

## 5. 驗收矩陣、風險與完成定義

| 情境 | 預期 |
|---|---|
| 全新／全答對／前十分鐘 | 首次驗證不用等十分鐘；持續引入第六詞及以後；初學窗口≤5 |
| 全新／全 selfForgot／全答錯 | 每詞有初次試答；錯誤不鎖五詞；未來 Review 保留錯誤；不增加認字率 |
| 部分答錯 | 正誤皆釋放名額；同 target 不重答，同詞不在 due 前再次計分 |
| 大量到期＋新詞 | 到期和新詞皆有服務機會；不要求清空積壓才可學新詞 |
| 只有到期題 | 可連續處理，沒有第兩題後的六十秒硬等待 |
| 單元只有 1／2／3 詞、尾段 | 初驗可降級間隔並記原因；每詞不無限重複；所有內容已完成初答才正常等待 |
| 全錯且已解鎖詞用盡 | 不能越過既有解鎖規則假造新詞；說明下次複習，不稱全部已學會 |
| 離開 5 分鐘／11 分鐘／數日 | 原需求保留，跨 session 間隔及 cursor 不清零；不強迫重新看卡 |
| 跨 scope／裝置預留五詞 | 不另開五詞、不永久佔位；能找到並續接未完成項目 |
| 舊新政策／離線／並發曝光 | 原有合法分數不遺失；無重複得分、錯誤 phase 或受提示的間隔膨脹 |
| 初答後 1／7／22 天按時全對 | 相鄰間隔 1／6／15／38 天；同日刷新不提升 mastery |
| 1,000 項長序列與大型 DB | 公平輪換、工作量、query plan 與真實 runtime 等價，非只看模擬器健康 |

風險：短期選擇題仍受近因及猜測影響；首答不能宣稱長期記住。錯詞僅 feedback＋日後複習的效果需實測。
保持進度不等於應無限制增加每日新詞，未來 Review 仍會累積；本版不把「未來有工作」又塞回五詞硬上限。
詞庫干擾選項品質及相同英文不同 sense 的提示污染，要與排程問題分開分析。

### 分階段 checklist

- [x] 核對五詞／十分鐘耦合、自評 admission、SM-2 及兩種掌握口徑。
- [x] 固定三階段規則、答錯出口、細詞集及來源服務方案。
- [x] 以可重跑概念模型驗證正常／全錯／backlog／細詞集／跨日序列；記錄實際結果。
- [x] 更新生效 Contract、明確 phase／cursor 資料契約、完成真實 scheduler。
- [x] 接 runtime、API、必要 UI／reader／simulator；補單元、DB 並發及跨版本回歸。
- [x] 通過 `npm test`、lint、typecheck、build、兩套 study DB suite、`test:e2e:card-motion`。
- [x] 核對本次不需 schema migration，未執行 migration／reset／seed。
- [ ] managed DB 性能與發布前差異核對；生產發布及真實學生驗收另列。

設計交付完成條件：規則自洽、模型反例通過、限制及實作範圍寫清楚。
功能完成條件：真實 runtime 通過上表與可靠性驗收、更新現況文件；模型通過不等於功能已完成。

## 6. 依據與驗證紀錄

研究支持重複提取及跨時間學習的方向，沒有直接證明「五個名額、隔兩個詞、兩次舊詞位置」是最優參數。
提案把它們作可調整的版本化工程起點，避免上一版只因沿用舊常數就當成合適產品設計。

- [Karpicke & Roediger, 2008，作者大學 PDF](https://learninglab.psych.purdue.edu/downloads/2008/2008_Karpicke_Roediger_Science.pdf)：
  外語詞對研究支持重複提取對延遲回憶的價值，不能直接套用其效果量到本產品選擇式認讀。
- [Cepeda et al., 2008](https://doi.org/10.1111/j.1467-9280.2008.02209.x)：
  合適間隔與目標保留時間相關，不能據此推出所有初次測驗都須等十分鐘。
- [SM-2 作者說明](https://www.super-memory.com/english/ol/sm2.htm)：
  間隔序列的來源。本文沿用項目現有更新函數，不宣稱實作完整照搬原版全部流程。

上述設計輪次僅有文件及概念工具；後續獲准的實作驗收見第 8 節。

可重跑：`node --import tsx scripts/simulate-learning-phases.mjs`。
[概念模型](../scripts/simulate-learning-phases.mjs) 使用提案的選取規則及真實 `updateSM2At`；
每項固定十二秒、同詞只有一個 sense、scope 固定，沒有 DB／lease／解鎖／真實學生能力模型。

| 實際通過情境 | 結果 |
|---|---|
| 全新全對、全忘全錯、部分錯，各五十項 | 各引入 26 詞、初驗 24 次；窗口最高 3；首次初驗於第 48 秒完成；無強制等待 |
| 已有一百到期詞，一百項混合 | 26 新詞、24 初驗、50 到期；窗口最高 2 |
| 強制初始五詞待試答，第一次答錯 | 成功釋放一名額並引入第六詞；繼續 30 項沒有阻塞 |
| 只有三十到期詞 | 連續完成三十題；沒有兩題後強制休息或補位卡 |
| 1／2／3 詞單元全錯 | 分別完成 2／4／6 項後正常無內容；每詞一次卡＋一次初驗，均保留未來 Review |
| 返回 5／11 分鐘 | 分別可繼續新詞／直接初驗；唯讀選取不推進 cursor 或需求 |
| 跨日正確，再一次到期錯誤 | 真實 SM-2 產生 1、6、15、38 天；錯後回一天及 repetitions=0，初學窗口不增加 |
| 一千項混合正誤 | 251 新詞、249 初驗、500 到期；窗口最高 2，無停滯 |

這些數字是時序可行性證據，不是建議每十分鐘學二十六詞，也不證明教學效果。
目前模型下最長持續合資格初驗被略過 6 項，低於提案 19 項保守界限；不冒充所有 runtime 交錯的證明。

已執行：模型 assertions、專項 ESLint、`check:plan-index`（43 份 direct plans）、
`check:markdown-links`（69 份 tracked Markdown）及 `git diff --check` 均通過；
新計劃尚未 tracked，另外檢查其本地連結。
未執行：整套 `npm test`、build、DB／browser／migration suite，因本輪僅有設計文件及獨立概念工具，
沒有變更 production TypeScript、UI 或 schema。下一輪 runtime 實作不能沿用本輪結果代替 required regression。

## 7. 實作決策（2026-11-02）

- 使用既有 ledger 保存輪次：v3 item 的 `selectionOverrideReason` 帶 `phase-lane:N`，只以 learner 最新已確認項目推算下一位置；未確認／GET／receipt replay 不推進。
- 初驗用既有 `EVIDENCE_OBLIGATION` purpose（v3 明確代表初驗），到期用 `DUE_REVIEW`；不新增 schema。兩種自評均建立初驗需求。
- 間隔讀 learner-wide 最近十分鐘已確認項目及最後曝光，按正規化英文拼寫計不同詞；超過十分鐘直接就緒，不依賴截短的 session history。
- v3 工作以長期可保存的 expiresAt 保留需求；舊未派工作以 SUPERSEDED 及來源 operation 關聯後繼，已有發卡保持原版本續接。
- 初驗工作／新詞預留獨立計五詞容量；已有 Review 的舊補救不阻塞新詞。到期字仍受最後已知曝光冷卻保護，並對 issuance 後的額外曝光重新協調。
- 必要回歸涵蓋真實新手持續學習、全錯、細詞集、到期單獨、跨 scope／receipt／舊政策及曝光競態；不以概念模型代替 runtime。

## 8. 本地實作驗收（2026-11-02）

新 issuance 已使用 retrieval-v3。初驗 purpose、輪次、間隔、正誤釋放及未來 Review 均接入 server transaction；
既有 target／item／receipt 按原版本恢復。未派舊 work 用 terminalReason=phase-transfer、原 sourceOperationId
及 successor selectionReason 保存轉移關係。初驗工作 expiresAt 使用 9999-12-31 作需求持續保存的 sentinel，
與仍可過期的技術 lease 分開；不依賴背景工作在二十四小時後重建需求。

- 初驗及到期以 purpose＋retrieval-v3 分開；統計增加 initial／due／unknown 的嘗試、答對及正確率，
  教師學生詳情及匯出可分辨兩階段。舊資料保留 unknown，既有整體認讀合計不追溯改寫。
- runtime、demo-school 的 v3 模式及概念工具共用真正 scheduler／間隔純函數；demo 預設歷史版本不變，
  沒有重建示範學校。模型不模擬 DB 競態及目錄解鎖，不能宣稱完整候選查詢均與模擬器逐筆等價。
- 發題後其他舊裝置又揭示同詞答案時，scoring 拒絕受提示的 target，GET 退役後重排；原合法 receipt 仍可重播。

實際通過：

- `npm test`：401 passed，含不同拼寫間隔、來源輪次、十九項服務界限、細詞集、phase 統計及 demo 重播。
- `npm run lint`、`npx tsc --noEmit`：通過。
- `npm run test:db:selection`：真實新手全對／全忘全錯、滿五詞錯後引入第六詞、細詞集、
  1／6／15／38 天及錯後一天的 server scoring、未到期不再計分、冪等、僅到期、曝光競態、
  並發 scope、過期卡 session 恢復、舊任務轉移、失效／已刪詞及 orphan target 退役均通過。只建立／清理隨機本地測試帳戶。
- `npm run test:db:stream-v2`：既有大套件通過；將已取代的補救／等待預期遷移為初驗及未來 Review，
  保留已派舊補救的跨 scope 接管、expiry／terminal、credential lineage、CAS 及 recovery 回歸。
- `npm run test:db:weekly-leaderboard`：通過。
- `npm run test:browser:outbox`：Chromium／Firefox／WebKit 各十輪並發 enqueue／remove 通過。
- `npm run test:e2e:card-motion`：含 build，96 passed／4 skipped；primary 68、兩組 WebKit 各 14。
  Chromium／WebKit 均以新建學生、真實登入及實際字卡長按操作完成全錯後學第六詞；
  教師階段展示亦通過，390px 截圖已目視確認無溢位。四項沿用既有 gesture skip。
- 概念工具已改為呼叫真正 scheduler，模型仍通過；文件索引、本地連結及 diff 空白檢查通過。

首次 browser 新測試因 Playwright 不載入應用 tsx alias 而失敗，已改用相對 generated client 的測試 fixture；
之後獨立新案例 3 passed，再重跑整套通過。首次沙箱 DB／Chromium 連線或啟動被拒，均以獲准權限重試通過。

限制：沒有量測大型託管 PostgreSQL query plan，沒有 Vercel 部署／線上帳戶核實、真實學生學習成效、
完整原生手機／screen-reader 驗收。這些為發布／觀察後續，不能由本地 PASS 自動勾選。

### 無法服務的初驗需求

最終檢查補充：未發出 presentation 的初驗 work，若詞已不在目前 catalog 或已無法安全構題，
在同一交易標記 CANCELLED／content-unavailable，保存來源而不當完成；釋放名額給其他合法新詞。
已派且可恢復的 presentation 保留原身份，不能以此路徑取消合法已提交的答案。
跨 scope 的合法工作仍占名額並可續接，不能把 scope 不同誤當詞已失效。
