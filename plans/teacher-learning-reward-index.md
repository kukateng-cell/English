# 教師自訂權重學習累積分與期間匯出

> 狀態：進行中（使用者已批准實作；兩位獨立 reviewer 複核計劃 PASS；production deploy／destructive migration 仍需獨立授權）
> 建立：2026-09-07；版本：Revision 2（已整合兩路審查）
> 功能分支：`codex/teacher-learning-reward-index`，由本機 `staging` 的 `dc69d42a646085a9fc624f454851e1323e7e9de0` 建立；未fetch／改動遠端分支。
> 授權範圍：使用者已批准按本計劃實作；不包含 production deploy、真實學生 pilot 或 destructive migration。
> 相關文件：[分析與匯出](./admin-user-directory-and-learning-analytics.md)、[教師工作區](./teacher-workspace-roster-progress-redesign.md)、[學習規範](./retrieval-first-learning-contract.md)、[現況基線](./artifacts/retrieval-first-v2-current-product-baseline.md)。

## 1. 背景、需求及成功準則

老師要定期鼓勵學生使用系統，兼顧持續投入與客觀認讀成果。科組自行協議日期及權重，系統提供可以核對的每日明細及期間累積結果。老師可以選 9 月 1 日至 10 月 5 日，也可以獨立選九月、十月或其他有效範圍。

使用者已明確要求：

- 投入及成效分開記錄，老師自行指定百分比，再計加權總分。
- 每日數據及每日得分可以累積，匯出包含期間每日明細、逐日累積及最終總數。
- 每次按所選日期重新計算；重複匯出同一段日期合法，先前匯出不影響分數。
- 科組自行管理實際加分；沒有已派分、結算、扣除已匯出日期、領取或獎勵帳本。

成功準則：同一學生、資料集、日期、計分版本、權重，畫面與匯出結果一致；在同一政策、權重、資料／班籍狀態下，相鄰且不重疊日期範圍的累積分可以直接相加；學生答錯仍可取得投入分，self-rating 的「一樣／不一樣」不影響投入分。首版日期範圍提案限目前學年（§5.1），未假定使用者已接受跨學年查詢限制。

本計劃新增的每日門檻及分值屬產品提案，沒有經學生 pilot 校準，不稱為科學認證的公平或能力評量。使用者已確認功能方向，尚未確認下述具體數值。

## 2. 範圍與非目標

第一版涵蓋教師及管理員的學生期間報告：日期選擇、教師權重、累積分預覽、個人每日明細、XLSX／CSV 匯出。

不增加學生公開排行榜、科目成績冊、派分流程、教師設定資料表、背景排程、每日分數落庫、研究 telemetry、登入時數／停留時間監控、請假校曆、歷史學年查詢或歷史班籍還原。沒有自動判定作弊或「懶惰」標籤。SM-2、學習排程、答題、手勢、單元解鎖及原有統計口徑保留。

每日結果由已保存的學習事件查詢時計算，不需要每日 cron；功能推出前的合資格事件亦可按同一規則計算，資料不足須明示。

## 3. 現況核對與差異

2026-09-07 靜態核對（不是 production 上線驗證）：

| 現有來源 | 能力／需留意之處 |
|---|---|
| `src/lib/learning-analytics.ts` | CURRENT membership、學年 clamp、180 日上限、學生查詢／timeline、日週月匯出、transaction snapshot 及權限重驗 |
| `src/components/analytics/AnalyticsDashboard.tsx` | 教師／管理員共用日期及班級分析、CSV／XLSX 入口 |
| `src/components/teacher/TeacherStudentsWorkspace.tsx` | 學生名冊／進度分頁、學生選擇及查詢 |
| `src/lib/catalog/runtime.ts` | `isEligibleOperationalObjectiveEvent` 嚴格核對 winner、user／word／sense／snapshot／version／purpose；不能只數 quality=4 |
| `ReviewEvent` | 有 submittedSenseId、senseKey、內容快照、版本、第一次客觀結果及日期；部分關聯可因清理變 null |
| `StudyEncounter` | acknowledgedAt、streamItemId、operationId、senseId；沒有完整 immutable sense identity snapshot |
| `src/lib/learning-analytics-export-*` 及 export route | 已有大小限制、ExcelJS、字串安全處理、recent-auth、限流及匯出安全審計 |

既有掌握度為當前 Review 狀態，不可逐日相加或當歷史某日掌握度。既有 analytics 部分讀取按「目前 ACTIVE 詞庫」篩選，詞語停用可能改變舊期間數值；不能不加區分直接用作穩定獎勵累積來源。新 reader 須單獨明訂歷史事件資格，原有 analytics 仍保持原口徑。

## 4. 計分政策：reward-v1 提案

### 4.1 同一量尺、每日可加

兩軸每日各 0–10 分。老師只調投入／成效權重，不在第一版任意編寫公式。預設 50／50 只方便首次顯示，不代表校方建議。提供 70／30、50／50、30／70 快選及 0–100 整數自訂；一個數值改變，另一個自動補足 100。同一報告所有學生使用相同參數。

每位學生每個 Asia/Shanghai 日：

| 符號 | 定義 |
|---|---|
| Ld | 合資格完成 Learning Card 次數，每個 streamItemId／encounter 只計一次 |
| Pd | 合資格首次客觀作答次數，每個 winning objective target 只計一次；答對答錯均計 |
| Ud | `Ld + Pd`，稱「投入活動次數」；認字卡及客觀題是兩種獨立完成活動 |
| Cd | 同詞義當日第一個合資格 objective result 答對的詞義數 |
| Ad／Rd | 全部合資格 objective targets 的作答數／答對數，供原始正確率欄 |

```text
每日投入分 Ed = 10 × min(Ud, 20) / 20
每日成效分 Od = 10 × min(Cd, 5) / 5
每日加權分 Td = Ed × effortWeight / 100 + Od × outcomeWeight / 100

期間投入累積 E = Σ Ed
期間成效累積 O = Σ Od
期間加權總分 T = Σ Td = E × effortWeight / 100 + O × outcomeWeight / 100
```

投入每天最多計入 20 次合資格完成活動、成效每天最多 5 個當日首次客觀認讀成功詞義。系統正式派出的同詞補救／gap-filler新卡，完成後亦計投入；同一卡的重送、refresh、重取回執均不重複計。這是獎勵分計算封頂，學生仍可繼續學習，系統不因封頂停派題。不同日複習同詞義可再次計分，鼓勵跨日學習；沒有額外 streak／活躍週加成，避免切割期間後總分不同。

此處依首輪審查將「不同詞義數」改為「合資格活動次數」：20次完成活動即有相同投入分，不因弱學生被安排重複補救而縮水。它仍不是學習時數或心理努力的直接測量；主動重開單元重做合法新卡也可能取得投入，只有每日封頂及來源去重，不虛稱完全防刷。不同詞義數另列作廣度參考。

