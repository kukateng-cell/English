# 英語詞庫編寫、匯入及質量檢查標準 v1

> 文件類型：內容團隊規範／CSV data contract
>
> 規範版本：`word-catalog-v1`
>
> 狀態：現行 v1 內容規範；已加入 bootstrap 與日常治理 CSV 模式
>
> 日期：2026-08-24
>
> 適用範圍：A1／A2／B1／B2 英語認讀詞庫、批量草稿提交、重複與衝突檢查、審核、啟用及停用
>
> 對應實施計劃：[word-catalog-governance-and-lifecycle.md](../word-catalog-governance-and-lifecycle.md)
>
> A1 參考 CSV：[a1-word-catalog-reference-v1.csv](../../outputs/a1-word-catalog-reference-v1/a1-word-catalog-reference-v1.csv)
>
> A2 參考 CSV：[a2-word-catalog-reference-v1.csv](../../outputs/a2-word-catalog-reference-v1/a2-word-catalog-reference-v1.csv)

> B1 參考 CSV：[b1-word-catalog-reference-v1.csv](../../outputs/b1-word-catalog-reference-v1/b1-word-catalog-reference-v1.csv)

> B2 參考 CSV：[b2-word-catalog-reference-v1.csv](../../outputs/b2-word-catalog-reference-v1/b2-word-catalog-reference-v1.csv)

## 1. 文件目的

本文件供詞庫內容團隊、英文老師、審核人員及開發者共同使用，目標係令多人製作嘅詞庫可以：

- 使用一致欄目、格式及教育語義；
- 正確表達同一英文喺不同程度出現嘅不同詞義；
- 為英譯中及中譯英分別提供 5–6 個已人工選定嘅干擾項候選池；
- 自動發現重複詞、重複詞義、欄位衝突、正解碰撞及跨詞義干擾項問題；
- 經草稿、審核、啟用及停用流程逐步完善；
- 保留既有學習、題目、統計及審核歷史，不以刪除資料作日常管理方法。

本標準把「內容編寫」同「系統識別碼／權限／審核狀態」分開。內容團隊只需要處理有教育意義嘅欄目；`catalog_key`、
`sense_key`、revision、審核人及時間等資料由系統管理。

## 2. 規範用語

本文件使用以下強度：

- **必須**：不符合便係阻擋錯誤，不能啟用；
- **條件必須**：指定條件成立時必須填寫；
- **建議**：可以留空，但審核人應檢查是否合理；
- **系統欄目**：內容團隊不得自行創作或修改，新資料留空；
- **禁止**：即使 CSV 可以解析，仍不可接受或啟用。

## 3. 核心資料模型：一行代表一個詞義

### 3.1 三個層次

詞庫唔以「一串英文等於一個中文解釋」處理，而係分成三個概念：

1. **詞目／Lexeme**：同一個基本英文詞或固定詞組，例如 `run`；
2. **詞義／Sense**：某個程度真正要學嘅意思，例如 A1「跑步」或 B1「經營」；
3. **題目方向／Direction**：英譯中及中譯英各自有獨立正確答案及干擾項候選池；題幹直接由詞義資料衍生，唔另寫 prompt。

同一詞目可以有多個詞義；每個詞義係獨立學習、複習及掌握單位。學生掌握 A1 `run = 跑步`，不代表已掌握
B1 `run = 經營`。

### 3.2 同義中文與不同詞義嘅分界

- `definition_zh` 只放一個 canonical 顯示答案；同一詞義其他合理中文表達放入 `accepted_answers_zh`，例如
  `definition_zh=快速的`、`accepted_answers_zh=迅速的`；
- 使用情境或核心概念明顯不同，必須分成兩行，例如 `run = 跑步` 同 `run = 經營`；
- 同一詞義只可以有一個首次引入程度。完全相同嘅 `run = 跑步` 不得因再次複習而複製到 A2；
- 同一英文喺較高程度出現新意思，應新增詞義行，而唔係覆蓋較低程度嘅舊意思。

### 3.3 `run` 正式示例

| term | lemma | part_of_speech | level | definition_zh |
|---|---|---|---|---|
| run | run | verb | A1 | 跑步 |
| run | run | verb | B1 | 經營 |

測驗每次只考一個 `sense_key`，而且唔顯示額外 prompt、搭配或例句：

- 英譯中只顯示 `term`，例如 `run`；A1「跑步」題目嘅所有中文干擾項都不得包含「經營」，B1「經營」題目亦不得包含「跑步」；
- 中譯英只顯示該行 `definition_zh`，例如「跑步」或「經營」，正確選項係 `run`；
- `example_en`／`example_zh` 只供 Learning Card、詞義詳情及老師審核，禁止喺 scored Objective Probe 顯示。

詞表／詳情頁可以將多個詞義按程度分組顯示，但 Learning Card 同 Objective Probe 每次只指向一個 `sense_key`。英文裸字本身有
多義並唔構成錯誤；合格條件係最終四個選項只有一個可接受答案，而且同一英文其他詞義嘅答案一律不得成為干擾項。

## 4. CSV 檔案格式

### 4.1 檔案級規則

- 檔案格式必須係 CSV，編碼為 UTF-8；為兼容 Excel，可以包含 UTF-8 BOM；
- 第一行必須係相應模式指定嘅英文欄名及固定次序，不可自行翻譯、合併、改名、移動或加入同名欄；
- 每一行只可以代表一個詞義；不可用合併儲存格、顏色、批註或公式表達必要資料；
- CSV 內含逗號、雙引號或換行嘅值必須按標準 CSV 規則加雙引號；欄內雙引號以 `""` 表示；
- Boolean 只接受大寫 `TRUE` 或 `FALSE`；程度只接受 `A1`、`A2`、`B1`、`B2`；
- 所有輸入會先作 Unicode NFKC、首尾空白移除及連續空白合併；原始顯示字形另行保留；
- 不可包含 spreadsheet formula。任何非內容欄以 `=`、`+`、`-` 或 `@` 開頭都會被拒絕或安全轉義；
- 不可放 password、學生姓名、學生帳號、聯絡資料或其他個人資料；`contributor_ref` 只用團隊編號；
- 從匯出檔更新既有資料時，必須保留 `catalog_key`、`sense_key` 及 `record_revision`；不可自行重新編號；
- 初始建庫同日常治理係兩個明確模式，action 值不可混用；詳細 contract 見下節；
- 檔案缺少某個既有詞義不代表停用；匯入器永遠不得以「CSV 冇呢行」自動刪除或停用資料。

