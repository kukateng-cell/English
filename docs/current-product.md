# English 項目現行產品

> 文件角色：現況入口，不是新的產品規範。
> 核對起點：`codex/project-consolidation-and-student-handoff`，整頓實施前 commit `cfcf717`。
> 後續唯一開發主線：`codex/project-consolidation-and-student-handoff`。
> 計劃：[項目文件、目錄與學生交接整頓計劃](../plans/project-consolidation-and-student-handoff.md)。

## 這個產品做甚麼

English（見字會 SeeWord）是面向中文學校中學生的英語詞彙認讀平台。
主要目標是「見到英文，能辨認中文意思」，不把認讀功能描述成拼寫、自由回憶、文法、聽力或口語測驗。

現行 V2 學習流程由 server 發出連續的 Learning Card 或 Objective Probe：

```text
Learning Card
→ 先嘗試回想中文意思
→ 約一秒後顯示長按提示
→ 非發音區域 stationary long-press 3 秒揭示
→ 報告與剛才所想是否一致
→ server 確認 operational action

Objective Probe
→ 第一次合法選擇由 server 判分
→ correct 映射 quality 4，wrong 映射 quality 2
→ 以選項狀態及 continuation affordance 顯示 feedback
→ 確認後前往下一項
```

Global `/study` 是 continuous stream，沒有固定完成題數；每次已確認 action 後都可安全離開。
Unit mode 可以限制詞集，仍使用同一張卡片、題目、續接及 server action contract。

## 現行功能範圍

- A1、A2、B1、B2 sense-level 詞庫、主題及解鎖進度。
- Retrieval-first Learning Card、Objective Probe、versioned `retrieval-v1` learning policy 及 SM-2。
- Study session、opaque item credential、operationId、global receipt、CAS、Serializable transaction、
  offline outbox、checkpoint、跨分頁／跨裝置 reconciliation 及 bounded recovery。
- 學生、教師、管理員角色；首次改密、session 撤銷、名冊權限及最後管理員保護。
- 學生首頁、詞表、統計、打卡、成就、排行榜；教師班級／學生工作區、報表及詞庫治理；管理員帳戶及系統管理。
- 繁體／簡體顯示、明／暗主題、mobile／tablet／desktop responsive layout。
- PostgreSQL／Prisma migrations、production shared limiter、GitHub Actions 及 Vercel release gate。

## 目前仍要知道的事

這條分支的目標是只保留 V2。現有程式仍有 V1 assignment／client／測試和歷史資料欄位，
P4 會先完成 cutover matrix 及 test migration matrix，再移除 V1 執行流程；目前不能把退役當成已完成。
`retrieval-v1` 是現行 V2 的 policy identifier，不是 V1 UI 的名稱，不能因字串包含 `v1` 而刪除。

正式詞庫目前由 `data/catalog/` 下四份 CSV、identity manifest 及 initial-activation manifest 提供；
`word list.md` 是歷史詞表。CSV row 內保留 `outputs/...` 作穩定 `sourceFile` 識別名。P3 搬移已按受控 mapping
完成；之後仍須證明 bytes、source digest、identity、
啟用集合及已有資料庫讀取結果一致。

Production deploy、真實學生 pilot、研究資料收集、原生裝置／完整 screen-reader matrix 及 destructive contract cleanup
仍是獨立外部閘門；本地文件或 CI 通過不代表已完成。

## 應該先讀甚麼

1. [本地開發](./development.md)：安裝、資料庫、seed、demo 及環境分工。
2. [架構導覽](./architecture.md)：由頁面找到 route、service、transaction 及資料模型。
3. [測試指南](./testing.md)：按修改範圍選擇驗證，不把 demo reset 當一般排錯。
4. [Retrieval-first Contract](../plans/retrieval-first-learning-contract.md)：學習互動及證據的生效規範。
5. [計劃索引](../plans/README.md)：現行工作、暫緩項目及歷史證據。

如果文件與可執行程式、測試、schema 或 migration 不一致，以可執行證據為準，並在同一批改動修正文件。