成效欄完整名稱為「客觀認讀成果分」，簡稱「成效分」。它反映有上限的成功證據量，受作答機會及內容影響；不是正確率、能力、進步幅度或長期掌握度。正確率獨立顯示 `ΣRd / ΣAd`，無作答為空值，不平均每日百分比。

同詞義當日客觀事件按 `createdAt ASC, id ASC` 決定第一個結果；第一次錯、後來同日另一個合法 target 答對，原始答對數會增加，但 Cd 不增加；隔日第一個合資格結果可重新計算。Global／Unit、兩個方向及內容 revision 共用 sense identity，不另外增加同日成效詞義次數；獨立合法活動仍按Ld／Pd計投入。

### 4.2 精度與算例

以整數 milli-points（1 分=1,000 單位）運算。Ed 每活動 500 單位，Od 每成功詞義 2,000 單位；整數百分比權重後每日最細 5 單位，全部結果可以精確以 3 位小數顯示。API、每日／累積表及 CSV／XLSX 同樣提供精確到 3 位的數值，不逐日四捨五入成整數，也不以顯示後的 2 位小數反算總分。

例：投入 40%、成效 60%。

| 日期 | Ud | Cd | 投入分 | 成效分 | 當日加權分 | 期間逐日累積 |
|---|---:|---:|---:|---:|---:|---:|
| 9/1 | 20 | 3 | 10 | 6 | 7.6 | 7.6 |
| 9/2 | 10 | 1 | 5 | 2 | 3.2 | 10.8 |
| 9/3 | 0 | 0 | 0 | 0 | 0 | 10.8 |
| 合計 | 30 活動 | 4 詞義日 | 15 | 8 | 10.8 | 10.8 |

期間 Ud 加總叫「投入活動次數」；Cd加總叫「成功詞義日數」，不能誤稱「期間不同詞義數」，同詞義跨日會重複計。另一個獨立去重欄提供期間不同詞義數。期間累積由選定開始日歸零，9/1–10/5 是 35 個 inclusive 日；10/1–10/5 不帶九月份 carry-in。

權重controls及報告設定同列簡短例子：未封頂時，50/50下完成一張卡增加0.250總分；一個當日首次答對詞義的probe同時計投入及成效，增加1.250；同詞卡片完成後再答此probe仍是另一個投入活動。投入已封頂、成效未封頂時，該probe只增加1.000；兩軸都封頂後增加0。百分比作用於經量尺換算的分數，兩軸可以來自同一活動，並非兩組互斥活動的比例。

零活動每日三種分數為 0；沒有客觀作答時，成效得分 0 表示未累積到成果，正確率則為 `null`／「未有客觀作答」。不能因此把未觀察到的能力說成 0%。權重為 0 的軸仍保留原始數據，不把其權重自動分給另一軸。

### 4.3 教育公平性、限制及顯示

- 20/5 及兩軸每日滿分相同，只建立可理解量尺，沒有保證兩軸滿分同樣容易取得。scheduler 的間隔、到期及合法題目數會影響成效機會。
- 積極但經常答錯可累積投入；少量高正確不會因 1/1 就得到每日滿成效分。亂猜仍可能得成果，事件合法不證明認真；上限與去重降低刷量收益，不宣稱防作弊。
- 題目／程度、家庭設備、可用日數不同，使用同權重同日期仍不代表完全公平。顯示 eligible days、活躍日、原始作答數及 A1–B2 作答分布作解讀依據，不自動按年級或答題速度加權。
- 正確率樣本標籤：0 題「未有客觀作答」、1–4 題「樣本較少」、≥5 題「已有作答資料」；不稱「足夠判斷能力」。沒有題目不等於不肯答，不生成未完成率。
- 分數只作教師獎勵參考。首版不提供以eligible days除出的第二個0–100綜合指數，也不擴展實際科目加分兌換器；教師可直接採用或自行換算累積分。
- 開始實作後先做 deterministic scenario walkthrough：新學生只有卡片、成熟詞直接 probe、錯題多／remediation、少量全對、長期堅持、單日集中大量及不同程度。配對比較同樣20次活動但不同self-rating／重複詞義分布，必須得到相同投入分；另列完成卡數、重複卡數、詞義廣度、probe數、兩軸分數及達封頂率。成效機會差異須寫成產品取捨紀錄；門檻調整須同步 policy version／例子／測試，在發布前固定，不為補滿獎勵分改scheduler或硬派題。

## 5. 日期、資格與資料完整性

### 5.1 範圍及 cohort

首版範圍提案：沿用 CURRENT、ACTIVE 學生與教師可查看班級；日期控制明確標為「目前學年」，支援使用者提出的本學期／月度用途。跨學年回查是本計劃待使用者審閱的範圍取捨，並非已獲接受的限制。若需要學年切換後重算舊月份，須在實作前擴充所選學年及歷史授權方案，不能以保存檔案冒充支援。此提案不增加任何結算功能。

預設目前學年 startsOn 至今日；新報告獨立支援最多 366 inclusive 日，覆蓋學年及閏日，原有 analytics 180 日限制不變。任何預設跨度超過366日須提示選短範圍，不能無聲裁去首段。

請求日期要合法、start≤end≤today；與 CURRENT 年界取交集，零交集返回422；畫面及匯出同列要求／實際日期。CURRENT年未開始返回503；已結束未啟用新年時沿用既有calendarWarning及年末上限。

每名學生 `eligibleFrom=max(effectiveFrom, enrollment.startedAt 的本地日)`；若 startedAt 缺失，沿用目前學年起點並顯示「入籍日期未記錄」提示。加入前每日 eligible=false、分數留空；加入後無活動為0。學年切換後第一版不能再查舊學年，老師保存已匯出檔案；不新增歷史學年資料能力。

週末／假期照計實際活動，無活動不扣已得分；eligible days 只表示資料範圍，並非學校指定出席日。轉班按目前班級歸組，包括當前資格窗口內轉班前活動，常駐說明「按目前在籍學生計算」。停權／離籍學生不在現行範圍，報告不是全歷史名冊。

### 5.2 事件及歷史詞庫

新 reward reader 不依賴「目前 ACTIVE 詞庫」條件，不因日後詞義停用／revision改動抹去仍有完整證據的舊活動。raw counts 在本報告內同樣採 reward 資格，不與舊分析的 current-catalog counts 混用；UI 明示歷史活動包括現已停用詞義。

Learning Card：查 `StudyEncounter.acknowledgedAt`，核對同一 user 的 V2 Learning Card streamItem、已揭示及已確認完成、operationId、selfRating 合法、詞義 identity 一致；「一樣」及「不一樣」同樣納入。REVEAL、FEEDBACK_ACK 不另外加分；只登入、lease、查看詞表及未確認動作不計。

