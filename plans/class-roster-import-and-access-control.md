# 班級、名冊匯入及教師存取控制實施計劃

> 狀態：已完成（local verification；dependency audit job remains independent and fail-closed；production-only config positive gate 及完整原生 screen-reader/device matrix deferred）
>
> 修訂：Revision 3（Hume及Bernoulli已對相同最終contract全文PASS）
>
> 日期：2026-08-15
>
> 工作 branch：`codex/class-roster-import-and-access-control`
>
> Branch 起點：`codex/retrieval-first-learning-stream-v2` @ `68dfd51`
>
> 範圍：只限本機開發及測試；不包括 production、push、deploy 或真實學生資料

> **學號欄位相容性提示（2026-08-17）：** 本文件較早版本把 `accountName`／`studentNumber` 當作同一個登入字串，並要求保留前導零；該歷史描述已由本分支的學號／分析計劃取代。現行 canonical contract 是 `accountName`（文字，學生登入帳號）與 `StudentEnrollment.studentNumber`（可為空的正整數 1–999999）分開儲存、匯入、顯示及排序。後續實作請以 [`admin-user-directory-and-learning-analytics.md`](./admin-user-directory-and-learning-analytics.md) 為準，不要按舊段落重新合併兩個欄位。

> **2026-08-16 後續計劃提示：** 本文件準確記錄目前已實作的per-class view／reset baseline及其歷史驗證，
> 但未來教師reset target model已由
> [`teacher-workspace-roster-progress-redesign.md`](./teacher-workspace-roster-progress-redesign.md) Revision 3取代：
> class row只決定學生資料scope，reset改為default-false教師級global capability AND class scope。新模型已在本分支開始實作，
> 但尚未完成及驗證；cutover前現行runtime仍以per-class physical model為準。任何後續設計、import/export、activation coverage及rollback工作必須跟新計劃，
> 不可把本文件下列per-class reset歷史段落誤當未來canonical contract。

## 1. 執行摘要

本計劃把現有只有 `STUDENT`、`TEACHER`、`ADMIN` 角色但沒有正式班級邊界的詞彙平台，
改造成具備以下能力的本地學校帳號及名冊系統：

- 六個年級：初一、初二、初三、高一、高二、高三；
- 每級最多八個班：甲、乙、丙、丁、戊、己、庚、辛；
- 學生證號碼作登入帳號，真名與公開暱稱分離；
- 教師只可查看獲管理員授權班級的學生；
- 管理員可逐個或批量建立學生／教師、設定班級權限及執行跨頁批量轉班／升級；停權、恢復及 hard delete
  在本期屬逐個帳號操作，bulk hard delete 明確不做；
- 學生／教師名單支援 CSV、XLSX 匯入；目前名單支援可選欄位 CSV、XLSX 匯出；
- 學生可修改自己的暱稱，但 server 會阻擋粗言穢語、聯絡資料、冒充官方及不安全字元；
- 排行榜及其他學生可見位置只顯示暱稱，永不 fallback 至真名或學生證號碼。

使用者已明確確認本機所有舊資料、帳號及密碼均為測試資料，可以徹底刪除。因此本計劃不為
47 位舊學生、舊密碼或舊 session 建立資料 backfill／雙寫流程；本地 database 會以受保護 reset
重建及 seed。不過，一般 `prisma/migrations/` 仍必須採用 expand-first、可安全部署的策略，不能把
「本地資料可刪」寫成日後會自動破壞其他環境的 migration。現有物理 `email`／`name` 欄位 mapping
可以暫留，因為保留 mapping 比製作 destructive migration 更少工作；物理 rename／drop 只可留待
另一份獨立 production contract-migration 計劃。本地刪除授權不延伸至 production、其他資料庫、
Git 歷史或未明確識別的檔案。

## 2. 現況調查與判定

### 2.1 Baseline 現況

在 branch 起點 `68dfd51` 的可執行 baseline：

- 已有 `STUDENT`、`TEACHER`、`ADMIN` 三種角色；
- `User.email` 實際被當作登入帳號，而非聯絡 email；
- `User.name` 同時被當作真名、顯示名及排行榜 fallback；
- 管理員可逐個建立、修改及永久刪除帳號，但沒有停權、名冊匯入、名冊匯出或批量升級；
- 教師頁雖然使用班級文案，server 實際會讀取所有學生；
- 任意教師可重設任意學生密碼，沒有班級或 capability 邊界；
- 沒有 `AcademicYear`、`SchoolClass`、`StudentEnrollment` 或 `TeacherClassAccess`；
- seed 帳號只是固定測試 fixtures，不是管理員名冊工作流程。

本功能 branch 工作樹已有第一版候選實作，但本 Revision 3 會把它視為待核對的 implementation
candidate。後續不會因為「已有程式」便自動勾選 checklist；必須逐項符合本計劃及通過驗證。

### 2.2 需求與現況衝突矩陣

| 需求 | Baseline | 決定 |
|---|---|---|
| 真正班級 | 完全沒有 | 新增學年、班級及 enrollment canonical models |
| 教師只看指定班 | 教師可看全部學生 | 所有 teacher API 使用同一個 server-side object scope |
| 學生證登入 | `email` 欄實際是帳號 | Application contract 改為 `accountName`；物理欄名可暫用 mapping，避免 destructive migration |
| 聯絡 email | 沒有獨立欄位 | 新增 optional `contactEmail`；暫不參與登入或找回密碼 |
| 真名／暱稱私隱 | `name` 同時作公開 fallback | 拆成 `legalName` 與 `nickname`；公開 DTO nickname-only |
| 學生改暱稱 | 沒有 profile API | 新增 student-only profile page、CAS、moderation、rate limit |
| 管理員隨機密碼 | 建立帳號必須手填 | 新增共用安全 generator 及一次性 credential report |
| 批量匯入 | 只有 seed | 新增 preview → validate → atomic commit 工作流 |
| 批量轉班／升級 | 沒有 | 新增 selection、exclusions、preview、CAS、idempotency |
| 停權／恢復 | 只有 hard delete | 新增 `AccountStatus`，停權即撤銷 session |
| 教師班級權限 | 沒有 | 新增 per-class view 及 reset-password capabilities |
| 當前名單匯出 | 沒有 | 新增 allowlisted fields、filters、CSV／XLSX 及 injection 防護 |

### 2.3 現有 candidate disposition（實作前凍結）

| Candidate | 決定 | 必要處理 |
|---|---|---|
| `20260815000000_add_class_roster_identity` draft migration | `REPLACE`，只限確認未committed、未shared且只套用於可棄local DB | 受保護reset後以Revision 3 schema重新產生；如發現任何需保留／shared DB已套用，立即改為immutable並追加forward migration |
| `AcademicYear.isCurrent`／既有class schema | `REPLACE` | 改用 `PLANNED/CURRENT/CLOSED`、revision及DB invariants |
| Import內implicit current year／auto-upsert class | `REPLACE` | year必須明選；class必須預先存在，missing逐行error |
| Teacher access逐row寫入、無aggregate CAS | `CHANGE` | 改為full replacement＋`accessRevision` CAS＋transaction內再授權 |
| Teacher password reset無recent-auth／transaction recheck | `CHANGE` | 加recent-auth、exact capability、tokenVersion、audit及rate limit |
| Export無selected-year/count cap | `CHANGE` | 加year-scoped snapshot、preview count、5,000 fail-closed cap |
| Identity／nickname／temporary-password純函數及相鄰tests | `KEEP IF CONFORMING` | 逐項跑contract tests；任何與本計劃不符部分重寫，不因已有code而勾完成 |

Phase 0逐檔inventory以此表為最低集合；不可把上述六個`REPLACE/CHANGE`候選當成已完成。Draft migration只有在
Git及DB檢查證明完全local／disposable後才可重寫，否則遵守immutable migration規則。

## 3. 目標與成功準則

### 3.1 目標

1. 建立清晰、可查歷史學年的學生 enrollment 模型。
2. 建立不可混淆的 `accountName`、`contactEmail`、`legalName`、`nickname` 身份 contract。
3. 把教師權限由全校角色權限收窄為班級 object-level authorization。
4. 提供管理員可預覽、可審計、可重送的名冊匯入及批量管理流程。
5. 提供不洩露密碼或內部安全資料的 CSV／XLSX 匯出。
6. 保留 Retrieval-first V2、Review／ReviewEvent、study session、nonce、CAS、SM-2 及學習流程語義。
7. 完成本機 migration、reset、seed、unit、DB、E2E、browser QA 及操作文件。

### 3.2 成功準則

- 教師 A 無論修改 URL、studentId 或 classId，都不能取得未授權班別學生的資料。
- 學生公開畫面及排行榜 payload 沒有真名或學生證 fallback。
- 學生登入帳號（學生證）`001234` 匯入、儲存、登入及匯出後仍保留前置零；這項前置零規則不適用於獨立的數字學號。
- 同一批匯入重送不會建立重複帳號或重複 enrollment。
- 匯入任何一行 commit 失敗時，整批資料不會部分寫入。
- 停權學生或教師後，新登入失敗，舊 session 在下一次 server validation 失效；已開 V2 頁停止 retry並清除該帳號 local state。
- 全級升級可先預覽；所有人有明確`PROMOTE/REPEAT/HOLD_UNASSIGNED/GRADUATE/LEAVE` disposition；promotion只寫
  planned roster，其後以獨立transaction atomic啟用新學年；高三不可`PROMOTE`至不存在的年級。
- CSV／XLSX 匯出不包含 password hash、temporary password、tokenVersion、audit hash 等安全欄位。
- 本地資料庫可從空白狀態以 migrations + seed 重建，無需依賴舊測試資料。

## 4. 非目標

- 不實作 email 驗證、email 登入、邀請信、忘記密碼或 email 找回密碼。
- 不建立學生自行修改真名、學生證、年級或班級的能力。
- 不建立家長、校務員、級主任或跨學校 multi-tenant 角色。
- 不建立自動編班、按成績分班或 AI nickname moderation。
- 不把詞彙 `Level` A1–B2 當成學生年級。
- 不修改 Retrieval-first V2 卡片、長按揭示、Objective Probe、SM-2 或研究 telemetry。
- 不執行 production migration、production reset、push 或 deploy。

## 5. 本地資料重建策略

### 5.1 授權邊界

可以刪除：

- 本項目明確識別的 local development PostgreSQL database；
- Playwright／DB integration test 專用資料庫或 schema；
- 由本功能 seed 建立的測試帳號、班級、詞彙、Review 及相關 fixtures。

不可以因本授權而刪除：

- production、preview deployment 或任何非 localhost 資料庫；
- 其他項目資料庫；
- Git branch、commit、migration 歷史或使用者檔案；
- 未解析或只靠廣泛環境變數／glob 指向的資料目標。

### 5.2 Reset 前置檢查

執行階段必須同時滿足：

- reset script 預設只做 dry-run；必須另傳 `--execute` 才可 mutation；
- `DATABASE_ENVIRONMENT=development`；
- `CONFIRM_DATABASE_ENVIRONMENT=development`；
- migration／reset 明確使用 `MIGRATE_URL`，不可 fallback 至 `DATABASE_URL`；
- parsed client endpoint 必須完全符合 checked-in、無密碼 topology allowlist；每項明列
  `transport(TCP|UNIX_SOCKET)`、client host／socket、client port、database、schema、dbRole，以及預期的
  server-observed address／port。不能只接受模糊的「localhost」；
- script 以 read-only SQL 核對 `current_database()`、`current_schema()`、`current_user`、
  `inet_server_addr()`、`inet_server_port()`，並以所選 topology entry 比較預期結果；Docker port mapping／Unix socket
  可令 client endpoint 與 server-observed tuple 不同，兩者按 entry 分開 exact-match，不錯誤要求 URL host 等於
  `inet_server_addr()`；任何不在 allowlist 的差異仍 fail closed；
- `DatabaseMetadata.environment` 必須已是 `development`，任何 production／preview／unknown marker
  一律 fail closed；新建空白 DB 要用另一個同樣 exact-confirm 的 bootstrap 流程寫入 marker；
- `CONFIRM_LOCAL_RESET_TARGET=<database>/<schema>` 必須與打印值完全相等；
- script 在 mutation 前打印 host、port、database、schema、dbRole、marker、migration status 及帳號
  aggregate，但不得打印密碼或完整 URL；
- localhost tunnel、unknown schema、query ambiguity、runtime fallback、marker 缺失或任一 target mismatch
  均立即拒絕；批准本計劃不等於批准任何未 exact-confirm 的 target。

### 5.3 Reset 與 migration 決定

- 不使用 `prisma db push`，不修改任何已套用／共享 migration checksum。
- 一般 `prisma/migrations/` 只加入 expand-first、可安全 replay 的 schema；不得依賴 production 資料可刪。
- Application contract 使用 `accountName`、`contactEmail`、profiles 等 canonical 名稱；如現有物理欄仍叫
  `email`／`name`，可暫用 Prisma `@map` 或把不再使用的 nullable column 留在 DB。
- 本功能不執行物理 identity column rename／drop；相關 cleanup 只可放入另行批准的
  `prisma/contract-migrations/`／production migration plan，並要求 backup、old-writer retirement、
  observation 及 rollback gate。
- 本地資料可直接執行受保護 reset／fresh replay，不做 legacy fixture backfill。
- Reset 後重新 seed 一個本地管理員、可選教師／學生 fixtures、學年／班級及詞庫。
- Seed 只保存 password hash；產生的初始明文密碼只在 terminal 一次顯示，不寫入 DB、log artifact 或 Git。

### 5.4 Reset 驗收

- fresh disposable database 可完整 replay 所有 migrations；
- seed 可重複執行而不產生 duplicate；
- 新管理員可登入並強制／按 contract 修改初始密碼；
- 舊帳號、舊 session、舊 Review data 不需要存在；
- `npx prisma migrate status` 顯示 up to date。

Reset 自動化 positive tests 一律使用臨時 disposable database／test schema，不會用日常
`english_dev/public` 作自動破壞目標；日常 DB 只在實作階段以 exact-confirmed manual execution reset。

## 6. Canonical 資料模型

### 6.1 User

`User` 只保存帳號及安全狀態：

- `id`
- `accountName`：登入帳號；學生使用學生證號碼；1–64 字；trim + NFKC + lowercase canonical
  value；首尾必須英數，中間只接受英數、`.`、`_`、`-`；unique；建立後不可修改；前置零保留
- `contactEmail`：optional；最多 254 字；trim + lowercase；non-null 時 case-insensitive unique
- `passwordHash`
- `role`：`STUDENT | TEACHER | ADMIN`
- `status`：`ACTIVE | SUSPENDED`
- `suspendedAt`、`suspendedReason`（最多 200 字）
- `tokenVersion`
- `revision`：所有管理員手動 identity／status edit 的 aggregate CAS
- `credentialRevision`：每次 password hash 改變即 increment，供 credential-loss rotation 判斷
- `mustChangePassword`
- timestamps

所有password writer必須只用單一`replacePasswordCredential()` conditional-update primitive：manual／import／seed create初始化
`credentialRevision=1`；學生首次／自行change、admin reset、teacher reset及batch rotation每次都原子更新hash、
`credentialRevision+1`、`tokenVersion+1`並清除全部RecentAuthGrants；rotation另要求expected revisions。Merge import永不改密碼。
任何route直接寫`passwordHash`均由static inventory test阻擋。

Expand migration新增nullable `accountNameCanonical`／`contactEmailCanonical` companion columns；新service每次create／identity
update必須寫入canonical值，並以partial unique index（canonical非null）防止新writer互撞。因PostgreSQL UNIQUE不能
`NOT VALID`，亦因NOT VALID CHECK仍會阻擋舊writer更新不合規legacy row，expand階段不對舊物理account欄虛稱全DB normalized
uniqueness：新service在同一identity advisory lock／Serializable transaction內同時掃描legacy normalized value，raw／old writer
gap由conformance query監測。Local reset後所有row canonical非null；真正shared rollout要先preflight duplicates／backfill、retire
old writer，再以獨立contract migration設NOT NULL、validated equality CHECK及最終unique contract。Status欄是expand新欄並有安全
default，故可直接CHECK：`ACTIVE`必須`suspendedAt/reason=NULL`，`SUSPENDED`必須有`suspendedAt`。
Application 不在 `User` 保存公開顯示名、年級或教師權限。帳號建立後不直接轉換角色；需要
另一角色時建立新帳號。一般 migration 可暫時把 `accountName` map 到舊物理欄名，這不改變 application contract。

