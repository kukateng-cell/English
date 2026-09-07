# 學生每週排行榜與個人目標重設計

狀態：已完成（本地核心實作及驗證；原生視覺／大型DB效能列後續）

建立日期：2026-09-08

工作分支：`codex/student-leaderboard-motivation`

來源分支：`codex/teacher-learning-reward-index`

## 1. 背景、授權及目標

使用者希望排行榜更能鼓勵中學生持續使用 App 學習，已要求建立獨立分支及詳細實施計劃。討論方向為：預設本班每週榜、正式排名佔主要篇幅、突出自己及附近同學、加入不依賴名次的個人目標，歷來成果降為次要內容。本輪已在新分支完成本地核心實作、資料清空重建、API／頁面及自動化驗證，並將隨本次提交推送。使用者已明確確認目前只在local開發，所有本地舊資料均可徹底刪除及重建；後續實作不需要再次為同一範圍的本地清空重建請求授權。

現行頁面同時呈現三個範圍 × 三個指標，時間概念不一致：客觀認讀連續天數是目前 streak；掌握詞數是目前 Review interval ≥22 的詞數；打卡是歷來不同 StudyDay 日期數。CURRENT 學年限制參賽名冊，並不把以上所有指標改成本學年累計。詳細榜只保留前20列及自己，後段學生看不到附近同學。

### 1.1 目標與成功準則

- 學生入排行榜首屏可理解「同誰比、哪一週、自己多少分、目前第幾名」。
- 正式榜單是頁面主體；本班可查看所有同學，年級／全校可查看前列、附近及更多名次。
- 正常使用時每週重新計分，不因週切換刪除學習紀錄；週內努力不因漏學一天歸零。開發期間的明確reset／reseed則可清空全部本地舊資料，兩者是不同操作。
- 肯定投入及客觀認讀成果，不把分數稱為能力、正確率、進步幅度或長期掌握度。
- 未入前三名的學生仍可完成每週個人學習日目標。
- 同一資料、日期、eligibility、權重及 policy 下，學生榜分數與教師報告完全一致。
- 繁簡、明暗、手機／平板／桌面、鍵盤及語音閱讀有明確驗收。

### 1.2 非目標

- 不修改 scheduler、SM-2、Objective Probe 頻率、手勢、單元解鎖或 study action writer。
- 不新增虛構對手、升降級聯賽、答題速度排名、無限刷分、排行榜加分道具。
- 第一版不做歷史週冠軍存檔、永久獎章、自選每週目標、教師公開榜權重設定、推播或研究 telemetry。
- 不重設 App 首頁；沿用已有排行榜入口，必要時僅改入口說明。
- 不改教師既有累積分及匯出規則，不把公開榜分數自動兌換科目成績。
- 本計劃不包含production部署、線上資料遷移、灰度開關、線上觀察或發佈gate；完成標準只看local實作及驗收。真實學生pilot／研究收集不在本輪範圍。

## 2. 現況及依賴盤點

| 位置 | 現況 | 本計劃處理 |
|---|---|---|
| `src/lib/leaderboard.ts` | CURRENT cohort、三項舊指標、competition rank、Top20+self | 直接改為weekly reader，移除只供舊榜使用的聚合及DTO |
| `src/app/api/leaderboard/route.ts` | requireUser、scope enum、nickname-only、no-store | 直接替換為weekly API contract，前後端同批更新，不保留舊response相容層 |
| `src/app/(student)/leaderboard/page.tsx` | 三範圍概覽及三指標榜 | 新頁面以本週榜為主 |
| `src/lib/learning-reward-policy.ts` | reward-v1、每日20次投入／5個成功詞義、milli-points | 直接共用已驗證純計分函數 |
| `src/lib/learning-reward-analytics.ts` | 教師授權、範圍、完整候選、provenance、coverage、snapshot | 抽取授權無關的 activity reader／aggregation；不向學生開放教師入口 |
| `src/lib/session.ts`、名冊 helpers | session、role、current enrollment | 新 API 重用並重驗權限 |
| `prisma/schema.prisma` | 現有 events、encounters、StudyDay、enrollment | 可清空重建本地DB；schema按功能需要調整，使用可重播migrations建立乾淨基線 |
| `plans/retrieval-first-learning-contract.md` §9 指標 | 明訂教師 reward 不等於 student leaderboard | 實作前修訂新 weekly reward projection 邊界 |
| current-product-baseline、舊 leaderboard plan | 舊榜 self-rating 不改排名 | 加入 dated successor 說明；不得悄悄改寫歷史驗證 |