候選讀取與計分資格分開：ReviewEvent先僅按授權userIds、effective日期、createdAt≤asOf作bounded查詢，不在SQL排除historical、legacy、research、missing sense或version；StudyEncounter同樣僅按userIds、acknowledgedAt窗口及cutoff讀取，使用nullable relation select，不能inner join令壞紀錄消失。StudyDay獨立bounded讀取作交叉檢查。候選在記憶體先按學生eligibleFrom排除入籍前事件，再按以下政策分類，原始total不能直接拿SQL count當合資格數。

Objective的計分資格：非historical REVIEW／V2 objective；按事件記錄的版本選擇 reward-v1 支援的 validator。固定bundle為`flow=v2`、`policy=retrieval-v1`、`quality=retrieval-v1-quality-v1`、`construction=retrieval-v1-mcq-curated-v2`，correct=4、wrong=2。沿用現有 `isEligibleOperationalObjectiveEvent` 的關聯驗證並加上reward限定斷言（如下）；不能默認未知版本的quality=4就是成功。

reward額外必需的select／assertions：

- event.submittedSenseId、senseId、target.senseId、snapshot.senseId均非空且相等；submittedWordId、wordId、target.wordId、snapshot.wordId均非空且相等；event／target userId一致。
- event及snapshot的contentRevisionId、catalogRevisionId均非空且配對相等；兩者construction/contentVersion等於固定bundle；不以目前approvedRevision取代歷史revision。
- target.id、status=CONSUMED、purpose、policy／construction、winningOperationId及winningReviewEventId逐項匹配event；snapshot.id／targetId匹配event／target；目標只能貢獻一次Pd。
- DUE_REVIEW要求target.obligationId與obligation關聯同為null；EVIDENCE_OBLIGATION要求obligation.id=target.obligationId、userId／wordId／senseId等於target、kind=EVIDENCE_OBLIGATION、policyVersion=retrieval-v1、status=ANSWERED。資料select包含上述全部欄位，不能只取status。
- Learning Card select包含encounter.id/userId/wordId/senseId/streamItemId/operationId/selfRating/policyVersion/acknowledgedAt；streamItem.id/wordId/senseId/itemKind/status/revealedAt/usedAt/feedbackAcknowledgedAt/operationId/policyVersion及session.userId/flowVersion。要求itemKind=LEARNING_CARD、status=ACKNOWLEDGED、揭示時間≤acknowledgedAt、兩完成時間=acknowledgedAt、operation／word／sense／user一致、selfRating屬selfForgot/selfRecalled、policy固定retrieval-v1、session flow=v2。session目前過期／retired不排除歷史活動，不讀credential秘密。

為 reward 保存固定的已支援 validator，不能將未來「current version」常數改動直接套回舊報告。共用純驗證邏輯應接受明確version bundle，新validator只由獎勵reader呼叫；舊consumer parity tests證明原行為不變。

Cd及詞義廣度的去重identity固定senseId；投入Ld按encounter／streamItemId、Pd按winning objective target去重，不能再按senseId合併投入活動。如果senseId缺失或與關聯不一致，不由term／word猜測。ReviewEvent有submittedSenseId但encounter沒有同等快照，首版不承諾hard delete後仍完整還原。完整關聯尚存的停用sense可計；缺關聯事件列排除數及資料不完整提示。

研究／diagnostic／明確legacy／historical bridge不計分；分類為「非本政策資料」。看似V2或身份不明但缺provenance／version屬「資料待核對」，不能將所有flowVersion缺失列legacy而隱藏破損V2。每個source candidate依序只落一桶：outsideEligibility → policyExcluded（明確historical/legacy/research/diagnostic）→ unsupportedVersion → missingIdentityOrProvenance → nonWinningOrInvalidOutcome → included。空version屬missing，不是已知legacy。API附counts守恆，畫面給友善中文，不輸出學生的題目答案／完整ledger。

資料狀態分三個獨立維度：`policyExcludedCount`為legacy／研究等正常政策排除；`validationGapCount`為未知版本／不完整或不一致證據；`historyCoverage=NOT_GUARANTEED|KNOWN_GAP`表示無永久快照故不保證完整歷史，或已發現StudyDay有活動但活動來源遺失。期間兩個count加總、historyCoverage只要一日KNOWN_GAP就升級；另列排除原因各bucket，守恆不重複計。

`validationStatus=CHECKED|INCOMPLETE`只代表讀到的候選是否全數可分類／驗證；任何validationGap>0即INCOMPLETE。CHECKED不保證所有歷史資料仍存在。沒有取回事件時稱「目前未有可計紀錄」，不得稱「確定沒有學習」。正常政策排除、validation gap及history limitation可同時出現，全部列出，沒有互相覆蓋。

缺資料的數值仍可匯出，但標示「按可核對紀錄計算，結果可能受缺漏影響」，不稱保證下限；較早錯誤事件如遺失，較後答對可能成為首個合資格結果而增加Cd。加測此案例及StudyEncounter因streamItem cascade整列消失的情況；不自動補造投入／成果。未知版本亦不能靜默當完整0分。

StudyDay只可交叉核對，不獨立產生投入分。活躍日由納入reward的活動日期推導；跟現有StudyDay不一致列coverage warning，不修復DB。

目前正常cleanup已明確只刪沒有streamItems的V1 session，保留V2 encounters（`src/lib/study-session-server.ts:cleanupExpiredStudySessions`）；本功能保留此規則，DB回歸必須證明正常cleanup前後reward不變。hard delete或人工更正仍不能從已消失的row推知完整缺口。

| eligible日取回資料 | validationStatus | policyExcludedCount | historyCoverage | 可見結果 |
|---|---|---:|---|---|
| 無event，無StudyDay | CHECKED | 0 | NOT_GUARANTEED | 0分／目前未有可計紀錄 |
| 只有明確政策排除 | CHECKED | >0 | NOT_GUARANTEED | 0分／有非本政策活動，不能當可完整比較 |
| 只有無效V2候選 | INCOMPLETE | 0 | NOT_GUARANTEED | 0分／紀錄待核對 |
| 合法+政策排除+無效V2 | INCOMPLETE | >0 | NOT_GUARANTEED | 已核對結果及兩種提示並列 |
| StudyDay有活動但無任何對應event／encounter | CHECKED或INCOMPLETE依取回資料 | 依資料 | KNOWN_GAP | 歷史活動有缺口，不判無學習 |

三種狀態獨立；StudyDay有已知政策排除來源不是上述「來源遺失」，但可提示reward與operational day不同。守恆每source分開：candidateCount=outsideEligibility+policyExcluded+unsupportedVersion+missingIdentityOrProvenance+nonWinningOrInvalidOutcome+included；validationGapCount=後三種不合格桶之和。統計判斷以eligible範圍為準，入籍前事件只計outsideEligibility，不令學生資料狀態變壞。

