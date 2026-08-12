# 學生端 UI Fidelity 修正計劃

> 狀態：進行中
>
> 建立日期：2026-08-12
>
> 最後更新：2026-08-12
>
> 設計來源：`/Users/hangwong/Documents/Design/emm_style_01/`
>
> 關聯計劃：`plans/ui-design-system-migration.md`（已完成；本文件作後續修正，不改寫其歷史驗收紀錄）
>
> 實施範圍：學生首頁、學生導覽、認字／學習頁、品牌與繁簡顯示、學生端垂直 spacing rhythm

## 1. 背景及問題定義

EMM Style 01 設計系統遷移完成後，實際使用回饋指出學生端仍有多項重要視覺及資訊架構落差。這些問題不應視為小型樣式微調，因為它們同時影響 mobile 導覽可達性、繁簡一致性、首頁閱讀節奏，以及核心認字操作的辨識度。

本計劃以使用者回饋、EMM Style 01 的 `home.html`、`learn.html`、`assets/see-word.css`、`assets/see-word.js`、`brand-spec.md`、`DESIGN-HANDOFF.md`、`DESIGN-MANIFEST.json`，以及目前程式、Prisma schema、study API 和測試為依據。

### 1.1 Mobile 導覽不可見

使用者在 mobile 首頁及認字頁均看不到 navigation bar／導覽列。

目前可執行證據顯示兩種不同情況：

- `/study`：`StudentShell` 對所有 `/study` 路徑設定 `immersive`，並直接不 render desktop rail、mobile header 及 mobile bottom nav。這是已確認的程式行為，也是上一份遷移計劃曾批准的偏離，但與今次要求及 Prototype 的 `learn.html` 不再一致。
- `/`：目前程式在 `<980px` 應 render fixed bottom nav，既有 390×844 本地截圖亦有顯示。因此實際裝置完全看不到導覽的原因尚未證實，可能涉及實際 build／commit、登入狀態、viewport／safe-area、fixed stacking、內容覆蓋或 locale/account controls 等條件。實施前必須在使用者實際環境或等價條件重現，不可只因自動化截圖通過便結案。

### 1.2 Traditional Chinese 畫面混入 Simplified Chinese

使用者在預期為繁體的畫面看到「见」、「学习」等簡體字。現況已有一項明確 root cause：

- `BrandLockup` 的品牌 mark 直接硬編碼 `见`，沒有經過 `tc()`；即使 locale 是 `zh-Hant`，圖形內仍會顯示簡體。

此外，系統會讓 localStorage 的既有 locale 偏好覆蓋預設 `zh-Hant`。因此實施時必須分清：

1. 真正的繁體漏轉；
2. 使用者明確選擇了簡體；
3. 舊偏好、cookie 與 localStorage 不一致；
4. 品牌專名是否應在兩種 locale 都固定顯示「見字會」。

修正不得取消既有簡體／繁體雙語能力，也不得以散落的繁體硬編碼破壞「簡體 source locale → `tc()`／`convertForServer()`」規則。

### 1.3 白色卡片與 section spacing 不一致

首頁目前由多個元件各自擁有 `margin-bottom`，但外層沒有單一垂直 stack contract。`PageHeader`、`StatusBanner`、next-session card、stat grid、library card、link cards 和 empty state 因此可能出現 0、12、24、32 或 40px 等不同間距；相鄰白色 surface 在 mobile 尤其容易顯得忽寬忽窄。

EMM Style 01 已定義清楚節奏：

- 同層頁面 section：24px；
- 卡片內內容及元件群組：16px；
- 緊湊控制項：12px；
- 桌面大型分欄：48px，只用於分欄而非 mobile 垂直間距。

實施時要先決定間距由 parent stack 還是 child margin 擁有，避免雙重 margin、例外累積及 responsive 漂移。

### 1.4 認字頁文字與 Prototype 不一致

目前認字階段的頁面標題是「今日學習 · 認識這個單詞嗎？」；使用者要求主標題只保留「今日學習」。Prototype 的主標題亦為「今日學習」，輔助提示另放在較低層級，不與標題串成一句。

### 1.5 認字卡欠缺 level／category

Prototype 卡片頂部顯示 `A2 · 日常生活` 及「認讀卡」。目前：

- Prisma `Word` 已有 `level`（A1/A2/B1/B2）及 nullable `category`；
- `GET /api/study` 已回傳完整 `Word`，包括 `level`、`category` 及 `pos`；
- Study page 的 `WordFull` type 已包含 `level` 和 `category`；
- `WordCard` props 卻只接受 `term` 和 `phonetic`，畫面沒有呈現現有真實資料。

Baseline 因此不需要 schema 或 migration。若資料抽樣發現 category 為空或內容品質不足，只可顯示經批准的空值策略或另開內容治理工作，不得用 Prototype 的「日常生活」、A2 等示例填補 production 資料。

### 1.6 認字卡沒有 Prototype 的堆疊／背卡效果

Prototype 使用 `.learn-card-stack`、主要 `.word-card` 及 decorative `.word-card-back` 建立有深度但克制的卡片堆疊。現行畫面只有單一白色卡片。修正需要恢復背卡層、邊框、陰影、圓角及右上裝飾弧線，但不得讓 decorative layer 接收 pointer event、改變 drag transform ownership 或破壞 reduced motion／Forced Colors。

### 1.7 「認識／不認識」操作設計未跟 Prototype

目前兩個操作是放在 draggable card 內的淡紅／淡綠 pill，文案為「不認識」及「認識」。Prototype 的設計則是卡片外下方的兩欄操作區：

- 左側「還不會」：白底、紅色邊框及向左箭頭；
- 右側「我會」：深靛紫實底、白字及向右箭頭；
- 兩者約 60px 高、18px 圓角、同寬，並有 hover／pressed／focus 狀態；
- 卡內另有拖曳方向 badge、keyboard hint，卡外有 swipe guide。

今次應以 Prototype 的結構及視覺層級作 contract，同時完整保留左滑 quality=2、右滑 quality=5、提交冪等、keyboard、mouse、touch 及 synthetic pointer 行為。

## 2. 目標

- 在 mobile 首頁及認字流程提供可見、可理解且不被 safe-area／內容遮擋的學生主導覽。
- 重新定義 `/study` 各狀態的導覽可見性與 guarded exit 行為，使 Prototype fidelity 與 study 資料安全同時成立。
- 確保 `zh-Hant` 畫面沒有可見簡體漏字，品牌 mark、品牌名稱、導覽、ARIA、toast、error 及 metadata 遵守同一 locale contract。
- 建立學生頁單一 spacing ownership 及可量度的 8px rhythm，修正相鄰白色 surface 間距不一致。
- 將認字頁主標題、卡片 level/category、認讀 context、背卡層及操作按鈕恢復至 EMM Style 01 的視覺語言。
- 所有資料使用現有真實 API／schema；不加入 Prototype 示例資料或假 category。
- 保留 Auth.js、角色守衛、safe callbackUrl、mustChangePassword、tokenVersion、最後管理員保護及所有 study workflow 語義。
- 以自動化測試、固定 viewport screenshot comparison、accessibility smoke 及實際 mobile 驗收作完成證據。

## 3. 非目標

