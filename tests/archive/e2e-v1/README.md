# 歷史 V1 browser specs

此目錄保留整頓前的 V1 browser regression 作為歷史證據。這些 spec 依賴已退役的
`/api/study` writer、V1 checkpoint／review queue namespace 或舊 quiz layout，故不屬於
現行 Playwright testDir，也不應重新加入 active project。

現行學習流程的 browser coverage 由以下檔案維護：

- `tests/e2e/study-stream-v2.spec.ts`：V2 stream、action、outbox、recovery 及跨 context。
- `tests/e2e/study-v2-shell.spec.ts`：V2 study shell、導覽、離開路徑及基本 accessibility。

如要研究歷史回歸，先閱讀 `docs/current-product.md` 及
`plans/project-consolidation-and-student-handoff.md`；不要把這裡的 V1 request、phase 或
localStorage contract 當成產品要求。