### 5.3 cutoff及重現性

server 建立 `asOf`，只納入已提交且事件時間≤asOf的紀錄；encounter按acknowledgedAt、objective按createdAt歸日。離線9/30作答到10/1才獲server接受，按10/1計，不信任client日期補回9月。

asOf是事件截止時間，不是永久資料快照；目前班籍、關聯清理及資料更正仍可改變日後結果。同一資料狀態／參數保證確定性，不承諾跨日重新查詢永遠逐byte相同。匯出metadata包含asOf、版本及參數，老師自行保存結果，沒有報告快照表。

## 6. 教師流程與呈現

在教師／管理員「學習分析」頁加入「學習累積分」分頁，沿用shell及班級選擇；分頁日期使用獨立狀態，避免366日參數污染原有180日分析。學生工作區可提供深連結到同一入口，不再複製計分表。

1. 選目前學年班級／學生及日期；預設學年開始至今日，快選本月、上月、學年至今、自訂。
2. 投入及成效權重用兩個有label的number inputs與slider同步；顯示總和100%。
3. 按「計算」後，顯示學生總表；改日期／權重／範圍即標示結果未更新，停用匯出直到重新計算。
4. 每人顯示學號、姓名、班級、eligible／活躍日、投入累積、成效累積、加權總分、客觀答對／作答、正確率及coverage。
5. 點學生展開有分頁的每日表：日期、投入活動數、成功詞義數、兩者封頂後計入數、作答／答對、當日三分數、截至當日三累積及eligible／coverage。
6. 「匯出累積分報告」輸出所選完整範圍（不只是畫面當頁）。沒有學生選取時明示「匯出目前篩選的 N 名學生」。既有recent-auth必要時沿用。

預設按學號穩定排序，不建立能力排名；權重／日期／format只留當前頁state，不新增教師偏好資料表。敏感搜尋不入URL／localStorage，只有grade/class非PII深連結沿用現有慣例。雙locale／theme、keyboard、screen reader、390/820/1440px均需支援。

## 7. 匯出規格

XLSX預設，三個工作表：

- 「報告設定」：學年、要求／實際日期、目前班籍口徑、資料截止時間、公式version、每日20活動／5成功詞義上限、權重、scope人數、資料完整性、公式、權重算例及限制說明。
- 「學生總表」：每學生一行，身份、eligible日數、活躍日、原始／封頂後投入活動總數、原始／封頂後成功詞義日數、期間不同詞義數、原始作答／答對／正確率、兩軸累積、兩軸加權貢獻、加權總分、排除數／coverage。
- 「每日明細」：每學生每個effective date一行，含eligible=false空分數日、無活動0分日、當日數據及三種逐日累積。加入前累積亦空；加入當日起從0累積。

每日原始Ud/Cd與creditedUd=min(Ud,20)、creditedCd=min(Cd,5)分欄；總表分別相加，E=0.5×ΣcreditedUd、O=2×ΣcreditedCd。不能將全期間Ud封頂一次代替逐日封頂。完整原始Ld/Pd亦在每日表保留。

學生詳情及兩種匯出均列兩軸封頂日數／eligible日數（無eligible日為null），名稱「期內封頂日比例」而不是任務達標率。A1/A2/B1/B2各自的attempt/correct由ReviewEvent.wordLevel歷史快照計，每個合資格target恰好落一級，總數與Ad/Rd相等；四組欄位放每日明細、總表及畫面展開區，不擠入主表。不同程度分布只解讀題目來源，不代表難度已等值。

CSV為單檔，固定header，`rowType=SETTINGS|STUDENT_TOTAL|STUDENT_DAY`；settings使用settingKey/value，每個total／day row仍包含from/to、asOf、policyVersion及權重，方便篩走settings後仍知道口徑。不可把總表與每日明細直接加總；說明只加總STUDENT_DAY的當日分數，不加累積欄或TOTAL。固定排序settings→所有totals→按班級／學號／userId／日期daily。

數值由server算好，XLSX用numeric cells、固定3位格式，不依賴Excel公式刷新；CSV UTF-8 BOM、RFC4180、crlf及公式注入防護；所有身份字串使用既有safeSpreadsheetText，換行、引號、emoji、全形符號均需round-trip。數值的null與0保持區別。檔名包含起訖日期及權重，無PII。

預覽與匯出共用reducer、cutoff及request參數；匯出是新的授權查詢，沿用預覽asOf，只在資料未變時保證相等。參數及學生scope fingerprint不符返回409要求重新計算，不靜默更改選取。沒有「已匯出／已派分」狀態；既有ROSTER_EXPORTED安全審計仍保留，僅記匯出動作，從不影響分數。

## 8. API、服務與檔案設計

新增獨立路由，避免改舊報告DTO及上限：

- `POST /api/learning-analytics/rewards/query`：學生總表，limit預設50／最多100、signed cursor；回server asOf與scope token。
- `POST /api/learning-analytics/rewards/students/[id]/timeline/query`：單人每日表，最多366日，可由UI每頁31日展示。
- `POST /api/learning-analytics/rewards/export`：同scope及政策，CSV／XLSX，含所有每日及總表。

共同canonical request：`range{fromDate,toDate}, grade?, classIds?, studentIds?, search?, weights{effort,outcome}, policyVersion`；studentIds與search不可同時使用。classIds/studentIds若提供須非空、不重複，分別最多200／500，每ID最多128 UTF-8 bytes；search最多80 graphemes及1,024 bytes。selectors採交集，但明確提交的學生必須全部在授權與所選class／grade內，否則404，不能默默少匯出。未指定classIds由actor的授權班級範圍解讀，ADMIN可含未分班；TEACHER不能取得未分班。

第一頁query接受canonical request及limit（預設50／最多100），不接受client自訂asOf／scopeToken；server回asOf及context。續頁query接受同一完整canonical request、limit、cursor、asOf、scopeToken。timeline接受同一完整canonical request、asOf、scopeToken及path studentId；export接受同一完整canonical request、asOf、scopeToken、format。每route獨立allowlist，拒絕其他欄位；權重必須整數0–100且sum=100，policyVersion首版只接受reward-v1，非法返回422。client不得傳當日分數／correctness作權威值。

回應envelope：`requestedRange,effectiveRange,academicYear,cohortBasis,asOf,policy{version,dailyEffortCap,dailyOutcomeCap,dailyScale,weights},scopeRevision,scopeToken,coverageSummary`及下述typed result。scopeToken的versioned signed payload只帶actor／role／credential與access/roster/year revisions、canonical request fingerprint、整份member IDs digest、asOf、expiresAt；30分鐘到期、最多4,096 bytes，不嵌PII selectors。每次由完整canonical request重新解析授權成員，比對request fingerprint及排序後成員digest，timeline再確認path studentId屬該報告集合（即使teacher另有權看該人亦不可混入）。同一參數的ID陣列按去重後UTF-8字典序canonicalize，重複ID仍422；身份結果顯示按班級／學號／帳號／id穩定排序。