- 不更換 SM-2、quality mapping、queue 排序、單元解鎖或 learned/mastery 定義。
- 不重寫 study session、nonce、operationId、checkpoint、outbox、cross-tab lease、rotation、Serializable transaction 或 retry 機制。
- 不新增固定每日任務 schema，亦不讓 Dashboard 呼叫 `GET /api/study` 取得統計。
- 不因 category 缺值而製造假分類、假 level 或 Prototype 示例內容。
- 不在本計劃內批量整理 5000+ 詞的 category 品質；如資料覆蓋不足，另開內容治理計劃。
- 不取消簡體模式；問題定義是 locale 不一致及繁體漏轉，而不是移除 `zh-Hans`。
- 不把所有學生頁面重新設計一次；只處理本文件列明的導覽、繁簡、spacing 及認字 fidelity。
- 不修改已套用 migration，不使用 `prisma db push`，不執行 `npm run db:contract`。
- 未獲明確授權前不部署 production。

## 4. 成功準則

- [ ] 320×568、360×800、390×844、430×932 的登入學生首頁均可立即看見四項 bottom nav，內容不被 nav 遮擋。
- [ ] 390×844 認字 assess 畫面可看見符合已批准 state matrix 的 bottom nav；desktop 對應顯示 rail 或已批准的等價導覽。
- [ ] 所有可見導覽目的地可操作，沒有 404、login loop 或 placeholder。
- [ ] pending／blocked sync、quiz、Coach dialog 及離開流程不會因導覽恢復而遺失、重複或錯交學習記錄。
- [ ] `zh-Hant` 的品牌 mark、品牌名、主導覽、標題、按鈕、ARIA、error、toast 及 metadata 沒有已知簡體漏字。
- [ ] `zh-Hans` 仍能完整顯示簡體 UI；英文 term、phonetic、level 及 category 不被 OpenCC 誤改。
- [ ] 首頁同層 section 的垂直距離遵守已批准 spacing table，沒有由相鄰 child margin 疊加出的例外。
- [ ] 認字頁主標題只顯示「今日學習」；輔助說明若保留，使用獨立、較低層級位置。
- [ ] 認字卡顯示真實 level 及 category；category 缺值使用已批准 fallback，不顯示假資料。
- [ ] 認字卡有符合 Prototype 的背卡層、圓角、陰影、裝飾弧線及 card proportion。
- [ ] 「還不會／我會」按鈕在 card 外、視覺及互動符合 Prototype，且 click、keyboard、drag 使用同一提交路徑。
- [ ] light／dark、繁體／簡體、keyboard、mouse、touch、synthetic pointer、reduced motion 及 Forced Colors 均通過。
- [ ] Prototype／實作 screenshot comparison、刻意偏差及 reviewer 結論已記錄。

## 5. 現況與依賴盤點

| 範圍 | 現況證據 | 缺口 | 預計處理 |
|---|---|---|---|
| Study 導覽 | `StudentShell` 對 `/study` 完全不 render StudentNav | 與今次需求及 `learn.html` 不一致 | 建立 route + state 可見性矩陣，恢復安全導覽 |
| Home 導覽 | 程式及本地 390px 截圖有 bottom nav | 實際 mobile 回饋仍不可見 | 重現實際環境，檢查 build、stacking、safe-area、viewport 及遮擋 |
| 品牌 mark | `BrandLockup` 硬編碼 `见` | `zh-Hant` 仍出現簡體 | 納入 locale／品牌專名 contract |
| Locale 預設 | `DEFAULT_LOCALE = zh-Hant`；localStorage 可覆蓋 cookie | 舊偏好或不一致狀態可能令使用者誤見 Hans | 測試 preference precedence 及可見狀態 |
| 首頁 spacing | child 元件各自使用不同 margin | 沒有 parent-owned rhythm | 引入 page stack，移除重複／例外 margin |
| Study 標題 | 「今日學習 · 認識這個單詞嗎？」 | 文案過長，偏離 Prototype | 主標題改為「今日學習」 |
| 字卡資料 | API／`WordFull` 已有 level/category | `WordCard` props 沒有使用 | 擴充 presentation props，無需 API/schema 改動 |
| Category 完整度 | `Word.category` nullable | 不能保證每詞都有分類 | 抽樣／統計後套 approved fallback，不造假 |
| Card stack | 現行只有單卡 | 缺背卡及裝飾深度 | 新增 pointer-inert decorative layer |
| Card actions | card 內紅／綠 pill，「不認識／認識」 | 結構、色彩、文案、位置均偏離 | 重建為 Prototype 外置雙按鈕 |
| Motion | 現有 custom pointer release 及完整 E2E | 高回歸風險 | 不改演算法，只改展示結構並保留 test IDs |

### 5.1 依賴文件

- `AGENTS.md`
- `plans/README.md`
- `plans/project-plan.md`
- `plans/ui-design-system-migration.md`
- `DEPLOY.md`
- EMM Style 01 `learn.html`、`home.html`、CSS、JavaScript、brand spec、handoff、manifest 及 reference screenshots

### 5.2 預計主要檔案範圍

- `src/components/student/StudentShell.tsx`
- `src/components/student/StudentNav.tsx`
- `src/components/student/StudentDashboard.tsx`
- `src/components/brand/BrandLockup.tsx`
- `src/components/LocaleProvider.tsx`（只有 preference／同步測試證明需要時）
- `src/lib/i18n/config.ts`、`src/lib/i18n/convert.ts` 及相鄰 tests
- `src/app/(student)/study/page.tsx`
- `src/components/WordCard.tsx`
- `src/app/globals.css`
- `src/app/test/word-card-fidelity/*`（只在 `ENABLE_TEST_ROUTES=1` 可用的 fidelity fixtures）
- `tests/e2e/student-shell.spec.ts`
- `tests/e2e/study-workflow.spec.ts`
- `tests/e2e/word-card-release.spec.ts`
- `tests/e2e/word-card-fidelity-fixtures.spec.ts`
- 新增的 visual／locale／spacing regression fixtures（實際路徑在 Phase 0 凍結）

## 6. 目標 contract

### 6.1 導覽 state matrix（建議基線，Phase 0 待確認）

| Surface／狀態 | Mobile bottom nav | Desktop rail | 操作規則 |
|---|---|---|---|
| `/`、`/words`、`/stats`、`/units` | 顯示並可操作 | 顯示並可操作 | 保持現有 role／auth contract |
| `/study` assess，無 pending sync | 顯示並可操作 | 顯示並可操作 | 離開前保存 checkpoint；沿用 guarded exit target |
| `/study` quiz | 顯示；點擊以既有 guarded exit 阻止直接離開 | 顯示；點擊以既有 guarded exit 阻止直接離開 | 不可跳過必須完成的 quiz 或造成半筆提交；以 live feedback 說明 |
| Coach dialog 開啟 | 背景可見但 inert | 背景可見但 inert | dialog 遮罩、focus trap、Escape、focus return 保持 |
| pending／blocked sync | 顯示但不可直接離開 | 顯示但不可直接離開 | 阻止 navigation，使用 live region 說明及提供 retry／處理入口 |
| done | 顯示並可操作 | 顯示並可操作 | 可去 Today／Stats 等真實目的地 |
| login／reset／teacher／admin | 不顯示學生 nav | 不顯示學生 rail | 保持既有 shell 邊界 |