前置閱讀亦包括 `plans/README.md`、`plans/project-plan.md`、`plans/teacher-learning-reward-index.md`、`plans/teacher-reward-summary-usability.md`、`plans/student-leaderboard-scopes-and-overview.md`。

## 3. 建議產品決定（本計劃採用的預設，尚待整體確認）

| 決定 | 第一版方案 | 理由／限制 |
|---|---|---|
| 主榜 | 本週學習分，預設本班 | 每週有新起點，範圍較貼近日常同學 |
| 週期 | 本地星期一00:00至下一星期一00:00，左閉右開 | 日期可理解，查詢避免邊界重複 |
| 固定權重 | 投入70%、成果30%，全校各範圍一致 | 偏重持續投入；是產品建議，不是研究證實的最佳比例 |
| 每日上限 | 沿用 reward-v1：投入20次、成果5個成功詞義 | 與教師來源一致，減少單日刷量收益 |
| 排名 | 正分 competition rank；0分未上榜 | 不讓全班0分同列第一；同分不比較速度 |
| 個人目標 | 每週學習4日，當日至少1次合資格活動算1日 | 第一版易理解；屬參與目標，不宣稱充分學習 |
| 週中加入 | 原分累積；目標=min(4,本週可參與日數) | 不按日均分放大短期分數；標明本週加入 |
| 累積成果 | 只展示自己的歷來打卡及目前掌握詞數 | 舊客觀 streak 榜退出新主頁，避免延續九排名負擔 |
| 歷史週 | 第一版只查本週，無永久結算／過往冠軍 | 現有資料無凍結歷史名冊與成績快照 |

70/30、4日及每日至少1次均須在 Phase A 算例與設計評審中確認。若使用者改選50/50等，先改本計劃、policy及算例再實作，不混用不同預設。

## 4. 計分與學習語義

### 4.1 固定政策

新增 `student-weekly-v1` 作公開榜政策，引用固定 `reward-v1` validator bundle；不得因修改「current policy」常數而暗中重算成另一套規則。教師端仍可自由選其既有權重；只有選相同70/30、日期、eligibility、資料cutoff時應與本榜相同。

每日：

```text
Ud = 合資格完成認字卡次數 + 合資格首次客觀作答次數
Cd = 同詞義當日第一個合資格客觀結果答對的詞義數
投入分 = 10 × min(Ud,20)/20
成果分 = 10 × min(Cd,5)/5
本日學習分 = 投入分×70% + 成果分×30%
本週學習分 = Σ本日學習分（每日最多10分，完整一週最多70分）
```

全程整數 milli-points；排序不使用浮點或格式化字串。70/30下分數最多3位小數，UI可去除尾零，但不得四捨五入到令不同分數看似同分。

| 當日情況 | Ud | Cd | 預期學習分 |
|---|---:|---:|---:|
| 完成1張卡 | 1 | 0 | 0.350 |
| 1個詞義當日首次客觀作答正確 | 1 | 1 | 0.950 |
| 1次客觀作答錯誤 | 1 | 0 | 0.350 |
| 20次活動、3個成功詞義 | 20 | 3 | 8.800 |
| 40次活動、8個成功詞義 | 40 | 8 | 10.000 |
| 只有打開App／揭示未完成 | 0 | 0 | 0 |

同詞義當日先錯後於另一合法target答對：投入可增加，Cd仍為0。隔日第一個合資格結果可再次計成果。同一streamItem／target重送、refresh、重取receipt不得重複計。正式補救新卡沿用reward-v1投入規則；不因重複詞義削減投入，亦不宣稱完全防刷。

### 4.2 必須先更新的 contract

目前規範排除學生榜使用認字卡投入。新提案明確新增「已確認完成活動可產生獨立 weekly reward 投入分」，不是把self-rating值當客觀證據：

- selfForgot與selfRecalled完成相同合資格活動時分數完全相同。
- 只有客觀first response可推進scored ReviewEvent、SM-2及掌握狀態；本榜不寫上述資料。
- reveal、swipe本身、research、未確認動作不產生額外分數。
- 原有客觀streak／Review／教師analytics語義保持，只有新reward projection依本政策計分。
- 以實際兩種自評完成流程驗證獎勵相同，並比較Review及scored events無新增副作用。

### 4.3 日期、名冊與週目標