cursor最多4,096 bytes，綁同context fingerprint、固定limit及上一列sort key；拒絕換權重／跨actor／篡改／過期，context stale回409，格式或簽名非法422。token只作短期query context，沒有報告／結算資料表。

### 8.1 明確輸出型別及null規則

以下欄名為新增contract，產品中文顯示由同一欄位表管理；API以整數milli-points傳輸，只有presentation／export除1,000一次。

```text
SourceCounts = {candidateCount, outsideEligibility, policyExcluded,
  unsupportedVersion, missingIdentityOrProvenance, nonWinningOrInvalidOutcome, included}
Coverage = {sources:{encounters:SourceCounts,reviews:SourceCounts},
  validationGapCount,policyExcludedCount,validationStatus:CHECKED|INCOMPLETE,
  historyCoverage:NOT_GUARANTEED|KNOWN_GAP,studyDayMismatchCount,warningCodes:[]}
LevelCounts = {A1:{attempts,correct},A2:{attempts,correct},
  B1:{attempts,correct},B2:{attempts,correct}}
Scores = {effortMilliPoints,outcomeMilliPoints,effortContributionMilliPoints,
  outcomeContributionMilliPoints,weightedMilliPoints}
StudentDay = {studentId,date,eligible,
  learningCardCount,objectiveAttemptCount,objectiveCorrectCount,
  effortActivityCount,creditedEffortActivityCount,firstCorrectSenseCount,
  creditedFirstCorrectSenseCount,distinctSenseCount,levelCounts,
  objectiveAccuracyPercent,accuracyStatus,effortCapReached,outcomeCapReached,
  scores:Scores,cumulative:Scores,coverage:Coverage}
StudentTotal = {studentId,studentNumber,accountName,legalName,nickname,grade,classId,classLabel,
  eligibleFrom,eligibleDayCount,activeDayCount,learningCardCount,
  objectiveAttemptCount,objectiveCorrectCount,effortActivityCount,
  creditedEffortActivityCount,firstCorrectSenseDayCount,creditedFirstCorrectSenseDayCount,
  distinctSenseCount,levelCounts,objectiveAccuracyPercent,accuracyStatus,
  effortCapDays,outcomeCapDays,effortCapDayPercent,outcomeCapDayPercent,
  scores:Scores,coverage:Coverage}
QueryResult = {items:StudentTotal[],totalStudentCount,nextCursor:string|null}
TimelineResult = {student:StudentTotal,days:StudentDay[]}
CoverageSummary = {basis:WHOLE_REPORT,studentCount,studentsWithValidationGaps,
  studentsWithPolicyExclusions,studentsWithKnownHistoryGaps,combined:Coverage}
```

SourceCounts及Coverage永遠是非負整數count與非空status；全scope只把each source加總，不把已加總的daily／total再算一次。summary即使只有50人的page，亦代表全部選定≤500人，採一次取回全部scope的bounded資料後算totals再分頁。

eligible=false的日，所有活動／level／cap／accuracy／Scores／cumulative欄值null，coverage只在outsideEligibility列實際候選數；日後計分不使用這些候選。學生eligibleDayCount=0時，total活動counts=0、activeDayCount=0、capDays=0，所有Scores與百分比null；有eligible日但無活動時Scores=0、accuracy=null、capDayPercent=0。其他日各count與score可為0，levelCounts固定四級補0；attempts=0的accuracy=null。每個百分比四捨五入到2位只供顯示，不作下一層運算；accuracyStatus採§4.3三種標籤。

CSV固定欄序：rowType、settingKey、settingValue、requestedFrom、requestedTo、effectiveFrom、effectiveTo、asOf、policyVersion、effortWeight、outcomeWeight、學生身份、date、eligible、eligibleFrom、eligibleDayCount、activeDayCount、Ld、Ad、Rd、Ud、creditedUd、Cd或期間Cd合計、creditedCd或期間合計、distinctSenseCount、A1–B2 attempts/correct、accuracy/status、兩軸capReached／capDays／capDayPercent、Scores五欄、cumulative五欄、每source六個排除／納入桶及candidateCount、coverage各status/count/warnings。所有欄位對應上列型別，DAY用日數據、TOTAL用期間數據，無適用值留空，SETTING只有key/value及context；TOTAL的cumulative欄留空避免重複。XLSX兩個data sheets使用同一對應映射及適用子集，封頂raw/credited欄不能省略。

| 建議檔案 | 工作 |
|---|---|
| `src/lib/learning-reward-policy.ts` | 純型別、version bundle、資格及daily/period整數reducer |
| `src/lib/learning-reward-analytics.ts` | bounded歷史事件reader、scope/snapshot重用、DTO、prefix sums |
| `src/lib/learning-reward-export.ts` | 三表XLSX／typed-row CSV、metadata、bytes限制 |
| `src/components/analytics/LearningRewardPanel.tsx` | 設定、總表、明細、匯出及樣本／coverage提示 |
| `src/lib/learning-analytics.ts` 或抽出shared scope module | 只抽取授權／calendar／snapshot共用機制，不改原metric語義 |
| reward routes、鄰近`.test.ts`、`tests/e2e/learning-rewards.spec.ts` | handlers與必要回歸 |

不得跨模組複製第二套授權邏輯。query/timeline需requireRole、same-origin、no-store；export沿用recent-auth／共享限流／審計。同一DB transaction讀membership及事件，response serialization完成後、送出前fresh recheck actor role/status/credentials、access、roster及year；無權學生一律404，scope變更409，無session401，auth backend503，錯誤不傳partial PII。export審計失敗503且不交付檔案。

## 9. 資料庫、效能及邊界

首版不新增reward／settlement資料表。歷史reader按userIds+日期bounded read，一次讀取需要欄位，按學生／日期分組後單次reducer，O(events + students×days)。不能為每人每一天重跑query或掃全事件。

限制：最多500個學生、200班、366日；reward query／續頁／timeline／export全用獨立128KiB串流body cap，沿用共用bounded JSON reader（無Content-Length亦在讀取途中停止）。700個最長128-byte IDs連同JSON、兩個4,096-byte tokens、日期／search仍須通過端到端payload測試；不能宣稱500人但preview無法輸入。舊報告16／96KiB規則不變。