導覽恢復不能只是刪除 `immersive` class。`StudentNav` 必須可接收 study navigation guard 或由 Study page 提供一個受控 exit adapter，確保 bottom-nav click、browser Back、explicit exit 及 desktop rail 使用相同安全判斷。

### 6.2 Locale 與品牌 contract（建議基線，Phase 0 待確認）

- 新使用者沒有 cookie／localStorage 偏好時預設 `zh-Hant`。
- 已明確選擇 `zh-Hans` 的使用者仍看到完整簡體 UI，不可強制改回繁體。
- 品牌專名在兩種 locale 均固定顯示「見字會 SeeWord」，品牌 mark 固定使用「見」；ARIA 名稱與可見品牌一致。
- 除品牌專名外，所有中文 source 字串仍先用簡體，再經 `tc()`／`convertForServer()` 顯示。
- locale precedence 必須固定：有效 localStorage preference、cookie、default 的先後次序及同步方式由測試明確鎖定。
- category、definition、ARIA、toast、API error、metadata 和 chart label 均納入繁體漏轉抽查。
- 不以全頁 regex 粗暴改字；應修正繞過 converter 的來源與 locale 狀態。

### 6.3 Spacing contract（建議基線，Phase 0 待確認）

| 關係 | Mobile／tablet | Desktop | Owner |
|---|---:|---:|---|
| page header → 第一個 section | 24px | 32px（如 reference 證明需要） | page stack |
| 同層主要 section／白色 cards | 24px | 24px | page stack |
| 同一 card 內主要群組 | 16px | 16px | card layout |
| 緊湊 labels／chips／controls | 12px | 12px | component |
| grid item gap | 12px 或 16px，按 reference | 16px 或 24px | grid container |
| desktop 主／側欄 | 不適用 | 48px | desktop layout |
| content → fixed bottom nav | nav 高度 + safe-area + 至少 16px | 不適用 | shell |

原則：同一垂直關係只由一個 parent 擁有 gap；一般 section 不再以各自 `margin-bottom` 拼接。刻意不同的 gap 必須有語義名稱、reference 證據及計劃紀錄。

### 6.4 認字卡資料 contract

- `level` 直接取 `current.word.level`，只容許 A1/A2/B1/B2。
- `category` 直接取 `current.word.category`；中文 category 經 `tc()` 顯示，英文及混合內容不得被誤改。
- 有 category：顯示 `<level> · <category>`。
- 無 category：顯示 `<level> · 未分類`；不得填入示例 category。
- 右上 context 使用 source-locale「认读卡」再由 `tc()` 顯示。
- `pos` 不是「日常生活」這種主題分類；除非另有設計位置，不用它冒充 category。
- Baseline 使用現有 `GET /api/study` response，不新增 endpoint、不簽發額外 session、不改 cache policy。

### 6.5 認字卡視覺與操作 contract

- 卡片頂部：level/category badge +「認讀卡」。
- 卡片中央：英文 term 為唯一主要視覺焦點；提示文字保持短句。
- 卡片底部：queue note + keyboard hint；不得使用 Prototype 的固定「第一個」資料，應由真實 index 產生或使用無假數據的通用文案。
- 背卡層使用 `aria-hidden`、`pointer-events:none`，不得成為 drag transform ancestor。
- 左操作文案採「還不會」，右操作文案採「我會」；ARIA 名稱與可見文案一致。
- 左按鈕為紅色 outline／白色 surface；右按鈕為深靛紫 primary；不再以綠色代表「我會」。
- click、Enter／Space、ArrowLeft／ArrowRight、drag release 最終呼叫同一 left/right action pipeline。
- 保留既有 `data-testid`、interaction epoch、release timeline、velocity sampling、pointer capture 及 reduced-motion 分支。
- disabled、pending、offline、blocked 狀態不可只靠 opacity；要有 accessible state 及可理解 feedback。

## 7. 分階段實施計劃

## Phase 0：重現、量度及凍結決策

### 目的

在改程式前，用同一 build、帳戶及 viewport 重現實際問題，凍結會影響 navigation、locale 與 fallback 的決定。

### Checklist

- [x] 記錄開始 commit、branch、工作樹狀態及所有既有使用者改動；不得覆蓋無關改動。
- [x] 核對 `AGENTS.md`、相關 plans、`DEPLOY.md`、Prototype HTML/CSS/JS、manifest、handoff、brand spec 及 screenshots。
- [x] 在 390×844 檢查 `/` mobile 導覽可見性；同一 production build／登入 student／`zh-Hant`／390×844 未重現「完全不可見」，並已記錄 DOM、visual viewport、safe-area、hit target 及 screenshot；實際 deployment 未提供，列為 parity limitation。
- [x] 在 390×844 重現 `/study` 導覽不可見，確認是 `immersive` render 條件而非單純 CSS。
- [x] 對首頁 bottom nav 檢查 DOM 是否存在、computed `display/position/z-index/bottom/padding`、bounding box、遮擋元素及 hit target。
- [x] 核對可取得的 production build 使用 HEAD `7dfbb6f`；實際 deployment URL／commit 未提供，未擅自部署，版本 parity limitation 已記錄。
- [x] 擷取 home／learn 的 Prototype 與 current baseline：390×844、820×1180、1440×900。
- [x] 量度首頁相鄰 section 實際 gap，建立 before spacing table，不以肉眼描述代替數值。
- [x] 列出 `zh-Hant` 畫面中所有簡體漏字及來源（硬編碼、未經 `tc()`、locale preference、server metadata 或 DB content）。目前已確認可見 root cause 是 `BrandLockup` 的硬編碼 `见`；其餘關鍵 UI source 經 `tc()`／metadata converter 顯示。
- [x] 核對 `zh-Hans`／`zh-Hant` cookie、localStorage、SSR lang、hydration 後 lang 及切換行為；現況為 cookie SSR、localStorage mount 後優先並 router refresh，conflict 會由 Hant 首幀轉 Hans，列入 Phase 1 修正。
- [x] 對 `Word.category` 做唯讀 coverage 查詢：總詞數、null count、各 level null count、最常見 category；不得 seed 或修改資料。
- [x] 凍結第 6.1 節 `/study` assess／quiz／dialog／pending／blocked／done 導覽 state matrix。
- [x] 確認品牌專名在兩種 locale 都固定為「見字會」及「見」。
- [x] 確認 category null fallback 為「`<level> · 未分類`」。
- [x] 凍結第 6.3 節 spacing table，以及 mobile／desktop 唯一允許的例外。
- [x] 凍結「還不會／我會」文案及 Prototype action hierarchy。
- [x] 將狀態改為「進行中」，並在第 13 節記錄所有已確認決策後才開始 Phase 1。

### 產出

- 問題重現紀錄、baseline screenshots、spacing measurements、category coverage、導覽 state matrix 及決策紀錄。

### 驗收

- 所有產品行為決定已有明確答案；Home 的實際 nav 缺失有可重現證據或已證明是版本差異，不能以「本機看得到」代替結案。

## Phase 1：Locale 與品牌一致性

### 目的

先修正跨頁共用的品牌及 locale 根因，再處理個別頁面。

### Checklist

