# EMM Style 01 設計系統遷移計劃

> 狀態：待審批
>
> 建立日期：2026-08-11
>
> 最後更新：2026-08-11
>
> 最近審核：2026-08-11（兩個獨立 Subagent + 主線程式核對）
>
> 設計來源：`/Users/hangwong/Documents/Design/emm_style_01/`
>
> 實施範圍：學生端、登入／改密碼、教師端及管理端
>
> 主要技術：Next.js 16、React 19、TypeScript、Tailwind CSS 4、Framer Motion

## 1. 背景

現有 App 已具備滑動認字、即時測試、SM-2、學習續接、單元解鎖、統計、成就、排行榜、教師端及管理端，但各頁主要以獨立 Tailwind class 組成，桌面版仍多數限制在約 420px，學生端沒有一致的 App shell 或持續導覽。

EMM Style 01 prototype 定義了一套較完整的學生端產品語言：深靛紫主色、明亮中性背景、桌面側欄、手機底部導覽、今日任務卡、續接卡、堆疊認讀卡、教認字 bottom sheet、詞表及統計頁。今次工作要將這套視覺及互動語言轉成正式、可維護、使用真實資料的產品 UI。

Prototype 的 `index.html` 只屬導覽頁。實作時以以下文件作主要視覺 contract：

- `assets/see-word.css`
- `assets/see-word.js`
- `assets/theme.js`
- `home.html`
- `learn.html`
- `login.html`
- `words.html`
- `stats.html`
- `brand-spec.md`
- `DESIGN-HANDOFF.md`
- `DESIGN-MANIFEST.json`

Prototype 內的「小明」、`13` 個單詞、`A2`、連續 `6` 天等均為靜態示例，不可直接帶入 production。

## 2. 目標

- 建立正式 design tokens，取代分散的硬編碼顏色、圓角、陰影及 spacing。
- 建立可重用的學生 App shell、桌面側欄及手機底部四項導覽。
- 將登入、首頁、學習、單元、排行榜、成就、教師端及管理端統一到同一品牌語言。
- 新增學生詞表及完整個人統計頁。
- 保留現有認證、角色守衛、SM-2、study session、nonce、operationId、checkpoint、outbox、retry 及單元解鎖語義。
- 支援簡體／繁體、明色／暗色、keyboard、mouse、touch、synthetic pointer 及 reduced motion。
- 在手機、平板及桌面形成同一套 adaptive web experience，避免桌面只是放大的手機畫面。

## 3. 非目標

- 不在本計劃內更換 SM-2 或重新設計學習調度算法。
- 不在本計劃內更換 Auth.js、Prisma、PostgreSQL 或部署平台。
- 不因 prototype 有靜態資料而新增虛假年級、預設 level、頭像或統計。
- 不在沒有內容來源及授權方案時批量生成例句、圖片或助記文案。
- 不把教師端／管理端強行套成學生端四分頁佈局。
- 不以 `prisma db push` 代替 migration。
- 不在換 UI 時順帶重寫 `/study` 的業務狀態機。

## 4. 成功準則

- [ ] 所有 production UI 使用語義化 design tokens；不再新增散落的品牌色 hex 值。
- [ ] 學生端在 mobile 顯示四項 bottom nav，在 desktop 顯示左側 rail。
- [ ] 任何已啟用導覽項目都有可用 route、auth handling、loading／empty／error state，不出現 404 或無功能 placeholder。
- [ ] `/` 對登入學生顯示真實今日 Dashboard，不顯示 prototype 假數據。
- [ ] Dashboard、詞表、單元及統計對「下一輪、今日新學、今日複習、已學、認字率、長期掌握」使用同一份已記錄口徑。
- [ ] `/study` 所有現有學習、安全及續接回歸測試保持通過。
- [ ] 新增 `/words`，支援 level、category、pagination、空狀態及單詞詳情。
- [ ] 新增 `/stats`，清楚區分「已學進度」與「長期掌握」。
- [ ] `/units`、`/leaderboard`、`/achievements` 可從新資訊架構自然到達。
- [ ] 教師端及管理端在桌面使用高密度 workspace 佈局，在手機保持可操作。
- [ ] 明暗主題切換無首幀閃爍，簡繁切換無固定語言文案遺漏。
- [ ] 360px 至 1920px 指定 viewport 無非預期水平 scroll 或控制項遮擋。
- [ ] 達到 WCAG 2.2 AA；鍵盤焦點、dialog focus、ARIA、reduced motion、reflow 及顏色對比通過自動及人工檢查。
- [ ] Login、home、learn、words、stats 在指定 reference viewport 完成 prototype／實作 screenshot 對照並獲審批。

## 5. 現況與缺口

| 範圍 | 現況 | 目標 | 改動類型 |
|---|---|---|---|
| Design tokens | `globals.css` 有部分 tokens，但 JSX 仍大量硬編碼藍色 | 完整語義 tokens 及 dark theme | 基礎重構 |
| 字體 | Geist 配合系統字體 | 英文 display 與中文 body 有清楚角色 | 基礎重構 |
| 學生導覽 | 每頁自行提供返回連結 | mobile bottom nav、desktop rail | 新增 shell |
| Theme／語言 | 固定右下浮動按鈕 | 移入 topbar、rail footer 或帳戶控制 | 元件重構 |
| `/` | 公開 landing／功能選單 | 個人化今日 Dashboard | 頁面及資料改造 |
| `/study` | 功能完整、視覺分散 | prototype 認讀卡及 coach sheet 語言 | 高風險視覺重構 |
| `/words` | 不存在 | 學生只讀詞表 | 新 route + API |
| `/stats` | 不存在 | 統一個人學習分析 | 新 route + API |
| `/units` | 獨立 mobile-width 頁 | 詞表內次級入口、adaptive layout | 頁面重構 |
| 排行榜／成就 | 首頁兩個獨立按鈕 | 統計頁內次級入口 | 資訊架構調整 |
| 教師／管理員 | 主要限制於 420px | responsive workspace | layout 重構 |
| Auth／role route | proxy、role helper、login fallback 及各 layout 分散定義 | 一份 route／role／redirect contract | 契約整理 |
| 自動化驗證 | 既有 Playwright 聚焦字卡及學生學習流程 | 加入 shell、導覽、角色及新 API harness | 測試擴充 |

## 6. 目標資訊架構

### 6.1 學生主導覽

| 導覽項目 | 主 route | Active route 範圍 |
|---|---|---|
| 今日 | `/` | `/` |
| 學習 | `/study` | `/study` 及其 query-string 模式 |
| 詞表 | `/words` | `/words`、`/units` |
| 統計 | `/stats` | `/stats`、`/leaderboard`、`/achievements` |

推薦預設決定：

- 未登入使用者開啟 `/` 時轉到 `/login`。
- 如日後需要 marketing landing，另建 `/welcome`。
- Bottom nav 第三項保留 prototype 文案「詞表」。
- `/words` 頁內提供「詞表／單元闖關」分段切換。
- `/stats` 提供排行榜及成就次級入口。

### 6.2 Route group 建議

```text
src/app/
  layout.tsx
  login/page.tsx
  reset-password/page.tsx
  (student)/
    layout.tsx
    page.tsx
    study/page.tsx
    units/page.tsx
    words/page.tsx
    stats/page.tsx
    leaderboard/page.tsx
    achievements/page.tsx
  teacher/
    layout.tsx
    page.tsx
    students/page.tsx
  admin/
    layout.tsx
    page.tsx
    users/page.tsx
    words/page.tsx
```

Route group 搬移不能改變公開 URL；搬移前後要核對 `src/proxy.ts`、Auth callback、Link、Playwright route 及 redirect。

### 6.3 Route、角色與 redirect contract

Phase 0 必須先凍結完整矩陣，不能只靠「學生頁」或「保留角色跳轉」等籠統描述。建議目標如下；標記「待決定」的行為在確認前維持現況：

