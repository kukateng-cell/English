# 教師工作台：學生名冊、進度及班級洞察重設計計劃

> 狀態：已完成（local implementation／verification；production、full-scale及native device gates deferred）
>
> 建立日期：2026-08-16
>
> 定稿日期：2026-08-16
>
> 版本：Revision 3
>
> 目標分支：`codex/class-roster-import-and-access-control`
>
> 實作授權：local implementation、fresh development reset／reseed及forward migrations已完成；不包括 production deploy 或 destructive contract cleanup
>
> 相關計劃：`class-roster-import-and-access-control.md`、`ui-design-system-migration.md`

## 1. 執行摘要

現有教師工作台把「學生名冊」及「學習進度」塞在同一個 `/teacher/students` 頁面，只有一個沒有搜尋、
篩選或分頁的學生清單。畫面雖取得部分學生資料，但沒有顯示真名以外的暱稱、年級及班別；重設密碼入口則藏在
每個學生卡片的展開區。教師首頁的「班級概覽」亦只有全部獲授權學生的總數，不能按班比較。

本計劃會把教師工作台分成三項清楚工作：

1. **班級概覽**：按年級／班別比較學生人數、活躍度及學習進度；
2. **學生名冊**：搜尋及篩選學生，查看校務身份、年級、班別及可用操作；
3. **學生進度**：集中查看學習指標，並可進入同一個學生詳情頁。

重設密碼權限確定由「每班一個 reset 開關」改為「每位教師一個總開關」。有效權限仍然必須同時符合：

- 教師帳號及 profile 有效；
- 管理員已開啟該教師的重設密碼能力；
- 目標學生屬於該教師獲授權查看的 CURRENT 班級；
- 目標學生及班級仍然有效。

所以教師只需一個清楚的能力開關，但不會因此取得其他班學生的資料或重設權限。新欄預設關閉，
不會把任何舊逐班 reset 設定自動提升成全局權限；必須由管理員明確開啟並留下 audit。

## 2. 現況核對

### 2.1 已存在而可沿用的部分

- `StudentProfile` 已有 `legalName`、`nickname`；CURRENT enrollment 已有 `grade`、`classId`／`classCode`。
- `TeacherClassAccess` 已可限制教師只查看獲授權班級，沒有 access 時會返回空名單。
- 舊 `/api/teacher/students` DTO 已被 canonical roster／progress query 取代；legacy handler 在 route inventory 確認 zero caller 後移除。
- `/api/teacher/students/[id]/reset-password` 已有 object-level scope、recent-auth、CSRF、一次性臨時密碼、
  credential revision、session revoke 及 audit 基礎。
- 管理員已有 selected-year teacher access GET／PUT、`accessRevision` CAS 及 CURRENT／PLANNED year isolation。
- 共用 workspace shell、EMM Style 02 icon system、雙 locale、雙 theme 及 desktop sticky account rail 可沿用。

### 2.2 現有不足

| 範圍 | 現況 | 問題 |
|---|---|---|
| 教師導覽 | 只有「概覽／學生進度」 | 名冊與進度概念混合 |
| 教師學生頁 | 一次載入全部授權學生 | 無 server search、filters、pagination；大量學生難以使用 |
| 學生資料 | API 有部分資料，UI 只顯示姓名／帳號／進度 | 看不到暱稱、年級及班別 |
| 學生詳情 | 卡片原地展開 level progress | 沒有可分享／返回的獨立詳情頁，身份與進度不完整 |
| 密碼重設 | 按鈕藏在進度卡展開區；capability 逐班設定 | 即使獲授權亦難以發現；管理設定過細及容易不一致 |
| 班級概覽 | 全部授權學生合計 | 無逐班比較，不能判斷哪班較活躍或需要跟進 |
| 管理員授權 | 所有班別平鋪；逐班 view／reset 兩個 checkbox | 班多時視覺混亂，沒有 grade／搜尋／已選 filters |

### 2.3 規模判定

現行產品固定六個年級，每級最多 A–H 八班，所以同一學年最多 48 個 canonical 班級，不是無上限的數百班。
不過 48 班平鋪仍然難以管理；而一位教師可有數百名學生，因此班級篩選、學生搜尋及 server pagination 仍屬必要。

## 3. 目標及成功準則

### 3.1 目標

- 教師可從導覽直接進入獨立學生名冊，不再要由「學生進度」尋找學生。
- 教師可按獲授權的年級、班別搜尋學生，並處理數百名學生而不一次載入全部資料。
- 教師可進入學生詳情，清楚查看真名、暱稱、學生證帳號、年級、班別及學習摘要。
- 教師進度頁集中呈現進度，不與名冊管理資訊混成同一張卡。
- 班級概覽提供定義一致、可比較、可點入預篩選名冊／進度的逐班指標。
- 管理員用一個教師級別的 reset 開關，配合班級 access 決定最終可重設範圍。
- 管理員可以按年級／班別搜尋及批量選取教師可查看的班級。
- 所有 filter、detail 及 reset 仍由 server authoritative scope 限制，不能靠修改 URL／query 越權。

### 3.2 成功準則

- 一位獲授權多班的教師可在最多三次操作內選定年級／班別並找到指定學生。
- 搜尋 accountName、legalName 或 nickname 都能返回同一授權範圍內的結果。
- 任何 query parameter 都只能縮窄教師獲授權範圍，不能擴大。
- 全局 reset 關閉時，教師所有畫面都不顯示 reset action，API 亦拒絕；開啟後，只對任教班學生顯示及成功。
- Dashboard 每個班的統計都只使用該班 CURRENT、ACTIVE enrollment，零學生／零學習紀錄不會除零或錯報。
- 48 班的管理員 editor 可按 grade、搜尋、只看已選及批量選取目前結果，不需逐頁尋找。
- desktop、mobile、繁／簡、light／dark、keyboard focus 及 screen-reader labels 均可用。

## 4. 非目標

- 本期不讓教師修改學生真名、暱稱、年級、班別、帳號狀態或學生證帳號；這些仍由管理員管理。
- 本期不讓教師匯入、匯出、停權、刪除或升級學生。
- 本期不新增科目、任教科、班主任或 lesson timetable 模型；class access 暫時代表教師可查看的任教範圍。
- 本期不建立教師之間的排行榜，亦不以單一分數把班級標記為「好／差」。
- 本期不改 Retrieval-first V2、Review／ReviewEvent、mastery、排行榜或單元解鎖語義。
- 本期不執行 production deploy、真實學生 pilot 或完整原生 VoiceOver／TalkBack 矩陣。

## 5. 已凍結資訊架構

### 5.1 教師導覽

| 導覽項目 | Canonical route | 用途 |
|---|---|---|
| 班級概覽 | `/teacher` | 逐班比較及快捷入口 |
| 學生名冊 | `/teacher/roster` | 身份、班級、搜尋、篩選及可用操作 |
| 學生進度 | `/teacher/progress` | 學習指標列表及進度篩選 |
| 學生詳情 | `/teacher/students/[id]` | 名冊資料與學習摘要的共用詳情頁，不放主導覽 |

現有 `/teacher/students` 保留為頁面 redirect，導向 `/teacher/progress`；舊 bookmark 仍可使用，但舊全量 API handler 已移除。
導覽 active-state 必須只高亮最精確匹配項，學生詳情可根據來源保留「返回名冊／返回進度」context。

### 5.2 學生名冊

名冊預設顯示教師所有 CURRENT 授權班級的 ACTIVE 學生，提供：

- 搜尋：學生證帳號、真名、暱稱；輸入 debounce 後由 server 查詢；
- filters：年級、班別；班別選項只來自教師獲授權範圍；
- filter chips／清除全部；URL只保存非PII的grade／class filter，搜尋文字及cursor只留在component memory，
  不寫browser history、localStorage、sessionStorage或referrer；
- desktop table、mobile cards；每頁 50 人，server cursor pagination，上限 100；
- 欄位：學生證、真名、暱稱、年級、班別、最近學習時間、可用操作；
- row 點擊進入學生詳情；reset action 只在有效 capability 下顯示，並有明確文字，不藏在折疊區；
- 無班級、無學生、無搜尋結果、權限剛被撤回及載入失敗各有不同 empty／error state。