- `now`／`asOf`由server產生及可注入測試clock；不信任client日期。
- 所選週與CURRENT學年起訖取交集；學年週中開始／結束時顯示實際參與日期。
- 每人計分起點=max(週起點、學年起點、當前enrollment.startedAt本地日)，僅截至asOf；終點為週末與學年終點較早者。
- 個人目標可參與日數計到有效週末，包括尚未到來的日子；不能只計到今日而令週一目標變1日。
- 沒有CURRENT年、年尚未開始或已結束無新CURRENT年：顯示本週榜未開放，不沿用舊年末分數當本週。
- 本班／年級／全校由當前有效enrollment推導。無班有年級預設年級；無有效enrollment不得列入榜。
- 轉班依當前班籍歸組，保留當前enrollment資格窗口內本週活動；若名冊流程建立新enrollment，採新startedAt，與教師reward一致。不是歷史班籍競賽。
- 停權／離籍者移出cohort。startedAt缺失時沿用教師reward學年起點fallback並把coverage納入待核對，避免默認完整公平比較。
- 本週活躍日由合資格reward活動推導，不用StudyDay單獨加分。不因漏學一天扣掉已得分或已完成日。
- 顯示「已完成3/4日」「本週目標已達成」；目標完成不額外加榜分。週中加入提示「本週加入，目標按可參與日數設定」。
- 不用登入時長、答題速度或單純打開App表示努力；系統未派客觀題不解讀成學生拒絕作答。

## 5. 排名、同分與資料完整性

### 5.1 排名規則

- 僅對totalMilliPoints>0且無已知資料缺口的學生排名，降序competition rank，例如1、1、3。
- 同分顯示「並列第N名」。server内部ID僅作穩定排列，不作高低名次依據、不回傳公開ID。
- 0分顯示「本週尚未上榜」，放在已上榜者後；完整榜可看到其暱稱，但不公開他人的學習日曆或缺漏原因。
- 回應區分eligibleCount、rankedCount、unrankedCount。所有人0分時顯示本週尚未有人上榜，不出現金牌。
- 前列展示前3個rank層級（rank≤3）的並列者，避免只按陣列前三列發錯獎牌；大量並列用緊湊列表／展開，不用巨大頒獎台。
- gapToNext=最接近且嚴格高於自己的分數−自己的分數；同分同學不算「前一名」。第一名（含並列）不顯示差距；0分及待核對亦不顯示。
- 「距離前一名目前差X分」不是保證追上或超越；不顯示「再答N題必定升名次」。

### 5.2 coverage處理

完整重用reward-v1分類，讀取候選不可先inner join／filter消失壞紀錄。

- `validationGapCount>0`、`KNOWN_GAP`、eligibility起點不明：個人可見已核對分數及「紀錄待核對」，rank=null，不給獎牌；公開列只顯示「暫未排名」，不透露原因。
- 正常legacy／research排除不是壞資料；本人規則說明只計符合現行政策的活動，舊活動不回填。沒有合資格資料保持0分，不稱能力為0。
- `NOT_GUARANTEED`歷史完整性限制本身不把全校停榜；規則說明數值按目前可核對紀錄計算。不能聲稱不可變的最終成績。
- 任一學生待核對時顯示榜級「部分紀錄核對中，排名可能更新」，不列具體學生原因；participant分母不得把待核對者算成已排名。
- query超量／失敗不得用部分查回資料計榜，不能顯示為全員0分。

## 6. 畫面及互動規格

### 6.1 排列

1. Header：「本週排行榜」、日期範圍、靜態「本週日結束」／剩餘日數、計分說明入口；不做秒級倒數。
2. 本班／全年級／全校scope controls，明示實際班級與人數。
3. 我的位置卡：名次、精確分數、目前差距、本週學習日；未上榜／待核對有對應文案。
4. 正式榜單：前列、我的附近、全部榜單；同一份server snapshot供應所有區域。
5. 個人每週目標：七日簡潔記錄、完成日數、達標狀態及「繼續學習」連結至既有`/study`。
6. 我的累積成果：歷來打卡、目前掌握詞數，清楚標示時間語義，不再展示舊九排名。

Desktop用寬內容區，主欄約2/3給榜單、側欄給我的位置及目標；手機單欄，我的位置後立即開始榜單。首屏不被獎牌動畫或三層概覽佔滿。

### 6.2 榜單閱讀

- 本班預設完整榜的首50列，超過50可「載入更多」直到看完，不限制Top20；同時提供返回我的位置。
- 年級／全校預設前列摘要及自己附近（前後各2列，去重並明示真實rank），「查看全部榜單」進入每50列的完整榜。
- 附近窗口邊界遇大量同分時可截列，但標示並列，不能假裝已展示整個同分群組。
- 自己未在已載入頁時，「返回我的位置」先載入包含自己的完整頁，再scroll/focus；不可只捲到不存在的DOM。
- 不以暱稱作React唯一key；回傳只在當次snapshot內有效的opaque entryKey。
- 上下切scope時可取消舊request；失敗不能在新scope標題下顯示舊scope分數。舊資料若保留必須明確標記尚未更新。
- 入頁、手動刷新、從學習返回、分頁重新可見且資料超過60秒時重取；相同refresh併發合併，不每次focus狂發查詢。
- 跨週到新週時整頁重置snapshot／分頁／分數；server週界權威，離線顯示上次更新及過期提示，不client自行計榜。
- 減少motion、不自動搶focus；分數更新以溫和aria-live摘要通知。

