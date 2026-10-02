# 詞庫問題提示及選取操作排版修正計劃

> 狀態：進行中（第五輪匯出格式修訂完成；待完整 viewport matrix）
>
> 建立日期：2026-09-03
>
> 依賴計劃：[老師詞庫工作區可讀性重整](./word-catalog-teacher-workspace-usability-redesign.md)、[CSV 批量提交及歷史](./word-catalog-bulk-submission-and-history.md)

## 一、背景及問題定義

老師詞庫列表已將生命週期、工作流程、出題狀態及內容問題分開，但實際使用發現十二個可用性缺口：

1. 列表可顯示「N 項內容需修正」，「查看／修改」視窗卻沒有重複呈現問題、影響欄位或實際衝突值，老師要自行逐欄猜測；
2. CSV UPDATE 選取欄對 import-only 草稿直接留白，未解釋該列為何沒有 checkbox、何時才可選；
3. 選取第一個詞條後才條件式加入「清除全部選取」，令頂部 flex toolbar 重新換行，既有主要按鈕及詞庫總數位置突然跳動。
4. 新增提示及既有詞庫介面混入「呢項」、「只係」、「冇」等口語，並不適合作為教師及學生使用的正式介面文案。
5. 現行 answer-safety 規則錯誤地將英文反義詞視為可能正確答案，令 `accept` 的反義詞 `reject` 不能同時作為中譯英干擾項；但反義詞語義明確相反，本來就是合理的錯誤選項。
6. 「草稿」同時用於已有正式詞義版本及只有原始匯入紀錄的項目，後者再標為「待完成審核」，令教師誤以為已經送審，亦無法理解兩者為何只有其中一種可勾選作 CSV 更新。
7. sibling-sense 衝突需要同一英文詞另一個詞義的資料，但詳情 API 未回傳該項證據；介面只能圈住整組干擾項，而且定位時錯誤聚焦第一格，未能指出真正需要處理的字詞。
8. 不可選原因以點擊式提示顯示，但點擊提示外部不會關閉，造成提示長期遮擋內容。
9. 經教師確認，系統不應以同一英文詞的其他詞義阻止目前詞義提交；跨詞義語義判斷增加編輯負擔，實際內容問題應由教師／學生使用後透過既有回報及治理流程修正。
10. 桌面版「更多篩選」使用原生 `details`，開啟後點擊選單外不會關閉，與同頁其他 popover 的互動不一致。
11. 「CSV 更新」容易被理解成按下後直接更新詞庫；實際流程是先下載現有詞條的 CSV 修改表，在試算表修改後再上傳送審，介面未有清楚交代。
12. 「所選詞條修改表」仍是多餘的產品術語，而且 CSV 並非一般老師最熟悉的試算表格式；下載、範本及上載流程目前亦只支援 CSV。

## 二、目標及成功準則

- 詳情視窗在表單前顯示所有 blocking 問題的欄位、方向、教師可讀原因、修正方法及可由目前 payload 安全推導的實際值。
- 每項真正衝突提供「前往欄位」，同時標出來源欄位、來源詞項、干擾項第幾格及具體重疊字詞；修正表單期間不顯示 raw validator code 或英文 exception。
- CSV 選取欄明示用途，所有不可選狀態均提供可見原因；import-only 草稿清楚說明目前「待完成審核」，以及完成修正及審核後才可選取。
- 頂部標題、總數及原有三個主要操作在 0→1→0 選取轉換時位置保持穩定；新增／移除清除動作不觸發整組重新排版。
- 320、768、1024、1440 px 無水平溢出，keyboard／screen reader 仍可理解問題提示及不可選原因。
- 詞庫教師介面及本輪涉及的共用提示一律使用書面語，不保留粵語口語助詞或句式。
- 英譯中干擾項只禁止與本列主要中文釋義及其他可接受中文譯法重疊；中譯英干擾項只禁止與本列主要英文答案、其他可接受英文形式及英文近義詞重疊。兩個方向均不再跨詞義檢查；英文反義詞可作為干擾項。
- 列表直接區分「已有詞義版本的草稿」與「尚未提交建立詞義的匯入項目」；不可選時仍顯示 disabled checkbox，旁邊以簡短狀態及完整下一步解釋原因。
- 所有仍然有效且可由本列資料精確判定的碰撞，由 server 回傳兩邊具體值及位置；介面只聚焦真正衝突的個別輸入格，不再猜測第一項。
- 點擊不可選提示外部、按 Escape 或將焦點移出提示均可關閉提示。
- 桌面版「更多篩選」在點擊選單外、按 Escape 或將焦點移出後關閉；Escape 關閉後焦點返回觸發按鈕。
- 下載操作直接命名為「匯出所選詞條」，預設使用 Excel（XLSX），並可切換 CSV；上載及新增範本同步支援兩種格式，不再要求老師理解「修改表」術語。