### 4.1.1 Bootstrap 與日常治理模式

| 模式 | 用途 | `requested_action` | key／revision／status | 會否直接改正式詞庫 |
|---|---|---|---|---|
| Bootstrap | 開發期由完整 A1–B2 canonical CSV 重建本地／新環境基線 | 固定 `CREATE_DRAFT` | 由 converter／seed contract 管理 | 只可經受控 seed／reconciliation；不可用老師上載 API |
| Governance CREATE | 老師／內容團隊日常新增一個詞義 | 固定 `CREATE` | `catalog_key`、`sense_key`、`record_revision`、`catalog_status` 必須留空 | 不會；先建立 preview，再提交草稿及由另一位授權老師審核 |
| Governance UPDATE | 修改現有詞義內容 | 固定 `UPDATE` | 必須完整保留系統匯出的四項只讀 metadata | 不會；批准及 finalization 後先建立新 approved revision |

日常治理 template 由工作區下載；UPDATE 必須先在工作區選取現有 `sense_key` 再匯出，不能抄另一行或自行編 key。Launch 每檔最多
200 個 data rows、4 MiB，嚴格 UTF-8，可有一個檔首 BOM。老師工作區下載／匯出使用 34 欄乾淨 view；34欄必須各出現一次並保持
模板原有次序，不能移動、加入未知欄或重複欄。普通governance upload只接受精確34欄；完整39欄只可交由受控bootstrap／migration
工具處理，老師endpoint固定拒絕。空檔、broken quoting、NUL／control character、embedded BOM及公式開頭會在preview前拒絕。

治理上載只支援 `CREATE`／`UPDATE`；停用與重新啟用繼續使用逐條工作流。CSV 缺行永遠不代表停用。相同內容 UPDATE 會標示
`NO_CHANGE` 並排除；已有待審申請、stale revision、identity 衝突或 validation error 會阻擋提交。Preview 不會改 `WordSense`、
approved revision 或學生 runtime；整批提交及最後套用各自保持原子性，批次內批准／拒絕決定及歷史永久保存。

### 4.2 完整39欄bootstrap次序

```text
schema_version,requested_action,catalog_key,sense_key,record_revision,catalog_status,term,lemma,part_of_speech,level,category,definition_zh,accepted_answers_zh,prompt_en,prompt_zh,phonetic_ipa,example_en,example_zh,accepted_forms_en,synonyms_en,antonyms_en,enable_en_to_zh,distractor_zh_1,distractor_zh_2,distractor_zh_3,distractor_zh_4,distractor_zh_5,distractor_zh_6,enable_zh_to_en,distractor_en_1,distractor_en_2,distractor_en_3,distractor_en_4,distractor_en_5,distractor_en_6,source_reference,contributor_ref,change_note,retirement_reason
```

欄目次序係正式template contract；受控bootstrap parser同老師governance parser均要求各自模板嘅完整固定次序。未知、缺少、
重複或移動欄目必須拒絕，不能靜默忽略或以另一欄位置繼續處理。

Bootstrap canonical CSV及受控migration工具繼續使用以上39欄；舊governance CSV必須先由受控轉換工具轉成34欄，唔可以直接上載老師endpoint。老師工作區嘅CREATE template同UPDATE export使用以下
34 欄乾淨 view，避免要求老師處理永遠留空或由系統 audit 取代嘅欄：

```text
schema_version,requested_action,catalog_key,sense_key,record_revision,catalog_status,term,lemma,part_of_speech,level,category,definition_zh,accepted_answers_zh,phonetic_ipa,example_en,example_zh,accepted_forms_en,synonyms_en,antonyms_en,enable_en_to_zh,distractor_zh_1,distractor_zh_2,distractor_zh_3,distractor_zh_4,distractor_zh_5,distractor_zh_6,enable_zh_to_en,distractor_en_1,distractor_en_2,distractor_en_3,distractor_en_4,distractor_en_5,distractor_en_6,retirement_reason
```

乾淨view省略 `prompt_en`、`prompt_zh`、`source_reference`、`contributor_ref`、`change_note`。省略不代表刪除資料模型：UPDATE會以目前
approved／latest revision為底，只覆蓋34欄可編輯內容，因此三個provenance／change-note欄會原值保留，prompt則繼續維持server-owned空值；
CREATE的隱藏欄由server預設或獨立流程處理。正式提交者、批次、理由及審核紀錄由登入actor、batch note、change request同audit保存。

## 5. 欄目總表

