# 學生端回報問題修正（#91–#96）

## 狀態

已完成（本地實作及驗證；`check:catalog` 需資料庫重新匯入、Playwright e2e 需授權環境，已列明）

## 背景

使用者於 GitHub 回報 6 個學生端問題（#91–#96），另有一條 #89 由 PR #90 處理中。本計劃只涵蓋
使用者指定要處理的 5 個：

| Issue | 問題 | 決定 |
|---|---|---|
| #91 | 學生端單元名稱顯示英文代碼（如 `people-family`） | 修正 |
| #92 | 單元模式學完後沒有返回單元列表的出口 | 修正 |
| #93 | 「初次學習（完成第一次學習）」成就學過字卡後仍是 0 / 1 | 修正 |
| #94 | 新學生第一天可能長時間沒有新詞可學 | 使用者決定暫時跳過，本計劃不改 `UNIT_COMPLETION_RATIO` 或解鎖語義 |
| #95 | 詞庫有 24 個詞條的音標含異常符號 | 修正 |
| #96 | 認證不可用頁的「登出」進入英文 NextAuth 預設確認頁 | 修正 |

## 目標

1. 學生端所有顯示單元（分類）的位置改用中文名稱，未分類維持「未分類」。
2. 單元模式空狀態提供單元專屬文案及「返回單元列表」出口，主要按鈕不再只是重新載入。
3. 「初次學習」成就的條件與文案一致，學過字卡的學生不再顯示 0 / 1。
4. 修正 `data/catalog/` 中 24 條異常音標，並在詞庫匯入檢查加入音標字元驗證。
5. 以自訂繁體中文 `signOut` 頁取代 NextAuth 預設英文確認頁，並跟隨繁簡設定。

## 非目標

- #89／PR #90 的 session 驗證重試、示範站 migration 流程。
- #94 的學習政策改動（`UNIT_COMPLETION_RATIO`、`resolveScope` 派詞規則、SM-2 語義）。
- 任何 schema、migration、scoring、credential、receipt、CAS 行為。
- production deploy、示範站資料庫 reseed。

## 依賴與約束

- `plans/retrieval-first-learning-contract.md` 的卡片語義不變；本計劃只改顯示與出口，不改學習證據。
- 文案一律以繁體中文撰寫，由既有 locale 機制轉換；同時要檢查 `source-copy.test.ts` 的用詞規則。
- `src/lib/catalog/teacher-presentation.ts` 的教師端 `catalogCategoryLabel` 行為保留不變，學生端另加 helper。
- 詞庫 CSV 改動要同步 `catalog-identity` manifest，並維持 `sourceFile` 穩定識別名。

## 分階段 checklist

### P1 #91 單元中文名稱

- [x] 新增學生端分類標籤 helper，未知／空值顯示「未分類」
- [x] 字卡、測驗卡、單元頁、詞表頁及單元篩選改用 helper
- [x] 為 helper 加單元測試

### P2 #92 單元模式空狀態

- [x] 單元模式使用單元專屬文案
- [x] 提供「返回單元清單」主要行動，保留次要操作
- [x] 全域模式文案及行為不變

### P3 #93 初次學習成就

- [x] 成就條件與描述一致
- [x] 受影響成就的既有測試更新

### P4 #95 音標異常符號

- [x] 修正 4 份 CSV 內含 `^`／`ˊ` 的音標
- [x] 詞庫匯入檢查加入音標字元驗證及測試
- [x] 同步 catalog identity manifest 並重跑 catalog 檢查

### P5 #96 自訂登出頁

- [x] `authOptions.pages.signOut` 指向自訂頁
- [x] 自訂登出頁使用繁體中文並跟隨 locale
- [x] 認證不可用頁的登出出口一併受惠

## 風險

- #91 若把 `other` 分類誤顯示為「未分類」，會令教師端與學生端語義不一致 → 學生端 helper 明確區分
  「空的未分類」與「`other` 其他主題」。
- #95 改 CSV 會令 identity manifest 的 checksum 失效；未同步會令 `check:catalog-import` 失敗。
- #92 只改空狀態，不動 stream 選擇邏輯，避免影響 V2 receipt／CAS。
- #96 自訂 signOut 頁要保留 `callbackUrl` 及 CSRF 流程，否則登出會壞掉。

## 測試矩陣

| 改動 | 驗證 |
|---|---|
| 純顯示／文案（#91、#92、#96 頁面） | `npm run lint`、`npx tsc --noEmit`、相關單元測試、`npm run build` |
| 成就邏輯（#93） | `npm test` 相關檔案 + 全量 `npm test` |
| 詞庫 CSV 與驗證（#95） | `npm run check:catalog-import`、`npm run check:catalog`、`npm run catalog:identity` 及對應測試 |

資料庫、migration、Playwright gesture suite 不在本計劃必要範圍；如實作意外觸及
`src/lib/study-stream/` 或 `src/lib/units.ts` 的語義，必須另行評估。