## 三、非目標

- 不改干擾項數量、同列重複項、主要答案、可接受答案、近義詞、審批人數或生命週期規則；本輪只移除反義詞及跨詞義碰撞限制。
- 不令 import-only 草稿繞過 governed revision／CAS 加入 CSV UPDATE 匯出。
- 不改 Prisma schema、migration、正式 baseline、題目計分、學習進度或 production 設定；只同步修正題目選項建構的反義詞排除規則。
- 不執行 production deploy、seed、rebuild 或 destructive cleanup。

## 四、依賴及現況

- 列表已有 versioned `structuredIssues`，但 detail route 只回 raw import `issues`；detail client 沒有渲染兩者。
- `CatalogIssuePresentation` 已提供 field／direction／reason／fix，應繼續作唯一老師文案來源。
- `catalogExportAvailability` 已分辨 `EXPORTABLE`、`REQUIRES_GOVERNED_REVISION`、`REVISION_UNAVAILABLE` 及 `MISSING_SENSE_KEY`。
- pending request 目前以 disabled checkbox 表示，但亦需要文字原因。
- 頂部 layout 目前將標題、操作組及總數放在同一個 wrapping flex container。

## 五、實施階段

### Phase 1：問題資料及老師提示

- [x] detail route 以既有 bounded legacy adapter 回傳受支援版本嘅 structured issues，不向 client 暴露 raw validator 文案。
- [x] 建立純 presentation helper，由 issue＋目前表單內容推導重複／碰撞值及數量等具體提示。
- [x] 詳情視窗加入問題摘要、欄位定位及問題欄位視覺標示。
- [x] 補 unit tests：可接受形式／近義詞與中譯英干擾項重疊時要指出實際重疊值；未知 issue 安全 fallback。

### Phase 2：選取解釋及穩定 toolbar

- [x] 選取欄標示只供 CSV 更新，並為每種不可匯出狀態提供可見、可存取嘅中文原因。
- [x] import-only 草稿顯示「待完成審核」及完整原因；pending request 顯示「正在審核」而非只有無說明 disabled control。
- [x] 將標題／總數同操作列分成穩定區域；0→1→0 選取只改 count 及清除控制可見性，不移動既有按鈕。
- [x] mobile／tablet 保留同一原因文案及既有操作順序。

### Phase 3：驗證及收尾

- [x] 執行相鄰 unit tests、lint、typecheck 及 `git diff --check`。
- [x] 執行 production build（沙箱外完成；沙箱內預期因 Turbopack port／process 限制而失敗）。
- [ ] 以 Playwright 驗證問題詳情、欄位定位、不可選原因、0→1→0 toolbar geometry及代表 viewport 無 overflow。
- [x] 記錄實際測試、未執行項目及已知限制；通過餘下驗證後先改為「已完成（本地驗證）」並同步計劃索引。

### Phase 4：教師回饋修訂

- [x] 將不可選提示改為教師可直接理解的狀態，例如「待完成審核」，並以書面語說明該列目前是匯入草稿，尚不可用 CSV 批量更新。
- [x] 移除本輪及詞庫教師介面中的粵語口語文案，加入書面語 regression audit。
- [x] 將英文反義詞從中譯英 answer-safety 禁止集合移除，當時保留主要答案、可接受形式、近義詞及 sibling-sense 保護；同步題目選項建構規則。（sibling-sense 保護其後由 Phase 6／`CIS-010` 取代。）
- [x] 對仍然有效的碰撞問題，推導來源類型及兩邊索引；在來源詞項及具體干擾項輸入框逐項標示。
- [x] 補 unit tests：`accept / reject` 反義詞可通過；近義詞／可接受形式仍被阻擋；具體碰撞位置及正式書面語文案正確。
- [x] 重跑 unit、lint、typecheck 及 diff check。
- [ ] 在審批服務可用時完成 build／browser 驗證。

