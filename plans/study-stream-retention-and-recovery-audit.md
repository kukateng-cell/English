# V2 保留、過期排程及跨單元回執修正

狀態：已完成（第六輪本地及 hosted CI）

## 背景與目標

3d68349 最新覆核發現三項：session cleanup 級聯刪除 Encounter、過期 OPEN due target 阻擋新 session、跨 scope outbox 回執污染目前 UI。依賴現行 Retrieval-first baseline／contract、target CAS、immutable snapshot 與 global receipt。

## 決策、範圍及風險

- 短期 cleanup 只清理 V1，且雙重檢查沒有 V2 stream items；V2 長期記錄保留。儲存量會增加，長期資料解耦／retention migration 留待另行設計，不改既有 migrations。
- OPEN due target 只在有未過期、未撤銷 session 及未過期 item lease 持有時阻擋重排。失去有效持有者可在新 session 重新租用同一 target／snapshot，沿用 target consumption 及 Review revision CAS，舊分頁不能重複計分。
- 新舊 presentation 任一先答題成功，其他未答 presentation 在同一 transaction 標記 SUPERSEDED；GET 不再續接已耗用的目標。DB 覆蓋兩種勝出次序。
- client 不再合併任何回執到 current item：核對 operation／action identity 後統一重新讀目前 scope 的 server state（含同題舊回執），bootstrap 用 generation／scope／mounted lifetime 防止過時查詢或已離開頁面覆蓋。目前增加 reveal／answer 各一次權威 GET，換取不混用不同 session／item／revision；卡面、選項及 checkpoint 一起採 server 狀態。
- 不改評分、UI 設計、production、main、資料 schema 或 GitHub ruleset。

第四輪審核新增範圍（`aeaa617` 後覆核）：

- POST 操作成功但權威 GET 失敗時，畫面必須標示狀態過時、暫停舊項目互動，並提供只重新載入 GET 的重試；不可把已提交操作重新標記為 blocked。
- 跨分頁 Objective target 已被另一操作消耗／presentation 被取代時，回應要有明確 terminal code；client 只移除該 operation、保留其他 outbox row，重新取得目前 scope，且重試不可無限重送同一操作。
- GET 發現仍在 session 內但已取消或 review revision 過期的 Objective presentation 時，先退休所有未使用的 leased presentation，再建立新 target，避免重複顯示只能回傳 terminal 409 的死題。
- 核對 V1 card-motion 的 future-backoff session rotation 測試，讓持久化時序斷言等待實際 localStorage 寫入，避免 hosted WebKit 的非決定性失敗。

第五輪審核新增範圍（`3ed34f8` 後覆核）：

- 四種 V2 action 的跨分頁終結語義要一致：自評／揭示在同一項目已完成時回傳可辨識的終結結果，feedback acknowledgement 可安全重播；不把一般 stale revision 當成可刪除衝突。
- 待同步 outbox 要以有上限的逐筆 drain 處理所有 pending row；遇到暫時錯誤即停止並保留後續，啟動、online、跨分頁 storage 事件及一次成功排送後均可續接。
- 保留每位使用者題目讀取限流，將共享出口 IP bucket 調整至課室共用容量，並以正式預設值加入 36 人 × 4 次讀取的回歸負載測試；不得用取消限流或測試環境繞過。

第六輪審核新增範圍（`dbe917f` 後覆核）：

- 補救任務進入 `EXPIRED`、`CANCELLED` 或 `ANSWERED` 後，所有未使用的 Learning Card presentation 必須退出續接流程；重新載入不可再次返回只能產生終結 409 的舊卡，同時保留歷史紀錄。
- Objective Probe 提交時，ReviewEvent 的題目版本欄位必須與 immutable question snapshot 一致；詞庫批准更新後完成舊題，事件仍記錄當時的 content／catalog revision、term 及 level。

## Checklist／驗收矩陣

