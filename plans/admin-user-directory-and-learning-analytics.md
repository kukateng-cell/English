# 管理員用戶目錄、密碼重設及學習分析示範資料實施計劃

> 狀態：已完成（本機 implementation／verification；production deploy、contract migration 及原生裝置／VoiceOver／TalkBack QA 明確 deferred）
>
> 日期：2026-08-16
>
> 目標分支：`codex/class-roster-import-and-access-control`
>
> 範圍：本機開發、測試及示範資料；包括已獲批准的guarded local demo schema reset，但不包括production deploy、真實學生資料或destructive contract migration
>
> 相關計劃：`class-roster-import-and-access-control.md`、`teacher-workspace-roster-progress-redesign.md`、`retrieval-first-learning-contract.md`

## 1. 執行摘要

今次工作分成三個互相配合、但可獨立驗收的部分：

1. 把 `/admin/users` 重整成真正可用的「用戶目錄」，提供 server-side 搜尋、角色／狀態／學年／年級／班別篩選、穩定分頁及清楚的學生／教師操作；
2. 讓管理員可在學生或教師 row 上按一次「重設密碼」，確認後由 server 自動產生現有 10 位易讀臨時密碼，一次顯示並可複製；
3. 在現有教師班級概覽及學生進度基礎上加入日期範圍、活動趨勢、班級比較、學生比較及個人日曆式明細，並建立一套 development-only、多年級、多班、多學生、最多90日且受CURRENT學年邊界約束的deterministic示範資料。

本計劃不會把 `/admin/users` 變成第二套班級名冊系統。Canonical 分工固定為：

- `/admin/users`：找人、查看帳號狀態、逐人帳號操作及重設密碼；
- `/admin/roster`：學年、班級、匯入／匯出、升級、轉班、停權／恢復、教師班級權限等校務流程；
- `/teacher`：教師獲授權班級的分析及比較；
- `/admin/analytics`：使用相同分析服務的全校視角，不另寫一套指標口徑。

示範資料只會在明確標記為`development`／`test`的本機資料庫執行。按使用者已明確批准刪除本機舊測試資料，demo命令採exact-guarded reset-and-rebuild，避免舊學生污染班級人數及統計；基本seed保持輕量，大型分析資料由獨立受保護命令opt-in建立，production固定拒絕。

## 2. 現況調查及衝突核對

### 2.1 已存在、應沿用的能力

- `User` 已有 `STUDENT`、`TEACHER`、`ADMIN`、`ACTIVE`／`SUSPENDED`、`tokenVersion`、`credentialRevision`、`mustChangePassword`。
- `/api/admin/users` 的 GET handler 已接受 `role`、`status`、`academicYearId`、`grade`、`classCode`、`search` 及 cursor，但 UI 只暴露搜尋，亦會再用 client filter 過濾當前頁。
- `/admin/roster` 已提供學生／教師名單、校務篩選、匯入／匯出、升級、轉班、停權／恢復及教師權限管理；今次不可重造或改變其 canonical lifecycle contract。
- 管理員目前可在 edit modal 手動輸入新密碼；`PATCH /api/admin/users/[id]` 會更新 credential、撤銷 session 及寫 `PASSWORD_RESET_BY_ADMIN` audit，但沒有自動產生／一次顯示的逐人流程。
- 教師 reset 已有 10 位易讀小寫字母／數字 generator、一次性回應、複製按鈕、recent-auth、target-bound precondition、credential CAS、rate limit、session revoke 及 security audit。
- 現有教師 reset route 容許 `ADMIN` 以全校視角重設「學生」，但入口只存在於 teacher workspace，亦不能重設教師；這不是合格的管理員用戶管理 UX。
- 教師工作台已分開「學生名冊」及「學生進度」，有搜尋、年級／班級篩選、分頁、學生詳情及逐班 current summary。
- Canonical 教師指標已有 CURRENT membership、當前 mastery、今日／近 7 日活躍、有效 objective probe、有效 review event、到期複習及最近學習定義。
- `ReviewEvent`、`Review`、`StudyDay` 已足以建立期間活動、客觀答題、正確率、每日練習及當前熟練程度；第一期不需新增另一張 mastery aggregate table。

### 2.2 現有不足

| 範圍 | 現況 | 今次處理 |
|---|---|---|
| 管理員搜尋 | 姓名／帳號放 GET query；UI 只搜尋當前載入頁，load more 亦遺失既有 filter | 改為 POST-body server query、signed cursor、filter fingerprint |
| 用戶分類 | API 有 hidden role／status filter，UI 沒有角色 tabs、狀態、年級／班別及結果 facets | 建立完整篩選及結果數量 |
| 管理員 reset | edit modal 要手動輸入；沒有 auto-generate；教師 target 沒有 dedicated flow | 建立學生／教師共用的 admin reset prepare→confirm→commit |
| 批量 reset | 匯入後 rotation 已存在 | 不在用戶目錄再加 bulk reset；避免大量明文憑證難以分發 |
| 教師班級概覽 | 只顯示今日／7日及 current mastery | 加 7／30／90 日及 custom range、趨勢、normalized comparison |
| 學生詳情 | 只顯示 current summary，沒有逐日活動 | 加期間 timeline、練習日、答題／正確率、distinct words |
| 管理員分析 | 可進 teacher workspace 作 ADMIN view，但 admin navigation 沒有正式入口 | 新增 `/admin/analytics`，沿用同一 analytics service |
| Seed 班級 | 六個年級基本上只有 A 班，另有少量 J1 B fixture | 建立每級 A／B／C 三班 |
| Seed 學生 | optional 40 人分散六級，沒有足夠每班樣本 | 建立 6 級 × 3 班 × 8 人＝144 人 |
| Seed 學習資料 | 沒有完整多日 Review／ReviewEvent／StudyDay 分布 | 建立最多90日、按CURRENT年邊界縮短的多種可重現學習型態 |

### 2.3 不可破壞的既有 contract

- 教師仍只可看獲授權 CURRENT active classes；管理員全校視角必須明確標示，不能無聲 bypass。
- Student public surfaces 仍只顯示 nickname；真名及學生證只出現在已授權 teacher／admin surface。
- Self-rating 不可當 mastery；只有符合 Retrieval-first V2 provenance 的 objective first response 才計 objective metric。
- Current mastery 仍由 `Review.interval >= MASTERED_MIN_INTERVAL` 決定；不能因示範圖表而另造一套分數。
- Password writer 仍只可使用 `replacePasswordCredential()`；重設要同時令 `credentialRevision+1`、`tokenVersion+1`、`mustChangePassword=true` 並撤銷既有 sessions／recent-auth grants。
- 所有名冊 membership、year、class、教師 access 仍以現有 roster model、CAS 及 DB invariants 為準。

## 3. 目標、成功準則及非目標

### 3.1 目標

- 管理員可在大量帳號中以姓名、暱稱或帳號搜尋，按學生／教師／管理員、狀態、CURRENT 學年年級及班別篩選。
- 管理員可對 ACTIVE 學生或教師按「重設密碼」，由 server 自動產生臨時密碼並一鍵複製。
- 教師可選日期範圍，比較多個獲授權班別，並由班級落到學生、再落到逐日活動。
- 教師可選多名學生作有限、清楚、同口徑比較，而不是翻查數百張卡。
- 管理員可在 admin shell 以全校範圍使用同一分析能力。
- 本機一個命令可建立視覺上有明顯差異、可重現、可清理的多班分析資料。

### 3.2 成功準則

- 搜尋及所有 filter 由 server 執行，50／51／144／500 人均沒有跨頁漏項或重複。
- 自由文字搜尋不出現在 URL、browser history、referrer、localStorage、sessionStorage 或普通 application log。
- Role／status／grade／class filter 只縮窄結果；清除 filter 可回到完整目錄。
- Reset 成功只回傳一次臨時密碼；關閉 modal 後不能重新取得；複製按鈕有可見及 screen-reader feedback。
- 管理員不能用此功能重設其他管理員或自己；SUSPENDED target 要先恢復才可 reset。
- 兩個並發 reset 最多一個使用同一 precondition 成功；較舊臨時密碼立即失效。
- 教師 analytics 永不包含未授權班學生；權限／狀態改變後舊 query／detail fail closed。
- 班級比較同時顯示分子／分母或 per-student／rate 指標，不會單以人數較多就看似「表現較好」。
- Demo fixture 每次以同一 seed key 產生同一人物型態及分布；日期窗口相對 Asia/Shanghai 當日移動。
- 6 個年級均有 A／B／C 三班，每班 8 名 ACTIVE 學生，並有高低、上升、間歇、缺席等可見差異。
- 新 demo generator及保留的local base seed fixtures，其可見姓名、暱稱、描述、標籤及CLI輸出固定以繁體中文保存；不再產生「学生／老师／测试」等簡體 fixture 文字。

### 3.3 非目標

- 不讓教師修改學生身份、班級、狀態或批量重設密碼。
- 不在用戶目錄重造匯入／匯出、升級、轉班、hard delete 或教師班級 access editor。
- 不提供管理員重設另一名管理員密碼；管理員自己的密碼繼續由個人帳戶流程修改。
- 不用 email 發送臨時密碼，不實作忘記密碼／email recovery。
- 不建立教師績效排行榜、學生公開排名或「好班／差班」自動標籤。
- 不聲稱可以還原歷史某一天的 canonical mastery；第一期只顯示當前 mastery 加期間活動／客觀答題趨勢。
- 不聲稱目前班級成員過去的活動等於當日歷史班籍表現；現有schema沒有同學年轉班時間線，第一期只做CURRENT membership cohort分析。
- 不建立 data warehouse、長期物化 aggregate 或 background ETL；先使用現有 canonical tables 和必要 indexes。
- 不改 Retrieval-first V2 學習手勢、排程、SM-2、排行榜或單元解鎖語義。

## 4. 已凍結產品決定

### 4.1 管理員用戶目錄資訊架構

`/admin/users` 固定負責逐人帳號工作，版面分為：

1. 頁首總數及「新增用戶」；
2. 角色 tabs：全部、學生、教師、管理員，顯示同一 base filter 下的 facet count；
3. 搜尋：accountName、學生authoritative `StudentProfile.legalName／nickname`、教師authoritative `TeacherProfile.legalName`、管理員authoritative `User.legacyName`；
4. filters：狀態、學年、年級、班別；班別完整allowlist為A／B／C／D／E／F／G／H，只有學生role時顯示學年／年級／班別，切離學生tab即清除呢三項；
5. desktop table／mobile cards，每頁 50、最多 100；
6. row primary action「查看／編輯」，學生及教師另有「重設密碼」；
7. 教師 row 提供「管理班級權限」深連結到 `/admin/roster` 的教師 editor；
8. 學生 row 提供「查看學習分析」深連結到 `/admin/analytics` 的該學生視角；
9. users頁可保留逐人停權／恢復及hard delete入口，但只調用與`/admin/roster`相同的canonical status／delete service及確認元件；PATCH內`UPDATE_IDENTITY`只處理legalName、contactEmail及student nickname，`CHANGE_STATUS`只委派canonical lifecycle，唔可以另寫第二套status writer。

篩選狀態：

- role／status／year／grade／class 可放 URL，因為不是 PII；
- 自由文字 search 只留 component memory，以 POST body 傳送；
- cursor 只留 memory，不寫 URL；
- filter 改變時取消舊 request、清除 cursor 並由第一頁重載。

### 4.2 管理員自動重設密碼

目標固定為 `ACTIVE STUDENT` 或 `ACTIVE TEACHER`：

- 不接受 `ADMIN` target；
- 不接受 actor 自己；
- `SUSPENDED` target 顯示 disabled action及「請先恢復帳號」；
- Generic `PATCH /api/admin/users/[id]` 不再接受 `password` 欄位；所有替別人改密碼的寫入只可經專用 reset route，避免繞過 target-role、precondition、limiter及一次性secret contract；
- 不做 bulk selection reset；匯入批次憑證遺失繼續使用現有 rotation workflow；
- 使用既有 `generateTemporaryPassword()`：10 位、排除容易混淆字元的小寫字母及數字；
- reset 後 `mustChangePassword=true`，學生／教師下一次登入要改密碼；完成改密後沿用現有 transparent fresh-session continuation；
- 成功 modal 顯示 target 真名／帳號／角色、臨時密碼、「複製密碼」及只顯示一次警告；
- modal 關閉、refresh、back navigation 或 response 丟失後都不提供 secret recovery，只能明確再次 reset；
- 不把 plaintext 放入 DB、SecurityEvent、URL、browser storage、console 或 server log。