### 6.3 計分說明與文案

顯示每日上限、投入70／成果30、未封頂1張卡0.350分／當日首次成功probe0.950分的簡短例子，以及重送不重複計、同分並列、每週重新計、分數不是英語能力。

「成果」說明為當日首次客觀認讀成功的詞義；不稱「新掌握詞」。本人可展開今日投入／成果分解；不提供他人的原始題目、正確率、分項或逐日活動。學生可見文案不出現milli-points、provenance、Asia/Shanghai等工程名詞。

## 7. 技術實現

### 7.1 模組與資料流

建議新增（最終命名可按repo風格調整）：

- `src/lib/student-weekly-leaderboard-policy.ts`：版本、權重、週界、精確顯示、goal、rank/gap/window純函數。
- `src/lib/leaderboard.ts`：直接替換為學生weekly cohort、snapshot、聚合、public DTO及分頁，無舊榜reader並行維護。
- `src/lib/learning-reward-source.ts`：由既有analytics抽出固定select、candidate loading、grouping及共享aggregation所需型別；不能混入教師／學生授權。
- `src/app/api/leaderboard/route.ts`：原路徑直接採用新typed contract，同步修改所有callers及測試。
- `src/components/student/leaderboard/`：WeeklyHeader、MyPosition、RankingList、WeeklyGoal、ScoreExplanation等必要元件；不為拆分而產生大量一次性wrapper。

流程：session及role驗證 → CURRENT enrollment → 選scope cohort → RepeatableRead transaction取asOf及有效日期 → bounded讀取reward來源 → 按學生分組一次 → 每人buildStudentReward → coverage分類 → 排序一次 → personal/top/nearby/page及snapshot token → 明確白名單public DTO。

不得呼叫教師`queryLearningRewards`並偽造teacher role；不能先返回教師DTO再由client隱藏PII。抽共享reader後以既有教師測試及固定資料parity驗證完全相同。

### 7.2 API contract

`GET /api/leaderboard?scope=class|grade|school&view=summary|all&cursor=...`

- 省略scope採最窄可用範圍；pageSize固定50，client不可指定任意student/class/grade/year/weights/asOf。
- `summary`包含top、nearby及personal；`all`加完整榜分頁。my-page以server簽發的opaque定位cursor取得，不能用其他學生ID查詢。
- 回應：`policyVersion`、`scope`、`week{start,endExclusive,effectiveFrom,effectiveTo}`、`asOf`、`snapshotToken`、人數、榜級notice、`personal`、`topEntries`、`nearbyEntries`、`page{entries,nextCursor,myPageCursor}`。
- entry僅包含`entryKey,nickname,rank,isTied,scoreMilliPoints,isMe,rankingState`。personal另有自己的goal、daily progress、分數分解及友善coverage狀態。
- 累積成果只查本人，宜獨立請求／區塊以免歷來查詢拖慢週榜；沿用舊定義，不把整個舊全校榜搬入新請求。
- 401未登入／過期；403非學生或不合資格；400非法參數／cursor；422明確要求不可用scope；409 snapshot stale；429限流；503服務／超量／當前學年未開放，附穩定errorCode。所有錯誤有UI映射。
- private,no-store；一般scope取值不是授權，所有請求（包括分頁）都重驗session/current cohort。

### 7.3 snapshot與分頁一致性

第一版不新增持久快照表。每個snapshot固定server asOf、週、policy、scope及全榜內容digest；token用既有安全簽名基礎、獨立purpose及短期有效期（建議5分鐘），綁定登入者。cursor只含opaque token／頁偏移，不明文包含學生ID或名冊。

分頁以相同asOf重新查詢並重驗完整cohort及排序內容digest。資料／權限／班籍／暱稱／coverage更動導致digest不同，或跨週、過期：409，client清除舊頁後重取，不把不同snapshot拼在一起。單靠createdAt cutoff不保證immutable，必須以digest處理修正／刪除。全榜digest包含分頁穩定排序所需內部ID，但不暴露該ID。

本版不顯示「比昨日升N名」、永久週冠軍或歷史名次，因沒有持久比較快照。將來需要時先另立歷史名冊／結算／late event政策及expand migration。

### 7.4 效能與安全

