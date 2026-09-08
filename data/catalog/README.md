# 正式詞庫來源

這個目錄保存目前 seed 及初始詞庫驗證所需的受控檔案：

- `a1-word-catalog-reference-v1/`、`a2-word-catalog-reference-v1/`、
  `b1-word-catalog-reference-v1/`、`b2-word-catalog-reference-v1/`：四份正式 CSV。
- `catalog-identity/`：identity manifest 及 initial-activation manifest。

程式以 `src/lib/catalog/seed.ts` 的明確 mapping 讀取實體路徑。CSV row 內的
`sourceFile` 仍保留原有 `outputs/...` 穩定識別名；該識別名參與 `sourceDigest`、identity
assignment 及歷史資料，搬動檔案時不可批量改寫。只有在刻意批准詞庫身份變更時，才可重新生成
manifest，並要按 [詞庫切換計劃](../../plans/csv-word-catalog-local-database-cutover.md)
完成 digest、identity、fresh DB 及 existing DB 回歸。

日常開發不可手動修改 identity／activation manifest，也不可用 `prisma db push` 代替 migration。
需要重建本地詞庫時，先確認 `MIGRATE_URL`、database environment marker 及目標 topology，
再閱讀 [本地開發指南](../../docs/development.md) 和 `scripts/rebuild-local-catalog.mjs`。

`word list.md` 是歷史詞表，不是目前 canonical seed 來源；`output/` 則保存歷史視覺驗收證據。