Auth.js維持stateless JWT，但每次成功登入在signed HttpOnly JWT內產生獨立128-bit random `sessionJti`。另建
`RecentAuthGrant`：HMAC(`reauth-v1`, sessionJti)作PK／unique、`userId`、snapshot `tokenVersion`／`credentialRevision`、
`reauthenticatedAt`、`expiresAt`；DB不保存raw JTI或password。Fresh Credentials login在驗證成功並建立sessionJti時，同tx建立
首個15分鐘grant；grant DB write失敗則login fail closed，所以登入後唔會即刻再問密碼。只有initial sign-in建立grant，JWT
refresh callback重跑絕不可延長15分鐘window；其後Reauth先可upsert當前session grant。兩者都唔寫User-global timestamp，
亦唔把recent-auth timestamp當成client可提交claim。敏感route要求grant屬同user／session、未過15分鐘、兩個revision仍匹配。
Logout刪當前grant；password change/reset、suspend、hard delete刪該user全部grants。Reauth password驗證另有account／HMAC-IP／
session三層limiter及security audit；兩個device只有實際reauth嗰個取得grant。

強制首次改密碼仍然要先撤銷舊 `tokenVersion`／全部舊 session；成功後 reset UI 以新密碼透明建立一個全新的
Credentials JWT／RecentAuthGrant，再返回安全的原始 `callbackUrl`。這不是保留舊 session，亦不把新密碼寫入 storage；若透明續接失敗，才顯示已更新並退回登入頁。

### 6.2 StudentProfile

- `userId`：PK／FK，只能連到 `STUDENT`
- `legalName`：1–80 graphemes，管理員可修改，學生只讀
- `nickname`：必填，學生可修改
- `nicknameNormalized`：供 moderation／audit，不要求全校唯一
- `nicknameUpdatedAt`
- `moderationPolicyVersion`：記錄最後一次 accepted nickname 使用的規則版本
- `profileRevision`：CAS
- timestamps

### 6.3 TeacherProfile

- `userId`：PK／FK，只能連到 `TEACHER`
- `legalName`：1–80 graphemes
- `profileRevision`
- `accessRevision`：整個 class-access set 的 aggregate CAS；包括空集合、新增、刪除及 replacement
- timestamps

### 6.4 AcademicYear 與 SchoolClass

- `AcademicYear`：`label`、`startsOn`、`endsOn`、`status`、`revision`
- `AcademicYearStatus`：`PLANNED | CURRENT | CLOSED`
- 同一時間只可有一個 `CURRENT` academic year
- `SchoolClass`：`academicYearId`、`grade`、`classCode`、`active`、`revision`
- `StudentGrade`：`JUNIOR_1`、`JUNIOR_2`、`JUNIOR_3`、`SENIOR_1`、`SENIOR_2`、`SENIOR_3`
- `ClassCode`：`A` 至 `H`，UI 顯示甲至辛
- unique：`academicYearId + grade + classCode`

`label` 固定 `YYYY-YYYY` 且第二年等於第一年加一；`startsOn <= endsOn`。`PLANNED` target 的
`startsOn` 必須晚於 source `endsOn`，不同 year 不可日期重疊，但可有 gap。只有 `PLANNED` year 可經普通 PATCH
修改 label／dates並increment revision；`CURRENT/CLOSED` 的 label／dates/status 全部只讀。Public transition table：

| From | To | 唯一合法途徑 |
|---|---|---|
| 無 year | `PLANNED` | Admin create API |
| 空白 fresh DB | `CURRENT` | Guarded seed/bootstrap only |
| `PLANNED` | `CURRENT` | Phase 6 activation commit only |
| `CURRENT` | `CLOSED` | 同一 activation transaction only |
| `CLOSED` | 任何 | 禁止 |

普通 `PATCH /academic-years/[id]` 不接受 status。班別不必全部建立；只有管理員明確建立的班別才存在。
Import／promotion不會靜默建立 class。Class停用只在沒有 `ACTIVE/PLANNED` enrollment及沒有teacher access時允許；
否則409，管理員要先轉班／unassign及revoke access。Activation只接受active target classes並重驗revision。
Activation target及StudentYearTransition target必須是按`startsOn,id`排序、CURRENT source之後最早的PLANNED year；
不可跳過一個較早PLANNED year。更遠future year可先建year／class，但未輪到成為immediate successor前不可建立enrollment／transition。
另建singleton `RosterMutationState(revision, calendarRevision)`作全域roster mutex及year-set revision。`revision`在任何會改變
roster／teacher coverage結果的User role/status、TeacherProfile/access、year/class/enrollment/transition writer成功時increment；
`calendarRevision`只在year chronology改變時increment。所有AcademicYear create／date PATCH／activation，以及student PLANNED
enrollment／transition writer均按6.8全域鎖序先`SELECT ... FOR UPDATE`此row，再重算完整chronology並increment相應revision。
AcademicYear insert/update另有deferred trigger重驗：不得以新增較早PLANNED year或改dates，令既有PRE_ACTIVATION
transition／planned enrollment不再指向immediate successor；incoming planned enrollment即使無transition亦受同一guard。Raw SQL及
兩個並發transaction都要fail closed；teacher access可指較遠PLANNED year，故不屬student immediate-successor限制。

### 6.5 StudentEnrollment

- `studentId`
- `academicYearId`
- `grade`：必填
- `classId`：optional，代表未分班
- `status`：`PLANNED | ACTIVE | ENDED`
- `origin`：`MANUAL | IMPORT | PROMOTION | SEED`，只記錄此enrollment如何建立，不承載下一學年決定
- `startedAt`、`endedAt`
- `revision`
- unique：`studentId + academicYearId`

`PLANNED` enrollment 是下一學年草稿，不參與現時教師授權、排行榜或 current roster；`ACTIVE` 是教師授權
唯一 truth source；`ENDED`只供歷史。Promotion不結束或改寫source `ACTIVE`；只建立／更新target `PLANNED`及下述
transition record。
Academic-year activation 才在同一 transaction 把 source `ACTIVE→ENDED`、target `PLANNED→ACTIVE`、
source year `CURRENT→CLOSED`、target year `PLANNED→CURRENT`。

另建持久、非staging的`StudentYearTransition`：`studentId`、`sourceEnrollmentId`、`sourceAcademicYearId`、
`targetAcademicYearId`、`disposition`、nullable `targetEnrollmentId`、`revision`、nullable actor＋actor pseudonym／key version、
nullable `activatedAt`、nullable immutable `activatedTargetGrade`／`activatedTargetClassCode` snapshot、timestamps；unique
`(studentId, sourceAcademicYearId, targetAcademicYearId)`，一個target enrollment最多只可連一個transition。
`RolloverDisposition`固定為`PROMOTE | REPEAT | HOLD_UNASSIGNED | GRADUATE | LEAVE`：

- `PROMOTE`：target grade必須是固定next grade，target enrollment必須存在；
- `REPEAT`：target保持source grade、`classId`必須非null且class active，target enrollment必須存在；
- `HOLD_UNASSIGNED`：target保持source grade、`classId=null`，target enrollment必須存在；
- `GRADUATE`：只供高三正常畢業，`targetEnrollmentId=null`；
- `LEAVE`：供任何年級離校（包括高三非畢業），`targetEnrollmentId=null`。

Transition lifecycle及trigger contract：

| State | `activatedAt` | Source | Target year | Nonterminal target | Terminal target |
|---|---|---|---|---|---|
| `PRE_ACTIVATION` | null | 同student、CURRENT year、ACTIVE enrollment | immediate PLANNED successor | 同student／target year的PLANNED enrollment必填 | target link及同target-year enrollment均禁止 |
| `ACTIVATED` | non-null；target grade/class snapshot已凍結 | 同student、CLOSED year、ENDED enrollment | activation後先CURRENT，日後可CLOSED | linked同student enrollment在activation後先ACTIVE，日後可合法改grade/class及再變ENDED；identity/year/status一致，rollover shape改驗snapshot | transition link及target snapshots永遠null；日後restore可另建不linked、`origin=MANUAL` enrollment |

Identity、source／target year pair、disposition及activated snapshots在`ACTIVATED`後immutable。Nonterminal與target enrollment係XOR contract：
PRE_ACTIVATION前三者必須link target，後兩者禁止target link及禁止該student存在同target year enrollment。
由terminal改回nonterminal時同一transaction建立target及更新transition；改成terminal時刪除未啟用target PLANNED enrollment並
清空link。只可修改`activatedAt=null`的transition；Activation同transaction由target PLANNED row抄寫
`activatedTargetGrade/ClassCode`並設定`activatedAt`，之後record immutable。ACTIVATED disposition shape只對immutable snapshot及
source ENDED grade驗證，不再用日後可變的live current enrollment grade/class；因此已啟用HOLD學生可正常分班，歷史仍可證明啟用時未分班。
Terminal XOR的「target year不得有enrollment」只在PRE_ACTIVATION成立；日後管理員restore可按10.5在已CURRENT target year
另建獨立MANUAL enrollment，不反寫或link歷史terminal transition。GRADUATE／LEAVE在activation原子把account設為
SUSPENDED並記reason/audit。

選CURRENT year手動建立／匯入學生會建ACTIVE enrollment；選PLANNED會建PLANNED。若學生已有CURRENT source，server按
target grade／class只可推導並upsert PROMOTE、REPEAT或HOLD_UNASSIGNED transition；跨多級／無法唯一推導則422並要求用
promotion UI。反向亦成立：若先有planned-only target，之後任何manual／import／restore writer建立CURRENT ACTIVE source，
必須同transaction按兩個enrollment deterministic建立matching PRE_ACTIVATION transition；無法唯一推導則422，不能留下半套。
只有沒有CURRENT source的planned-only新生可不建立transition；CLOSED year拒絕。
學生authentication／learning access除`User.status=ACTIVE`外，亦必須有唯一屬於`CURRENT` year的`ACTIVE` enrollment；
只有future `PLANNED` enrollment的新生屬derived `PRE_ENROLLED`狀態，activation前不可登入，但不需要濫用`SUSPENDED`。
Activation把incoming enrollment轉ACTIVE後自然取得登入資格；已被管理員SUSPENDED者即使target啟用仍不可登入。

### 6.6 Database invariants

一般 FK 不足以表達所有 contract；migration 必須明確加入：

- partial unique index：全系統最多一個 `AcademicYear.status=CURRENT`；
- unique normalized year label；CHECK label/date year pair符合`YYYY-YYYY`及第二年=第一年+1；PostgreSQL date-range exclusion
  constraint拒絕任何兩個academic years日期重疊；
- partial unique index：每個學生最多一個 `StudentEnrollment.status=ACTIVE`；
- CHECK：`startsOn <= endsOn`；`PLANNED`必須`startedAt/endedAt=NULL`；`ACTIVE`必須`startedAt!=NULL, endedAt=NULL`；
  `ENDED`必須兩者非null且`endedAt>=startedAt`；manual CURRENT create及activation負責設定startedAt，activation結束source時設定endedAt；
- composite FK／unique：`classId + academicYearId + grade` 一致；
- `StudentYearTransition` composite FK／deferred lifecycle trigger按上表分別驗證PRE_ACTIVATION與ACTIVATED final state，保證
  source／target student、year、status一致；PRE_ACTIVATION nonterminal必須有matching target，terminal禁止該student target-year
  enrollment；ACTIVATED terminal只要求transition link為null並容許日後unlinked MANUAL restore enrollment；每個source-target pair
  唯一；不得用永久CURRENT／ACTIVE check阻擋activation或日後下一次year rollover；
- lifecycle trigger亦按disposition驗證互斥shape：PRE_ACTIVATION驗live PLANNED row；ACTIVATED驗immutable target snapshot。
  PROMOTE=next grade、REPEAT=same grade＋啟用時assigned class、HOLD_UNASSIGNED=same grade＋啟用時class null；同grade未分班
  只能係HOLD，唔可同時解讀成REPEAT；
- deferred completeness trigger雙向保證：同student若同時有CURRENT ACTIVE source及immediate-successor PLANNED target，
  commit時必須有matching PRE_ACTIVATION nonterminal transition/link；planned-only incoming無CURRENT source時先容許無transition。
  Enrollment／transition／calendar writers用同一calendar row lock，raw SQL或並發次序都不可留下缺口；
- deferred final-state trigger：`ACTIVE enrollment→CURRENT year`、`PLANNED enrollment→PLANNED year`、
  `ENDED enrollment→CLOSED year`；普通／raw writer不可在CURRENT／PLANNED year insert ENDED row，亦不可單獨
  `ACTIVE→ENDED`。只有同一transaction同時完成source year `CURRENT→CLOSED`、immediate target
  `PLANNED→CURRENT`、全部source outcomes／transition activation及相應target status切換的完整activation final state先可commit；
  raw SQL如無法滿足整套atomic activation invariants一律被deferred trigger拒絕；
  所有`PLANNED` enrollment（包括incoming無transition）必須屬CURRENT之immediate successor；`ACTIVE/PLANNED enrollment`
  如有class，該class必須active；activation transaction可在commit前暫時處於中間狀態；
- CLOSED year的year/class/ENDED enrollment/teacher-access history在activation完成後immutable（subject hard-delete／audit
  anonymization例外）；只有activation transaction可同步CURRENT→CLOSED及ACTIVE→ENDED。普通API／raw trigger拒絕對CLOSED
  academic data insert/update/delete；
- TeacherClassAccess insert/update只接受active class及CURRENT／PLANNED year；CLOSED existing rows只讀。Class deactivate及access
  replacement以固定lock order鎖class＋TeacherProfile並由deferred final-state trigger保證「inactive class零access」，防並發插入繞過；
- CHECK：`canResetStudentPassword=true` 必須同時 `canViewProgress=true`；
- expand階段trigger只在profile insert／update驗證當時User.role；為保持舊writer兼容，`User.role` update跨表trigger
  延後到old-writer retirement contract migration。新service鎖定role；expand期間承認raw／舊writer role mutation未受
  完整DB contract保障，並由conformance query監測，唔會虛稱全DB invariant；
- `STUDENT`／`TEACHER` 必須恰有相應 profile 的 completeness 在本功能先由單一 create transaction、service invariant、
  local reset seed及 DB conformance query 保證；因舊 writer 不會建立 profile，把「所有既有 User 必須有 profile」
  升級成全 DB contract trigger只可留待 production backfill／old-writer retirement 後的獨立 contract migration；
- raw-DB negative tests證明profile insert／update mismatch、year／enrollment／class／transition及access final-state checks不能被
  bypass；不虛稱expand期raw `User.role` update已受阻，該gap只由conformance query偵測直至contract migration。Service tests
  證明新writer拒絕role update及新學生／教師交易無法commit缺失profile。

### 6.7 TeacherClassAccess

> 現況／歷史baseline：下列`canResetStudentPassword`仍是目前物理及runtime per-class欄。Future target、default-false
> migration、safe compatibility projection及rollback contract見後續教師工作台計劃§6；本段不再規範下一版reset語義。

- composite key：`teacherId + classId`
- `canViewProgress`
- `canResetStudentPassword`
- `grantedById`
- `grantedByPseudonym`、`hmacKeyVersion`
- timestamps

Full replacement transaction 先以 `TeacherProfile.accessRevision=expected` conditional increment；零更新返回 409，
再只delete/create request所選`academicYearId`所屬class rows；其他CURRENT／PLANNED／CLOSED year rows全部preserve。
`accessRevision`仍是跨year單一aggregate，故兩個year並發editor其中一個會409重讀，但絕不互相刪資料。GET contract必須
要求year ID並只回該year rows＋全aggregate revision。`canView=false && canReset=false` canonicalize為「沒有row」，不得保存空權限row。
沒有任何 access 的教師看到空名單；不會 fallback 為全校學生。

### 6.8 Staged batches、AdminOperationReceipt 與 PII lifecycle

`RosterImportBatch` 保存：entity type、format、`academicYearId`、preview operation ID／fingerprint、file hash、
canonical staged digest、mode、nullable actor、actor HMAC pseudonym／key version、status、counts、calendar／row snapshot revisions、
`expiresAt` 及暫存 staged rows。狀態固定為 `PREVIEWED → COMMITTED | CANCELLED | EXPIRED`；terminal state 不可逆。
Preview TTL 固定 30 分鐘，只可由原 actor 存取，所有 response `no-store`。

為支援User hard-delete，另建無PII、帶`linkRole`的`RosterImportBatchUserLink(batchId,userId)`及
`AdminMutationBatchUserLink(batchId,userId)`。Link唔只係mutation target：所有被payload／snapshot／diff引用的User都要寫，
包括existing-user rows、duplicate email owners、rotation eligible/conflicts、promotion/activation coverage teachers及其他user-derived
dependency；actor另由actor FK處理。任何user ID不可只埋入不可查JSON。Preview建立batch後按全域鎖序鎖及重驗所有users再寫links。
Hard-delete由links找出所有live／expired batches，system-cancel及physical purge整批staged rows／error report／target payload／
created linkage，再刪User。任何target或dependency被刪都取消整batch；原actor之後GET／commit只得terminal conflict/gone summary，
receipt只留non-PII counts／HMAC。COMMITTED／CANCELLED原本已zero。

所有roster／identity／batch／access writers唯一全域lock order如下；multi-row一律按canonical ID／advisory key排序，任何service
不可自訂局部相反次序：