穩定排序固定為不可修改的 `accountNameCanonical → id` keyset；grade／class／legalName只用作顯示或filter，不作cursor排序。
Opaque signed cursor包含filter fingerprint、`TeacherProfile.accessRevision`、`RosterMutationState.revision`、CURRENT year revision及
最後排序鍵。任何scope／roster mutation後舊cursor返回409 `TEACHER_QUERY_STALE`，UI由第一頁重新載入；malformed cursor返回
422 `CURSOR_INVALID`。靜態資料必須無重複／漏頁；並發資料不承諾舊snapshot續讀，但每頁都重新套scope並永不洩露撤權學生。
搜尋 normalization按欄位凍結，不能用一個全局normalize取代既有identity contract：`accountName`用NFKC＋trim＋lowercase後查
`accountNameCanonical`；`legalName`用NFC＋trim＋collapse spaces（保留原大小寫／文字，不做locale轉換）查canonical-equivalent
display value；`nickname` display用NFKC＋trim＋collapse spaces，另以既有`nicknameNormalized`（NFKC＋case-fold＋移除有限分隔符）
作搜尋索引。Query body先按對應欄位normalize，request body及response只用allowlist；application／proxy logs不得記錄raw search value。

`RosterMutationState.revision`的application writer contract明確涵蓋所有會影響名冊membership、filter或search結果的欄位：
User role／status、StudentProfile legalName／nickname、TeacherProfile legalName／global capability、student enrollment grade／class／status、
class active、teacher class access及academic-year activation。學生nickname API、admin manual profile edit及student／teacher import都必須先按
全域鎖序lock roster state、在同tx更新profile revision並令roster revision單調改變；現有statement triggers可以在同一batch
增加多次，contract只要求所有舊cursor必定stale，唔要求精確+1。AccountName已凍結不可修改。
Raw out-of-band profile SQL不屬支援writer；任何擁有DB權限的trusted operator直接改profile／access row都可以改變authorization，故不能聲稱SQL層「不能擴權」。DB access control、操作審計及受保護環境管理另行負責；conformance inventory只能偵測application writer／projection drift並令server或rollout gate fail closed，不能阻止有權限的直接SQL。支援的application route仍必須繞過canonical service即拒絕。
測試要覆蓋nickname、admin legalName及import更新後舊cursor 409，唔可以只測轉班／撤權。

### 5.3 學生進度

進度頁與名冊共用年級／班別／學生搜尋 filters，但表格集中顯示：

- 掌握詞數／總詞數及百分比；
- 各 level 摘要；
- 有效客觀評測數量；
- 最近學習時間；
- 到期複習摘要；
- 點入學生詳情。

進度頁不重複顯示管理性操作列；reset 主要放在名冊及學生詳情。所有指標使用第5.5節同一個server aggregation service，
不能另造client計算或把self-rating當成mastery。

### 5.4 學生詳情

詳情頁分成兩個清楚區塊：

1. **學生資料**：真名、暱稱、學生證帳號、CURRENT 年級及班別；
2. **學習摘要**：整體 mastery、各 level、總有效評測／複習、最近學習、到期摘要。

頁首顯示學生所屬班別及返回來源。若教師有 global reset capability，頁首 action 顯示「重設學生密碼」；
若沒有 capability，整個 action 不渲染。權限在頁面開啟後被撤回時，下一次 fetch／mutation fail closed，並返回授權名冊。

### 5.5 學習指標 canonical 定義及班級概覽

Dashboard 改為按授權班級顯示，而不是只有所有學生合計。每班使用同一組定義：

- ACTIVE 學生數；
- 今日活躍／近 7 日有學習紀錄人數；
- 班級平均 mastery 百分比；
- 已掌握詞彙總量；
- 到期複習學生數；
- 7 日沒有學習紀錄人數。

頁面提供 grade filter、班級排序，以及「開啟名冊／查看進度」快捷入口並帶入 class filter。指標應顯示分子／分母或
清楚百分比，避免以裝飾性柱狀圖掩蓋小數值。沒有資料時顯示 `0`／`—` 的既定語義，不把零活動解讀成學習表現差。

同一個`teacher-learning-aggregates` server service必須供progress list、student detail及class summary使用，口徑固定如下：

| 指標 | Canonical 定義 |
|---|---|
| Membership | 該學生有CURRENT year、ACTIVE enrollment、active class，且教師有該class view access；每生只計一次 |
| 今日活躍 | `StudyDay`在Asia/Shanghai當地今日有已確認活動；V2 confirmed `StudyEncounter`／eligible objective response必須已按既有contract寫入同日StudyDay |
| 近7日活躍 | Asia/Shanghai今日及之前6個完整本地日內至少一個canonical StudyDay；按學生distinct |
| 最近學習 | `max(StudyEncounter.acknowledgedAt, eligible ReviewEvent.createdAt)`；V1以non-historical REVIEW event覆蓋；lease、reveal未確認、research-only及historical rows不計 |
| 有效客觀評測 | 只計 provenance-complete 的 operational first response：`ReviewEvent.eventKind=REVIEW`、`isHistorical=false`、`evidenceKind=OBJECTIVE_PROBE`、`flowVersion=v2`、`probePurpose` 屬批准的 operational allowlist（目前 `DUE_REVIEW`／`EVIDENCE_OBLIGATION`，排除 `OPERATIONAL_DIAGNOSTIC` 及 `RESEARCH_DIAGNOSTIC`）、`qualityPolicyVersion`／`itemConstructionVersion`非空、`objectiveEvidenceTargetId`／`objectiveQuestionSnapshotId`非空，且該target的`winningReviewEventId`等於此row id；V1／legacy event 絕不冒充客觀評測 |
| 有效評測／複習事件 | 另以 `effectiveReviewEventCount` 表示非歷史、已接受的 `REVIEW` event；V1 writer／bridge 必須明確寫 `flowVersion=v1`、`evidenceKind=LEGACY_UNKNOWN`。expand window內如仍遇到舊 null row，只按 `COALESCE(flowVersion,'v1')`／`COALESCE(evidenceKind,'LEGACY_UNKNOWN')`作兼容讀取，並由 conformance report 追蹤；新 writer 不得再產生 null |
| 已掌握詞 | canonical `Review.interval >= MASTERED_MIN_INTERVAL`；self-rating不直接改變此值 |
| 學生mastery | `mastered canonical Reviews / current Word table全部catalog rows`；分母不按學生unlocked內容改變，亦不包括已刪Word snapshot；totalWords=0顯示0/0及`—`百分比 |
| 班級平均mastery | 先計每名member學生mastery百分比，再作unweighted mean；零學生顯示`—`，不冒充0% |
| 已掌握詞彙總量 | 班內每名member的mastered數相加；必須與學生detail加總一致 |
| 到期複習學生 | 在request `asOf`時至少一個`Review.nextReviewDate <= asOf`的member學生；顯示學生數，不顯示Review row數 |
| 7日無學習 | member在同一7日本地日曆窗口沒有任何`StudyDay`；即`studentCount - activeSevenDayCount`，顯示學生數 |

`asOf`及Asia/Shanghai日界由server一次解析並回傳`generatedAt`／window boundaries；同一response所有班共用同一時間點。
若現有StudyDay未完整承接V2 confirmed activity，Phase 2先修正canonical StudyDay writer／backfill-free future semantics及相鄰測試，
不得在dashboard另建第三套activity定義。歷史缺口顯示為資料缺口，不製造推算紀錄。

## 6. 權限模型修訂

### 6.1 Canonical 模型

- `TeacherClassAccess` row：代表教師可查看該班的學生身份與進度；現有 `canViewProgress=true` 在 expand window 保留。
- `TeacherProfile.canResetStudentPassword`：新增教師級別 Boolean，default `false`。
- `TeacherClassAccess.canResetStudentPassword`：變成 legacy physical column；新 UI／新授權判定不再逐班使用。

教師重設某學生密碼的有效 predicate：

```text
teacher.role = TEACHER
AND teacher.status = ACTIVE
AND TeacherProfile exists
AND TeacherProfile.canResetStudentPassword = true
AND student.role = STUDENT
AND student.status = ACTIVE
AND student has ACTIVE enrollment in CURRENT active class
AND matching TeacherClassAccess.canViewProgress = true
```

這代表 global capability 只決定「可否執行 reset」，class access 仍決定「可以對哪些學生執行」。管理員不需逐班開 reset，
亦不會出現某班看得到但因漏勾第二個 checkbox 而找不到 reset action 的情況。

### 6.2 Migration／compatibility

- 普通 forward migration 新增 `TeacherProfile.canResetStudentPassword Boolean DEFAULT false`，不修改既有 migration。
- Migration絕不把舊per-class `true`自動提升為global `true`；所有教師初始global能力一律false。管理員在新editor或
  v2 import明確開啟後才生效，並寫security audit。Seed／測試fixtures直接建立明確on／off狀態。