| 欄目 | 類型 | 誰填寫 | 啟用前要求 | 意義 |
|---|---|---|---|---|
| `schema_version` | enum | 團隊／template | 必須 | 固定填 `word-catalog-v1` |
| `requested_action` | enum | 團隊／老師 | 必須 | Bootstrap 固定 `CREATE_DRAFT`；日常治理只接受 `CREATE` 或 `UPDATE`；停用／重啟只經授權 UI／API |
| `catalog_key` | string | 系統 | 新增留空；更新必須保留 | 同一詞目嘅穩定識別碼；多個 `run` 詞義共用同一 key |
| `sense_key` | string | 系統 | 新增留空；更新必須保留 | 單一詞義／學習項目嘅穩定識別碼 |
| `record_revision` | positive integer | 系統 | 更新既有資料時必須 | 防止舊 CSV 覆蓋較新修改 |
| `catalog_status` | enum | 系統／審核人 | 系統管理 | `DRAFT`、`ACTIVE` 或 `RETIRED`；一般貢獻者不可直接改 |
| `term` | string | 團隊 | 必須 | 學生看到或中譯英要選嘅標準英文形式 |
| `lemma` | string | 團隊／系統 | 必須 | 字典基本形式；一般預設等於 `term` |
| `part_of_speech` | enum | 團隊 | 必須 | 呢一個詞義嘅詞性，不係整個拼寫共用一個詞性 |
| `level` | enum | 團隊提出、老師審核 | 必須 | 呢一個詞義第一次正式引入嘅 A1／A2／B1／B2 程度 |
| `category` | enum | 團隊／工作包 | 必須 | 主要主題分類；只可選本規範清單 |
| `definition_zh` | string | 團隊 | 必須 | 呢一個詞義嘅繁體中文（香港用語）canonical 顯示答案；只填一個答案 label |
| `accepted_answers_zh` | list | 團隊／審核人 | 選填 | 同一詞義下亦合理嘅其他中文答案；以 `|` 分隔，只作碰撞檢查 |
| `prompt_en` | reserved | 不填寫 | 必須留空 | v1 相容保留欄；唔係題幹，匯入器拒絕非空值，runtime 不得讀取或顯示 |
| `prompt_zh` | reserved | 不填寫 | 必須留空 | v1 相容保留欄；唔係題幹，匯入器拒絕非空值，runtime 不得讀取或顯示 |
| `phonetic_ipa` | string | 團隊 | 建議 | 該詞義／讀音嘅 IPA，不包含外層 `/ /` |
| `example_en` | string | 團隊 | 多義、非字面或易混詞條件必須 | 年齡及程度合適、能證明目標詞義嘅英文例句 |
| `example_zh` | string | 團隊 | 有 `example_en` 時條件必須 | 對應例句翻譯，不增加原句冇有嘅意思 |
| `accepted_forms_en` | list | 團隊／審核人 | 選填 | 可接受拼寫／形態，例如英美拼寫；以 `|` 分隔 |
| `synonyms_en` | list | 團隊／審核人 | 選填 | 呢一個詞義嘅英文近義詞；以 `|` 分隔 |
| `antonyms_en` | list | 團隊／審核人 | 選填 | 呢一個詞義嘅英文反義詞；以 `|` 分隔 |
| `enable_en_to_zh` | boolean | 團隊提出、老師審核 | 必須 | 是否允許英譯中 Objective Probe |
| `distractor_zh_1`…`6` | string | 團隊 | 方向啟用時第 1–5 項必須，第 6 項選填 | 5–6 個已人工確認適合嘅中文候選干擾項 |
| `enable_zh_to_en` | boolean | 團隊提出、老師審核 | 必須 | 是否允許中譯英 Objective Probe |
| `distractor_en_1`…`6` | string | 團隊 | 方向啟用時第 1–5 項必須，第 6 項選填 | 5–6 個已人工確認適合嘅英文候選干擾項 |
| `source_reference` | string | 團隊／審核人 | 選填；引用外部材料時條件必須 | 可留空；如內容直接改編自課本、校本材料或獲准來源，先填可追溯代碼 |
| `contributor_ref` | string | 系統／統籌人 | 選填 | CSV 可留空；正式匯入以登入 actor／batch audit 為準，需要離線分工先使用非個人資料團隊編號 |
| `change_note` | string | 系統／老師 | `CREATE_DRAFT` 可留空；修改已批准內容時由受控流程記錄 | CSV 參考詞表不需填；正式修改原因保存於 change request／audit |
| `retirement_reason` | string | 老師／審核人 | 申請停用時條件必須 | 可審計嘅停用原因；不可只填「唔要」 |

## 6. 各內容欄目詳細標準

### 6.1 `term`

- 必須係學生要識別或選擇嘅標準英文形式，最多 120 個 Unicode 字元；
- 一般單詞使用正確慣常大小寫；普通詞用小寫，專有名詞及縮寫按慣例；
- 動詞原則上用原形、可數名詞原則上用單數；固定詞組及 phrasal verb 保留完整形式；
- 不可將多個答案寫成 `run/running/ran`；其他可接受形式放入 `accepted_forms_en`；
- 不可加入編號、程度、中文解釋或教學備註。

### 6.2 `lemma`

- 表示字典基本形式，用於將變化形及多個詞義歸組；最多 120 字元；
- 一般情況 `lemma = term`，匯入器可在留空時自動複製 `term`；
- `ran`、`running` 如被獨立展示，lemma 仍為 `run`；`run out` 呢類固定 phrasal verb 以完整詞組作 lemma；
- `lemma` 只負責歸組，不能用來區分 A1／B1 詞義；詞義由 `sense_key` 分開。

### 6.3 `part_of_speech`

只接受以下小寫值：

```text
noun,verb,adjective,adverb,pronoun,determiner,preposition,conjunction,
interjection,auxiliary,modal,numeral,particle,phrasal_verb,phrase,
proper_noun,abbreviation,other
```

- 每行只填一個主要詞性；同一拼寫用作 noun 同 verb 時分成不同詞義行；
- `other` 只可在其他值確實不適用時使用，並由提交／審核流程記錄理由；
- 詞性屬於詞義。例如 `record` 名詞同動詞可以有不同音標、程度及解釋。

### 6.4 `level`

- 只接受 `A1`、`A2`、`B1`、`B2`；
- 程度描述嘅係「呢一個詞義」首次要求學生掌握嘅階段，不係字母串本身嘅唯一程度；
- 完全相同詞義由兩人填成不同程度時屬衝突，不能自動保留最低或最高級別；
- 同一詞義只有一個 level；決定次序係「校本課程首次引入 → 獲准教材 → CEFR／詞頻證據 → 審核老師具理由判斷」；
- 新增高階詞義不覆蓋低階詞義，亦不繼承低階詞義嘅掌握狀態；
- 最終程度由有詞庫審核權限嘅英文老師確認。

### 6.5 `category`

v1 只接受以下穩定代碼：

```text
greetings-social
people-family
numbers-quantity
time-calendar
body-health
food-drink
clothing-appearance
home-household
school-education
work-business
places-community
travel-transport
nature-weather
animals-plants
sports-leisure
arts-culture-media
technology
science-mathematics
society-law-politics
emotions-personality
communication-language
actions-events
descriptions-qualities
abstract-concepts
function-words
other
```

- 每個詞義只指定一個主要 category；
- 團隊應使用工作包預先分配嘅 category，禁止自行創作大小寫或近義變體；
- 選擇 category 時以該 sense 嘅主要教學語境為準，而唔係英文拼寫所有可能用途；優先選最具體分類，再選較廣分類；仍有兩個合理選項時標示 warning，由審核老師決定；
- CSV template 配套說明必須提供每個代碼嘅中文標籤及使用提示；
- 使用 `other` 必須在提交／審核流程解釋，由審核人決定係保留、改分類或日後擴充 taxonomy；
- 舊 Markdown 嘅大量自由文字分類必須先經 mapping，不能原樣當成新 category code。