UX 流程固定為：

```text
按「重設密碼」
→ server prepare／取得 target-bound 5分鐘 precondition
→ 顯示身份及 session 失效確認
→ 如 recent-auth 過期，完成 reauth 後重新 prepare
→ commit reset
→ 一次性顯示及複製臨時密碼
```

### 4.3 Analytics 視角及導覽

- 教師 `/teacher` 由現有班級概覽擴充成「班級分析」，保留直達名冊／進度的入口。
- 教師 `/teacher/progress` 保留學生列表，新增期間欄位、排序及選取比較入口。
- 教師 `/teacher/students/[id]` 新增逐日趨勢區；身份及 current summary 保留。
- 管理員新增 `/admin/analytics` 及 admin navigation item「學習分析」。
- Admin 與 Teacher 使用同一 `learning-analytics` service、相同 DTO 及相同 metric definitions；只由 authorization context 決定 membership。
- Teacher view 只包含其 CURRENT class access；Admin view 包含全校 CURRENT ACTIVE enrollment，未分班學生另作明確 group，不偽裝成班級。

### 4.4 日期範圍及比較上限

- 預設最近 30 個 Asia/Shanghai 本地日；presets 為 7／30／90 日；custom 最多 180 日。
- 班級比較一次最多 6 班；學生比較一次最多 8 人。
- 超出上限時 UI 阻擋，server 同樣 422；不能只靠 client。
- 日期end inclusive；request先驗`requestedFrom <= requestedTo <= today`。Effective window固定為`effectiveFrom=max(requestedFrom, CURRENT year.startsOn)`、`effectiveTo=min(requestedTo, CURRENT year.endsOn, today)`，任何一端改變即`rangeClamped=true`；不可把上一／下一學年活動歸入目前班。
- `today < startsOn`代表CURRENT year尚未開始，固定503 `CURRENT_YEAR_UNAVAILABLE`；`today > endsOn`時日期邊界仍authoritative，唔因status仍CURRENT而延長至學年外，重疊response加`calendarWarning=CURRENT_YEAR_ENDED_NOT_ACTIVATED`。Request同`[startsOn,min(endsOn,today)]`完全零交集時固定422 `RANGE_OUTSIDE_CURRENT_YEAR`，唔產生倒轉／empty effectiveRange。
- Server回傳requested range、`effectiveRange`、`asOf`、timezone、`rangeClamped`及nullable calendarWarning；UI對422／503提供選擇有效日期／啟用正確學年的繁體提示。
- 班級口徑固定為`cohortBasis=CURRENT_MEMBERSHIP`，UI常駐顯示「按目前班級成員計算」；同學年轉班前活動無法可靠歸回舊班，明確列為非目標。
- 期間內完全沒有活動的 rate 顯示 `—`，count 顯示 `0`；不以 0% 冒充有樣本的失敗率。

## 5. Canonical 學習分析定義

### 5.1 Membership

Teacher：

```text
teacher User ACTIVE
AND TeacherProfile exists
AND CURRENT academic year
AND ACTIVE student User
AND ACTIVE StudentEnrollment
AND active SchoolClass
AND matching TeacherClassAccess.canViewProgress = true
```

Admin：CURRENT year 的 ACTIVE student User + ACTIVE enrollment；分班及未分班均可看。所有 query 先建立 authorized membership，再套 client filters；傳入未授權 classId／studentId 與不存在目標統一 404。

期間歸因固定為「目前成員 cohort」，唔係歷史班籍：

- response帶`cohortBasis=CURRENT_MEMBERSHIP`；
- 全局期間先clamp至CURRENT academic year；
- 每名學生的`exposureStart=max(effectiveFromDate, enrollment.startedAt)`，`eligibleDayCount`由exposureStart至toDate計；
- 每日class denominator只包括該日已到`exposureStart`的current members；
- 新加入學生的零活動只由其exposureStart開始計，唔會當佢入學前缺席；
- 同學年轉班會覆蓋`StudentEnrollment.classId`，所以轉班前活動仍屬「目前班級學生過去活動」，不宣稱屬於當時班別；UI必須常駐提示，歷史membership model另案處理。

### 5.2 當前狀態指標

以下是 request `asOf` 的 current stock，不宣稱是歷史快照：

| 指標 | 定義 |
|---|---|
| 當前掌握詞 | `Review.interval >= MASTERED_MIN_INTERVAL` |
| 當前 mastery % | mastered canonical Reviews ÷ current Word catalog count |
| 到期複習 | `Review.nextReviewDate <= asOf` |
| 班級平均 mastery | 先算每名 member %，再作 unweighted mean |
| mastery 中位數 | member mastery % 的 median；零 member 為 null |

Current stock只保證同一HTTP response內、同一DB snapshot一致。跨route、跨page或稍後重新載入時，學生可繼續學習令`Review`改變；`asOf`唔會把mutable Review還原成歷史狀態。跨response一致性測試只可用quiescent fixture，唔可以聲稱一般運作期間有歷史snapshot。

### 5.3 期間活動指標

| 指標 | 定義 |
|---|---|
| 活躍學生 | 自己exposure window內至少一個canonical `StudyDay`的distinct current member |
| 活躍率 | 活躍學生 ÷ 至少有1個eligible day的current members；零eligible member為null |
| 學習日數 | 每名學生exposure window內distinct `StudyDay`；class median包含所有eligible members，無活動學生以0日計 |
| Learning Card encounters | exposure window內已`acknowledgedAt`的`StudyEncounter`；self-rating只係練習量，唔影響mastery／accuracy／排行榜 |
| 有效評測 | 非 historical、accepted `ReviewEvent.eventKind=REVIEW`；沿用現有 V1／V2 compatibility contract |
| 有效 objective attempt | 只計 provenance-complete、approved operational purpose、winning first response 的 V2 event |
| Objective correct | 由 `qualityPolicyVersion` 對應的 versioned policy resolver 判定；禁止在 SQL／UI 硬寫 `quality===4` 作永久 contract |
| 正確率 | correct objective attempt ÷ all eligible objective attempt；零 attempt 為 null |
| 評測練習詞數 | 期間內有效 ReviewEvent 的distinct `submittedWordId`；呢個欄在Word刪除後仍保留stable submitted identity |
| Encounter練習詞數 | acknowledged StudyEncounter 的distinct non-null `wordId`；word已刪而變null的row另計`unknownEncounterWordCount`，唔猜測identity |
| 最近學習 | eligible ReviewEvent 與 acknowledged StudyEncounter 的較新時間；沿用現有 canonical 定義 |

Self-rating、reveal、lease、research-only、unapproved diagnostic、non-winning、缺 provenance 及 historical bridge 不計 objective attempt／correctness。

Accuracy response固定同時回`correctCount`、`eligibleAttemptCount`、`accuracyPercent`及`accuracyDisplayStatus`：

- 0 attempt：`NO_DATA`，百分比null；
- 1–4 attempts：`SMALL_SAMPLE`，API可回計算值但UI只以`correct/attempt`及「樣本較少」呈現，不放大成大型100% callout；
- 5+ attempts：`SUFFICIENT`，可顯示百分比，仍要保留分子／分母。

Excluded objective rows要按`historical`、`nonWinning`、`unsupportedPurpose`、`missingProvenance`、`unknownPolicyVersion`、`invalidPolicyOutcome`回count；未知policy或已知policy的非法quality都唔猜correct／wrong。

Objective candidate universe固定為期間內帶有任何objective marker（`evidenceKind=OBJECTIVE_PROBE`、V2 flow、probe purpose、target或snapshot linkage）的ReviewEvent；純V1／legacy review仍可計有效評測，但唔冒充objective candidate。每個candidate只可落一個互斥結果，依次判定：

1. `historical`：historical／bridge row；
2. `missingProvenance`：缺少其餘canonical V2 marker或link；
3. `nonWinning`：target winner唔係該event；
4. `unsupportedPurpose`：purpose不在operational allowlist；
5. `unknownPolicyVersion`：其餘完整但resolver不認得policy；
6. `invalidPolicyOutcome`：policy已知但quality／outcome不屬該版本合法集合；
7. 否則為eligible attempt。

Response同時回`objectiveCandidateCount`及`excludedDistinctTotal`；前者必須等於`eligibleAttemptCount + excludedDistinctTotal`，後者必須等於六個互斥bucket之和。多重失敗row只按以上最高precedence計一次。

### 5.4 每日 timeline

每個學生每日回傳：

```text
{date, eligible, active, learningEncounterCount,
 effectiveReviewCount, objectiveAttemptCount, objectiveCorrectCount,
 evaluatedDistinctWordCount, encounteredDistinctWordCount,
 unknownEncounterWordCount}
```

班級 timeline 回傳每日：

```text
{date, eligibleStudentCount, activeStudentCount, activeRate,
 learningEncounterCount, effectiveReviewCount,
 objectiveAttemptCount, objectiveCorrectCount,
 objectiveAccuracy, accuracyDisplayStatus}
```

沒有 event 的eligible日期由server補零；exposureStart前固定`eligible=false`，不可當0活動。圖表必須有同內容的accessible summary/table，不以顏色作唯一區分。

`StudyDay`與活動ledger必須雙向一致：每個fixture StudyDay至少有一個同日本地日的eligible ReviewEvent或acknowledged StudyEncounter；每個eligible ReviewEvent／acknowledged encounter亦必須有對應StudyDay。Runtime歷史若有已知缺口，response要回`dataCoverageWarning`，唔自行製造StudyDay。

### 5.5 比較方式

- 班級比較主要顯示active rate、所有eligible members（包括0活動）的median study days、objective micro accuracy、per-student accuracy median、每eligible member有效評測、current mastery mean／median及due rate。
- 學生比較顯示 active days、有效評測、objective attempts／accuracy、distinct practiced words、current mastery及 due count。
- `reviewsPerEligibleMember=effectiveReviewCount/eligibleMemberCount`；如另顯示per-active-student必須用另一個清楚欄名，唔可共用「平均」。
- `medianLearningEncounters`以所有至少有1個eligible day的current members計，無encounter成員以0納入；唔只計活躍學生。
- `dueRate=dueStudentCount/currentMemberCount`；零member為null。
- Class micro accuracy＝全班correct總數／eligible attempts總數；per-student median只包含至少1個eligible attempt的學生，並同時顯示`studentsWithAttempts/currentMemberCount`。
- `perStudentAccuracyMedian`係有至少1個eligible attempt學生的個人accuracy作unweighted median；0人為null。另回`perStudentAccuracyMedianDisplayStatus=NO_DATA | SMALL_COHORT | SUFFICIENT`，1–4名有attempt學生固定`SMALL_COHORT`，5名或以上為`SUFFICIENT`；UI常駐顯示`studentsWithAttempts/currentMemberCount`。
- Raw total可顯示，但必須與班級人數、eligible days或per-student denominator同時出現。
- 不產生自動總分、班級名次、紅綠「好／差」判定或教師績效結論。

## 6. API、DTO 及安全 contract

### 6.1 Canonical routes

```text
POST /api/admin/users/query
POST /api/admin/users/[id]/detail/query
PATCH /api/admin/users/[id]                    // mutually-exclusive identity or canonical status command
POST /api/admin/users/[id]/password-reset/prepare
POST /api/admin/users/[id]/password-reset

POST /api/learning-analytics/classes/query
POST /api/learning-analytics/students/query
POST /api/learning-analytics/students/[id]/timeline/query
```

`/api/learning-analytics/*` 只接受 `TEACHER | ADMIN`，server 按 session role 建立視角；成功 response 帶 `viewMode: TEACHER | ADMIN`。現有 `/api/teacher/class-summary/query`、`progress/query` 及 detail aggregate 先改為 thin adapter 或轉移 caller；新 UI／tests 全部轉移並完成 route inventory 後才移除重複 handler。

### 6.2 Admin user query

Request：

```json
{
  "role": "STUDENT",
  "status": "ACTIVE",
  "academicYearId": "optional",
  "grade": "JUNIOR_1",
  "classCode": "A",
  "search": "optional PII in body only",
  "cursor": "optional signed opaque cursor",
  "limit": 50
}
```

Response：

```text
{items:[{id,accountName,legalName,nickname,role,status,mustChangePassword,
         academicYearId,grade,classId,classCode,createdAt,revision}],
 facets:{roles:{all,students,teachers,admins},status:{active,suspended},
         grades:{JUNIOR_1,...,SENIOR_3},classCodes:{A,B,C,D,E,F,G,H}},
 nextCursor,rosterRevision,generatedAt}
```