- `TeacherProfile.accessRevision`同時涵蓋所有year class-access set及global reset capability；任何一者改動都在同一transaction
  conditional increment，並increment `RosterMutationState.revision`，令list cursor及activation preview stale。
- Local cutover在新欄加入後、啟動新runtime前先輸出只含count／teacher pseudonym的legacy-true審閱報告，再鎖
  `RosterMutationState`把所有CURRENT／PLANNED legacy flags原子清為false以匹配global default；conformance為零差異先可啟動。
  呢一步會安全暫停現有教師reset，之後只由管理員逐位明確opt-in。
- Expand compatibility window保留legacy `TeacherClassAccess.canResetStudentPassword`，但禁止stale值：新writer建立／替換
  CURRENT或PLANNED view row時，把legacy flag投影成當時global Boolean；global toggle亦在同一transaction把該教師所有
  CURRENT／PLANNED view rows同步成相同值。CLOSED rows維持歷史只讀，runtime永不以它們授權CURRENT reset。
- Shared rollout不得讓會寫per-class mixed flags的舊binary與新writer同時運作；本分支只做local cutover。Conformance query要求
  所有CURRENT／PLANNED view rows的legacy flag等於global field，否則部署／rollback gate fail closed。
- Rollback舊binary前先停止新writer、鎖`RosterMutationState`、原子reconcile所有CURRENT／PLANNED legacy flags＝global、
  再以conformance query確認零差異。若reconcile失敗，必須原子把global及全部非CLOSED legacy flags設false，暫停教師reset，
  不可以帶stale flags回退。舊binary期間如曾改per-class reset，roll-forward一律把受影響教師global設false及清除非CLOSED
  legacy flags，要求管理員重新明確開啟，不由mixed flags推斷global true。
- 待新版本穩定及另行批准 contract migration，才刪除 legacy column；本計劃不自動執行 destructive contract migration。

### 6.3 Teacher import／export v2

Teacher template及staged payload新增明確contract version。Canonical v2 headers固定為：

```text
templateVersion,accountName,legalName,contactEmail,classAccess,resetPasswordCapability
```

- 每行`templateVersion`必須為`teacher-roster-v2`；`classAccess`繼續使用stable `GRADE:CLASS|...`集合。
- `classAccess` CREATE：blank或`__CLEAR__`＝無view access；replacement list＝所選year exact set。MERGE：blank＝preserve
  selected-year set；`__CLEAR__`＝exact empty；replacement list＝selected-year exact replacement。Class access任何變更都不會暗中改global能力；
  legacy reset projection只按authoritative global Boolean同步新view rows。
- `resetPasswordCapability`只接受case-insensitive `TRUE`／`FALSE`或blank；拒絕`1/0`、yes/no、class集合及`__CLEAR__`。
  CREATE：blank＝false；TRUE／FALSE按值建立。MERGE：blank＝preserve；TRUE／FALSE明確改global field。
- Export同樣輸出`templateVersion=teacher-roster-v2`、`classAccess`及`resetPasswordCapability`的uppercase TRUE／FALSE typed string，
  不再把global Boolean叫做`resetPasswordAccess`，確保CSV／XLSX round-trip無歧義。
- v1由完整header set判定：沒有`templateVersion`且使用`resetPasswordAccess`屬v1。V1 `classAccess`的blank／clear／replacement
  採上一點同一selected-year view語義；CREATE的global固定false，MERGE的global永遠preserve。任何非blank
  `resetPasswordAccess`整row返回`V1_RESET_SCOPE_REQUIRES_V2`，包括舊`__CLEAR__`／subset list；舊pair matrix不得用來改global。
  Preview明確顯示「class scope會變、global capability保持」及提供v2 template連結。
- Preview逐row顯示global capability before／after及warning。若selected year為PLANNED而existing teacher的global值會改變，
  preview另顯示會立即影響的CURRENT classCount／studentCount；commit payload必須帶
  `acknowledgeImmediateGlobalCapabilityChange=true`，fingerprint包含該ack，否則422。
- `RosterImportBatch`／staged teacher row帶`contractVersion=teacher-access-v2`及global capability snapshot；preview後任何
  global／access revision改動令commit 409。Cutover時所有仍PREVIEWED的v1 teacher batches先actor-safe system-cancel並physical purge；
  舊commit固定返回`BATCH_CONTRACT_STALE`，不嘗試轉譯已staged payload。

### 6.4 Activation coverage

Activation的view coverage維持「ACTIVE teacher + target class view row」。Reset coverage改為：

```text
teacher User ACTIVE
AND TeacherProfile exists
AND TeacherProfile.canResetStudentPassword = true
AND target class TeacherClassAccess.canViewProgress = true
```

Preview及commit的teacher snapshot／coverage fingerprint必須包含User status＋revision、global Boolean、
`TeacherProfile.accessRevision`及target class view rows。Global editor、import及任何writer改變global capability時必須increment
`accessRevision`及`RosterMutationState.revision`；preview後toggle一律令commit返回409 `ACTIVATION_PREVIEW_STALE`並重新preview。
Cutover時未commit的舊YEAR_ACTIVATION batch一律system-cancel＋purge；新batch帶`contractVersion=year-activation-reset-v2`。

### 6.5 安全、私隱及 reset workflow

- roster、progress、class summary、student detail 及 reset 必須共用 canonical server scope helper。
- 未授權或不存在的 student detail 統一404；reset 必須先提供與 actor/session/target 綁定的 precondition，缺失、錯誤 target 或
  wrong-session token 固定422 `RESET_PRECONDITION_INVALID`，不作任何 credential write；合法 precondition 但 transaction 內權限已撤回
  仍固定404。list／aggregate 只返回空資料，不 fallback 全校。
- reset transaction 內重驗教師 global capability、class access、學生 CURRENT enrollment 及 status；並發 CAS 語義必須凍結：
  server 在 bcrypt 前從同一個授權 snapshot 取得 `tokenVersion`／`credentialRevision`，以短期 opaque `resetPrecondition` 綁定
  target id、actor id、session、snapshot revision及expected credential revisions。為免HMAC可解碼payload洩露revision，token
  必須使用 server-owned AES-256-GCM AEAD（`v1.<keyId>.<nonce>.<ciphertext>.<tag>`，AAD為固定
  `teacher-reset-precondition:v1`），TTL固定5分鐘；key由專用環境secret經HKDF domain separation導出，current及仍在TTL內的
  previous key可按stable keyId驗證，missing／invalid key或rotation設定不完整一律fail closed。Roster／detail只有在effective reset為
  true時回傳此token；POST body必須帶token，server解密並保留同一組expected revisions，transaction不得重新採用較新的revision。
  `replacePasswordCredential`以該組expected values做conditional CAS，故同一precondition的double-click／並發request最多一個
  成功，另一個固定返回`RESET_CREDENTIAL_STALE`；missing、tampered、expired、wrong-session或wrong-target返回
  `RESET_PRECONDITION_INVALID`。合法token但credential revision已改變亦固定409；權限、status、class scope仍須在transaction內
  再次fail closed。Token、plaintext及key不得寫log／storage。
- Reset route新增專用shared-backend limiter，production backend unavailable時503 fail closed；預設window固定為teacher 20次／15分鐘、
  session 10次／15分鐘、HMAC-IP 60次／15分鐘，以及獲授權target 3次／1小時。Teacher／session／IP limiter在bcrypt及target
  mutation前consume；target limiter只在server確認授權target後consume。超限返回429 `TEACHER_RESET_RATE_LIMITED`及`Retry-After`。
- AEAD keyring配置固定為`TEACHER_RESET_PRECONDITION_KEY_CURRENT`（必填）、`TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID`（必填）及可選
  `TEACHER_RESET_PRECONDITION_KEY_PREVIOUS`／`TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID`；兩把material均為至少32 bytes entropy的
  base64url secret，兩個stable ID必須符合token-safe格式且不可相同。token攜帶與material綁定的stable ID（不是`current`／`previous`
  位置名），previous在rotation後至少保留5分鐘；因此輪替前由current簽發的token可在輪替後由previous按舊ID解密，超過TTL才拒絕。專用key經HKDF domain separation導出，任何production／local reset-capable
  runtime的keyring-specific validation缺current、格式錯誤、rotation不完整或AEAD解密設定失效，任何需要簽發precondition的
  roster／detail response及
  reset POST固定503 `RESET_PRECONDITION_UNAVAILABLE`並fail closed，不把真實capability靜默改為false；純read-only的classes／progress／
  class-summary不簽發precondition，keyring故障時仍可讀。完整production config checker只係production deployment gate，本機缺
  production-only secrets的預期negative result不影響已通過keyring-specific validation的local reset runtime。Rotation-overlap tests
  必須涵蓋current、previous、輪替前current→輪替後previous、expired previous、missing-key及duplicate ID。