1. `RosterMutationState` singleton `FOR UPDATE`；
2. normalized identity advisory keys；
3. import／mutation batch rows；
4. actor、target及dependency `User` rows；
5. `AcademicYear` rows；
6. `SchoolClass` rows；
7. `StudentEnrollment`／`StudentYearTransition` rows；
8. `TeacherProfile`／`TeacherClassAccess` rows；
9. grants、audit及operation receipts。

Import bcrypt仍在transaction外；正式transaction由第1項重新開始。Hard-delete API亦先取global mutex及identity key，再batch、
User及dependents；promotion／activation／import／rotation commit跟同一序。DB `BEFORE DELETE`或deferred trigger因raw statement可能已
持User等較後row，禁止blocking反向取lock：只用`NOWAIT`／`pg_try_advisory_xact_lock`；失敗即raise stable SQLSTATE `40001`要求
整個transaction由第1項重試，絕不等待造成cycle。Service只對`40001/40P01`作最多3次bounded jitter retry，耗盡回409／503 stable
code而唔係未處理500。同preview／commit／cleanup／actor或dependency hard-delete並發，結果只可成功或可重試conflict，且無PII orphan。

另建 canonical `AdminMutationBatch`，供 `BULK_CLASS | PROMOTION | YEAR_ACTIVATION | ROTATE_CREDENTIALS` 共用；狀態同樣是
`PREVIEWED → COMMITTED | CANCELLED | EXPIRED`。它只保存 nullable actor、actor pseudonym／key version、operation kind、
filter hash、canonical digest、roster／calendar revision、source／target year ID及revision、解析後內部user／enrollment／transition ID及revision、disposition、
class mapping、target class revision／active snapshot、相關 teacher `accessRevision`、coverage fingerprint／acknowledgement、
counts、expiry及timestamps，不保存legalName、email、nickname等直接PII。內部IDs仍按staged sensitive data處理，terminal／expiry
後一併purge，只保留digest及aggregate summary。Batch actor-bound；commit只接受batch ID及operation ID；
任何 source set、year、class、enrollment、teacher access或coverage change都返回409並要求重新preview。
`BULK_CLASS`及單級`PROMOTION`resolved set上限500（501整批拒絕）；`YEAR_ACTIVATION`因必須全校原子切換，
獨立上限5,000並以set-based writes處理，第5,001人阻擋activation及提示先處理資料規模／另開擴容計劃，不能分批造成雙CURRENT狀態。

所有batch terminal mutation均帶operation ID／fingerprint：第一次cancel令`PREVIEWED→CANCELLED`並purge；same ID／same
fingerprint retry返回同一summary；different fingerprint返回409；已COMMITTED不可cancel，已CANCELLED不可commit。Rotate
credentials使用`AdminMutationBatch(kind=ROTATE_CREDENTIALS)`＋同一user-link／receipt，遵守同一actor binding、TTL、
terminal-state、hard-delete purge及idempotency contract；不得另建無法被subject delete定位的匿名preview payload。

Namespaced `AdminOperationReceipt` 使用 nullable actor及actor pseudonym／key version，unique
`(actorId, operationKind, operationId)`，保存 request fingerprint 及 non-secret authoritative summary。Same ID + same
fingerprint 返回 receipt；same ID + different fingerprint 返回409。它不重用 study global operation receipt，亦不保存明文
credential。Created-account recovery linkage另保存建立時的 `expectedCredentialRevision`／`expectedTokenVersion`。

Commit／cancel 成功立即把 staged rows 設為null；過期請求在authoritative read／commit前先邏輯視為不可讀及不可提交，
因此即使local app關閉亦不會承諾不可能保證的wall-clock physical purge SLA。實作提供可重入
`npm run cleanup:roster-staging`，在dev server啟動及相關endpoint opportunistic執行；production scheduler屬日後deployment
plan。Error report同樣actor-bound、`no-store`、30分鐘TTL並納入相同purge。最終只保留HMAC digest、counts、timestamps、
actor pseudonym及短期（最多24小時）的created-user linkage；到期清除。Request body、preview rows及credential response
禁止寫入log、trace、screenshot、video或Git artifact。

### 6.9 SecurityEvent 與 deletion matrix

Canonical `SecurityEvent` fields為nullable `actorUserId`／`subjectUserId`、必填`actorPseudonym`（system event使用固定
system marker）、optional `subjectPseudonym`／`ipPseudonym`、`hmacKeyVersion`、eventType、allowlisted summary metadata及
timestamp；不再以欄名含糊的裸`subjectAccountHash`／`ipHash`作application contract。事件與對應security／admin mutation在
同一transaction寫入；audit寫入失敗令mutation rollback。

Expand migration因baseline已有legacy SecurityEvent rows，新增physical pseudonym／key-version columns先nullable，保留舊
`subjectAccountHash/ipHash`；新application writer在service層強制actor pseudonym（system marker）及key version非null，local reset
後全為canonical。Shared rollout只有完成歷史HMAC backfill／old-writer retirement先可在獨立contract migration設NOT NULL／drop
legacy fields；expand migration test必須由含legacy SecurityEvent fixture replay，唔可以靠空DB掩蓋。

以下為本功能加入現有 `SecurityEvent` enum 的 allowlisted event types；不可刪除或取代既有 password、user、session、
last-admin 等安全事件：

- `ROSTER_IMPORT_PREVIEWED`
- `ROSTER_IMPORT_COMMITTED`
- `ROSTER_IMPORT_CANCELLED`
- `ACADEMIC_YEAR_CREATED`
- `ACADEMIC_YEAR_UPDATED`
- `SCHOOL_CLASS_CREATED`
- `SCHOOL_CLASS_UPDATED`
- `SCHOOL_CLASS_DEACTIVATED`
- `ADMIN_PROFILE_UPDATED`
- `STUDENT_CLASS_CHANGED`
- `STUDENTS_PROMOTED`
- `TEACHER_CLASS_ACCESS_CHANGED`
- `ACCOUNT_SUSPENDED`
- `ACCOUNT_REACTIVATED`
- `ROSTER_EXPORTED`
- `NICKNAME_CHANGED`
- `IMPORT_CREDENTIALS_ROTATED`
- `ACADEMIC_YEAR_ACTIVATED`

Audit metadata 只保存 operation summary、counts、batch／operation HMAC pseudonym，不保存整份名單、真名、email
或明文密碼。低熵學生證不可使用裸 SHA；所有 pseudonym 使用 secret-key HMAC 及 versioned key ID。
`SECURITY_AUDIT_HMAC_SECRET` 至少32 bytes、`SECURITY_AUDIT_HMAC_KEY_ID`必填，且與Auth/JWT secret分離；rotation期間
以versioned old-key ring驗證歷史值。缺少／過短secret時，audit、authentication及admin mutation fail closed，並納入
production-config檢查。

Deletion policy：

| Relation | onDelete／保留決定 |
|---|---|
| StudentProfile、TeacherProfile、Enrollment | subject user hard-delete時cascade |
| StudentYearTransition.student | subject student hard-deleteAPI在同一transaction先刪transition，再刪User；FK亦為Cascade作最後保護 |
| StudentYearTransition.source／target enrollment | `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`；ordinary enrollment delete到commit仍失敗，User hard-delete同tx刪transition＋enrollment可成功；API仍先刪transition |
| StudentYearTransition.actor | admin actor delete時`SetNull`，保留actor HMAC pseudonym／key version；絕不可cascade學生transition |
| Review、ReviewEvent、StudySession及其item／stream lineage | user hard delete 時 cascade |
| EvidenceObligation、ObjectiveEvidenceTarget及其snapshot、StudyEncounter、StudyDay、UserAchievement | user hard delete 時 cascade |
| Study operation receipts及其他明確user-owned learning rows | user hard delete 時 cascade；不得孤兒化PII |
| TeacherClassAccess.teacher／class | user／class hard delete 時 cascade |
| TeacherClassAccess.grantedBy | `SetNull`，保留 grantedBy HMAC pseudonym |
| SecurityEvent actor／subject | `SetNull`，保留 versioned HMAC pseudonym及事件摘要 |
| RosterImportBatch／AdminMutationBatch／AdminOperationReceipt actor | `SetNull`，先purge staged PII，保留actor HMAC pseudonym及counts |
| RosterImportBatchUserLink／AdminMutationBatchUserLink | target／dependency user hard-delete時觸發同tx system-cancel＋physical purge，再cascade join；不可留下舊GET/error report |
| Created-account recovery linkage | user delete 或 24 小時到期時 cascade／purge |
| RecentAuthGrant | user delete／password or status revoke時purge；TTL cleanup；只保存HMAC session key |

若某 relation 無法安全 `SetNull`，API 必須在 hard delete 前先 anonymize／purge；不能因 `Restrict` 令曾經匯入
名單的管理員永遠不可刪，亦不能 cascade 刪除 audit。Phase 0先由Prisma schema產生完整FK inventory artifact，migration
test對照每個direct／indirect User relation；student、teacher、admin各做一次hard-delete DB test，防止遺漏日後新增relation。

## 7. 身份、私隱與暱稱 contract

### 7.1 欄位責任

| 欄位 | 用途 | 可見對象 | 可修改者 |
|---|---|---|---|
| accountName／學生證 | 登入及管理辨識 | 本人、授權教師、管理員 | 建立後不可改 |
| contactEmail | 日後聯絡／找回密碼預留 | 本人、管理員 | 管理員；學生暫不可改 |
| legalName | 校務識別 | 本人、授權教師、管理員 | 管理員 |
| nickname | 排行榜及學生公開顯示 | 登入使用者 | 學生本人、管理員 |

### 7.2 Nickname moderation

Server 必須按固定次序處理：

1. trim；
2. Unicode NFKC normalize；
3. 拒絕控制字元、zero-width、bidi override、異常 combining sequence；
4. 按 grapheme 計算 2–24 字；
5. 拒絕 URL、email、電話號碼及其他直接聯絡資料；
6. 拒絕粗言穢語、性／仇恨字詞及明顯侮辱內容；
7. 拒絕「管理員」「老師」「官方」「系統」等冒充保留名；
8. 在同一transaction讀authoritative User／StudentProfile，拒絕normalized nickname等於本人legalName、accountName／學生證或
   contactEmail，並拒絕account／contact作完整token出現；不做模糊姓名相似度猜測，避免正常暱稱被誤殺；
9. 保存顯示值及 normalized value；
10. 使用 per-student rate limit、`profileRevision` CAS 及 audit。

暱稱不要求唯一，避免學生用額外數字或真名來取得唯一性；排行榜可以用不顯示內部 ID 的穩定 avatar
視覺區分同名。管理員修正 nickname 必須經同一 validator、CAS 及 audit；管理員操作不受學生 self-service
rate limit，但有獨立 admin mutation rate limit。
呢個亦係cross-field invariant：student create／import／manual legalName update必須在同一transaction對new／existing nickname重跑
exact-match規則；如改真名令暱稱變成真名，422並要求同一操作一併提供新合規nickname，唔可以先洩露再等學生修正。

### 7.3 公開資料防漏

- Session `displayName` 對學生只使用 nickname；PATCH 成功後 client 立即 refresh authoritative session／display DTO，
  其他既有 session 在下一次 server validation 取得新 nickname。
- Leaderboard query只包含`ACTIVE STUDENT`、profile完整且有CURRENT-year ACTIVE enrollment的帳號；PRE_ENROLLED不顯示。
- Leaderboard、achievement、student-facing error 不能 fallback 到 `legalName` 或 `accountName`。
- Profile 缺失／損壞時使用本地化泛稱「同學」並觸發 server diagnostic，不顯示 internal ID。
- Teacher/admin DTO 才可按授權返回 legalName／accountName。
- 所有 export fields 使用 hard allowlist，不接受任意 Prisma field name。

`contactEmail` 是使用者明確要求的預留欄位，但本期未驗證、不可登入、不可找回密碼；UI 必須標示
「未驗證聯絡 email」，只供本人及管理員查看，匯出預設不選。清空後即刪除；hard delete 帳號時一併刪除。

## 8. 授權矩陣

| 動作 | Student | Teacher | Admin |
|---|---:|---:|---:|
| 查看自己 profile | ✅（`/profile`） | 現有account controls；本期不新增teacher profile頁 | 現有account controls；本期不新增admin profile頁 |
| 修改自己 nickname | ✅ | ❌ | ❌ 以本人 API；可在管理頁修正學生 nickname |
| 查看學生真名／帳號／進度 | 只限自己 | 只限獲授權班級 | 全校 |
| 重設學生密碼 | ❌ | 只限獲授權班且有 reset capability | ✅ |
| 建立／匯入／匯出帳號 | ❌ | ❌ | ✅ |
| 分班／升級／排除 | ❌ | ❌ | ✅ |
| 停權／恢復／hard delete | ❌ | ❌ | ✅ |
| 設定教師班級權限 | ❌ | ❌ | ✅ |

所有 route handler 都要直接執行授權；layout、client filter 或 hidden button 不視為 security boundary。

Teacher route 使用單一 `authorizedStudentWhere()`／`requireTeacherStudentAccess()` helper：

- `ADMIN` 明確 bypass；
- `TEACHER` 必須符合唯一 `ACTIVE` enrollment + `CURRENT` academic year + active class + class access + capability；
- 無授權 list 返回空陣列；直接存取未授權／不存在學生 detail／mutation 統一返回 404；
- suspended teacher／student fail closed；
- request body 的 `classId` 只能再收窄 server allowed set，不能擴闊。

所有 teacher mutation 必須在寫 transaction 內以 target ID + authoritative predicate 重新驗證 actor ACTIVE、角色、
class ACTIVE、student ACTIVE enrollment、student account status 及 exact capability；不能只在 route 開頭查一次。
未授權與不存在 target 統一回 404，避免 enumeration。教師重設學生密碼另需 recent authentication、per-teacher
rate limit、`mustChangePassword=true`、`tokenVersion+1`、security audit 及一次性顯示；response 遺失可再次產生
另一個新密碼，舊密碼即作廢。

Access inventory gate 不只檢查現有三個 route，還包括 Route Handlers、Server Components、server actions、export、
aggregate 及未來 student detail；任何 teacher-to-student Prisma query 必須經 canonical scope helper，無 access aggregate
只能是零／空。

## 9. 匯入 contract

### 9.1 支援格式及限制

- CSV：UTF-8／UTF-8 BOM，RFC 4180 quoting；
- XLSX：只讀第一個名為 `data` 的 visible worksheet；公式 cell、macro、external link、encrypted workbook 一律拒絕；
- templates 版本化為 `student-roster-v1`／`teacher-roster-v2`；第一個 visible worksheet 固定是 `data`，
  canonical header order 固定；說明 sheet 只能放第二頁；
- account／學生證一律按字串解析，保留前置零；XLSX template 預設該欄為 text；numeric／formula account cell
  逐行報錯，因為 importer 不可猜回 Excel 已丟失的前置零；CSV 禁止 numeric coercion；
- 上限：5 MiB、500 data rows、100 columns、單格 4,000 字、解壓後 25 MiB；501 行整批拒絕並提示拆檔；
- 空檔、duplicate headers、任何unknown header、duplicate account／email、role collision 明確逐行報錯；server按
  entity type及完整canonical header set推導contract version，不信任client自報template version；
- 支援既定簡繁 header aliases，但 alias canonicalize 後要再次檢查 duplicate；匯出及模板只使用 canonical headers。

每次preview必須由管理員明確選擇`academicYearId`；batch固定保存該year。學生匯入只接受`CURRENT`或
immediate-successor `PLANNED`，拒絕更遠future／`CLOSED`；教師匯入可選`CURRENT`或任何`PLANNED`以預設較遠future access，
仍拒絕`CLOSED`。學生enrollment與教師access只解析至所選year；grade／class不存在時逐行報錯，不自動建立。

### 9.2 學生匯入欄位

> **歷史欄位說明（已棄用）：** 本節早期版本曾把 `accountName` 與
> `studentNumber` 合併成一個「學生證號碼」欄位。該合併 contract 已由
> `plans/admin-user-directory-and-learning-analytics.md` 取代；以下欄位表只保留作
> 歷史參考，新的 parser、模板及 UI 不得照此合併欄位實作。

| 欄位 | 必填 | 說明 |
|---|---:|---|
| accountName（學生證登入帳號） | ✅ | 文字；首尾及前置零按登入帳號規則保留 |
| studentNumber（學號） | ❌ | 獨立的正整數 1–999999；可留空；不承擔登入或前置零語義 |
| legalName | ✅ | 真實姓名 |
| nickname | ✅ | 通過同一 server nickname validator |
| grade | ✅ | 初一至高三 |
| classCode | ❌ | canonical `A`–`H`；UI 顯示甲至辛；create 留空代表未分班 |
| contactEmail | ❌ | normalized；非空時全系統唯一 |

### 9.3 教師匯入欄位