- 日期與userIds bounded查詢，合資格cohort排序前完整聚合，不以DB任意take截榜。重用來源row cap，另配置明確cohort cap，超量fail closed並建議縮小scope。
- 資料依user分組後計算，避免每名學生filter整個事件陣列的O(學生×事件)成本；DB query數不隨學生逐人增長。
- 初始效能驗收資料：40人班、400人年級、2000人全校，每人每日20活動×7日（混合card/probe且完整關聯）。記錄實際原始row數與payload，row cap不足時先調查，不削減fixture假裝達標。
- 本地release build warm 30次：班榜p95≤500ms、全校summary p95≤1500ms，payload≤150KB；cold單獨記錄。這是本機工程驗收預算，不是已達成結果；不安排託管環境效能驗證。
- 分頁目前會重算，併發10請求測試pool／latency；未達標先查query plan與索引，必要時更新計劃引入安全共享snapshot cache，不私自放寬時間預算。
- 重用現有rate-limit介面，在明確local/test環境以本機backend驗證；不為本功能配置Upstash或其他外部服務，亦不修改repo既有非本地安全設定。基線建議每學生30請求／分鐘，與進出頁／分頁實測一起校準，429有retry提示。
- 新索引必須新增migration，禁止db push／修改已套用migration。無schema變動則不跑無關contract migration。

### 7.5 本地資料清空及重建（已獲授權）

本地所有舊資料均屬可丟棄開發資料，包含舊排行榜來源、帳戶／角色、學年／班級／enrollment、學習紀錄、session／receipt／checkpoint及舊demo fixtures；詞庫亦可清空後由repository可重建的canonical來源重新匯入。不做舊分數回填、不搬移舊排行榜狀態，不以保留舊資料增加實作複雜度。本次計劃修訂不立即執行刪庫；以下是功能實作時的已授權工作。

1. 先閱讀現有reset／seed工具及其guard，核對MIGRATE_URL解析後的host、port及database，輸出不含密碼的目標摘要。只接受此專案的localhost／127.0.0.1／本地Docker目標；未知或遠端目標不能套用本地清空授權。
2. 確認canonical詞庫匯入來源、必要seed腳本及本地測試帳戶設定可用，停下正在使用同一DB的dev server／測試，避免重建中途仍有writer。不要把清空本地DB解讀成刪除原始詞庫檔或其他專案檔案。
3. 以現有guarded工具或新增專用`db:rebuild:weekly-leaderboard`腳本，明確設定development/test環境與工具要求的confirmation參數；這些是執行目標防呆，不需要再向使用者重問同一授權。若現有工具不覆蓋完整重建，先補腳本及dry-run／目標拒絕測試，不捏造已有指令。
4. 清空指定本地application schema，從repository migrations建立空庫並生成Prisma Client；不用db push、不手改已套用migration。可以新增所需schema／index／移除舊結構migration，無需為舊本地資料建立backfill或expand／contract分期相容機制。
5. 依依賴順序建立canonical詞庫、CURRENT學年、班級、角色及測試帳戶，再建立新排行榜情境。密碼來自本地環境設定，不寫入Git或驗證報告。
6. 分兩組fixture：可登入人工review的穩定demo，以及每次可重播／清空的自動化fixtures。兩者均以完整V2來源建立合法紀錄；錯資料情境獨立標記，不能混進正常demo。
7. 測試空庫→migration→seed→登入→實際學習→榜單→教師報告全鏈；第二次完整重建得到同樣固定clock的名冊／分數摘要，seed單獨重跑不產生重複帳戶、活動或分數。
8. 舊DB清空後清理本地瀏覽器Auth session、study outbox／checkpoint及舊榜分頁token，再重新登入；另以一個刻意保留舊browser狀態的測試驗證失效憑證被拒絕並可恢復，不把舊pending action寫入新資料。

實作證據記錄：sanitized DB目標、重建指令、migration及seed結果、fixture版本／clock、各情境預期分數、登入測試結果及第二次重建摘要。無需備份可丟棄舊資料；必須保留可重建的新seed來源及測試證據。

## 8. 分階段實施與驗收

### Phase A — 凍結規則及情境驗算

- [x] 核對現行排行榜、教師reward、API及規範邊界；建立本計劃及索引。
- [x] 確認並凍結70/30、4日目標、0分未上榜、coverage排除及只做本週的第一版取捨。
- [x] 修訂learning contract與current baseline的新projection說明，舊榜計劃加successor link。
- [x] 建立核心計分、週中加入、缺資料、StudyDay-only及大量同分情境；以可重播demo fixture覆蓋其餘流程。
- [x] 以學生頁面實作確認mobile／desktop排列及loading／zero／tie／error／coverage狀態；原生裝置視覺檢查列於未完成限制。