分類提示如下；例子只用來劃界，唔係完整詞表：

| code | 主要教學語境／例子 |
|---|---|
| `greetings-social` | 問候、介紹、禮貌社交，例如 `hello`、`thank` |
| `people-family` | 人物身份、家庭及關係，例如 `parent`、`friend` |
| `numbers-quantity` | 數字、數量、度量，例如 `hundred`、`many` |
| `time-calendar` | 時間、日期、頻率，例如 `Monday`、`often` |
| `body-health` | 身體、疾病、健康照護，例如 `ankle`、`fever` |
| `food-drink` | 食物、飲品、煮食及用餐，例如 `rice`、`boil` |
| `clothing-appearance` | 衣著、外貌及穿戴，例如 `jacket`、`wear` |
| `home-household` | 家居空間、家具及家務，例如 `kitchen`、`sweep` |
| `school-education` | 學校、科目及學習活動，例如 `lesson`、`revise` |
| `work-business` | 職業、公司及商業活動，例如 `manager`、`profit` |
| `places-community` | 社區地方及公共設施，例如 `library`、`district` |
| `travel-transport` | 旅程、方向及交通工具，例如 `journey`、`platform` |
| `nature-weather` | 自然環境、地貌及天氣，例如 `storm`、`river` |
| `animals-plants` | 動物、植物及生物種類，例如 `insect`、`root` |
| `sports-leisure` | 運動、遊戲、嗜好及消閒，例如 `coach`、`chess` |
| `arts-culture-media` | 藝術、文化、娛樂及媒體內容，例如 `novel`、`actor` |
| `technology` | 裝置、軟件、網絡及數碼系統，例如 `browser`、`upload`；`email` 如重點係溝通功能可歸 `communication-language` |
| `science-mathematics` | 科學概念、實驗及數學，例如 `gravity`、`fraction` |
| `society-law-politics` | 社會制度、法律、公民及政治，例如 `election`、`crime` |
| `emotions-personality` | 情緒、態度及性格，例如 `anxious`、`honest` |
| `communication-language` | 語言、訊息、對話及表達，例如 `reply`、`translate` |
| `actions-events` | 難以歸入具體主題嘅一般動作、過程及事件，例如 `happen`、`carry` |
| `descriptions-qualities` | 一般外觀、狀態及性質，例如 `smooth`、`narrow` |
| `abstract-concepts` | 想法、價值、關係及抽象概念，例如 `reason`、`freedom` |
| `function-words` | 冠詞、代詞、介詞、連接詞等語法功能詞，例如 `although`、`between` |
| `other` | 只有以上全部不適用時使用，並附書面理由 |

### 6.6 `definition_zh`

- 以繁體中文及香港學校常用表達作 canonical；簡體顯示由系統轉換，團隊不維護兩份答案；
- 最多 200 字元，應簡潔、自然、符合指定詞性及程度，而且只包含一個 canonical 顯示答案；
- 同一詞義嘅其他合理中文答案放入 `accepted_answers_zh`，不可用分號塞入 `definition_zh`；
- 不可將不同程度或不同用法硬塞入同一格，例如禁止 `跑步；經營；運作` 作為 A1 `run` 答案；
- 不可使用目標英文作中文解釋、不可加入例句、詞性、括號長篇說明或來源文字；
- 從外部字典參考時要重新寫成簡短校本釋義，不可直接大量抄錄受版權保護內容。

### 6.7 題幹衍生規則及 `prompt_en`／`prompt_zh` 保留欄

- Objective Probe 唔接受內容團隊自訂 prompt；`prompt_en` 及 `prompt_zh` 只為已產生嘅 v1 CSV 保持欄位相容，所有行必須留空；
- 匯入器遇到兩欄任何非空值都要報 blocking error，資料庫新模型毋須保存 prompt，runtime 亦不得讀取或顯示；
- 英譯中顯示題幹固定等於該 sense 嘅 `term`，正確選項固定取 `definition_zh`；
- 中譯英顯示題幹固定等於該 sense 嘅 `definition_zh`，正確選項固定取 `term`；
- 題目所考詞義只由 server-issued `sense_key` 決定；唔以額外句子、搭配、例句或畫面提示協助學生判斷；
- 多義詞以「分開 sense 行＋排除其他 sense 正解」處理，唔靠 prompt 消歧義；
- 如果中文題幹即使配合 curated final options 仍可能有多個合理英文正解，應補完整 `accepted_forms_en`／`synonyms_en`、更換干擾項，或者把
  `enable_zh_to_en` 設為 `FALSE`，唔可以加入提示句補救。

### 6.8 `phonetic_ipa`

- 使用 IPA，唔包括外層斜線，例如填 `rʌn` 而唔係 `/rʌn/`；
- 不確定時留空，禁止以普通英文字母自行猜寫音標；
- 有明顯詞性讀音差異時，每個詞義行填對應讀音；
- 英美讀音差異暫以校本採用讀音為主，其他讀音可在後續內容版本擴充，唔用逗號混合多套標記。

### 6.9 例句

- `example_en` 必須自然、完整、無個人資料、無冒犯內容，而且清楚使用目標詞義；最多 500 字元；
- 多義詞、phrasal verb及非字面意思啟用前必須有例句，供學習及審核確認詞義；
- `example_zh` 必須對應英文原意，最多 500 字元；
- 例句不可直接複製未獲授權題庫、出版物或商業字典；引用或改編外部材料時先填可追溯來源代碼；
- 例句唔作 Objective Probe 題幹或干擾項候選池，亦禁止喺 scored Objective Probe 顯示。

### 6.10 list 欄目

`accepted_answers_zh`、`accepted_forms_en`、`synonyms_en`、`antonyms_en` 使用半形直線 `|` 分隔，例如：

```text
colour|color
```

- 每項 trim 後不可為空，不可包含 `|`；
- 同一欄 normalization 後不可重複；
- `accepted_forms_en` 只放真正可接受嘅答案形式；
- `accepted_answers_zh` 只放同一 sense 下可接受、但唔作 canonical 顯示 label 嘅中文答案；
- synonyms／antonyms 必須對應該行詞義，唔係同一 lemma 其他意思；
- 呢啲欄會用於質量檢查，避免將可接受形式或近義正解放入干擾項。