每類事件集合最多200,000+1作超限檢查，超限整份返回413，不交付截斷分數。500×366=183,000每日行，加500總表與settings，最大185,000資料行；export 最終檔案限制 32 MiB，CSV 按實際編碼逐列累計；XLSX 另外採 256 MiB 工作簿模型估算預算（每 cell 256 bytes 加字串 UTF-16 大小，屬保護門檻而非實測 RSS），超限引導按班或日期拆開。timeline回單人366行，summary response不夾全校每日rows。

Prisma單transaction順序讀取，避免單connection並行query。先核對索引／EXPLAIN；StudyEncounter現有主要索引是createdAt，但本報告按acknowledgedAt，若計劃顯示必要新增`(userId, acknowledgedAt)` expand index。索引是否必要由500人fixture證據決定，不能先改歷史migration；不執行reset、seed重建或contract cleanup。若32MiB／同步執行無法支援最大範圍，提供清楚拆批限制，background jobs不屬首版。

本地性能驗收：記錄100人×35日及500人×366日、接近事件上限的warm p50/p95與peak RSS，目標summary p95≤3s、export≤15s、額外RSS≤256MiB；若未達，先優化reader／serialization或有證據地縮小公開上限，不能以縮小fixture冒充通過。managed/Vercel測試屬發布gate。

## 10. 分階段實施 checklist

### A：計劃與資料合約

- [x] 整理使用者需求及取消已派分／已匯出排除機制。
- [x] 核對現有analytics、schema、objective validator及匯出安全流程。
- [x] 兩路獨立審查，修訂並記錄處置（兩位Revision 2複核均PASS）。
- [x] 實作開始時更新本計劃為進行中，固定reward-v1參數及驗收算例。
- [x] 在retrieval contract第七節追加教師reward獨立projection說明（投入不影響mastery／學生排行榜），在analytics plan追加新報告歷史事件口徑及獨立上限連結。

### B：純計分與fixtures

- [ ] versioned事件資格／sense dedupe／每日封頂／整數運算／prefix reducer。
- [ ] 算例、相鄰範圍可加性、零資料及排除分類測試。
- [ ] 教育scenario walkthrough驗證20/5量尺可解釋；同活動數不同補救分布的投入分相等，記錄成效機會偏差與門檻決定。

### C：reader、scope與API

- [ ] 共用授權snapshot抽取及舊consumer parity。
- [ ] 歷史活動reader，不按目前ACTIVE狀態剔除完整舊證據。
- [ ] 366日calendar、startedAt、asOf、scope token／cursor及coverage。
- [ ] query/timeline/export handlers、CSRF/auth／recheck、大小限制。
- [ ] isolated DB fixtures驗證實際relation／停用／清理／轉班／撤權。

### D：畫面與匯出

- [ ] teacher/admin共用panel、日期／權重／結果dirty狀態。
- [ ] 全scope總表、單人日表及prefix明細；日期權重切換一致。
- [ ] XLSX三表／CSV型別行、數值與null、安全字串、完整metadata。
- [ ] metadata及canonical scope校驗；保留安全審計但無業務派分記錄。
- [ ] 雙locale/theme、mobile/tablet/desktop、keyboard及a11y測試。

### E：驗證、發布準備及交接

- [ ] unit／lint／typecheck／build通過。
- [ ] targeted reward API/DB/browser/export round-trip通過。
- [ ] 容量／性能測試、必要index migration驗證。
- [ ] 更新README索引、計劃驗證紀錄、已知限制及rollback。
- [ ] 實作review無blocking findings；production deploy獨立授權。

## 11. 測試矩陣

| 範圍 | 必須證明 |
|---|---|
| 數學 | 上述10.8算例；0/100、40/60、50/50、100/0；0≤daily≤10；無負數／NaN；精確3位 |
| 可加性 | A+B=T的整數單位相等；月跨界、相鄰範圍、prefix終值=total；不以每日accuracy相加 |
| 投入 | 只有cards、只有wrong probes、cards+probe同sense計兩次獨立完成、同item重送只一次、selfRating兩方向完全等價、20/21封頂 |
| 成效 | 同sense當日首錯後對、跨日再對、兩方向／unit切換、5/6封頂、1/1不能滿分 |
| provenance | retry／winner唯一；user/word/submittedSenseId/sense/snapshot/obligation mismatch；必要revision=null；固定版本與模擬future-current；研究／legacy/historical候選仍被讀取，per-source排除守恆 |
| 歷史 | ACTIVE→RETIRED不改完整舊事件分；revision更換及正常cleanup不改舊結果；關聯null明示INCOMPLETE；較早錯誤缺失／StudyDay有而encounter消失／legacy混合truth table；不推算歷史mastery |
| calendar | 9/1–10/5=35日；午夜+08、閏日、year clamp、future／倒轉／367日拒絕、startedAt為null／中途加入 |
| 離線 | server次日接受歸次日；asOf後事件排除；跨頁cutoff相同 |
| 權限 | 未授權班／學生404；teacher不見未分班；admin全scope；撤權／改密／轉班／year切換途中不洩漏 |
| UI | dirty停用匯出、request競態不覆蓋新參數、重試、空班、500人分頁、每日31日分頁 |
| 匯出 | 全scope而非當頁；三表／三rowType；3位numeric；null≠0；BOM／CSV注入／xlsx重新讀回；summary與daily加總 |
| Limits | 500/501學生、366/367日、185k行預檢、200k+1事件、bytes估算／最終bytes；700最長IDs經preview→續頁→timeline→export；token到期／篡改／跨actor／重排IDs一致／報告範圍外但另有權的學生404 |
| 回歸 | 原180日analytics、現有匯出、teacher scope、objective validator既有suite保持一致；沒有學習狀態寫入 |

預定指令：`npm test`、`npm run lint`、`npx tsc --noEmit`、`npm run build`；另新增專用reward DB checker及Playwright project並記錄正式指令。匯出round-trip直接用repo現有ExcelJS。若抽取共用objective validator，執行`npm run test:db:stream-v2`；若只新增read projection，不要求無關完整gesture suite。若新增index，執行`npm run test:migration-checksums`、`npm run test:migrations`及Prisma generate；不需destructive contract測試。DB連線失敗依AGENTS先escalated retry。

## 12. 風險、發佈與rollback

| 風險 | 應對 |
|---|---|
| 把成果量當能力 | 明確欄名、原始分母、程度分布、樣本提示及不作排名 |
| 量尺20/5偏向某群 | 模擬fixture比較、固定version、公布門檻；pilot前不宣稱已校準 |
| 舊統計与reward不同 | 獨立reader與口徑說明、兩報告欄名清楚、parity保護舊consumer |
| 關聯刪除／legacy不足 | coverage及排除數，同一行提示部分結果；不補造證據 |
| 重複匯出 | 合法且不扣分；科組自行選擇範圍，安全審計無計分作用 |
| 大型報告阻塞 | bounded讀取、預檢、性能gate及明確拆批提示 |