出口（已達成）：規則與示意算例一致，數值預設已確認，計劃已進入實作並完成本地核心驗證。

### Phase B — 純邏輯及共享來源

- [x] 新增week、goal、ranking、gap、nearby及milli-point tests。
- [x] 抽共享reward source，不擴張教師入口權限。
- [x] 以共享activity reader及StudyDay-only regression維持教師來源邊界；既有reward tests通過。
- [x] 以contract及projection實作保證self-rating值不讀入榜分，舊scoring／mastery語義無改動。

出口：純測試、lint、typecheck通過，沒有新的writer或schema副作用。

### Phase C — Server／API／資料一致性

- [x] 實作§7.5 guarded本地完整清空／migration／seed流程及固定情境，驗證可重複重建。
- [x] 實作學生cohort及日期、bounded aggregation、coverage、public DTO。
- [x] token／cursor／digest與RepeatableRead snapshot驗證。
- [x] 登入、角色、名冊、scope、stale、rate-limit與503錯誤處理。
- [x] 依§7.5清空重建本地資料及fixtures，驗證真實provenance、去重、StudyDay-only邊界及GET前後資料計數一致。
- [ ] 完成40／400／2000人資料庫效能及payload測試；本輪已完成40／400／2000人純排名scale smoke，資料庫大規模fixture及p95仍列為後續工程驗收。

出口（本地核心已達成）：本地實作不能越權、漏PII、混snapshot或以partial資料排名；資料庫大規模效能預算仍列後續工程驗收。

### Phase D — 學生頁面

- [x] 新主榜、我的位置、完整榜／附近、my-page及個人目標。
- [x] 計分說明、累積成果獨立區塊及所有empty／error／coverage狀態。
- [x] 並列獎牌、精確小數、長暱稱、無班級及全班0分的呈現邏輯。
- [ ] 返回學習後更新、跨週、離線過期、scope race及stale分頁恢復。
- [x] 繁簡、明暗、responsive、reduced motion及keyboard語義；原生screen-reader／實體裝置仍待人工驗收。

出口（自動化本地流程已達成）：真實登入瀏覽器已驗證主要流程，榜單在手機及桌面都佔主要閱讀篇幅；原生screen-reader／實體裝置另列限制。

### Phase E — 整合驗收及交付

- [x] 跑§9本地可執行的對應矩陣，建立有日期的evidence artifact記錄指令／結果／限制。
- [ ] 對照實際畫面逐項產品walkthrough；CUA檢查因本機鎖定未能進行，不能把snapshot assertion當成視覺驗收。
- [x] 更新計劃checklist、README索引及舊榜successor說明；保留歷史驗證。
- [x] 完成乾淨DB重建與重複seed smoke；新榜可用，舊榜專用reader及callers已清理。
- [x] 記錄未執行的native device／真實學生驗證，不把它們或任何production工作當成本地完成的阻擋項。

## 9. 測試與驗證矩陣

| 層級 | 必測案例 | 驗收斷言 |
|---|---|---|
| 週界 | 週日23:59:59.999／週一00:00、跨月年、閏日、server與browser不同timezone | 只歸一週；client clock不改分 |
| 學年／入籍 | 週中年界、週五加入、缺startedAt、轉班、新enrollment、無CURRENT年 | 有效日期／目標正確；無未授權cohort |
| 計分 | §4算例、20／5封頂、70/30精度、跨日相加、先錯後對、兩方向同sense | milli-points精確，無display反算 |
| 去重 | 同operation replay、同target、多裝置重送、合法新補救卡 | 重送不增分，新合法活動按政策計 |
| 學習邊界 | selfForgot／selfRecalled、reveal-only、feedback ACK、research、legacy | self-rating值不影響獎勵；新榜不寫Review／mastery |
| coverage | unknown version、缺identity、錯winning linkage、StudyDay來源缺漏、停用詞、已刪來源 | 缺漏不裝成完整零分；停用完整證據保留 |
| 名次 | 1,1,3；1,2,2,4；全部0；單人；大量同分；自己未上榜；待核對 | rank／medal／分母／gap一致，沒有假第一名 |
| 分頁 | >50人、同分跨頁、my-page、top與nearby重疊、最後一頁 | 無重複遺漏、rank不按頁重新計 |
| snapshot | 分頁間新活動／修正／刪除／暱稱／轉班／停權／跨週／過期 | 新活動cutoff穩定；影響snapshot者409，不拼接 |
| API auth | 未登入、teacher/admin、session撤銷、角色變更、班級偽造、cursor篡改／他人token | 401/403/400；錯誤不洩漏資料 |
| public DTO | 搜尋legalName、accountName、email、studentNumber、內部ID、target／答案 | 所有成功／錯誤response及logs均無敏感欄位 |
| reader parity | 同資料、asOf、日期、eligibility、70/30教師report與新榜 | 每日分項、總分、coverage逐欄相同 |
| 本地重建 | 空庫重播、完整reset兩次、seed重跑、舊browser憑證、錯誤DB目標 | 新fixture摘要一致、無重複資料、舊憑證拒絕、非本地目標不刪除 |
| DB安全 | 正常session cleanup、GET前後資料計數／digest | cleanup不丟V2 reward；GET不寫學習資料 |
| UI流程 | 本班→年級→全校、返回自己、載入更多、說明、繼續學習並返回 | 選中scope／榜單一致，分數由server更新 |
| UI狀態 | 初次loading、401、403、422、429、503、offline、409恢復 | 可理解、可重試，無無限reload |
| Responsive | 360/390/768/820/1440px、長暱稱、200% zoom | 無水平溢出、數值不裁切、自己可定位 |
| Locale/theme | 繁／簡 × light／dark（390與1440至少全組合） | 文案、數字精度、對比及選中狀態正確 |
| A11y | keyboard完整流程、scope controls語義、dialog focus返回、screen-reader榜單與並列、reduced motion | 不只靠顏色、不搶focus、無鍵盤陷阱 |
| 效能 | §7.4規模、cold/warm、10併發、超量資料 | query數無N+1、p95/payload達標、超量不產生partial榜 |