系統必須為兩個方向建立 versioned `normalized_answer_set`：

- 英譯中：`definition_zh` + `accepted_answers_zh`；
- 中譯英：`term` + `accepted_forms_en` + 該 sense 嘅 `synonyms_en`；
- 每題畫面只顯示一個 canonical correct option；其餘可接受答案只作碰撞檢查，不會同時顯示成多個正確按鈕；
- 「唯一正解」指 final options 入面只得一個可接受選項，唔係宣稱自然語言只有一個全球唯一譯法。

### 6.11 來源、貢獻及變更說明

- 參考／示範 CSV 可以將 `source_reference`、`contributor_ref`、`change_note` 全部留空；三欄都唔係詞義內容或學生畫面資料；
- 只有直接引用或改編外部材料時，`source_reference` 先係條件必須；最多 240 字元，使用 `school-material:<code>`、
  `textbook:<code>:<unit>`、`licensed:<code>` 或 `public-domain:<reference>` 等可追溯代碼，唔填網址或籠統「網上」；
- `contributor_ref` 最多 40 字元，只可用統籌人分配嘅字母、數字、`-`、`_`，不可用真名、學號或電郵；正式系統以登入 actor 及 import batch audit 為準；
- `change_note` 喺 `CREATE_DRAFT` 可以留空；修改 approved 內容時，理由由受控 change request／audit UI 收集；老師34欄CSV view不會匯出此欄，UPDATE會保留目前revision值；普通老師endpoint唔接受39欄內容，任何受控migration值亦唔可取代正式audit理由；
- `retirement_reason` 最少 10、最多 500 字元，必須指出不適合原因及一般／緊急處理建議；
- 匯入器可以保存登入 actor 身份作 audit，但 CSV 本身不可承載個人資料。

## 7. 干擾項及出題標準

### 7.1 直接候選池原則

每個已啟用方向必須由內容團隊提供 5–6 個已確認適合嘅候選干擾項；第 1–5 項必填，第 6 項可留空：

- 英譯中使用 `distractor_zh_1` 至 `distractor_zh_6`；
- 中譯英使用 `distractor_en_1` 至 `distractor_en_6`；
- 出題時 server 只會由該方向 5–6 個非空候選項按可審計 seed、無放回抽三個，再加入正確答案並重新排列；
- 系統不會臨場由其他單詞自動推算、補充或交換干擾項；
- 每題實際選項及順序寫入 immutable question snapshot，之後修改詞庫不會改變已發出題目。

系統在審核／匯入時仍會作結構性檢查，目的係阻止錯誤資料啟用，而唔係替老師重寫候選池。

### 7.2 候選項嘅合格標準

每個候選項必須：

- 同正確答案使用相同語言；
- normalization 後同完整 `normalized_answer_set` 及同池其他候選項不同；
- 喺目前題目嘅完整選項集合入面明確錯誤；
- 不屬於 `accepted_forms_en` 或該詞義嘅可接受中文表達；
- 不係同一答案嘅大小寫、單複數、拼寫變體或純標點變體；
- 程度、長度、詞性或語義類型大致合理，令題目有辨識價值；
- 不可以明顯荒謬、含冒犯內容、靠格式突出，或因長度差異直接洩露正解；
- 由人手逐項確認，不能只因自動工具產生便視為合格。

多義詞另有以下硬性跨行規則：

- 英譯中候選池除咗唔可以撞目前 sense 嘅 `definition_zh`／`accepted_answers_zh`，亦唔可以包含同一 normalized `term`／lemma 其他
  sense 嘅任何 canonical 或 accepted 中文答案；
- 例如 `run = 跑步` 嘅六個中文候選干擾項不得有「經營」，而 `run = 經營` 嘅候選池亦不得有「跑步」；
- 中譯英候選池不得包含目前 sense 嘅 `term`、`accepted_forms_en`、`synonyms_en`，亦不得放入審核人認為係該中文題幹合理正解嘅其他英文；
- 呢啲檢查要對整份 CSV 及資料庫現有同詞目 senses 一併執行，唔可以只驗證單行。

如果某方向無法提供至少五個無歧義干擾項，應將該方向設為 `FALSE`。第六項質量不足時必須留空；禁止填入明知不適合嘅內容只為湊數。

整批詞表亦要檢查候選池多樣性，避免只調亂次序但實際重用同一模板：

- 同一 level、同一方向嘅兩行，不得擁有「不計欄位次序後完全相同」嘅完整候選池；此情況屬 blocking error；
- 同一 category、同一方向嘅任何兩行，如六個候選中重複五個或六個，屬 blocking error；重複四個要列為 warning 並由老師確認；
- 質量報告要同時計算有序 signature、不計次序 signature、同 category pair overlap 及每個候選項曝光次數；不得以欄位重新排序冒充多樣化；
- 降低重複時仍要保留相同語言、合理詞性及語義距離；不可為追求數字上獨特而加入明顯荒謬或完全無關候選項。

### 7.3 出題失敗處理

- 已啟用方向若資料不足、重複、撞正解、撞同詞其他詞義或令 final options 出現多個合理答案，該詞義不得成為 scored Objective Probe；
- 系統必須 fail closed：保留待驗證工作或選擇其他合法項目，不能將無效題目當成學生答錯；
- 題目方向只可以從該詞義啟用嘅方向中選擇；兩個方向都係 `FALSE` 嘅詞義不能啟用。

## 8. 系統識別碼及 revision

### 8.1 `catalog_key`

- 由系統產生，代表同一詞目／lemma 組；內容團隊新建資料時留空；
- 同一 `run` 嘅 A1「跑步」同 B1「經營」原則上共用同一 `catalog_key`；
- 修改大小寫、解釋、程度或 typo 不會令 key 改變；
- 不使用 row number、Excel 行號或可變 `term` 作永久 key。

### 8.2 `sense_key`

- 由系統產生，代表一個穩定詞義及學習項目；
- 學生 Review、Objective Evidence Target、題目 snapshot、統計及審核歷史最終都以詞義身份關聯；
- 純 typo、標點或不改語義嘅修正保留同一 `sense_key` 並增加 revision；
- level、category、方向設定、例句或干擾池修正本身唔會建立新 sense；只要核心詞義及使用條件不變，就保留原 `sense_key`，經新 approved revision 生效；
- 將「跑步」改成「經營」屬實質改義，禁止重用原 sense；應停用舊 sense 並新增一個 sense。