## 實作結果

### #91 學生端單元中文名稱

- 新增 `src/lib/catalog/student-category-label.ts` 及
  `src/lib/catalog/student-category-label.test.ts`。`studentCategoryLabel()` 對空白、`null`、舊版
  「未分類／未分类」及任何未知代碼回「未分類」；只有正式 taxonomy 的 `other` 回「其他主題」。
- 套用位置：`src/components/WordCard.tsx`（字卡左上角標籤）、`src/components/QuizCard.tsx`
  （測驗卡）、`src/components/study-stream/StudyStreamV2.tsx`（客觀題卡）、
  `src/app/(student)/units/page.tsx`（單元卡標題）、`src/app/(student)/words/page.tsx`
  （「單元」篩選 chips 及詞語詳情分類）。
- 教師端 `catalogCategoryLabel` 及 `src/lib/catalog/teacher-presentation.ts` 的分類映射行為未改。
- API 及 URL 仍使用原始分類代碼，只改 UI 顯示。

### #92 單元模式空狀態

- `StudyStreamV2.tsx` 以 `unitSummary` 判斷單元模式：單元 no-content 顯示「這個單元目前沒有待學習或到期
  複習的詞」，單元 waiting 顯示「這個單元的進度已保留，可以稍後再回來複習」。
- 單元模式主要行動改為「返回單元清單」連結（`/units`）；「返回首頁」及「重新載入」降為次要文字操作。
- 全域模式的文案及按鈕（主要為「重新載入」）維持完全不變，既有 e2e capacity spec 期望不變。
- 用字說明：issue 原文寫「返回單元列表」，但 `src/lib/i18n/source-copy.test.ts` 的
  `NON_CANONICAL_VISIBLE_TERMS` 明確禁用「列表」，專案慣用「清單」，故採用「返回單元清單」。

### #93 初次學習成就

- `src/lib/achievements.ts`：新增進度來源 `firstStudy`；只要存在任何學習紀錄（字卡
  `StudyEncounter` 或客觀認讀題 `Review`）即視為達成，成就標題及描述「完成第一次學習」維持不變。
  `review_10`／`review_50`／`review_100` 仍只計 `Review`，其餘成就語義不變。
- `src/app/api/achievements/route.ts`：`GET` 讀取前補跑一次冪等 `checkAchievements(userId)`。原因是學習
  流程在寫入 `StudyEncounter` 之前就呼叫 `checkAchievements`，只完成一次字卡的學生在該次 response
  未必即時寫入解鎖記錄；在讀取端補跑可令成就頁如實顯示，且不用改動禁止範圍內的
  `src/lib/study-stream/server.ts`。
- 新增 `src/lib/achievements.test.ts`。

### #95 詞庫異常音標

- 修正 24 行、共 27 個字元：`^`（U+005E）→ `ɡ`（U+0261）18 條；`ˊ`（U+02CA）→ `ˈ`（U+02C8）6 條。
  只做字元替換，重音位置及音節結構不變，CSV 其餘欄位、BOM、換行逐位元組核對未變。
- 新增 `catalogPhoneticCharacterIssues()` 及 issue code `CATALOG_PHONETIC_CHARACTER_INVALID`（ERROR 級），
  接入 `validateCatalogRow`、`seedCatalog`（匯入前硬擋）及 `scripts/check-catalog-import.ts`；老師端補
  文案及「音標」欄位標籤。
- 重生 `word-catalog-v1.identity.json`：只有 `sourceDigest` 一行改變（5,641 條 assignments 不變，因為
  `identityFingerprint` 不含 phonetic）；`word-catalog-v1.initial-activation.json` 同步新 digest，
  `expected` 及 `selectionDigests` 不變。新 digest
  `696557d4267efc4cb46ecfc84a0c2c3f0b87b274f2f9743b51ac40c5c5cc136a`。
- 驗證規則刻意只抓這兩個已知替代字元：詞庫另有 2,698 個 `ә`（U+04D9）、67 個 `є` 等系統性舊記法，
  若一併當錯誤會令 `VALIDATION_FAILED` 由 65 上升並破壞 baseline；已列入後續工作。

### #96 自訂登出確認頁

- `src/lib/auth.ts` 的 `authOptions.pages` 加入 `signOut: "/auth/signout"`，保留既有 `signIn`、`error`。
- 新增 `src/app/auth/signout/page.tsx`（Server Component）：以 `safeCallbackPath` 驗證 `callbackUrl`
  （預設 `/login`）、由 NextAuth CSRF cookie 取得 token、跟隨 locale 的 metadata、沿用 `AuthShell`。
- 新增 `src/app/auth/signout/SignOutConfirm.tsx`（Client Component）：繁中確認文案、原生
  `<form method="POST" action="/api/auth/signout">` 帶 hidden `csrfToken`／`callbackUrl`、取消出路、
  跟隨繁簡及明暗主題。CSRF 未被繞過。