> 下列是目前teacher-roster-v2格式。Versioned global `resetPasswordCapability`取代per-class
> `resetPasswordAccess`；v1非blank reset不得自動擴成global，詳見教師工作台計劃§6.3。

| 欄位 | 必填 | 說明 |
|---|---:|---|
| accountName | ✅ | 教師登入帳號 |
| legalName | ✅ | 真實姓名 |
| contactEmail | ❌ | normalized；非空時唯一 |
| classAccess | ❌ | `JUNIOR_1:A|JUNIOR_2:B` 等 stable class keys |
| resetPasswordCapability | ❌ | typed `TRUE`／`FALSE`／blank；教師級能力，不再按班設定 |

Template 只使用 machine values；UI preview／error 顯示本地化「初一甲」。`resetPasswordAccess` 不接受
模糊 boolean，避免 `true` 被誤解為全校權限。

### 9.4 Create／merge 欄位語義

| 欄位 | CREATE | MERGE 空白／缺欄 | MERGE 有值 |
|---|---|---|---|
| accountName | 必填、建立 key | 不適用，永不修改 | 只作查找 key |
| legalName | 必填 | error；避免不完整 row | 通過 validator 後更新／unchanged |
| nickname（學生） | 必填 | error | 同一 validator 後更新／unchanged |
| grade（學生） | 必填 | error | 更新所選學年 enrollment grade；closed year 拒絕 |
| classCode（學生） | 空白＝未分班 | selected-year enrollment已存在：空白＝preserve；不存在而本row建立enrollment：空白＝未分班；`UNASSIGNED`＝明確清空 | 設定至已存在 class |
| contactEmail | 空白＝null | 空白＝preserve；`__CLEAR__`＝null | normalized 後更新 |
| classAccess（教師） | 空白＝無 access | 見下方pair matrix | 見下方pair matrix |
| resetPasswordAccess | 空白＝無 reset access | 見下方pair matrix | 見下方pair matrix；永遠是view subset |

學生grade/class係同一aggregate：如selected-year enrollment不存在，MERGE按必填grade建立該year enrollment，blank class
deterministically代表unassigned；如enrollment已存在而grade改變，`classCode`不可blank-preserve，必須提供屬新grade／同year的
active class或明確`UNASSIGNED`，否則row `ERROR`。若改CURRENT source grade而存在未activated transition，整row409／error並要求先在
promotion editor取消／重建transition，禁止import暗中重算。任何PLANNED enrollment grade／class改動必須snapshot transition
revision並經transition service deterministic重算；`HOLD_UNASSIGNED`不能被普通edit／bulk assign class，須在promotion editor
明確改為`REPEAT`後提交。

教師兩個access欄必須按pair處理，避免blank同時被解讀為preserve及clear：

| MERGE classAccess | MERGE resetPasswordAccess | 結果 |
|---|---|---|
| blank／缺欄 | blank／缺欄 | preserve兩個existing sets |
| `__CLEAR__` | blank／缺欄 | 兩個sets full replacement為empty |
| replacement list | blank／缺欄 | view替換為list；reset替換為empty |
| blank／缺欄 | nonblank／`__CLEAR__` | `ERROR`；不可相對一個preserved view set猜測replacement |
| replacement list | replacement list／`__CLEAR__` | full replacement；reset必須是新view set subset |

Merge 不改密碼、不改角色、不刪除檔案中未列出的帳號。Preview 必須回傳 row action
`CREATE | UPDATE | UNCHANGED | ERROR`，以及每個 changed field 的 before／after diff；真名／email diff 只對原 actor
顯示且 response `no-store`。Staged plan 保存 expected User、Profile、Enrollment、StudentYearTransition、email ownership 及
`accessRevision`；任何 stale row 在 commit 時令整批 409／rollback。

### 9.5 Preview／commit 流程

1. 管理員選學生／教師、academic year、CSV／XLSX、create-only／merge-existing。
2. Client 只負責 upload；server 重新 parse 及 canonicalize。
3. Server驗證required fields、nickname、grade／class、DB duplicate、role collision、email uniqueness、teacher access；student
   CURRENT writer另查immediate PLANNED target並preview將建立的matching transition，無法推導則row error。
4. `previewOperationId + previewFingerprint(fileHash, entity, year, mode, templateVersion)` 建立 30 分鐘 staged batch，
   回傳 paginated rows、原始 row number、field diffs、只看 errors filter、summary、expiry countdown及 error-report download；
   error DTO固定為 `{ code, row, field, messageKey }`，不向client暴露parser／DB exception文字。
5. 管理員只能在 zero-error 狀態確認；confirmation 傳 `batchId + commitOperationId`，不重傳原始 rows。
6. Commit fingerprint 固定為 `(batchId, mode, academicYearId, canonicalStagedDigest)`；same ID／different fingerprint 409。
7. Server 驗證 actor、TTL、year status、staged digest、snapshot revisions、email ownership及 namespaced receipt；
   `fileHash` 只作 upload provenance，不聲稱在 commit 重算已不存在的原檔。
8. 最多 500 個新帳號的 plaintext／hash 在 transaction 外以 bounded concurrency 產生，只留在 request memory；
   benchmark 後固定 concurrency。Hash完成後Serializable transaction必須`SELECT ... FOR UPDATE` lock batch，再重驗actor、
   `status=PREVIEWED`、`expiresAt>transaction_timestamp()`、digest、operation receipt及所有snapshot；hash期間被cancel／expire／commit
   一律不寫任何user。通過後才寫hash／profiles／enrollments／transition／access／audit並轉terminal state。
9. 成功後立即 purge staged PII；只在一次 response／即時下載 report 返回 `CREATE` rows 的
   `accountName, legalName, temporaryPassword`。One-time JSON response用`no-store`交UI memory；下載格式固定為client-memory產生的
   XLSX，三欄全設typed string（legalName即使以`=+-@`開始亦不可成formula），client Blob只承諾正確XLSX MIME及安全
   filename；HTTP JSON response另設`Content-Type: application/json`、`no-store`及`X-Content-Type-Options: nosniff`；
   不提供CSV credential report、不寫localStorage／IndexedDB。Trace、video、screenshot、log全部停用secret capture。
10. 任一 row 失敗整批 rollback；Serializable retry 有固定上限及 jitter，不在 retry 內重做 bcrypt。
11. Commit response 遺失時，retry 只回 committed summary、`credentialReportAvailable=false`，永不重播 plaintext。
12. 管理員可在24小時內以recent-auth、batch-scoped「重新產生建立帳號密碼」preview／commit；只列出
    `mustChangePassword=true` 且 `credentialRevision/tokenVersion` 仍等於created-linkage snapshot的accounts。已自行改密碼、
    已被另行reset、已停權／刪除或revision不符者列為conflict並排除，永遠不可覆蓋較新credential。Commit原子更新eligible
    hash、`credentialRevision+1`、`tokenVersion+1`，一次性返回新report；有獨立operation fingerprint／receipt、audit及rate limit。
    24小時後改用一般逐帳號／另行選取reset。
13. 管理員可cancel preview；cancel／commit即時purge。TTL到期立即在邏輯上不可讀／不可提交，physical purge由可重入cleanup
    job處理；過期UI清楚提示重新上載。

## 10. 管理員名冊操作

### 10.1 逐個建立／編輯

- 學生：accountName、legalName、nickname、grade 必填；class、contactEmail optional；密碼可手填或自動產生。
- 教師：accountName、legalName 必填；contactEmail optional；可建立後即時設定多個班級權限。
- 手動建立學生亦必須明選`CURRENT`或immediate-successor `PLANNED` year；前者建立`ACTIVE` enrollment，後者建立`PLANNED`；
  class optional但如有必須屬同一year／grade且active；`CLOSED`拒絕。
- Server自動密碼固定用CSPRNG對無歧義alphabet作unbiased sampling，10 chars（只用易讀小寫字母及數字，排除容易混淆字元）；hash固定bcrypt
  cost 12。這是只在一次 response 返回、首次登入後必須改密碼的交付密碼，方便教師抄錄但仍避免可預測值。Manual create如管理員自行輸入則走現有強密碼policy（12–128 chars）且不寫log／staging；教師reset及批次
  credential rotation只接受server-generated password，避免管理員提交可預測bulk password。
- 編輯時 accountName／role 鎖定；可改 legalName、contactEmail、nickname、user status及教師 class access。Manual update
  request必須帶 `expectedUserRevision`，profile／enrollment／teacher access另帶各自expected revision；同一Serializable
  transaction conditional update，任一stale即整體409。Status／role／last-active-admin guard亦在同一transaction重驗。
- Manual CURRENT grade change沿用grade/class aggregate規則；如有pending transition即409並導向promotion editor。PLANNED
  enrollment不由generic user editor直接改grade/class，只可經import／promotion transition service。
- 任何manual CURRENT enrollment create（包括restore）都要snapshot calendar及該student immediate PLANNED row；如target已存在，
  同transaction建立matching transition或422，符合6.5雙向completeness invariant。
- 安全敏感操作要求 recent authentication。

### 10.2 批量轉班

- 本route只接受`CURRENT` year並只修改該year `ACTIVE` enrollment的class；`PLANNED/CLOSED`拒絕，planned roster改班必須
  經promotion／import transition service；操作永不改grade、origin或transition；
- 以學年、年級、目前班別、狀態、搜尋條件取得 server-side cursor-paginated roster；stable sort 為
  `accountName + id`，default page size 50、max 100；
- UI 明確區分「本頁 N 人」及「全部符合條件 M 人」；改 filter 時要求清除或重新 preview；
- Preview 接受 `{ mode: explicit | allMatching, explicitIds | filters, excludedIds }`，server 解析完整集合並建立
  actor-bound、30 分鐘 TTL、含 IDs／revisions／filter hash 的 opaque selection batch；
- 單一batch resolved selection上限500人；第501人整批413，不可截斷；
- 目標可為同一CURRENT year、同grade的active甲至辛class或未分班；target class revision／active狀態納入snapshot；
- Preview 顯示 selected／unchanged／invalid／conflict counts；
- Commit 只傳 `selectionBatchId + operationId`，不依賴 client 重傳跨頁 student IDs；
- 同一 transaction 更新、寫 audit 及 receipt；stale preview 返回 409。

### 10.3 全級升級

固定 mapping：

```text
初一 → 初二 → 初三 → 高一 → 高二 → 高三
```

- 高三沒有下一年級，預設 disposition 為`GRADUATE`；不可使用`PROMOTE`，亦可在有明確理由時選`REPEAT`／
  `HOLD_UNASSIGNED`；
- 管理員必須先在「學年及班級設定」建立 `PLANNED` target year 及實際 classes；preview 不會寫 DB 或自動建 year／class；
- Preview 顯示所有 source `ACTIVE` 學生、current class、target disposition 及 teacher-access coverage；
- 非高三included學生預設`PROMOTE`；管理員uncheck／排除時必須改為`REPEAT`、`HOLD_UNASSIGNED`或`LEAVE`，
  不可留下無狀態exclusion；高三按上一點處理；
- 可設定 source class → target class mapping；預設沿用同一班碼，但 target class 必須已存在；未分班可保持未分班；
- Promotion commit只建立／更新target `PLANNED` enrollment及持久`StudentYearTransition`；source enrollment完全不變；
- 以 staged selection、expected revisions、Serializable transaction、operation receipt 阻止 stale／double submit；
- Promotion 不是學年切換；管理員可多次修正 planned roster，直至 activation gate 通過。

### 10.4 學年啟用

- Activation 是獨立 preview／commit，只接受一個 `CURRENT` source year及一個 `PLANNED` target year；
- Preview要分類並證明：每個source ACTIVE student對本source-target year pair有唯一`StudentYearTransition`；nonterminal
  transition有唯一target PLANNED，terminal transition為`GRADUATE/LEAVE`且無target；
  target year內沒有source enrollment的incoming PLANNED學生照常啟用；已suspended source若有target PLANNED，target會啟用但
  account保持suspended，若沒有target則只結束source。任何無明確outcome的source學生阻擋activation；
- Preview 顯示 target class 學生數、未分班數、repeaters及每班 teacher view／reset access coverage；無教師班級必須
  由管理員逐班明確 acknowledge，避免切換後教師突然看到空名單；
- Coverage只計符合`User.role=TEACHER`、`User.status=ACTIVE`、存在`TeacherProfile`，並對該target-year active class
  有`TeacherClassAccess.canViewProgress=true`的教師；reset coverage另要求同一row `canResetStudentPassword=true`（亦即view subset）。
  `SUSPENDED`教師即使保留access row亦不計coverage。Preview在同一Serializable snapshot查詢target year全部access候選（包括
  當時停權而不計數者），保存每個相關User的role／status／revision、TeacherProfile `accessRevision`、access rows及全域
  `RosterMutationState.revision`到coverage fingerprint，並把全部候選教師寫入batch user links；新授權、撤權、role/status／profile
  變更都會increment global revision，commit重算predicate且任何差異一律409要求重新preview。零view coverage要逐班ack；
  reset coverage只作清晰提示，不把無reset權誤報為可重設密碼；

> Future activation reset coverage會改為`ACTIVE teacher + TeacherProfile global reset=true + target class view row`，並把global
> Boolean納入snapshot／fingerprint；本段per-class predicate只記錄目前已驗證baseline，詳見後續教師工作台計劃§6.4。

- Teacher access editor 可預先設定 `PLANNED` year，不限 current year；
- Preview建立`AdminMutationBatch`並snapshot source／target year revisions、所有target class revisions／active flags、所有受影響
  transition及source／target enrollment revisions、`RosterMutationState.revision`、相關teacher User role／status／revision、
  `accessRevision`、access rows、coverage fingerprint及逐班ack；任何一項改變即409；
- Commit 在一個 Serializable transaction 內 conditional-CAS：source enrollments `ACTIVE→ENDED`、target
  `PLANNED→ACTIVE`、transitions抄寫immutable target grade/class snapshot並設定`activatedAt`、source year `CURRENT→CLOSED`、
  target year `PLANNED→CURRENT`；
- 任一 student disposition、teacher-coverage acknowledgement、year revision 或 enrollment revision stale 即全批 409；
- Activation 有 operation receipt；重送同 fingerprint 返回 authoritative summary。

### 10.5 停權、恢復及刪除

- 停權為預設離校／離職操作；保留學習及 audit 歷史；`tokenVersion + 1`；新舊 session 失效。
- 恢復時 `status=ACTIVE`、清除停權原因，再次`tokenVersion+1`。學生若沒有CURRENT-year ACTIVE enrollment，
  restore先檢查是否planned-only incoming：管理員可選「只恢復帳號、保持PRE_ENROLLED」，此時不建CURRENT enrollment，
  activation前仍不可登入；或明確「轉為current student」，選grade及optional active class，在同一transaction建立ACTIVE
  enrollment並為既有planned target補matching transition，無法推導則422導向promotion editor。沒有planned target時，restore
  必須同時建立CURRENT ACTIVE enrollment；有既有ACTIVE則只重驗CURRENT year／class invariant。Activation不會自動恢復原已suspended帳號。
- Hard delete 只提供單一帳號、recent-auth、typed confirmation；UI 明示會 cascade 學習資料且不可復原。
- 禁止管理員刪除／停權自己；保留最後一名 active admin guard。
- 批量 hard delete 不在範圍內，避免把一般離校流程變成不可逆刪除。
- 本期停權／恢復為逐個帳號操作；如日後要 bulk status，另加 selection preview／exclusions contract，不從 plural route 名推斷。
- 已打開學習頁收到suspended／revoked response時必須停止retry，按account namespace清除V1 review queue／checkpoint及
  V2 outbox／checkpoint／畫面PII，導向登入並顯示不洩露停權原因的訊息；保留`STUDY_V2_ASSIGNMENT_MODE=off` rollback
  contract，加入V1及V2 active-study suspension／restore-no-replay E2E。

## 11. 教師班級權限管理

> 本節記錄目前per-class editor。Future editor會把reset switch移至獨立教師帳號能力區，班級matrix只保留view scope，
> 並加入教師搜尋、grade／selected filters及safe CAS／compatibility，詳見後續教師工作台計劃§7.5及§8。

- 管理員在教師名單選擇教師後，可選 `CURRENT` 或 `PLANNED` academic year，再看 grade／class matrix；
  `CLOSED` 只讀。
- 每班可以設定：無權限、只看進度、看進度兼重設密碼。
- 儲存以 full replacement contract 處理，request 包含 `TeacherProfile.accessRevision`；transaction conditional
  increment 後才 replacement，stale 返回 409。
- Server 驗證所有 class ID 屬於指定的`CURRENT`／`PLANNED` academic year且class active，不能接受任意 ID。
- Full replacement只影響所選year；切換／保存PLANNED year絕不可刪CURRENT或其他year access。Current＋planned雙editor
  concurrency以global `accessRevision`令後提交者409並重載。
