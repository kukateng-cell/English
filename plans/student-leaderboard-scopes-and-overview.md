# 學生排行榜範圍及概覽

狀態：進行中

## 1. 背景及問題定義

現行學生排行榜由 `src/lib/leaderboard.ts` 即時計算三項指標：客觀認讀連續天數、掌握詞數及累計打卡。現時參與者係所有符合當前學生資格的學生，頁面只有單一全校榜單，學生要逐項切換先知道自己排名；亦未能分辨本班、全年級及全校的相對位置。

本功能在不改變現有學習、Review、SM-2 或指標計算語義的前提下，加入三個比較範圍，並在學生進入排行榜時先顯示自己的排名概覽。

## 2. 目標、非目標及成功準則

### 2.1 目標

- 支援 `本班`、`全年級`、`全校` 三個學生可見範圍。
- 以當前學年 `ACTIVE` enrollment 作為唯一 membership source：本班按 `classId`，全年級按 `grade`，全校包括所有當前合資格學生。
- 頁面頂部即時顯示自己在三個範圍、三項指標的排名、分母及目前數值；無法參與本班榜時要清楚顯示原因。
- 保留現有 Top 20 加入自己的 row、並列排名及 nickname-only privacy contract；排名範圍由 server 根據 session user 的 enrollment 決定。
- 在繁／簡 locale、light／dark theme、mobile／desktop 及 keyboard 使用下保持可理解及可操作。

### 2.2 非目標

- 不新增指標、不更改 `StudyDay`、`Review`、Objective Probe ledger 或 mastery threshold 的定義。
- 不為舊測試資料做資料修復或重新計算；all-time metric semantics 在第一版保留。
- 不建立歷史班籍快照、排行榜物化表、分數正規化或跨學年比較。
- 不增加教師／管理員 leaderboard surface，不顯示 legal name、account name、學號或其他公開 PII。
- 不執行 production deploy、contract migration 或破壞性資料清理。

### 2.3 成功準則

- 有當前有效班級的學生入頁即可看到本班、全年級、全校三組概覽；未分班學生仍可看到全年級／全校（若有 grade）。
- 每個可用範圍的三項排名與詳細榜單使用同一 server snapshot／同一 participant cohort；不得出現跨範圍誤混。
- client 不可透過 query parameter 指定其他班級、年級或學年；server 只接受範圍名稱並從權威 enrollment 建立 cohort。
- 調整範圍及指標時有 loading、error、empty/unavailable、繁簡及 dark mode 狀態。

## 3. 現況與依賴

### 3.1 現有指標 contract

| 指標 | 現行來源及定義 |
|---|---|
| 客觀認讀連續天數 | `ReviewEvent` 中非 historical、V2、`eventKind=REVIEW`、`evidenceKind=OBJECTIVE_PROBE`、有 objective target 的 calendar days；按 `Asia/Shanghai` 連續日計算 |
| 掌握詞數 | `Review.interval >= MASTERED_MIN_INTERVAL`，目前 threshold 為 22 |
| 累計打卡 | 每名學生 `StudyDay` 的 distinct calendar dates |

目前 eligibility 係 `STUDENT`、`ACTIVE` user，加上當前學年 `ACTIVE` enrollment 及完整 `StudentProfile`；nickname 係唯一公開顯示名稱。相同數值使用 competition rank（例如 `1, 1, 3`），詳細榜單保留 Top 20 及自己的 row。

### 3.2 相關依賴

- `prisma/schema.prisma` 的 `AcademicYear`、`StudentEnrollment`、`SchoolClass`、`StudentProfile`。
- `src/lib/leaderboard.ts`、`src/app/api/leaderboard/route.ts` 及學生排行榜頁面。
- `plans/class-roster-import-and-access-control.md` 的 current-year membership、privacy 及 pre-enrolled exclusion contract。
- `plans/retrieval-first-learning-contract.md` 的 scored streak 與 operational study-day 分離語義。

## 4. 凍結的產品及資料決定

### 4.1 範圍

| 範圍 | cohort 定義 | 沒有資料時 |
|---|---|---|
| 本班 | 同一當前學年、同一 `classId` 的 ACTIVE students | 無 `classId` 則不可用，不 fallback 到其他班 |
| 全年級 | 同一當前學年、同一 `grade` 的 ACTIVE students | 沒有 current grade 時不可用 |
| 全校 | 同一當前學年所有合資格 ACTIVE students | 若自己不在合資格 cohort，自己的 rank 顯示為 `—` |

學生的 requested scope 只可以係 `class`、`grade` 或 `school`；省略 scope 時，server 以可用的最窄範圍作 default（有班級用 class，否則有年級用 grade，否則 school）。

### 4.2 概覽