| 情況 | 建議結果 |
|---|---|
| 未登入開啟 `/` | `/login`；如保留 marketing landing，改用獨立 `/welcome` |
| 未登入開啟受保護學生頁 | `/login?callbackUrl=<安全相對路徑>` |
| 未登入呼叫受保護學生 API | `401` JSON，不作 HTML redirect |
| STUDENT 無 callback 登入 | `/` Today Dashboard |
| TEACHER 無 callback 登入／開啟 `/` | `/teacher` |
| ADMIN 無 callback 登入／開啟 `/` | `/admin` |
| 已登入角色開啟 `/login` | 回到 `homePathFor(role)`，不可形成 `/login` ↔ `/` 循環 |
| `mustChangePassword=true` | 先到 `/reset-password`，完成後只返回已驗證的 callback |
| TEACHER／ADMIN 開啟 `/study`、`/units` | 待 Phase 0 決定；確認前不得收窄現有「任何已登入角色可用」行為 |
| TEACHER／ADMIN 開啟新增 `/words`、`/stats` | 待 Phase 0 決定，並與 StudentShell account navigation 一併定義 |

這份 contract 要同步落到 `src/proxy.ts`、`src/lib/roles.ts`、`src/app/login/page.tsx`、Student layout 的 server-side guard、API `requireUser()`／`requireRole()` 選擇及自動化測試。

### 6.4 分階段導覽上線約束

Phase 2 會建立四項 StudentNav，但 `/words`、`/stats` 的完整版本安排在 Phase 4。不得因此在 Phase 2 上線兩個 dead links。Phase 0 必須從以下方式選定一個：

1. Phase 2 同時交付兩個具真實內容、auth 及 error state 的最低可用 route，Phase 4 再擴充；或
2. Phase 2 合併 shell，但以受 production config 檢查的 feature switch 延遲新版四項導覽，待 Phase 4 routes 完成後原子啟用。

不可用空白 placeholder、404，亦不可把「詞表」靜默連到語義不同的頁面。任何 feature switch 只控制展示，不可繞過 auth、study session 或資料守衛。

## 7. 目標設計系統

### 7.1 Token 類別

- Color：background、surface、foreground、muted、border、soft、accent、accent-strong、danger、danger-strong、success、warning、magenta focus。
- Typography：display、body、caption、label、numeric display、code。
- Spacing：8、12、16、24、32、48px。
- Radius：8、14、16、18、24、28、full。
- Shadow：small、card、elevated、sheet。
- Motion：fast 180ms、normal 240ms、sheet 320ms、card release 由現有 motion engine 控制。
- Layout：content 720px、wide 1120px、rail 236px、mobile safe-area。

### 7.2 Theme 實作原則

- 保留現有 `.dark` ThemeProvider 架構及 hydration 前初始化 script。
- 將 prototype dark tokens 映射到 `.dark`，不改用第二套 `data-theme` 狀態。
- 在 Tailwind v4 `@theme inline` 將語義 CSS variables 映射成 utilities。
- OKLCH 前可提供 hex fallback；Safari、WebKit 及 forced-colors 模式要驗證。
- Primary action 只用深靛紫；避免繼續新增藍紫 gradient 作所有 CTA。
- 紅色只用於「還不會」、錯誤、警告及 destructive action。
- 青綠只用於完成、保存及成功狀態。

### 7.3 字體原則

- 英文單詞、大數字及拉丁 display：Inter variable 或視覺等價 fallback。
- 中文 body：Noto Sans TC、PingFang TC、Microsoft JhengHei、sans-serif。
- 僅載入必要 weight；評估 self-hosted 或 system fallback，避免 build-time 遠端字體依賴。
- 550 weight 必須確認 variable font 可正確呈現，否則使用 500／600 明確替代。

### 7.4 共用元件清單

- `BrandLockup`
- `Icon`
- `Button`
- `IconButton`
- `Card`
- `StatCard`
- `PageHeader`
- `ProgressBar`
- `StatusBanner`
- `Toast`
- `Skeleton`
- `EmptyState`
- `SegmentedControl`
- `FilterChip`
- `BottomSheet`
- `StudentShell`
- `StudentNav`
- `AccountControls`
- `AuthShell`
- `WorkspaceShell`

Navigation 及 status icon 使用一致 SVG；成就 emoji 可保留作內容。

### 7.5 Primitive accessibility contract

Accessibility 要在 Phase 1 元件介面固定，不能留到 Phase 6 才補：

- `ProgressBar`：提供可本地化 label，以及 `role="progressbar"`、`aria-valuemin`、`aria-valuemax`、`aria-valuenow`；純裝飾進度條則對 assistive technology 隱藏。
- `SegmentedControl`：按實際行為使用 navigation links、pressed buttons、radio group 或 tabs；只有真正控制同頁 tab panel 才使用 tab semantics。
- `FilterChip`：提供明確 selected／pressed state，不只靠背景色。
- `Skeleton`：placeholder 對 assistive technology 隱藏；外層只提供一次 loading status，避免逐格朗讀。
- `Toast`／`StatusBanner`：預先定義 `status`、`alert`、live-region priority、dismiss 行為及 dismiss 後 focus。
- `IconButton`：必須有本地化 accessible name；裝飾 SVG 使用 `aria-hidden="true"`。
- Form：錯誤欄位使用 `aria-invalid`、`aria-describedby` 並連結 helper／error；鎖定倒數及提交結果可被朗讀。
- `StudentNav`：使用具名稱的 `<nav>`，目前頁使用 `aria-current="page"`，非目前頁省略該 attribute。
- Account menu：支援鍵盤開啟、Escape、focus return、outside click 及 44×44px target。
- App shell：提供 skip link 及可 focus 的 `<main>` target；route transition 後有可預測的 heading／focus 策略。

### 7.6 簡繁與文案 contract

- 現有 App 以簡體中文作 source locale，再由 `tc()`／`convertForServer()` 轉為繁體；prototype 繁體文案要先整理成簡體 source，不可直接把繁體字串傳入轉換器。
- 可見正文、ARIA label、title、validation、API error、toast、chart label、日期、metadata 及空狀態全部受同一規則約束。
- 英文單詞、音標、數字、level、category 及中英混合內容要有 fixture，避免 OpenCC 誤轉內容資料。
- 建立核心術語表，至少固定「下一輪學習、今日新學、今日複習、已學、認字率／解鎖進度、長期掌握」的簡繁名稱及解釋。

## 8. 資料 contract

### 8.1 Dashboard summary

建議新增 `GET /api/student/dashboard`，回傳：

```ts
interface StudentDashboardResponse {
  nextSession: {
    dueBacklogCount: number;
    dueCount: number;
    availableNewCount: number;
    newCount: number;
    total: number;
  };
  today: {
    reviewedWordCount: number;
    newWordCount: number;
    reviewEventCount: number;
  };
  library: {
    totalWords: number;
    learnedCount: number;
    learnedRate: number;
    masteredCount: number;
    mastery: number;
  };
  streak: {
    count: number;
    studiedToday: boolean;
  };
}
```

約束：

- Dashboard 不得呼叫 `GET /api/study` 取得數量，避免無意簽發 study session 或消耗 queue rate limit。
- `nextSession.dueCount`、`newCount` 是下一輪 queue 的可展示數量，分別遵守現有最多 20 due／5 new、unlock filter 及 queue eligibility；`dueBacklogCount`、`availableNewCount` 則是未套上 session cap 的 backlog。
- `nextSession.total = dueCount + newCount`。Baseline UI 必須稱為「下一輪學習」，不可把會隨每次讀取而改變的 aggregate 假裝成固定「今日任務」。
- 如產品要求一個跨 reload、完成後不再補入新詞的固定每日任務及 completion denominator，需要先設計 persisted daily-plan contract，並按第 8.4 節另開 schema／migration 計劃。
- `today.reviewedWordCount` 沿用現有 `/api/study/stats` 的唯一 Review row／`lastReviewedAt` 口徑；`newWordCount` 沿用 `totalReviews=1` 的現有口徑；`reviewEventCount` 只計 `eventKind=REVIEW AND isHistorical=false`。
- `learnedCount`／`learnedRate` 重用 `MASTERED_REPETITIONS`；`masteredCount`／`mastery` 重用 `MASTERED_MIN_INTERVAL`，不可另創閾值。
- 今日界線及 streak 使用現有 Asia/Shanghai helpers。
- 先抽出 shared aggregation helper，讓現有 `/api/study/stats` 與 Dashboard 共用；不可複製一套逐漸分歧的統計查詢。
- 個人化回應設定 `Cache-Control: private, no-store`，錯誤 payload 不包含 email、session id、nonce 或 checkpoint 資料。
- Baseline server response 不包含 `resume`。Dashboard client 只可從 owner-scoped `loadCheckpoint()` 判斷是否顯示不含詞名／百分比的通用「繼續學習」CTA；進入 `/study` 後仍由既有 server resume flow 驗證 session provenance。
- 如要顯示 server-confirmed 詞名、quiz phase、準確進度或跨裝置 resume，必須另設 read-only contract；不可直接信任 localStorage word ID 或把 `GET /api/study` 當摘要 API。