- 權限撤回後下一次 read request 即生效；進行中的 password reset mutation 在寫 transaction 內再驗權，避免 TOCTOU。
- Teacher import 可以同時建立相同 access records。

## 12. 匯出 contract

### 12.1 Filters

- entity type：學生／教師；
- academic year；
- grade；
- class／未分班；
- account status；
- 搜尋 accountName／legalName／nickname（按角色適用）。

### 12.2 可選欄位 allowlist

學生：

- accountName
- legalName
- nickname
- grade
- classCode
- contactEmail
- status
- mustChangePassword
- createdAt

教師：

- accountName
- legalName
- contactEmail
- status
- classAccess
- resetPasswordAccess
- createdAt

永不提供：`passwordHash`、temporary password、tokenVersion、session、audit digest、rate-limit key、internal user ID。

`resetPasswordAccess`只保留作舊v1/per-class export歷史欄；v2 canonical export使用 typed Boolean
`resetPasswordCapability`＋獨立`classAccess`，詳見教師工作台計劃§6.3。

### 12.3 CSV／XLSX 安全

> **歷史 contract compatibility note：** 本節任何把 `accountName／studentNumber`
> 視為同一字串、或要求學號保留前置零的描述，均屬已棄用的舊版 roster export
> contract。現行匯入／匯出必須分開輸出 `accountName`（文字登入帳號）及
> `studentNumber`（可空正整數）；下列安全規則只在不違反此欄位分拆的前提下保留。

- Export 永遠作用於全部 server-resolved filtered result，不受目前 page 影響；academic year 必填，學生
  grade／class 取該 year enrollment，teacher access 亦只 serialize 該 year；
- Student export以selected-year enrollment作INNER JOIN，零enrollment帳號不出現且絕不fallback其他year：CURRENT只取ACTIVE、
  PLANNED只取PLANNED、CLOSED只取ENDED；account status係獨立filter，故suspended但有該year enrollment仍可按filter匯出。
  Teacher export不要求enrollment，對selected year access作LEFT JOIN，zero-access teacher仍輸出空access欄；
- UI先經同一filter contract呼叫preview/count；download在同一`REPEATABLE READ` snapshot以stable
  `accountName,id`排序並直接fetch `cap+1`，第5,001 row整體拒絕，唔依賴可與fetch競爭的舊count；UI count只供預覽，
  download結果先係authoritative；
- 至少選一欄；輸出按 UI 選擇次序；預設欄位為 accountName、legalName、nickname／class access、grade、class、status，
  `contactEmail` 預設不選；
- teacher class access 使用與 import 相同、stable sorted `JUNIOR_1:A|...` serialization；
- CSV 使用 UTF-8 BOM、RFC 4180 escaping；
- XLSX所有export value使用typed string cell（日期亦輸出ISO 8601 UTC string），不設定formula；
  `accountName` 以文字輸出以保留登入帳號前置零，`studentNumber` 以正整數或空值輸出；
  teacher即使zero access亦輸出空字串而非漏row；
- CSV任何以`= + - @`或tab／CR開始的自由文字以leading apostrophe neutralize並在template／UI明確記錄。此CSV安全
  representation不聲稱對危險自由文字exact round-trip；需要無修改值的校務保存使用typed-string XLSX。Account/email本身
  validator已拒絕危險prefix；
- response 使用 `Cache-Control: no-store`、安全 filename 及正確 MIME；
- export 有 row cap、recent-auth、rate limit 及 `ROSTER_EXPORTED` audit summary；
- audit 不記錄匯出的完整內容；download errors使用固定code：`EXPORT_TOO_LARGE`、`EXPORT_FILTER_STALE`、
  `RECENT_AUTH_REQUIRED`、`EXPORT_RATE_LIMITED`，不回傳raw DB error。

## 13. UI 與資訊架構

### 13.1 管理員 `/admin/roster`

分為六個清晰區段／tabs：

1. 學生名單：search、filters、pagination、selection、逐個編輯、停權／恢復、hard delete、批量轉班；
2. 教師名單：逐個建立、批量匯入、停權／恢復、hard delete、班級權限 editor；
3. 學年及班級設定：建立 `PLANNED` year、日期、year selector、建立／停用 A–H classes、activation preview／commit；
4. 匯入：學生／教師、year selector、CSV／XLSX templates、paginated preview、errors、commit、credential report／rotation；
5. 升級：source／target year、grade、class mapping、promotion／repeat／unassigned dispositions、preview、commit；
6. 匯出：entity、year、filters、row count、ordered field selector、CSV／XLSX。

Desktop 使用 table；mobile 使用 cards 或可水平閱讀的 compact rows。所有 selection、dialog、error summary、
credential report 需 keyboard 可操作及 screen-reader label 完整。Preview table 支援原始 row number、只看 errors、
error report download、expiry countdown及 cancel。繁簡及 light／dark theme 都要覆蓋。

Recent-auth window 固定為 15 分鐘。Upload／preview 前顯示 gate 狀態；如 commit 前需 re-auth，使用 modal／安全 redirect，
成功後回到同一 actor-bound batch、filters、selection及 exclusions，不要求重新上載。任何 re-auth state 都不保存明文密碼。

### 13.2 學生 `/profile`

- 顯示 accountName、legalName、grade、class、未驗證 contactEmail；全部只讀；
- nickname 可編輯，清楚說明排行榜只會顯示暱稱；
- 顯示 moderation error、rate limit、stale revision conflict；
- 不在 client 實作唯一 moderation boundary。

### 13.3 教師頁

- 顯示獲授權班級 filters；
- 沒有權限時顯示「尚未獲分配班級」，不顯示全校 aggregate；
- student detail／password reset 同樣受 server authorization；
- 管理員進入 teacher view 時有明確全校視角文案。

## 14. API 邊界

建議 routes：

```text
POST       /api/auth/reauth

GET/POST   /api/admin/academic-years
PATCH      /api/admin/academic-years/[id]
GET/POST   /api/admin/classes
PATCH      /api/admin/classes/[id]

GET/POST   /api/admin/users
PATCH/DELETE /api/admin/users/[id]

`PATCH /api/admin/users/[id]` 只係一個 adapter，唔再接受模糊的 generic body：`operation=UPDATE_IDENTITY`
只處理已核准的 legalName／contactEmail／student nickname，使用 detail query 回傳的 User／Profile revisions、
recent-auth、body cap、strict fields、identity normalization／unique lock及CAS；`operation=CHANGE_STATUS`只委派
canonical roster lifecycle service，保留停權、CURRENT／PRE_ENROLLED restore、session revoke、self／last-admin guard
及audit。任何 `password`／`passwordHash` 欄位一律拒絕，管理員及教師改密碼必須使用各自 audience-bound
prepare→commit reset route；所有既有 users／roster caller 均使用 typed command，唔可由 generic PATCH 另建一套
status／credential writer。

GET        /api/admin/roster/import/templates/[entity]/[format]
POST       /api/admin/roster/import/preview
GET        /api/admin/roster/import/[batchId]
GET        /api/admin/roster/import/[batchId]/errors
POST       /api/admin/roster/import/[batchId]/commit
POST       /api/admin/roster/import/[batchId]/cancel
POST       /api/admin/roster/import/[batchId]/rotate-credentials/preview
POST       /api/admin/roster/import/[batchId]/rotate-credentials/commit
POST       /api/admin/roster/export/preview
POST       /api/admin/roster/export
POST       /api/admin/roster/students/bulk-class/preview
POST       /api/admin/roster/students/bulk-class/commit
POST       /api/admin/roster/students/promote/preview
POST       /api/admin/roster/students/promote/commit
POST       /api/admin/academic-years/[id]/activation/preview
POST       /api/admin/academic-years/[id]/activation/commit
GET        /api/admin/mutation-batches/[batchId]
POST       /api/admin/mutation-batches/[batchId]/cancel
GET        /api/teacher/classes
POST       /api/teacher/class-summary/query
POST       /api/teacher/roster/query
POST       /api/teacher/progress/query
GET        /api/teacher/students/[id]
GET/PUT    /api/admin/roster/teachers/[id]/access-settings

GET/PATCH  /api/student/profile

POST       /api/teacher/students/[id]/reset-password
```

共同要求：

- admin mutation：`requireRole(ADMIN)` + recent auth + input validation + transaction + audit；
- 所有cookie-auth state-changing POST／PUT／PATCH／DELETE先做same-origin Origin＋CSRF validation並fail closed；GET／HEAD
  必須無副作用。Student nickname、teacher reset及admin routes使用同一middleware，唔只reauth endpoint；
- teacher-student route：role auth 後再做 object-level access；
- student profile mutation：target 一律取 session user ID，不接受 body userId；
- POST commit routes 使用 `operationId`；
- bulk routes 使用 max row／selection limits；
- API response 只返回 allowlisted DTO；
- validation error 不回傳 Prisma／SQL／filesystem 細節；
- fixed status mapping：401 unauthenticated／recent session不存在、403已登入但role不足、404 object scope或不存在、
  409 stale／idempotency conflict、413 byte／row／selection cap、422 field／state validation、429 rate limit、503 auth／audit
  backend fail-closed；response使用stable error code；
- `/api/auth/reauth`只接受same-origin POST、現有ACTIVE session、password及CSRF／Origin check；成功只更新server-owned
  session-bound `RecentAuthGrant`（15分鐘），不把password、raw JTI或grant放URL／client storage。所有敏感route在server重驗
  session HMAC、tokenVersion、credentialRevision及window；account／HMAC-IP／session limiter fail closed。

## 15. 分階段實施計劃與 Checklist

### Phase 0：計劃、branch 與 implementation conformance audit

目標：凍結 clean-reset contract，確認現有候選程式哪些可保留、哪些必須重做。

- [x] 從 `codex/retrieval-first-learning-stream-v2` @ `68dfd51` 建立專用 branch。
- [x] 讀取 baseline、schema、Auth、session、teacher/admin routes、leaderboard、seed 及測試。
- [x] 確認 baseline 沒有正式 grade／class／teacher access schema。
- [x] 確認使用者授權徹底刪除本機測試資料、帳號及密碼。
- [x] 完成兩個獨立 Subagent review 並修訂本計劃。
- [x] 完成第二組兩個平行、相同全範圍Subagent第一輪review並把所有P0／P1／mandatory P2寫入Revision 3。
- [x] 同一兩位reviewer對完整Revision 3作反覆相同全範圍review；最終相同contract snapshot兩邊均PASS。
- [x] 對現有工作樹逐檔建立 keep／change／remove conformance inventory；至少覆蓋2.3六個mandatory replacements（見 `plans/artifacts/class-roster-conformance-inventory.md`）。
- [x] 凍結 canonical schema、reset topology、API DTO/error codes、import headers、export allowlist及HMAC lifecycle（見 `plans/artifacts/class-roster-contract-freeze.md`；schema/migration fresh replay及現有 reset evidence 已核對）。
- [x] 使用者確認 reviewed plan 後才進入 destructive reset／正式實作階段（goal 指示明確授權 local disposable reset；沒有延伸至 production）。

驗收：計劃 review 已整合；沒有在 plan-only 階段刪資料或改產品程式。

### Phase 1：Canonical schema、destructive local reset 與 seed

目標：以安全 expand schema 建立 canonical application contract，再從空白本地資料 seed；不做 fixture backfill。

- [x] 更新 `prisma/schema.prisma`：canonical `accountName` application field、optional `contactEmail`、status及 profiles；
  物理 legacy mapping 可保留，禁止在一般 migration drop／rename identity columns。
- [x] 新增 `AcademicYearStatus`、`EnrollmentStatus`、`AcademicYear`、`SchoolClass`、`StudentEnrollment`、
  `RosterMutationState`、`StudentYearTransition`、`TeacherClassAccess`、`RosterImportBatch`、`AdminMutationBatch`、`AdminOperationReceipt` 及
  `RosterImportBatchUserLink`／`AdminMutationBatchUserLink`（linkRole、unique batch+user、user/batch indexes、兩邊FK）、
  created-account recovery linkage、`RecentAuthGrant`。
- [x] 加入nullable canonical companion＋partial unique、identity lock／legacy conformance query、CHECK、composite FK、
  expand-safe profile-role trigger及optional email uniqueness；不以NOT VALID UNIQUE／CHECK阻舊writer；
  ACTIVE→CURRENT、PLANNED→PLANNED、ENDED→CLOSED、atomic activation及active class final-state deferred trigger；profile completeness／User.role contract trigger
  defer至production backfill／old-writer retirement plan。
- [x] 建立完整User FK/deletion inventory、audit nullable actor＋HMAC key version及student／teacher／admin hard-delete DB tests。
- [x] 建立batch all-user dependency links及hard-delete system-cancel/purge service；覆蓋target、email owner、coverage teacher、
  live/expired import、error report、mutation payload及created linkage。
- [x] 建立versioned audit HMAC secret/key-id contract；缺失時auth／audit／admin mutation fail closed。
- [x] 更新`.env.example`／local setup及production-config checker：current HMAC secret／key ID、optional old-key ring、
  staging cleanup command；只提交placeholder，不提交secret。
- [x] 新增 expand-first migration；不修改既有 checksum，不使用 `prisma db push`；物理 cleanup defer 至獨立 contract plan。
- [x] 建立 default dry-run local reset／bootstrap scripts，核對exact client/server topology entry、persisted marker及exact confirmation；
  覆蓋direct TCP、Docker mapping及Unix socket語義。
- [x] Reset 前打印安全目標摘要、marker、migration status及 aggregate；不打印密碼／完整 URL。
- [x] 徹底 reset 本地測試資料，再 fresh replay migrations。
- [x] 重寫 seed：建立新管理員、可選教師／學生 fixtures、`CURRENT` year、classes 及詞庫。
- [x] 初始密碼只一次顯示並立即 hash；不寫入 repo artifact。
- [x] 重新 generate Prisma Client。
- [x] 通過migration checksum、fresh replay、含legacy SecurityEvent／identity fixture的expand replay、raw-DB invariant tests、
  reset guard negative tests、disposable-target
  positive test、seed idempotency、migrate status。

驗收：空白 disposable database 可由 migrations + seed 完整重建；application contract canonical，普通 migration 無 destructive identity cleanup。

### Phase 2：Identity、Auth、停權及暱稱私隱

目標：建立身份欄位責任及 fail-closed session 行為。

- [x] 建立 `accountName`／`contactEmail`／`legalName` canonical validators。
- [x] Credentials login、JWT、Session、login limiter、audit subject 全部改用 accountName contract。
- [x] 建立per-session JTI＋RecentAuthGrant：fresh login initial grant、reauth、15m expiry、two-device isolation、logout／
  password／status revoke、account/IP/session limiter、CSRF/origin及backend fail-closed tests。
- [x] Login 及 JWT revalidation 拒絕 suspended account。
- [x] Student login／JWT revalidation另要求CURRENT-year ACTIVE enrollment；planned-only新生activation前fail closed。
- [x] 建立唯一`replacePasswordCredential` primitive；self／forced change、admin／teacher reset、rotation每次
  `credentialRevision+1`及`tokenVersion+1`並撤銷grants／session；create／seed初始化revision=1，merge不改密碼。
- [x] 強制首次改密碼成功後，reset UI 以新密碼透明建立 fresh session 並返回安全 callback；續接失敗有 fallback 登入頁，並清除表單內密碼記憶體；成功續接 browser smoke 已驗證。
- [x] 抽出共用安全temporary-password generator（CSPRNG、10 chars、無歧義小寫／數字 alphabet、bcrypt cost 12）及tests；教師／管理員臨時密碼畫面提供明確一鍵複製，仍只在memory顯示及首次登入強制改密碼。
- [x] 管理員manual create／edit使用profile-aware transaction、`User.revision`及各aggregate CAS；直接role conversion拒絕。
- [x] 建立nickname NFKC、grapheme、invisible、contact、profanity、reserved-name及本人legalName／account/contact exact-token validator。
- [x] 建立 nickname rate limit、profile revision CAS 及 audit。
- [x] 建立 `/api/student/profile` 及 `/profile` 頁。
- [x] Leaderboard 及 student-facing display 改為 ACTIVE STUDENT nickname-only。
- [x] 加入 PII-negative tests，證明公開 DTO 無 legalName／accountName fallback。
- [x] Nickname PATCH 後 refresh authoritative session；profile 缺失使用「同學」，不顯示 internal ID。
- [x] Suspended／revoked response停止retry並清除該account的V1 queue／checkpoint及V2 outbox／checkpoint／PII；restore不重播。

驗收：停權 session fail closed；學生可安全改 nickname；排行榜不洩露真名／學生證。

### Phase 3：學年、班級、enrollment 與教師 object-level authorization

目標：所有教師資料存取都由 server class access 決定。

- [x] 建立academic year／class list、create、edit／deactivate API；year lifecycle使用`PLANNED/CURRENT/CLOSED`，普通PATCH
  永不接受status，activation routes係唯一切換途徑。
