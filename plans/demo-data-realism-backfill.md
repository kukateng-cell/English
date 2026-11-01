# 示範資料真實化補寫（雲端示範庫）

狀態：已完成（2026-11-01）

## 背景

評委示範庫（Supabase `ogxdoezdhixgahlfylmf`）由本機 `demo:school` 匯入，之後只做過一次性複製，
沒有持續更新。結果：

- 全部 17,073 筆 Review 都集中在 A1；A2／B1／B2 從未解鎖，學生「分級」只看得到 A1。
- 272 名學生連第一個 A1 單元都未完成，`/stats` 的「長期掌握」常顯示 0。
- `UserAchievement` 只有 7 筆（兩個測試帳戶），其餘 566 名學生一律 `0 / 9`。
- `ReviewEvent` 在 2026-10-31 只有 1 筆、2026-11-01 只有 5 筆，活動圖表出現斷崖。

本計劃只補寫**虛構示範資料**，不改 schema、不改學習政策、不改 V2 scoring／credential／receipt 語義。

## 目標

1. 依現有活動量分層，為部分學生補齊 A2／B1／B2 的合法單元解鎖進度（維持 80% 認字門檻）。
2. 為有學習紀錄的學生補少量「長期掌握」詞（interval ≥ 22），令掌握度不再恆為 0，但幅度保持克制。
3. 依實際 Review／StudyDay／連續天數回填 `UserAchievement`，使 `/achievements` 顯示與學習量相符的 `X / 9`。
4. 補 2026-10-31 及 2026-11-01 的活動，令 `/stats` 活動圖表沒有斷崖，並保留逐日增長趨勢。

## 非目標

- 不重跑 `demo:init`、不重新匯入整個資料庫、不改詞庫、不改學生姓名或班級。
- 不修改 V2 `StudyStreamItem`／`StudySession`／`OperationReceipt`／objective target／snapshot。
- 不更新 `demoSchool:*` checkpoint manifest（雲端庫本來就不是 `demo:update` 的目標）；
  補寫後雲端資料不可再交給 `demo:check` 作嚴格逐學生核對。

## 分層設計

以每位學生現有 `Review` 數 + `StudyDay` 數排序（同班最多 2 人升級，避免集中在同一班）：

| 層級 | 人數 | 補寫範圍 | 掌握比例（解鎖範圍內） |
| --- | --- | --- | --- |
| B2 | 2 | 完成 A1＋A2＋B1 全部單元 80%，再學 B2 前 3 個單元 | A1 60%、A2 45%、B1 30%、B2 8% |
| B1 | 6 | 完成 A1＋A2 全部單元 80%，再學 B1 前 3 個單元 | A1 55%、A2 35%、B1 10% |
| A2 | 16 | 完成 A1 全部單元 80%，再學 A2 前 3 個單元 | A1 45%、A2 10% |
| A1 | 其餘有紀錄學生 | 補齊第一個單元至 80%，再按活動量補 0–2 個單元 | 22% ± 5% |
| 新加入（0 Review） | 41 | 只補 4–8 個詞及 3–5 個學習日 | 1–2 個詞 |

補寫的每個新詞會建立 1–4 筆 SM-2 事件（quality 4／2），日期分佈在 2026-09-01 至執行時間之間，
最後狀態的 `nextReviewDate` 大多落在未來，少量保留「已到期」以維持真實感。

## 實作

新增一次性腳本 `scripts/backfill-demo-realism.ts`：

- 預設 dry-run；`--apply` 才寫入。
- 只允許本機 DB；雲端須同時提供 `--confirm-cloud`（避免誤寫）。
- 以 seed 決定所有隨機值，重跑結果一致。
- 每名學生一個 transaction，`set_config('app.review_event_writer','v2',true)` 抑制 legacy bridge trigger。
- 寫入順序：`Review` → `ReviewEvent` → `StudyDay` → `UserAchievement`。
- 全部使用 `skipDuplicates`／upsert，重跑不重複。

## Checklist

- [x] 備份 `Review`、`UserAchievement`、`StudyDay` 受影響資料到 `test-results/backfill-backup-20261101.sql`
- [x] dry-run 檢視分層人數、新增列數、預估 DB 大小
- [x] 對雲端示範庫執行 `--apply --confirm-cloud`
- [x] 核對 A1／A2／B1／B2 解鎖分佈與掌握度分佈
- [x] 核對 `UserAchievement` 覆蓋率及 `/achievements` 顯示
- [x] 核對 2026-10-31／11-01 活動量及 `/stats` 圖表
- [x] 記錄實際執行結果、未執行項目及已知限制