### 8.2 學生詞表

建議新增 `GET /api/words`：

```ts
interface StudentWordListResponse {
  items: Array<{
    id: string;
    term: string;
    phonetic: string | null;
    pos: string | null;
    definition: string;
    level: "A1" | "A2" | "B1" | "B2";
    category: string | null;
    learned: boolean;
    mastered: boolean;
    status: "unseen" | "learning" | "due" | "mastered";
    nextReviewAt: string | null;
  }>;
  nextCursor: string | null;
  total: number;
  availableLevels: Array<"A1" | "A2" | "B1" | "B2">;
  availableCategories: string[];
}
```

約束：

- 按 Phase 0 route matrix 使用 `requireUser()` 或更窄角色守衛；不可重用 admin route 或向學生暴露管理欄位。
- 驗證 level、category、cursor、limit；設定合理最大 page size。
- Query 必須由 PostgreSQL 聚合／join 個人 Review，避免 N+1。
- `learned` 固定為 `repetitions >= MASTERED_REPETITIONS`，`mastered` 固定為 `interval >= MASTERED_MIN_INTERVAL`；未有經驗證公式前不顯示 prototype 的 per-word 百分比。
- `status` 的優先次序及 `due` 定義要由純函數集中處理，並用同一 fixture 驗證 Words、Units、Stats 顯示一致。
- `total` 是套用 level／category／可見性政策後的總數；`availableCategories` 跟隨已選 level 及可見性政策。
- Cursor 使用已記錄的穩定排序，例如 `(term, id)`；測試並列 term、防重／防漏及游標期間刪詞。
- Phase 0 先決定鎖定內容政策：只回已解鎖詞；只回鎖定單元 metadata；或明確批准完整詞庫預覽。確認前不可無意把未解鎖 term／definition 暴露到新 API。
- 詞表及詳情必須完全 read-only：不得建立 Review、解鎖單元、簽發 study session 或改變 queue。
- 單詞詳情可由列表 payload 或獨立受保護 endpoint 提供。
- 個人狀態回應使用 `Cache-Control: private, no-store`。
- Core 版本使用現有 Word schema，不需要 migration。

### 8.3 統計 insights

建議新增 `GET /api/study/insights?days=7`，回傳：

- 今日已複習單詞數、REVIEW event 數及新學單詞數。
- 已學進度及長期掌握。
- 最近 7 日 REVIEW event count。
- 最近學習單詞及下一次複習資訊。
- 連續打卡及月曆資料。

約束：

- `days` 必須是整數，建議限制為 1–60；非法值回 `400`。
- 活動圖只計 `ReviewEventKind.REVIEW` 且 `isHistorical=false`。
- PostgreSQL 日期桶明確使用 `createdAt AT TIME ZONE 'Asia/Shanghai'` 或經驗證的等價 helper，不可用 `toISOString().slice(0, 10)` 代替本地日期。
- 跨午夜 fixture 覆蓋 `23:59:59+08:00` 及 `00:00:00+08:00`。
- 最近學習以 `ReviewEvent.wordTerm` snapshot 支援已刪除 Word；如 `wordId=null`，`nextReviewAt` 亦為 `null`。
- 重用現有 stats、streak、learned／mastered helpers，不建立第三套口徑。
- UI 必須分開命名「已學進度」及「長期掌握」，不可將兩者合成一個模糊百分比。
- 個人化回應使用 `Cache-Control: private, no-store`。

### 8.4 Schema 邊界

Baseline 遷移不需要 Prisma schema 變更。以下需求如獲確認，才另開 migration 計劃：

- 學生年級／班別。
- 學生預設或目前 level。
- 自訂 avatar。
- 獨立文字助記 cue。
- 跨裝置 server-side resume summary。
- 固定每日任務／每日 queue snapshot 及穩定 completion denominator。

## 9. 分階段實施計劃

## Phase 0：鎖定規格與建立 baseline

### 目的

在改動代碼前確認資訊架構、視覺 contract、真實資料語義及回歸邊界。

### Checklist

- [x] 盤點 prototype index、manifest、CSS、JS、六個 HTML 畫面及附帶截圖。
- [x] 盤點現有學生、教師、管理員 route、元件、API、schema 及測試。
- [x] 確認 prototype 只定義學生端，不應直接複製到教師／管理員。
- [ ] 確認未登入 `/` 預設轉到 `/login`。
- [ ] 確認 bottom nav 第三項使用「詞表」。
- [ ] 確認 `/words` 內以「詞表／單元闖關」分段切換保留 `/units`。
- [ ] 確認排行榜及成就歸入統計次級入口。
- [ ] 確認教師／管理員在同一項目後期完成，而非另開獨立設計項目。
- [ ] 凍結第 6.3 節完整 route／role／redirect matrix，包括 `/`、全部學生頁、學生 API、各角色、safe callback、mustChangePassword、session expiry 及已登入開 `/login`。
- [ ] 決定 TEACHER／ADMIN 是否保留直接使用 `/study`、`/units`，以及是否可使用新增學生頁；確認前維持現況。
- [ ] 鎖定第 6.4 節四項導覽上線依賴；任何可見項目啟用時均已有真實內容，不可 404 或使用無功能 placeholder。
- [ ] 鎖定 immersive study navigation contract：global／unit exit target、bottom nav 顯示時機、pending／blocked sync、quiz、sheet、browser Back 及 checkpoint 恢復。
- [ ] 為 `nextSession`、today reviewed／new／event、learned、unit recognition、long-term mastery 逐項記錄公式、資料來源、上限及 UI label。
- [ ] 決定 baseline 使用「下一輪學習」動態 aggregate，或另設固定每日任務；後者必須有獨立資料／migration 設計。
- [ ] 決定詞表可見範圍：全部詞、已解鎖詞、已學詞，或鎖定單元只顯示 metadata；確認查看不會產生任何學習 mutation。
- [ ] 決定 Word Coach 圖片只接受 same-origin、受控 remote allowlist 或安全 proxy，並記錄 admin URL validation。
- [ ] 為 login、home、learn、words、stats 建立 screen-to-route、module-to-component、static-to-live-data 對照表。
- [ ] 為現有 App 建立 light／dark、mobile／desktop baseline screenshot。
- [ ] 在至少 390×844、820×1180、1440×900 擷取 prototype light／dark reference screenshots。
- [ ] 記錄每頁 gutter、max-width、rail／bottom-nav breakpoint、card geometry、sticky／fixed 行為及 prototype 缺少的元件狀態。
- [ ] 記錄現有 Lighthouse／Core Web Vitals 或最低效能 baseline。
- [ ] 凍結 token 表、breakpoint、字體方案及 icon style。
- [ ] 凍結 WCAG 2.2 AA、visual comparison、browser 及 viewport acceptance 標準。
- [ ] 設計可執行測試 harness：`src/lib/*.test.ts` aggregation tests、authenticated student shell E2E、teacher/admin fixtures、Playwright project、npm script 及 CI gate。
- [ ] 決定 feature switch 或逐 route 發佈策略、production 預設值、config check、rollback owner 及可觀察訊號來源。
- [ ] 將所有未決事項記錄到第 15 節決策紀錄。

### 產出

- 獲確認的 route map。
- Auth／role／redirect 及 immersive study navigation contract。
- Design token 對照表。
- Prototype reference、現有 App baseline 及 screen／data mapping。
- 獲確認的資料 contract。
- 可實際執行的測試、視覺驗收及發佈策略。

### 驗收

- 所有關鍵產品決定有書面結果。
- Prototype 假資料與 production 真實資料來源已逐項對應。
- 每個 Phase 可獨立合併及安全啟用；沒有預定會出現的 dead route 或控制項倒退。
- 開發可在不猜測導航、指標或 route 行為下開始。

## Phase 1：Design foundation 與共用元件

### 目的

建立低風險、可逐頁採用的 UI 基礎，不改變業務功能。

### Checklist

#### Tokens 與全域樣式