### 8.3 `record_revision`

- 新資料留空，由系統建立第一版；
- 匯出既有資料後再修改，必須連同原 revision 提交；
- 如果資料庫已有較新 revision，舊 CSV 提交會產生 `STALE_REVISION` 衝突，不會 last-write-wins；
- 修改 ACTIVE sense 只會建立獨立 proposal／immutable candidate revision，不能原地覆寫目前 approved revision，亦不能令已批准內容暫時消失；
- proposal 必須引用 `base_approved_revision` 或等效 digest；解決衝突時要重新取得最新資料、合併內容，再由批准交易以 CAS 切換 approved revision pointer。

## 9. 重複、衝突及完整詞表檢查

### 9.1 Normalization

重複檢查使用 canonical 比較值，但不破壞審核後顯示內容：

- 英文：NFKC、trim、合併空白、英文 case-fold；智能 apostrophe 及 dash 另作比較形式；
- 中文：NFKC、trim、合併空白、統一常見標點，並轉為 canonical 繁體作比較；
- list／干擾項：逐項採用同一 normalization；
- 系統必須同時保存原顯示值及 normalized key，唔可以只靠前端檢查。

### 9.2 四類 fingerprint

| Fingerprint | 組成 | 用途 |
|---|---|---|
| Headword | normalized `lemma` | 將兩位貢獻者提交嘅 `run` 放入同一審核組 |
| Exact sense | normalized lemma + POS + normalized `definition_zh` | 發現相同詞義被重複製作 |
| Question | direction + normalized derived stem + normalized correct answer | 發現同一顯示題幹／正解組合重複；同 stem 不同 sense 進跨詞義選項檢查 |
| Content digest | 所有規範內容欄目 | 判斷完全相同、只改 metadata 或真正內容改動 |

Level 同 category 不放入 exact-sense fingerprint，因為兩個人將同一詞義分成 A1／B1 應該被發現為程度衝突，而唔係被當成兩個合法詞義。

### 9.3 阻擋錯誤

以下任何一項存在時，資料不能提交為 ACTIVE：

- 缺少必填欄、enum／Boolean／長度格式錯誤；
- 同一 `sense_key` 對應兩組不同內容，或同一 `catalog_key` 出現不合理 lemma 衝突；
- Bootstrap `CREATE_DRAFT` 或治理 `CREATE` 填咗任何 key／revision／status，或者治理 `UPDATE` 缺 stable keys／expected revision；
- 一般匯入嘗試直接設定／改寫 `catalog_status`、approved revision、審核人或審核時間；
- exact-sense fingerprint 重複而未合併；
- 同一方向少於五個或多於六個非空干擾項、重複，或同完整 `normalized_answer_set` 相交；
- `prompt_en`／`prompt_zh` 任何一欄非空；
- 英譯中候選項包含同一 normalized term／lemma 其他 sense 嘅 canonical 或 accepted 中文答案；
- final options 同時包含多於一個可接受答案，或者兩個題目將對方合理正解當成干擾項；
- 更新既有資料使用過期 `record_revision`；
- 治理 CSV 使用 `CREATE`／`UPDATE` 以外 action；停用／重啟必須改用逐條工作流並填理由；
- 檔案有未知必要欄、重複 header、公式、個人資料或不能解析嘅 CSV 結構。

### 9.4 必須人工處理嘅警告

自動工具可以發現但不能自行決定：

- 同一 lemma + POS 有相近但不完全相同嘅中文解釋；
- 同一詞義由不同人提出不同 level、category、方向設定、例句或干擾項；
- 同一中文 `definition_zh` 可能對應多個合理英文答案；
- 同一英文 `term` 對應多個中文詞義；呢種情況本身合法，但必須檢查各 sense 候選池排除其他正解；
- 英美拼寫、屈折變化、phrasal verb 或同形異音詞可能應合併／分開；
- 干擾項語法上合格，但老師判斷仍可能係正解、近義正解或不符合程度。

### 9.5 衝突處理結果

審核人只可選以下明確結果，禁止直接以最後上載檔覆蓋：

- `MERGE_SAME_SENSE`：同一詞義，整合最佳欄目及保留所有貢獻來源；
- `KEEP_DISTINCT_SENSES`：同一 lemma，但核心意思、搭配或使用條件確實有實質差異；level 或 category 不同本身永遠不足以分成兩個 sense；
- `LINK_AS_VARIANT`：其中一項係拼寫或形態變體，加入 accepted form；
- `REPLACE_DRAFT`：未啟用草稿由較完整版本取代；
- `REJECT_SUBMISSION`：內容重複、錯誤或不符合範圍；
- `ESCALATE_TO_REVIEWER`：學生／一般貢獻者不能決定，交英文老師處理。

每次解決要保存原提交、決定、處理人、時間及理由。

## 10. 多人製作工作流程

### 10.1 分工前

1. 統籌人先建立工作包，以 normalized lemma、字母範圍或指定來源清單分配；
2. 同一 lemma 嘅所有已知詞義盡量交同一小組處理，減少 `run` 被不同人互相覆蓋；
3. 如採用離線工作包追蹤，可為每位成員分配非個人資料 `contributor_ref`；正式系統仍以匯入 actor／batch audit 為準；
4. 所有人使用同一 schema version 及 template，不自行加欄或改 header。

### 10.2 貢獻者提交前

1. 先以 lemma 搜尋共享登記表及目前詞庫；
2. 發現同一英文時，先判斷係同一詞義、拼寫變體，定係新詞義；
3. 每個詞義獨立一行，完成兩個方向是否啟用嘅判斷；
4. 對每個啟用方向逐項檢查 5–6 個干擾項；
5. 多義詞補上學習用例句，並檢查每個中文干擾池冇包含同一英文其他詞義嘅答案；
6. 完整基線工作包填 `CREATE_DRAFT`；日常工作區新建行填 `CREATE` 並留空 keys／revision／status，更新只用系統匯出行並保留 `UPDATE`；
7. 使用自動 validator，零 row-level error 先交畀下一位檢查。

### 10.3 同儕檢查及老師審核

