# 繁體中文原始文案基準修正計劃

> 狀態：已完成（本地 implementation／verification；2026-09-02；external gates deferred）
> 建立日期：2026-09-02
> 依賴：[老師詞庫工作區可讀性重整](./word-catalog-teacher-workspace-usability-redesign.md)、[詞庫治理及生命週期](./word-catalog-governance-and-lifecycle.md)

## 一、背景及問題定義

產品預設語言及正式詞庫 canonical 中文均為繁體中文（香港用語），但現行 `tc()` 顯示層仍把
來源字串視作簡繁混合內容：`zh-Hant` 會執行 OpenCC 簡轉繁，`zh-Hans` 才執行繁轉簡。
這個設計令繁體畫面不是直接顯示經審定的繁體原文，而是受自動轉換器的字詞判斷影響。

2026-09-02 的老師題目預覽再次證明這個風險：component 原始文案已正確寫成「干擾項」，
但 `cn → tw` 轉換把句中的「干擾項」改成錯誤的「乾擾項」。既有後置規則只修正
「幹擾項」，所以短句測試通過，包含「安全干擾項」的真實句子仍顯示錯誤。

本輪把產品可見中文改為「繁體原文為唯一基準、簡體為衍生顯示」。正式 CSV 詞庫已按
`word-catalog-v1` 使用繁體香港中文，本輪不需要改寫詞庫資料或資料庫。

## 二、目標及成功準則

1. 所有產品 runtime 的中文 UI、API 錯誤、metadata 及 fallback 原始字串以正確繁體中文編寫。
2. `zh-Hant` 直接保留繁體原文，只套用非常窄的 canonical 術語修正；不再執行簡轉繁。
3. `zh-Hans` 由同一份繁體原文經繁轉簡產生，不在 production code 維護第二套簡體文案。
4. 「干擾項」在短句、完整題目預覽、API 錯誤及兩種 locale 中均固定顯示為繁體
   「干擾項」／簡體「干扰项」，不得出現「乾擾項」、「幹擾項」或混合字形。
5. 自動測試可阻止新的 production 簡體原始文案及雙套 locale 文案重新進入。

## 三、非目標

- 不改 Learning Card、Objective Probe、SM-2、排程、統計或審核語義。
- 不改 Prisma schema、migration、approved catalog revision 或正式 baseline digest。
- 不以 OpenCC 批量改寫 `word list.md`；該檔已不是目前 canonical 詞庫來源。
- 不重寫歷史計劃全文；只修正會誤導目前實作的 i18n contract，並保留歷史決策脈絡。
- 不執行 production deploy、production migration、seed 或 destructive cleanup。

## 四、開始時現況、依賴及範圍

- `src/lib/i18n/convert.ts` 開始時使用 `cn → tw` 產生繁體、`hk → cn` 產生簡體。
- `src/components/LocaleProvider.tsx` 的 `tc()` 是 client component 共用出口；server component
  使用 `convertForServer()`。
- API route 及 server helper 亦會回傳中文 fallback；即使 client 最後再呼叫 `tc()`，原始
  訊息仍須是繁體，避免未經轉換的 HTML／JSON 邊界漏出簡體。
- `buildAuthServiceUnavailableResponse()` 開始時手寫繁體／簡體兩份 HTML 文案；現已改為繁體
  原文配合共用轉換函數。
- 正式 `outputs/*-word-catalog-reference-v1/*.csv` 已是繁體香港中文 canonical；簡體只應在
  顯示層衍生。

## 五、實施階段

### Phase 0：盤點及 contract 固定

- [x] 重現完整題目預覽把「干擾項」錯轉成「乾擾項」。
- [x] 盤點 production TypeScript／TSX 中文字串及現行轉換方向。
- [x] 確認正式詞庫 canonical 資料已使用繁體中文，毋須資料 migration。
- [x] 把現行 i18n contract、範圍及例外寫入測試與程式註解。

### Phase 1：繁體原文單向衍生

- [x] `zh-Hant` 改為 identity-first，不再初始化或執行簡轉繁 converter。
- [x] `zh-Hans` 只由繁體原文執行繁轉簡。
- [x] 建立窄範圍「干擾項」canonical 修正，兼容舊 API／快取可能出現的乾／幹／混合字形。
- [x] 移除 production code 手寫的繁簡雙份文案，改由繁體原文單向衍生。

### Phase 2：production 可見文案遷移

- [x] 將 app、component、server helper、API fallback、metadata 及 test fixture 的中文原始字串
  改為繁體；不改 identifier、資料 contract 或純英文 technical value。
- [x] 人工覆核高風險字詞，包括登入／帳戶／資料／載入／發佈／干擾項及學生流程提示。
- [x] 更新受 raw server message 影響的 unit／browser assertions。
- [x] 更新舊計劃中會誤導目前實作的「canonical 簡體」說法，標明已由本計劃取代。

### Phase 3：防回歸及驗收