- [ ] 在 `src/app/globals.css` 定義 light semantic tokens。
- [ ] 定義 `.dark` semantic tokens，保留現有 theme persistence。
- [ ] 在 Tailwind `@theme inline` 映射顏色、字體及必要尺寸。
- [ ] 建立 spacing、radius、shadow、motion token。
- [ ] 建立全域 `:focus-visible` 樣式。
- [ ] 建立 `prefers-reduced-motion` fallback。
- [ ] 建立 safe-area、body background、selection 及 scrollbar 規則。
- [ ] 加入 OKLCH fallback 並檢查 Safari／WebKit。
- [ ] 避免修改現有 WordCard motion transform 規則。

#### 字體與品牌

- [ ] 決定 Inter／Noto Sans TC 載入策略。
- [ ] 更新 root layout font variables。
- [ ] 建立 `BrandLockup`，包含見字會／SeeWord 及可存取標籤。
- [ ] 建立共用 SVG icon set。
- [ ] 移除導航用途 emoji；保留成就內容 emoji。

#### UI primitives

- [ ] 建立 `Button` variants 及 loading／disabled 狀態。
- [ ] 建立 `IconButton`。
- [ ] 建立 `Card`、`StatCard`。
- [ ] 建立 `PageHeader`。
- [ ] 建立 `ProgressBar`。
- [ ] 建立 `StatusBanner`、`Toast`。
- [ ] 建立 `Skeleton`、`EmptyState`。
- [ ] 建立 `SegmentedControl`、`FilterChip`。
- [ ] 建立可重用 `BottomSheet`。
- [ ] 確保所有互動控制至少 44×44px。
- [ ] 為表單建立 label、input、helper、error 樣式。
- [ ] 按第 7.5 節為每個 primitive 固定 semantic role、accessible name、live-region、keyboard 及 focus contract。
- [ ] BottomSheet 以 portal 或經驗證的等價策略避免被 ancestor stacking context／overflow 裁切。
- [ ] 建立 skip link 及 shell `<main>` focus target pattern。

#### 文案與 locale

- [ ] 所有新 UI、ARIA、validation、toast、API error 及 metadata 使用簡體 source，再經 `tc()`／`convertForServer()` 輸出繁體。
- [ ] 不直接把 prototype 繁體字串傳入現有轉換器。
- [ ] 建立核心指標術語表及中英／數字／category 混合 fixture。
- [ ] 所有 icon-only control 的 accessible name 一併支援簡繁。

#### Preview 與測試

- [ ] 在受 `ENABLE_TEST_ROUTES` 保護的 test surface 建立元件狀態預覽，或採用等價 visual fixture。
- [ ] 顯示 default、hover、focus、active、disabled、loading、error、success、dark 狀態。
- [ ] 驗證簡體及繁體長文案不溢出。
- [ ] 為 semantic tokens 設立 `rg`／lint allowlist 檢查，防止新增散落品牌 hex；必要的第三方／資料色要有註解例外。
- [ ] 記錄 visual fixture 及 screenshot artifact 的固定存放、更新與審批規則。
- [ ] 執行 primitive keyboard 及 automated accessibility smoke check。
- [ ] 執行 lint、typecheck、unit tests 及 production build。

### 產出

- 完整 semantic token layer。
- 品牌、icon 及共用 primitives。
- 可供後續頁面使用的 visual fixture。

### 驗收

- 新 primitives 不含散落品牌 hex。
- Light／dark 及 focus state 皆有可視預覽。
- Primitive semantics 在後續頁面重用時毋須重新發明。
- 未改變任何 API 或學習流程。

## Phase 2：App shell、登入與今日 Dashboard

### 目的

建立學生端正式產品框架，完成最先進入的 authenticated journey。

### Checklist

#### Student shell

- [ ] 建立 `(student)/layout.tsx` 或等價 route-preserving shell。
- [ ] 搬移學生 route 時保持 URL 不變。
- [ ] 按第 6.4 節已批准策略建立 mobile bottom nav：今日、學習、詞表、統計；未完成 route 不可成為 production dead link。
- [ ] 建立 desktop rail，寬度、footer 及 active state 對齊 prototype。
- [ ] 為 `/units`、`/leaderboard`、`/achievements` 設定正確 active group。
- [ ] 建立 account controls，容納姓名、登出、語言及 theme。
- [ ] 加入 skip link、`<main>` focus target、localised nav label 及 `aria-current="page"`。
- [ ] 先確保 login／reset、student、teacher、admin 每個已發布 surface 均有可達的 theme／locale 控制，才從 Providers 移除 global fallback。
- [ ] 如教師／管理員要到 Phase 5 才有正式 account controls，Phase 2 先把替代控制加入現有 header，或保留 global fallback。
- [ ] 在 mobile 處理 `env(safe-area-inset-bottom)`。
- [ ] 確認 bottom nav 不遮擋頁尾、WordCard 或 sheet action。
- [ ] 按第 6.3 節同步更新 `src/proxy.ts`、`homePathFor()`、login fallback 及 Student layout server guard。
- [ ] 對未獲批准的角色行為保持現況，不因 route group 順手收窄 TEACHER／ADMIN 能力。

#### Auth shell

- [ ] 建立 responsive `AuthShell`。
- [ ] 將 `/login` 改為 desktop 雙欄、mobile 單欄。
- [ ] 保留 NextAuth credentials、safe callback URL 及 hard navigation；按已確認 contract 將無 callback STUDENT／TEACHER／ADMIN 分別送往 `/`、`/teacher`、`/admin`。
- [ ] 保留帳戶限流、鎖定倒數及通用錯誤提示。
- [ ] 為帳戶及密碼加入可見 label。
- [ ] 改善 loading、disabled、error 及 locked 狀態。
- [ ] 將 `/reset-password` 套用同一 shell。
- [ ] 保留首次改密、password policy、tokenVersion 撤銷及重新登入流程。
- [ ] Login／reset 頁不顯示學生 bottom nav。
- [ ] Login／reset 在未登入狀態仍提供 theme 及 locale controls。
- [ ] 移除或改寫會造成 `/login` ↔ `/` 循環的「返回首頁」連結。
- [ ] 已登入使用者開 `/login` 時按角色返回已確認首頁。

#### Dashboard API

- [ ] 抽出 shared stats／dashboard query helpers，重用 unlock、queue caps、Asia/Shanghai、`MASTERED_REPETITIONS` 及 `MASTERED_MIN_INTERVAL`。
- [ ] 建立 `GET /api/student/dashboard`。
- [ ] 按 Phase 0 角色矩陣選用 `requireUser()` 或更窄的角色守衛。
- [ ] 按第 8.1 contract 一次聚合 next-session backlog／caps、today reviewed／new／events、library learned／mastered 及 streak。
- [ ] 確保 endpoint 不簽發 study session。
- [ ] 回應使用 `Cache-Control: private, no-store`。
- [ ] 為 timeout、401、429、503 及 database error 定義回應。
- [ ] 新增相鄰純函數及 DB integration tests，並以同一 fixture 對照現有 `/api/study/stats`。

#### 今日首頁

- [ ] 已登入學生 `/` 顯示日期、時段問候及登入使用者姓名。
- [ ] 無姓名時使用中性問候，避免顯示 email 或假名。
- [ ] Baseline 建立「下一輪學習」主卡及開始學習 CTA；只有獲批 persisted daily-plan contract 才稱為固定「今日任務」。
- [ ] 分開顯示下一輪待複習／新詞，以及今日已複習／新學，避免把 backlog、session cap 與歷史完成數相加成假進度。
- [ ] 建立已學、長期掌握、連續學習摘要卡，label 符合指標術語表。
- [ ] 使用 owner-scoped checkpoint 只顯示通用 resume CTA；不顯示未經 server 驗證的詞名、quiz phase 或百分比。
- [ ] 建立單元闖關、排行榜、成就次級入口。
- [ ] 建立 loading skeleton。
- [ ] 建立 no next-session items empty state；不可將「暫時沒有下一輪項目」誤稱為永久完成全部學習。
- [ ] 建立 offline／API error／retry state。
- [ ] 建立 branded not-found、403 或 session-expired 導向模式，並保存安全 callbackUrl。
- [ ] 移除 prototype 靜態 `13`、`5`、`6`、`小明`、`A2`。
- [ ] 確認未登入行為符合 Phase 0 決定。

#### 驗證