- limit default 50、max 100 integer；nonblank search 1–80 graphemes（trim後空白視為 omitted）；cursor最多2048 UTF-8 bytes；所有academicYear／class等opaque ID為1–128 UTF-8 bytes；body max 16 KiB並在JSON parse前拒絕超限。
- `academicYearId`未提供時student projection固定CURRENT year；有提供時item只serialize該request year enrollment，唔可另取「最新ACTIVE／PLANNED」row。Year／grade／class filters只在`role=STUDENT`合法；切離student tab client清除，server收到矛盾組合亦422。
- Role facets忽略role本身但保留search＋status；status facets忽略status本身但保留search＋role＋合法student filters；grade facets忽略grade但保留selected year／classCode／status／search；classCode facets忽略classCode但保留selected year／grade／status／search。Grade／class facets只在STUDENT role有值，完整A–H零count亦要serialize。Facet query及items使用同一DB snapshot，唔拼接不同時間結果。
- Search predicate按row role只讀authoritative identity source：STUDENT用`StudentProfile.legalName／nickname`、TEACHER用`TeacherProfile.legalName`、ADMIN用`User.legacyName`，三者都另比對canonical accountName；不可用legacy fallback替學生／教師重複或覆蓋結果。Items同facets必須重用同一predicate，所以管理員姓名搜尋亦會正確更新role／status facet counts。
- Cursor簽名包含exact sort key `COALESCE(accountNameCanonical, accountName) → id`、filter fingerprint及`RosterMutationState.revision`。Local reset後conformance要求canonical非null；expand compatibility row為null時只fallback raw immutable accountName，不宣稱case-fold排序。
- malformed cursor 422；roster／identity／status mutation 後舊 cursor 409，UI由第一頁重載。
- 新forward migration補`StudentProfile` INSERT／UPDATE／DELETE及User physical legacy-name UPDATE的roster revision trigger；TeacherProfile、User role/status、enrollment、class及academic year沿用既有trigger。啟用前先把所有supported Profile writers（至少student self-nickname、admin identity、manual/import）遷到canonical `RosterMutationState → sorted identity keys → User → Profile → audit`鎖序及profile revision CAS；任何writer不可先鎖Profile再blocking等state。Raw／legacy statement trigger只可用NOWAIT／try-lock，反向鎖序時raise stable SQLSTATE `40001`；service只對`40001／40P01`作最多3次bounded-jitter全transaction retry，revision已變回各自stale code，retry耗盡回409 `PROFILE_WRITE_CONFLICT`，不可漏成500。所有supported identity writer inventory、raw trigger及真並發tests要證明legalName／nickname／import／status變更令舊cursor stale。`mustChangePassword`只作row badge，不作filter／sort，所以credential reset本身不影響pagination membership。
- Response 不含 contactEmail（除非打開 detail）、password fields、tokenVersion、credentialRevision、audit或臨時密碼。
- Read-only POST 仍要求 same-origin／CSRF、`Cache-Control: private, no-store`、`Vary: Cookie`、`nosniff` 及 search log redaction。
- 舊 `GET /api/admin/users` 在新 caller 完成後以 route inventory 驗證 zero caller，再移除或只保留不含 search 的短期 adapter；不長期維護兩套 cursor contract。

Admin identity detail固定用`POST /api/admin/users/[id]/detail/query`取得，ADMIN-only、body max 16 KiB／ID max 128 bytes、same-origin／CSRF及相同private no-store PII headers：

```text
{user:{id,accountName,role,status,contactEmail,createdAt,userRevision,
       profile:{legalName,nickname?,profileRevision?}},
 currentEnrollment?:{academicYearId,grade,classId,classCode,enrollmentRevision},
 rosterRevision,generatedAt}
```

STUDENT／TEACHER profile必須回各自`profileRevision`；ADMIN的legalName仍由User legacy field承載，`profileRevision=null`並只用`userRevision`。同一PATCH route只接受以下兩種有discriminated `operation`的互斥command；混合兩組欄位、缺少operation、unknown field或password／role／class-access欄一律422：

- `UPDATE_IDENTITY`：只接受`legalName`、`contactEmail`、STUDENT `nickname`、`expectedUserRevision`及有profile時的`expectedProfileRevision`。同一transaction按role寫authoritative User／Profile並CAS兩個revision，任一stale固定409 `ADMIN_USER_PROFILE_STALE`。Concurrent student self-nickname、import、teacher/admin profile edit或contactEmail edit後，舊modal不得覆寫新值；UI要重新讀detail再讓管理員確認。
- `CHANGE_STATUS`：只接受`status`、`suspendedReason?`、`restoreMode?`、restore所需`grade?／classCode?`及`expectedUserRevision`，並直接調用`/admin/roster`同一canonical single-account lifecycle service。必須保留ACTIVE↔SUSPENDED、planned-only `PRE_ENROLLED` restore、需要時建立CURRENT enrollment／transition、self／last-admin guard、User revision CAS、`tokenVersion`／RecentAuthGrant撤銷、audit及現有stable conflict codes；users及roster兩邊所有caller都遷到此command，唔可另寫第二套status writer。

兩種mutation都固定body max 16 KiB、ID max 128 bytes、strict parser、same-origin／CSRF、15分鐘RecentAuthGrant、ADMIN及ACTIVE actor、private no-store／Vary／nosniff／no-referrer response。`UPDATE_IDENTITY`沿用`normalizeLegalName`／`normalizeContactEmail`、legal-name／email／nickname cross-field validators，並按全域順序鎖`RosterMutationState`、normalized identity advisory keys及User／Profile；contact email canonical uniqueness由DB constraint作最後防線，衝突固定409 `ACCOUNT_OR_EMAIL_EXISTS`。成功同transaction寫allowlisted `ADMIN_PROFILE_UPDATED` SecurityEvent，沿用actor／subject FK＋HMAC pseudonym，只准changed-field names及安全結果metadata，禁止舊／新姓名、nickname、email或accountName；audit backend失敗令mutation rollback。`CHANGE_STATUS`沿用`ACCOUNT_SUSPENDED／ACCOUNT_REACTIVATED` audit。

兩種command都要由server session取得actor id、raw session JTI、claim `tokenVersion／credentialRevision`，只以domain-separated HMAC(session JTI)查grant。正式寫入使用`SERIALIZABLE`並跟現有全域鎖序：`RosterMutationState → sorted identity keys → sorted/deduplicated actor＋target User rows → target Profile／roster dependents → exact RecentAuthGrant → audit`；所有target mutation之前必須在transaction內重驗actor仍存在、`role=ADMIN`、`status=ACTIVE`、兩個credential revisions同session claims一致，以及grant屬同actor／session／revisions且未過期。查詢途中actor被停權／改role固定403 `ROLE_FORBIDDEN`，actor消失或credential／session失效固定401 `AUTH_REQUIRED`，只有grant過期／不存在而credential仍有效先回401 `RECENT_AUTH_REQUIRED`；整個transaction rollback，target、roster revision及audit全部不變。呢個recheck唔可只放transaction前。所有新route及adapter遇到`requireRole()`的`auth.status===503`必須回503 `AUTH_BACKEND_UNAVAILABLE`，保留cookie並顯示可重試服務錯誤，唔可誤報`AUTH_REQUIRED`或要求重新登入。

### 6.3 Reset prepare／commit

Prepare response 只在 target 為 ACTIVE STUDENT／TEACHER 時回傳：

```text
{target:{id,accountName,legalName,role,status}, resetPrecondition, expiresAt}
```

`resetPrecondition` 使用現有 AEAD keyring／HKDF primitive 的一般化 password-reset namespace，綁定：

- `audience=ADMIN_USER_RESET | TEACHER_STUDENT_RESET`及action／token version；
- actor id、session JTI、actor role、actor `tokenVersion`及`credentialRevision`；
- exact RecentAuthGrant generation snapshot：`reauthenticatedAt`及`expiresAt`；
- target id、target role；
- target `tokenVersion`、`credentialRevision`、`revision`；
- `TEACHER_STUDENT_RESET`另外綁TeacherProfile `accessRevision`及reset capability snapshot；commit仍按班級scope重新授權，唔因共用primitive放寬；
- 5 分鐘 expiry 及 stable key id。

V2 token使用audience-specific AAD及HKDF domain（`password-reset-precondition:admin-user:v2`及`password-reset-precondition:teacher-student:v2`）；admin token同teacher token不可跨route解密／驗證。新一般化keyring以`PASSWORD_RESET_PRECONDITION_KEY_*`命名並加入`.env.example`／runtime config check；現有teacher v1 token冇grant generation，無法安全滿足reauth後重新prepare，所以T0起即固定拒絕，唔設排空reader亦唔把兩種audience共用無標識payload。

Cutover次序固定為：先部署新admin route及teacher v2能力並遷走所有ADMIN caller；T0原子切換teacher signer／reader，只簽及接受v2，同時刪除legacy ADMIN exception並令teacher route正式`TEACHER`-only。T0前已簽v1即使未過原5分鐘TTL亦固定回`RESET_PRECONDITION_INVALID`，UI重新載入target並prepare v2；target、audit及secret零變更。ADMIN永遠唔會取得`TEACHER_STUDENT_RESET` v2 token，因此TeacherProfile `accessRevision`／capability binding只適用TEACHER actor。T0前後role／token matrix及邊界均要測試，唔可保留暗藏v1 reader。

Commit body 固定為`{resetPrecondition}`。Transaction內按全域鎖序鎖／重讀actor、target及HMAC(session JTI)定位的exact RecentAuthGrant，重驗actor仍為ACTIVE ADMIN、actor token／credential revisions同precondition及session claims一致、grant仍未過期且`reauthenticatedAt／expiresAt`逐欄等於precondition snapshot；再驗target仍為ACTIVE STUDENT／TEACHER及target revisions未變，然後以expected target token／credential revisions呼叫`replacePasswordCredential()`。舊precondition固定以`RESET_PRECONDITION_INVALID`拒絕且target不變；只有重新prepare先可成功。Actor credential stale固定409 `RESET_ACTOR_CREDENTIAL_STALE`，target完全不變、唔產生plaintext secret或success audit。TEACHER v2 commit同樣重驗actor revisions、grant generation、capability及class scope；T0後不存在legacy v1 commit branch。

Fresh-login及reauth grant writer亦必須使用同一relative lock order，唔可沿用現況的grant→User方向：在單一transaction先鎖actor User，重驗role／ACTIVE status／`tokenVersion／credentialRevision`，再以HMAC(session JTI)定位並`FOR UPDATE` exact grant，最後寫audit。若grant不存在，在actor lock仍持有期間insert；若存在，atomic計算`nextReauthenticatedAt = GREATEST(transaction DB clock, current.reauthenticatedAt + 1ms)`並由其重算`expiresAt`，所以兩個同session／同毫秒並發reauth都會按序產生唯一、嚴格遞增generation。所有grant consumers／writers一律保持`User → exact RecentAuthGrant → audit`；`40001／40P01`只作bounded whole-transaction retry，耗盡fail closed，唔可漏成500。與reset commit並發時，reauth先贏會令舊precondition拒絕且target／success audit不變；commit先贏則reauth只可在重驗最新actor/session狀態後成功或fail closed。Identity／status sensitive command同reauth亦要無deadlock並使用transaction內最新grant。

Security requirements：

- same-origin／CSRF；
- 15 分鐘 RecentAuthGrant；reauth 後必須重新 prepare，不重用舊 token；
- 共用limiter按precondition audience選擇不可互換的policy／namespace／error code，抽helper唔改現有教師額度：`TEACHER_STUDENT_RESET`沿用teacher physical namespace、actor 20／15分鐘、session 10／15分鐘、HMAC-IP 60／15分鐘、target 3／1小時及429 `TEACHER_RESET_RATE_LIMITED`；`ADMIN_USER_RESET`使用獨立admin namespace、actor 30／15分鐘、session 20／15分鐘、HMAC-IP 60／15分鐘、target 3／1小時及429 `ADMIN_RESET_RATE_LIMITED`。所有bucket key先以`password-reset-rate-limit:<audience>:v1` HMAC domain pseudonymize，Redis、本機map及log不得保存raw actor／IP／session JTI／target ID；actor/session/IP在昂貴bcrypt前consume，target bucket只在server已確認authorized target後consume，避免enumeration；兩套policy backend unavailable都在production fail closed，T0切v2不得改寫或放寬teacher既有限流語義；
- 兩個同 precondition request 最多一個成功，另一個 409 `RESET_CREDENTIAL_STALE`；
- 成功寫`PASSWORD_RESET_BY_ADMIN`，沿用現有SecurityEvent actor／subject FK＋HMAC pseudonym／keyVersion contract；metadata只准target role、reset audience及安全結果allowlist，禁止plaintext account／姓名／密碼、raw IP或session JTI；
- 成功 response `{ok:true,temporaryPassword}` 只回一次並帶 private no-store／nosniff；
- unexpected error 固定 `{code:"INTERNAL_ERROR"}`，不回 raw Prisma／SQL／PII。