### 9.1 預計指令與測試入口

已有指令（本輪已執行）：

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

新增專用測試入口（已在package.json及Playwright config建立）：

```bash
npm run test:db:weekly-leaderboard
npm run test:e2e:weekly-leaderboard
npm run test:weekly-leaderboard:scale
```

DB checker放`scripts/check-weekly-leaderboard.ts`；scale checker放`scripts/check-weekly-leaderboard-scale.ts`；E2E放`tests/e2e/weekly-leaderboard.spec.ts`，專用Chromium desktop/mobile及WebKit專案，真實登入及真API，不只mock payload。

Fixtures以可清空的本地development/test DB重建，固定clock、有效canonical V2來源與guard；使用者現有demo及舊帳戶／學習資料皆可刪除，不做舊資料保留或回填。互相併行的測試用獨立DB或run namespace避免互相清除。DB sandbox localhost失敗先escalated重試；schema mismatch先核對migration status。migration／seed必須明確使用MIGRATE_URL並核對localhost目標，詳見§7.5。

若新增index／schema，追加`npm run test:migration-checksums`、`npm run test:migrations`及Prisma Client生成；若需要移除舊結構，可在已確認的本地DB執行必要destructive步驟及對應contract regression；不因舊資料相容而保留無用結構，亦不順帶執行與本功能無關的Stage E cleanup。若意外需要修改study action／gesture／session，先更新scope並追加`npm run test:db:stream-v2`、`npm run test:e2e:study-stream-v2`及`npm run test:e2e:card-motion`；本計劃基線不需要改這些writer。

本輪不建立新舊榜切換flag、不修改deploy workflow，不把`check:production-config`列為驗收指令。GitHub push只是保存程式與計劃，不是發佈步驟。

### 9.2 視覺與人工驗收

保存實際瀏覽器390px及1440px主要狀態截圖，另記tablet、繁簡／明暗和zoom結果。人工依序走：新生0分→完成卡→返回看到投入→客觀作答→封頂→同分→查看附近→載入自己→目標完成→跨週重置。逐步核對UI、API及DB來源，三者必須相符。

以本地情境walkthrough檢查學生是否能從頁面回答「比哪週、如何得分、自己位置、下一步可做甚麼」；這是產品可理解性檢查，不冒稱已證明提升動機。原生VoiceOver／TalkBack、實體手機及真實學生效果另記未驗證；正式pilot要另行授權，亦不在此新增研究收集。

## 10. 本地替換、重建與風險