- 實測 NextAuth 4.24.15：設定 `pages.signOut` 後 GET `/api/auth/signout` 只會 302 到 `/auth/signout`
  （不帶 query）；POST 分支不受影響，所以 `LogoutButton` 仍是一按即登出。
- 新增 `src/lib/auth-signout-page.test.ts`（原始碼靜態約定）。

## 實際執行的驗證（2026-11-03）

| 指令 | 結果 |
|---|---|
| `npm test` | 420 pass / 0 fail（基線 402，新增 18 個測試） |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run build` | exit 0，`/auth/signout` 已列入 route 清單 |
| `npm run check:markdown-links` | 71 files passed |
| `npm run check:plan-index` | 45 direct plans / 47 unique targets passed |
| 詞庫 digest／disposition 重算腳本（非 DB） | sourceDigest `696557d4…`；identity 及 activation digest 一致；5,641 source rows；音標問題 0；frozen validation 5,576 valid / 65 failed / 5,469 ACTIVE / 107 DRAFT；daily validation failed 0 |
| `npm run check:catalog-governance` | exit 0（使用最新 READY batch，不綁 digest） |
| `npm run check:catalog` | **exit 1「最新 CSV catalog import batch 不存在。」** 屬預期：`.env.local` 的 `MIGRATE_URL` 指向雲端示範庫，該庫仍是舊 digest 的 import batch。未執行任何 DB 寫入 |
| `npm run catalog:identity` | 已執行一次，確認只有 `sourceDigest` 一行改變 |
| Playwright（#96，dev server 手動流程） | `/api/auth/signout` → 繁中確認頁 → POST 302 → `/login`；繁簡切換、深色主題、安全／不安全 `callbackUrl` 均符合預期 |

## 未執行項目及原因

- `npm run check:catalog` 未通過：需要對目標資料庫重新匯入（`seed`／`seed:catalog`）才會產生新 digest 的
  import batch。示範庫寫入未獲授權，依 `AGENTS.md` 不自行執行。
- 全部 Playwright e2e suite 未執行：`playwright.config.ts` 的 `webServer` 需要用 production build 起
  `127.0.0.1:3100`，而 `tests/e2e/study-stream-v2.spec.ts` 的部分 test 會比對 `DATABASE_URL` 必須是本機
  資料庫；目前 `.env.local` 指向雲端示範庫，`npm run seed` 會寫入示範庫，未獲授權。新增的 unit-mode
  e2e spec 及 `word-card-fidelity-fixtures` spec 改動已做靜態檢查，需留待 CI 或授權後的環境實跑。
- #94 依使用者決定暫時跳過，未改 `UNIT_COMPLETION_RATIO`、`resolveScope` 或任何學習政策。
- 未改 prisma schema、migration、scoring、credential、receipt、CAS、`src/lib/study-stream/`、
  `src/lib/units.ts`。

## 已知限制及後續工作

- 既有資料庫重新匯入會被 immutable revision guard 擋（音標改動令 24 行的 `contentDigest` 改變），需要
  fresh rebuild 或 bump `record_revision`，不在本次範圍。
- 詞庫仍有系統性非 IPA 字元未修正：`ә`（U+04D9）2,698 個、`є`（U+0454）67 個、`\` 12 個、Greek `ε` 4 個
  等，建議另開 issue 做整批正規化。
- `first class`、`good-looking` 的 catalog 重音位置與標準詞典（`ˌfɜːst ˈklɑːs`、`ˌɡʊd ˈlʊkɪŋ`）不一致；
  本次按要求只改字元不改重音位置，建議另開 issue。
- `go up` 音標仍不完整（`ɡu:p`），非本次 24 條範圍。
- `scripts/backfill-demo-realism.ts` 自帶一份成就定義副本，`first_study` 仍標 `reviews`；只影響 demo 資料
  回填的隨機解鎖日，不影響 runtime 判定，未改。
- 成就頁的 `GET /api/achievements` 現在會做冪等寫入（補跑 `checkAchievements`）；行為與學習流程一致，
  但屬讀取端帶副作用，日後若要更嚴格可改在學習 action 寫入 `StudyEncounter` 之後才檢查。
- `/auth/signout` 與 `/auth-unavailable` 一樣受 `src/proxy.ts` 的 `mustChangePassword` 閘門影響：仍帶
  `mustChangePassword=true` 的 session 會被導向 `/reset-password`。屬既有 proxy 語義，未改。

## 發佈／退役處理

只改顯示層、成就條件、詞庫資料與登出頁；不改 schema、migration 或現行 V2 學習 contract。
已部署環境要在下次部署時一併套用；示範站資料庫如要反映音標修正，需另行 re-import／reseed（未授權，不執行）。

## Definition of Done

- [x] 5 個 issue 的修正已完成並有測試證據
- [x] 全量驗證通過並記錄於本文件（`check:catalog` 的 DB 前置條件已列明）
- [x] `plans/README.md` 索引已更新
