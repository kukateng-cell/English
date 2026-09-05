# V2 保留、過期排程及跨單元回執修正

狀態：進行中

## 背景與目標

3d68349 最新覆核發現三項：session cleanup 級聯刪除 Encounter、過期 OPEN due target 阻擋新 session、跨 scope outbox 回執污染目前 UI。依賴現行 Retrieval-first baseline／contract、target CAS、immutable snapshot 與 global receipt。

## 決策、範圍及風險

- 短期 cleanup 只清理 V1，且雙重檢查沒有 V2 stream items；V2 長期記錄保留。儲存量會增加，長期資料解耦／retention migration 留待另行設計，不改既有 migrations。
- OPEN due target 只在有未過期、未撤銷 session 及未過期 item lease 持有時阻擋重排。失去有效持有者可在新 session 重新租用同一 target／snapshot，沿用 target consumption 及 Review revision CAS，舊分頁不能重複計分。
- 新舊 presentation 任一先答題成功，其他未答 presentation 在同一 transaction 標記 SUPERSEDED；GET 不再續接已耗用的目標。DB 覆蓋兩種勝出次序。
- client 不再合併任何回執到 current item：核對 operation／action identity 後統一重新讀目前 scope 的 server state（含同題舊回執），bootstrap 用 generation／scope／mounted lifetime 防止過時查詢或已離開頁面覆蓋。目前增加 reveal／answer 各一次權威 GET，換取不混用不同 session／item／revision；卡面、選項及 checkpoint 一起採 server 狀態。
- 不改評分、UI 設計、production、main、資料 schema 或 GitHub ruleset。

## Checklist／驗收矩陣

- [x] 真正 cleanup DB 測試：V1 清理、V2 Encounter／客觀歷史及 coverage 所依賴的 distinct word 集合保留；測試在 rollback transaction 內，不刪現有資料。
- [x] 真正 scheduler DB 測試：未答 due 過期後新 session 續用 target／snapshot；新舊答案兩種勝出次序均最多一次計分。
- [x] 跨單元 REVEAL／OBJECTIVE 回執及舊 revision／generation 瀏覽器測試。
- [x] unit、lint、typecheck、build、V2 DB／browser、card-motion 回歸。
- [ ] commit／push staging，核對候選 SHA CI；記錄限制及實際結果。

## 發佈、rollback 及 Definition of Done

只交付 staging，不部署或合併 main。可 revert 本次程式提交，但會恢復已知風險；清理暫停不需資料回填，已被刪除歷史不能憑此修正恢復。三項回歸須通過且有實際證據；外部 admin ruleset 權限不假裝已完成。

## 實際驗證

- `npm run test:db:stream-v2`：通過。使用既有本機 PostgreSQL；只修改測試帳戶／fixtures，cleanup 在 rollback transaction 中執行，無現有 session 永久刪除。包含兩種新舊頁面勝出次序及 exact target／snapshot identity。
- `npm test`：379 passed；`npm run lint -- --max-warnings=0`、`npx tsc --noEmit`、`git diff --check` 通過。
- `ENABLE_TEST_ROUTES=1 npm run build`：通過。
- `npm run test:e2e:study-stream-v2`：10 passed（含 auth setup），跨單元兩種回執、舊 bootstrap generation 及既有 V2 suite。新增測試使用真實瀏覽器及受控網路回應；DB suite 另驗證真正 server 行為。
- 第一輪 card-motion 因本機 `.env.local` 強制 V2 all，V1 tests 等待 `/api/study` 而超時，已停止；明確 `STUDY_V2_ASSIGNMENT_MODE=off` 重跑完整 `test:e2e:card-motion` 通過：primary 73 passed／4 existing skipped、WebKit 17 + 16 passed。未改動環境檔。
- 最後 mounted lifetime 補修後重新 build、379 unit、lint、typecheck 及 V2 browser 10 項全部通過。generation 測試包含真正 Next client-side navigation 離開 `/study` 後釋放舊回應，確認 checkpoint 維持 revision 9，不被改成 1。