### 6.4 固定錯誤碼

```text
401 AUTH_REQUIRED | RECENT_AUTH_REQUIRED
403 ROLE_FORBIDDEN | CSRF_ORIGIN_INVALID
404 USER_NOT_FOUND | CLASS_NOT_FOUND | STUDENT_NOT_FOUND
409 ADMIN_USER_QUERY_STALE | ADMIN_USER_PROFILE_STALE | ANALYTICS_SCOPE_STALE |
    RESET_ACTOR_CREDENTIAL_STALE | RESET_CREDENTIAL_STALE |
    ACCOUNT_OR_EMAIL_EXISTS | SELF_SUSPEND_FORBIDDEN | LAST_ADMIN_PROTECTION |
    STALE_PREVIEW | PROFILE_STALE | PROFILE_WRITE_CONFLICT
413 PAYLOAD_TOO_LARGE
422 QUERY_INVALID | REQUEST_INVALID | RANGE_OUTSIDE_CURRENT_YEAR | CURSOR_INVALID |
    LEGAL_NAME_INVALID | CONTACT_EMAIL_INVALID | NICKNAME_INVALID | ROLE_IMMUTABLE |
    STATUS_INVALID | RESET_PRECONDITION_INVALID |
    RESET_TARGET_ROLE_FORBIDDEN | RESET_TARGET_NOT_ACTIVE |
    PASSWORD_FIELD_NOT_ALLOWED
429 ADMIN_RESET_RATE_LIMITED | TEACHER_RESET_RATE_LIMITED
500 INTERNAL_ERROR
503 AUTH_BACKEND_UNAVAILABLE | RATE_LIMIT_BACKEND_UNAVAILABLE | RESET_PRECONDITION_UNAVAILABLE |
    AUDIT_BACKEND_UNAVAILABLE | CURRENT_YEAR_UNAVAILABLE
```

Client 只按 `code` 顯示繁／簡本地化文案，不顯示 server raw message。

### 6.5 Analytics request／response DTO

三條 route 共用：

```text
range={fromDate,toDate}       // Asia/Shanghai本地日；最多180日；不可在未來
asOf                         // 第一頁由server建立；其後由signed cursor攜帶
cohortBasis=CURRENT_MEMBERSHIP
requestedRange={fromDate,toDate}
effectiveRange={fromDate,toDate,rangeClamped,timezone,calendarWarning?}
```

Parser共同上限：body max 16 KiB並在JSON parse前回413 `PAYLOAD_TOO_LARGE`；所有opaque IDs為1–128 UTF-8 bytes；cursor最多2048 UTF-8 bytes；limit default 50、只接受1–100 integer；nonblank search trim後1–80 graphemes，空白canonicalize成omitted。`classIds`存在時必須為1–6個unique non-empty IDs；`compareStudentIds`存在時必須為1–8個unique non-empty IDs；duplicate、unknown field、oversized值或矛盾filter固定422 `QUERY_INVALID`。

班級 query request：

```text
{range, grade?, classIds?: string[<=6]}
```

班級 response：

```text
{viewMode,cohortBasis,academicYear,requestedRange,effectiveRange,asOf,dataCoverageWarning,
 scopeRevision,
 items:[{classId,grade,classCode,currentMemberCount,eligibleMemberCount,
         activeStudentCount,activeRate,medianStudyDays,
         learningEncounterCount,medianLearningEncounters,
         effectiveReviewCount,reviewsPerEligibleMember,
         objective:{objectiveCandidateCount,correctCount,eligibleAttemptCount,
                    accuracyPercent,accuracyDisplayStatus,studentsWithAttempts,
                    perStudentAccuracyMedian,perStudentAccuracyMedianDisplayStatus,
                    excludedDistinctTotal,excludedCounts},
         mastery:{meanPercent,medianPercent},
         due:{studentCount,rate}}],
 unassignedSummary:null|{...sameMetricsWithoutClassIdentity},
 timeline:[{date,classes:[...dailyMetrics]}]}
```

`classIds`省略時係directory summary mode：只回authorized actual classes的summary（server hard cap 48，超出時要求grade/filter收窄），`timeline=[]`；ADMIN另可有一個不計入48班的`unassignedSummary`，TEACHER固定為null。只有明確提供1–6個actual classIds先回comparison timeline；未分班group第一期不參與班級timeline比較。0個可見班回空items；7個或以上固定422，唔可以靠省略selection繞過comparison cap或response budget。

學生 query request：

```text
{range, grade?, classFilter?:{kind:"CLASS",classId}|{kind:"UNASSIGNED"},
 search?, cursor?, limit?,
 sort:"ACCOUNT_ASC", compareStudentIds?: string[<=8]}
```

學生 response：

```text
{viewMode,cohortBasis,academicYear,requestedRange,effectiveRange,asOf,dataCoverageWarning,
 scopeRevision,items:[{id,accountName,legalName,nickname,grade,classId,classCode,
   exposureStart,eligibleDayCount,activeDayCount,learningEncounterCount,
   effectiveReviewCount,evaluatedDistinctWordCount,encounteredDistinctWordCount,
   unknownEncounterWordCount,objective:{objectiveCandidateCount,correctCount,
   eligibleAttemptCount,accuracyPercent,accuracyDisplayStatus,
   excludedDistinctTotal,excludedCounts},
   currentMastery:{masteredWordCount,wordCount,percent},dueReviewCount,lastStudyAt}],
 comparison:[...sameMetricShape],nextCursor}
```

學生 timeline request為`{range}`；response除學生身份、`viewMode`、`cohortBasis`、`asOf`、`requestedRange`及`effectiveRange`外，按§5.4回每日rows及period summary。所有 nullable rate採`null`，唔以0代替無分母。

- Analytics學生分頁第一期只接受`ACCOUNT_ASC`，exact key為`COALESCE(accountNameCanonical, accountName) ASC, id ASC`；唔按會在學習期間改變的activity、accuracy或current Review stock分頁排序。
- `classFilter.kind=UNASSIGNED`只供ADMIN；TEACHER收到即422。`compareStudentIds`必須全部屬於actor authorized CURRENT membership，並同時符合request的grade／classFilter；search只縮窄列表，唔排除已明確選取而仍符合grade／classFilter的學生。Filter切換令已選學生不再合資格時client移除，server收到矛盾selection亦422。
- Signed cursor綁actor view、scope／roster／year revisions、requestedRange、effectiveRange、filters、sort、search fingerprint、第一頁`asOf`及最後sort key。Cutoff逐entity固定為：`ReviewEvent.createdAt <= asOf`；`StudyEncounter.acknowledgedAt <= asOf`並以acknowledgedAt決定本地日及最近學習；`StudyDay.date`要在effective range內且row `createdAt <= asOf`。Summary、timeline、comparison及所有cursor pages共用同一asOf及規則；唔以encounter `createdAt`代替acknowledgement。
- `Review`係mutable current stock，唔可由`asOf`還原。Current mastery只保證單一response transaction內一致；不同route／page只在quiescent fixture才要求數值相等。
- `excludedCounts`固定含§5.3六個互斥precedence buckets，並回`objectiveCandidateCount`／`excludedDistinctTotal`守恆欄；每個accuracy UI同時顯示correct／attempt及sample status。

### 6.6 Analytics PII、snapshot及撤權處理

- 所有 analytics route 只接受POST、body max 16 KiB、same-origin／CSRF fail closed，response固定`Cache-Control: private, no-store`、`Vary: Cookie`、`X-Content-Type-Options: nosniff`及`Referrer-Policy: no-referrer`。
- 搜尋只在body，沿用admin directory PII redaction；request／error／slow-query log不得保存raw search、真名、學生證、student IDs清單或response body。
- Membership、身份PII、events、Review stock及aggregate在同一個authorization-bearing `REPEATABLE READ`（需要CAS writer時用`SERIALIZABLE`）transaction snapshot內取得；不得先在transaction外攞member IDs再查PII。
- Transaction snapshot記錄actor role／status／`tokenVersion`／`credentialRevision`、TeacherProfile `accessRevision`（TEACHER）、`RosterMutationState.revision`及CURRENT year revision；response serialization前按固定precedence fresh recheck：actor role失效或status變SUSPENDED先回403 `ROLE_FORBIDDEN`（即使同時bump tokenVersion）；否則session tokenVersion／credentialRevision與DB不符回401 `AUTH_REQUIRED`；否則access／roster／year revision在snapshot後改變回409 `ANALYTICS_SCOPE_STALE`。全部丟棄結果且不可回partial PII。呢個gate處理查詢期間、recheck前已完成的撤權；唔聲稱可以消除recheck後至socket傳送之間不可避免的極短race。
- Request開始時不存在／inactive／actor無權的class或student統一404，避免enumeration；開始時無session或cookie已因actor停權／tokenVersion失效而被現行Auth.js撤銷，固定401 `AUTH_REQUIRED`；session仍有效但role不合回403 `ROLE_FORBIDDEN`；auth backend暫時不可用回503 `AUTH_BACKEND_UNAVAILABLE`並保留可重試session UX。查詢途中撤教師access、停權／改role actor、管理員reset教師密碼、教師／管理員self-change password、停權／刪除target、轉班、關閉class或year revision改變，要按以上initial-vs-mid-query matrix驗證無舊session或舊scope資料流出。

## 7. 示範資料設計

### 7.1 規模及 exact local ownership

Development 預設 fixture：

- 1 個 CURRENT academic year；
- 六個年級：初一、初二、初三、高一、高二、高三；
- 每級 A／B／C 三班，共 18 班；
- 每班 8 名 ACTIVE 學生，共 144 名；
- 額外 6 名特殊狀態學生：未分班、剛加入、停權、長期無活動等，供 admin filter／empty state 使用，但不混入 18 班固定比較基數；
- 4 名 reserved local test 教師（`teacher`、`teacher-reset` 及兩個 analytics access fixture），包含單班、多班、跨年級、reset on／off、suspended fixture；
- 可登入教師沿用 `INITIAL_ADMIN_PASSWORD`，方便直接測試多班比較及 reset 權限。

為保證「每班8人」及metric可重現，主demo只經exact-guarded local reset建立，唔在有手動／非manifest ACTIVE enrollment的既有班上疊加資料。Reset後以`DEMO_ANALYTICS_BASE_SEED=1`執行base seed：保留word catalog、base admin／teacher accountName及env password contract，但唔建立原本40名generic students或額外test student enrollment；可登入test student改由本demo manifest其中一名學生承擔。18班、144名班內學生、6名特殊學生、demo教師、access及全部學習ledger都由同一fixture version擁有。一般`npm run seed`在非demo mode維持既有帳號數量行為，但可見文案同樣改成繁體。

### 7.2 最多90日學習型態

以固定 PRNG seed 將學生分配到下列 archetypes；同一 account 永遠保持同一型態：

| 型態 | 約佔 | 可見效果 |
|---|---:|---|
| 穩定高參與 | 20% | 多個 StudyDay、較多 eligible probes、較高 current mastery |
| 穩定一般 | 25% | 規律但活動量及正確率中等 |
| 近期改善 | 20% | 前半低、最近 30 日活動及正確率上升 |
| 間歇學習 | 15% | 集中數日大量練習，中間長空白 |
| 需要跟進 | 15% | 少量活動、較多到期 review、較低 accuracy |
| 新加入／無活動 | 5% | 只有最近數日或完全沒有活動 |

每班有預定型態比例，再加入小量seeded variation，令班級有差異又不會一班全是「高分」或全是「低分」。主demo anchor end固定為`min(today, CURRENT year.endsOn)`；如anchor end早於startsOn（future-start／invalid zero-day CURRENT year）就fail closed，唔建立0／負日fixture。Horizon為`min(90, startsOn至anchor end的inclusive day count)`；manifest／CLI回`effectiveFixtureDays`、anchor dates及`rangeClamped`。一般學生`enrollment.startedAt`不遲於fixture首日；只有「剛加入」archetype可較遲。學年未滿90日就縮短，已過endsOn就只建至endsOn，兩者都唔把活動倒灌到學年外。

Deterministic contract只涵蓋reserved account／class keys、人物型態、活動日期、分布及預期metric；DB-generated IDs、CSPRNG密碼、bcrypt salt/hash及execution timestamp明確不要求bit-for-bit相同。