- 同儕檢查人核對拼寫、詞性、程度建議、中文自然度、兩方向各 5–6 個干擾項，以及同詞其他 sense 答案零碰撞；
- 同儕檢查不等於啟用；一般學生團隊提交一律只形成 DRAFT；
- 有詞庫管理權限嘅英文老師負責最終 level、詞義邊界、問題方向及 ACTIVE 決定；
- 新詞義、material change、level 變更、一般停用及重新啟用由一位提交者以外嘅授權人批准即可；系統硬性要求 `approver_actor != proposer_actor`，不設 quorum、投票或第二次批准；
- 純格式、標點或 typo 修正亦沿用同一獨立 reviewer 規則，不設自批例外；
- ADMIN／具 `canManageWordCatalog` capability 嘅老師可填寫理由後立即軟停用 ACTIVE 詞義；呢個係唯一容許同一 actor 建立並完成 request 嘅窄例外，唔適用於新增、內容修改或重新啟用；
- 所有 ACTIVE 詞義都必須有系統 proposer／審核記錄；只有引用或改編外部內容時先要求來源記錄。

### 10.4 批量匯入順序

1. **Parse**：只解析檔案，不寫資料庫；
2. **Normalize**：建立 canonical values、fingerprints 及 content digest；
3. **Row validation**：檢查每行必填、格式、方向及干擾項；
4. **File validation**：檢查檔內重複、key collision 及跨行問題；
5. **Database comparison**：標示新增詞目、新增詞義、更新草稿、完全相同、stale revision、ACTIVE conflict；
6. **Preview**：下載／顯示逐行結果及整批統計；
7. **Resolve**：人工處理所有 blocking conflict；
8. **Commit drafts**：以 `(actorUserId, operationId)` 唯一；`requestDigest` 必須包含 schema version、file hash、ordered rows、resolution 同 expected revisions；同 ID 不同 digest 回 409；
9. **Review and activate**：有權限老師逐批批准；
10. **Audit**：receipt、batch mutations及結果以同一 Serializable transaction 寫入；commit 時重跑 revision／duplicate checks，保存檔案 hash、schema version、actor、結果及變更 revision，但不保存不必要個人資料。

## 11. 詞庫生命週期及權限

### 11.1 保留三種產品角色

系統只保留 `ADMIN`、`TEACHER`、`STUDENT`，不新增「詞庫編輯員」角色：

- `ADMIN`：可以新增、審核、啟用、修改、停用及重新啟用；
- 一般 `TEACHER`：可以逐個／批量提交新詞草稿、修改建議及停用申請；
- 具有 `canManageWordCatalog` capability 嘅 `TEACHER`：可以審核、批准、拒絕、停用及重新啟用；
- `STUDENT` app 帳號：沒有詞庫管理權限。參與內容團隊嘅學生透過受控 CSV 及 `contributor_ref` 交件，由老師匯入。

權限必須由 server API 驗證，唔可以只靠頁面隱藏按鈕。

### 11.2 Catalog status

| 狀態 | 可否出現在新學習／題目 | 意義 |
|---|---:|---|
| `DRAFT` | 否 | 新提交或修改中，等待審核 |
| `ACTIVE` | 是 | 已批准、通過全部 blocking checks |
| `RETIRED` | 否 | 軟停用；資料、歷史及 key 永久保留 |

拒絕屬 change request 結果，不需要把錯誤內容變成第四種可學習 catalog status。

### 11.3 新增、修改及停用

- 新詞義一律先成為 DRAFT；批准後先加入新學習候選；
- ACTIVE 內容同待審 proposal 必須物理隔離：runtime 只讀 `approved_revision`；草稿不可直接改 approved row 或將 ACTIVE sense 暫時變 DRAFT；
- 同一 lemma 新增高階詞義會建立新 `sense_key`，學生原有低階掌握不會自動帶過去；
- identity-preserving correction（包括 typo、level／category／方向設定／例句／干擾池修正）保留 sense key，以新 approved revision 生效；
- 改變核心正解、詞義邊界、主要詞性或使用條件屬 identity change，必須由審核人新建 sense、停用舊 sense，唔可靜默改寫歷史；
- 停用以 sense 為最小單位；只有一個詞目所有 sense 都 RETIRED，整個詞目先視為不可用；
- 停用不刪除 Review、ReviewEvent、StudyEncounter、question snapshot 或審核記錄；
- 一般停用以 current-catalog ACTIVE predicate 作新 issuance 邊界；已成功簽發並仍喺有效 lease 內嘅 immutable snapshot 可按原 contract 完成，停用唔刪除或重寫已發出題目；
- 不另設「緊急撤回」狀態或第二人事後覆核。嚴重錯譯、冒犯或安全風險由授權人使用同一「立即停用」soft RETIRED 路徑，記錄理由、actor、時間及 audit；之後修正／重新啟用另開新申請；
- 即時停用遇到既有待審內容修改時仍會生效；該內容申請日後即使獲批准亦只會更新 RETIRED 詞義，不能暗中重新啟用。尚未完成嘅批次會由 mutation／dependency revision gate 重新判定 stale；
- 重新啟用完全相同詞義使用原 `sense_key` 並保留學習 continuity；如果意思已變，建立新 sense。

### 11.4 對進度、統計及排行榜嘅口徑

- ACTIVE 詞義係目前新學習、單元 denominator 及「目前可掌握內容」範圍；
- RETIRED 詞義從未來候選及目前 active denominator 排除，但歷史答題／活動仍保留；
- 新增 ACTIVE 詞義會增加相應 level／category denominator，對學生顯示時應標明詞庫內容已更新；
- 掌握計算以 sense 為單位。若 UI 顯示數量，應稱「已掌握詞義」；如另顯示唯一英文數量，必須明確稱「詞目數」；
- 歷史排行榜／指定期間活動不可因停用內容而刪除已發生 ReviewEvent；current mastery 類排行榜則只計 ACTIVE senses；
- 每次 activate／retire／reactivate 保存 request、內容 revision、actor及生效時間；全域 lifecycle revision／as-of 排行榜屬後續可選分析能力，唔係目前詞條審批或立即停用嘅必要步驟。

## 12. 整批質量報告

每次完整詞表檢查至少輸出：