- UI先顯示帶真名、學生證及「舊密碼／session立即失效」文案的確認dialog；pending期間disable同一target action。
  Server仍以expected token／credential revisions作CAS，兩個並發request最多一個commit，另一個409。401
  `RECENT_AUTH_REQUIRED`開啟既有reauth modal，target只留在component memory；reauth成功後要先重新取得與session綁定的最新
  `resetPrecondition`，最多自動送出一次原本尚未執行的request；若precondition在停留／reauth期間過期，422
  `RESET_PRECONDITION_INVALID`只可觸發重新fetch並重新顯示確認，不能靜默重做mutation。不把target／password/token放URL、storage
  或log。404／409／422／429／503各有可理解錯誤，唔會重試bcrypt storm。
- Reset繼續要求same-origin／CSRF、一次性temporary password、`mustChangePassword=true`、`tokenVersion+1`、
  `credentialRevision+1`及全session revoke；成功response只顯示一次並`private, no-store`。
- 新增`PASSWORD_RESET_BY_TEACHER` SecurityEventType，actor／subject用既有FK＋HMAC
  pseudonym contract，不寫明文密碼。停止寫`studentTemporaryCredential:<accountName>` DatabaseMetadata PII marker；credential
  revision及SecurityEvent已提供所需證據。Cutover以guarded local cleanup清除舊marker；在cleanup前hard delete按exact account key
  同tx刪除marker，並有PII orphan negative test。
- legalName、accountName只可出現在已授權 teacher roster／progress／detail，以及管理員名冊／匯入／匯出 surface；排行榜等公開
  student surface仍只用 nickname。
- 教師 status、class access或 global capability 變動後立即 fail closed；不能只靠 hidden button。
- 所有teacher PII list／progress／detail／class response使用`Cache-Control: private, no-store`、`Vary: Cookie`、
  `X-Content-Type-Options: nosniff`；teacher workspace設`Referrer-Policy: no-referrer`。自由文字搜尋只經same-origin POST body傳送，
  application／proxy observability明確redact該field。測試掃URL／history／response cache及public DTO，確保無真名／學生證外洩。

## 7. API 及資料 contract

### 7.1 Canonical routes及角色視角

```text
GET  /api/teacher/classes
POST /api/teacher/class-summary/query
POST /api/teacher/roster/query
POST /api/teacher/progress/query
GET  /api/teacher/students/[id]
POST /api/teacher/students/[id]/reset-password

POST /api/admin/roster/teachers/query
GET  /api/admin/roster/teachers/[id]/access-settings?academicYearId=...
PUT  /api/admin/roster/teachers/[id]/access-settings
```

自由文字搜尋放POST body，避免真名／學生證進browser history及普通GET access log；這三個read-only POST仍要same-origin／CSRF、
body cap及`no-store`，而且不得有副作用。`POST /api/admin/roster/teachers/query`同樣以body傳教師姓名／帳號搜尋，取代目前
只載前100名再由client filter的做法。

保留現有ADMIN進入teacher workspace能力，但必須有常駐「管理員全校視角」banner及response `viewMode`：

- TEACHER：只限其CURRENT active class access；
- ADMIN：只在teacher workspace顯示全校ACTIVE學生的CURRENT ACTIVE enrollment，包括未分班；沒有CURRENT enrollment的帳號
  留在admin roster處理。Class summary只按真實active classes，未分班另顯示count，不偽裝成班級；
- ADMIN未分班row的`classId`／`classCode`固定為null，仍可看progress／detail並按admin authority reset；不進任何class-summary item，
  只計入`unassignedStudentCount`。TEACHER永遠不會透過class scope取得未分班row。
- ADMIN reset沿用admin authority，不受TeacherProfile global switch限制；UI／DTO不得無提示由數班變成全校。

舊`GET /api/teacher/students`及`GET /api/teacher/stats`已在新UI／tests轉移、route inventory確認零caller後移除，避免保留無分頁全量endpoint。
頁面`/teacher/students`仍保留server redirect至`/teacher/progress`，照顧使用者bookmark。

### 7.2 Query input、cursor及固定錯誤

Roster／progress共同JSON body：

```json
{
  "grade": "JUNIOR_1",
  "classId": "optional-authorized-class-id",
  "search": "optional accountName/legalName/nickname",
  "cursor": "optional opaque cursor",
  "limit": 50
}
```

Server自行解析唯一CURRENT year，body不接受academicYearId，避免client對PLANNED／CLOSED有兩種解讀。`grade`只接受六個enum；
`classId`最多128 chars且必須屬server allowed set；trimmed `search`為1–80 graphemes，blank canonicalize為無搜尋；`limit`
default 50、範圍1–100；cursor最多2,048 chars；整個JSON body上限16 KiB。Server先建立authorized CURRENT class set，
再套filters。未授權classId與不存在class統一404 `CLASS_NOT_FOUND`，不能用validation差異enumerate。

Admin teacher query body固定為`{search?,status?,cursor?,limit?}`：search同樣1–80 graphemes、status只接受ACTIVE／SUSPENDED、
limit default 50／max100、cursor及body caps同上。排序為immutable `accountNameCanonical → id`，signed cursor綁filter fingerprint及
`RosterMutationState.revision`；stale返回409。Response固定為
`{items:[{id,accountName,legalName,status,accessRevision,canResetStudentPassword}],nextCursor,rosterRevision,generatedAt}`，
不回contactEmail、class sets或其他PII。Route要求ADMIN、same-origin／CSRF、`private, no-store`及search log redaction。

所有成功及錯誤response都係JSON；錯誤envelope固定為`{code}`，只有429可另加integer `retryAfterSeconds`並同步
`Retry-After` header。Client只按code本地化，不顯示server raw message。Reset credential CAS衝突專用409
`RESET_CREDENTIAL_STALE`，與query／access／activation stale分開；validation不回傳raw input值。

固定錯誤：401 `AUTH_REQUIRED`／`RECENT_AUTH_REQUIRED`、403 `ROLE_FORBIDDEN`／`CSRF_ORIGIN_INVALID`、404
`CLASS_NOT_FOUND`／`STUDENT_NOT_FOUND`、409 `TEACHER_QUERY_STALE`／`ACCESS_UPDATE_STALE`／
`ACTIVATION_PREVIEW_STALE`／`RESET_CREDENTIAL_STALE`／`LEGACY_RESET_SCOPE_UNSUPPORTED`、422 `QUERY_INVALID`／`CURSOR_INVALID`／
`RESET_PRECONDITION_INVALID`、429 `TEACHER_RESET_RATE_LIMITED`、500 `INTERNAL_ERROR`、503
`CURRENT_YEAR_UNAVAILABLE`／`RATE_LIMIT_BACKEND_UNAVAILABLE`／`AUDIT_BACKEND_UNAVAILABLE`／`RESET_PRECONDITION_UNAVAILABLE`。Response不回傳raw Prisma／SQL。

Reset request body固定為 `{resetPrecondition}`（JSON body上限16 KiB）；成功只回 `{ok:true,temporaryPassword}` 一次，並以
`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` 回應。`temporaryPassword`不寫入URL、storage、一般log或
audit metadata；client關閉一次性dialog後不可重新取得。

### 7.3 Response envelopes

`GET /api/teacher/classes`：

```text
{ viewMode, academicYear:{id,label,revision}, items:[{id,grade,classCode,label}],
  unassignedStudentCount, accessRevision, rosterRevision, generatedAt }
```

Teacher的`accessRevision`為profile值；ADMIN為null。Roster query：

```text
{ viewMode, scope:{academicYearId,grade,classId,accessRevision,rosterRevision},
  items:[{id,accountName,legalName,nickname,grade,classId:null|string,classCode:null|ClassCode,lastActivityAt,
  canResetStudentPassword,resetPrecondition:null|string}],
  nextCursor, generatedAt }
```

Progress query：

```text
{ viewMode, scope, items:[{id,accountName,legalName,nickname,grade,classId,classCode,
  masteredWords,totalWords,masteryPercent,effectiveObjectiveProbeCount,effectiveReviewEventCount,lastActivityAt,dueReviewCount,byLevel}],
  nextCursor, generatedAt }
```

`classId`／`classCode`對ADMIN未分班row為null。`masteryPercent`在`totalWords=0`時為null；`byLevel`每個level的分母固定為
current Word table該level row count，與全catalog mastery相同，不按unlock改變。Roster DTO不計完整level聚合，
Progress DTO不回contactEmail，避免名冊每頁掃完整詞庫或回傳無用途PII。