### 7.3 Canonical V2 fixture lineage

主demo只寫獲批准的operational `DUE_REVIEW`／`EVIDENCE_OBLIGATION`資料，並使用專用canonical historical fixture factory建立：

- `User`、`StudentProfile`、CURRENT `StudentEnrollment`、`TeacherProfile`及`TeacherClassAccess`；
- 已過期／retired且不可續接的`StudySession`、terminal `StudyStreamItem`、digest-only credential lineage；
- 每個Learning Card的REVEAL及SELF_RATING兩個durable actions、各自global `OperationReceipt`，以及SELF_RATING建立的acknowledged `StudyEncounter`；
- 每個Objective Probe的ANSWER及FEEDBACK_ACK兩個durable actions、各自global receipt、valid `ObjectiveQuestionSnapshot`、`ObjectiveEvidenceTarget`、CONSUMED target、`winningOperationId`、`winningReviewEventId`、`consumedAt`及最終ACKNOWLEDGED stream item；
- `EVIDENCE_OBLIGATION` probe必須有由source encounter／operation admission的`EvidenceObligation`，target `obligationId`、stream item `workObligationId`及source operation互相一致，並按正式PENDING→LEASED→ANSWERED lifecycle終結；
- wrong objective answer按正式policy admission／coalesce一個`REMEDIATION` obligation，再由canonical remediation Learning Card流程完成，或在policy age limit後以`EXPIRED`／`terminalReason=age-limit`終結；不得直接刪除或留下active debt；
- provenance-complete `ReviewEvent`、由活動ledger支持的`StudyDay`，以及按事件順序推導的current `Review`；
- 可選少量`UserAchievement`只作現有學生UI視覺驗證，唔作analytics source。

Factory必須重用正式question construction、quality policy、operation fingerprint及time-aware SM-2 reducer。實作先將現有helper純化為`updateSM2At(state, quality, now)`，production `updateSM2()`只作傳入當下clock的compatibility wrapper；freeze-clock parity test要證明重構前後production default結果完全相同，唔改排程語義。Fixture按歷史event timestamp及`expectedReviewRevision`／CAS順序重播，逐欄核對`Review.interval`、`repetitions`、`easeFactor`、`nextReviewDate`、`lastReviewedAt`、`totalReviews`及`revision`，包括歷史due-date，唔只要求「看似合理」。

每個scored target恰好一個winner，target／snapshot／stream item／event／receipt互相指向同一operation及word；每個EVIDENCE target恰好一個matching obligation；wrong result產生的remediation有source operation且最後terminal。每個terminal state transition必須有完整durable action receipts：Learning Card為REVEAL＋SELF_RATING，Objective Probe為ANSWER＋FEEDBACK_ACK；receipt request fingerprint／action kind／outcome reference都要解析到同一ledger，唔只為最後一步補一張receipt。

Chronology／scheduler invariant同樣使用production policy helpers驗證：

- `DUE_REVIEW` probe的issued／created time必須在當時Review `nextReviewDate`或之後；
- EVIDENCE work先由source self-rating admission，probe要滿足policy的10分鐘delay、`eligibleAt`／`expiresAt`、intervening-item及combined debt-cap／selection rules；
- revision精確跟production action contract：REVEAL只寫`revealedAt`及receipt，item／session revision保持不變；SELF_RATING、ANSWER、FEEDBACK_ACK各自經現有`nextSessionRevision()`把item clientRevision／session revision推進一次。Fixture以production parity test鎖定呢個action-specific行為，唔改V2 runtime語義；
- Learning Card固定`created/leased < reveal < self-rating acknowledgement`，Probe固定`created/leased < answer < feedback acknowledgement`；
- obligation只可按正式PENDING→LEASED→ANSWERED或age-limit EXPIRED transition，唔製造不可能的時間倒序。

主demo不得建立research、diagnostic、non-winning、missing-provenance或historical bridge rows。呢啲只可存在於隔離unit／DB negative fixture，測完即清理，亦不可在可視demo或統計入面出現。Generator完成時必須證明無live bearer credential、ACTIVE／resumable session、未到期lease、OPEN target、未完成obligation、pending outbox或可續接checkpoint。

`StudyDay`同活動ledger雙向核對：每個StudyDay至少有同一Asia/Shanghai本地日的eligible ReviewEvent或acknowledged StudyEncounter；每個eligible event／encounter亦有唯一對應StudyDay。Self-rating encounter只增加練習量，永不更新Review、mastery、accuracy、排行榜或單元解鎖。

### 7.4 繁體中文 fixture gate

- `prisma/seed.ts`既有local base seed及新demo generator擁有的可見姓名、暱稱、描述、標籤、提示及CLI輸出全部直接保存／輸出繁體中文；保留accountName及password env contract，但把「管理员／王老师／本地测试学生／学生」等fixture文案改成繁體。
- 既有canonical word list唔屬fixture-owned內容，繼續由全站locale顯示層處理；DB scan只限定fixture manifest能識別的欄位／rows，唔誤報詞庫。
- 新增server-only strict OpenCC `s2t` validator，輸入先NFC normalize，再要求strict conversion結果與原文完全相同；converter初始化、dictionary載入或conversion出錯一律中止seed。禁止調用會fallback原文的UI `convertText()`作驗證，亦唔自動改寫後寫入。
- 測試覆蓋base seed source／fixture literal inventory、新generator source、captured CLI output及rebuild後DB visible fields；明確拒絕「学生／老师／测试／管理员」等簡體，並覆蓋NFC／NFD、全形字符及合法繁體異體，避免用一張脆弱字表代替converter。

### 7.5 執行、原子替換及憑證

新增獨立命令：

```bash
npm run seed:demo-analytics -- --preview-reset
npm run seed:demo-analytics -- --reset-and-rebuild --confirm-local-demo-reset
```

保護措施：

- 必須明確使用`MIGRATE_URL`；`DATABASE_ENVIRONMENT`只接受`development | test`，production固定拒絕；`CONFIRM_DATABASE_ENVIRONMENT`必須相同；先核對persisted `DatabaseMetadata.environment`。
- `--preview-reset`只打印繁體的精確database／schema fingerprint、現有row counts、將會徹底刪除本機schema的警告及預計fixture counts；唔打印完整URL、credential hash、PII清單或密碼。實際執行要同時提供exact confirmation flag；沿用已獲批准的`reset-local-roster` schema drop→migration replay流程，唔以application-level wildcard delete模擬全清。
- Orchestrator在整段reset／deploy／base-seed／demo-build期間持有database-scoped advisory lock；第二個並發run固定stable conflict，避免兩個schema rebuild互踩。
- Migration完成後寫environment marker並以`DEMO_ANALYTICS_BASE_SEED=1`執行繁體base seed；persisted非PII demo manifest記錄fixture version、seed key hash、deterministic account keys、effective days及`BUILDING | READY`狀態。
- 密碼在demo transaction外以CSPRNG逐個產生並bcrypt；其後以單一transaction建立18班、exact 144＋6學生、教師access、完整ledger及READY manifest。Generator失敗時demo transaction全部rollback，只留下已重建的base schema／`BUILDING`標記，絕不留下半套學生或PII；舊本機資料已按明確授權刪除，唔承諾回復。修正後重跑要收斂到一個完整READY dataset。
- 非登入型demo students使用不公開CSPRNG密碼；terminal不列出144組credential。可登入admin／teacher／student密碼只來自本機env並不得提交Git；其他學生由新admin reset取得一次性臨時密碼。
- READY invariant必須證明18個班各有exact 8名manifest ACTIVE students，班內不存在額外ACTIVE enrollment，六名特殊學生亦唔混入固定比較基數。Fresh base seed、已有40名base students、手動學生及半途crash四種起點都要先被exact reset消除，再得到相同account／metric分布；標準非demo seed行為另作regression。

144人fixture供產品視覺及一般查詢驗收。另建isolated、可清理的scale builder，只在disposable test schema建立一個startsOn早於今日至少180日的synthetic CURRENT year、六級A–H共48個active classes、均勻分布的500名ACTIVE學生、代表主demo archetype密度的180日ReviewEvent／StudyEncounter／StudyDay／current Review，以及可覆蓋48班的teacher及全校admin scope。Scale rows沿用canonical factory但唔建立500個可登入帳號；performance suite完成即按獨立manifest drop／清理整個disposable schema，絕不混入主要demo或開發者手動資料。

## 8. 資料庫及 migration 判定

- Admin directory及 reset 不需要新 canonical columns。
- 第一版 analytics 直接使用 `Review`、`ReviewEvent`、`StudyDay`、enrollment及class access，不新增 materialized daily table。
- 新增普通forward migration，令`StudentProfile` INSERT／UPDATE／DELETE及User legacy identity UPDATE都bump `RosterMutationState.revision`；migration要有fresh replay、raw SQL及supported writer conformance tests。
- 實作前以144-user主demo的effective horizon及隔離48-class／500-user／180-day scale fixture跑`EXPLAIN (ANALYZE, BUFFERS)`；只有查詢計劃證明需要時才新增普通expand index，例如ReviewEvent的user/date條件或StudyDay date/user組合。
- 任何新增 index 使用普通 forward migration，並通過 fresh migration replay及 checksum；不使用 `prisma db push`。
- Demo rows 是 seed／fixture data，不放入 migration。
- 不執行 `prisma/contract-migrations/`，亦不借今次工作移除 legacy identity／teacher reset physical columns。

## 9. 分階段實施計劃及 Checklist

### Phase 0：批准、baseline及 contract fixtures

- [x] 使用者確認本計劃範圍；狀態改為「進行中」。
- [ ] 建立 current baseline screenshots／API fixtures：admin users、teacher class summary、progress、student detail。
- [x] Inventory `/api/admin/users`、admin edit password、teacher/admin reset、teacher aggregates及所有 caller。
- [x] 凍結本計劃的route／完整DTO／error code、analytics range、cohort口徑、compare caps及demo／scale fixture contract。
- [ ] 為現有「管理員手動密碼」「admin-as-teacher student reset」「教師 reset」建立characterization regression，凍結ADMIN caller轉新route及T0原子拒絕v1／啟用v2次序。

驗收：現況差距、相容 caller及刪除 gate 有可執行證據；尚未改產品資料。

### Phase 1：共用 query、reset及 analytics primitives

- [x] 建立共用auth error mapper；`requireRole()`的503一律映射`AUTH_BACKEND_UNAVAILABLE`，401先映射`AUTH_REQUIRED`，所有新route／thin adapter fail closed且保留可重試session UX。
- [x] 把現有teacher-named reset precondition／limiter抽成audience-aware共用primitive；加入audience-specific v2 AAD／HKDF／keyring、exact RecentAuthGrant generation snapshot、T0拒絕v1及cross-route replay拒絕；policy table保留TEACHER 20／10／60／3＋teacher code，ADMIN使用30／20／60／3＋admin code，namespace／HMAC domain互相隔離。
- [x] 重構fresh-login／reauth grant writer為單transaction `User → exact grant → audit`，在row lock內atomic `GREATEST(clock,current+1ms)`；並加入對應 unit／source contract。
- [x] 建立 admin user query parser、filter fingerprint、signed cursor及role-aware欄位專屬搜尋 normalization；學生／教師用Profile，管理員用User legacyName，items／facets共用predicate。
- [x] 共用query parser凍結16 KiB／413、search／cursor／ID／limit／array uniqueness上限及negative tests。
- [x] 先把student self-nickname及所有supported Profile writers改用roster-first全域鎖序、profile CAS，再以forward migration補StudentProfile／legacy identity roster-revision triggers。
- [x] 抽出唯一 `learning-analytics` metric service，保留現有 teacher canonical definitions。
- [x] 加versioned objective correctness resolver；unknown policy version及known-policy invalid outcome都fail closed／另列excluded count，不猜測正確答案。
- [x] 凍結objective candidate universe及互斥excluded precedence，加入candidate／excluded守恆pure tests。
- [x] 建立Asia/Shanghai requested∩CURRENT-year effective range、零交集／future-start／ended warning、per-student exposure、每日零值補齊、StudyEncounter及sample-status純函數。
- [x] 新增相鄰unit tests，覆蓋dates、zero denominator、median、encounter、policy version、excluded counts、compare cap及cursor tampering。

驗收：三個後續 UI 都使用同一組純 contract；沒有 client-owned授權或指標計算。

### Phase 2：管理員用戶目錄 backend及 UI

