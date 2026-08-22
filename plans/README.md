# 計劃書目錄

本目錄集中保存項目的產品計劃、功能實施計劃及大型重構計劃。新增功能或跨頁面／跨層改動應先在此建立計劃書，再按 checklist 實施及更新進度。

計劃書記錄目標、範圍、取捨與驗收方式，但不是現況的唯一真相。當文件與實作不一致時，程式、測試、`prisma/schema.prisma`、migration 歷史及 production workflow 優先；發現差異後應同步修正相關計劃書。

本文及本目錄其他文件內的程式路徑，除非另有說明，均相對 repository root。

## 計劃書索引

| 文件 | 類型 | 狀態 | 說明 |
|---|---|---|---|
| [project-plan.md](./project-plan.md) | 產品總體計劃 | 持續維護 | 產品願景、研究背景、已實現能力及長期路線 |
| [retrieval-first-learning-program.md](./retrieval-first-learning-program.md) | 主計劃／Program Plan | 進行中（本地基線完成） | Retrieval-first V2 local product 已完成並凍結；只餘未獲授權 external rollout／research gates |
| [retrieval-first-learning-contract.md](./retrieval-first-learning-contract.md) | RFC／產品及學習規範 | 已批准並生效 | 卡片語義、3 秒 long-press reveal、客觀證據、bounded verification debt、metrics 及 policy version |
| [learning-stream-v2-implementation.md](./learning-stream-v2-implementation.md) | 核心學習流程實施計劃 | 已完成（本地產品） | Continuous stream、UI state machine、API、outbox、checkpoint 及 V1 rollback；external rollout deferred |
| [study-credential-v2-migration.md](./study-credential-v2-migration.md) | 安全／資料遷移計劃 | 已完成（product scope） | Stream-item credential、v1/v2 coexistence、rotation 及 expand migrations；Stage E destructive cleanup deferred |
| [research-learning-framework.md](./research-learning-framework.md) | 研究治理／telemetry 計劃 | 待審批（暫緩） | Research feature off；consent、privacy、diagnostic、telemetry 及 experiment 未獲外部批准 |
| [ui-design-system-migration.md](./ui-design-system-migration.md) | 實施計劃 | 已完成 | 將 EMM Style 01 設計系統遷移到學生端、教師端及管理端 |
| [class-roster-import-and-access-control.md](./class-roster-import-and-access-control.md) | 實施計劃 | 已完成（local verification；production/native gates deferred） | Revision 3 經兩個相同全範圍 reviewer PASS；CI-01 已將 dependency audit 與 functional-quality job 分離並完成 targeted local verification。audit advisory、production-only positive config、production deploy、完整原生 screen-reader／device matrix仍 deferred |
| [word-catalog-governance-and-lifecycle.md](./word-catalog-governance-and-lifecycle.md) | 實施計劃 | 進行中（治理工作區、正式 baseline、批量提交及歷史已完成 local verification） | 建立 sense-level 詞庫、39 欄 `word-catalog-v1`、分方向人工干擾池、immutable approved revision及老師 capability 四眼審核；現已完成治理 API／UI、學生及統計 current reader、V1 projection、digest-bound 5,469 ACTIVE／107 DRAFT baseline、CSV preview／原子commit、audit history及catalog limiter；production rollout、performance／外部UAT及legacy cleanup仍待後續 |
| [word-catalog-bulk-submission-and-history.md](./word-catalog-bulk-submission-and-history.md) | 實施計劃 | 本地實作完成（待production readiness） | `word-catalog-v1` CSV preview／many-to-one conflict resolution／原子草稿提交／批次審核，以及按權限可搜尋 before／after、revision及audit timeline的詞條修改歷史界面；production migration／deploy未執行 |
| [csv-word-catalog-local-database-cutover.md](./csv-word-catalog-local-database-cutover.md) | 資料切換／實施計劃 | 進行中（Revision 3；正式 baseline reconciliation） | 以 A1–B2 sense-level CSV 取代 Markdown canonical seed，加入逐表 word→sense transition、V1 read-only compatibility、digest-bound 正式初始 ACTIVE／DRAFT 狀態、ACTIVE-only runtime、安全 public question contract及真實解鎖 demo；local reset 已完成，production rollout仍未授權 |
| [teacher-workspace-roster-progress-redesign.md](./teacher-workspace-roster-progress-redesign.md) | 重設計計劃 | 已完成（Revision 5 local implementation／verification；external gates deferred） | `/teacher`只保留快速KPI及班級跟進摘要；`/teacher/analytics`集中詳細班級／學生分析；學生工作區用「學生名冊／學生進度」分頁，保留 `/teacher/progress` 相容入口；`npm run lint`、`npx tsc --noEmit`、`npm run build`通過；production deploy、full-scale及native device matrix仍 deferred |
| [admin-user-directory-and-learning-analytics.md](./admin-user-directory-and-learning-analytics.md) | 實施計劃 | 進行中（student number／analytics export review） | 學號 migration、匯入／排序、教師／管理員顯示及 analytics CSV／XLSX 已實作；兩個獨立 reviewer 正進行全範圍收尾，production deploy、contract migration、VoiceOver／TalkBack及完整原生裝置QA deferred |
| [student-leaderboard-scopes-and-overview.md](./student-leaderboard-scopes-and-overview.md) | 實施計劃 | 進行中 | 學生排行榜加入本班／全年級／全校範圍、入頁即見的個人排名概覽、responsive layout 及 staged demo fixture；local implementation，production deploy deferred |
| [student-ui-fidelity-corrections.md](./student-ui-fidelity-corrections.md) | 修正計劃 | 已完成 | 修正 mobile 導覽、繁簡／品牌、學生頁 spacing 及認字卡 Prototype fidelity |
| [study-header-floating-navigation.md](./study-header-floating-navigation.md) | 修正計劃 | 已完成 | 對齊認字頁 header，並把 mobile bottom navigation 改為 floating surface |
| [student-desktop-layout-corrections.md](./student-desktop-layout-corrections.md) | 修正計劃 | 已完成 | 修正 desktop 認字卡置中、sticky 側欄帳戶控制、單元闖關寬版、首頁快捷卡高度及統計入口可見性；lint、typecheck、build 及 targeted browser geometry／study reveal tests 通過 |
| [student-dashboard-navigation-corrections.md](./student-dashboard-navigation-corrections.md) | 修正計劃 | 已完成 | 修正「今日」四個快捷入口的 desktop 排列，加入排行榜／成就入口，並放大詞表頁切換控制；lint、typecheck、build 及 targeted browser screenshot／geometry tests 通過 |
| [admin-and-student-icon-fidelity-corrections.md](./admin-and-student-icon-fidelity-corrections.md) | 修正計劃 | 已完成 | 修正管理工作台 active 導覽、角色概覽可讀性及管理／學生排行榜成就圖示一致性 |
| [icon-system-audit-and-redesign.md](./icon-system-audit-and-redesign.md) | 修正計劃 | 已完成（local verification） | 全面清理學生、教師、管理員及共用頁面嘅舊 inline SVG、emoji、Unicode 視覺圖標，統一 EMM Style 02；authenticated browser matrix deferred |
| [workspace-desktop-account-rail-correction.md](./workspace-desktop-account-rail-correction.md) | 修正計劃 | 已完成（local verification） | 修正教師／管理員 desktop sidebar 帳戶控制隨長頁下移，令其固定於左下 viewport；authenticated browser smoke deferred |
| [account-pages-responsive-copy-corrections.md](./account-pages-responsive-copy-corrections.md) | 修正計劃 | 已完成（local verification） | 跨學生／教師／管理員帳號頁面修正平板／手機排版、欄位說明及過度技術化文案；完整瀏覽器裝置矩陣 deferred |
| [teacher-class-summary-improvement.md](./teacher-class-summary-improvement.md) | 修正計劃 | 已完成（local verification） | 改善教師班級摘要的使用率、待複習人數、比例視覺化、A1／A2／B1／B2 分項掌握及欄位說明；不涉及加分機制；登入後瀏覽器矩陣 deferred |
| [icon-semantic-deduplication.md](./icon-semantic-deduplication.md) | 修正計劃 | 已完成（local verification） | 全站圖標語義去重，分開單元闖關、統計、排行榜、成就、名冊、單詞庫及客觀測驗入口；登入後瀏覽器矩陣 deferred |