Class-summary query只接受optional grade，回傳：

```text
{ viewMode, academicYearId, window:{asOf,todayStart,sevenDayStart},
  items:[{classId,grade,classCode,studentCount,activeTodayCount,activeSevenDayCount,
  masteredWordCount,masteryAveragePercent,dueStudentCount,inactiveSevenDayCount,totalWords}],
  unassignedStudentCount, generatedAt }
```

所有count為non-negative integer；`masteryAveragePercent`零學生時null。DTO及service須以set-based aggregate建立，不按學生N+1。

### 7.4 Student detail DTO

DTO只包含：

- `id`、`accountName`、`legalName`、`nickname`；
- CURRENT enrollment 的 `grade`、nullable `classId`、nullable `classCode`（null只會出現在ADMIN未分班視角）；
- `canResetStudentPassword`（server effective result）及只在其為true時提供的短期 opaque `resetPrecondition`；
- mastery／review／level／last activity摘要；
- 具名`userRevision`、`profileRevision`、`enrollmentRevision`及`generatedAt`。

不存在一個可同時保證身份及學習aggregate一致的模糊`responseRevision`，所以不新增。DTO不回password fields、contactEmail
（本期無教師用途）、tokenVersion、credentialRevision、audit資料或其他班別歷史。

### 7.5 Admin capability及class-access DTO

Global reset switch在視覺及contract上獨立於year matrix，固定顯示「立即套用該教師所有目前獲授權班級；不是只限所選學年」。
Canonical read固定為單一`GET .../access-settings?academicYearId=...`，在同一DB snapshot回傳teacher identity／status、唯一
`accessRevision`、global Boolean、CURRENT有效`classCount`／`studentCount`，以及selected year、所有active classes及selected IDs。
Client不得把不同request的global／class資料拼成一個save payload；切換學年會重載整個snapshot，未完成時Save disabled。

UI只有一個Save，故canonical writer固定為單一原子`PUT .../access-settings`；global語義仍係account-level，但body把兩個panel
明確分組：

```json
{
  "accessRevision": 3,
  "globalCapabilities": {
    "canResetStudentPassword": true,
    "acknowledgeImmediateEffect": true
  },
  "classAccess": {
    "academicYearId": "...",
    "classIds": ["..."]
  }
}
```

`classAccess`可為null，明確表示只改global capability而不改任何year set；有class editor變更時必須提供完整object，不能只交diff。
Server以同一snapshot及最終class set重算global變更會影響的CURRENT class／student count；Boolean有改變但ack不是true則422。
同一Serializable transaction先鎖roster state並conditional CAS一次，然後只replacement所選year class rows、保留其他years，
更新global、按**最終**CURRENT／PLANNED view rows同步legacy projection、令`accessRevision`精確+1、令
`RosterMutationState.revision`單調改變並使所有舊cursor stale，以及寫單一summary audit。
任何validation／audit／write失敗整個rollback，絕不部分成功。CLOSED class matrix只讀：body如嘗試改CLOSED set則409，但global
capability可用`classAccess:null`獨立提交。Inactive／其他year class ID拒絕。

所有上述admin query／read／mutation routes只接受ADMIN；read不要求recent auth但全部`private, no-store`。PUT必須same-origin／CSRF、有效15分鐘
RecentAuthGrant、16 KiB body cap、shared audit backend fail closed。固定錯誤補充：401 `RECENT_AUTH_REQUIRED`、403
`ROLE_FORBIDDEN`／`CSRF_ORIGIN_INVALID`、404 `TEACHER_NOT_FOUND`／`ACADEMIC_YEAR_NOT_FOUND`／`CLASS_NOT_FOUND`、409
`ACCESS_UPDATE_STALE`／`ACADEMIC_YEAR_READ_ONLY`、422 `ACCESS_INPUT_INVALID`／`IMMEDIATE_EFFECT_ACK_REQUIRED`、503
`AUDIT_BACKEND_UNAVAILABLE`。成功envelope固定為：

```text
{ ok:true, accessRevision, canResetStudentPassword,
  selectedYear:null|{academicYearId,classIds}, currentImpact:{classCount,studentCount}, auditEventId }
```

舊 `PUT /api/admin/roster/teachers/[id]/class-access` compatibility adapter 已在新UI切換、stale old-tab regression及route inventory
zero-caller確認後移除；physical legacy column仍保留作expand compatibility projection，並不再由任何新授權路徑讀取。

Mutation測試必須覆蓋role、CSRF、recent-auth、ack invalid、teacher／year／class not found、CLOSED、stale CAS、audit failure rollback、
兩位管理員在GET後並發修改，以及同時改global＋class時`accessRevision`精確+1且roster revision單調改變／舊cursor stale。
現有legacy class-access PUT已移除；所有新UI及tests只調用canonical access-settings service。

## 8. 管理員教師權限 editor 重設計

Editor 次序：

1. 搜尋／選擇教師；
2. 獨立帳號能力區：教師級別 switch「可重設獲授權班級學生密碼」，並顯示立即影響範圍；
3. 選擇作用學年；
4. filters：年級、班別搜尋、只顯示已選；
5. 按年級分組的 class checkboxes；
6. 「全選目前篩選結果／清除目前結果」及已選數量；
7. 單一sticky save bar，分開摘要global capability變更及所選year class replacement，但只送一個atomic request；顯示未儲存
   變更、最終CURRENT impact及revision conflict，沒有部分成功狀態。

Class card只需要一個「可查看此班學生與進度」選擇，不再逐班顯示 reset checkbox。切換 grade filter不會清除其他 grade
已選項目；批量操作只影響目前 filter結果。Mobile 使用分組 cards；desktop 使用compact matrix／list，保持 keyboard selection。

教師搜尋亦應由 server pagination處理，不依賴 admin頁最初載入的100名 users，避免教師數量增加後選不到後頁教師。

## 9. 分階段實施計劃與 Checklist

### Phase 0：批准、contract及現況測試凍結

- [x] 使用者審閱初稿並接受「global reset capability + class scope」及教師只讀學生身份方向。
- [x] 兩個獨立Subagents各自完整審查相同全份計劃；Revision 2 findings及Revision 3 follow-up findings均已納入，post-fix全文重讀至兩者同一最新contract均PASS。
- [x] 在原roster計劃標示future reset target model由本計劃取代；保留現行per-class實作歷史，不冒充已完成migration。
- [x] 已獲 local implementation 授權，並於 2026-08-16 把本計劃狀態改為「進行中」；production deploy／destructive contract cleanup 仍未授權。
- [x] 建立現況 regression：無 access、view-only、view+reset、兩班不同capability、撤權後 fail closed；roster/auth/reset suites及admin browser smoke均覆蓋。
- [x] inventory所有 teacher-to-student Prisma reads，canonical classes／roster／progress／detail／reset routes均經同一scope helper。

驗收：產品決定、route table、DTO、授權 predicate、現況 regression及read inventory均已凍結並通過 local evidence；新runtime已在本分支切換，
production rollout仍另受 deployment gates 約束。

### Phase 1：教師級別 reset capability及授權 helper

- [x] 新增 forward Prisma migrations及 `TeacherProfile.canResetStudentPassword`；另以forward migration修正closed-year access history final-state predicate。
- [x] Migration全部global值default false；fresh local reset／seed沒有把舊per-class true自動提升成global。
- [x] 更新 seed／test fixtures，建立global on／off及多班教師。
- [x] 把 `authorizedStudentWhere` 拆成清楚的 view scope及 reset effective predicate，ADMIN bypass保持明確。
- [x] 完成server reset security path（AEAD precondition／keyring fail-closed、shared limiter、recent-auth、credential CAS、audit、
  503／422／409固定錯誤及route tests）；Phase 1驗收以API可安全開／關global capability為準，唔等UI完成。
- [x] 凍結並檢查`TEACHER_RESET_PRECONDITION_KEY_CURRENT(_ID)`／`_PREVIOUS(_ID)` keyring格式、32-byte entropy、stable ID不可重複、
  5分鐘rotation overlap、HKDF domain及`RESET_PRECONDITION_UNAVAILABLE` fail-closed行為；更新 `.env.example`／keyring validator及
  key rotation tests。完整`check:production-config`另作deployment gate，不得令有效local keyring runtime失效。