本地完成後經教師代表用人工算例核對。production／真實學生pilot另行授權；發布前確認managed DB執行時間／記憶體及最新schema。功能rollback移除新分頁／停用reward routes，舊analytics繼續服務；如有新增index可保留，無獎勵狀態需回滾。不改生產config則不以本功能名義更改deployment workflow。

## 13. Definition of Done

- [ ] 老師可自由選有效起訖日期及兩軸權重，所有學生同報告同規則。
- [ ] 每日、逐日累積及期間兩軸／加權分完全可核對，跨月可加。
- [ ] 正確率與累積成果分分開，樣本、eligible及coverage可見。
- [ ] 匯出含設定／所有學生總表／完整每日明細，資料安全及權限驗證通過。
- [ ] 無結算、已派分、匯出排除或新reward資料表；existing security audit保留。
- [ ] 既有功能回歸與容量驗證通過，實際測試／未做項目完整記錄。

## 14. 決策及審查紀錄

| 決定 | 根據／狀態 |
|---|---|
| 教師選日期及權重、按期間重算 | 使用者已明確要求 |
| 不追蹤已派／已匯出日期 | 使用者已明確取消此範圍 |
| 每日可加量尺，成效採成功證據量 | 本計劃提案；解決百分比不能累積及小樣本100%問題 |
| 20投入活動／5成功詞義，各每日10分 | 提案預設；由不同詞義投入改為合資格活動投入，避免補救重複造成少分；非已批准教育常數 |
| 目前學年範圍 | 依現有授權能力提出的首版範圍，待使用者審閱，未宣稱支援跨學年重算 |
| 不加0–100第二指數／加分兌換器 | 控制scope；累積分由老師自行採用 |
| 歷史reader獨立、保留停用詞義證據 | 避免目前詞庫狀態抹去舊投入 |

### 14.1 兩路獨立審查（2026-09-07）

兩位sub-agents獨立讀取計劃及相關程式，沒有改檔或執行DB寫入；主agent整合後交回原reviewers複核。

| Reviewer | 職責 | 首輪Revision 1 | 複核Revision 2 |
|---|---|---|---|
| Confucius（01a079c8-c1ee-7b10-8ce1-60734a5b2e71） | 教育計分、公平性、累積數學、教師UX | REVISE：2 High、3 Medium | PASS：無剩餘計劃阻礙 |
| Chandrasekhar（01a079c8-c171-76b3-82d2-9fdbf536873c） | 資料、API、權限、匯出與實施可行性 | REVISE：1 High、4 Medium | PASS：無剩餘後端／資料／安全計劃阻礙 |

| Finding | 修訂處置 |
|---|---|
| A1：不同詞義投入令補救學生少分 | §4.1改按合資格完成活動計投入，同詞新補救卡亦計；§4.3加入同活動量配對情境 |
| A2：CURRENT-only未獲使用者接受 | §1/5.1/14明訂為待審閱首版範圍，不承諾跨學年；如需歷史查詢先擴充計劃 |
| A3：缺失資料與部分分數語義 | §5.2分開policy/validation/history狀態、truth table及非下限說明 |
| A4：權重的量尺／重疊不明 | §4.2加入50/50下卡片0.250、成功probe1.250及封頂例子 |
| A5：匯出缺封頂與程度分布 | §7/8.1明列raw/credited、各級歷史作答及封頂日比例分母 |
| B1：讀取已排除本要報告的壞資料 | §5.2先按scope/time讀廣候選，後分類，per-source守恆 |
| B2：timeline無法驗證digest-only選取 | §8所有calls攜完整selectors，重新解析scope並驗證path學生屬報告集合 |
| B3：共用validator不足以符合強provenance承諾 | §5.2固定literal bundle、submittedSense／必要revision／obligation逐項檢查，舊wrapper不變 |
| B4：DTO與null/coverage不明 | §8.1StudentTotal/Day、整scope CoverageSummary、整數分數及CSV欄位映射 |
| B5：preview body不足支持最大IDs | §9全部reward入口128KiB、token byte cap及最大payload端到端測試 |
| B複核非blocking文案：sense dedupe作用範圍 | §5.2明確只用於Cd及廣度；Ld/Pd按活動identity去重 |

兩個PASS均為計劃可交使用者審閱，並非教育參數批准、功能已實作、性能已驗證或部署授權。主agent已處理B的最後文案清晰度建議，無改變已複核的演算法。

### 14.2 使用者審閱時的具體提案

- 每日20次投入活動／5個首次客觀成功詞義，各軸滿分10；老師自由調整兩軸百分比。參數可在實作前修改並同步算例／version。
- 首版只查目前學年；如果需要學年結束後重算舊月份，須先擴充學年選擇及歷史授權計劃。這是目前方案的能力邊界，不由本次review代使用者接受。

其餘已確認需求維持：任選期間、逐日累積、兩軸權重、完整明細匯出；不建立已派分／結算／已匯出排除。

## 15. 本次實際驗證

### 2026-09-07 分支審核修正（已完成；本地回歸，整體環境 gates 仍未通過）

本次只修報告匯出、學生明細錯誤路徑及學號搜尋；不改計分、schema 或部署。沿用本計劃原有 rollout／rollback 及外部 gates。

- [x] CSV 實際 byte limit、XLSX 獨立模型預算；36 人 × 180 日及真正超限回歸。
- [x] A 明細成功後 B 失敗，不顯示 A；保留取消／generation 保護及 render identity guard。
- [x] 合法學號搜尋重用選定學年／班級／有效 enrollment scope。
- [x] 身份欄保留狀態碼字串原值；CSV／XLSX round-trip。
- [x] 單元測試、lint、typecheck 及針對性 UI 回歸，記錄限制。

實際驗證：

- 四個 reward 測試檔：18/18 通過。36×180 報告 CSV／XLSX 可匯出，ExcelJS 重新讀回 6,480 每日列；CSV 精確 32 MiB 通過、超出 1 byte 拒絕，測試包含 BOM、UTF-8、引號及 CRLF。XLSX 模型預算超限會拒絕。
- 身份欄九種狀態碼字串在 CSV／XLSX 重新讀回保持原值，Excel 狀態欄仍有中文標籤。
- 學號回歸直接捕捉 reader 傳給 Prisma 的條件，確認 7／全形前導零、非法學號及選定學年／有效班籍／班級／年級的同一 relation scope；未執行真實 DB integration。
- `PLAYWRIGHT_CHANNEL=chrome node scripts/check-learning-reward-panel.mjs`（PowerShell 以環境變數指定）：3/3 通過。esbuild 編譯實際 React panel，隔離 locale／recent-auth／transport，用 Chrome 驗證 A 成功後 B HTTP 失敗、網絡失敗及回傳錯誤學生 ID 均不顯示 A；沒有登入或資料庫寫入。沙箱的 esbuild 上層路徑讀取受限，測試在獲准 escalated 環境執行；預設 Playwright Chromium 未安裝，改用現有 Chrome。
- `npm run lint`、`git diff --check` 通過。`npm test` 417 中 416 通過，唯一失敗為原有 outbox 測試缺少 `fake-indexeddb`。
- `npx tsc --noEmit` 仍被既有 `fake-indexeddb` 缺件及 Prisma generated client 缺少 `selectionOverrideReason` 阻擋；本次改動無型別錯誤。未重跑 build（同一已知 typecheck 阻礙）、DB／migration、完整登入／學習流程或原生裝置測試。
- 256 MiB 為工作簿模型預算，並非經實測的 peak RSS 保證；最大範圍／managed deployment 的效能驗收仍沿用原計劃 deferred gate。