新增、改名、完成或取代計劃書時，必須同步更新此表。

### Retrieval-first Learning Program 文件關係

五份文件都放喺 `plans/`，但唔係五份平排又重複嘅 implementation plan：

```text
retrieval-first-learning-program.md              總入口及跨計劃 release gates
├── retrieval-first-learning-contract.md         規範產品／學習語義
├── learning-stream-v2-implementation.md         落實 UI、API、續接及 rollout
├── study-credential-v2-migration.md              落實安全、資料及 compatibility
└── research-learning-framework.md                獨立嘅研究治理及研究里程碑
```

主計劃唔重複子計劃 checklist；gesture／evidence 變更先更新 Contract，API／schema／
migration 變更更新對應實施計劃，研究 consent／retention／assignment 變更更新 Research
Framework。第一份正式 experiment protocol 獲批准時，先建立並索引
`research/protocols/<study-name>.md`。

Retrieval-first 嘅可重現 handoff、credential compatibility inventory 同 internal soak／incident
runbook 放喺 `plans/artifacts/`；呢啲係受控計劃嘅 evidence artifacts，唔係額外嘅產品規格或
rollout approval。

後續 AI／開發者應先讀
[Retrieval-first V2 Current Product Baseline](./artifacts/retrieval-first-v2-current-product-baseline.md)，
了解 I-011–I-035 後嘅最終學生流程、視覺 override、可靠性不變條件同仍未獲授權嘅 external gates。