- [x] 建立RosterMutationState全域mutex／calendar revision＋deferred reorder guard，覆蓋insert/PATCH插隊、incoming planned row、
  多PLANNED、identity/batch/user/class/profile total lock order及並發year edit。
- [x] 建立 single-current-year及 single-active-enrollment DB guards；activation 只在 Phase 6 獨立 transaction 執行。
- [x] Class deactivate guard拒絕仍有ACTIVE／PLANNED enrollment或teacher access的class。
- [x] 建立學生 assign／unassign class 及 enrollment service。
- [x] 建立`StudentYearTransition` service／revision CAS及source-target-disposition-targetEnrollment DB XOR／uniqueness tests。
- [x] 建立CURRENT＋immediate PLANNED反向completeness trigger及所有current-source writer helper；planned-first／restore／並發次序不可漏transition。
- [x] 建立 teacher class access full-replacement API 及 `accessRevision` aggregate CAS。
- [x] 建立共用 `authorizedStudentWhere`／`requireTeacherStudentAccess` helper。
- [x] 建立所有 teacher-to-student data access static inventory；重構 routes、Server Components、actions、aggregate使用同一 scope。
- [x] 對 password reset capability 做獨立檢查，不由 view 權限推斷。
- [x] Teacher student roster DTO 回傳每位學生按所屬班別計算的 `canResetStudentPassword`；無 reset capability 時教師 UI 不渲染重置按鈕，並保留 server-side fail-closed reset guard。
- [x] Teacher mutation 在寫 transaction 內重驗 actor／student status、ACTIVE enrollment、class及 capability；reset 加 recent-auth、rate limit、must-change-password及 token revoke。
- [x] 無 access 教師返回 empty roster；未授權／不存在 detail／mutation 統一 404。
- [x] 加入跨班 IDOR、偽造 classId、撤權 TOCTOU、suspended actor／student、ADMIN bypass tests。
- [x] 加入selected-year GET、PLANNED replacement preserves CURRENT／other years、concurrent current-vs-planned global
  accessRevision 409、empty-set及revision tests。

驗收：任何 teacher route 都不能越過班級及 capability 邊界。

### Phase 4：管理員名冊 UI、逐個帳號及狀態管理

目標：提供完整而不依賴 raw API 的日常管理入口。

- [x] 建立 `/admin/roster` shell、六個區段／tabs 及 workspace navigation。
- [x] 建立學年／班級設定UI：PLANNED year dates、read-only status badge、建立／停用A–H classes、planned-year access editor；
  不提供可繞過activation嘅status selector。
- [x] 建立 cursor pagination（accountName+id、50/default、100/max）、search、year／grade／class／status filters。
- [x] 建立學生／教師 desktop table 及 mobile cards。（responsive rendered QA 仍由 Phase 8 gate 驗證）
- [x] 擴充 manual create／edit：學生 profile、grade、optional class／email、random password。
- [x] 教師 manual create 後可設定 class access。
- [x] 加入逐個 suspend／reactivate、typed-confirm hard delete。
- [x] 保留 recent-auth、自刪、最後 active admin、password reset、tokenVersion guards。
- [x] 建立one-time credential dialog及typed-string XLSX memory download；關閉後不可再次讀取；教師單帳號reset沿用同一primitive。
- [x] 建立 15 分鐘 recent-auth re-entry，成功後保留 actor-bound batch／filters／selection／exclusions。
- [x] 完成 loading、empty、error、stale conflict、partial selection states。
- [x] 完成 keyboard、focus trap、screen-reader labels、簡繁及 light／dark 基線。（名冊 controls 及 shared admin modal 已有程式化 labels；browser keyboard／focus trap／focus return／live error／Chromium accessibility-tree smoke、200% reflow equivalent、locale／theme／axe smoke 通過；完整原生 keyboard／screen-reader/device matrix仍 deferred）

驗收：管理員不需命令列即可完成逐個帳號、停權、恢復、刪除及教師授權。

### Phase 5：學生／教師 CSV、XLSX 匯入

目標：提供有預覽、原子性、冪等性及一次性密碼的批量建立流程。

- [x] 鎖定 spreadsheet dependency（`exceljs@4.4.0`），執行 dependency audit 及 malicious workbook spike（`npm ls exceljs --depth=0`、`npm run check:roster-workbook`）。
- [x] 建立 versioned `student-roster-v1`／`teacher-roster-v2` CSV、XLSX templates及欄位／merge說明。
- [x] 建立 bounded CSV／XLSX parser、magic、5 MiB、500-row、100-column、cell／inflation limits。
- [x] 拒絕 formula、macro、external link、encrypted／malformed workbook。
- [x] 建立 canonical multilingual header mapping，但匯出一律使用固定 canonical headers。
- [x] Numeric XLSX account cell fail closed；CSV／XLSX leading-zero round-trip tests。
- [x] 建立 row validator：year、required、duplicate、role collision、email、nickname、grade／existing class、teacher access subset。
- [x] 建立 paginated preview、errors filter／download、30-minute TTL、file hash、canonical digest、actor binding及 cancel。
- [x] 建立逐欄 create／merge preserve／clear／replacement matrix及 field-level before／after diff。
- [x] 建立獨立 preview／commit operation IDs、fingerprints、namespaced receipts及 same-ID conflict 409。
- [x] Transaction 外 bounded password hashing（8個 worker threads，維持 bcrypt cost 12；500-row local hash benchmark 約24s）；Serializable atomic commit、snapshot CAS、retry cap／jitter。
- [x] 建立 profile、enrollment、teacher access 及 audit writes。
- [x] 建立一次性credential report、24-hour batch rotation preview／commit、credentialRevision／tokenVersion conflict exclusion、
  `ROTATE_CREDENTIALS` AdminMutationBatch＋eligible/conflict user links、linkage purge、hard-delete cancel/purge及
  「不覆蓋已改密碼」security tests。
- [x] Commit／cancel即時purge staged PII；expiry即時logical deny、可重入cleanup command、dev-start／opportunistic cleanup及
  no-store／no-log tests。
- [x] 建立 UI preview rows、原行號、errors、summary、expiry、cancel、confirm、report及 response-loss recovery。

驗收：學生／教師 CSV、XLSX 都能預覽及 commit；任何錯誤整批 rollback；重送不重複。

### Phase 6：批量轉班、全級升級、exclusions 及 lifecycle

目標：處理學期／學年日常批量操作而不破壞 enrollment 歷史。

- [x] 建立 bulk-class preview：selection、target class／unassigned、unchanged、invalid、conflict summary。
- [x] 建立canonical `AdminMutationBatch`、explicit／allMatching跨頁 selection、filter hash、excluded IDs、500 cap及「本頁／全部」UI。
- [x] 建立 bulk-class commit：opaque batch、expected revisions、operationId、Serializable transaction、audit receipt。
- [x] 建立promotion pure planner、六級mapping及高三`GRADUATE`／`REPEAT`／`HOLD_UNASSIGNED` rules。
- [x] 建立pre-existing `PLANNED` target year validation、class mapping及
  `PROMOTE/REPEAT/HOLD_UNASSIGNED/GRADUATE/LEAVE` editor。
- [x] Promotion preview 返回 eligible、dispositions、teacher coverage、unassigned、mapping conflicts及 revisions；preview 零寫入。
- [x] Promotion commit原子upsert持久`StudentYearTransition`及所需target `PLANNED`；source enrollment完全不變。
- [x] 建立 409 stale preview、idempotent retry 及 concurrent promotion protection。
- [x] 建立academic-year activation preview／commit：source、incoming、suspended、graduate／leave outcomes；year/class/enrollment、
  global roster revision、teacher User role/status/revision、profile access revision／rows及active-only view/reset coverage完整snapshot。
- [x] Activation atomically切換 source/target year及 ACTIVE/ENDED/PLANNED enrollment statuses。
- [x] 覆蓋 parser 0／1／200／500／501 CSV／XLSX、5 MiB、malicious workbook，以及 shared bulk/promotion 501 selection guard（route＋unit）；完整 rollover fixture 另覆蓋六個年級、repeat／hold、missing-class（unassigned）、incoming、suspended、graduate／leave及持久 transition shape／activation 結果。
- [x] 覆蓋500-row student import success及501-row import pre-staging reject（fresh local Playwright：preview 155/113/102/98ms、commit 21,120/20,838/21,193/21,333ms），promotion 500 success／501 pre-staging `SELECTION_CAP`，以及 explicit REPEAT／HOLD_UNASSIGNED／GRADUATE／LEAVE／incoming／suspended rollover fixture；promotion／activation payload 均通過 PII-negative assertions。
- [x] Activation另覆蓋5,000／5,001 cap、set-based transaction時間及全校atomicity；fresh isolated Playwright 5,000 fixture atomic commit passed（total 2,763ms、`Server-Timing` transaction 2,745ms），5,001 preview在staging前以`ACTIVATION_SELECTION_CAP` 422 fail closed；不可按500人分批切學年。cold/warm及RSS protocol已於Phase 8完成並低於budget。

驗收：可安全升級整級並排除個別學生；重送／並發不建立重複 enrollment。

### Phase 7：CSV／XLSX 當前名單匯出

目標：按目前資料匯出可選欄位，並避免資料及 formula injection 洩漏。

- [x] 建立 entity／filter／field hard allowlist contract。
- [x] 建立全部filtered result export、selected academic-year join、preview count及download內REPEATABLE READ `cap+1` query。
- [x] 建立 CSV UTF-8 BOM、RFC 4180 writer。
- [x] 建立XLSX全typed-string writer，accountName保持text、值不加apostrophe。
- [x] 建立CSV formula-injection sanitizer、危險自由文字非exact round-trip文件及adversarial tests。
- [x] 明確排除 passwordHash、temporary password、tokenVersion、session、audit internal fields。
- [x] 建立 recent-auth、rate limit、row cap、no-store、audit summary。
- [x] 建立 UI format、ordered field selector、至少一欄、default fields、filter／row summary及 download errors。
- [x] CSV安全representation／XLSX exact-value round-trip測試leading zero、中文、optional email、status、selected-year enrollment及
  deterministic class access。

驗收：匯出資料可重新讀取，前置零不丟失，沒有 secret 或可執行公式。

### Phase 8：整合驗證、操作文件及 local handoff

目標：證明新 roster 系統沒有破壞 V2 學習、角色導向或安全邊界。