- [x] 建立 `POST /api/admin/users/query`，server search／filters／facets／pagination及 private no-store headers。
- [x] Role、status、year、grade、class filters使用allowlist及body cap；`mustChangePassword`只作row badge，唔作filter／sort。
- [ ] 凍結role／status／grade／A–H classCode facet self-dimension語義、selected-year enrollment projection及nullable canonical account fallback。
- [ ] Search raw value不入 URL／history／storage／普通logs；加入 negative scan tests。
- [x] 重整 `/admin/users`：role tabs、篩選列、active chips、clear all、desktop table、mobile cards、loading／empty／stale／error states。
- [x] 建立ADMIN-only detail query，回contactEmail及relevant User／Profile／Enrollment revisions；edit modal每次打開fresh load。
- [x] 將現有PATCH改成strict互斥`UPDATE_IDENTITY／CHANGE_STATUS` commands；前者按§6.2完成body cap、CSRF、recent-auth、normalization／validation、identity lock／唯一性、User＋Profile CAS、private response及transactional audit。
- [x] 兩種command都在同一Serializable transaction按全域鎖序鎖actor／target及grant，重驗actor role／status、session credential revisions、session-JTI grant；mid-flight撤權時target／roster revision／audit完全不變。
- [ ] `UPDATE_IDENTITY`遇self-nickname／import／profile／contact並發後舊modal 409再載入；invalid／duplicate／unknown-field及audit failure各有stable code同rollback test。
- [ ] `CHANGE_STATUS`調用唯一canonical lifecycle service；遷移users／roster全部caller並保留停權、兩種restore、revision CAS、self／last-admin、session revoke及audit regression。
- [ ] 修正 load-more 保留完整 filter fingerprint，並在 stale 409 後由第一頁重載。
- [x] Student／teacher row加入正確 cross-link；避免在 users page重造 roster lifecycle操作。
- [x] 新增／編輯 modal 移除「替別人手動輸入密碼」作主要 reset入口；create仍可自動產生初始密碼。
- [ ] 新 caller及tests轉移後，route inventory確認舊 GET zero caller，再移除或縮成短期adapter。

驗收：管理員可在 144+ users 中快速找出指定學生／教師；filters跨頁不遺失、不洩露PII。

### Phase 3：管理員學生／教師自動 reset

- [x] 建立 prepare route，回 target snapshot及5分鐘 actor/session/target-bound precondition。
- [x] 建立 commit route；recent-auth、CSRF、role/status、revision、credential CAS、limiter及audit全部server-side重驗。
- [x] V2 precondition綁actor token／credential revisions並fresh recheck；mid-flight actor credential change fail closed且target無變；T0後v1一律拒絕、無legacy commit branch。
- [x] V2 precondition綁exact RecentAuthGrant `reauthenticatedAt／expiresAt`；grant helper保證每次reauth嚴格單調，prepare→grant expiry→同session reauth後舊token server-side拒絕，重新prepare先成功。
- [x] Limiter以domain-separated HMAC pseudonymize actor／session／IP／target並按§6.3次序consume；raw IP／JTI不入backend或log。
- [x] 從 generic admin user PATCH 移除 password writer；任何 `password` 欄位固定422 `PASSWORD_FIELD_NOT_ALLOWED`，避免舊API繞過專用reset安全流程。
- [x] Student及teacher target共用 `replacePasswordCredential()`；ADMIN／self／suspended固定拒絕。
- [x] 加 reset button、身份確認 dialog、pending guard；reauth要求重新 prepare。
- [x] 成功 modal顯示10位臨時密碼、select affordance及明確「複製密碼」button；關閉後清除記憶體。
- [ ] API及UI處理 expired／tampered／wrong session／wrong target／stale／double-click／rate limit／backend unavailable。
- [ ] 新admin／reset adapters把auth backend 503顯示成可重試繁體服務錯誤，唔顯示「登入已過期」亦唔清cookie。
- [ ] 驗證admin token與teacher token不可跨route重播；student及teacher forced-change後分別續接正確角色首頁。
- [ ] 全部ADMIN caller遷到admin route；T0原子停止簽／讀v1、只接受v2並移除ADMIN exception，teacher route同時改TEACHER-only；未過期v1亦只可refresh／reprepare。
- [ ] SecurityEvent、response headers、log redaction及 plaintext artifact scan通過。

驗收：管理員可安全重設任何 ACTIVE student／teacher；舊 session失效，target下一次登入被要求改密碼並可直接續接新 session。

### Phase 4：期間 analytics backend

- [x] 建立 role-aware authorized context及三個 analytics routes。
- [x] 按§6.5實作完整request／response DTO、immutable account cursor、`asOf` event cutoff、excluded counts及sample status。
- [x] 所有analytics success DTO／timeline及cursor fingerprint同時帶requestedRange及effectiveRange，clamp後load-more不得漂移。
- [x] Class query支援最多48 actual班的summary-only directory、ADMIN unassigned summary，以及明確選取最多6班的timeline comparison；range clamp至CURRENT year並常駐`CURRENT_MEMBERSHIP` cohort標記。
- [x] Student query支援search、grade／class、date range、ACCOUNT_ASC cursor及最多8人comparison。
- [x] Student timeline按日回傳encounters／reviews／objective attempts／correct／distinct words，按exposure補齊eligible零值日期。
- [x] Current mastery與period activity在 DTO明確分區，避免把current stock畫成歷史trend。
- [x] 所有aggregate使用批量查詢及set-based資料讀取；禁止 per-student API N+1。
- [x] 所有查詢在同一authorization-bearing snapshot完成並在回應前重驗scope revisions；mid-query revoke／suspend不得回partial PII。
- [x] Recheck同時比對actor tokenVersion／credentialRevision；mid-query admin reset或self password change回401且無PII。
- [ ] 初始已停權／session-invalid actor回401、valid-session wrong role回403、auth backend outage回503；mid-query suspension回403；另有scope revoke、inactive class、stale cursor、ADMIN unassigned及IDOR tests。
- [x] 在144人主demo及隔離48班／500學生／180日scale fixture量query count、response size及EXPLAIN；只按證據加forward indexes。

驗收：同一HTTP transaction snapshot內，encounters、effective reviews、objective attempts／correct等additive raw counts逐日合計與period summary相等；distinct學生／詞、median及rate由同一cohort原始rows重算並各自核對，唔把student-days直接相加。跨route只在quiescent fixture比較；Teacher／Admin差別只來自scope。

### Phase 5：教師及管理員 analytics UI

- [x] 擴充 `/teacher` 班級分析：7／30／90／custom range、grade filter、班級 multi-select及 comparison summary。
- [x] Class cards顯示active rate、objective accuracy、每生活動、current mastery及due rate，並保留名冊／進度入口。
- [x] 所有class surface常駐「按目前班級成員計算」及effective range／coverage；accuracy 1–4 attempts只顯示分子／分母與「樣本較少」。
- [x] `/teacher/progress` 加期間欄位、穩定`ACCOUNT_ASC`分頁及最多8人的compare tray。
- [x] Student detail加入每日timeline、期間summary及accessible data table。
- [x] 建立 `/admin/analytics`，在admin shell顯示全校視角banner、年級／班級／學生切換及未分班group。
- [x] 補上管理員「查看學生」流程：由班級卡片帶入 `classId`，呼叫學生分析查詢，顯示班內學生、搜尋及 signed-cursor 載入更多；清除／切換年級會離開班級學生視角。
- [ ] 圖表使用現有 EMM Style 02 tokens及Icon；無emoji、無舊圖示、無只靠顏色的狀態。
- [ ] Desktop、mobile、200% zoom、keyboard、focus、live region、繁／簡及light／dark targeted QA。
- [ ] 空資料、部分日期無資料、0 attempts、極端高低值及長姓名不破版。

驗收：教師可由班級比較在三步內進入個別學生趨勢；管理員可用相同數據查看全校而不離開admin navigation。

### Phase 6：development-only 示範資料 generator

- [x] 建立exact local reset guard、database advisory lock、demo-mode base seed、deterministic account keys及BUILDING／READY manifest。
- [x] 從fresh demo-mode base seed建立18班、exact 144名班內學生、6名特殊學生及4名專用demo教師／access fixtures；每班不得有額外ACTIVE enrollment。
- [x] 實作6種deterministic learner archetypes及最多90日Asia/Shanghai活動分布。
- [x] 主demo按CURRENT-year開始日縮短至最多90日並記錄clamp；一般enrollment覆蓋完整fixture horizon。
- [x] 將base seed與demo fixture-owned姓名、暱稱、描述／標籤及CLI摘要寫成繁體中文，加入strict server OpenCC、source／DB scan及fail-closed negative gate。
- [x] 將SM-2 helper抽成time-aware `updateSM2At(..., now)`＋production compatibility wrapper，以freeze-clock parity證明語義不變。
- [x] 建立canonical terminal V2 lineage：session、stream item、credential digest lineage、Encounter、每個durable action receipt、EvidenceObligation／terminal remediation、target、snapshot、winning link、ReviewEvent、StudyDay及event-time SM-2 Review。
- [ ] 主demo只用批准operational purposes；research／diagnostic／non-winning等只在隔離negative fixtures並即時清理。
- [ ] Schema reset／migration／base seed後，pre-hash並以單一transaction建立demo dataset；失敗只留base schema＋BUILDING、無半套學生／PII，重跑可收斂。
- [ ] 只從env取得可登入fixture密碼；不打印／提交大量明文credential。
- [x] 加fixture invariant tests：班級／人數、日期、membership、obligation雙向link、wrong-remediation terminal、四種action receipt、完整objective provenance、無live session／debt／feedback、繁體及source scope。
- [ ] 加scheduler chronology tests：DUE schedule、10分鐘evidence delay／intervening item、debt cap、REVEAL revision不變及其餘三action各+1 parity、lease／credential及四action timestamp order。
- [ ] 分別由fresh DB、已有40名base students及手動學生三種起點執行reset-and-rebuild，確認舊enrollment清零、exact counts及畫面一致。

驗收：exact guard確認後重建整個獲批准的local demo schema，唔保留任何舊base／手動／非fixture rows；demo-mode base seed＋demo transaction產生完整READY環境，重跑結果穩定。標準non-demo seed另有regression，唔因demo mode改變。

### Phase 7：整合、文件及 handoff

- [x] 更新`plans/project-plan.md`、`class-roster-import-and-access-control.md`的generic PATCH／manual password supersession contract、本計劃進度、測試證據及已知限制。
- [x] 更新本機測試帳號及demo generator操作說明，但不記錄密碼。
- [x] 建立隔離48班／500學生／180日代表性ledger的disposable-schema scale builder並記錄manifest cleanup，唔污染主要demo。
- [x] 記錄所有新增／移除routes、indexes、queries及rollback方法。
- [x] 跑必需 unit、lint、typecheck、DB、migration、build及focused Playwright；不過度重跑無關card-motion suite。
- [x] 本機 scope 的 DoD 已通過；production／contract migration／native device gates繼續列為deferred。

驗收：另一位開發者由空白local DB可按文件重建、登入、搜尋、reset及查看多班／多日比較。

## 10. 測試矩陣