- [ ] 以明確 student／teacher／admin fixtures 測試未登入、各角色首頁、已登入開 login、safe／unsafe callback 及 session expiry redirect。
- [ ] 測試 mustChangePassword gate。
- [ ] 測試 callbackUrl 安全限制。
- [ ] 測試 theme／locale 首幀無閃爍。
- [ ] 測試 mobile bottom nav 及 desktop rail active state，並確認每個可見目的地非 404、具 auth 及 error handling。
- [ ] 以 390×844、820×1180、1440×900 對照 login／home prototype reference。
- [ ] 執行 Phase 0 定義的 authenticated student-shell E2E npm script。
- [ ] 如 StudentShell 在此 Phase 已包住 `/study`，執行 `npm run test:e2e:card-motion` 及完整登入／resume smoke test。
- [ ] 執行 lint、typecheck、unit tests、build。

### 產出

- StudentShell、StudentNav、AccountControls、AuthShell。
- 新 Dashboard API。
- 新登入、改密碼及今日首頁 UI。

### 驗收

- 登入至今日首頁形成完整 branded journey。
- 所有 Dashboard 數字來自真實資料。
- 四項導覽如已啟用，所有目的地均可操作；如未啟用，feature switch 及 Phase 4 啟用條件已驗證。
- Login／reset／student／teacher／admin 在當前發佈狀態全部仍可切換 theme 及 locale。
- Theme／語言控制不再與 bottom nav 重疊。

## Phase 3：核心學習流程視覺遷移

### 目的

套用 prototype 學習畫面，同時完整保留現有高風險業務及手勢行為。

### 保護原則

- 不改變 server-issued study session、nonce、operationId 或 Serializable transaction。
- 不改變 checkpoint owner／queue signature／studySessionId 驗證。
- 不改變 outbox、cross-tab lease、retry、rotation、reconcile 或 guarded interaction 語義。
- 不移除既有 `data-testid`、motion probe 或 E2E route。
- 視覺重構與業務重構分開 commit。

### Checklist

#### 無行為重構

- [ ] 記錄 `/study` 現有 loading、locked、assess、quiz、done、error 狀態。
- [ ] 抽出 `StudyHeader`，不改 handler。
- [ ] 抽出 `StudyProgress`，不改 currentIndex 語義。
- [ ] 抽出 `StudyStage`／`StudyCompletion`，不改 early return 次序。
- [ ] 保留 PendingSyncBanner、RotationNotice、ResumeToast、AchievementToast 行為。
- [ ] 每次抽取後執行相關 tests，確保純 refactor。

#### Immersive study navigation

- [ ] 按 Phase 0 contract 分別定義 global study 及 unit study 的 exit target；unit 返回時保留 level／category context。
- [ ] 對 assess、quiz、coach sheet、pending sync、blocked sync、done 逐一決定 StudentNav 是否顯示及是否可操作。
- [ ] Pending／blocked submission 未安全處理前，不可用無提示導航令使用者誤以為資料已保存。
- [ ] Sheet 開啟時令背景 shell、bottom nav 及全域快捷鍵 inert。
- [ ] 測試 browser Back、bottom-nav navigation、explicit exit 三種離開方式。
- [ ] 驗證離開再返回只從合法 owner-scoped checkpoint 恢復，且不遺失 pending outbox submission。

#### Assess／WordCard

- [ ] 將 topbar 改為 prototype back、title、progress 佈局。
- [ ] 在 desktop shell 內維持合理 card width；mobile 仍可單手操作。
- [ ] 加入 card back layer、level／topic badge、認讀卡 context。
- [ ] 加入 drag-left「還不會」及 drag-right「我會」視覺 badge。
- [ ] 保留 `word-card-flight-layer`、`word-card-drag-layer` 及 transform owner。
- [ ] 將 action button 套用 danger／accent 語義色。
- [ ] 如修改顯示文案，確認「還不會／我會」仍映射到原本左右操作。
- [ ] 保留發音按鈕，加入 TTS pending／error 狀態。
- [ ] 加入 keyboard hint，但不影響 input／dialog focus。
- [ ] 驗證長單詞、缺 phonetic、缺 category、B2 等邊界。
- [ ] 定義新單詞換卡後的 heading／focus 策略及簡潔 announcement，避免 screen reader 停留在已卸載卡片。

#### Word Coach sheet

- [ ] 以共用 BottomSheet 重構 HelpPanel。
- [ ] 顯示 term、phonetic、TTS、definition、pos、examples、relations、image。
- [ ] 缺圖片時顯示文字 fallback，不生成假圖。
- [ ] 按 Phase 0 圖片政策驗證 protocol／host；如需 remote pattern 或 proxy，更新 `next.config.ts`／admin validation 並執行 production build。
- [ ] 為 image load error、固定尺寸、lazy loading 及 WebKit 建立 fallback 測試。
- [ ] 保留不認識詞的延後 quiz 插入及 dismiss timer 邏輯。
- [ ] 加入 backdrop、sheet handle、close button。
- [ ] 加入 `role="dialog"`、`aria-modal`、title relationship。
- [ ] 實作 focus trap、Escape、focus return。
- [ ] Sheet 開啟時禁止背景 scroll，但避免 iOS viewport jump。
- [ ] Reduced motion 下使用極短或無位移 transition。

#### Quiz

- [ ] 使用同一 StudyHeader／progress shell。
- [ ] 將 QuizCard 改成 prompt card + option rows。
- [ ] 保留 direction、quizAttempt、wrong count、delayed callback。
- [ ] 為 correct、wrong、disabled 及 interactionGuarded 建立清晰狀態。
- [ ] 避免答錯後只靠紅／綠顏色表達結果。
- [ ] 保留 quiz option test ids。
- [ ] Quiz 題目、答題結果及進度轉換提供不重複轟炸 live region 的可理解 announcement。

#### 系統狀態及完成頁

- [ ] Pending sync、blocked、legacy、rotation 轉用一致 StatusBanner。
- [ ] 保留 retry、claim、discard、reload action。
- [ ] Loading 使用 skeleton，保留 `aria-busy` 或 status text。
- [ ] Locked unit 使用品牌 empty／locked state。
- [ ] 完成頁採用 prototype success hierarchy。
- [ ] 保留 known／unknown、quiz correct／wrong、streak、calendar、next unit。
- [ ] 保留 global refresh、返回單元、返回首頁及成就入口。