- [x] 建立單一snapshot access-settings GET及atomic PUT同時處理兩個panel；一次aggregate CAS，selected-year replacement保留其他year rows且任何失敗全數rollback。
- [x] 實作CURRENT／PLANNED legacy flags安全projection、global toggle dual-write、conformance及rollback／roll-forward fail-closed gate。
- [x] 執行受保護 local cutover dry-run及exact guarded fresh reset／reseed：產生legacy-true count／teacher pseudonym report、確認zero drift；沒有對 production 或 contract migration 做 destructive apply。
  incompatible PREVIEWED teacher／activation batches、把所有CURRENT／PLANNED legacy flags reconcile至global值，執行 conformance
  query並保存 zero-drift evidence；未通過前禁止啟用新runtime及legacy adapter。建議命令為新增的
  `npm run check:teacher-global-reset-cutover`，並在需要時只用既有 `npm run db:reset:roster` guarded local reset。
- [x] 建立teacher-roster-v2 template／versioned staged payload；v1 reset非blank拒絕，pending v1 batch cancel＋purge。
- [x] 更新教師import preview／commit、typed export及PLANNED immediate-current impact acknowledgement。
- [x] 更新activation global snapshot／fingerprint／batch version，global change令preview stale。
- [x] 新增typed teacher-reset audit；停止寫accountName metadata marker並清理／hard-delete舊marker。
- [x] 加 migration replay、Prisma validate、raw／service permission、dual-write、rollback／roll-forward及batch-version tests。

驗收：global off全部班不可reset；global on只可reset有class view access的學生；其他班404。

### Phase 2：教師 classes、roster、progress及detail API

- [x] 建立教師授權班級 option API，只回CURRENT active classes。
- [x] 建立POST-body server roster search／filters及accountNameCanonical→id keyset pagination。
- [x] Signed cursor綁filter、access／roster／year revisions；malformed 422、stale 409並由UI重載第一頁。
- [x] 將進度聚合移入獨立 progress service／route，避免 roster query每頁掃完整詞庫。
- [x] 建立逐班 class-summary aggregate及5.5 canonical activity／mastery／due service。
- [x] 更新V1 review writer及legacy Review bridge，所有新寫入明確帶 `flowVersion=v1`、`evidenceKind=LEGACY_UNKNOWN`；對既有
  null row保留明確兼容讀取及conformance report，不讓null writer繼續產生。
- [x] 建立student detail route，身份及進度一次取得或用明確分區DTO。
- [x] 實作固定envelopes、error codes、body caps、no-store／Vary／nosniff及log redaction。
- [x] 保留明確ADMIN全校視角banner／DTO；所有route覆蓋suspended actor／student、class deactivate、access revoke及IDOR。
- [x] 為常用條件核對／新增必要 indexes；以query plan或測量證明不做N+1。
- [x] 新UI／tests轉移後移除legacy students／stats handlers，route inventory零caller。

驗收：數百學生可分頁；filters不越權；班級及學生數據與canonical Reviews／enrollment一致。

### Phase 3：教師導覽、名冊及學生詳情 UI

- [x] WorkspaceShell加入「學生名冊／學生進度」獨立導覽及精確active state。
- [x] 建立 `/teacher/roster` desktop table及mobile cards。
- [x] 建立search debounce／AbortController、grade／class filters、非PII URL state、memory-only search／cursor及pagination。
- [x] 顯示真名、暱稱、學生證、年級、班別及最近學習；年級／班別在名冊、進度、詳情及篩選器以「初一甲」連接顯示。
- [x] 建立 `/teacher/students/[id]` 身份／學習摘要詳情及返回來源。
- [x] 使用semantic link／button，reset action放在名冊row及詳情頁清楚位置；無權限完全不渲染。
- [x] Reset確認dialog列明失效影響；client pending guard、expired precondition重新fetch／重新確認、recent-auth modal及一次重送。
- [x] 一次性密碼modal保留focus trap、明確「複製密碼」button／select affordance、live announcement及關閉後不可重讀語義；密碼採共用10位易讀小寫／數字 generator，首次登入仍強制改密碼。
- [x] `/teacher/students` compatibility redirect及舊bookmark驗證。

驗收：教師毋須進入進度卡折疊區即可找學生及使用獲授權reset；大量列表仍易搜尋。

### Phase 4：學生進度及班級概覽 UI

- [x] 建立 `/teacher/progress`，重用filters但只顯示學習指標。
- [x] 建立班級概覽filter、每班cards／table及清楚分子分母。
- [x] 班級card連到預篩選 roster／progress。
- [x] 全部aggregate加入loading、empty、error、stale access states。
- [x] 驗證StudyDay／StudyEncounter／eligible ReviewEvent writer與5.5口徑一致；不完整歷史只標資料缺口。
- [x] 不用會壓扁小數值的單一比例裝飾圖；顯示實數及一致percent scale。
- [x] 檢查文字在繁簡、窄desktop、200% zoom及mobile不截斷／錯位。

驗收：多班教師可直接比較班級活動與進度，並由班級落到學生層級。

### Phase 5：管理員教師 access editor

- [x] 教師選擇改為server search／pagination。
- [x] Global reset switch放獨立帳號能力區，說明即時套用所有獲授權CURRENT班，並顯示受影響count。
- [x] 加grade、class search、selected-only filters及選取摘要。
- [x] 加select／clear visible results，不改動被filter隱藏的已選班。
- [x] 班級按grade分組，48班desktop／mobile均可操作。
- [x] 加dirty state、sticky save、409 reload／merge提示及成功feedback。
- [x] CLOSED year只讀；CURRENT／PLANNED切換保留各自access。
- [x] PLANNED import／editor global change要求明確immediate-current acknowledgement。
- [x] 新UI切換後建立 route inventory，證明舊`class-access` GET／PUT zero caller；stale old-tab／legacy reset scope regression通過後移除 compatibility adapter route（physical legacy column仍保留）。

驗收：管理員可快速為教師分配多班及一鍵開／關reset，不會因filter切換遺失選擇。

### Phase 6：整合驗證、文件及handoff

- [x] 更新原 roster 計劃的已凍結決定、API table、測試矩陣及進度紀錄。
- [x] 更新 `plans/project-plan.md` 教師能力描述，避免再把名冊與進度寫成同一功能。
- [x] 更新本地測試帳號／seed說明，列出global reset on及off教師。
- [x] 執行必跑 unit／lint／typecheck／schema／roster suites：`npm test`、`npm run lint`、`npx tsc --noEmit`、
  `npx prisma validate`、`npx prisma generate`、`npm run test:migrations`、`npm run test:migrations:contract`、
  `npm run test:migration-checksums`、`npm run test:roster`、`npm run test:roster:invariants`、
  `npm run test:roster:lifecycle`、`npm run test:roster:auth`、`npm run test:roster:reset`、`npm run check:roster-pii`、
  `npm run test:db`、`npm run build`。
- [x] 執行需本地DB／browser的 focused suites：`npm run test:e2e:workspace`及`npm run test:e2e:admin-roster`（4 passed）；teacher
  workspace／teacher reset／canonical progress detail由同一admin roster flow及API tests覆蓋；unexpected route failure固定為
  `{code:"INTERNAL_ERROR"}`，不得洩露raw exception。
- [x] 執行`npm run check:production-config`的local negative／synthetic config檢查並記錄預期fail-closed；AEAD keyring用synthetic
  positive／negative unit tests驗證，真實production positive config gate因缺production secrets仍deferred，不作local DoD passing gate。
- [x] 把受保護 local cutover命令、legacy adapter stale測試、opaque reset precondition CAS／double-click測試及V1 null-row
  compatibility fixture列入測試證據；full-scale／performance suite只在schema／permission workflow通過後執行。
- [x] 完成 legacy adapter removal gate：route inventory zero caller、adapter GET／PUT 已移除、old-tab regression 已記錄；physical
  `TeacherClassAccess.canResetStudentPassword` 仍按另行批准的 contract migration policy 保留，不把「route移除」誤當「column已刪」。
- [x] 對desktop／mobile、雙locale、雙theme、keyboard、dynamic live regions及axe做targeted rendered QA。
- [ ] 執行48班／500名授權學生固定scale fixture及query count／response size gate。
- [x] 記錄未執行的production／native screen-reader gates，不把local smoke冒充release驗收。

驗收：local implementation、fresh replay、focused API／browser verification及限制均已寫回文件；production positive config、full-scale
performance及完整原生 screen-reader／device matrix仍保留為明確 deferred gates。

### Phase 6 實作證據（2026-08-16）

- Fresh local reset／reseed 只針對 exact allowlisted `english_dev/public`，48 個 normal migrations replay 成功；seed 建立 global reset
  on／off teacher fixtures。沒有觸碰 production，亦沒有執行 destructive contract migration。