### Phase 5：第二輪教師實測修訂

- [x] 將 import-only 狀態由「待完成審核」改為「尚未提交建立詞義」，並直接列明「查看／修改 → 提交新詞義 → 審核」下一步；避免使用「先建立版本」等內部術語。
- [x] 所有不可選列保留可見的 disabled checkbox，讓教師清楚這是不可使用而非遺漏的控制；以書面語解釋 CSV 更新只適用於已有正式詞義版本的項目。
- [x] 詳情 API 當時為 canonical、accepted、duplicate 及 sibling-sense 衝突提供 server-derived evidence contract，包含衝突值、可修改端的欄位及索引，以及只供說明的另一詞義來源。（跨詞義 evidence 其後按 `CIS-010` 移除。）
- [x] 詳情介面按 server evidence 精確標示具體輸入格；沒有精確索引時只顯示說明，不得自動聚焦第一格。
- [x] 修正不可選原因 popover 的 click-outside、Escape 及 focus-out 關閉行為。
- [x] 加入 `accept`、`device` 類型、disabled checkbox、精確定位及 popover dismiss regression tests；重跑 unit、lint、typecheck、build 及針對性 browser 驗證。

### Phase 6：按教師決定收窄跨詞義規則

- [x] 移除 bootstrap／governance validator 的 sibling-sense collision 檢查，保留同列 canonical、accepted、duplicate 及數量規則。
- [x] 讀取舊匯入資料時將既有 `CATALOG_DISTRACTOR_SIBLING_COLLISION` 視為已廢止問題，不再顯示或阻止提交。
- [x] 同步 Objective Probe 選項建構：不再因其他詞義答案而排除教師已設定的干擾項；保留本詞義答案、可接受形式及近義詞保護。
- [x] 更新單元及瀏覽器回歸：`go（A1：去）` 可使用另一詞義的「走」作干擾項，舊 sibling issue 不再出現；同列主要答案／可接受譯法重疊仍然被阻止。
- [x] 重跑 unit、lint、typecheck、build、diff check 及針對性 browser regression，記錄完整結果。

### Phase 7：更多篩選及 CSV 修改表說明

- [x] 為桌面版「更多篩選」加入 click-outside、focus-out 及 Escape 關閉行為，保留原生鍵盤操作及焦點返回。
- [x] 將列表選取欄、下載按鈕、不可選原因及完成訊息統一改為「CSV 修改表／批量修改」語義。
- [x] 在列表加入簡明流程說明，明示下載不會立即修改詞庫，修改後須到「CSV 批量提交」上載並送審。
- [x] 更新相關 unit／browser regression，執行 lint、typecheck、build、diff check 及針對性真實瀏覽器驗證。

### Phase 8：以 XLSX 為預設匯出格式

- [x] 將完整詞庫及批量提交頁的下載操作改為「匯出所選詞條」，以 XLSX 為預設格式並保留 CSV 選項。
- [x] 新增安全的 XLSX 產生及解析，沿用 34 欄資料 contract、200 行／4 MiB 上限、公式及壓縮檔安全檢查；上載端同時接受 XLSX 及 UTF-8 CSV。
- [x] CREATE 範本預設下載 XLSX並可切換 CSV；相關頁籤及說明改用「批量提交」，只在檔案格式選項提及 CSV。
- [x] 補充 XLSX round-trip、格式拒絕、既有 CSV compatibility、UI 預設值及 browser regression；執行 unit、lint、typecheck、build及真實瀏覽器驗證。

## 六、風險及控制