#### 測試

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm run test:e2e:card-motion`
- [ ] 驗證 mouse release。
- [ ] 驗證 emulated touch release。
- [ ] 驗證 synthetic pointer release。
- [ ] 驗證 mobile WebKit study workflow。
- [ ] 驗證 keyboard ArrowLeft／ArrowRight。
- [ ] 驗證 reduced-motion dismiss／return。
- [ ] 驗證完整登入、恢復、quiz、submit、done 流程。
- [ ] 驗證 screen reader focus／announcement、sheet inert 及三種離開方式。
- [ ] 以 390×844、820×1180、1440×900 對照 learn prototype reference。

### 產出

- 新 Study UI、WordCard visual、QuizCard visual、CoachSheet。
- 一致的 sync／error／completion states。
- 無回歸的 gesture 及 study workflow。

### 驗收

- `/study` 視覺符合 prototype，但所有既有高風險測試保持通過。
- Sheet、bottom nav、safe-area 及 soft keyboard 無遮擋。
- 所有提交仍由服務端決定 SM-2 更新。

## Phase 4：詞表、單元及統計資訊架構

### 目的

補齊 prototype 內目前不存在的學生詞表與統計頁，並將既有單元、排行榜及成就納入新導覽。

### Checklist

#### 學生詞表 API

- [ ] 建立 read-only word query helper。
- [ ] 建立 `GET /api/words`。
- [ ] 驗證 auth、level、category、cursor、limit。
- [ ] 返回 available levels／categories。
- [ ] Join 當前使用者 Review，按第 8.2 節計算 learned、mastered、status、nextReviewAt；不製造無公式的 per-word 百分比。
- [ ] 套用 Phase 0 已批准的 locked-unit visibility policy，且讀取不得建立 Review、解鎖或簽發 session。
- [ ] 加入 `(term, id)` 或等價穩定 cursor pagination，清楚定義 filter 後 `total`。
- [ ] 回應使用 `Cache-Control: private, no-store`。
- [ ] 避免暴露 admin-only metadata。
- [ ] 新增 locked exposure、cursor 防重／防漏、並列 term、刪詞、空 filter 及大 page limit tests。

#### `/words`

- [ ] 「詞表／單元闖關」跨 `/words`、`/units` 時使用 navigation links + `aria-current`，不可冒充同頁 tabs。
- [ ] 建立 A1／A2／B1／B2 level control。
- [ ] Category chips 由 API 動態產生。
- [ ] 將 level、category 及 pagination state 同步 query string，refresh、Back 及分享連結可重現。
- [ ] 建立 word count 及 filter summary。
- [ ] 建立 word row：term、phonetic、definition、離散學習狀態及 next review；label 不混淆認字與長期掌握。
- [ ] 點擊 word row 開共用 Word Coach sheet。
- [ ] 關閉 Word Coach 後 focus 返回原 word row。
- [ ] 決定是否支援 `?word=<id>` deep link；如不支援，至少保留 filter、pagination 及 scroll position。
- [ ] 建立 pagination／load-more 或 infinite paging。
- [ ] 建立 loading、empty、error、retry。
- [ ] 驗證長 category、未分類、缺 phonetic、缺內容。

#### `/units`

- [ ] 套用 StudentShell 並歸入詞表 active group。
- [ ] 使用共用 level segmented control。
- [ ] 重構總進度主卡，分開顯示已學、認字率／解鎖進度、長期掌握及 due；80% 解鎖口徑不可稱為長期掌握。
- [ ] 重構 unit card default、locked、in-progress、completed。
- [ ] 保留 80% 解鎖規則及順序鏈。
- [ ] 保留 B2 及未分類 mapping。
- [ ] 保留 query-string 進入 unit study。

#### Insights API

- [ ] 建立支援 1–60 日且驗證整數輸入的 event aggregation helper。
- [ ] 固定只計 `eventKind=REVIEW AND isHistorical=false`。
- [ ] 使用 PostgreSQL `AT TIME ZONE 'Asia/Shanghai'` 或經驗證等價 helper 建立日期桶，不切 UTC ISO 字串。
- [ ] 返回 recent words 及 next review display data；已刪 Word 使用 `wordTerm` snapshot 並回 `nextReviewAt=null`。
- [ ] 返回 learned 與 long-term mastery 兩組數據。
- [ ] 重用既有 stats、streak 及 mastered helpers，避免第三套口徑。
- [ ] 建立 `GET /api/study/insights`。
- [ ] 新增 `23:59:59+08`／`00:00:00+08`、空資料、非法 days、歷史事件及 deleted Word tests。

#### `/stats`

- [ ] 建立今日複習／新學、連續學習、長期掌握 overview cards；不用未定義的「今日完成」。
- [ ] 建立「已學進度」卡及準確說明。
- [ ] 建立最近 7 日 activity chart。
- [ ] Chart 有文字／表格替代，不只靠圖形。
- [ ] 建立最近學習列表。
- [ ] 整合 StreakCalendar。
- [ ] 建立排行榜及成就入口。
- [ ] 建立 loading、empty、error、retry。
- [ ] Chart、日期、tooltip／detail 及空狀態全部支援簡繁與 keyboard。

#### 排行榜及成就

- [ ] 將 `/leaderboard` 套用 StudentShell 並歸入統計 active group。
- [ ] 保留 streak、words、studyDays 三個榜單。
- [ ] 保留 current user 定位及並列排名。
- [ ] 將 `/achievements` 套用 StudentShell。
- [ ] 使用 accent／soft／success 取代大面積橙色 gradient。
- [ ] 保留 locked／unlocked、progress、target 及通知語義。

#### 驗證

- [ ] API auth／validation tests。
- [ ] DB aggregation tests。
- [ ] Empty library／empty activity states。
- [ ] 以同一 Review fixture 驗證 Dashboard、Words、Units、Stats 的 learned／recognition／mastery label 及數值一致。
- [ ] 簡繁長文案及 B2 filter。
- [ ] Mobile horizontal chip scrolling。
- [ ] 驗證 refresh／Back／deep link 恢復 filter、pagination、sheet focus 及 scroll state。
- [ ] 執行 Phase 0 定義的 student IA／API E2E npm script。
- [ ] 以 390×844、820×1180、1440×900 對照 words／stats prototype reference。
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] 適用時執行 `npm run test:db`。

### 產出

- `/words`、`/stats` 及兩組新 API。
- 重構後 `/units`、`/leaderboard`、`/achievements`。
- 完整四分頁學生資訊架構。

### 驗收

- 學生可由任何主分頁自然到達現有功能。
- 詞表不會改變正式學習 queue 或複習排程。
- 詞表只顯示 Phase 0 已批准範圍，鎖定內容沒有無意洩漏。
- 所有統計 label 與實際計算口徑一致。

## Phase 5：教師端及管理端 workspace

### 目的

將同一品牌 tokens 延伸到角色後台，同時提高桌面資料密度及操作效率。

### Checklist

#### Workspace shell

- [ ] 建立共用 `WorkspaceShell`。
- [ ] Desktop 使用 sidebar 或適合資料工作的 top navigation。
- [ ] 內容最大寬度 1120–1280px。
- [ ] Mobile 轉為可滾動 tabs／compact navigation。
- [ ] 加入 BrandLockup、role label、account controls。
- [ ] Account controls 包含可達的簡繁、theme、登出及返回角色首頁，並支援 Escape／focus return。
- [ ] 保留 server-side role guard 及 redirect。
- [ ] ADMIN 查看 teacher route 時維持原授權規則。

#### 教師端

- [ ] 重構班級 overview metrics。
- [ ] 重構各 level progress。
- [ ] 重構最近活躍學生列表。
- [ ] 學生進度在 desktop 使用高密度 row／table，在 mobile 使用 cards。
- [ ] 保留 expand details 及 keyboard activation。
- [ ] 保留重設學生密碼流程、臨時密碼顯示及 session 撤銷說明。
- [ ] 為 loading、empty、error、retry 建立一致狀態。

#### 管理端

- [ ] 重構 system overview metrics 及分布圖。
- [ ] 重構 user search、role badges、edit／delete actions。
- [ ] 重構 word search、level filter、edit／delete actions。
- [ ] 使用共用 Modal、form field、ConfirmDialog。
- [ ] 保留最後一名管理員保護。
- [ ] 保留角色變更 tokenVersion 撤銷。
- [ ] Destructive action 不只靠顏色表示。
- [ ] Mobile action button 不互相擠壓或溢出。

#### 驗證

- [ ] STUDENT 無法存取 teacher／admin UI 及 API。
- [ ] TEACHER 無法存取 admin UI 及 API。
- [ ] ADMIN 可使用原有管理及 teacher-view 能力。
- [ ] 建立／修改／刪除使用者回歸。
- [ ] 建立／修改／刪除單詞回歸。
- [ ] 重設密碼及首次改密回歸。
- [ ] 使用獨立 STUDENT／TEACHER／ADMIN fixtures 執行 workspace route／API E2E，不只依賴學生 auth setup。
- [ ] 驗證 320px mobile、tablet 及 desktop 的 table／card 轉換、keyboard focus 及 destructive dialog。
- [ ] 確認移除 Providers global theme／locale fallback 後，所有 surface 仍有替代入口。
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`

### 產出

- 教師及管理員 responsive workspace。
- 共用 modal、table／list、search、filter 設計語言。

### 驗收

- 後台在 desktop 不再限制於 mobile-width。
- 所有安全及 destructive guard 保持有效。
- 後台沿用品牌 tokens，但不套用學生 motivational layout。

## Phase 6：全量 QA、發佈及觀察

### 目的

在正式啟用新 UI 前完成跨 viewport、主題、locale、角色、互動及 production config 驗證。

### Checklist

#### Responsive matrix

- [ ] 320×568 minimum reflow／short viewport。
- [ ] 360×800 mobile compact。
- [ ] 390×844 mobile standard。
- [ ] 430×932 mobile large。
- [ ] 844×390 mobile landscape。
- [ ] 600×960 foldable／small tablet。
- [ ] 820×1180 tablet portrait。
- [ ] 1024×768 tablet landscape。
- [ ] 1366×768 laptop。
- [ ] 1440×900 desktop。
- [ ] 1920×1080 wide desktop。
- [ ] 以 `scrollWidth > clientWidth` 等實際檢查驗證所有 viewport 無非預期水平 scroll，不以 `overflow-x: hidden` 掩蓋問題。
- [ ] 驗證 iOS dynamic toolbar 下的 `dvh`／`svh` 行為。
- [ ] Safe-area top／right／bottom／left、soft keyboard、bottom nav、sheet action 無遮擋。
- [ ] Login input 字級至少 16px 或有等價策略，避免 iOS focus 自動 zoom。

#### Theme、locale、狀態