- [x] 真正 cleanup DB 測試：V1 清理、V2 Encounter／客觀歷史及 coverage 所依賴的 distinct word 集合保留；測試在 rollback transaction 內，不刪現有資料。
- [x] 真正 scheduler DB 測試：未答 due 過期後新 session 續用 target／snapshot；新舊答案兩種勝出次序均最多一次計分。
- [x] 跨單元 REVEAL／OBJECTIVE 回執及舊 revision／generation 瀏覽器測試。
- [x] unit、lint、typecheck、build、V2 DB／browser、card-motion 回歸。
- [x] commit／push staging，核對候選 SHA CI；記錄限制及實際結果。
- [x] POST 成功後 GET 失敗的 stale-state／只讀重載流程及瀏覽器回歸測試。
- [x] terminal 409 的明確 server code、單一 outbox row 安全清理、保留其他 row 及瀏覽器回歸測試。
- [x] V1 future-backoff rotation 的 WebKit 時序回歸測試。
- [x] 四種 action 的跨分頁終結／重播回歸，及 outbox 多筆逐筆 drain、暫時錯誤停排與恢復測試。
- [x] 正式 IP 限流預設值的共享課室容量測試；每人限額及 production fail-closed 行為保持不變。
- [x] 過期／取消／完成 remediation obligation 的舊 Learning Card 不再續接，並以真正資料庫回歸覆蓋跨單元觸發過期及歷史保留。
- [x] 詞庫更新後提交舊 Objective Probe 的版本 provenance 回歸：判分使用舊快照，ReviewEvent 版本欄位與快照一致且只計分一次。

## 發佈、rollback 及 Definition of Done

只交付 staging，不部署或合併 main。可 revert 本次程式提交，但會恢復已知風險；清理暫停不需資料回填，已被刪除歷史不能憑此修正恢復。本輪新增回歸須通過且有實際證據；外部 admin ruleset 權限不假裝已完成。

## 實際驗證

- `npm run test:db:stream-v2`：最新工作樹通過。使用既有本機 PostgreSQL；只修改測試帳戶／fixtures，cleanup 在 rollback transaction 中執行，無現有 session 永久刪除。包含兩種新舊頁面勝出次序、exact target／snapshot identity、review revision 過期時舊 item／target 退休後重新派發，以及 Global／Unit 同一 remediation obligation 只保留最新 presentation。
- `npm test`：380 passed；`npm run lint -- --max-warnings=0`、`npx tsc --noEmit`、`git diff --check` 通過。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=all npm run build`：通過。
- `ENABLE_TEST_ROUTES=1 STUDY_V2_ASSIGNMENT_MODE=all npm run test:e2e:study-stream-v2`：15 passed（含 auth setup），覆蓋四種 action terminal／feedback replay、跨 scope stale-state、POST 成功後 GET 失敗只讀重載、refresh-in-flight outbox drain、terminal 409 單一 outbox row 清理及多筆 outbox drain。
- `STUDY_V2_ASSIGNMENT_MODE=off npm run test:e2e:card-motion`：通過；Chromium primary 73 passed／4 existing skipped，WebKit shard 1 為 17 passed、shard 2 為 16 passed。未改動環境檔；future-backoff rotation 等待 localStorage 持久化後同時核對 sessionId 及 retryAt。
- 兩位獨立 reviewer 已對最新修正工作樹覆核並 PASS。
- 提交 `4015a8f`（`fix: close V2 action and classroom queue audit gaps`）已推送 `staging`；[GitHub Actions run 33966106562](https://github.com/kukateng-cell/English/actions/runs/33966106562) 的 17 個 jobs（包括 required quality gate）全部成功。
- 第六輪本地驗證：`npm run test:db:stream-v2` 兩次通過，`STUDY_STREAM_SOAK_ITERATIONS=3 npm run check:study-stream-v2:soak` 三次通過；新增 snapshot cleanup 亦確認重跑不再增加本輪 orphan。兩位獨立 reviewer 已對最新工作樹覆核並 PASS。由於本地 `student-test` 已被先前 Playwright 執行污染，`npm run test:e2e:study-stream-v2` 重跑為 14/15（唯一失敗係 12 items 內未遇到 Learning Card）；今輪只改 server／DB regression／文件，fresh-DB hosted browser-v2 已通過。
- 修正提交 `dcb5e0d` 已推送 `staging`；[GitHub Actions run 33975575941](https://github.com/kukateng-cell/English/actions/runs/33975575941) 的 17 個 jobs（包括 required quality gate、fresh-seed、stream-v2、browser-v2、browser-motion 及 dependency audit）全部成功。
- 本次未新增 schema／migration，未做 production deploy、main merge、原生裝置／screen-reader matrix；V2 session 長期 archival／retention 解耦仍待後續設計。GitHub 強制合併規則仍需要管理員權限，本次沒有改動。
