# V2 學習一致性、排程及恢復審核修正

狀態：已完成（本地 unit／DB／browser／migration 驗證；此次 push 後 hosted CI 及 production gates 待執行）

## 背景及目標

本輪審核將學習歷史、短期 session、原始操作身份、目前畫面狀態及統計資格放在同一條呼叫鏈覆核，確認 6 項 P2 及 1 項 P3，並把網絡逾時及串流 body 上限一併收斂。目標是在不改變 `retrieval-v1` gesture、server scoring、one-time credential、operationId 或 production／main scope 的前提下，令排程、離線恢復、前端狀態、統計及輸入邊界採用一致而可驗證的契約。

## 範圍、非目標及依賴

### 範圍

- A：SCH-01／SCH-02——以 learner-scoped 已確認歷史及 StudyEncounter 分開「接觸過」與「已有客觀證據」，跨 session 維持同詞間隔、連續 Objective Probe 上限及候選公平性。
- B：SYN-01／SYN-02——恢復原 action 的帳戶／session／item 身份；credential 只作可更新的傳輸授權，不能改寫 immutable operation fingerprint。
- C：UI-01 及網絡退出——所有 bootstrap、刷新、storage、online、手動重試及生命週期重播共用錯誤／過時／排送狀態；GET、CSRF、action 請求有 bounded timeout／取消及安全回執核對。
- D：MET-01——學生、教師、匯出及單元摘要共用按 probe purpose 分支的 provenance eligibility，正常 `DUE_REVIEW` 不要求 obligation。
- E：API-01 及 request cap——JSON `null`／非 object fail closed；analytics export 及其他相關入口在讀取途中 enforce byte limit。

### 非目標

- 不恢復舊版 tap-to-reveal、固定題數、self-rating 直接 mastery 或 Objective Probe 原地重答。
- 不以新的 `operationId` 取代結果未明的原操作、不放寬所有 403、不刪除歷史資料或清空 outbox。
- 不修改已套用 migration、執行 contract migration、production deploy、main merge、GitHub ruleset 或 research／pilot gate；只有確認必需的 schema 變更才另開 expand migration。

### 依賴

- `plans/artifacts/retrieval-first-v2-current-product-baseline.md`、`plans/retrieval-first-learning-contract.md` 及 `plans/study-stream-retention-and-recovery-audit.md`。
- `src/lib/study-stream/server.ts`、scheduler／learning policy、metrics helpers、`StudyStreamV2.tsx`、相關 route handlers 及現有 Prisma／DB／browser regression。

## 分階段 checklist／驗收

### A：學習排程

- [x] 建立跨 session 的 learner history projection／查詢，所有候選（新詞、補救、到期複習、obligation）共用 `minInterveningItems` 及最近詞判定。
- [x] `recentStreamShape()` 正確計算連續 Objective Probe，保持 `maxConsecutiveProbes` soft cap 及合法降級／等待出口。
- [x] 候選以接觸狀態與客觀 evidence 分開排序；已接觸但未評分的詞不會因無 Review 永久留在固定前 13 個。
- [x] 以真正 PostgreSQL／scheduler 長序列測試覆蓋 session 到期、重開、小單元候選不足、延遲驗證、補救優先及候選公平性。

### B：原操作恢復

- [x] 提供以 action 原始帳戶、session、stream item、action kind、payload、revision 及 operationId 定位的 bounded recovery，不依賴目前 URL／畫面剛好返回同一題。
- [x] credential rebind 只更新傳輸憑證及 lineage，不改 immutable fingerprint；並發成功、結果未明、撤銷／跨帳戶及不同 scope 均 fail closed 或安全 terminal。
- [x] 真正 DB／獨立 browser context 測試覆蓋 7→8 輪輪換、來源 session 過期、單元切換、兩個排送者交錯及只計分一次。

### C：前端狀態及網絡退出

- [x] 首次／後續 GET 失敗與「沒有可安排項目」分開呈現；refresh／storage／online／手動重試一致設定過時、syncBlocked、refreshPending 及可操作性。
- [x] React effect 可安全 setup／cleanup／setup；不以一次性 guard 令第二次生命週期遺漏同步，且 queued pending 會在安全時機繼續排送。
- [x] GET、CSRF、action 請求採用有上限 timeout／AbortController；timeout 後保留原 operation，透過 authoritative reconciliation／retry 分辨已提交與結果未明。
- [x] Playwright 覆蓋首次 GET／CSRF／POST 黑洞、回應遺失、storage／checkpoint 刷新失敗、生命週期 generation replay 及恢復後多筆 outbox。

