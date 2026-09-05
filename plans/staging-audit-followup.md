# Staging 審核第二輪修正

狀態：已完成（程式及本地驗證、候選 SHA hosted CI 全部通過）

## 背景、目標與依賴

使用者批准修正 aee40a2 覆核的五項問題。依賴 current product baseline、catalog initial activation manifest、CIS-010 及現有 CI。恢復空白資料庫初始化；保留原批准集合，不因日常 validator 放寬而自動啟用新增 65 行。

## 範圍及決策

- 初始批准決策與日常 validator 分開：從原批准版本重建固定 selection，須通過既有 source digest、數量、sense-key-set digest，未獲批准者保留匯入待審資料。
- CIS-010 優先：curated 題目只保護本列答案，不再載入其他詞義／同詞義舊 projection；preview 與正式題目使用同一列建構器。舊 immutable snapshots 不重寫。
- CSV 第一筆 record 辨識標記，非首格只能空白，保留物理行號及可逆文字編碼。
- SQL 篩選、總數、排序及 response 問題標籤使用一致有效問題語義，不能分頁後剔除。
  實作採同一 RepeatableRead transaction：只讀取有 stored issues 的匯入列，用既有單一 TypeScript adapter 產生有效 issues，再以 JSON recordset 加入 SQL CTE，於篩選／計數／分頁之前套用；避免 SQL 重寫 Unicode／legacy message 規則。
- 兩個獨立 POST/PATCH 入口 bounded reader，保留 413／422，直接 route 回歸。
- Hosted CI 揭示 retry 的 CSV 衝突映射仍假定 header 只佔一行；改用匯出後實際 parser 行號，同時覆蓋標記與多行欄位，不放寬 stale guard。

## Checklist／測試矩陣

- [x] 固定原初始批准集合，digest guard 保留；空白 PostgreSQL → migrations → seed → 帳號／詞庫檢查，重 seed 冪等。
- [x] CSV 原始／quoted／34 欄補齊／CRLF／LF 回歸，試算表 round-trip。
- [x] 同列新提案取代舊答案，curated builder 與 CIS-010 一致；preview／正式一致測試。
- [x] 舊反義詞 issue SQL／標籤／分頁／總數一致，DB fixture 驗證。
- [x] 兩個 route 超限串流停止及 malformed JSON 回應測試。
- [x] unit、lint、typecheck、build、相關 DB／browser；commit／push 並檢查同一候選 SHA 的 hosted CI。

## 非目標、風險、發佈及 rollback

不改 production、main、角色或分數語義，不重建既有使用者資料。fresh 驗證只用 localhost 隨機臨時資料庫並精確清理。不能刪除 manifest guard 或單改預期數量。暫存測試資料可刪除；正式歷史與 snapshot 不改。必要時 revert 本次程式 commit，惟 fresh seed 舊版會重新阻擋。GitHub branch protection 仍需要 admin，沿用已記錄限制。

## Definition of Done／結果

五項有可執行回歸證據，fresh 初始化成功；本地與 hosted 結果分別記錄；修正 commit 推上 staging。實際指令、限制、CI SHA 於完成時補記。

## 本地驗證紀錄

- `npm test`：377 passed；fixed baseline set/digests、daily validator 新通過但未批准的 65 行、apple 移除舊 accepted answers、CSV record variants、兩個真實 route 的 413/cancel/422。
- `npm run lint -- --max-warnings=0`、`npx tsc --noEmit`、`ENABLE_TEST_ROUTES=1 npm run build`、`git diff --check` 通過。
- `FRESH_SEED_ADMIN_USER=hangwong npm run test:db:fresh-seed` 通過。只用已核對的本機 socket 管理帳戶建立隨機臨時 DB，migrations/seed 仍使用 migration 帳戶；兩次 catalog bootstrap、帳號核對及初始集合檢查通過，臨時 DB 已清理。第二次不要求重建測試學生，保留拒絕認領既有帳號的安全政策。
- Fresh 結果：5,641 source rows、5,576 valid、5,469 ACTIVE、107 DRAFT、65 historical failed；兩個 sense-key-set digests 與原批准 manifest 完全一致，manifest 沒有修改。
- `npm run check:catalog-workspace-pagination`：通過。新增 legacy/structured antonym-only 及 real synonym collision fixture，核對 NONE/BOTH/UNAVAILABLE、總數、頁界與標籤。
- `npm run test:db:stream-v2`、`npm run check:catalog-governance` 通過。
- `npm run test:e2e:study-stream-v2`：7 passed。
- `DATABASE_ENVIRONMENT=development CONFIRM_DATABASE_ENVIRONMENT=development npm run test:e2e:catalog-workspace` 及針對失敗案例重跑：24 案例全部通過。修正過時文案 selectors 與 CSV 首行已是版本標記的舊測試假設，沒有放寬功能斷言。
- `node --import tsx scripts/check-catalog-csv-spreadsheet.mjs`：系統 CSV export → 真實 LibreOffice import/XLSX save → CSV save → 系統 parser 通過；公式樣式文字、撇號、中文保留。未執行手動 Excel 修改；自動化驗證是實際另存格式 round-trip。
- CI 加獨立 fresh-seed gate，browser-outbox 不再依賴 seed。無 production deploy、schema 改動或 main 合併。GitHub admin 分支保護仍是外部權限限制。

## Hosted 首輪及補修

- `06287b7` / run `33947013036`：fresh-seed、Catalog browser、V2、outbox 三引擎、motion、QA、unit、lint、types、build、ledger、migration、dependency audit 全通過。
- Catalog DB 暴露 retry 衝突映射的舊 CSV 行號假設：改為先序列化，再按 parser 的物理行號映射；新增 marker + multiline regression。重複來源選擇 fixture 改用實際 preview rowNumber。
- Student IA 的 9 個失敗全為舊文案 selectors（帳戶選單、載入更多、目前測試尚未完成）；同步測試與實際簡繁文案，未變更產品行為。
- 補修本地：378 unit passed、lint/typecheck/diff-check 通過；`check:catalog-submission`、`check:catalog-teacher-workflow` 通過；`test:e2e:student-ia` 34 passed、2 existing skipped（桌面 project 不執行 mobile-only geometry，手機 project 對應案例通過）。
- 最終程式 SHA `cfce8b5032e3e5c8cd0c073ce3b201f81da18547` 已推送 staging；[GitHub Actions run 33947481675](https://github.com/kukateng-cell/English/actions/runs/33947481675) 完整成功：15 個 Quality matrix suites、production dependency audit、Required quality gate 全部通過。包含同一 SHA 的 Catalog DB／browser、V2 DB／browser、fresh seed、outbox、motion、IA、QA。
- 後續只提交此完成紀錄；未部署 production，未合併 main。限制仍為未做手動 Excel 編輯／儲存（已做真實 LibreOffice round-trip），及 GitHub branch protection 需要外部 admin 權限。