| 風險 | 控制 |
|---|---|
| detail 同 list 使用不同 issue 語義 | detail 重用同一 structured issue adapter及 presentation helper |
| 由 payload 推導錯誤值時誤導老師 | 只對可確定的 count、duplicate、canonical／accepted collision 顯示實際值；其餘保持欄位級提示 |
| 老師修改後提示仍引用舊資料 | 實際值由目前 form state即時計算；保留「提交時重新檢查」說明 |
| 不可選提示令 table 過闊 | 採短可見狀態＋完整 accessible／title說明，並做四個 viewport overflow驗證 |
| toolbar 穩定但窄屏失去合理 reflow | 只固定區域 ownership，不使用絕對像素定位；容許窄屏按鈕自然換行 |
| 精確位置在教師修改內容後過時 | evidence 由目前表單資料推導；client 以目前表單重新核對索引，值已不再匹配時停止標紅並於提交時重新驗證 |
| 放寬跨詞義檢查後可能出現語義含糊的選項 | 接受教師決定，以本列明確答案安全為自動檢查邊界；實際使用發現的語義問題沿用「報告問題」及審核流程修正 |
| click-outside 與原生 select 展開互相干擾 | 只在事件目標位於整個篩選容器外時關閉，容器內的 select 操作不受影響 |
| CSV 文案改動令既有使用者找不到功能 | 保留「CSV」格式名稱及「CSV 批量提交」入口名稱，以流程句連結下載與上傳兩個步驟 |
| XLSX 轉換改變既有 34 欄資料語義 | XLSX 與 CSV 共用同一欄名、次序及 row validator；加入雙格式 round-trip 測試 |
| 惡意或異常 XLSX 消耗過多資源 | 載入前驗證 ZIP 結構、大小及壓縮比例，拒絕公式、巨集、外部連結及多個可見工作表 |

## 七、測試矩陣

- Unit：issue detail value、field label、unknown fallback、四種 export availability reason、反義詞及其他詞義答案可作干擾項、舊跨詞義問題過濾，以及 source-copy 書面語 audit。
- Component／browser：import-only row 顯示正確的下一步及 disabled checkbox 原因；仍然有效的同列問題顯示具體衝突值，「前往欄位」只聚焦真正衝突的個別輸入格。
- Desktop interaction：開啟「更多篩選」後，選單內操作不會誤關閉；點擊外部、焦點移出或按 Escape 均會關閉，Escape 後焦點返回按鈕。
- Copy：按鈕使用「匯出所選詞條」；XLSX／CSV 只作格式選項，說明清楚交代匯出、修改、上載及送審流程。
- File format：XLSX 為預設；XLSX 及 CSV 均可完成匯出、修改、上載及預覽 round-trip。
- Layout：1440 px 記錄三個既有按鈕及總數 0／1／0 selection bounding boxes不變；320／768／1024／1440無頁面水平 overflow。
- Regression：可匯出 row仍可勾選；200上限、CSV export、pending disabled、列表問題 disclosure及詳情提交流程保持不變。

## 八、發布、rollback 及 Definition of Done

- 本輪只交付本地 source；不授權 production deploy。
- 如 detail guidance 有問題，可獨立回退 additive detail field及提示元件；validator、資料及正式 revision 不受影響。
- 如 toolbar 有回歸，可回退 presentation layout；selection state及 export API 不受影響。
- 完成條件：三個使用者指出嘅問題均有 browser evidence，相關 unit／lint／typecheck／build通過，未執行 external gates清楚記錄。

## 九、決策紀錄

- `CIS-001`：無 checkbox 不等於 selectable control 損壞；以可見原因解釋，不放寬 UPDATE export contract。
- `CIS-002`：問題詳情置於表單頂部並可直接前往欄位，避免只靠列表 disclosure。
- `CIS-003`：頂部固定為「標題＋總數」及「操作列」兩個區域，避免條件式控制改變其他區域 ownership。
- `CIS-004`：按教師回饋，反義詞不屬於可能正確答案；允許反義詞作為中譯英干擾項。近義詞及可接受形式仍受答案安全規則保護。
- `CIS-005`：產品介面使用正式書面語；開發計劃可保留團隊原有語體，但不得將口語文案帶入教師或學生 UI。
- `CIS-006`：「整欄有問題」只作群組提示；可由 payload 確定位置時，必須同時標出衝突來源及具體輸入格。
- `CIS-007`：「草稿」只描述生命週期，不能用來暗示 CSV 更新資格；import-only 項目另以「尚未提交建立詞義」表達工作階段。
- `CIS-008`：sibling-sense evidence 必須由 server 根據同一驗證上下文產生；client 不可猜測另一詞義或預設第一個輸入格有錯。
- `CIS-009`：不可選原因使用可關閉的 accessible popover；disabled checkbox 本身保持可見，旁邊的說明按鈕負責開啟原因。
- `CIS-010`：按教師明確決定，取消所有 sibling-sense distractor collision 阻擋。`CIS-008` 的跨詞義 evidence 實作保留為歷史，但不再由目前 validator 或舊資料轉接器產生／顯示；系統只保護本列可接受答案集合。
- `CIS-011`：桌面版「更多篩選」維持輕量 popover，但補齊與其他選單一致的 click-outside、focus-out 及 Escape dismiss 行為。
- `CIS-012`：將「CSV 更新」重新命名為「CSV 修改表」；此功能只下載批量修改檔案，真正修改要經「CSV 批量提交」上傳、檢查及審核。
- `CIS-013`：按第五輪教師回饋，不使用「修改表」作功能名稱；操作稱為「匯出所選詞條」，預設 XLSX，CSV 只作相容格式。上載與範本必須同步支援兩種格式，避免單向支援造成死路。