- [x] 移除 BrandLockup 內繞過 locale／brand contract 的硬編碼簡體 mark。
- [x] 依已批准決策統一可見品牌名、mark、ARIA label 及 metadata。
- [x] 核對 StudentNav「學習」、首頁標題、study 標題、按鈕及 status 文案全部由簡體 source 經 `tc()` 顯示。
- [x] 修正 localStorage／cookie／SSR locale 不一致時的 deterministic precedence；不得引入 hydration mismatch 或首幀語言閃爍。
- [x] 為首次使用、既有 Hant preference、既有 Hans preference、無效 preference 及 cookie/storage 衝突新增測試。
- [x] 加入 BrandLockup 繁簡 DOM assertion，至少驗證可見文字與 ARIA。
- [x] 加入 `zh-Hant` 關鍵 route 漏字 smoke，覆蓋 `/`、`/study`、`/words`、`/stats`、login。
- [x] 驗證 DB definition/category、英文 term、phonetic、A1–B2 及混合字串不被錯轉。
- [x] 驗證 language control 在 mobile 可到達，且切換後 server/client 文案一致。
- [x] 執行本 Phase 測試、light/dark + Hans/Hant screenshots，修正所有本 Phase 引入問題。
- [x] 更新本計劃進度、實際結果、未執行項目及限制；建立單一、可回退 checkpoint commit。

### 驗收

- `zh-Hant` 關鍵 surface 無已知簡體漏字；`zh-Hans` 保持可用；品牌在所有 shell 一致。

## Phase 2：Mobile／desktop 學生導覽修正

### 目的

讓首頁及認字流程在各 viewport 都有符合 state matrix 的可見導覽，同時保留安全離開流程。

### Checklist

- [x] 將 `immersive` 的「全部不 render nav」改為明確 route/state 導覽策略，而非單一 pathname boolean。
- [x] 首頁 mobile bottom nav 固定顯示，bounding box 完整落在 visual viewport 內。
- [x] 認字 assess 畫面顯示 mobile bottom nav；desktop 按批准 contract 顯示 rail。
- [x] StudentNav active state 在 `/study` 正確標示「學習」。
- [x] bottom nav／rail navigation 連接既有 guarded exit；不得繞過 checkpoint、pending outbox 或 blocked sync 判斷。
- [x] quiz、Coach dialog、pending、blocked、done 逐一實作第 6.1 節 approved state。
- [x] dialog 開啟時 nav inert，不能 tab 到背景 link，關閉後 focus 正確返回。
- [x] 內容 bottom padding 由實際 nav 高度 + safe-area 計算，最後一項內容及 action 不被遮擋；語速浮動控件亦移至 nav 上方。
- [x] 以 Playwright mobile viewport resize 模擬 dynamic visual viewport／keyboard-like height change，並驗證手機橫向及 scroll 時 nav 不跳走、不消失；原生 iOS keyboard 未在此環境開啟，列入 Phase 6 device smoke。
- [x] 驗證 320px 寬仍有四個至少 44×44px hit target，label 不裁切。
- [x] 驗證所有四個 destination 有真實內容、auth、loading/empty/error state，無 404／placeholder／login loop。
- [x] 新增首頁與 `/study` mobile nav visibility、hit testing、active state、safe-area 及 guarded exit E2E。
- [x] 執行 student IA、study workflow、card motion 相關測試，修正所有本 Phase 引入問題。
- [x] 更新本計劃及建立單一、可回退 checkpoint commit。

### 驗收

- 使用者指出的兩個 mobile surface 均可見導覽；任何導覽操作都不能令 study record 丟失或重複提交。

## Phase 3：首頁與共用學生 surface spacing rhythm

### 目的

以 parent-owned stack 取代零散 child margin，使 section 間距有一致規則及可量度證據。

### Checklist

- [x] 建立共用 student page stack／section stack class 或 primitive，名稱反映語義而非單一頁面。
- [x] 首頁 PageHeader、resume banner、next-session card、stats、library、links 及 empty state 使用同一垂直 stack。
- [x] 移除與 parent gap 重複的 `margin-bottom`，避免 margin collapse 或雙倍間距。
- [x] Card padding、內部 group gap、grid gap 與 section gap 分開 token 化。
- [x] 檢查 loading、error、empty、has-checkpoint、無-checkpoint、長文案及三個 stat cards 的 spacing。
- [x] 檢查 mobile 320/390/430、tablet 820 及 desktop 1440；不得以 `overflow-x:hidden` 掩蓋問題。
- [x] 以 DOM bounding boxes 自動 assert 主要 sibling gaps 在 approved tolerance（建議 ±1px）內。
- [x] 比較 Prototype 的視覺節奏；資料量造成的高度差異不應被誤判為 spacing 差異。
- [x] 檢查 400% reflow、WCAG text spacing override 及長繁體文案，避免卡片相撞或內容裁切。
- [x] 執行本 Phase visual regression、axe、lint、typecheck 及相關 E2E。
- [x] 更新本計劃及建立單一、可回退 checkpoint commit。

### 驗收

- 白色 cards 與 section 的距離均能由 spacing table 解釋；沒有未記錄的任意 gap。

## Phase 4：認字頁文字、卡片資料與 Prototype 視覺 fidelity

### 目的

在不改 study 狀態機的前提下，恢復 Prototype 的資訊層級、卡片深度及真實資料 badge。

### Checklist

- [x] 主標題改為「今日學習」；不再把「認識這個單詞嗎？」串入 h1。
- [x] 輔助提示如保留，使用 Prototype 對應位置、較低 hierarchy 及短句。
- [x] 擴充 `WordCard` presentation type，安全接收 `level`、`category` 及必要 context。
- [x] 卡片顯示真實 `<level> · <category>`，category null 按 approved fallback 顯示。
- [x] 中文 category 經 `tc()`；English／mixed category 及 level 不被錯轉。
- [x] 顯示「認讀卡」context，對應 ARIA 不重複朗讀無用裝飾。
- [x] 新增 decorative back card，對齊 Prototype 的 offset、rotation、radius、border 及 surface。
- [x] 恢復主卡右上裝飾弧線，dark mode 及 Forced Colors 仍可辨識但不搶焦點。
- [x] 調整卡片高度、padding、term scale、hint、queue note 及 keyboard hint，使 390×844 幾何接近 reference。
- [x] 長單詞、B2、null category、長 category、缺 phonetic、Hant/Hans 及 text spacing fixtures 不 overflow。
- [x] 背卡及裝飾層使用 `aria-hidden`／pointer-inert，不參與 gesture geometry。
- [x] 保留 drag layer、flight layer、test IDs、interaction epoch 及 release motion ownership。
- [x] 執行 card-motion 全矩陣、study workflow、visual diff、axe 及 reduced-motion 驗證。
- [x] 更新本計劃及建立單一、可回退 checkpoint commit。

### 驗收

- 認字卡的文字、badge、比例、背卡及裝飾與 Prototype 同一視覺語言；所有資料來自現有真實 queue。

## Phase 5：「還不會／我會」操作區 fidelity 與互動回歸

### 目的

把操作區重建為 Prototype 的卡外雙按鈕，同時維持所有輸入方式及提交安全。

### Checklist