- 總行數、詞目數、詞義數，以及 DRAFT／ACTIVE／RETIRED 數量；
- A1／A2／B1／B2 及 category 分布；
- 必填欄完整率、條件性外部來源完整率、例句及音標覆蓋率；
- 英譯中／中譯英啟用數量及兩方向都未啟用嘅阻擋項；
- 干擾項完整、重複、正解碰撞及 accepted-form 碰撞數量；
- 兩方向有序／不計次序候選池 signature、同 category 共享四至六項嘅 pair 數量，以及候選項曝光分布；
- exact duplicate、headword duplicate、同詞跨 sense 干擾碰撞、final-option 多正解、stale revision 及 key collision；
- 同一 lemma 跨 level 詞義列表，供老師確認係熟詞新義定重複；
- 按 contributor_ref 分組嘅錯誤、警告及待審核數量；
- 同上一次 canonical export 嘅新增、修改、停用申請、重新啟用申請及無變更 diff。

啟用批次嘅最低門檻：

- blocking error = 0；
- ACTIVE 行必填欄完整率 = 100%；
- 每個 enabled direction 有 5–6 個合格候選干擾項，並與完整 answer set 零碰撞；
- exact duplicate／key collision／未處理 stale revision = 0；
- ACTIVE 行審核記錄覆蓋率 = 100%，外部引用行來源覆蓋率 = 100%，而且新／material change `approver != proposer`；
- 所有合理正解／跨詞義碰撞 warning 已有人工作出明確 disposition。

## 13. 貢獻者交件前一頁 checklist

每一行提交前逐項確認：

- [ ] 呢一行只包含一個詞義，而唔係將多個不同意思放埋一齊；
- [ ] `term` 拼寫、`lemma`、詞性、level 及 category 已按規範填寫；
- [ ] 中文 canonical 解釋係繁體香港用語、簡短、自然、同詞性一致；其他合理中文已放入 `accepted_answers_zh`；
- [ ] 同一英文如有多個意思，已按 sense 分行；`prompt_en`／`prompt_zh` 保持空白；
- [ ] 每個啟用方向已填 5–6 個候選干擾項，第六項質量不足時留空；
- [ ] 每個候選喺實際選項集合中都係明確錯誤，冇重複、正解、近義正解或拼寫變體；
- [ ] 英譯中候選池冇包含同一英文其他 sense 嘅中文正解，例如 `run=跑步` 嘅干擾項冇「經營」；
- [ ] 多義／非字面內容已有自然例句及對應翻譯；
- [ ] 如有引用／改編外部材料，已填可追溯來源；否則來源欄可以留空；
- [ ] 已用共享登記表搜尋 lemma，知道係新增詞目、新詞義定修改既有項目；
- [ ] 已確認交件模式：完整基線使用 `CREATE_DRAFT`；工作區新增使用 `CREATE` 並留空 keys／revision／status；工作區更新來自系統匯出並使用 `UPDATE`；
- [ ] 如有使用 `contributor_ref`，只填團隊編號；檔案冇個人資料或公式；
- [ ] validator 顯示零 row-level blocking error。

## 14. 規範版本及變更控制

- `word-catalog-v1` 凍結後，bootstrap 39欄contract、governance 34欄teacher view、enum、canonical language、每行語義或干擾項數量嘅breaking change必須建立新schema version；兩個輸入邊界分開，普通governance parser固定拒絕39欄；
- 增加 optional 欄亦要先更新本規範、template、validator、import preview 及 export；
- 匯入器必須拒絕未知 major version，不能按「大概相似」猜測欄目；
- 每次 ACTIVE 內容變更保存 record revision、actor、理由及時間；
- CSV 係受控匯入／匯出同版本管理格式，production runtime 嘅 canonical 狀態以 PostgreSQL 及審核紀錄為準；
- seed／converter 不得因舊檔缺行而停用資料，亦不得喺 production 自動重播未審核 CSV 覆蓋老師修改。

## 15. 現有 Markdown 轉換原則

下一階段將目前 `word list.md` 轉成 v1 草稿時：

- 保留原始 term、definition、level、category 及來源行號作 migration report；
- 不再採用「同一 term 永遠只保留最低級別」；同一 term 嘅多次出現全部進入 headword conflict bundle；
- 只有經規則／人工判斷為完全相同詞義先合併；不同意思保留為不同 sense；
- 舊中文會轉成 canonical 繁體並保留原值供 diff；
- 舊自由文字 category 先 mapping 至 v1 category code，無法 mapping 嘅項目標示 warning；
- 舊資料缺少 POS、每方向至少五個干擾項或必要例句時只可成為 DRAFT，不能虛構成 ACTIVE；prompt 必須保持空白；
- converter 先提供 dry-run、逐行 provenance、重複／衝突報告及統計，之後先決定人工補充工作量；
- 現有資料係測試／初始內容，可在本地 reset 後重新匯入，但 converter 同正式 schema 仍要按未來 production 可安全使用嘅方式設計。

## 16. 待批准決策摘要

本 v1 草案提交確認嘅主要決定係：

1. 每行一個 sense，同一 lemma 可以跨 level 再出現；
2. `catalog_key`／`sense_key`／revision 全部由系統管理；
3. 繁體香港中文作 canonical，簡體由系統生成；
4. 每個 enabled direction 有 5–6 個人工選定候選干擾項，出題只抽三個，不臨場自動補詞；
5. Objective Probe 唔使用 prompt：英譯中顯示 `term`，中譯英顯示 `definition_zh`；兩方向候選池完全獨立；
6. 多義詞以獨立 sense 處理，同一英文其他 sense 嘅答案禁止成為干擾項；唯一正解要求 final options 唯一，完整可接受答案集合必須同干擾項零碰撞；
7. 一般老師只提交，具有 account-level capability 嘅老師先可審核／停用；角色仍然只有三種；
8. 所有停用都係可逆 soft retirement；具審核權限者可填理由後立即停用，不另設緊急撤回或第二人事後覆核，亦永不以缺行或 hard delete 表達；
9. CSV 係受控交換格式，PostgreSQL 係 runtime canonical source；
10. 現有 Markdown 先轉 DRAFT 並產生衝突報告，唔直接當成已審核正式詞庫；
11. ACTIVE 內容使用 immutable approved revision；草稿、提案及舊 revision 永不原地覆寫；
12. 新／material change 禁止自批，一位獨立 reviewer 足夠且第一個終局決定生效；只有具權限者立即 RETIRE 可由同一 actor 完成。匯入、題目 issuance及內容 revision均有明確並發及審計邊界。