- 新榜直接替換本地舊頁、舊API response及舊榜專用reader；不建立legacy component、雙版本API、灰度開關或舊榜回退按鈕。
- 前後端、fixture、tests及相關文件在同一功能改動中對齊。保留其他功能仍使用的共用helpers與教師計分能力；刪除前以caller搜尋確認範圍。
- 開發中發現資料或schema需要調整，可按§7.5重新清空及建庫；無需承諾舊資料遷移、歷史分數一致或資料備份恢復。正常使用時GET仍為read-only、週切換不刪資料。
- 功能版本以Git保存。若實作需重做，從已知commit修正或在獨立checkout比較，並配套對應schema重新建立本地DB；不要求應用內並行保存舊榜，也不使用force push覆寫GitHub歷史。
- 分數受題目機會、家庭設備、可用日數及既有程度影響，不能宣稱公平能力榜。70/30偏重投入是明示取捨；不為補滿分硬派客觀題。
- 同分可能多，達滿分後仍可學習；不暗加速度tie-break。大量並列以列表處理。
- 清空舊資料不消除新系統運行時的分頁一致性、權限及資料缺漏問題，相關防護與測試仍保留；缺資料案例以刻意製造的測試fixtures驗證，不修補已刪除舊資料。
- 本版不做永久週結算是產品範圍決定，不是為了保留舊資料。將來若需要週冠軍存檔，可以直接設計新schema及重新seed。
- 公開榜擴展reward語義仍須同步修訂contract，讓文件與新實作一致；本地清空不代表可以把self-rating當成客觀掌握。

## 11. Definition of Done

- [x] 本計劃產品預設已確認，normative contract及dated baseline修訂一致。
- [x] 本週正式榜、附近位置、完整榜、個人目標、自己累積成果全部可用。
- [x] 日期、cohort、coverage、rank、gap、precision及共享reward reader邊界通過。
- [x] API權限／PII／rate-limit／snapshot及分頁行為通過；跨週只以server week authority處理。
- [ ] 本地DB、單元、lint、typecheck、build、專用E2E、資料庫效能及原生視覺驗收全部通過；本輪前六項及純排名scale已通過，資料庫大規模及原生視覺仍列限制。
- [x] 本地完整重建及重複seed smoke完成；舊榜相容層已移除，所有已知限制及未執行native驗證明列。
- [x] 不以「已寫程式」代替驗證；evidence artifact與索引已更新。

## 12. 決策與實際驗證紀錄

2026-09-08：完成原始程式與規範靜態盤點；新分支已建立，來源為教師reward分支。發現現行contract明確排除學生榜，故Phase A要求明訂新projection。第一版建議70/30、4日目標、current week only；週結算永久榮譽延後，避免假設已有歷史snapshot。

本次僅編寫計劃及索引，未修改功能、schema、資料庫或部署設定。已通過`git diff --check`；README內37個相對連結全部存在；git status確認只有新計劃及索引兩個文件改動。未執行unit／DB／E2E／build，因本次沒有程式改動，以上均是未來實施驗收工作。

Revision 2（2026-09-08）：使用者明確指定local-only、全部本地舊資料可徹底刪除重做，並要求commit及push。本計劃移除production gates、新舊榜並行相容、feature flag及舊資料保留要求；新增§7.5完整重建、seed可重播與舊browser狀態驗證。既有資料驗證／權限／分頁一致性保留，因它們仍是新功能本地正確性的要求。之後已建立`codex/student-leaderboard-motivation`，並以guarded localhost目標完成資料重建及功能實作。

Implementation verification（2026-09-08）：以`::1:5432/english_dev`、`public`及catalog digest `6b8dee4f8cb9efe0ec71e173ac34a407031dc3967c2b290e4878fda83d5fa23a`作為sanitized local target，先完成dry-run，再執行`DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development CONFIRM_LOCAL_RESET_TARGET=english_dev/public CONFIRM_LOCAL_CATALOG_DIGEST=6b8dee4f8cb9efe0ec71e173ac34a407031dc3967c2b290e4878fda83d5fa23a npm run db:rebuild:catalog -- --execute`。重建重播67個migration、catalog 5,641 rows、18 classes／150 students／4 teachers，並建立90日可重播demo activity；weekly checker確認class 8人、school 149人、grade 26人及7日progress。`npm test`（424 tests）、`npm run lint`、`npx tsc --noEmit`、`npm run build`、`npm run test:weekly-leaderboard:scale`、`npm run test:db:weekly-leaderboard`、`npm run test:db:stream-v2`及`npm run test:e2e:weekly-leaderboard`均通過；專用E2E為Chromium desktop、Chromium mobile及WebKit共8 tests。GET前後資料計數一致、teacher role被拒絕、cursor篡改／跨使用者／stale情境被拒絕，public DTO未含legal name／email／student number／內部ID。純排名scale smoke覆蓋40／400／2,000 rows；未宣稱2,000人真實資料庫p95達標。

限制及後續：CUA原生畫面walkthrough因本機macOS當時鎖定而未能完成；未執行實體手機、VoiceOver／TalkBack、真實學生動機pilot、production deployment／observation或production cleanup。這些不阻擋本地核心實作，但仍保留為後續驗收項目。驗證詳情另見`plans/artifacts/student-weekly-leaderboard-local-verification-2026-09-08.md`。