- [ ] 把兩個 action 從 draggable card 內移到 card stack 下方的獨立兩欄區。
- [ ] 左側採「還不會」+ left arrow、白色 surface、紅色 border/text。
- [ ] 右側採「我會」+ right arrow、deep-indigo surface、白色文字及 approved shadow。
- [ ] 兩按鈕同寬、最少 60px 高、18px radius，mobile 320px 不擠壓或換行失控。
- [ ] 補齊 hover、pressed、focus-visible、disabled、pending、dark 及 Forced Colors 狀態。
- [ ] 卡內 drag badge 同步使用「還不會／我會」，並保留方向辨識。
- [ ] 卡下 swipe guide 跟 Prototype 一致，keyboard hint 清楚但不重複造成 screen reader 噪音。
- [ ] button click 不啟動 drag；drag pointer capture 不吞掉 button activation。
- [ ] 左按鈕、ArrowLeft、左滑均只觸發一次 quality=2 pipeline。
- [ ] 右按鈕、ArrowRight、右滑均只觸發一次 quality=5 pipeline。
- [ ] disabled／pending 時 mouse、touch、keyboard、synthetic pointer 都不能重複提交。
- [ ] 保留 offline outbox、operationId、nonce、rotation、retry、cross-tab lease 及 checkpoint 測試。
- [ ] 加入按鈕 geometry、label、color token、focus、tap target 及 click/drag mutual-exclusion E2E。
- [ ] 在 Chromium、Firefox、WebKit、mobile emulation 及 synthetic pointer project 執行完整 card-motion suite。
- [ ] 更新本計劃及建立單一、可回退 checkpoint commit。

### 驗收

- 操作區在視覺、文案、位置和 feedback 上符合 Prototype；所有輸入路徑與伺服器語義無回歸。

## Phase 6：整體視覺、accessibility、回歸及發佈準備

### 目的

跨 surface 驗證修正完整性，記錄所有差異及 rollout／rollback 證據。

### Checklist

- [ ] 在 390×844、820×1180、1440×900 對照 home、learn Prototype/reference 與 implementation。
- [ ] 補驗 320×568、360×800、430×932、844×390、600×960、1024×768、1366×768、1920×1080。
- [ ] 驗證 safe-area top/right/bottom/left、iOS dynamic viewport、soft keyboard、tablet、desktop 及 wide desktop。
- [ ] 驗證 light/dark × Hant/Hans；沒有混合 script、低對比或首幀 locale/theme flash。
- [ ] 驗證 keyboard-only、focus order、skip link、nav active state、dialog、live region、44×44 target。
- [ ] 驗證 400% reflow、Forced Colors、WCAG text spacing、reduced motion 及 axe WCAG 2.2 AA。
- [ ] 完成至少一次 VoiceOver 或 NVDA smoke，特別覆蓋品牌、bottom nav、認字卡、actions 及 Coach dialog。
- [ ] 檢查所有 route auth handling、error state、no-store 個人化 response 及無 404／login loop。
- [ ] 確認 Dashboard 沒有呼叫 `GET /api/study`，詞表瀏覽仍為 read-only。
- [ ] 確認沒有 schema／migration 改動；如 scope 改變，先更新計劃並執行 migration 規則，不可事後補記。
- [ ] 記錄每個 Prototype 偏差的原因、影響、screenshot 及 reviewer acceptance。
- [ ] 執行第 10 節所有適用命令，記錄 pass/fail、測試數量、日期及環境。
- [ ] 修正所有本計劃引入的 P0/P1 問題；不可把失敗項目勾成完成。
- [ ] 完成 checkpoint commit，記錄 rollback commit／deployment target；未獲授權不得部署 production。
- [ ] 更新進度、實際測試、未執行項目、已知限制、Definition of Done 及索引狀態。
- [ ] 所有必要項目完成並獲驗收後，才把本文件狀態改為「已完成」。

### 驗收

- 所有成功準則及 Definition of Done 完成；沒有已知 P0/P1 UI、auth、資料一致性或 study workflow 問題。

## 8. Accessibility、i18n 及相容性要求

- StudentNav 使用具名稱的 `<nav>`，active item 使用 `aria-current="page"`。
- nav 被 guard 阻止時要有可理解的 live feedback，不以無反應代替安全處理。
- decorative card back、弧線及 drag feedback 不進入 accessibility tree。
- 兩個主要 action 使用真實 `<button>`，有 visible focus，不能只靠紅／紫色區分。
- screen reader 可理解目前 word、level、category、進度及可用操作，但避免重複朗讀 keyboard hint。
- Hant/Hans 轉換包括 visible copy、ARIA、title、toast、validation、error、metadata 及 live region。
- text-spacing override 後 nav label、badge、長 category 和 action 不裁切。
- Forced Colors 下卡片邊界、back layer、focus、left/right actions 仍可區分。
- `prefers-reduced-motion` 下 decorative effect 靜態保留，dismiss/return 不造成不必要動畫。
- mobile touch target 最少 44×44 CSS px；bottom nav 及 card actions 不互相遮擋。
- 不使用 `overflow-x:hidden` 掩蓋 reflow 或 swipe geometry 問題。

## 9. 安全、資料一致性及效能保護

- 不改 Auth.js、role guard、safe callbackUrl、mustChangePassword、tokenVersion 或最後管理員保護。
- 導覽 click 必須經既有 study exit guard；pending/blocked outbox 不可被靜默丟棄。
- 不改 server-issued study session、nonce、operationId、rotation 或 Serializable transaction。
- 不把 quality 或 SM-2 決定移到新的純 client 視覺元件。
- 不新增 `GET /api/study` 呼叫作 badge/category 或 Dashboard 統計；字卡資料已在現有 queue response。
- category 只顯示 response 中的真實值；null fallback 不得看似真實分類。
- decorative layer 不增加 layout thrash；drag frame 不讀取多個會引發 synchronous layout 的節點。
- nav／card shadow、blur 及 fixed layer 要在 mobile WebKit 檢查 compositing；避免不必要全頁 repaint。
- 個人化 response 繼續使用 private/no-store；本計劃不改公共 cache contract。
- 所有日期、streak、統計維持 Asia/Shanghai；本計劃不另建日期語義。

## 10. 測試矩陣與驗證指令

### 10.1 自動化指令