## 十、實際驗證及限制（更新至 2026-09-04）

- `npm test`：通過，365／365；包括 catalog validator、題目選項建構、legacy issue 過濾、同列具體碰撞位置、另一詞義答案可作干擾項及書面語 source audit。
- `npx tsc --noEmit`：通過。
- `npm run lint`：通過；修正後相關檔案 targeted ESLint 亦通過。
- `git diff --check`：通過。
- `npm run build`：通過；沙箱內首次執行只因 Turbopack 建立程序／綁定本機 port 被拒，獲准於沙箱外重試後成功完成 production build、TypeScript 及 84 個 route 的 page-data 生成。
- 實際資料唯讀驗證：`accept` 的舊錯誤只由反義詞 `reject` 造成，按新規則不再是內容問題；`go（A1 · 去）` 的英譯中干擾項「走」雖同時是 `go（B1 · 走）` 的主要中文釋義，按目前規則亦不再是內容問題。
- Browser：按 Playwright CLI 指引完成本機真實瀏覽器流程；`go（A1 · 去）` 在列表顯示「兩種題型可用」，詳情顯示「目前沒有需要修正的內容」，「走」仍保留在第一個中文干擾項並成功出現在英譯中題目預覽。亦確認 disabled checkbox 的「尚未提交」原因、完整下一步及 click-outside dismiss 正常。
- 已更新 `tests/e2e/catalog-workspace.spec.ts` 的相鄰 regression，使 import-only 流程不再期待已廢止的 sibling issue；本輪按 Playwright CLI 指引進行真實瀏覽器驗證，未另行執行整個 catalog-workspace Playwright Test project。
- 第四輪 `npm test`：通過，365／365；`npm run lint`、`npx tsc --noEmit`、`git diff --check` 及 `npm run build` 均通過。
- 第四輪 Browser：按 Playwright CLI 指引於 1440 px 本機真實頁面開啟「更多篩選」；選單內容正常顯示，點擊頁面標題後 `details.open` 為 `false`；再次開啟後按 Escape 亦為 `false`，並確認焦點返回觸發控制。頁面同時顯示「下載所選詞條修改表（CSV）」及「下載修改表不會立即更改詞庫」完整流程說明。
- 已更新 `tests/e2e/catalog-workspace.spec.ts` 的 desktop overlay regression，加入「更多篩選」click-outside、Escape 及焦點返回斷言；本輪依 Playwright CLI 規則完成真實瀏覽器驗證，未另行執行整個 Playwright Test project。
- 第五輪 `npm test`：通過，369／369；新增 XLSX 匯出／上載 round-trip、公式拒絕、工作表結構拒絕及 CSV 相容測試。`npm run lint`、`npx tsc --noEmit`、`git diff --check` 及 84-route `npm run build` 均通過。
- 第五輪 Browser：本機真實老師頁面確認「匯出格式」預設為 Excel（XLSX），選取詞條後按鈕顯示「匯出所選詞條（XLSX）」；切換 CSV 後即時改為「匯出所選詞條（CSV）」。批量提交頁的範本與 sense key 匯出均預設 XLSX，檔案選擇器接受 XLSX／CSV，頁面沒有「修改表」或「CSV 更新」舊術語。
- 已更新 catalog workspace browser regression，加入 XLSX 預設值及 XLSX／CSV API round-trip；本輪按 Playwright CLI 指引進行真實瀏覽器驗證，未另行執行整個 catalog-workspace Playwright Test project。
- 尚未重跑 320／768／1024／1440 全 viewport overflow 及 toolbar geometry matrix；此項保留在 Phase 3，不影響上述針對第二輪教師回饋的功能驗證。
- 未執行 production deploy、seed、migration 或任何 destructive 操作。