| 範圍 | 必驗情境 |
|---|---|
| Admin query auth | 無session及已停權／session-invalid admin回401；valid-session teacher／student回403；ADMIN成功；auth backend outage回503 `AUTH_BACKEND_UNAVAILABLE`、保留cookie、零PII且UI顯示可重試繁體服務錯誤 |
| Admin identity／CAS | ADMIN-only detail query回editable identity fields、`userRevision`及相應`profileRevision`，含`contactEmail`的response維持private no-store；identity command驗body cap／unknown field／CSRF／recent-auth／normalization／cross-field nickname／email uniqueness／identity-lock；學生自行改nickname、import/profile edit或另一admin改contact email後舊表單409；audit fail rollback且metadata無PII；password／role／status不可混入identity command |
| Admin status lifecycle | users及roster callers只用`CHANGE_STATUS` canonical service；學生／教師停權、一般CURRENT restore、planned-only PRE_ENROLLED restore、需要grade／class的restore、double-click／revision race、self／last-admin guard、tokenVersion及RecentAuthGrant撤銷、audit rollback均保留；identity欄不可混入status command |
| Admin mutation actor race | identity／status command開始後另一管理員停權／改role actor回403；actor被刪、reset或self-change password／session revision失效回401；只有RecentAuthGrant過期回`RECENT_AUTH_REQUIRED`；actor／target lock並發不deadlock，所有失敗case target、roster revision及audit零改動 |
| Profile writer concurrency | student self-nickname、admin identity、manual/import及raw profile update全部令roster revision／cursor stale；self-nickname×admin UPDATE_IDENTITY及raw trigger×admin真並發無deadlock／500，結果只可一方成功、另一方`PROFILE_STALE／ADMIN_USER_PROFILE_STALE`或bounded `PROFILE_WRITE_CONFLICT`，audit同authoritative profile一致 |
| Search | accountName、學生Profile legalName／nickname、教師Profile legalName、管理員User legacyName、前置零、NFKC、空白、重複姓名、無結果、role-specific authoritative source不誤用fallback、items／facets一致、PII不入URL／log |
| Filters | role／status／grade／classCode facets各自忽略自身dimension；CURRENT／selected year、六grade、完整A–H（含H班零／非零count）、H班filter跨cursor、矛盾組合422、tab切換清hidden filters；must-change只驗badge |
| Cursor | 0／1／50／51／144及隔離500；ACCOUNT_ASC無重複／漏項；tampered 422；identity／roster mutation後409；load-more保留fingerprint；analytics cursor同時綁定原樣`requestedRange`及clamp後`effectiveRange`，範圍不符／竄改拒絕；nullable canonical fallback |
| Reset target | ACTIVE student、ACTIVE teacher成功；ADMIN、self、suspended、missing拒絕；status race fail closed |
| Reset security | recent-auth、CSRF、wrong session／target、expired／tampered key；v2 actor token／credential revision及exact grant generation綁定，prepare→grant expiry→同session reauth後舊token拒絕／重新prepare成功，mid-flight actor reset／self-change不改target、無secret／success audit；ADMIN caller轉新route，T0原子拒絕所有v1／只接受v2並令teacher route TEACHER-only；v2 cross-route replay、audience-isolated HMAC limiter／audit allowlist及backend rollback |
| Reset limiter policy | T0前後TEACHER均為actor 20／session 10／IP 60每15分鐘、target 3每小時及`TEACHER_RESET_RATE_LIMITED`；ADMIN為30／20／60／3及`ADMIN_RESET_RATE_LIMITED`；兩套namespace／HMAC keys不互相消耗，raw IDs不入backend，production backend outage均fail closed |
| Grant concurrency | fresh-login／reauth按User→grant→audit；兩個同session同毫秒reauth產生嚴格遞增且不同generation，較舊precondition全失效；reauth×admin／teacher reset及identity／status commit兩種winner次序均無deadlock／500，reset舊token、target及audit結果符合§6.3 |
| Credential CAS | double-click、兩admin並發、response loss、第二次reset令第一組密碼失效、token／credential revisions各只正確增加一次 |
| Reset UX | confirm identity、pending disabled、reauth後re-prepare、一次性secret、copy feedback、modal focus／close清除；student／teacher forced-change後到正確角色首頁 |
| Membership／range | teacher 0／1／多班、shared class、revoked access、inactive class、suspended teacher/student、ADMIN unassigned、new join exposure、same-year transfer cohort提示；success DTO原樣回傳`requestedRange`並另回clamp後`effectiveRange`；startsOn／endsOn inclusive、完全早於／晚於year 422、future-start CURRENT 503、ended-but-not-activated warning且不延長日期 |
| Metrics | 0 students／words／attempts、7／30／90／180日、Asia/Shanghai日界、mean／median、due／review denominator、acknowledged encounters、zero-activity members、1–4 attempt／student small-sample、per-student accuracy median及studentsWithAttempts分母 |
| Objective | correct／wrong、unknown policy、純V1唔入candidate、V2 winning；多重失敗candidate按互斥precedence入一個bucket，candidate=eligible+excluded且buckets總和守恆；negative fixtures即時清理 |
| Comparison | classIds省略的0／48 actual班summary無timeline、ADMIN optional unassigned summary／TEACHER null、明確1／6班有timeline、7班422；1／8學生成功、9人422；UNASSIGNED只限ADMIN；selected IDs的scope／grade／classFilter語義；不同班人數及raw total同時有denominator |
| Timeline | 中間缺日補零、exposure前ineligible、跨月／跨年、today inclusive、future拒絕；ReviewEvent.createdAt／Encounter.acknowledgedAt／StudyDay date+createdAt跨asOf；StudyDay雙向一致；只將additive raw counts逐日相加，distinct／median／rate另由cohort重算 |
| Analytics parser／PII | body>16 KiB回413；oversized search／cursor／ID、duplicate selections、limit邊界；CSRF／no-store／Vary／nosniff／no-referrer及search log redaction；初始無session或已停權／session-invalid cookie回401、valid-session role不符回403、初始target不存在／inactive／不可存取回404、auth backend outage回503並保留retryable session UX；mid-query actor停權／role失效優先回403、只有token／credential revision撤銷回401、access／roster／year revision競爭回409；全部情境均不回partial PII |
| Demo ledger | 18×8、六特殊學生、effective horizon≤90日且year-clamp正確；session／stream／digest lineage、四action receipts、EvidenceObligation／wrong remediation、target／snapshot／winner完整；time-aware SM-2逐欄／due-date重播相等；chronology／scheduler合法且無live session／lease／debt／unacked feedback／OPEN target／outbox |
| Demo reset/isolation | production／marker mismatch拒絕；fresh、40 base students、手動學生起點均exact reset成18×8；標準seed regression不變；transaction fault只留base＋BUILDING且無demo PII；並發run stable conflict；主demo無research／diagnostic／non-winning |
| Demo繁體 | base seed及demo source literals、captured CLI、manifest DB fields通過strict s2t identity；converter unavailable fail closed；簡體negative為零；NFC／NFD／全形／合法繁體異體 |
| Demo determinism | reserved account／class keys、archetype、dates、distribution及metric rerun相同；DB IDs、CSPRNG password、bcrypt hash、runtime timestamp明確排除 |
| Scale fixture | disposable synthetic year≥180日、48 active classes、500 active students、代表性180日events／encounters／StudyDays、teacher 48-class＋admin scope；budget測完manifest cleanup為零 |
| UI／a11y | desktop／mobile、200% zoom、keyboard、table semantics、chart alternative、focus return、live errors、雙locale／theme |
| Regression | admin roster lifecycle、teacher class scope、teacher reset、forced-password continuation、V1/V2 learning semantics |

## 11. 驗證命令

實作時按改動階段執行，不要求每個小步重跑全部：

```bash
npm test
npm run lint
npx tsc --noEmit
npx prisma validate
npx prisma generate
npm run test:roster
npm run test:roster:auth
npm run test:roster:reset
npm run test:db
npm run test:db:stream-v2
npm run test:migration-checksums
npm run test:migrations
npm run test:migrations:contract
npm run check:roster-pii
npm run check:production-config
npm run build
npm run test:e2e:admin-roster
npm run test:e2e:study-stream-v2
DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run test:learning-analytics:scale
```

另新增 focused suites／scripts：

```text
test:admin-user-directory
test:learning-analytics
check:demo-analytics-fixture
focused Playwright admin reset + teacher/admin analytics flow
```

Migration fresh replay只在最後整合跑一次，不需在每個UI commit重跑。因time-aware SM-2 wrapper會經過production scoring path，`test:e2e:study-stream-v2`列為local DoD；純gesture `test:e2e:card-motion`、production deploy及完整原生VoiceOver／TalkBack matrix與本改動無直接關係，不列作必跑。

## 12. 效能預算

- Admin user query：144-user fixture warm p95 ≤ 500 ms；500-user fixture warm p95 ≤ 1 s；最多 8 DB round trips；response ≤ 128 KiB。
- Class summary directory：48 actual班＋optional unassigned summary、180日、無timeline，warm p95 ≤ 1.5 s；driver-level SQL statements ≤ 24；response ≤ 256 KiB。
- Class comparison：6班／180日連timeline，warm p95 ≤ 2 s；driver-level SQL statements ≤ 24；response ≤ 256 KiB。
- Student analytics list：500-user authorized scope、首50 rows／180日，warm p95 ≤ 1.5 s；driver-level SQL statements ≤ 24；response ≤ 256 KiB。
- Student comparison：8人／180日，warm p95 ≤ 1.5 s；driver-level SQL statements ≤ 24；response ≤ 256 KiB。
- Student timeline：1人／180日 warm p95 ≤ 1 s；driver-level SQL statements ≤ 24；response ≤ 128 KiB。
- 「driver-level SQL statements」包括 Prisma/PostgreSQL transaction BEGIN／COMMIT、fresh authorization recheck及 nested relation statements；scale script以 `pg.Client.prototype.query` 實測，唔把應用層估算當成 round-trip。超過24仍視為失敗，禁止用無限制cache PII掩蓋。
- 所有量度用同一production build＋local PostgreSQL及固定fixture，先cold一次，再量至少20次warm先計p95；任何一次不得超過門檻2倍。
- 未達時先修set-based query、index或DTO，不以提高timeout、隱藏截斷或無限制cache PII解決。

## 13. 風險及緩解

| 風險 | 等級 | 緩解 |
|---|---:|---|
| Admin reset成為越權入口 | 極高 | target roles allowlist、recent-auth、audience-bound AEAD、cross-route rejection、transaction recheck、CAS、audit |
| 明文密碼外洩 | 極高 | 一次性no-store response、memory-only modal、log／artifact scan、不提供recovery |
| Teacher analytics越過班級scope | 極高 | 同一authorization snapshot、response前scope recheck、IDOR／mid-query撤權tests、UI filter只可縮窄 |
| 假資料污染學習contract | 高 | canonical historical factory、完整terminal V2 lineage、正式SM-2重播、dev/test-only invariant tests |
| Current mastery被誤畫成歷史 | 高 | DTO分開current stock及period flow；第一期不畫historical mastery line |
| 大班比較只反映人數 | 高 | active rate、per-student、median及分母；raw totals不可單獨展示 |
| 兩套admin名冊互相衝突 | 高 | users只負責逐人帳號；roster負責校務；共用query／cross-link，不複製writer |
| PII經搜尋URL／cache外洩 | 高 | POST body、memory-only search、private no-store、Vary Cookie、redaction tests |
| 180日event query變慢 | 中 | range／selection caps、set-based aggregation、代表性scale ledger、EXPLAIN、按證據加index |
| Demo reset刪錯database／留半套資料 | 極高 | exact environment＋persisted marker＋confirmation、DB/schema fingerprint、全程advisory lock、既有reset script、單transaction demo＋READY；production固定拒絕 |
| Fixture混入簡體字 | 中 | strict server OpenCC fail closed，掃base seed／demo source、CLI及manifest DB rows |
| 圖表難以無障礙使用 | 中 | 同內容table／summary、keyboard、非顏色唯一、live region及zoom QA |

## 14. Rollout、rollback及資料處理

- 本計劃獲批後只在目前 branch及local development DB實作；不推定 production已有任何新route或data。
- 先上共用service及新routes，再切UI；舊routes只在route inventory zero caller後移除。
- Admin reset UI可獨立回退；已完成的password reset不可恢復舊密碼，但可再次安全reset，這是預期credential語義。
- Analytics UI若有問題，可暫時回到現有current／7-day class summary；canonical Review／ReviewEvent資料不需回退。
- Demo reset-and-rebuild會按已獲批准的local destructive workflow刪除目標schema內所有舊測試資料，再重播migration、demo-mode base seed及demo transaction；rollback係修正後重跑，唔承諾恢復被刪舊資料。READY前不得聲稱demo可用。
- 若新增index，只以forward migration處理；不修改已套用migration，不執行contract migration。
- 不觸碰production、preview deployment或真實學生資料；任何外部發佈要另行批准及制定觀察／回退窗口。

## 15. Definition of Done