- `npm test`（176 passed）、`npm run lint`、`npx tsc --noEmit`、`npx prisma validate`、`npx prisma generate`、migration checksum／fresh
  replay／contract regression、roster／auth／invariant／lifecycle／reset／PII／DB suites及`npm run build`均通過。
- 修正 recent-auth UX：`RECENT_AUTH_REQUIRED` 不再誤顯示為登入 session 已過期；管理員保存教師權限時會以繁體本地化提示重新輸入密碼，成功後只重試一次原本未寫入的 mutation，並保留原登入 session。
- `DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run check:teacher-global-reset-cutover` dry-run通過：
  no legacy global drift、沒有原始PII輸出；`npm run check:production-config`按預期因缺production-only Upstash／CRON／HMAC／teacher-reset
  secrets fail closed，未冒充production pass。
- Follow-up修正：教師的15分鐘近期驗證過期或尚未建立時，學生名冊／學生詳情仍可正常讀取；只有重設密碼操作暫時隱藏，頁面會提示
  教師重新驗證身份。驗證成功後會重新載入名冊並恢復獲授權學生的重設按鈕，避免把可讀資料誤報為伺服器錯誤。
- Follow-up修正：教師名冊、學生進度、學生詳情及班別篩選器的年級／班別顯示統一為「初一甲」格式，移除不必要的分隔點；帳號／姓名及統計數字的分隔符號維持原有語義。
- `npm run test:e2e:admin-roster` fresh local wrapper 4 passed，覆蓋canonical teacher roster／progress／detail、global reset off/on、
  target-bound precondition／IDOR、selected-year access replacement、rollover activation、responsive locale/theme及keyboard／axe smoke。
- 未執行：production positive secret gate、完整48班／500名教師workspace scale budget、原生 VoiceOver／TalkBack／device matrix、production
  deploy／observation；這些不是本次 local DoD。

## 10. 測試矩陣

| 範圍 | 必驗情境 |
|---|---|
| View scope | 0／1／多班、多教師同班、未分班學生、其他班IDOR、撤權TOCTOU、suspended teacher／student |
| Global reset | default false；off不顯示且API拒絕；on可操作所有授權班；未授權班404；關閉後已開頁mutation失敗 |
| Legacy safety | global true→false→legacy reader、global on後新增班、import、rollback reconcile、舊binary改動後roll-forward fail closed |
| Admin CAS | CURRENT save、PLANNED save保留CURRENT、global immediate scope、兩editor 409、CLOSED matrix只讀、inactive class拒絕 |
| Roster search | accountName NFKC＋lowercase、legalName NFC＋space canonicalization、nickname display NFKC及`nicknameNormalized` compact key；full-width account、canonical-equivalent legalName、nickname punctuation、空白、無結果、跨頁、重複姓名、前置零帳號；不承諾繁簡跨script自動轉換，locale切換不改寫已儲存PII |
| Filters／PII | grade、class、組合、URL reload；search不入URL/history/storage/log；class filter不能傳入未授權ID |
| Pagination | 0／1／50／51／200+；靜態無重複／漏頁；malformed 422；scope／roster change 409 refresh且永不洩露 |
| Student detail | 身份／enrollment／nickname／progress正確；其他班或不存在同為404 |
| Metrics | V1/V2、StudyDay、self-rating only、V2 provenance-complete operational first-response objective probe（purpose allowlist、version bundle、target winning link）、research／unapproved diagnostic／non-winning／缺version排除、V1／legacy review event（含null-row compatibility）分拆、historical/bridge排除、0 words／students、Asia/Shanghai日界、mastery分母／due |
| Class summary | 0學生、0活動、多班、同一學生唯一CURRENT enrollment、逐班合計與detail一致、unassigned admin count |
| Password lifecycle | confirm、AEAD opaque precondition missing／tampered／expired／missing-key／rotated-key、wrong-session／wrong-target、合法replay後credential revision mismatch、recent-auth expiry時名冊仍可讀並提示重新驗證、重新驗證後恢復reset action、四維limiter、double-click（同一precondition最多一個成功）、撤權race、one-time response、must-change、session revoke |
| Import／export | v2 exact headers／TRUE/FALSE／blank、typed round-trip、v1 reset拒絕、PLANNED immediate impact ack、stale batch purge |
| Activation | global+class coverage、preview後global/status/access變更409、舊batch stale、restore re-preview |
| ADMIN mode | 常駐全校視角banner、CURRENT enrollment scope、unassigned、admin reset bypass、DTO viewMode |
| Cache／deletion | 所有PII response private no-store、URL/history negative、舊credential marker cleanup、hard delete零PII orphan |
| UI／a11y | desktop／mobile、200% zoom、keyboard、semantic rows、focus return、modal trap、live results/errors、axe、雙locale／theme |
| Regression | ADMIN roster、student profile、V1 rollback、V2 learning semantics不受影響 |

驗證命令以 Phase 6 的「必跑」及「需本地DB／browser」兩組清單為唯一source of truth；本節不另列第二套命令，避免
執行者漏跑schema、roster security、PII或contract regression。只在schema／permission workflow整合完成後跑focused Playwright
teacher／admin workspace flow；不重跑與本改動無關的500-row import、5,000-row export／activation或card-motion suite。

固定scale fixture為一個CURRENT year、48班、500名教師scope內ACTIVE學生（含重複姓名、無activity、每生100個Review及混合
StudyDay／StudyEncounter／ReviewEvent）。同一production build＋local PostgreSQL先cold一次，再量4次warm run：roster/search
page median ≤1s、progress page ≤2s、48-class summary ≤2s、student detail ≤1s；各次均不得超過門檻2倍。DB round trips上限：
roster 8、progress 12、summary 12、detail 10；page response上限分別128／512／128／256 KiB；process RSS delta ≤128 MiB。
未達時先修query／index／DTO，不能以提高page limit、隱藏截斷或延長transaction掩蓋。

## 11. 風險與緩解

| 風險 | 等級 | 緩解 |
|---|---:|---|
| UI filter被當成授權邊界 | 極高 | server先算authorized class set，再套query；route及IDOR tests |
| global reset誤解為全校reset | 極高 | effective predicate固定為global capability AND class scope；UI明確文案 |
| 舊flag令rollback重新擴權 | 極高 | default false、non-CLOSED dual-write projection、conformance gate、reconcile失敗全關 |
| 舊一班reset自動升成全局 | 極高 | migration不backfill true；v1 reset row拒絕；只接受管理員明確v2/global操作 |
| aggregate跨班／重複學生 | 高 | CURRENT ACTIVE enrollment作唯一membership；DB unique及server tests |
| roster query為每學生掃詞庫 | 高 | roster／progress DTO分拆、set-based aggregate、pagination、query measurement |
| 權限編輯覆蓋其他學年 | 高 | selected-year replacement、global accessRevision CAS、cross-year tests |
| PLANNED操作即時改CURRENT能力 | 高 | global區獨立於year；preview顯示CURRENT impact並要求ack |
| per-class legacy與global新語義分叉 | 高 | single canonical helper；compatibility dual-write；mixed old writer禁止 |
| 真名／學生證出現在URL／公開頁 | 高 | POST-body search、log redaction、teacher-only DTO、no-store、history/public negative tests |
| Activity／mastery口徑分叉 | 高 | 5.5唯一server service、provenance/timezone/zero-data tests |
| Reset暴力或誤點 | 高 | confirmation、四維shared limiter、recent-auth續接、client pending＋server CAS |
| 兩個學生頁令使用者迷路 | 中 | 導覽標籤、各自目的、共用filters及student detail、返回來源 |
| 班級指標被當成教師績效 | 中 | 中性文案、顯示分子分母、不製作班級排名或「好／差」標籤 |
| 48班editor仍過長 | 中 | grade分組、search、selected-only、bulk visible selection、sticky save |

## 12. Rollout、rollback及資料處理

- 已獲 local implementation 批准並完成本分支 implementation、fresh development reset／reseed及 focused verification；production deploy、
  destructive contract migration及真實資料處理仍需另行授權。
- 先上expand schema及server compatibility，再切UI；不在同一步刪legacy per-class reset column。
- 本機資料全屬測試資料，必要時可按既有guarded reset流程重建；本功能本身不要求先做destructive reset。
- Migration不把任何legacy true升成global true；cutover前取消／purge incompatible v1 teacher／activation previews。
- Compatibility window所有CURRENT／PLANNED legacy flags由新writer同步global值。Rollback先停writer、鎖roster state、reconcile並
  通過零差異query；失敗則同tx關閉global＋legacy reset後才可回退。Roll-forward自舊binary時，任何舊期間變更都先fail-closed
  成global false並要求管理員重批，不能用mixed per-class rows推斷。