本次已按使用者批准方案完成本地 implementation；沒有執行DB寫入、migration、production deploy或真實學生pilot。

- 新增 `learning-reward-policy` integer milli-point reducer、歷史 broad reader／coverage、signed scope/cursor、三個 reward routes、共用教師／管理員 panel、CSV／XLSX serializer及相關 request／export tests；既有 current analytics reader保持不改口徑。
- `node --import tsx --test src/lib/learning-reward-policy.test.ts src/lib/learning-reward-request.test.ts src/lib/learning-reward-export.test.ts src/lib/learning-reward-analytics.test.ts`：13 tests通過（含10.8算例、每日封頂、重疊雙軸、權重、null／zero、legacy candidate guard、request context、CSV三位小數、XLSX三工作表及milli-point可加性）。
- `npm run lint`：通過，無 warning。
- `npm test`：412 tests中411通過；唯一失敗為既有 `src/lib/study-stream-outbox.test.ts` 缺少 `fake-indexeddb` module，與本功能無關；i18n source-copy regression通過。
- `npx tsc --noEmit`及`npm run build`：新 reward檔案／route已編譯；整體仍被既有 `fake-indexeddb`及`src/lib/study-stream/server.ts`的`selectionOverrideReason`／generated schema mismatch阻擋，未因本功能新增錯誤。
- `git diff --check`：通過。未執行DB fixture／relation cleanup／revocation race、已登入Playwright／native mobile-a11y、容量／性能及migration tests；這些仍是本計劃後續Gate，production／pilot保持deferred。
- 兩個獨立、平行 read-only implementation reviewers已於本次實作後啟動；首輪發現的 legacy candidate、winner bucket、coverage 可解釋性、取消競態、程度／樣本／封頂資料及讀屏語義問題已修正；最終靜態複核結果見下。

### 15.1 實作後兩路獨立複核

| Reviewer | 最終靜態結果 | 未完成但不屬靜態 blocking defect 的 gate |
|---|---|---|
| Hume（01a07a0e-08b8-7541-a68d-d52e9caf1a00） | PASS；確認 candidate、Cd first-result、coverage、取消競態、三項 cumulative、`NOT_GUARANTEED` 及 table/a11y 結構修正 | DB candidate／first-result fixture、browser race、axe／screen-reader、性能、完整 export round-trip |
| Locke（01a07a0e-0d0e-7a82-952d-63e5ded73649） | PASS；確認 fixed bundle、scope／revocation、cursor composite key、export level counts、錯誤映射及無 per-student event sort | DB EXPLAIN、p95／RSS、大資料量性能、DB-backed撤權／Cd fixture、API／browser／export round-trip |

兩位 reviewer 均未改檔、未執行資料庫寫入或 migration。PASS 只代表目前工作樹的靜態 implementation review；不把未執行的DB、瀏覽器、容量／性能或production gate當成已通過。

### 15.2 2026-09-07 P2 審核修正（已完成本地修正；外部 gates deferred）

本輪針對本地審核發現的學年日期 DTO、panel 非同步狀態及 reward candidate coverage 修正；不改 schema、計分政策或授權邏輯，亦不執行 DB 寫入。

- [x] `/api/teacher/classes` 讀取並輸出目前學年的 startsOn／endsOn，以 Asia/Shanghai `YYYY-MM-DD` 日曆日期 DTO 傳遞，panel 預設學年年初至今天。
- [x] locale 變更及非同步 classes 載入不重設使用者已選日期；已有 query 的 scope token／結果不因相同條件重載而被清掉。
- [x] reward reader 不在分類前跳過全空欄位的普通 `REVIEW`；所有 raw candidate 按 policy bucket 分類，明確 historical／legacy 才列 policyExcluded，空 provenance 列 validation gap。
- [x] 更新 panel browser checker 使用完整 classes DTO，驗證學年預設、日期選擇跨 locale 保留，並保留三項 timeline 錯誤回歸。
- [x] 新增 reducer regression：普通 null-marker `REVIEW` + StudyDay 為 candidateCount=1、validationGap=1、`INCOMPLETE`、history 非 `KNOWN_GAP` 且分數為 0；historical 全空列 policyExcluded；入籍前列 outsideEligibility 且不污染 validation。

實際驗證：

- `node --import tsx --test src/lib/teacher-workspace.test.ts src/lib/learning-reward-analytics.test.ts src/lib/learning-reward-policy.test.ts src/lib/learning-reward-request.test.ts src/lib/learning-reward-export.test.ts`：24/24 通過；包含 API DTO 的 Shanghai 日期轉換、普通 null-marker REVIEW／historical／入籍前 candidate bucket、0 分及 StudyDay coverage regression。
- `npm test`：420/420 通過（包含本輪 teacher workspace、reward reducer 及既有 timeline 回歸）。
- `npm run lint`：通過；`npx tsc --noEmit --incremental false`：通過；`git diff --check`：通過。
- `PLAYWRIGHT_CHANNEL=chrome node scripts/check-learning-reward-panel.mjs`：3/3 通過；browser harness 使用完整 classes DTO，驗證學年開始至今日預設、手動日期跨 locale 保留，以及 A 成功後 B 的 HTTP／network／wrong-student 三項 timeline 錯誤回歸。因 browser sandbox 權限限制以既有 Chrome 及 escalated local run 執行，沒有 DB 寫入。
- `npm run build`：由主 agent 以 escalated local run 通過；初次 sandbox bind 權限錯誤不屬程式錯誤。
- read-only local PostgreSQL smoke：確認 `/api/teacher/classes` context 的兩個學年日期與 DB 日曆值一致；一名現有學生以學年內一日範圍查詢，query／timeline／export totals 與每日分數加總一致；沒有 DB 寫入。

本輪仍未執行完整 DB fixture／撤權競態、全登入／原生 accessibility matrix、容量／性能、production deploy、真實學生 pilot 或 destructive migration；沿用原計劃 deferred gate。