- [x] unit test 覆蓋繁體 identity、簡體衍生、server cookie、完整題目預覽及全部干擾項異體。
- [x] source audit 覆蓋 production 可見字串，阻止可被識別的簡體原始文案及手寫 locale 分支。
- [x] 執行 unit、lint、typecheck、build、locale browser regression 及 catalog 題目預覽回歸。
- [x] 記錄實際驗證、未執行項目及已知限制，完成後把狀態改為「已完成」。

## 六、風險及控制

| 風險 | 控制 |
|---|---|
| 直接取消簡轉繁後，舊簡體 literal 在繁體畫面漏出 | 同一改動遷移 production 可見字串；加入 source audit 及 locale browser test |
| OpenCC 對一字多義作錯誤詞彙轉換 | 繁體 path 不經 OpenCC；簡體只作衍生，對產品 canonical 術語加窄範圍修正 |
| API raw error 未經 `tc()` 就被顯示 | API／server fallback 本身使用繁體原文；client 繼續按 locale 轉換 |
| 一次改動範圍大而誤改 technical value | 只改含中文的 string／template／JSX text；保留 enum、route、key、英文識別碼 |
| source audit 把合法繁體異體誤判為簡體 | audit 使用小範圍明確例外並以真實文案測試補充，不以單一字表自動改寫內容 |
| 動態詞庫資料不是繁體 | 正式 catalog validator／authoring standard 繼續以繁體香港中文為 canonical；本輪不把 runtime converter 當資料清洗器 |

## 七、測試矩陣

| 範圍 | 驗證 |
|---|---|
| i18n unit | `zh-Hant` 保留原文；`zh-Hans` 正確衍生；cookie fallback；「干擾項」全部舊異體收斂 |
| static source | production 可見中文原始字串沒有可識別簡體；不再手寫繁簡 ternary 文案 |
| catalog | 完整「使用正式學生出題器…安全干擾項」繁體顯示正確；簡體顯示「干扰项」 |
| student／auth | 登入、密碼、學習、統計、錯誤及 loading 文案兩種 locale 無回歸 |
| build quality | `npm test`、lint、`npx tsc --noEmit`、`npm run build` |

## 八、發布及 rollback

- 本輪只建立本地 source baseline，不授權 production deploy。
- 改動不涉及資料或 migration；rollback 可回退 i18n helper、source literal migration 及測試。
- 若 browser regression 發現遺漏的簡體 source，先補正原始繁體文案，不恢復 `zh-Hant` 簡轉繁。
- production 發布及觀察仍須另行授權並遵循 `DEPLOY.md`。

## 九、Definition of Done

- [x] 繁體 locale 不再透過簡轉繁產生。
- [x] production 可見中文以繁體原文為基準，簡體只由繁體衍生。
- [x] 題目預覽及所有 catalog 錯誤不再出現「乾擾項」或「幹擾項」。
- [x] 沒有 production 手寫繁簡雙份文案。
- [x] 相應 unit、lint、typecheck、build 及 browser regression 通過。
- [x] 無 schema／migration／seed／production 改動，未執行外部 gate 已明確記錄。

## 十、決策紀錄

| ID | 決策 | 理由 |
|---|---|---|
| TC-001 | 產品可見中文以繁體香港中文原文為 canonical | 符合項目語境及詞庫 authoring contract，亦避免繁體畫面受簡轉繁詞義判斷影響 |
| TC-002 | 簡體只由繁體原文衍生 | 維持單一文案來源，同時保留 zh-Hans 能力 |
| TC-003 | `zh-Hant` 只做 identity＋窄範圍術語收斂 | 保護經人工審定的繁體措辭，不把 runtime converter 當 copy editor |
| TC-004 | 本輪不改正式詞庫資料 | 現行 catalog CSV 已是繁體 canonical，問題來自 UI 轉換方向而非 approved data |

## 十一、實際驗證紀錄

### 2026-09-02：本地完成

- `npm test`：354 passed；包括繁體 identity、簡體衍生、server cookie、完整題目預覽句子、
  全部「干擾項」舊字形收斂，以及 production source audit。
- `npm run lint -- --max-warnings=0`：passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：compiled／TypeScript passed，83／83 pages generated。沙箱內 Turbopack 因本機
  連接埠權限失敗後，按項目規則以 escalated local 權限重試並通過。
- Playwright CLI 以 production build 覆核 `/test/ui` 及 `/login`：繁體顯示「元件」、「範例」、
  「已停用」、「載入」、「帳號」、「登入」及「聯絡」；切換 `zh-Hans` 後正確衍生「账号」、
  「登录」及「联系」。browser console 0 errors／0 warnings。
- 完整題目預覽句子由 unit regression 驗證：繁體為「使用正式學生出題器即時抽選三個安全干擾項；
  預覽不會建立學習紀錄或影響統計。」，簡體對應顯示「安全干扰项」。
- 為兼容既有輸入，名冊欄名、保留名稱及「未分类」等簡體 aliases 只保留於明確 input boundary；
  不作產品顯示原文，source audit 逐檔列明例外。
- 未執行 database test、migration、seed、production deploy、staging／production observation 或
  真實學生 pilot；本輪沒有 schema、資料、學習語義或 production 設定改動，以上 external gates
  不屬本地完成範圍，仍須另行授權。