## 執行結果（2026-11-01）

目標庫：Supabase `ogxdoezdhixgahlfylmf`（東京 session pooler，Postgres 17）。

| 指標 | 執行前 | 執行後 |
| --- | --- | --- |
| `Review` 列數 | 17,073 | 37,230 |
| `ReviewEvent` 列數 | 103,966 | 107,834 |
| `UserAchievement` 列數 | 7（2 個測試帳戶） | 2,871（566 名學生全部 ≥1） |
| 零掌握學生 | 94（41 人完全沒有 Review） | 0 |
| 掌握詞數（全體） | 平均 7、最多 46 | 平均 22、最多 1,137、最少 2 |
| 已解鎖 A2 學生 | 0 | 24 |
| 已解鎖 B1 學生 | 0 | 8 |
| 已解鎖 B2 學生 | 0 | 2 |
| 2026-10-31 活動 | 1 | 1,907 |
| 2026-11-01 活動 | 5 | 1,150 |
| 資料庫大小 | 396 MB | 420 MB |

- 成就分佈：1–3 個 45 人、4–6 個 445 人、7–9 個 76 人；沒有學生停留在 `0 / 9`。
  `__test_student__local` 由 `3 / 9` 變為 `4 / 9`。
- 兩名最高級學生：司徒嘉欣（JUNIOR_3A，B2，1,137 掌握）、蕭芷欣（JUNIOR_1A，B2，1,071 掌握）。
- 最近活動序列（Asia/Shanghai）：10-28 2,119 → 10-29 1,911 → 10-30 2,102 → 10-31 1,907 → 11-01 1,150（週日且只到執行時間）。
- 已驗證 `/leaderboard` 不再顯示「部分紀錄核對中」；回填事件全部標記
  `probePurpose=OPERATIONAL_DIAGNOSTIC`，不進入排行榜計分與客觀題正確率。
- 每個 `StudyDay` 都已補至少一筆對應事件，`studyDayMismatchCount = 0`。
- 兩個示範登入帳戶（`__test_student__local`、`__test_student__local_webkit`）另補 4 筆今日
  `OPERATIONAL_DIAGNOSTIC` 事件，令 `/stats` 的「今日複習詞數」及活動圖表即時可見；
  示範帳戶 `/achievements` 由 `3 / 9` 變為 `4 / 9`。

## 已知限制

- 回填的 Review 沒有逐次 objective target／snapshot，因此不計入「有效客觀題」及排行榜分數；
  教師端會看到 `masteredWords` 高於 `effectiveObjectiveProbeCount`。
- 雲端資料已與 `demoSchool` manifest 不一致，不可在雲端執行 `demo:check`；如需重新產生，
  應重跑本機 `demo:init` 再複製整庫。
- 只有 24 名學生升級至 A2 以上，其餘 542 名仍以 A1 為主，屬刻意的分層設計。
- 未執行高成本 regression（`npm run test:e2e:card-motion` 等），因為本次只改資料、不改程式行為。

## 風險

- 雲端免費方案 500 MB，目前 396 MB；補寫預計增加 15–25 MB，完成後需量測。
- 補寫只建立 `Review` 狀態及 `ReviewEvent`，不建立 objective target／snapshot，因此
  「有效客觀題」統計不會計入補寫事件；教師端 `masteredWords` 會高於 `effectiveObjectiveProbeCount`。
- 補寫後雲端資料與 `demoSchool` manifest 不再逐筆一致，不可在雲端執行 `demo:check`。
- 若日後要重跑 `demo:init`，需重新複製整庫。

## Definition of Done

- `/stats` 的「各級別進度」對部分學生顯示 A2、B1、B2 已解鎖及非零進度。
- 有學習紀錄的學生「長期掌握」不再為 0。
- 每位學生 `/achievements` 顯示與其學習量相符的解鎖數（不再是 0 / 9）。
- 最近兩日活動量恢復至接近平日的水平，圖表沒有斷崖。
- 上述驗證以 SQL 查詢及實際頁面截圖為證，並記錄於本計劃。