API 返回三個範圍各自的 `participantCount` 及三項 metric 的 `{ rank, value, outOf }`。UI 先顯示「我的排行榜概覽」，再顯示可切換範圍的詳細榜單；class 不可用時使用 disabled／empty state，而不是隱藏造成誤解。

第一版不把全校「掌握詞數」解讀成公平的能力比較；UI 以同一指標名稱和範圍清楚呈現，後續如需 normalized metric 另開產品決策及計劃。

## 5. 路由、API、UI、資料及 migration 影響

### 5.1 API

`GET /api/leaderboard?scope=class|grade|school`

- 由現有 auth helper 保護；不信任 `classId`、`grade` 或 `academicYearId` query。
- 回應保留現有 selected `lists` contract，新增 selected `scope`、scope metadata 及 `overview`。
- `overview` 包含 `class`、`grade`、`school` 三組結果；`lists` 只返回所選範圍的詳細 entries。
- requested class／grade 不可用時返回穩定 422 error；省略 scope 才可使用 server default。
- 不加 public cache；不要在 response、log 或 error 中洩露 enrollment IDs 或其他 PII。

### 5.2 Server implementation

- 一次以 current-year active enrollment 建立 eligible student cohort，再以同一 cohort 聚合三項現有 metrics。
- server 從登入者的 authoritative current enrollment 產生 class／grade context；以 `classId` 比較班級，不用 class name 作 identity。
- 對每個範圍先完整 rank，再從 selected list trim Top 20／自己 row；概覽的 `outOf` 及 rank 不受 Top 20 trim 影響。
- 保留穩定 tie-breaker（value 相同時使用 canonical student id），避免同分 row 因 query order 飄移；competition rank 數字語義不變。

### 5.3 Student UI

- `/leaderboard` hero 下方新增概覽 surface：以三個 scope rows/cards 呈現本班、全年級、全校，各自列出連續天數、掌握詞數、累計打卡的 rank／value。
- 概覽下面保留現有 metric tabs，新增 scope segmented control，清楚標示目前詳細榜單範圍及 participant count。
- 保留 EMM Style 02 reward card、medal、current-user highlight；新增內容使用現有 design tokens、`tc()`、theme variables 及 focus states。

### 5.4 Data / migration

第一版不改 Prisma schema、不新增 migration、不改現有資料；只把 current enrollment metadata 帶入 leaderboard read model。若實測 query plan 顯示需要 index，另開 migration 及驗證，不在本功能內以 `db push` 代替。

## 6. 分階段實施 checklist

### Phase A — contract／plan

- [x] 盤點現有 leaderboard metric、eligibility、ranking、privacy 及 student UI。
- [x] 建立本計劃並加入 `plans/README.md`；同步澄清 analytics plan 的邊界。

### Phase B — server scope and overview

- [x] 新增 typed scope／overview DTO 及 stable scope validation。
- [x] 以 current-year active enrollment 建立 class／grade／school cohort；classless fallback 只作用於 default，不擴大 requested scope。
- [x] 讓三項指標在 selected cohort 內聚合，保留現行 metric semantics、Top 20、自己 row 及 competition rank。
- [x] 回傳三個範圍的概覽 rank/value/outOf，並維持 nickname-only response。
- [x] 補充 scope／ranking 純邏輯測試；route error handling 已實作，authenticated route contract test 仍待 browser/auth fixture 可用時補跑。

### Phase C — student UI

- [x] 在排行榜入口先顯示三範圍概覽，包含目前學生自己的 rank、value 及 participant count。
- [x] 新增詳細榜單 scope switch；不可用 scope 有 disabled／說明，loading、error、empty 狀態完整。
- [ ] 驗證繁／簡、light／dark、mobile／desktop、keyboard focus 及 screen-reader labels；authenticated browser smoke 受本機 login limiter 阻擋。

### Phase D — verification and handoff

- [x] 執行 focused unit、lint、typecheck、build 及 `git diff --check`；route service smoke 已完成。
- [x] 以 local current-year fixtures 驗證同班、同級、全校 cohort；classless fallback／unauthorized scope rejection 的 route fixture 仍待可用 authenticated test account。
- [x] 記錄實際測試、未執行項目、已知限制及 rollback 方法；browser matrix 保持未完成狀態。

## 7. 風險及保護措施