- [x] `npm test`
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm run test:db`
- [x] `npm run test:db:stream-v2`
- [x] roster object-access DB integration suite
- [x] `npm run test:migrations`
- [x] `npm run test:migrations:contract`（獨立 disposable schema；expand／contract replay、checksum及ledger contract quiet-window regression passed）
- [x] `npm run test:migration-checksums`
- [x] reset guard wrong host／port／database／schema／role／marker／confirmation／runtime-fallback negative tests，
  以及新建 disposable target positive test、seed idempotency
- [x] `npm run test:e2e:workspace`
- [x] `npm run test:e2e:student-ia`（按 suite contract 明確設定 V1／V2 mode）
- [x] `npm run test:e2e:student-qa`（明確 `STUDY_V2_ASSIGNMENT_MODE=off`；21 passed／1 skipped）
- [x] `npm run test:e2e:study-stream-v2`
- [ ] `npm run check:production-config`（local 預期 fail：未提供 production-only Upstash／CRON／HMAC secrets；positive production config 未獲授權）
- [x] `npm run test:e2e:admin-roster`（local wrapper：4 passed；login／recent-auth／student import／credential response／hard-delete smoke、active V2 assignment／suspension fail-closed、explicit rollover dispositions/incoming/suspended activation、responsive locale/theme keyboard/focus/axe smoke；500-row及5,000／5,001 scale tests由fresh-DB isolated command執行）
- [x] 新增 admin year/class → import → credential-loss rotation → teacher access → cross-page bulk → promotion →
  activation → export 完整 Playwright E2E（local wrapper 4 passed；另 isolated fresh 500-row import／501 reject、promotion 500／501 boundary、activation 5,000 atomic commit／5,001 pre-staging reject 各通過；含 explicit repeat／hold／graduate／leave、incoming、suspended rollover、student V2 active/suspended API smoke、390px mobile及320/tablet/desktop locale/theme axe matrix）
- [x] 新增 student profile、teacher IDOR／撤權 TOCTOU、teacher reset password及一次性 credential E2E（同一套
  disposable-admin flow；profile CAS／privacy、suspended fail-closed、teacher scope／撤權及 reset 均通過）
- [x] 完整登入、停權 active V2 session／outbox、恢復、must-change-password smoke（disposable Playwright flow 覆蓋 active V2 assignment／stream、停權後 reload 導向 login、V1/V2 local state 清除、恢復後重新建立 V2 checkpoint、不重播舊 outbox，以及教師重設學生密碼後學生 must-change-password 導向；仍不替代完整原生 device／screen-reader matrix）
- [x] Local a11y gate：axe serious/critical=0、keyboard-only、focus trap/return、live-region summary、錯誤不只靠顏色、
  200% zoom/reflow equivalent、light/dark contrast、zh-Hans/Hant 文案及 Chromium accessibility-tree smoke（標準 admin roster browser matrix 及 shared modal smoke 已通過；完整原生 screen-reader/device matrix仍 deferred）
- [x] 320px mobile、tablet、desktop、light／dark、zh-Hans／zh-Hant rendered browser matrix（overflow、heading、locale/theme、axe；完整原生 device／reader matrix保持 deferred）
- [x] 0／1／200／500／501-row CSV、XLSX；5 MiB 邊界及 malicious workbook spike（parser tests 9 passed）；500-row import fresh cold/warm smoke通過（preview 155/113/102/98ms、commit 21,120/20,838/21,193/21,333ms、transaction median 815.25ms、RSS peak 1.13MiB）；activation 5,000 atomic scale通過（total 2,763ms、transaction 2,745ms、RSS 0MiB），5,001 cap route smoke通過；5,000-row export fresh cold/warm通過（preview 249ms、四次 total 190/183/160/157ms、transaction 173/171/148/146ms、RSS peak 63.72MiB）。
- [x] 固定performance fixture／command／測量邊界：同一 fresh-seeded disposable DB；500-row import 以第 1 次 cold、其後 3 次 warm 取 median；5,000-row export 同一 activation fixture 以第 1 次 cold、其後 3 次 warm 取 median；preview 由 request 開始至 response 完成、commit 分別量 total／`Server-Timing` transaction、export 量 response 完成；Playwright worker 每 100ms sample process RSS，以每次 operation baseline 差值計 peak。測試命令為 `npx playwright test --project=admin-roster -g "imports 500 rows|activation completes 5,000|activation rejects 5,001"`，只在 exact-guarded fresh local reset 後執行。
- [x] 參考本機 budget：500-row preview ≤5s、總 commit ≤90s、DB transaction ≤10s；fresh measured run cold/warm preview 155/113/102/98ms（median 107.5ms）、commit 21,120/20,838/21,193/21,333ms（median 21,156.5ms）、transaction median 815.25ms、RSS peak delta ≤1.13MiB。5,000-row export ≤10s（latest run preview 249ms、total 190/183/160/157ms、transaction 173/171/148/146ms、RSS peak delta 63.72MiB）；5,000-student activation transaction ≤10s（total 2,763ms、transaction 2,745ms、RSS delta 0MiB）；所有 measured peak process memory increase ≤256MiB；未達時降低 cap 而非延長 transaction。
- [x] Surface-specific evidence scan：`npm run check:roster-pii` 通過（terminal staging／mutation payload、SecurityEvent／receipt
  credential fields、non-bcrypt hash rows均為0；當前 text test artifacts 3 files／0 findings）；canonical User/Profile/Enrollment DB及
  授權admin UI可按contract含PII，唔作錯誤的「全DB無PII」斷言。掃描明確排除保留作歷史視覺QA參考、只含source locator嘅 `.playwright-cli` captures；
  password hash以外任何plaintext credential不得出現DB／audit／logs／metrics／test artifacts，public/student screenshots不得含
  legalName／accountName／email，授權admin screenshot只准fixture且禁止 credential capture。Auth／limiter pseudonym只用versioned HMAC及coarse aggregate dimensions。
- [x] Staging purge evidence分開驗：COMMITTED／CANCELLED同transaction即時physical zero；剛EXPIRED先驗logical deny且允許
  physical row暫存，再顯式跑可重入cleanup並驗DB staged PII zero；不聲稱app關閉時wall-clock瞬間purge。
- [x] 更新 `plans/README.md`、`plans/project-plan.md`、local reset／seed／import template 操作文件
- [x] 記錄未執行項目及已知限制；不冒充 production 已完成

驗收：所有必要自動及 browser tests 通過；local runbook 可由另一位開發者重現。

### Post-review follow-up：CI-01 dependency audit 與 functional gate

背景：`codex/class-roster-import-and-access-control` 的最新 review 確認 seed 修正已關閉重複測試學號問題，
但 `npm audit --omit=dev --audit-level=high` 會因 `prisma@7.9.1 → @prisma/config@7.9.1 → deepmerge-ts@7.1.5`
的 high advisory 先行失敗，令 seed、migration、build 及 browser regression 未有最新 head 實證。Registry 提供的
自動修復方案係退回 Prisma `6.12.0`，不符合目前 Prisma 7／adapter contract；`deepmerge-ts` 8.x 亦未有 Prisma
兼容證據，故不作 downgrade 或 override。

目標：保留 dependency audit 的 fail-closed 安全訊號，同時令功能驗證 job 不受該 audit advisory 的 job-level
failure 阻擋；production deploy workflow 的 audit gate 不在本 follow-up 放寬。

- [x] 將 study/card-motion quality workflow 的 dependency audit 拆成獨立 job，與 functional-quality job 並行。
- [x] 保留 audit job 失敗語義；不使用 `|| true`、廣泛 advisory allowlist、Prisma major downgrade 或 transitive override。
- [x] 在最新工作樹執行 functional-quality 對應的 unit、lint、typecheck、migration、seed、build／browser 驗證，並記錄任何未執行項目。

實際結果：`npm audit --omit=dev --audit-level=high` 仍會因 Prisma 7.9.1 依賴鏈的
`deepmerge-ts@7.1.5` advisory fail；registry 提供的 Prisma 6.12.0 自動修復不符合現行 Prisma 7／adapter
contract，故沒有 downgrade、override 或 allowlist。`.github/workflows/card-motion.yml` 現在由獨立
`dependency-audit` job 保留該 fail-closed 訊號，而 `study-quality` 不再被 job-level audit failure skip。
本地 follow-up 已完成 `npm test`（211 passed）、lint、typecheck、49-migration checksum／fresh／contract
replay、guarded local reset／seed、build、admin roster E2E（4 passed）及 clean role/workspace E2E（5 passed）。
完整 cross-browser card-motion、student IA／QA suite 沒有因本次 admin/API／workflow follow-up 重跑；既有
Phase 8 evidence 保留，production config positive gate、production deploy、真實學生資料及 destructive
contract cleanup 仍 deferred。

驗收：audit advisory 仍會令 audit job fail，但不會令 functional-quality job skipped；functional-quality 可獨立提供
seed、migration、build 及 browser regression 結果。production-only config、production deploy、真實學生資料及
destructive contract cleanup 仍屬本計劃外／deferred。

## 16. 測試矩陣

| 範圍 | 必要案例 |
|---|---|
| Reset／migration | wrong client/server topology／schema／role／marker／confirmation／fallback、TCP／Docker／Unix socket entries、disposable positive target、legacy identity＋SecurityEvent expand fixture、fresh replay、checksum、draft-migration disposition、seed twice |
| Identity | leading zero account、leading hyphen reject、case／trim、optional email unique、role locked、profile relation、User/profile/enrollment CAS |
| Auth／status | current-enrolled active login、planned-only PRE_ENROLLED deny→activation allow、suspended login、active session invalidation、restore、tokenVersion、mustChangePassword、forced-reset fresh-session continuation／safe callback／fallback、password credential writer matrix |
| Recent auth／CSRF | fresh-login grant、15m expiry、two-device isolation、wrong/missing sessionJti HMAC、logout、password/status/tokenVersion/credentialRevision revoke、account/IP/session limiter、reauth及admin/student/teacher cross-site mutation reject、GET無副作用、backend fail-closed |
| Nickname | NFKC、graphemes、zero-width、bidi、contact、reserved、legalName/account exact-token、legalName-after-nickname conflict、粵／中／英粗口、rate limit、CAS |
| Privacy | leaderboard／session／achievement／error／export 無 legalName／account fallback |
| Class model | six grades、A–H、year overlap reject、PLANNED insert/date-PATCH/concurrent插隊reject、single current／active enrollment、ACTIVE→CURRENT、PLANNED→PLANNED、ENDED→CLOSED、raw INSERT ENDED到CURRENT/PLANNED及單獨ACTIVE→ENDED拒絕、完整atomic activation final state容許、CLOSED class/enrollment/access mutation reject、direct status PATCH reject、deactivation guard |
| Year transition | source-target unique、multi-PLANNED isolation、CURRENT＋PLANNED雙向completeness、planned-first→current create／merge、PROMOTE next-grade／REPEAT same-grade-assigned／HOLD same-grade-unassigned互斥推導、activation target grade/class immutable snapshot、activated HOLD後可分班／current grade correction不改歷史、planned-only suspend→PRE_ENROLLED restore／explicit current補transition、raw/concurrent writer order、PRE_ACTIVATION nonterminal link required／terminal target-year row forbidden、terminal↔nonterminal edit、revision CAS、ACTIVATED nonterminal下一輪target ACTIVE/CURRENT→ENDED/CLOSED、terminal restore unlinked MANUAL、history retained |
| Teacher access | CURRENT auth scope、GET selected-year DTO、PLANNED replacement preserves CURRENT/other/CLOSED、current-vs-planned global revision 409、active-class raw/concurrent invariant、assigned、unassigned、多班、多教師、zero-row empty set、撤權 TOCTOU、ADMIN bypass、IDOR、reset capability |
| Student import | selected year、CSV／XLSX、numeric account reject、leading zero、existing-enrollment grade-change＋blank error、missing CURRENT／PLANNED enrollment＋blank→unassigned及雙向transition推導、field matrix、diff、hash期間cancel／expire／second-commit race、atomicity、fingerprint、idempotency |
| Teacher import | canonical class keys、reset subset、unknown class、pair matrix blank／clear／replacement、accessRevision CAS |
| Password | 10-char unambiguous lowercase/digit CSPRNG、bcrypt12、all-writer credentialRevision matrix、bounded hashing、hash only、one-time response、teacher/admin copy action、forced-reset fresh-session continuation／fallback、typed-XLSX adversarial legalName、response loss、rotation excludes changed revisions、ROTATE batch user links、hard-delete live/expired rotation preview→old GET/commit deny＋staged zero、session revoke、artifact scan |
| Bulk class | CURRENT-only、canonical AdminMutationBatch、explicit／allMatching cross-page selection、filter hash、exclusions、unassign、PRE_ACTIVATION PLANNED HOLD普通assign拒絕、ACTIVATED HOLD轉成CURRENT後bulk assign容許且不改歷史snapshot、transition revision stale、retry、500／501 students |
| Promotion／activation | J1→J2、J3→S1、S3 graduate/repeat/hold、promote/repeat/hold/leave、incoming、suspended student stays suspended、teacher coverage只計ACTIVE TEACHER＋profile＋target active-class capability、preview前suspended teacher不計、preview後ACTIVE→SUSPENDED或restore／access change令commit 409並須re-preview、class/access/coverage stale、planned-only、atomic activation、concurrency |
| Suspension／delete | student restore with／without current enrollment、terminal activation→independent MANUAL restore、target/email-owner/coverage-teacher hard-delete during import/error-report/promotion/activation/rotation preview、old batch GET/commit deny＋staged zero、promotion/activation/import commit×actor/dependency delete total-lock concurrency、raw NOWAIT 40001 bounded retry、teacher、self guard、last admin、complete FK inventory/cascade、audit actor SetNull/HMAC、recreate same account |
| Export | preview count vs authoritative cap+1 snapshot、selected-year join、zero-access teacher、column order/default、5,000/5,001 cap、ISO UTC、Unicode、leading zero、CSV neutralization、XLSX typed exact value、no secrets |
| UI／a11y | cursor pagination、desktop／mobile、dialogs、focus、keyboard、live region、axe、zoom、screen-reader smoke、locale、theme |
| Regression | V2 study、teacher/admin redirects、password reset、leaderboard、login／resume |

## 17. 風險與緩解

| ID | 風險 | 程度 | 緩解 |
|---|---|---:|---|
| R1 | Reset 指錯資料庫 | 極高 | exact client/server topology entry、persisted marker、exact confirmation、dry-run default、no runtime fallback |
| R2 | 教師靠 client filter 越權 | 極高 | 單一 server scope helper、route-level checks、IDOR tests |
| R3 | 真名／學生證經公開 DTO 洩漏 | 高 | profile separation、nickname-only DTO、PII-negative tests |
| R4 | 停權只阻新登入，舊 JWT 仍有效 | 高 | status revalidation + tokenVersion revoke + active-session test |
| R5 | 匯入部分成功 | 高 | staged preview + Serializable atomic commit + operation receipt |
| R6 | 明文初始密碼遺失／被保存 | 高 | transaction 外 bounded hash、one-time response、audited rotation recovery、artifact-negative tests |
| R7 | XLSX zip bomb／formula／external link | 高 | byte／row／cell／inflation caps、公式及外部內容 fail closed |
| R8 | CSV／XLSX formula injection | 高 | CSV neutralization、XLSX typed strings、明確安全representation contract及adversarial tests |
| R9 | Promotion／學年切換造成 enrollment 或教師權限斷層 | 高 | PLANNED enrollment、明確 disposition、coverage preview、atomic activation |
| R10 | Role change 破壞 profile | 高 | 建立後 role locked；需要新角色便新建帳號 |
| R11 | 大名單拖垮 UI／DB | 中 | cursor pagination、500 import cap、hash outside transaction、具體 performance budget |
| R12 | Nickname filter 過度／不足 | 中 | deterministic rules、清楚錯誤、版本化 denylist、管理員修正入口 |
| R13 | Hard delete 被當作一般離校 | 高 | suspend default、single-only delete、typed confirm、recent auth、無 bulk delete |
| R14 | Candidate code 與 reviewed plan 不一致 | 高 | Phase 0 conformance inventory；逐項驗證後才勾 checklist |

## 18. 依賴與實施次序

```text
Phase 0 reviewed contract
        ↓
Phase 1 canonical schema + local reset + seed
        ↓
Phase 2 identity/auth/privacy ───────┐
        ↓                           │
Phase 3 class/enrollment/access     │
        ↓                           │
Phase 4 admin roster UI             │
        ↓                           │
Phase 5 imports                     │
        ↓                           │
Phase 6 bulk/promotion              │
        ↓                           │
Phase 7 exports                     │
        └──────────────┬────────────┘
                       ↓
               Phase 8 integrated QA