完成全部實作後至少執行：

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:db
npm run test:e2e:card-motion
npm run test:e2e:student-ia
npm run check:production-config
```

如新增獨立 locale／visual npm script，須在 Phase 0 記錄名稱並加入此節。`check:production-config` 在缺少 production secrets 的本地環境預期可能拒絕；可執行不連接外部服務的 shape-only 驗證，但不得把預期拒絕記成 production config 已通過。

如 DB command 在 sandbox 連接 `localhost:5432` 失敗，按 `AGENTS.md` 以獲准 escalated 權限重試。只有 schema／migration scope 真正改變時才執行 checksum、fresh replay 及適用 contract regression；不得執行 `npm run db:contract`。

### 10.2 功能及視覺矩陣

| 範圍 | 必要驗證 |
|---|---|
| Home nav | DOM presence、visible box、hit test、active Today、safe-area、scroll、real mobile reproduction |
| Study nav | assess/quiz/dialog/pending/blocked/done matrix、guarded exit、Back、explicit exit、checkpoint resume |
| Locale | first visit、Hant/Hans persisted、cookie/storage conflict、SSR/hydration、brand、ARIA、metadata |
| Spacing | loaded/error/loading/empty/checkpoint states、bounding-box gap assertions、Hant/Hans、text spacing |
| Badge | A1/A2/B1/B2、category Chinese/English/long/null、real API data、no fake fallback |
| Card stack | mobile/tablet/desktop geometry、dark、Forced Colors、pointer inert、no drag offset |
| Actions | click、Enter/Space、ArrowLeft/Right、mouse drag、touch、synthetic pointer、disabled/pending |
| Study safety | session、nonce、operationId、outbox、cross-tab lease、retry、rotation、Serializable transaction |
| Accessibility | axe、keyboard-only、VoiceOver/NVDA、dialog inert/focus return、live region、400% reflow |

### 10.3 Screenshot contract

每張圖須使用相同資料 fixture、locale、theme、route state 及 viewport，並記錄：

- Prototype reference path；
- before path；
- after path；
- geometry／spacing／type／color／navigation／component state 差異；
- 刻意偏差原因及批准結果。

核心對照：

- `home`：390×844、820×1180、1440×900；
- `learn` assess：390×844、820×1180、1440×900；
- `learn` null category、long category、dark、Hant/Hans、pending sync；
- mobile nav：320×568、390×844、430×932、844×390。

## 11. 風險登記

| ID | 風險 | 程度 | 預防／緩解 |
|---|---|---:|---|
| R1 | 恢復 StudyNav 後可繞過 pending／blocked guard | 高 | 單一 guarded navigation adapter；逐 state E2E |
| R2 | nav fixed layer 遮擋 card actions 或 Coach sheet | 高 | 真實 bounding box、safe-area、visual viewport、WebKit QA |
| R3 | 移動 actions 破壞 pointer capture／release motion | 高 | 保留 drag/flight ownership、test IDs、完整 card-motion suite |
| R4 | click 與 drag 同時觸發，產生重複提交 | 高 | input mutual-exclusion tests、disabled epoch、operationId regression |
| R5 | Hant leak 由 persisted Hans 被誤判為 converter bug | 中 | 記錄 locale state、分開 preference 與轉換測試 |
| R6 | 固定繁體品牌與簡體模式的產品預期不一致 | 中 | Phase 0 明確批准品牌專名 policy |
| R7 | category null 被 UI 假裝成真實主題 | 高 | approved fallback、coverage audit、不得示例填值 |
| R8 | spacing refactor 影響 loading/error/empty state | 中 | 全 state fixture、parent-owned gap、bounding-box assertions |
| R9 | decorative stack 影響 Forced Colors 或低階裝置效能 | 低至中 | 純 CSS、pointer-inert、無 blur animation、cross-browser QA |
| R10 | 實際手機看到的是舊 deployment，而本地修正無法驗證 | 高 | Phase 0 build/commit parity；未獲授權不部署但清楚記錄 blocker |

## 12. 發佈、觀察及 rollback

- 每個 Phase 使用內容單一、可回退 checkpoint commit；不把 locale、navigation、spacing、card motion 混成一個不可分離 commit。
- 建議 commit 順序：locale/brand → navigation → spacing → card fidelity → action fidelity → QA/docs。
- 每個 checkpoint 前先執行該 Phase 的最小充分測試；Phase 6 再執行完整矩陣。
- 如 navigation 修正造成 study guard 回歸，先回退 navigation checkpoint，不回退資料庫或其他已驗證 UI。
- 如 card visual refactor 造成 motion 回歸，先回退 Phase 4/5；不得用放寬 motion tests 掩蓋。
- 本計劃預期無 schema／migration；rollback 不涉及 database mutation。
- 合併或部署後觀察 mobile nav visibility、study exit attempts、duplicate/409 study submissions、client errors 及 Web Vitals。
- 未獲使用者明確授權不得 push、建立 PR 或部署 production；push 授權不等於 production deployment 授權。

## 13. 決策紀錄與未決事項

| 日期 | 項目 | 狀態 | 建議／決定 |
|---|---|---|---|
| 2026-08-12 | 修正來源 | 已決定 | 以今次實際使用回饋及 EMM Style 01 作修正 contract |
| 2026-08-12 | 原遷移計劃處理 | 已決定 | 保留已完成計劃作歷史；另建本 follow-up 計劃，不倒改舊 checklist |
| 2026-08-12 | 實作時機 | 已決定 | 先提交詳細計劃；未獲批准前不改 production code |
| 2026-08-12 | Study 導覽 | 已確認 | assess/done 顯示並可安全操作；quiz 顯示但由 guarded exit 阻止直接離開；dialog 背景 inert；pending/blocked 顯示但阻止離開 |
| 2026-08-12 | Home 導覽 root cause | 待重現 | 本地截圖有 nav，但實際 mobile 回饋沒有；先做 build／DOM／stacking／safe-area parity 核對 |
| 2026-08-12 | 品牌專名 | 已確認 | Hant/Hans 兩種模式都固定「見字會 SeeWord」，mark 固定「見」 |
| 2026-08-12 | Locale 支援 | 已決定 | 保留 Hant/Hans；新使用者預設 Hant，不把已明確選擇 Hans 的偏好靜默覆蓋 |
| 2026-08-12 | Locale precedence | 已確認 | 以有效 cookie 作 SSR／首幀唯一來源；mount 後將 localStorage 對齊 cookie；只有使用者明確透過 language control 切換時才同時更新 cookie、localStorage、`<html lang>` 及 server refresh |
| 2026-08-12 | Category 資料 | 已核對 | Prisma及現有 study response 已有 level/category；唯讀查詢共 5,532 詞，A1/A2/B1/B2 分別 599/1,444/1,575/1,914，category null 為 0（各 level null 均為 0）；Baseline 無需 migration |
| 2026-08-12 | Category null | 已確認 | 顯示真實 level + 本地化「未分類」，不補 Prototype 假 category |
| 2026-08-12 | Study 標題 | 已決定 | 主標題只保留「今日學習」 |
| 2026-08-12 | Card stack | 已決定 | 恢復 Prototype decorative back card，不能改變 gesture ownership |
| 2026-08-12 | Action design | 已決定 | 以 Prototype 的卡外「還不會／我會」雙按鈕為視覺 contract |
| 2026-08-12 | Spacing | 已確認 | 同層 section 24px、卡內 16px、緊湊控制 12px、desktop columns 48px，由 parent/container 單一擁有 |

## 14. 進度、驗證及限制紀錄

| 日期 | 階段 | 更新 | 驗證／證據 |
|---|---|---|---|
| 2026-08-12 | 計劃準備 | 完成 Prototype、現有 shell、study page、WordCard、locale、schema、API、CSS、測試及既有 screenshots 的唯讀盤點 | 確認 StudyNav 被 immersive render 條件移除；Brand mark 硬編碼簡體；level/category 已存在；現行 card/action 與 Prototype 有明顯差異；未修改 production code |
| 2026-08-12 | Phase 0 | 起始狀態已鎖定 | branch `codex/comprehensive-bug-fix`；HEAD `7dfbb6fe3edce781eed1df6117a3b3151ffd6a98`；起始工作樹只有本計劃及 `plans/README.md` 的計劃索引改動，沒有覆蓋其他使用者改動 |
| 2026-08-12 | Phase 0 | `/` mobile baseline 已做 DOM／幾何檢查 | 本地 dev、登入 student、`zh-Hant`、390×844：bottom nav DOM 存在，`position:fixed`、`z-index:25`、`y=779`、`height=65`、`padding-bottom=6px`；`scrollWidth=390`，未重現「首頁完全沒有 nav」。desktop rail 在 mobile 為 0×0，符合 CSS breakpoint |
| 2026-08-12 | Phase 0 | `/study` baseline 已核對程式 contract | `StudentShell` 以 `pathname.startsWith("/study")` 設定 `is-immersive`，並不 render rail、mobile header、bottom nav；globals CSS 亦將三者 `display:none`。本地 dev browser 另見 page 停在 `加載中...`、沒有 `/api/study` request；dev log 記錄 `127.0.0.1` 被 Next HMR/font cross-origin policy 阻擋，故不能把此 dev loading 當成正式視覺結論，需以 production build／E2E 補驗 |
| 2026-08-12 | Phase 0 | production `/study` baseline 已完成 | `npm run build` 成功（38 routes）；production server、登入 student、`zh-Hant`、390×844 顯示真實 `green` 字卡，`navs=[]`、shell=`student-shell is-immersive`、`scrollWidth=390`。現行卡面 `x=16,y=229.39,w=358,h=480`；卡內 actions 48px 高，位置約 `y=640.39`；標題仍是「今日學習 · 認識這個單詞嗎？」。截圖：`output/playwright/phase0/learn-prod-390x844.png` |
| 2026-08-12 | Phase 0 | production 首頁 spacing baseline 已完成 | 390×844 loaded real-data state：header→banner 32px、banner→next-session 0px、next-session→stats 24px、stats→library 24px、library→links 24px；direct child margin 由多個 child 自行持有。bottom nav `x=0,y=779,w=390,h=65,z=25,padding-bottom=6px`，`scrollWidth=390`。截圖：`output/playwright/phase0/home-prod-390x844.png` |
| 2026-08-12 | Phase 0 | Word category coverage 已完成唯讀查詢 | runtime 使用 `.env.local` 的 `english_dev`；`npx prisma migrate status` 顯示 19 migrations、schema up to date。Prisma read-only query：total 5,532、category null 0、A1/A2/B1/B2 = 599/1,444/1,575/1,914、各 level null category `[]`；top categories 包括 Health and Sickness 94、Common Verbs 90、The Weather 83。沒有 seed、migration、db push 或資料寫入 |
| 2026-08-12 | Phase 0 | dev baseline limitation | 目前本地 dev server 的 browser console 有 `GET /__nextjs_font/geist-latin.woff2 403` 及 HMR WebSocket cross-origin errors；這是 baseline 環境限制，正式修正與視覺驗收改用 production build／既有 Playwright webServer，並保留錯誤證據 |
| 2026-08-12 | Phase 0 | 決策已確認 | 使用者確認採用四項建議：Study 導覽 state matrix、固定 Traditional 品牌、`<level> · 未分類` fallback、parent-owned spacing contract；Action hierarchy 及「今日學習」亦按既有回饋凍結 |
| 2026-08-12 | Phase 0 | locale precedence baseline | production browser：Hant cookie/storage → `html lang=zh-Hant`、title「英語單詞認讀 · 中學生學習平臺」、brand mark=`见`；Hans cookie/storage → `html lang=zh-Hans`、title「英语单词认读 · 中学生学习平台」、品牌名称為 `见字会`。Conflict（cookie Hant、localStorage Hans）完成後 localStorage 優先、cookie 被同步為 Hans，確認需在 Phase 1 修正首幀一致性；沒有修改現有偏好資料 |
| 2026-08-12 | Phase 0 | deployment parity limitation | 未獲 deployment URL／commit，未執行 push 或部署；以同一 HEAD 的 production build、authenticated E2E 及 390px browser baseline 作等價驗證。實際使用者 reported 的首頁完全無 nav 未能在此 build 重現，Phase 2 仍會加入固定層、safe-area、hit-test 及 active state regression |
| 2026-08-12 | Phase 1 | 品牌與 locale contract 已實作 | `BrandLockup` 固定使用批准的「見字會 SeeWord」／「見」；SSR 首幀只採有效 locale cookie，mount 後同步 localStorage，明確切換才更新兩個 store、`<html lang>`、title 及 RSC refresh。沒有取消 Hant/Hans 支援，亦沒有改 Auth.js 或 study workflow |
| 2026-08-12 | Phase 1 | 自動化驗證已通過 | `npm test`：97 passed；`npm run lint`：pass；`npx tsc --noEmit`：pass；`npm run build`：pass，38 routes；`npm run test:e2e:student-ia`：12 passed（包括 Hant/Hans、brand、role、student shell）；`npx playwright test tests/e2e/locale-routes.spec.ts --project=locale-student-chromium`：2 passed（含 auth setup dependency） |
| 2026-08-12 | Phase 1 | locale／資料轉換測試已補齊 | 新增 `src/lib/i18n/config.test.ts`、`src/lib/i18n/convert.test.ts`；覆蓋 default、alias、invalid preference、cookie conversion、A1–B2、category shape、英文 term、phonetic 及混合字串；`npm test` script 已納入 `src/lib/i18n/*.test.ts`，避免 nested tests 漏跑 |
| 2026-08-12 | Phase 1 | route 漏字與視覺 evidence | 新增 `tests/e2e/locale-routes.spec.ts`，逐一 smoke `/`、`/study`、`/words`、`/stats` 的 `zh-Hant` body；login fixture 在 390×844 產生 `output/playwright/phase1/login-zh-Hant-light-390x844.png`、`login-zh-Hant-dark-390x844.png`、`login-zh-Hans-light-390x844.png`、`login-zh-Hans-dark-390x844.png`，已逐張目視核對品牌、語系、明暗主題及 mobile language control |
| 2026-08-12 | Phase 1 | 未執行項目及限制 | 本 Phase 沒有 Prisma schema／migration、study gesture、production config 或資料寫入改動，故未執行 `npm run test:db`、`npm run test:e2e:card-motion`、migration checks 或 `npm run check:production-config`；這些會在適用的後續 Phase／Phase 6 執行。未獲 deployment URL，仍保留 deployment parity limitation |
| 2026-08-12 | Phase 2 | 導覽 state adapter 已實作 | 新增 `StudentNavigationProvider`，把 `/study` 導覽狀態（loading／assess／quiz／done／error／locked）、guard、dialog inert 和 `StudentNav` 共用；移除 `is-immersive` 對 rail／bottom nav 的全隱藏行為。desktop study 顯示 rail，mobile study 顯示 bottom nav，`/study` active item 具 `aria-current=page` |
| 2026-08-12 | Phase 2 | 導覽安全與 accessibility regression | 新增 `tests/e2e/study-navigation.spec.ts`：assess、quiz guarded exit、pending sync、done、Coach dialog inert/focus trap/focus return、browser Back、mobile hit target、safe-area padding、orientation/visual-viewport-like resize、scroll；blocked/pending 不會觸發離開。更新 `SpeechRateControl` 的 mobile offset，避免覆蓋第一項 nav，並將新增 ARIA／文案改走 `tc()` |
| 2026-08-12 | Phase 2 | 視覺 evidence | `output/playwright/phase2/study-nav-mobile-390x844.png`、`study-nav-desktop-1440x900.png` 已以 production build、real authenticated student、real queue 目視核對；mobile 四項 nav、active 學習、card/actions、safe-area 與語速控件沒有互相遮擋；desktop rail 與 study surface 同時可見 |
| 2026-08-12 | Phase 2 | 自動化驗證已通過 | `npm run build`：pass，38 routes；focused navigation：13 passed（desktop 6 + mobile 7，desktop-only mobile tests 2 skipped）；`npm run test:e2e:student-ia`：19 passed、1 skipped；`npm run test:e2e:card-motion`：card/study primary 73 passed、4 skipped；WebKit study shard 1：17 passed，shard 2：16 passed；`npm test`：97 passed；`npm run lint`：pass；`npx tsc --noEmit`：pass |
| 2026-08-12 | Phase 2 | 已知限制 | Playwright 可驗證 fixed nav 在 visual viewport 高度變更及 scroll 下的行為，但未啟動原生 iOS soft keyboard／實機 VoiceOver；原生 keyboard smoke 保留至 Phase 6。沒有 schema、migration、DB 寫入或 production deploy 改動 |
| 2026-08-12 | Phase 3 | Parent-owned spacing rhythm 已實作 | 新增 `src/components/student/StudentPageStack.tsx`；Dashboard、Words、Stats 的 header、section、loading、error、empty、checkpoint 及 loaded siblings 均由語義 stack 管理。移除相鄰 student surface 的 child `margin-bottom`，保留 card 內 16px group、control 12px、desktop two-column 48px token gap；沒有使用 `overflow-x:hidden` |
| 2026-08-12 | Phase 3 | 320px reflow 修正及自動化證據 | 新增 `tests/e2e/student-spacing.spec.ts` 及兩個 authenticated Playwright projects；`/`、`/words`、`/stats` 在 320/390/430/820/1440 的 page/section sibling gap 及 document width 通過 ±1px／no-overflow assertion。WCAG text-spacing override（line-height 1.5、letter-spacing 0.12em、word-spacing 0.16em、paragraph spacing 2em）在 320px 兩 project 通過；過程中發現 `/words` 6px min-content overflow，已以 page header、stack/card child 及 bottom-nav grid `min-width: 0`／`minmax(0, 1fr)` 修正 |
| 2026-08-12 | Phase 3 | Visual／accessibility evidence | `output/playwright/phase3/home-spacing-mobile-390x844.png`、`home-spacing-tablet-820x1180.png`、`home-spacing-desktop-1440x900.png` 已以 real authenticated data 產生並目視核對；mobile、tablet、desktop 的 section rhythm、固定 nav 及 content separation 可解釋。axe WCAG 2A/2AA `/`、`/words`、`/stats`：兩個 project 均 0 violations |
| 2026-08-12 | Phase 3 | 驗證結果及限制 | `npm run lint` pass；`npx tsc --noEmit` pass；`npm run build` pass（38 routes）；spacing／screenshot／reflow matrix：7 passed（含 auth setup）；axe smoke：3 passed（含 auth setup）。本 Phase 沒有 schema、migration、study gesture、DB 寫入或 production config 改動，故 `npm test`、`npm run test:db`、`npm run test:e2e:card-motion`、`npm run check:production-config` 留待 Phase 6／適用 scope；原生 VoiceOver/NVDA、實機 soft keyboard 仍是 Phase 6 驗收項目；Phase 3 checkpoint commit 已建立並可由 git history 回退 |
| 2026-08-12 | Phase 4 | 認字資訊層級及真實資料已實作 | Study 標題改為 `今日學習`；`WordCard` 接收並呈現現有 `/api/study` queue 的 level/category，category 採 `tc()`，null fallback 為本地化 `未分類`，沒有加入 Prototype 示例資料；新增 `認讀卡` context、真實 queue position note 及短 hint |
| 2026-08-12 | Phase 4 | Prototype card stack 已實作 | 新增 pointer-inert、`aria-hidden` decorative back card、右上 arc、Prototype card proportion、badge、shadow、radius 及 dark/Forced Colors 規則；drag layer 仍是唯一 transform／pointer capture owner。isolated motion harness 保留原有約 400px geometry，避免 production card 擴至 Prototype desktop 約 640px 後改變既有 gesture threshold contract |
| 2026-08-12 | Phase 4 | Visual／accessibility evidence | `output/playwright/phase4/learn-card-mobile-390x844.png`、`learn-card-tablet-820x1180.png`、`learn-card-desktop-1440x900.png` 以 real authenticated student、real queue 產生並目視核對；study-card fidelity：8 passed、1 desktop-only capture skipped；desktop/mobile real-data structure、dark/reduced-motion/Forced Colors、geometry、axe WCAG 2A/2AA 均通過 |
| 2026-08-12 | Phase 4 | Fixture、回歸及限制 | `npm run lint` pass；`npx tsc --noEmit` pass；`npm run build` pass（39 routes）；`word-card-fidelity-fixtures` 320/390：4 passed，覆蓋 B2、null category、長 category、缺 phonetic、Hant/Hans 及 WCAG text-spacing no-overflow；`npm run test:e2e:card-motion` primary 73 passed、4 skipped，WebKit study shard 1/2 分別 17/16 passed。過程中發現並修正展示層 pointer hit-test 覆蓋 study actions 及 motion harness geometry regression，修正後全套通過。Phase 5 仍負責將 actions 移到 card 外；VoiceOver/NVDA、原生 soft keyboard、完整 viewport/safe-area matrix 留待 Phase 6；沒有 schema、migration、DB 寫入或 production config 改動；Phase 4 checkpoint commit 將隨本次記錄更新建立 |

實作開始後，每個 Phase 在此新增：

- 實際完成項目；
- 實際執行命令及 pass/fail／測試數量；
- screenshot／visual diff 路徑；
- 未執行項目及原因；
- 已知限制及 follow-up；
- checkpoint commit hash。

## 15. Definition of Done

- [ ] Phase 0–6 所有必要 checklist 已完成，或有使用者明確批准並記錄的例外。
- [ ] Home 及認字 mobile 導覽問題在使用者實際環境或等價 build/viewport 中已重現並驗證修正。
- [ ] 所有可見導覽目的地可操作，沒有 404、login loop 或 placeholder。
- [ ] Study 導覽符合 approved state matrix，沒有 checkpoint/outbox/session/nonce/operationId 回歸。
- [ ] `zh-Hant` 無已知簡體漏字，`zh-Hans` 仍完整可用，品牌 policy 有測試保護。
- [ ] 首頁及相關學生 surface spacing 符合數值 contract，沒有未解釋例外。
- [ ] 認字頁主標題、level/category、認讀 context、card stack 及 actions 符合 Prototype contract。
- [ ] Prototype 示例 A2、日常生活、固定數量或示例單詞沒有進入 production fallback。
- [ ] light/dark、Hant/Hans、keyboard、mouse、touch、synthetic pointer、reduced motion、Forced Colors 全部通過。
- [ ] WCAG 2.2 AA、axe、400% reflow、text spacing 及 VoiceOver/NVDA smoke 有保存證據。
- [ ] `npm test`、lint、typecheck、build、DB、card-motion、student IA 及 production config 的適用結果已記錄。
- [ ] 沒有已知 P0/P1 UI、auth、資料一致性或 study workflow 問題。
- [ ] 每個完成 Phase 有內容單一、可回退 checkpoint commit，工作樹沒有未解釋改動。
- [ ] 所有 visual comparison、偏差、實際命令、未執行項目及限制已寫入本文件或連結的 QA artifact。
- [ ] `plans/README.md` 索引狀態與本文件一致。
- [ ] 完成以上條件後，本文件狀態才改為「已完成」。
