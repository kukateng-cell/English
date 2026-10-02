# Playwright 視覺驗收證據

呢個目錄保存已完成驗收、可供 review 的 screenshot 及說明，對應
[`plans/ui-design-system-migration.md`](../../../ui-design-system-migration.md)。檔案由本地
production build 產生，搬到呢度後只作歷史證據；日常 Playwright 重跑會寫入被 Git 忽略的
`test-results/screenshots/`，唔會覆寫以下圖片。

- `prototype-reference/reference/`：prototype 對照圖。
- `phase1-fixture/`：基礎 fixture 截圖。
- `phase5/`：教師／管理員工作區及學生卡面證據。
- `phase6/`：學生最終 responsive／locale／theme 證據及 `visual-qa.md`。

Reference 同 implementation 截圖沿用 `390x844`、`820x1180`、`1440x900` 等 viewport
命名。已登入截圖只使用 seeded real data；prototype 個人資料及固定統計數字唔屬 production route。
刪除或更新證據前，要先核對引用及 hash；唔好把呢個目錄當測試快取。