```

Phase 1 是所有產品實作的硬依賴；Phase 2、3 完成前不可把 roster UI 視為安全。Import、bulk、export
共用 canonical identity、class service、recent auth、audit 及 operation receipt，不應各自重寫。

## 19. Local rollout、rollback 與資料恢復

- 開發只在本 branch 及本地 database 進行。
- Reset 後舊測試資料不設恢復路徑；需要資料時重新 seed。
- 每個 Phase 合併前執行相應 tests；Phase 8 前保持 production deploy 禁止。
- 如 UI 出問題，可先移除 workspace navigation，但 teacher server authorization 不可 fallback 為全校可見。
- Migration 一經任何共享／保留 DB 套用便不可修改，只能追加 forward corrective migration；只有尚未被任何
  需保留環境套用的本地 draft 才可重寫。不可用 `db push` 掩蓋 checksum drift。
- Local app rollback 如需要舊 binary，切回舊 commit並使用另一個 exact-allowlisted disposable DB fresh replay／seed；
  不讓舊 binary 讀取不兼容的新 schema。
- 如 import／promotion commit 出問題，停用相應 mutation route，保留 preview／read-only roster；由 reset／seed 恢復測試資料。
- 真正進入 production 前必須另開 production migration／backup／rollback 計劃；本地「可刪全部資料」決定不可沿用。

## 20. Definition of Done

- [x] Revision 3已獲兩個平行、相同全範圍Subagent對相同最終contract snapshot各自PASS。
- [x] 使用者接受本計劃並明確批准開始實作／本地destructive reset。
- [x] 本地 DB 可安全 reset；exact-target／marker／confirmation guards 有 negative tests，positive test 只用 disposable target。
- [x] Application identity schema canonical；無舊帳號 backfill／雙寫；一般 migration expand-first，物理 legacy cleanup 未被誤放入自動 migration。
- [x] 新帳號以 accountName 登入；contactEmail optional 且不參與找回密碼。
- [x] legalName／nickname 完全分離；學生公開 surface 無真名／學生證 fallback。
- [x] 六年級、A–H班、只經activation切換的學年UI、PLANNED／ACTIVE／ENDED enrollment及optional class可用；browser years tab 以6 grade／8 class options驗證，raw DB invariant suite驗證三態及atomic activation final-state guard。
- [x] Teacher access full replacement 有 aggregate CAS；所有資料及密碼重設均在 transaction 內限制於獲授權班級／capability。
- [x] Session-bound RecentAuthGrant在fresh login／reauth、two-device isolation、expiry、logout及credential/status revoke均fail closed。
- [x] 首次強制改密碼後不要求學生再次手動登入：舊 session 仍被撤銷，reset UI 只以新密碼建立 fresh session；安全 callback、成功續接 browser smoke、續接失敗 fallback 及清除表單密碼行為均已落實。
- [x] 學生可安全修改 nickname；moderation、rate limit、CAS、audit 完整。
- [x] 管理員可逐個及批量建立學生／教師、設定班級access、取得一次性密碼；response loss只rotate credential snapshot
  仍eligible的帳號，絕不覆蓋已自行改／另行reset密碼。
- [x] CSV／XLSX 匯入有 versioned templates、selected year、field matrix／diff、paginated preview、PII purge、atomic commit、fingerprint及 idempotency。
- [x] Merge對missing selected-year enrollment以blank class建立unassigned，existing enrollment blank先係preserve；current↔planned兩方向transition推導有具名tests。
- [x] 跨頁批量轉班、promotion及activation共用canonical `AdminMutationBatch`；stale filter／year／class／enrollment／
  teacher access／coverage revision fail closed。
- [x] 全級升級建立持久、PROMOTE／assigned-REPEAT／unassigned-HOLD互斥year transitions及planned enrollments；獨立activation atomic切換全年級及學年，包含incoming、repeaters、graduates／leavers、suspended學生保持suspended；explicit rollover Playwright fixture逐一斷言transition disposition、target link及activation後enrollment/status，teacher coverage仍只計ACTIVE教師有效target-class capability，status／access stale由既有route／auth tests驗證。
- [x] 管理員可 suspend／restore 學生或教師；active V2 local state 清除；single hard delete 有 audit／FK安全 guards。
- [x] CSV／XLSX 匯出全部 filtered rows、selected-year data及 ordered fields，保留前置零、無 secret／formula injection、超 cap 不截斷。
- [x] Migration、unit、DB、auth、workspace、roster E2E、student IA、build 全部通過。
- [x] 500-row import、5,000-row export及具體 time／memory budget 通過（fresh measured cold/warm protocol及 RSS evidence 已記錄於 Phase 8）。
- [x] Mobile／desktop、雙 locale、雙 theme、keyboard、axe及本地 Chromium accessibility-tree smoke 已驗證；完整原生 screen-reader/device 矩陣明確 deferred。
- [x] 計劃、索引、local reset／seed／import 文件及實際測試紀錄同步完成。
- [x] 沒有 production、push、deploy，亦沒有在 `english_dev/public` 套用 destructive contract migration；contract migration regression 只於獨立 disposable schema 執行。

## 21. 已凍結產品決定

| 決定 | 結論 |
|---|---|
| 舊本地資料 | 全部可刪，不 backfill、不保留舊密碼 |
| 帳號欄 | Application field `accountName`；學生證按字串保存；物理舊欄 mapping可暫留至獨立 contract migration |
| 聯絡 email | Optional，只保存；本期不做驗證／找回密碼 |
| 真名 | 學生／教師 profile 必填；只對本人、授權教師、管理員可見 |
| 暱稱 | 學生必填、可自行修改、不要求唯一、公開 surface 唯一顯示身份 |
| 年級 | 六個固定 enum；學生匯入必填 |
| 班別 | 甲至辛；optional；不必八班全部存在 |
| 教師權限 | 目前已實作baseline為per-class view／reset；future target已由後續教師工作台計劃凍結為default-false教師級global reset AND per-class view scope，並已在本分支開始實作但尚未完成驗證；cutover前以per-class physical model為準 |
| Role change | 建立後鎖定，不直接轉換 profile 角色 |
| 離校／離職 | 預設 suspend；single hard delete 仍保留 |
| Bulk delete | 不提供 |
| Promotion | 持久StudentYearTransition＋所需target PLANNED；每人明確PROMOTE／REPEAT／HOLD_UNASSIGNED／GRADUATE／LEAVE；S3不可PROMOTE；另行atomic activation |
| Teacher access rollover | 可預先設定 PLANNED year；activation 顯示 coverage並要求逐班 acknowledge缺口 |
| 匯入學年 | Preview 必須明確選 CURRENT／PLANNED year；不自動建立 year／class |
| 匯入模式 | create-only／merge-existing；field matrix定義 blank／clear／replacement；不以檔案缺席代表刪除 |
| 匯入上限 | 每批 500 rows；501 fail closed；密碼 hash在 DB transaction 外 bounded進行 |
| 明文密碼 | Commit只一次返回；receipt不保存；24小時rotation只處理credential revision仍匹配的帳號，不覆蓋新密碼 |
| Bulk selection | bulk class／promotion／activation用canonical AdminMutationBatch；explicit／allMatching＋filters＋exclusions actor-bound staging |
| 匯出 | 全部filtered rows、selected year、ordered allowlist、download snapshot cap+1 fail-closed、CSV neutralize／XLSX typed strings、無secrets |
| Migration | 普通 migration expand-first；本地可 reset不等於可製作 production-destructive migration |

## 22. Subagent Review 記錄

### 22.1 Review A：資料模型／migration／security

獨立 reviewer 全程只讀，提出 2 項 P0、11 項 P1、4 項 P2。兩項 P0 均採納：

1. 本地資料可刪不應轉化成會自動跑到其他環境的 destructive migration；普通 migration 改為
   expand-first，物理 rename／drop defer 至另行批准 contract plan。
2. Reset guard 由模糊localhost／development flags提升為dry-run default、checked-in topology、persisted
   environment marker、exact target confirmation及disposable positive test；Revision 3再區分client endpoint與
   server-observed tuple，支援Docker mapping／Unix socket。

其他已採納修訂：DB partial unique／CHECK／composite FK／deferrable profile triggers、teacher `accessRevision`、
teacher mutation transaction內重驗、namespaced operation fingerprints、merge snapshot CAS、transaction外 bounded bcrypt、
staged PII purge、credential response-loss rotation、HMAC audit pseudonym、hard-delete FK matrix、immutable migration rollback規則、
teacher data-access inventory及 exact audit events。

### 22.2 Review B：產品流程／import-export／QA／a11y

獨立 reviewer 全程只讀，提出 1 項 P0、14 項 P1、6 項 P2。P0 已採納：promotion 不再提前結束 source
enrollment；改為 planned dispositions + 獨立 atomic academic-year activation，並加入 repeaters及 teacher coverage gate。

其他已採納修訂：學年／班級管理 UI、import明確 year、create／merge field matrix、stable teacher access keys、
numeric XLSX account fail closed、credential-loss recovery、跨頁 selection batch、preview pagination／TTL／cancel、export
全部 filtered result／ordered fields、nickname session refresh／safe fallback、teacher reset workflow、active-study suspension、
逐個 status scope澄清、cursor pagination、template version、recent-auth state preservation及具體 local a11y／performance gates。

### 22.3 未直接採納／調整後採納

- Reviewer 建議考慮延後 `contactEmail`；因使用者明確要求保留此欄，本計劃保留，但標示未驗證、最小可見、
  export預設不選及提供清空／刪除規則。
- Reviewer以原草稿 2,000-row cap要求測試；為避免 bcrypt長 transaction／背景 job擴 scope，本計劃把每批上限
  降為500（仍覆蓋使用者200人例子），加500／501及具體time／memory budget。
- 完整原生 mobile／screen-reader matrix仍屬 baseline deferred gate；本計劃只要求可重現的local axe、keyboard、
  zoom、contrast及一組screen-reader smoke，唔會冒充外部完整驗收。
- 未採用「直接 destructive physical rename」；保留物理 mapping係較少工作兼較安全，完全符合「不為舊fixtures
  做backfill」的使用者決定。

### 22.4 第二組相同全範圍平行 review：第一輪

按使用者要求，Hume及Bernoulli收到完全相同prompt，各自完整閱讀AGENTS、baseline、project plan、索引、整份本計劃
及相關候選程式；兩者都覆蓋data model、migration/reset、auth/privacy、import/export、bulk/promotion/activation、UI/a11y、
API、testing、rollout及DoD，沒有拆分範圍。

- Hume：`CHANGES_REQUIRED`；2 P0、10 P1、10 P2。P0為缺少canonical AdminMutationBatch，以及ACTIVE／PLANNED
  enrollment與CURRENT／PLANNED year、active class不變量可被繞過。
- Bernoulli：`CHANGES_REQUIRED`；0 P0、11 P1、8 P2。必改包括year status bypass、class deactivate guard、S3／suspended
  lifecycle、password rotation覆蓋較新密碼、完整deletion matrix、candidate migration disposition及CSV／XLSX contract。

Revision 3已逐項整合兩份finding：加入AdminMutationBatch、year transition table及deferred final-state trigger；activation完整
snapshot；graduate／leave／incoming／suspended outcome；credentialRevision保護；class deactivate及restore guard；完整FK/audit/HMAC
lifecycle；reset topology；import pair/header/error contract；export snapshot／typed-string contract；fixed API/error/recent-auth contract；
可重入staging cleanup、performance protocol及擴充negative evidence scan。

### 22.5 第二組相同全範圍平行 review：第二輪

兩位reviewer在每次contract修訂後都收到相同prompt並重新由頭至尾審查完整計劃，沒有拆分範圍。反覆review期間
再閉合的主要contract包括：持久`StudentYearTransition`及兩態lifecycle、activation immutable grade／class snapshots、
CURRENT＋PLANNED雙向transition completeness、session-bound recent auth、selected-year teacher access replacement、
identity／SecurityEvent expand migration、import merge semantics、staged PII hard-delete linkage、全域lock order、
ACTIVE-only teacher coverage snapshot／CAS，以及Enrollment三態與atomic activation DB invariant。

最終兩位均審查同一個1,410行contract snapshot，SHA-256
`458759928e4f51c2f535ad7e7df5f434ee87c54d96add0335a5c63e2ac50a245`：

- Hume：`PASS`；P0=0、P1=0、實作前mandatory P2=0；
- Bernoulli：`PASS`；P0=0、P1=0、實作前mandatory P2=0。

其後只更新狀態、review記錄及索引，沒有改動已review的normative contract。計劃review已關閉；已按使用者批准完成
Phase 0 inventory、local disposable reset、forward migrations及本地 implementation／verification。現階段只保留
production contract rollout、缺少 production-only secrets 的 production config positive gate 及完整原生 screen-reader／device matrix 為 deferred；contract migration regression 已於獨立 disposable schema 通過。

## 23. 進度紀錄

| 日期 | 階段 | 結果 |
|---|---|---|
| 2026-08-15 | Baseline audit | 確認 baseline 有三角色但沒有正式班級、enrollment、教師班級權限或名冊工作流 |
| 2026-08-15 | Branch | 從 V2 branch @ `68dfd51` 建立 `codex/class-roster-import-and-access-control` |
| 2026-08-15 | Data decision | 使用者明確授權徹底刪除本機測試資料、帳號及密碼；不需要 legacy backfill／兼容成本 |
| 2026-08-15 | Revision 2 draft | 重寫 canonical schema、guarded reset、八 Phase checklist、test matrix、risk、rollback 及 DoD；未執行資料刪除 |
| 2026-08-15 | Independent reviews | Review A（data/security）及 Review B（product/QA）均只讀完成；共3項P0全部採納並修訂 |
| 2026-08-15 | Same-scope review round 1 | 兩位reviewer均完整審查同一範圍並要求修訂；所有P0／P1／mandatory P2已寫入Revision 3 |
| 2026-08-15 | Revision 3 repeated same-scope review | Hume及Bernoulli對相同最終contract snapshot均PASS；P0／P1／mandatory P2全為0；未執行資料reset或產品實作 |
| 2026-08-15 | Local implementation | Canonical schema、49 normal migrations（最後加入 teacher global reset capability、typed teacher-reset audit、closed-year access-history guard及closed-year INSERT guard）、guarded reset／seed、identity/auth/privacy、class/enrollment/transition invariants、teacher access、import／bulk／promotion／activation／export routes及admin roster UI完成；credential batch改用8個bounded worker threads維持bcrypt cost 12；沒有執行production、push、deploy，亦沒有在 development／production target 套用 contract migration |
| 2026-08-15 | Local verification | `npm test` 173 passed；lint、typecheck、Prisma validate、49-migration fresh replay、checksum、reset guards、roster access/invariants/lifecycle/auth、既有 DB／stream checks、build、fresh default admin roster smoke 4 passed（scale fixture由wrapper明確隔離，新增 explicit rollover disposition fixture）；fresh isolated 500-row import／501 reject E2E、promotion 500／501 boundary E2E、activation 5,000 atomic＋export E2E及5,001 pre-staging cap均通過；最新 measured 500-row import cold/warm preview 155/113/102/98ms、commit 21,120/20,838/21,193/21,333ms、transaction median 815.25ms、RSS peak 1.13MiB；5,000 activation total 2,763ms、transaction 2,745ms、RSS 0MiB；export preview 249ms、四次 total 190/183/160/157ms、transaction 173/171/148/146ms、RSS peak 63.72MiB；promotion／activation workflow另通過 mutation payload PII-negative assertions；`check:roster-pii` terminal staging／credential surface scan通過；credential worker hash correctness unit 2 passed；workspace 2 passed、student IA 24 passed／2 skipped、V2 7 passed；roster parser edge tests 9 passed、bulk 501 cap、activation 5,000 cap unit及malicious workbook spike passed；rollover smoke 另驗證六年級 transition、停權後 V1/V2 local state cleanup、恢復後不重播及 teacher-reset student must-change redirect |
| 2026-08-15 | V1 regression mode correction | `test:e2e:student-qa` 固定 `STUDY_V2_ASSIGNMENT_MODE=off` 後 21 passed／1 skipped；避免 `.env.local` 的 local-all 設定污染 V1 fidelity suite |
| 2026-08-15 | Contract regression | `npm run test:migrations:contract` 於獨立 disposable schema 通過：49 normal migrations replay、checksum／ledger quiet-window audit、兩個 contract migrations apply及no-pending replay均通過；未改動 `english_dev/public`、production或部署狀態 |
| 2026-08-15 | Deferred gates | production-config positive secrets／Upstash（local check 明確 fail closed）及完整原生 screen-reader／device matrix仍未執行；500-row import、explicit rollover、5,000-row export／activation 已以 fresh local cold/warm＋100ms worker-RSS protocol通過 budget；surface-specific PII scan、parser／bulk／activation cap boundary及browser axe/keyboard/accessibility-tree matrix均有證據，仍不冒充 release gate完成 |
| 2026-08-15 | Teacher reset UI permission correction | Teacher student roster response now includes per-class `canResetStudentPassword`; reset control is omitted when a teacher can view but cannot reset; admin-roster E2E adds the no-reset capability assertion; lint、typecheck及build通過 |
| 2026-08-16 | Student status action correction | 學生名冊的停權／恢復由純文字樣式改為明確可操作、可聚焦及有 busy guard 的按鈕；成功後即時更新列表並保留 server refresh。新增 mobile roster E2E 驗證停權、恢復及資料庫狀態；`npm test` 166 passed、lint、typecheck、build及focused admin-roster browser test通過 |
| 2026-08-16 | Teacher workspace redesign plan | `teacher-workspace-roster-progress-redesign.md` Revision 3 經兩個獨立相同全範圍 review 及修訂後定稿；名冊／進度分家、學生詳情、server搜尋／篩選／分頁、班級洞察，以及 default-false 教師級 reset capability AND CURRENT class scope 已落實。 |
| 2026-08-16 | Teacher workspace local verification | fresh local 49-migration replay／reseed後，`npm test` 173 passed、lint／typecheck／build及`npm run test:e2e:admin-roster` 4 passed；activation closed-year teacher access history及closed INSERT guard亦由新forward migrations驗證；production positive config、full-scale及native screen-reader／device matrix仍 deferred。 |
| 2026-08-16 | Temporary password usability | 臨時密碼改為10位易讀小寫／數字 CSPRNG 字串（排除易混淆字元），一般自訂密碼政策不變；教師名冊／學生詳情及管理員單個建立帳號均加入一鍵複製，仍維持一次性 memory-only response、首次登入強制改密碼。 |
| 2026-08-17 | Review follow-up／CI-01 functional gate | 確認 `deepmerge-ts` advisory 係 Prisma 7.9.1 transitive dependency；保留 audit fail-closed，將 card-motion workflow audit 拆成獨立 job，沒有 downgrade／override。補上 canonical admin directory POST 的 `enrollmentStatus` projection、按現行 locale／teacher workspace contract 修正 admin／role E2E selectors，並將 reset guard migration count 改為按 checked-in migrations 動態計算；exact local `english_dev/public` reset＋49 migration replay＋seed 後，student-test／WebKit fixture 學號 9001／9002、admin roster 4 passed、role/workspace 5 passed。 |

## 24. 實際執行紀錄與限制

- Local destructive reset 只針對 exact allowlisted `english_dev/public`，執行前後均通過 topology／marker／confirmation guard；reset script 的 quoted mixed-case relation probe 已修正，dry-run 現可正確顯示 `marker=development`、`migrationCount=49` 及 user aggregate。
- 49 個 normal migrations 已在 fresh disposable schema replay；`npx prisma migrate status`、`npm run test:migration-checksums` 均通過。reset guard 已由 hard-coded count 改為按 checked-in migration directories 動態計數，避免下一個 forward migration 令 guard stale。沒有修改既有 migration checksum，沒有執行 `npm run db:contract`。
- `npm run check:production-config` 在本機預期以 exit 1 fail，原因是未配置 production-only Upstash、CRON_SECRET 及 audit HMAC；沒有把本地 fallback 當 production pass。
- Admin roster smoke 使用 wrapper 產生 process-only ephemeral audit HMAC（不落盤），驗證 login／recent-auth、roster shell、selected-year student CSV preview／atomic commit、credential response 及 hard-delete cleanup；完整四測試另覆蓋 active V2 stream／停權 fail-closed、student profile CAS/privacy、teacher scope/reset、explicit rollover disposition／incoming／suspended activation、responsive locale/theme、keyboard/focus及axe。
- 最近一次 session-cookie transport 修正後重新跑既有 browser regression：workspace `2 passed`、student IA `24 passed / 2 skipped`、V2 study stream `7 passed`；只出現本地未配置 Upstash 的既有 fallback warning。
- 另以明確 `STUDY_V2_ASSIGNMENT_MODE=off` 跑 student QA：`21 passed / 1 skipped`，包括既有 student axe／keyboard／zoom／locale／theme checks；student baseline與admin roster browser gate分開記錄，唔把其中一者冒充另一者。
- Admin roster 的 exploratory axe scan 曾暴露名冊選取 checkbox／select 缺少可程式化 label（critical `label`／`select-name`）；已補 labels、shared admin form labels／live alert、responsive mobile cards、tab arrow/Home、menu Escape/focus return、modal focus trap／return、dark contrast及200% reflow equivalent，重建 optimized app後完整四測試 browser matrix及shared modal accessibility smoke 的 serious/critical axe 均為零；Chromium `ariaSnapshot()` smoke亦通過。完整原生 screen-reader／device matrix仍未執行，故只保留該 native matrix deferred，唔冒充已完成。
- 完整 admin multi-step、student profile、teacher scope／TOCTOU／reset、active V2 suspension API及local-state cleanup flow已由 disposable Playwright 4-test default suite及unit tests驗證；rollover smoke 亦驗證恢復後不重播舊 V1/V2 state，並驗證 teacher reset student 後 must-change-password 導向；新增 explicit rollover fixture 逐項驗證六 grade、repeat／hold／graduate／leave、incoming、suspended、planned target link及activation後 roster；另以fresh disposable DB完成500-row import／501 reject、promotion 500／501 boundary、activation 5,000 atomic／5,001 pre-staging cap smokes；500-row import cold/warm preview 155/113/102/98ms、commit 21,120/20,838/21,193/21,333ms、transaction median 815.25ms、RSS peak 1.13MiB；5,000 activation total 2,763ms／transaction 2,745ms／RSS 0MiB，export preview 249ms、total 190/183/160/157ms、transaction 173/171/148/146ms、RSS peak 63.72MiB；promotion／activation batch payload PII-negative assertion及`check:roster-pii` surface scan亦通過。只未宣稱完整原生 screen-reader／device matrix及production config positive gate；後者仍需production secrets／另行release授權。
- 2026-08-16 停權／恢復 UI 修正以 focused browser regression 驗證：mobile 學生名冊按鈕可點擊、會送出現有管理員 PATCH、顯示成功訊息、切換「停權／恢復」文字，並以 roster GET 確認 server 狀態為 `SUSPENDED`／`ACTIVE`；本次未重跑與此 UI 無關的完整 rollover／scale suite。
- 2026-08-17 review follow-up：先以 `npm explain deepmerge-ts`／registry audit 確認 advisory path，沒有修改 Prisma dependency；workflow audit 與 functional job 已分離。曾在 rollover E2E 後遇到未來 current academic year 令 analytics 按 contract fail-closed，已重設 exact local test DB 再驗證，沒有修改 analytics contract。`npm audit` advisory、production config positive gate、production deploy 及完整原生 screen-reader／device matrix仍然保留為 deferred／release follow-up。