## 文件命名

- 使用小寫 kebab-case，例如 `student-assignment-workflow.md`。
- 一份文件只負責一個可清楚界定的功能、重構或發佈項目。
- 跨多個里程碑的產品願景放在 `project-plan.md`；具體實施步驟另開文件。
- 已完成文件保留在 `plans/`，狀態改為「已完成」；文件數量明顯增加後才建立 `plans/archive/`。

## 狀態定義

每份實施計劃頂部應標示以下其中一個狀態：

- `草擬中`：範圍或關鍵決定仍未整理完成。
- `待審批`：計劃已可評審，但未獲確認開始實作。
- `進行中`：已開始修改程式或資料。
- `受阻`：有明確外部依賴或決定阻止後續工作。
- `已完成`：所有必要 checklist 及驗收已完成。
- `已取代`：由另一份計劃書接替，必須連結到取代文件。
- `已批准並生效`：只用於 normative contract；規範已獲批准並由現行 implementation 選用，
  但仍可另列 external acceptance gate。
- `暫緩`：目前無已授權工作；重開前要重新確認 scope、依賴及外部批准，唔可以自動續做。

## 實施計劃必要內容

新計劃至少包括：

- [ ] 背景及問題定義
- [ ] 目標、非目標及成功準則
- [ ] 現況與依賴盤點
- [ ] 路由、元件、API、資料及 migration 影響
- [ ] 分階段實施步驟
- [ ] 每個階段的 checklist、產出及驗收條件
- [ ] 安全、資料一致性、效能、無障礙及相容性風險
- [ ] 測試矩陣及實際驗證指令
- [ ] 發佈、觀察及 rollback 策略
- [ ] 決策紀錄及未決事項

## 工作流程

1. 在寫代碼前盤點現有實作、測試及相關計劃。
2. 建立或更新 `plans/<feature-name>.md`，並加入本索引。
3. 將工作拆成可驗證、可獨立勾選的 checklist；高風險行為要另列保護措施。
4. 獲准開始實作後，將狀態改為「進行中」。
5. 每完成一項且通過相應驗證後才由 `[ ]` 改成 `[x]`；不要以「已寫代碼」代替「已驗證」。
6. 實作期間如改變範圍、資料 contract 或驗收方式，先更新計劃書再繼續。
7. 完成時記錄實際執行的測試、未執行項目、已知限制及後續工作，然後把狀態改為「已完成」。

小型、局部、低風險修正不必為每次改動另建計劃書；但如已有相關計劃，仍應更新對應 checklist。新功能、資料模型改動、跨頁面 UI 重構、認證／學習流程改動及 production 發佈改動則必須先有計劃。