- [ ] Light + 繁體。
- [ ] Light + 簡體。
- [ ] Dark + 繁體。
- [ ] Dark + 簡體。
- [ ] Default、hover、focus、active、disabled。
- [ ] Loading、empty、offline、error、retry、success。
- [ ] Branded not-found、401／403、session-expired、rate-limited 及 maintenance state。
- [ ] Theme 及 locale reload 後保持設定。
- [ ] SSR 首幀無明顯 theme／locale flash。

#### Accessibility

- [ ] WCAG 2.2 AA 作正式 acceptance target。
- [ ] Heading hierarchy。
- [ ] Landmark 及 nav label。
- [ ] Keyboard-only navigation。
- [ ] Focus-visible 及 focus order。
- [ ] Dialog focus trap、Escape、focus return。
- [ ] `aria-live` 用於 save、quiz、sync 及 error feedback。
- [ ] 一般文字對比至少 4.5:1；大字、圖示及必要 UI 邊界至少 3:1。
- [ ] 所有狀態不只靠顏色。
- [ ] Reduced motion。
- [ ] 400% zoom／320 CSS px reflow 仍可操作。
- [ ] Forced Colors 模式可辨識互動、focus 及狀態。
- [ ] WCAG text-spacing override 後內容不裁切或重疊。
- [ ] Automated axe 無 critical／serious issue。
- [ ] 完成 keyboard-only 及至少一次 VoiceOver 或 NVDA smoke test。

#### 效能及相容性

- [ ] Chrome／Chromium。
- [ ] Firefox。
- [ ] Safari／WebKit。
- [ ] Mobile Chromium emulation。
- [ ] Mobile WebKit emulation。
- [ ] 字體載入不阻塞主要內容。
- [ ] 圖片有尺寸、fallback 及適當 lazy loading。
- [ ] 大型列表使用 pagination，無 N+1。
- [ ] Blur、shadow、chart 不造成明顯低階裝置卡頓。
- [ ] 個人化 Dashboard、Words、Stats response 不被公共 cache 共用。

#### 視覺 fidelity

- [ ] 為 login、home、learn、words、stats 保存 prototype reference、實作 before／after 或 visual diff。
- [ ] 在 390×844、820×1180、1440×900 逐頁比較 layout geometry、type scale、color、radius、shadow、navigation 及 component states。
- [ ] 所有刻意偏離 prototype 的地方記錄原因、影響及 reviewer approval。
- [ ] 教師／管理員沒有 prototype reference 的頁面，以已批准 token、density、responsive 及 accessibility contract 驗收，不虛構像素對照。

