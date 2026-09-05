# Staging 審核修正

狀態：已完成（程式及本地驗證；GitHub 分支保護待 repository admin）

## 背景與目標

依據使用者提供的 `staging@d136b90` 審核報告，逐項核實及修正 seed 權限、V2 durable outbox、多義詞題目安全、catalog IP／body 邊界、可逆匯出、依賴及 CI。以目前程式與可執行測試確認報告，完成後 commit／push。

## 範圍與依賴

依賴 Retrieval-first current product baseline、learning contract、catalog governance／workbook 及現有部署流程。保持 server scoring、operationId、credential lineage、審核及資料庫 ledger contract。保留既有名冊頁文案修正。沒有 production deploy 或 main 合併。

## 實施及測試矩陣

- [x] Seed 遇到既有不同角色立即拒絕，既有帳號不自動升權；測試角色／密碼／profile不被改動。
- [x] V2 outbox 使用 IndexedDB readwrite transaction 序列化所有 localStorage read-modify-write，覆蓋 enqueue／remove／update／blocked／reset；保留既有格式及待同步資料，無需資料搬遷。三個瀏覽器各雙分頁 10 輪 enqueue/enqueue 與 enqueue/remove 通過。
- [x] 所有題目干擾項排除同 headword 其他有效答案；測試 run 跑步／經營與資料載入完整性。
- [x] IP helper型別與callers修正，測試不同headers。
- [x] CSV escape明確可逆、XLSX文字型別保留原值；測試危險開頭及真實撇號round-trip。
- [x] 升級受影響依賴並執行production audit。
- [x] 已檢查 GitHub branch protection 及權限，確認無管理權限並記錄所需規則；實際啟用待 repository admin。
- [x] CI獨立jobs及always aggregate gate，避免早期測試掩蓋其他結果。
- [x] JSON body streaming cap，測試宣告大小、chunked超限及cancel。
- [x] 驗證既有繁體文案修正、unit／lint／typecheck／build及相關DB／E2E。
- [x] 記錄驗證結果及提交範圍；commit／push 由本次任務收尾執行。

## 風險、發佈與回復

Outbox 遷移不得丟棄未同步答案；未知或損壞資料須明確失敗。題目安全過濾後不足三個干擾項時拒絕出題。CSV不得任意移除使用者撇號。CI保護以候選SHA結果為準。提交後可回退程式修正，但不得刪除新儲存內待同步操作。正式部署及破壞性contract migration不在本次範圍。

## 完成標準及結果

報告每項均有修正或具體證據／外部限制；適用測試通過；GitHub收到完整修正commit。實際驗證與未執行項目見下列紀錄。

## 決策與限制（2026-09-05）

- Outbox 採跨分頁 IndexedDB mutex 而非改寫資料格式；關鍵區域不允許 await。IndexedDB 不可用時拒絕新提交，不冒險覆寫待同步答案。登出仍即時清除並排隊再次清除，server credential 撤銷規則不變。
- 同詞／lemma 的 current approved answers 全部載入，不限已解鎖詞；不足三個安全干擾項時不出題。保留既有 immutable snapshots 及 scoring version，不改歷史答案或分數。
- XLSX 使用真正字串 cell（實際 formula object 仍拒絕）；34 欄 CSV 加 `#emm-catalog-csv-escaped-v1` 首行，危險開頭及真實撇號使用可逆 `'emm-v1:` URI 編碼。舊無標記 CSV 不猜測／移除撇號。請保留標記；一般老師優先使用 XLSX。CSV 錯誤行號包含標記行。
- Seed 先檢查全部保留帳號角色；同角色既有帳號完全不更新密碼、profile、status 或 capability，`teacher-reset` 亦不再按名字認領。缺少帳號才建立。
- GitHub API 回報目前帳戶 `admin=false, maintain=false, push=true`；無法落實分支保護。Repository admin 應為 main、staging 設定：禁止 force push／刪除、要求 PR 與至少一名獨立 reviewer、要求最新 `Required quality gate` 成功；保留既有其他規則。本次未改 remote settings。
- CI 分拆獨立 matrix jobs（fail-fast=false），包括獨立 build 與各組 browser suites；always aggregate gate 對 failure／cancelled／skipped 均不通過；push 無 path filter，PR 包括 main／staging。
- 回歸發現舊測試仍使用「賬號／登錄」、簡體 server fixture、舊 loading 文案，及翻卡未完成就量度透視座標。已對齊現行文案與動畫完成狀態，保留原驗收強度。
- 沒有 schema／migration 改動、production deploy、main 合併或資料重建。完整 migration／V1 motion／catalog UI suites 由獨立 CI 保留，本地本次未全部重跑。

## 實際驗證

- `npm test`：374 passed，包含 reserved role guard、UTF-8 streaming body limit/cancel、XLSX/CSV literal round-trip、lemma sibling fail-closed、outbox 並發及既有回歸。
- `npm run lint -- --max-warnings=0`、`npx tsc --noEmit`、`git diff --check` 通過。
- `npm run build` 通過（sandbox 首次 EPERM，按規則 escalated 重試成功）。
- `npm run test:db:stream-v2` 通過（本地 PostgreSQL；sandbox EPERM 後 escalated 重試）。
- `npm run test:e2e:study-stream-v2`：7 passed。
- `npm run test:browser:outbox`：Chromium／Firefox／WebKit，各 10 輪同源双分頁 enqueue/enqueue 及 enqueue/remove 通過。
- `npm run audit:production`：0 vulnerabilities。一般 dev dependency audit 仍有既有工具鏈 advisories，本次未作破壞性工具升級。
- CI YAML 已解析，14 組互不 fail-fast 的 suites，加 production audit 及 always aggregate gate。GitHub-hosted 執行結果不以本地通過代替。
- 未執行：全部 V1 motion、catalog UI、migration replay、production deploy、真實裝置測試。沒有修改 migration/schema；相關現有 CI checks 保留並拆開執行。