- [ ] `/admin/users` 有server search（含學生／教師Profile姓名、學生nickname及管理員User legacyName）、role／status／year／grade／完整A–H class filters／facets、must-change badge及穩定分頁。
- [ ] Search PII不入URL／history／storage／普通logs，所有admin PII response private no-store。
- [ ] 管理員identity detail由ADMIN-only private query取得editable fields、User／Profile revisions；`UPDATE_IDENTITY`具body cap、strict fields、CSRF、recent-auth、canonical validation／identity lock／唯一性、兩層CAS、transactional non-PII audit及private response。
- [ ] `CHANGE_STATUS`係users／roster共用的唯一single-account lifecycle writer，完整保留停權、CURRENT／PRE_ENROLLED restore、revision／self／last-admin guards、session revoke及audit，唔因identity重構破壞現有按鈕。
- [ ] 兩種管理員mutation都在Serializable transaction內鎖定並重驗actor session／role／status／credential revisions／RecentAuthGrant；mid-flight撤權或改密碼時target、roster revision及audit完全不變。
- [ ] 所有supported Profile writers（含學生self-nickname）使用roster-first全域鎖序、revision CAS及bounded retry；新trigger用NOWAIT／40001防反向等待，self-nickname×admin identity並發無deadlock／500且cursor必定stale。
- [ ] 管理員可對ACTIVE學生及教師自動reset，不能reset ADMIN／self／suspended target。
- [ ] Reset generator、一次性顯示／copy、exact-generation recent-auth、audience-bound AEAD precondition、reauth後舊token拒絕、cross-route rejection、CAS、session revoke及audit完整；limiter按audience隔離並保留TEACHER 20／10／60／3＋teacher code，ADMIN使用30／20／60／3＋admin code。
- [ ] 所有ADMIN reset caller使用admin route；T0原子停止簽／讀v1、只接受v2、移除ADMIN exception並令teacher route正式TEACHER-only；未過期v1亦安全拒絕並重新prepare。
- [ ] Target使用臨時密碼登入後要改密碼，改完可直接繼續使用新session。
- [ ] Fresh-login／reauth及所有grant consumers遵守`User → exact grant → audit`；同session並發reauth generation唯一遞增，reauth×reset／identity／status commit無deadlock、未處理500或錯誤target mutation。
- [ ] 所有本計劃新route／adapter把暫時auth backend故障固定回503 `AUTH_BACKEND_UNAVAILABLE`；cookie不被誤清除，繁體UI顯示可重試服務錯誤而非「登入已過期」，response不含PII。
- [ ] Teacher及Admin analytics使用同一canonical service及scope-aware DTO。
- [ ] Analytics PII在同一authorization-bearing snapshot取得並fresh recheck：初始無session或已停權／session-invalid cookie回401、valid-session role不符回403、初始target未授權／已撤權／不存在回404、auth backend outage回503；mid-query actor停權／role失效優先回403、只有credential/session撤銷回401、scope／roster／year revision race回409；全部唔回partial PII。
- [ ] 教師可按7／30／90／custom期間比較最多6班及8名學生。
- [ ] Student detail有ReviewEvent及acknowledged StudyEncounter期間summary／逐日timeline；current mastery與period activity清楚分開。
- [ ] 班級分析固定CURRENT-membership cohort、CURRENT-year clamp及per-student exposure，並常駐顯示口徑。
- [ ] 所有analytics success DTO及cursor原樣保留`requestedRange`並另帶clamp後`effectiveRange`；後者同`[startsOn,min(endsOn,today)]`取交集，零交集／future-start、ended warning及學年邊界測試按§4.4通過，永不回倒轉range。
- [ ] 班級比較使用rate／per-student／median及分母，不產生好壞排名。
- [ ] Objective DTO有candidate／eligible／mutually-exclusive excluded守恆、micro accuracy、per-student median、studentsWithAttempts分母及small-sample狀態。
- [ ] Demo fixture有六級、每級三班、每班八人、最多90日且year-clamped多型態資料及專用教師access。
- [ ] Demo V2 session／stream／digest lineage／Encounter、四種durable action receipts、EvidenceObligation／wrong-remediation、target／snapshot／winner／ReviewEvent完整；REVEAL revision不變、其餘三action各按helper+1；time-aware SM-2重播逐欄／due-date等於Review且無live runtime state或debt。
- [ ] Fixture deterministic scope、dev/test-only、可preview exact destructive reset、demo-mode base seed、單transaction demo及READY manifest完整；18班各exact 8人且舊手動／base enrollments不殘留。
- [ ] 隔離scale fixture有48班／500學生／180日代表性ledger及teacher／admin scope，四個directory／comparison budgets通過後完整清理。
- [ ] Base seed及demo fixture姓名、暱稱、描述／標籤及CLI摘要全部保存為繁體中文；strict OpenCC source／CLI／DB scan及fail-closed negative tests通過。
- [ ] 主demo無research／diagnostic／non-winning／missing-provenance rows；isolated negative fixture用完即清理。
- [ ] Unit、DB、migration、lint、typecheck、build及focused browser tests全部通過並寫回實際證據。
- [ ] Desktop／mobile、繁／簡、light／dark、keyboard及targeted accessibility QA通過。
- [ ] 不改 Retrieval-first V2、SM-2、排行榜、單元解鎖、public nickname privacy或roster lifecycle contract。

## 16. 決策紀錄及未決事項

以下預設已在本計劃凍結，暫時不要求使用者再作技術決定：

| 項目 | 決定 |
|---|---|
| Admin reset target | 只限 ACTIVE STUDENT／TEACHER |
| Admin／self reset | 此頁不提供；自己的密碼用個人帳戶流程 |
| Bulk reset | 不新增；匯入批次沿用rotation workflow |
| 臨時密碼 | 沿用10位易讀小寫字母／數字及一次性copy |
| Analytics default | 最近30日；7／30／90 preset；custom最多180日 |
| Compare caps | 最多6班／8名學生 |
| Class directory | 省略classIds只回最多48 actual班summary＋ADMIN optional unassigned summary；唔回timeline |
| Mastery歷史 | 第一期不新增snapshot table；顯示current mastery＋period activity |
| 班級歷史口徑 | CURRENT membership cohort；range clamp至CURRENT year；新加入學生按enrollment.startedAt計exposure |
| Analytics排序 | 分頁只用immutable accountName＋id；current Review唔扮成asOf歷史snapshot |
| Demo規模 | 6級 × 3班 × 8人＝144名班內學生，另6名特殊fixture |
| Demo期間 | anchor end=`min(today, endsOn)`，最多90日；future-start／零日fail closed，manifest／UI明示effective days及clamp |
| Demo ownership | 依使用者授權exact reset本機schema；完整分析資料沿用標準 `admin`／`teacher`／`teacher-reset`／`student-test` 測試帳號及 `.env.local` 密碼 contract，不另建 `demo-*` 登入帳號；全部班級／學生／教師／ledger由同一fixture version擁有 |
| Demo語言 | Base seed及demo fixture-owned可見資料直接保存繁體中文；strict server OpenCC fail closed，不依賴顯示層轉換 |
| Demo learning data | 只建批准operational V2 terminal lineage；正式reducer重播Review；research／diagnostic只供隔離negative tests |
| Historical SM-2 | 新增time-aware canonical reducer；production wrapper保持現有clock語義，fixture先可按event time重播 |
| V2 work／receipts | EVIDENCE／remediation obligation必須terminal；Learning Card及Probe四種durable actions各有global receipt |
| Reset token | Admin／teacher使用不同audience及AAD／HKDF domain，不能跨route重播 |
| Reset route cutover | ADMIN全部轉新route；T0原子停止簽／讀v1、只接受v2、移除ADMIN exception並令teacher route全面TEACHER-only；舊v1即時安全拒絕／重新prepare |
| Scale fixture | 獨立disposable schema：48班／500學生／180日代表性ledger，budget完成即完整清理 |
| Admin analytics | 新增admin shell入口，但共用teacher analytics service |
| 本機登入帳號 | 分析資料重建後仍使用標準測試帳號；管理員／教師讀取 `INITIAL_ADMIN_PASSWORD`，學生讀取 `TEST_STUDENT_PASSWORD`，不再使用 `DEMO_*` 密碼或 `demo-admin` 帳號 |

如果實作途中發現現有 schema 無法可靠回答已凍結指標，必須先更新本計劃並說明資料 contract；不可在 UI 暗中改名或用近似數據頂替。

## 17. 本輪實際執行記錄

已完成並在本機驗證：

- `npm test`：188 tests passed；`npm run lint`、`npx tsc --noEmit`、`npx prisma validate`；
- `npm run test:migration-checksums`、`npm run test:migrations`、`npx prisma migrate status`；
- `npm run build`（新增 admin／teacher analytics routes 及頁面均成功編譯）；
- `npm run check:demo-analytics-fixture`（18 班、150 名學生、4 名教師、1,130 個 V2 ReviewEvent、3,393 個 StudyEncounter／StudyDay、完整 target／snapshot／winner／obligation／四種 action receipt lineage、無 live session／未完成 debt／簡體來源）；
- Demo rebuild 已改為沿用標準本機測試帳號（`admin`、`teacher`、`teacher-reset`、`student-test`、`student-test_webkit`）；管理員／教師密碼由 `INITIAL_ADMIN_PASSWORD`、學生密碼由 `TEST_STUDENT_PASSWORD` 提供，資料庫 hash 核對全部通過，沒有另建 `demo-*` 登入帳號；
- 本機 exact reset-and-rebuild 已按使用者授權執行，舊測試名單及學習資料已刪除並以新 fixture 重建；
- `DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run test:learning-analytics:scale`：隔離 48 班／500 學生／180 日 fixture，20 次 warm samples及 `EXPLAIN (ANALYZE, BUFFERS)`；48-class summary p95 365.95ms／39,833 bytes／23 statements、6-class comparison p95 459.96ms／137,940 bytes／23 statements、500-user list p95 298.75ms／48,334 bytes／23 statements、8-user comparison p95 312.37ms／55,909 bytes／23 statements、1-user timeline p95 23.76ms／41,974 bytes／23 statements；EXPLAIN execution time為 members 0.59ms、ReviewEvent 15.50ms、StudyEncounter 10.22ms、StudyDay 60.23ms、Review 0.75ms；temporary schema已在finally cleanup；
- `npm run test:roster`、`npm run test:roster:invariants`、`npm run test:roster:lifecycle`、`npm run test:roster:auth`、`npm run test:roster:reset`、`npm run check:roster-pii`均通過；涵蓋班級權限隔離、raw DB invariants、hard-delete staging purge、session-bound recent auth、48-migration reset guard及PII／credential artifact scan；
- `DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run check:teacher-global-reset-cutover` dry-run通過（4名教師、3名global reset、18條legacy class rows、0 drift）；`npm run check:study-credential-v2`（stream items／receipts gap 0）及 `npm run check:study-stream-v2:soak`（3 iterations，p50 1207ms／p95 1285ms）通過；
- `npm run test:db`、`npm run test:db:stream-v2`、`npm run test:migration-checksums`、`npm run test:migrations`、`npm run test:migrations:contract`、`npm run check:demo-analytics-fixture`均通過；fresh replay／contract replay均為48個normal migrations，demo最後保留18班／150名學生／4名教師／1,130個ReviewEvent／3,393個StudyEncounter及StudyDay；
- `npm run check:production-config`在未提供production secrets的本機預期以exit 1 fail-closed；以不落盤的synthetic Upstash／CRON／HMAC／reset keyring執行同一檢查通過。兩者均只作設定驗證，沒有宣稱production deploy或production data pass；
- 本計劃新增／保留的route inventory：`POST /api/admin/users/query`、ADMIN detail query、ADMIN password-reset prepare／commit、`POST /api/learning-analytics/classes/query`、students query及student timeline query；`POST /api/admin/users`仍負責新建帳號，typed `PATCH /api/admin/users/[id]`只接受`UPDATE_IDENTITY／CHANGE_STATUS`。舊`GET /api/admin/users`目前仍由`/admin/roster`及部分focused E2E使用，故route-zero-caller／移除adapter checklist刻意未勾選；今次沒有新增analytics專用schema index，沿用現有forward indexes。
- Rollback record：analytics UI可回退到既有current／7-day摘要；admin reset UI可回退但已完成的credential reset不可復原；demo rollback只接受再次執行同一exact local reset-and-rebuild，不承諾恢復已刪測試資料；沒有執行contract migration或production rollback。
- `npm run test:e2e:study-stream-v2`：7/7 passed（包括修正認字卡答案區水平置中後的回歸）；
- `npm run test:e2e:admin-roster`：4/4 passed（shell／atomic import、六年級升級及明確留級／離校 disposition、停權／恢復、V1/V2 cleanup、responsive／locale／theme／keyboard／axe）；測試前以標準 seed 建立 immediate-successor fixture，測試後再按授權重建 demo資料；
- 本次修正補上管理員班級「查看學生」UI，新增 class-filtered student query、搜尋及 cursor pagination；`npx tsc --noEmit`、`npm run lint`、`npm test`（188 tests）及 `npm run build` 通過；對應 admin browser assertion 已加入 `tests/e2e/role-redirects.spec.ts`，尚未在本輪以登入瀏覽器執行；
- production config check 以 synthetic local keyring／Upstash values 通過。未以本機缺少的 production secrets 代替正式部署驗證。

仍需補／明確 deferred：

- 完整 desktop/mobile／200% zoom／keyboard／native VoiceOver／TalkBack QA、production deploy、真實學生資料、contract migration 及 destructive production cleanup不在本輪範圍。
