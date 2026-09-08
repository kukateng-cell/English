# 虛構學校及增量學習模擬

狀態：已完成（本地實作及驗證）；2026-09-08，使用者批准設計及建立。

## 背景、目標及非目標

舊 analytics fixture 固定每班八人、每日一張卡、少量詞跨級及整庫重建，不能呈現連續使用。
建立自然繁體姓名、18 班各 28–36 人、固定班內學號、seeded 個人習慣、逐項學習歷史及可重跑增量更新。
只供本地 development/test 虛構資料；不改 production 學習規則，不建立研究數據、不發佈。
第一版最多回填 90 日並限制在目前學年；跨學年升班由另一期處理，不偽造學年前活動。

## 設計及依賴

- `demo:init` 明確確認後替換本地名冊及學習 fixture，保留 catalog；密碼沿用 env。
- `demo:update` 依固定 seed/identity/date 模擬到目前時間。以學生 transaction/checkpoint 提交，可補漏及續跑。
- `demo:check` 驗證名冊、時間、ledger、Review、checkpoint 及重播一致。
- 純模擬沿用 selectNextItem、admitWork、requiresEvidenceObligation、quality mapping、question builder、SM-2。
- manifest 保存版本、seed、開始日期、catalog digest、學生身份；不存明文密碼。
- 重播在相同 catalog/seed 下穩定；更新拒絕 catalog 漂移、帳戶身份或手動學習造成的狀態衝突。
- 保留舊 generator/checker 供舊固定 fixture 的 regression。新指令不改其人數斷言。
- 本地啟動整合用獨立 `dev:demo`，先更新再啟動，避免一般 dev 隱式修改資料。

## 分階段 checklist

- [x] 純名冊/時間/學習模擬及單元測試。
- [x] 本地 target/持久環境 marker 防護、初始化、增量 writer、checker。
- [x] 重跑、分段補漏、失敗續跑、時間及 lineage 驗證。
- [x] 本地初始化並以報表所用 ledger 驗證，記錄實際結果。
- [x] 使用文件及命令整合。

## 風險及驗收

虛構分布不是實證模型。歷史 factory 重用純政策但不經 HTTP/auth；不得聲稱端到端 production replay。
測試矩陣：同 seed 重播、不同 seed 差異、每日補漏等價、無未來操作、無入學前活動、due/date 正確、任務 cap/delay、self-rating 不改 Review、唯一 receipts、報表 lineage。
資料庫每名學生原子提交，失敗可續跑；初始化取代舊 fixture 需要明確 flag，不能誤刪正式庫。
rollback：程式可回退；更新不改舊事件；初始化刪除的舊 fixture 只能由備份或舊 generator 重建。
DoD：單元、lint、typecheck、本地資料驗證通過；每天重跑無重複記錄，指令及限制可查閱。

## 執行紀錄

- `npm test`：429/429；全庫 lint、TypeScript noEmit、git diff --check 通過。
- 本機 Prisma Client 原本過期，重新 generate；原有 fake-indexeddb 缺失，按已簽入依賴補齊，未改 dependency manifest/lockfile。
- 名冊 seed `school-2026`：18 班、566 名學生、6 名教師。保留真實姓名用字「余」，source-copy audit 加入僅限該專字的例外，避免誤轉成「餘」。
- 初始化到 2026-09-07 23:59:59 +08：43,549 actions，9,489 objectives、34,060 encounters。
- 補到 2026-09-08 09:22:24 +08：新增682 actions；同 cutoff 再跑新增0，約7秒。
- 第二次更新到 09:26:03 +08，在完成50名學生後 Ctrl-C（exit1）中斷，再執行相同命令成功續跑。
- 最終 `demo:check`：44,231 actions，9,666 objectives、34,565 encounters。逐名驗證 Review 全欄位重播、工作狀態、receipt/StudyDay數量，並使用正式 loadRewardActivityForMembers/buildStudentReward 檢查：全校 validationGapCount 及 StudyDay mismatch 均為0。
- 單元測試涵蓋 seed 重現/差異、人數/學號、逐日prefix等價、未來時間、due與任務delay/cap、self-rating不改Review、晚間多session不重疊、未加入/無活動及CLI拒絕production/遠端/錯誤日期。
- 本地開發伺服器因補依賴期間的快取錯誤需重啟；舊 `.next/dev` 保留於 `.next/dev-before-demo-20260908`，重新建立快取後 `http://127.0.0.1:3200/login` HTTP200，伺服器保持運行。
- 未執行 production build、完整瀏覽器手勢/DB learning/migration suites；本次未修改 production流程、schema或API。報表以正式reader核對，未聲稱完成視覺或原生裝置QA。
- 未安裝每日背景排程；`demo:update` 可每日手動/由排程呼叫，`dev:demo` 提供啟動時補資料。完整歷史重播隨資料增加有成本，第一版以全學年範圍為上限；後續可在效能量測後加入可序列化模擬狀態。
- 使用說明：`scripts/DEMO-SCHOOL.md`。舊固定 fixture generator/checker 保留，兩套人數驗收不可混用。