- **scope 越權／資料洩露**：只接受 scope enum，membership 由 server current enrollment 解析；不回 class roster 詳細 PII。
- **跨學年混入**：每次 query 明確限制 current academic year + enrollment status ACTIVE；不得用歷史／planned enrollment。
- **同分不穩定**：rank value 只按數值，row 以 stable id tie-break；概覽及詳細榜單共用 rank helper。
- **全校 raw metric 公平性**：第一版保留現有 raw value，但在概覽 copy 及計劃中標示限制，不新增未批准 normalization。
- **效能**：避免每個 scope 重複讀取全表；一次讀 eligibility、按 participant IDs 讀現有 canonical rows，再在 memory 建立三個 cohort。若規模證據不足，先不物化。
- **privacy／a11y**：只顯示 nickname；概覽用語義 heading、`aria-label`、非色彩唯一狀態及 keyboard reachable controls。
- **compatibility**：省略 scope 仍返回 default detailed list；既有 metric labels、`me` marker 及 no-store 保留。

## 8. 測試矩陣

| 層次 | 必測案例 | 驗收重點 |
|---|---|---|
| Pure logic | scope default、class／grade membership、competition rank、同分 tie-break、Top 20 + me、empty cohort | rank／outOf 正確，class 不會 fallback 混班 |
| Server／route | 三 scope、invalid scope、requested unavailable scope、current year、planned／ended exclusion、missing profile | 400／422／401 contract 穩定；無 unauthorized roster data |
| Metric integration | objective streak、mastered words、study days 在各 cohort 對應現有 canonical rows | self-rating 不改 scored streak；現有 threshold 不變 |
| UI | overview first、scope／metric switch、current user、loading/error/empty、mobile | 入頁立即見自己三層排名；無法用 scope 時有說明 |
| Accessibility／locale | keyboard、focus、screen reader label、繁／簡、light／dark | controls 可操作，文案及對比足夠 |
| Regression | lint、typecheck、build、existing unit／focused browser tests | 不破壞現有學習流程及其他 leaderboard consumer |

## 9. 發佈、觀察及 rollback

本功能只作 local branch implementation，暫不 deploy production。發布前以 no-store API、server logs（不含 PII）及本地 browser smoke 觀察 response time、scope errors 及空 cohort。

若 UI 或 scope query 有問題，rollback 先移除 scope controls／overview 並讓 API 回到原有全校 `lists` response；因第一版無 schema 或 migration，無需資料 rollback。任何 future schema/index change 另按 expand／contract 規則處理。

## 10. Definition of Done

- [ ] 三個 scope 的 current-year active cohort、default、unavailable 及 unauthorized cases 已有 server tests。
- [ ] overview 入頁顯示自己三項 metric 在本班／全年級／全校的 rank/value/outOf；classless 行為清楚。
- [ ] 詳細榜單可切換三個可用範圍，既有 metric tabs、Top 20 + self、nickname privacy 及 rank semantics 保留。
- [ ] 繁／簡、light／dark、responsive、keyboard／a11y QA 完成。
- [ ] lint、typecheck、build、focused tests 通過；實際結果及未執行高成本項目已寫回本計劃。

## 11. 決策紀錄

| 日期 | 決定 | 原因 |
|---|---|---|
| 2026-08-18 | MVP 用 current-year ACTIVE enrollment 做 class／grade／school cohort | 與 roster access-control contract 一致，避免歷史／planned membership 污染學生比較 |
| 2026-08-18 | 進入頁面先顯示三層概覽，詳細榜單另以 scope switch 查看 | 先回答「我喺邊度」再讓學生查看完整榜單，減少逐頁尋找 |
| 2026-08-18 | 保留現有 raw all-time metrics，不在本輪加入 normalization | 不改已生效的 metric contract；公平性改善另開決策 |
| 2026-08-18 | MVP 不新增 schema／migration | 現有 enrollment relations 足以建立 cohort，降低資料及 rollout 風險 |

## 12. 驗證紀錄及已知限制

已執行：

- `npm test`：216 tests passed。
- `npx tsc --noEmit`：passed。
- `npm run lint`：passed。
- `npm run build`：passed；sandbox 首次因 Turbopack 無法 bind process/port 而失敗，escalated retry passed。
- `git diff --check`：passed。
- `npx prisma migrate status`：escalated read-only check passed，49 migrations，database schema up to date；沒有執行 migration。
- local read-only leaderboard service smoke：測試學生 default/class/grade/school 全部成功；fixture 回傳本班 9 人、全年級 9 人、全校 42 人，三項 overview rank/outOf 均有值。

未完成／未執行：

- authenticated Playwright smoke 未能進入排行榜 assertion：sandbox bind `127.0.0.1:3100` 受限，escalated retry 後 auth setup 被現有 `student-test` login limiter 拒絕；沒有可用的 storage state，故未把此結果判定為 UI pass 或 feature failure。
- 未執行 production deploy、contract migration、destructive cleanup、完整 native screen-reader／device matrix。

已知限制：第一版保留 raw all-time 指標；全校「掌握詞數」未做年級／學習年資 normalization。後續若要公平化，需另開產品決策及計劃，不在本輪偷偷改 metric contract。