#### 最終驗證

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm run test:db`
- [ ] `npm run test:e2e:card-motion`
- [ ] 執行 Phase 0 新增的 student shell／IA／role E2E npm script。
- [ ] 執行 Phase 0 新增的 teacher／admin fixture E2E npm script。
- [ ] `npm run check:production-config`
- [ ] 如有 schema 改動，執行 migration checksum、fresh replay 及 contract regression。
- [ ] 檢查 `.github/workflows/deploy-production.yml`。
- [ ] 記錄未執行測試及原因。

#### 發佈

- [ ] 確認所有 Phase checklist 及 blocker。
- [ ] 以 route／角色分批啟用，避免一次切換所有 surface。
- [ ] Production 部署遵循 `DEPLOY.md`。
- [ ] 使用 Phase 0 已確認且不記錄憑證／PII 的來源，監察 auth error、study queue error、review submission error、API latency 及 Web Vitals。
- [ ] 驗證舊 UI rollback deployment／commit；如使用 feature switch，同時驗證 production 預設、config check、owner 及關閉路徑。
- [ ] 部署後執行學生、教師、管理員 smoke test。

### 產出

- 全 viewport visual QA 記錄。
- 最終測試結果。
- 發佈及 rollback 記錄。

### 驗收

- 所有必要 checklist 完成。
- 無已知 P0／P1 UI、認證、資料或學習流程問題。
- Production smoke test 通過後才將本計劃改為「已完成」。

## 10. 風險登記

| ID | 風險 | 程度 | 預防／緩解 | 主要階段 |
|---|---|---:|---|---|
| R1 | 視覺重構破壞 `/study` 狀態機、手勢或冪等提交 | 高 | 展示與業務分開 commit；保留 test ids；完整 E2E | Phase 3 |
| R2 | Dashboard 誤用 study queue，簽發 session 或撞 rate limit | 高 | 獨立 aggregate endpoint | Phase 2 |
| R3 | Resume 顯示信任可修改 localStorage | 高 | 只用 owner-scoped checkpoint 顯示 generic CTA；進入 study 後驗證 provenance | Phase 2 |
| R4 | Bottom nav、WordCard、sheet、soft keyboard 互相遮擋 | 高 | Safe-area、實際 viewport、WebKit QA | Phase 2–3 |
| R5 | 「已學」與「掌握」指標口徑混淆 | 高 | API 及 UI 分開命名和說明 | Phase 4 |
| R6 | Route group 搬移影響 proxy、redirect、callback URL | 高 | URL 不變；auth／role 回歸 | Phase 2 |
| R7 | Theme／locale 控制移位造成 hydration mismatch | 中 | 保留 provider 及 pre-hydration script | Phase 1–2 |
| R8 | Prototype 繁體文案繞過現有 i18n | 中 | 依現有 source-locale 規則加入文案，雙 locale QA | 全階段 |
| R9 | CJK 字體令 build 或 LCP 變差 | 中 | 有限 weight、self-hosted／fallback、效能 baseline | Phase 1 |
| R10 | OKLCH、color-mix、backdrop-filter 跨瀏覽器差異 | 中 | Fallback、WebKit／Firefox visual QA | Phase 1、6 |
| R11 | 教師／管理員直接套學生大卡片令資料密度過低 | 中 | 獨立 WorkspaceShell | Phase 5 |
| R12 | 新詞表及 insights query 造成 N+1 或大 payload | 中 | PostgreSQL aggregation、pagination、DB tests | Phase 4 |
| R13 | Prototype 未展示所有 production state，視覺決定有歧義 | 中 | 以 HTML／CSS／JS contract 為準，Phase 0 補 state matrix 並凍結決定 | Phase 0 |
| R14 | Phase 2 導覽早於 `/words`、`/stats` 啟用，造成 dead link／半完成 IA | 高 | 原子啟用 route + nav；production config gate；逐連結 E2E | Phase 0、2、4 |
| R15 | proxy、role helper、login fallback、layout 對首頁／角色行為定義不一致 | 高 | 單一 route／role matrix；同步更新；多角色 fixtures | Phase 0、2 |
| R16 | 將動態 next-session aggregate 當固定今日任務，或混淆認字／掌握 | 高 | 指標字典；shared helper；一致 fixture；需要固定任務時另設 schema | Phase 0、2、4 |
| R17 | 太早移除全域 theme／locale controls，令 auth 或 workspace 失去入口 | 高 | 所有 surface 先有替代入口才移除 fallback | Phase 2、5 |
| R18 | 詞表無意暴露鎖定內容或讀取時改變學習狀態 | 高 | Phase 0 可見性政策；read-only contract；exposure tests | Phase 0、4 |
| R19 | Coach 圖片接受未受控 URL，或 remote image 在 production 失效 | 中 | URL policy、allowlist／proxy、admin validation、load fallback | Phase 0、3 |
| R20 | 只靠主觀「符合 prototype」導致視覺漂移 | 中 | 固定 viewport reference、geometry contract、visual diff 審批 | Phase 0、6 |

## 11. 測試矩陣

| 改動 | 必要驗證 |
|---|---|
| Tokens／primitives | lint、typecheck、build、light／dark visual fixture、keyboard、axe、hex allowlist |
| Student shell／routing | 多角色 redirects、active nav、所有可見 route 非 404、mobile／desktop、study E2E（如被 shell 包裹） |
| Login／reset | callback safety、role home、login-loop、rate lock、mustChangePassword、tokenVersion、theme／locale |
| Dashboard API | auth、queue caps／unlock、shared metric fixture、Asia/Shanghai、no session issuance、no-store、empty／DB errors |
| WordCard／study layout | unit tests、card-motion E2E、full study workflow |
| Coach sheet | keyboard、focus trap、Escape、focus return、background inert、touch、reduced motion、image policy／fallback |
| Words API／page | auth、locked visibility、read-only、stable cursor、status join、URL restoration、empty／large list |
| Insights／stats | days validation、event-kind、historical exclusion、Asia/Shanghai midnight、deleted Word snapshot、metric fixture |
| Units | unlock chain、B2、未分類、query route、recognition label 不混作 mastery |
| Teacher／admin | 多角色 fixtures、role guards、CRUD、reset password、last-admin protection、theme／locale |
| Visual fidelity | 390×844、820×1180、1440×900 reference／after compare、偏差審批 |
| Accessibility | WCAG 2.2 AA、axe、keyboard、VoiceOver／NVDA、400% reflow、Forced Colors、text spacing |
| Production config | build、production config check、deployment workflow |

## 12. 發佈與 rollback 原則

- 優先按 foundation → shell/auth/home → study → library/stats → workspaces 分批合併。
- 每一 Phase 以可獨立驗證及回退的 commit／PR 組成。
- 「可合併」不等於「可啟用」：StudentNav 與其四個 route 必須按第 6.4 節同時具備可用內容，才可向 production 使用者顯示。
- Phase 3 不可同時混入 study API 或 SM-2 行為變更。
- 新 API 先向後相容上線，再由 UI 消費；不要在同一瞬間移除舊 contract。
- 如使用 feature switch，必須在 Phase 0 定義 owner、production 預設、環境變數驗證、啟用／關閉步驟及移除日期；flag 只控制展示路徑，不繞過 auth 或資料安全守衛。
- 如不使用 feature switch，為每個 Phase 記錄可回復的 Vercel deployment／commit 及資料向後相容窗口。
- Rollback 不得回退已套用的 destructive database migration；如有 schema 變更，使用 expand／contract 流程。

## 13. Definition of Done

- [ ] Phase 0–6 所有必要項目已完成或有明確獲准例外。
- [ ] 計劃狀態、索引及 checklist 已更新。
- [ ] 所有新增 route、API、元件有相應測試或驗證證據。
- [ ] 所有可見導覽目的地可操作，沒有 404、無功能 placeholder 或 `/login` redirect loop。
- [ ] 所有實際執行的命令及結果已記錄。
- [ ] 未執行的高成本／外部服務測試已列明原因。
- [ ] 無 prototype 假資料或 prototype-only 導覽殘留。
- [ ] Dashboard、Words、Units、Stats 的 next-session／today／learned／recognition／mastery 指標通過同一 fixture 一致性驗證。
- [ ] 詞表可見性符合已批准政策，所有瀏覽操作保持 read-only。
- [ ] 無認證、角色、study session、nonce、operationId、checkpoint 或 outbox 回歸。
- [ ] Login／reset／student／teacher／admin 全部有可達 theme／locale 控制。
- [ ] 明暗主題、簡繁、keyboard、touch、screen reader、Forced Colors 及 reduced motion 可用，WCAG 2.2 AA 驗收完成。
- [ ] Prototype reference visual comparison 及所有獲批准偏差有保存紀錄。
- [ ] Production smoke test 完成。
- [ ] 本文件狀態改為「已完成」。

## 14. 實施時預計主要檔案範圍

### 既有檔案

- `src/proxy.ts`
- `src/lib/roles.ts`
- `src/lib/session.ts`
- `src/lib/checkpoint.ts`
- `src/lib/mastered.ts`
- `src/lib/units.ts`
- `src/lib/streak.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/components/Providers.tsx`
- `src/components/ThemeToggle.tsx`
- `src/components/LanguageToggle.tsx`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/reset-password/page.tsx`
- `src/app/study/page.tsx`
- `src/app/units/page.tsx`
- `src/app/leaderboard/page.tsx`
- `src/app/achievements/page.tsx`
- `src/components/WordCard.tsx`
- `src/components/QuizCard.tsx`
- `src/components/HelpPanel.tsx`
- `src/components/StudyStats.tsx`
- `src/components/StreakCalendar.tsx`
- `src/app/teacher/layout.tsx`
- `src/app/teacher/page.tsx`
- `src/app/teacher/students/page.tsx`
- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/users/page.tsx`
- `src/app/admin/words/page.tsx`
- `src/components/admin/*`
- `playwright.config.ts`
- `package.json`
- `.github/workflows/*`
- `next.config.ts`（如圖片政策需要 remote allowlist／proxy config）

### 預計新增檔案／模組

- `src/components/ui/*`
- `src/components/shell/StudentShell.tsx`
- `src/components/shell/StudentNav.tsx`
- `src/components/shell/AuthShell.tsx`
- `src/components/shell/WorkspaceShell.tsx`
- `src/components/brand/BrandLockup.tsx`
- `src/app/words/page.tsx` 或 route-group 等價位置
- `src/app/stats/page.tsx` 或 route-group 等價位置
- `src/app/api/student/dashboard/route.ts`
- `src/app/api/words/route.ts`
- `src/app/api/study/insights/route.ts`
- 對應 query helpers 及 tests
- `tests/e2e/student-shell.spec.ts` 或 Phase 0 決定的等價 authenticated UI suite
- teacher／admin auth fixtures 及 workspace E2E suites
- 固定 visual reference／diff artifact 目錄及其更新說明

實際路徑可在 Phase 0 凍結，但公開 URL 及安全邊界不得因內部搬移而改變。

## 15. 決策紀錄與未決事項

| 日期 | 項目 | 狀態 | 決定／建議 |
|---|---|---|---|
| 2026-08-11 | 設計來源 | 已決定 | 以 EMM Style 01 HTML／CSS／JS／handoff 作視覺 contract |
| 2026-08-11 | 實施方式 | 已決定 | 分 Phase 遷移，不做一次性大重寫 |
| 2026-08-11 | Study 核心 | 已決定 | 保留業務狀態機，只重構展示層 |
| 2026-08-11 | 未登入 `/` | 待確認 | 建議轉到 `/login`；marketing 另設 `/welcome` |
| 2026-08-11 | Bottom nav 第三項 | 待確認 | 建議使用「詞表」，`/units` 作頁內次級入口 |
| 2026-08-11 | 教師／管理員 | 待確認 | 建議包含在本計劃 Phase 5 |
| 2026-08-11 | 字體載入 | 待技術驗證 | 比較 variable/self-hosted/system fallback 的 build 與 LCP |
| 2026-08-11 | Resume 詞名 | Baseline 已決定 | Dashboard 只以 owner-scoped checkpoint 顯示 generic CTA；詞名／準確進度／跨裝置摘要需另設 server contract |
| 2026-08-11 | 四項導覽上線 | 待確認 | 最低可用 routes 提前交付，或以受 config 檢查的 feature switch 與 Phase 4 原子啟用；不可出現 dead link |
| 2026-08-11 | Route／角色 matrix | 待確認 | 建議 STUDENT／TEACHER／ADMIN 無 callback 分別去 `/`、`/teacher`、`/admin`；TEACHER／ADMIN 使用學生頁能力維持現況至確認 |
| 2026-08-11 | Dashboard 任務口徑 | Baseline 建議 | 無 schema 版本稱「下一輪學習」並沿用 queue 20 due／5 new caps；固定每日任務要另開資料設計 |
| 2026-08-11 | 詞表解鎖可見性 | 待確認 | 在全部詞、已解鎖、已學、或鎖定 metadata 中選一；所有詞表操作保持 read-only |
| 2026-08-11 | Study 導覽 | 待確認 | 逐 state 定義 bottom nav、global／unit exit、pending sync、Back 及 sheet inert |
| 2026-08-11 | Coach 圖片來源 | 待確認 | 在 same-origin、受控 allowlist 或安全 proxy 中選一，並同步 admin URL validation |
| 2026-08-11 | 測試 harness | 待技術設計 | 新增多角色 fixtures、student IA／API E2E、npm scripts 及 CI gate |
| 2026-08-11 | 視覺驗收 | 已決定 | 以 390×844、820×1180、1440×900 reference／after comparison 為核心證據，偏差須審批 |

## 16. 進度紀錄

| 日期 | 階段 | 更新 | 驗證 |
|---|---|---|---|
| 2026-08-11 | 計劃準備 | 完成 prototype、現有 App、資料能力及風險盤點；建立分階段 checklist | 純讀取分析，未修改產品代碼 |
| 2026-08-11 | 雙重審核 | 兩個獨立 Subagent 分別完成 UX／accessibility 與技術／security 審核；主線對照 route、API、schema、checkpoint、i18n 及 prototype contract | 共識問題已轉為必要 checklist／Phase 0 決策門檻；未修改產品代碼 |
