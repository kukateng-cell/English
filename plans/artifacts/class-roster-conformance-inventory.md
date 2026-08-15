# 班級、名冊及教師權限 Phase 0 Conformance Inventory

> 日期：2026-08-15
>
> Branch：`codex/class-roster-import-and-access-control`
>
> 目的：記錄 Revision 3 開始實作前，現有工作樹候選程式與 canonical contract 的可執行差距，並保留實作後的 conformance evidence。
> 本文件不是 production release 證明；主計劃只按相鄰測試、migration replay 及 integration／E2E evidence 勾選，未授權的 release gates 仍保持未完成。

## 1. 審查邊界及證據

- Branch 起點仍為 `codex/retrieval-first-learning-stream-v2` @ `68dfd51`；目前 branch 未推送、未合併。
- 工作樹原本已有 roster candidate 修改及一個已套用到 local `english_dev/public` 的
  `20260815000000_add_class_roster_identity` migration；因此該 migration 視為 immutable，後續只能追加 forward migration。
- 只檢查 local development code／database；沒有接觸 production、preview 或真實學生資料。
- 已執行：
  - `npx prisma validate`：通過；
  - `npx prisma migrate status`（local PostgreSQL，read-only）：43 migrations，schema up to date；
  - `npm test`：165 passed、0 failed；
  - `npm run lint`：通過；
  - `npx tsc --noEmit`：通過；
  - `npm run test:roster`、`test:roster:invariants`、`test:roster:lifecycle`、`test:roster:auth`、`test:roster:reset`：通過；
  - `npm run test:migrations`、`npm run test:migration-checksums`、`npm run build`、`npm run check:roster-workbook`、local Playwright smoke 及明確 V1-mode 的 student QA（24 passed／2 skipped）：通過。
- 上述結果加上 §3／§4 的新 evidence 證明 local implementation 的指定 surface；不證明 production secrets、contract migration、production-only positive config 或完整原生 screen-reader/device matrix。

## 2. Keep / change / replace inventory

| Surface | 現況證據 | Revision 3 disposition | 下一步 |
|---|---|---|---|
| Retrieval-first V1/V2 learning、SM-2、study session／nonce／outbox | `npm test` 全部通過；AGENTS baseline 列為已完成 | **KEEP**，只做 roster status／session revocation 接口整合 | 加 regression，禁止 roster 改寫 learning semantics |
| `prisma/schema.prisma` identity | `User.accountName @map("email")`、`legacyName @map("name")`，缺 `credentialRevision`、canonical companions、完整 grant／audit fields | **CHANGE** | 保留物理 mapping；追加 canonical fields、profile／status／credential contract |
| Existing roster migration `20260815000000_add_class_roster_identity` | 已套用；使用 `isCurrent`、`AcademicYear.isCurrent`、`RosterImportBatch` 舊 shape，並直接 backfill Student／TeacherProfile | **REPLACE FOR CONTRACT, KEEP HISTORY** | 不修改 checksum；追加 forward migration；local reset 只經 exact-target guard |
| Student／Teacher profile | 有 legalName、nickname、basic profile，但無 role completeness trigger、nickname policy version、cross-field invariant | **CHANGE** | profile transaction、role checks、nickname validator、CAS、PII lifecycle |
| AcademicYear／SchoolClass／StudentEnrollment | 有基本表及 FK；使用 boolean `isCurrent`，缺 PLANNED/CURRENT/CLOSED、status／origin、transition、chronology guard | **REPLACE SHAPE VIA FORWARD MIGRATION** | 新 enum/status models、deferred invariants、calendar mutex、raw/concurrency tests |
| TeacherClassAccess | 有 class row、view/reset booleans；缺 selected-year replacement、aggregate accessRevision、active-class／teacher-status invariant | **CHANGE** | GET/PUT selected-year DTO、full replacement CAS、coverage snapshot |
| Identity helpers | `src/lib/identity.ts` 有 basic account/legal/email validation，但 public display 會 fallback legacy/account | **CHANGE** | nickname-only public projection、account/legal exact-match checks、identity CAS |
| Nickname helpers | `src/lib/nickname.ts` 有 Unicode／profanity／reserved checks及相鄰 tests | **KEEP IF CONFORMING** | 補 legalName/account/contact cross-field、admin path、policy version、rate/CAS tests |
| Temporary password | `src/lib/temporary-password.ts` 有 CSPRNG helper；現為16 chars | **CHANGE** | 18 chars／≥100-bit policy、共用 credential primitive、one-time report／rotation |
| Roster file parser | CSV/XLSX parser及 tests存在；目前上限、header/template、numeric account、formula／external-link contract未完整 | **CHANGE** | versioned templates、500 import cap、strict XLSX string account、safe export |
| `roster-import-contract.ts` | 有 basic staged row types；缺 selected-year、UPDATE/UNCHANGED diff、batch digest／CAS shape | **CHANGE** | 對齊 import field matrix、AdminMutationBatch／user links |
| `roster-server.ts`／admin roster APIs | 有初版 academic year、class、preview/commit、bulk、promotion、export routes；部分 route auto-creates class/year、直接寫 `isCurrent`，缺 recent-auth／CSRF／receipt／serializable contract | **REPLACE ROUTE LOGIC** | 共用 server services、stable errors、batch lifecycle、lock/CAS |
| Teacher API | 初版 access predicate 可隔離班級；`npm run test:roster` 通過，但只覆蓋 basic fixture | **CHANGE** | 所有 teacher read/reset route object scope、status／year／active-class／TOCTOU tests |
| Admin roster UI | 有單頁初版，混合 import、bulk、promotion、export；缺 year/class settings、paginated batch preview、coverage acknowledgement、safe credentials workflow | **REPLACE UI FLOW** | 按 Phase 3–7 分拆可驗收 flows、locale/theme/a11y |
| Student profile UI/API | 有 nickname page/API；API 仍以 `isCurrent` query，缺 same-origin CSRF、authoritative cross-field check及 session refresh contract | **CHANGE** | profile CAS、recent auth/session projection、privacy negatives |
| Auth/session | 現有 Auth.js JWT及 tokenVersion baseline；缺 session-bound `RecentAuthGrant`、fresh-login grant、credentialRevision、all state-changing CSRF | **CHANGE** | Phase 2 security boundary及two-device tests |
| SecurityEvent | 現有 actor/subject hash shape及 legacy enum；缺 nullable new HMAC pseudonym/key version physical expand | **CHANGE VIA EXPAND** | legacy-safe nullable columns、new-writer requirement、deletion matrix |
| Seed | 可建立初版 student/teacher/year/class fixtures；會依舊 shape及初始密碼 contract | **REPLACE SEED WORKFLOW** | guarded bootstrap、new schema、no plaintext artifact、idempotency |
| Reset/migration scripts | 現有 migration deploy／checksum scripts；未見 Revision 3 exact client/server topology reset flow | **ADD** | dry-run default、marker、MIGRATE_URL-only、disposable positive test |
| Existing roster tests | pure tests及 basic `check-roster-access`通過 | **EXTEND** | DB raw invariants、concurrency、API/E2E、PII/security/performance matrix |

