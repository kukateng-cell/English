# 計劃書目錄

本目錄集中保存項目的產品計劃、功能實施計劃及大型重構計劃。新增功能或跨頁面／跨層改動應先在此建立計劃書，再按 checklist 實施及更新進度。

計劃書記錄目標、範圍、取捨與驗收方式，但不是現況的唯一真相。當文件與實作不一致時，程式、測試、`prisma/schema.prisma`、migration 歷史及 production workflow 優先；發現差異後應同步修正相關計劃書。

本文及本目錄其他文件內的程式路徑，除非另有說明，均相對 repository root。

## 計劃書索引

| 文件 | 類型 | 狀態 | 說明 |
|---|---|---|---|
| [project-plan.md](./project-plan.md) | 產品總體計劃 | 持續維護 | 產品願景、研究背景、已實現能力及長期路線 |
| [ui-design-system-migration.md](./ui-design-system-migration.md) | 實施計劃 | 已完成 | 將 EMM Style 01 設計系統遷移到學生端、教師端及管理端 |
| [student-ui-fidelity-corrections.md](./student-ui-fidelity-corrections.md) | 修正計劃 | 已完成 | 修正 mobile 導覽、繁簡／品牌、學生頁 spacing 及認字卡 Prototype fidelity |
| [study-header-floating-navigation.md](./study-header-floating-navigation.md) | 修正計劃 | 已完成 | 對齊認字頁 header，並把 mobile bottom navigation 改為 floating surface |

新增、改名、完成或取代計劃書時，必須同步更新此表。

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
