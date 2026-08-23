# 詞庫治理本機效能基線（2026-08-23）

## 結論

本機 PostgreSQL 嘅資料正確性、5,000 筆歷史 cursor 分頁、200 行原子提交，以及學生讀取並發均通過。初次基線判定為 `NEEDS_HARDENING`，原因係批量工作區 API 重複回傳完整 200 組 batch，以及 200 行 preview 超出本機 2 秒 advisory threshold。`catalog-submission-patch-v1` 已於同日完成並重跑兩次基線：response amplification已消除；目前只剩 preview p95 約2.41–2.59秒需要下一輪profile。

本結果只代表 local service／database baseline，唔代表 managed PostgreSQL、Vercel function、Upstash 或多 instance HTTP concurrency。

## 測試環境及方法

- Apple arm64、8 CPU、8 GiB RAM；Node.js v24.8.0；PostgreSQL 16.14（Homebrew）；Prisma pool max 3；
- 正式本機 baseline：5,469 ACTIVE senses、107 DRAFT senses；
- 一次性 fixtures：5,000 個已審核 standalone requests＋history feed、200 行正式 `word-catalog-v1` CREATE CSV；
- 完整批量流程：preview → submit → claim → 200 組逐項 approve → atomic finalize；
- 學生讀取：50 個 dashboard＋50 個 unit-progress 同步工作；
- checker：`DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run test:catalog:performance`。環境名稱須按目標 metadata 明確提供；checker只接受相符嘅 non-production markers，並以唯一 prefix 在開始前及完成後清理 fixtures。

## 第二次完整量度

| 範圍 | 實測結果 | 判定 |
|---|---:|---|
| 5,000-row history first page | p95 7.98 ms | 通過 |
| 100 個 50-row cursor pages | p95 9.68 ms；5,000 筆無重複／遺漏 | 通過 |
| history exact search | p95 55.83 ms | 通過，但第一次 run 曾錄得 474.97 ms，需保留 cold/cache tracing |
| history 最大 50-row response | 64,663 bytes | 通過 |
| 200-row preview（5 runs） | p50 2,452.68 ms；p95 2,628.32 ms | 超出 2 秒本機 advisory threshold |
| preview response | 787,540 bytes | 需要縮減 payload |
| submit | 2,050.73 ms；800,563-byte response | 寫入時間可接受；payload 需要縮減 |
| claim | 38.63 ms；857,933-byte response | DB 時間通過；payload 需要縮減 |
| 200 組逐項 review | 總計 3,519.97 ms；每組 p95 20.65 ms | service time 通過 |
| 200 個 review responses | 每次 858,058–874,797 bytes；累計 165.26 MiB | 不通過；主要加固項目 |
| atomic finalize | 3,718.81 ms | 通過本機 30 秒門檻 |
| finalize integrity | 200 approved children、200 result revisions、200 projections、1 batch history | 通過 |
| finalize response | 879,627 bytes | 超出 512 KiB advisory threshold |
| 50 dashboard concurrent calls | p95 498.20 ms | 通過 |
| 50 unit-progress concurrent calls | p95 186.50 ms | 通過 |
| 100 student jobs | 498.70 ms wall time；0 failures | 通過 |

第一次完整 run 同樣成功，preview p95 為 2,520.40 ms、review 總時間 3,124.02 ms、finalize 3,274.59 ms；證明 preview 超標及完整 lifecycle 時間屬可重現。Exact search 第一次 p95 為 474.97 ms，第二次降至 55.83 ms，暫時唔應以單一 warm-cache 數字宣稱穩定。

## 必須加固

1. `review`、`claim`、`submit` 同 `finalize` mutation response 改為 compact result，只回 batch revision／status、更新過嘅 group及必要 counters；唔應每次重新序列化完整 rows＋groups；
2. batch rows／groups 詳情改成按頁或按 group 載入，前端以 revision-aware patch 更新本地狀態；
3. profile 200-row preview 嘅 query count、validation CPU 同 JSON serialization，將 database work 同 response serialization 分開量度；
4. 對 exact search 加 query tracing／cold-cache 重複測試；如果真實 managed DB 仍超標，再評估 `pg_trgm`／搜尋專用 index；
5. 100-way 並發測試觸發 `pg`「client 正執行 query 時再次 query」deprecation warning。雖然本輪 0 failures，但升級 pg 9 前須驗證 Prisma adapter／pool 路徑。

## Compact mutation response加固結果

後端 mutation 改用帶 `batchId`、`baseRevision`、最新 `revision` 同最多一個group delta嘅 `catalog-submission-patch-v1`。Client只會對相符revision套用；重播係no-op，stale／錯batch／缺少group會重新GET完整批次。首次detail GET仍保留完整內容，server-side expected revision、payload digest acknowledgement、四眼審核、recent-auth、idempotency及atomic finalize全部不變。

| 指標 | 加固前 | 加固後兩次實測 | 改善 |
|---|---:|---:|---:|
| submit response | 800,563 bytes | 433 bytes | 約99.95% |
| claim response | 857,933 bytes | 430 bytes | 約99.95% |
| 單次 review response | 平均866,418 bytes | 平均3,665 bytes | 約99.58% |
| 200次 review累計 | 165.26 MiB | 0.70 MiB | 約99.58% |
| finalize response | 879,627 bytes | 503 bytes | 約99.94% |
| 首次 reviewer detail | 未獨立量度 | 857,933 bytes；只下載一次 | 預期保留完整內容 |
| 200組 review service time | 3,519.97 ms | 3,278／3,693 ms | 無效能回退 |
| atomic finalize | 3,718.81 ms | 8,814.58／3,894.71 ms | 有單次波動，但兩次均低於30秒門檻 |
| 200-row preview p95 | 2,628.32 ms | 2,593.70／2,413.08 ms | 仍超出2秒門檻 |

Checker現已把 submit／claim／finalize 8 KiB、單次review p95 16 KiB、200次review累計2 MiB設為compact-response regression gates。兩次加固後完整流程均確認200 approved children、200 result revisions、200 projections、1 batch history及100個學生同步讀取0 failures。整體仍顯示 `NEEDS_HARDENING`，唯一 finding係preview p95高於2秒。

## 清理及完整性

測試後只讀核對：fixture users、requests、batches、senses、entries、words、recent-auth grants 全部為 0；ACTIVE senses 回復 5,469、history feed 回復 1、`CatalogMutationState.revision` 回復 16。`npm run check:catalog-governance` 再次回傳 `ready: true`、projection mismatch 0、finalizing batches 0、terminal batches with pending children 0。

## 尚未涵蓋

- managed／staging PostgreSQL latency及 cold cache；
- Vercel function duration、memory、response compression及 request／response ceiling；
- production-like Upstash；
- 多 instance HTTP concurrency、真實 browser network及代表性老師 UAT。
