# 老師詞庫工作區基線及本地驗收證據（2026-08-26）

> 範圍：`word-catalog-teacher-workspace-usability-redesign.md` 本地 implementation／verification
> 環境：macOS arm64、Node 24.8.0、PostgreSQL 16.14、Chromium、browser 100% zoom
> 資料：已清除測試 fixture 後 5,641 個 workspace rows；5,469 ACTIVE、107 DRAFT、0 RETIRED senses

## 1. 改動前基線

- 1440×900：由列表區頂部量度，完整可見 6 張舊式 card，第 7 張只局部可見；每張約 130 px 高。
- 每張 card 直接顯示 raw `sense_...`、`revision 1` 及完整 source path；三個操作分散在 card 右側，主操作另起一行。
- reviewer 初次載入由 workspace 自身發出 2 個資料 request：`GET /api/catalog` 及 `GET /api/catalog/requests?status=PENDING...`；普通老師只有前者。外層 feature-access request 沿用既有頁面 contract。
- 改動前截圖：
  - [1440×900 頂部](../../output/playwright/catalog-workspace-usability-baseline/before-1440x900.png)
  - [1440×900 列表](../../output/playwright/catalog-workspace-usability-baseline/before-1440x900-list.png)
  - [1024×900](../../output/playwright/catalog-workspace-usability-baseline/before-1024x900.png)
  - [768×900](../../output/playwright/catalog-workspace-usability-baseline/before-768x900.png)
  - [320×800](../../output/playwright/catalog-workspace-usability-baseline/before-320x800.png)

## 2. 真實資料盤點

以最新 READY import batch、approved／latest revision及未被該batch覆蓋嘅governance senses組成同一workspace projection：

- rows：5,641；空 term：0；非 A–Z 字首：0。
- POS：`noun` 3,225、`verb` 989、`adjective` 846、`adverb` 212、`phrasal_verb` 164、`proper_noun` 100、`preposition` 45、`conjunction` 25、`determiner` 12、`pronoun` 10、`abbreviation` 6、`modal` 4、`phrase` 2、`particle` 1；空值 0。
- category：24 個 canonical values；最多為 `society-law-politics` 457，最少為 `time-calendar` 96；空值 0。完整集合為 `society-law-politics`、`actions-events`、`arts-culture-media`、`descriptions-qualities`、`abstract-concepts`、`work-business`、`food-drink`、`nature-weather`、`body-health`、`sports-leisure`、`function-words`、`emotions-personality`、`travel-transport`、`places-community`、`science-mathematics`、`communication-language`、`home-household`、`animals-plants`、`clothing-appearance`、`people-family`、`technology`、`numbers-quantity`、`school-education`、`time-calendar`。
- 現有 teacher identity 以 term＋主要中文釋義＋POS＋level 已足以區分同拼法不同詞義；無需另加會隨排序造成理解成本嘅「詞義 N」序號。

## 3. 改動後密度及 responsive 驗收

- 1440×900 native table 使用 88 px row，完整可見 9 行，比原本 6 行增加 50%；欄頭、狀態、出題狀態及三個水平操作均完整可見。
- 原計劃同時要求「80–96 px row」及「由欄頭底至viewport底至少兩倍」。真實基線下兩者不能同時成立：12 行需要 row低於約69 px。最終保留已批准嘅80–96 px可讀性／觸控範圍，以88 px、6→9行為本輪驗收基準；見主計劃 CTW-013。
- 1024及768 px只render compact card DOM；1440 px只render table DOM。320 px量得 `scrollWidth=316`、`clientWidth=320`，無水平 overflow。
- 320 px drawer為full-width sheet；Esc關閉、focus返回原「查看歷史」按鈕。更多操作及filter sheet亦可用keyboard開關、Esc關閉並還原focus。
- 從完整詞庫進入全域歷史再返回，原filter、sort、loaded rows、selection、scroll anchor及原行按鈕focus均保留；來源行仍存在時不顯示錯誤提示。
- 改動後截圖：
  - [1440×900 頂部](../../output/playwright/catalog-workspace-usability-baseline/after-1440x900-top.png)
  - [1440×900 列表](../../output/playwright/catalog-workspace-usability-baseline/after-1440x900-list.png)
  - [1024×900](../../output/playwright/catalog-workspace-usability-baseline/after-1024x900.png)
  - [768×900](../../output/playwright/catalog-workspace-usability-baseline/after-768x900.png)
  - [320×800](../../output/playwright/catalog-workspace-usability-baseline/after-320x800.png)
  - [320×800 逐詞歷史 drawer](../../output/playwright/catalog-workspace-usability-baseline/after-320x800-history-drawer.png)

## 4. 查詢及效能證據

`npm run check:catalog-workspace-performance`係唯讀檢查，對普通老師及reviewer各跑9組情境：A–Z首頁、A–Z深頁offset 5,000、A1、ACTIVE、pending workflow、雙方向可用、無內容問題、主題及最近修改。每組1次首次呼叫＋30次warm呼叫，共558次；每次由一個bounded PostgreSQL CTE同時完成rows、counts及self-excluding POS/category facets，沒有per-row query。

- 本地結果：`LOCAL_BASELINE_PASS`。
- 5,641 rows、50-row page；首次呼叫最高99.66 ms。
- 所有情境中最高warm-cache p95為74.80 ms；深頁teacher p95為74.80 ms、reviewer p95為73.29 ms。
- 最大50-row response為55,602 bytes。
- 18個 `EXPLAIN (ANALYZE, BUFFERS)` 均為單一root Aggregate；代表性execution time為55.68–74.27 ms、shared read blocks為0。每次measured call只執行一個data＋facet SQL，無N+1。
- 舊UI改動前browser network觀察值為約154–392 ms，只作開發環境參考；因未保留可交錯執行嘅舊query build，唔將呢個非受控range冒充正式同比。新腳本結果成為其後staging／Vercel比較基線。

既有 `npm run test:catalog:performance` 另以5,000 history rows、200-row bulk及100個同步student read jobs通過：history first-page p95 5.69 ms、cursor page p95 10.63 ms、exact search p95 55.85 ms、200-row preview p95 208.48 ms，findings為空。

查詢證據顯示現有schema及bounded SQL已符合本地預算，所以本輪沒有新增read projection、index、Prisma schema或migration。

## 5. 文案、privacy及回歸

- ordinary list／drawer不顯示raw sense key、raw enum、raw revision或完整source path；reviewer只可在「進階資料」查核技術資料。
- lifecycle、workflow、readiness及issue scope分開傳輸及顯示；ACTIVE＋pending仍保留ACTIVE current語義。
- structured issue由正式validator code產生，再經集中teacher presentation mapping顯示中文原因及下一步；未知值使用安全fallback。
- 繁體固定「干擾項」、簡體固定「干扰项」，post-conversion regression已覆蓋。
- browser console最終人工巡查為0 errors；320／768／1024／1440代表viewport已完成Chromium視覺及keyboard smoke review。

## 6. 尚待外部gate

- 未有不參與開發嘅英文老師，代表性老師任務UAT標記deferred。
- VoiceOver／TalkBack及實體iOS／Android完整矩陣deferred；本輪只完成Chromium semantic／keyboard／responsive驗收。
- staging／Vercel managed PostgreSQL、網絡延遲、production-like cache及並發量測須以本文件本地數字作比較基線。
- production deploy、monitoring及rollback演練未獲本計劃授權；使用者另行要求本輪完成後push Git staging branch，唔等同production deploy。