- 若新global permission出現問題，可暫時關閉所有教師global reset，保留名冊／進度read-only功能，再修正reset path。
- 不執行production deploy；任何production rollout、contract migration或真實資料處理需要另行授權。

## 13. Definition of Done

- [x] 教師工作台有獨立「學生名冊」及「學生進度」入口。
- [x] 名冊有server search、grade／class filters、cursor pagination及完整必要身份欄位。
- [x] 學生詳情顯示真名、暱稱、學生證、CURRENT年級／班別及學習摘要。
- [x] 班級概覽可按班比較一致定義的學生數、活躍及進度指標。
- [x] reset permission是教師級別global capability，但有效target永遠受class access限制。
- [x] migration／cutover時既有教師global capability default false，沒有舊per-class→global自動擴權；seed fixture或管理員明確
  opt-in可以是true，並留有audit／測試證據。
- [x] global off不顯示任何reset action；global on對所有授權班可見，其他班不可見／不可調用。
- [x] Compatibility dual-write、rollback／roll-forward conformance及fail-closed tests通過，舊flag不可重新擴權。
- [x] 管理員editor有教師搜尋、grade／class filters、selected-only及bulk visible selection。
- [x] 管理員授權使用單一snapshot GET＋單一atomic PUT；任何validation／audit／conflict failure均不得部分成功，成功只令
  `accessRevision`精確+1、roster revision單調失效cursor並寫完整summary audit。
- [x] CURRENT／PLANNED access replacement、CAS及CLOSED read-only語義保持正確。
- [x] legacy class-access adapter經route inventory證明zero caller、stale old-tab regression通過後已移除；physical legacy column刪除
  仍獨立於本計劃並需另行contract migration批准。
- [x] Teacher import／export v2、PLANNED immediate impact ack及activation global snapshot contract完整。
- [x] 所有teacher-to-student route共用server scope，IDOR／TOCTOU／suspension tests通過。
- [x] reset recent-auth、rate limit、AEAD opaque precondition（5分鐘TTL、key rotation／missing-key fail closed）／credential CAS（同一
  precondition最多一個成功）、session revoke、one-time secret及audit完整；錯誤固定回 `{code}`（包括`500 INTERNAL_ERROR`）且不
  洩露raw exception／PII。
- [x] Search PII不進URL／history／storage／普通logs；teacher DTO全部private no-store，credential marker無PII orphan。
- [x] Progress／detail／class summary共用5.5 canonical V1/V2 activity、mastery及due定義。
- [ ] Signed cursor在靜態資料完整、scope mutation stale refresh且永不越權；固定500-student scale gate通過。（scope／cursor已驗證；500-student scale deferred。）
- [x] ADMIN teacher workspace有明確全校視角及獨立DTO scope，唔會無提示bypass班級。
- [x] desktop／mobile、雙locale、雙theme、keyboard及targeted axe／rendered QA通過；完整原生 screen-reader／device matrix deferred。
- [x] 不改V1／V2學習、mastery、排行榜或單元解鎖語義。
- [x] 實際測試、未執行項目、限制及rollback寫回計劃；索引及相關計劃同步。

## 14. 已凍結決策紀錄

| 項目 | 定稿決定 | 狀態 |
|---|---|---|
| 名冊／進度 | 分成兩個主頁，共用學生詳情 | 已凍結 |
| Reset capability | 每位教師一個global總開關；target仍限獲授權班級 | 已凍結 |
| 舊權限轉換 | Global default false；舊per-class true不自動提升 | 已凍結 |
| Class access | 一個班級選擇代表可看該班學生身份及進度 | 已凍結 |
| 教師修改學生資料 | 本期不容許；只可查看及在有權限時重設密碼 | 已凍結 |
| 學年 | 教師operational pages由server只解析CURRENT | 已凍結 |
| PLANNED global改動 | 即時影響CURRENT，preview顯示範圍並要求ack | 已凍結 |
| 班級比較 | 中性canonical活動／進度指標，不做「好班／差班」排名 | 已凍結 |
| ADMIN teacher view | 保留，但常駐全校視角banner及獨立scope | 已凍結 |
| PII搜尋 | POST body；raw search不入URL／history／storage／普通log | 已凍結 |
| 歷史路由 | 頁面`/teacher/students` redirect；舊無分頁API final移除 | 已凍結 |
| Legacy reset欄 | expand期間安全projection；另行批准才contract drop | 已凍結 |
| CLOSED 學年教師權限 | 保留 `TeacherClassAccess` 作 immutable history；runtime scope只解析 CURRENT／PLANNED，final-state guard只拒絕 inactive class；新增 row 仍由 closed-year INSERT guard 拒絕 | 已凍結（2026-08-16 forward migrations） |

## 15. 兩個獨立完整 review 記錄

按使用者要求，兩個Subagents收到相同prompt，各自由頭到尾審查同一份初稿，並核對AGENTS、V2 baseline、project plan、
原roster計劃、schema、teacher/admin UI、access helper、API、import/export/activation及tests；兩者只讀且沒有分拆範圍。

### Review A：`teacher_plan_full_review_a`

結論`CHANGES_REQUIRED`：1項P0、6項P1、5項P2。P0指出global關閉後舊per-class true會在rollback重新開權；P1包括
v2 import矛盾／跨學年即時影響、缺少reset limiter＋reauth續接、統計口徑未凍結、API envelope不足、PII進URL／cache，
以及activation snapshot未納global。所有finding已納入6.2–7.5、Phase checklist、測試、風險、rollback及DoD。
其後final pass再指出admin兩個read snapshot可被錯配，以及roster revision精確+1與現有statement trigger不符；定稿改為
單一snapshot GET＋atomic PUT，並區分`accessRevision`精確+1與roster revision只須單調失效cursor。再次完整重讀後結論`PASS`。

### Review B：`teacher_plan_full_review_b`

結論`CHANGES_REQUIRED`：1項P0、9項P1、3項P2。其P0同樣指出無聲擴權及rollback stale flags；新增重點包括
ADMIN teacher view必須明定、cursor並發保證、credential metadata PII、舊staged batch version及動態a11y。Revision 2採納
default-false explicit opt-in、safe projection／fail-closed rollback、versioned batch cutover、signed stale cursor、ADMIN banner、
typed teacher reset audit、metadata cleanup及live-region驗收。
Revision 2後續修訂亦由同一reviewer完整重讀；結論`PASS`。

兩份review沒有finding被拒絕；重疊finding合併成單一canonical contract。兩位reviewer最後均完整重讀同一份normative
Revision 2 snapshot（review前SHA-256：`ce938a580ee72a14e0a3e76bd1cf79d64e50fb72046f0e51118b1f4b4cfc1c88`），
各自回覆`PASS`，P0／P1／mandatory P2均為0。該次PASS只代表Revision 2當刻；其後Revision 3修改了§1–14，故不能把這段歷史
evidence當成目前版本已驗證。

### Follow-up review：Revision 3 consistency audit（2026-08-16）

兩個subagent再次收到相同prompt並由頭到尾獨立審查已開始implementation的完整計劃，沒有分拆範圍：

- `teacher_plan_full_review_a`：發現 reset CAS precondition 未凍結（P1）、raw SQL authorization 陳述過度（P2）、驗證命令及
  implementation-status/editorial 不一致（P2）。
- `teacher_plan_full_review_b`：發現 V1／V2 effective objective metric provenance（P1）、legacy class-access adapter reset語義
  未凍結（P1）、local cutover gate／DoD atomic contract／500 error／繁簡搜尋語義及驗證命令缺口（P2／editorial）。

Revision 3 已把上述 findings 合併修正：新增 AEAD（stable key ID）reset precondition＋同一組 expected revision CAS、完整V2
provenance／winning-link objective metric與legacy review metric分離、legacy adapter fail-closed及移除gate、guarded cutover
evidence gate、完整必跑 suites、`INTERNAL_ERROR` envelope、欄位專屬搜尋 normalization、implementation 狀態及 supersession
banner同步；原先Revision 2 review record保留作歷史，不冒充本輪已驗證實作。

Final post-fix verdict：`teacher_plan_full_review_a` 及 `teacher_plan_full_review_b` 均由頭到尾重讀 Revision 3，兩者均回覆
`PASS`，P0／P1／mandatory P2均為0。A確認keyring-specific runtime validation與production deployment gate分離；B確認同一
contract一致。Final plan SHA-256會以本次commit後的檔案為準。