## 3. Phase 0 exit and remaining gates

1. Existing migration is already applied locally; it remains immutable. Revision 3 now uses forward migrations through `20260815027000_roster_revision3_set_based_final_state`, preserving all checksums.
2. Canonical schema now represents `StudentYearTransition`, `RosterMutationState`, `AdminMutationBatch`, user-link tables, `RecentAuthGrant`, credential revision, and PRE_ACTIVATION／ACTIVATED lifecycle.
3. Legacy `isCurrent` remains a projected compatibility column while application writers use `PLANNED/CURRENT/CLOSED` and DB lifecycle guards.
4. Import, promotion and activation writers now use staged batches, CAS and atomic lifecycle transitions; raw DB invariant and lifecycle scripts pass.
5. Public display and leaderboard paths now use nickname-only projections; identity and nickname unit tests pass.
6. Auth has session-bound recent-auth, request-transport cookie selection and same-origin/CSRF guards; auth and admin roster smoke pass.
7. Batch user links, delete fallback, staging cleanup and lock-order retry are implemented; deferred roster final-state and planned-successor checks are single-pass per transaction for large activation; the default disposable admin/student/teacher workflow passes (3 Playwright tests), isolated fresh-DB 500-row import/501-row reject plus promotion 500/501 boundary smokes pass, and isolated 5,000 atomic activation/5,001 pre-staging cap smokes pass (3,211ms total / 3,185ms transaction for 5,000); promotion/activation batch payloads are PII-negative under browser assertions and `npm run check:roster-pii` passes the terminal-staging/credential/artifact scan; account-scoped V1/V2 browser-state cleanup is covered by a unit test; remaining unrun gates are 5,000 export performance, cold/warm RSS measurement, screen-reader/zoom, full performance/RSS measurement and production/contract release checks.

## 4. Phase 0 exit criteria

- [x] Branch and current worktree scope recorded.
- [x] Baseline documents, plan and candidate surfaces inspected.
- [x] Existing tests／lint／typecheck／Prisma validation and local migration status recorded.
- [x] Existing applied migration identified; no in-place rewrite will be attempted.
- [x] Canonical schema and forward-migration design implemented and replayed on a fresh disposable database.
- [x] Guarded reset／seed topology and exact target checks implemented and tested.
- [x] Every `REPLACE`／`CHANGE` candidate has either been rewritten or explicitly left behind with a failing conformance test.
- [x] Plan checklist and this inventory updated with actual command output; explicit rollover/large local fixtures and browser a11y/performance gates are evidenced, while contract/production/native-device release gates remain explicitly deferred.