### D：統計資格

- [x] `DUE_REVIEW`、`EVIDENCE_OBLIGATION`、diagnostic／legacy purpose 的來源條件分支清晰；正常到期複習不依賴 obligation 關聯。
- [x] 學生端、教師端、匯出及單元摘要用同一組 provenance fixtures；保留 legacy／非勝出／不完整來源排除規則。
- [x] 加入學生／教師實際資料庫 regression，核對正確、錯誤、補驗及到期複習的分子／分母一致性。

### E：輸入及 body 邊界

- [x] 教師重設密碼 route 將解析結果當 `unknown`，對 `null`、array、primitive、malformed JSON 回傳受控 4xx，不能解引用例外。
- [x] analytics export 及同類入口改用共用 bounded reader；超限途中停止讀取並維持既有 413／422 語義，補無 Content-Length 的串流測試。
- [x] 單元／route 測試覆蓋 parser、byte boundary、reader cancellation 及權限／錯誤回應不洩漏資料。

## 風險及緩解

- 歷史查詢可能增加 scheduler 成本：以 learner-scoped bounded window／索引查詢，並以長序列效能測試確認不退化。
- timeout 不能代表 server 未提交：保留原 operationId／fingerprint，先做 reconciliation，再決定移除或重試。
- 統計口徑改動會令舊數字變化：保留 provenance、明確 denominator 文案，先以 fixture 對照再更新 projection。
- body cap／取消可能截斷合法串流：以 exact UTF-8 boundary、chunked overflow 及既有 route contract regression 保護。

## 發佈、rollback 及 Definition of Done

- 先完成本地 unit／DB／browser 驗收及兩位 reviewer PASS，再 commit／push `staging`；不推送 `main` 或 production。
- 任何 schema 變更必須先更新 migration 計劃並新增 expand migration；本輪優先採用現有模型及 helper，無必要不改 schema。
- 如 scheduler／recovery 修正出現回歸，沿用既有 V1 `off` rollback 及 V2 assignment gate；不得刪除歷史事件或 outbox。
- 完成時記錄實際測試、未執行的 native／production gate、CI run 及已知限制，將狀態改為「已完成」；所有 checklist 必須以可執行證據勾選。

## 實際驗證及限制

本輪完成並由兩位獨立 reviewer 明確 PASS：

- `npm test`：394 tests passed。
- `npx tsc --noEmit`、`npm run lint`、`git diff --check`：通過。
- `npm run build`：Next.js production build 通過。
- `npm run test:e2e:study-stream-v2`：22/22 Chromium tests passed，包含 GET／CSRF／action timeout、refresh／storage、生命週期 generation、terminal reconciliation 及獨立 browser contexts。
- `npm run test:db:stream-v2`：真正 PostgreSQL integration checks passed，包含 scheduler 長序列、cross-session history、7→8 credential boundary、expired K1 terminal reconciliation、pending K1 rebind 及 provenance／metrics checks。
- `npm run test:migration-checksums`：通過；`npm run test:migrations`：67 migrations fresh replay 及 interrupted replay 通過。

已知未執行或不在本次授權範圍：此次 push 後 GitHub hosted CI 尚待重新跑；production deploy／config gate、contract migration、完整原生 mobile／VoiceOver／TalkBack matrix、長時間容量／壓力測試及正式資料清理均未執行。新增欄位只使用正常 expand migration，沒有執行 contract migration。

## 決策紀錄

| ID | 決策 | 狀態 |
|---|---|---|
| SCA-001 | 已確認接觸與 objective evidence 分離；self-rating 不建立 Review | 已採用 |
| SCA-002 | 恢復沿用原 operationId／immutable fingerprint；credential rebind 不改內容指紋 | 已採用 |
| SCA-003 | timeout 後先保留操作並 reconciliation，不把 timeout 當成功或失敗 | 已採用 |
| SCA-004 | 學生／教師統計按 probe purpose 共用 provenance eligibility | 已採用 |
| SCA-005 | 所有受保護 JSON／串流入口 fail closed 並在讀取途中 enforce byte cap | 已採用 |
