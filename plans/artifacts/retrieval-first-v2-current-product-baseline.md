# Retrieval-first Learning Stream V2 · Current Product Baseline

> 類型：產品現況／AI 交接快照（唔係新 implementation plan）
> 快照日期：2026-08-15
> 工作分支：`codex/retrieval-first-learning-stream-v2`
> 程式基線 commit：`e43ed66`
> 狀態：本地產品基線已完成；external rollout／research／destructive cleanup deferred
> 規範來源：[retrieval-first-learning-contract.md](../retrieval-first-learning-contract.md)
> 歷史及驗證來源：[retrieval-first-learning-program.md](../retrieval-first-learning-program.md)

## 一、用途及優先次序

呢份文件俾後續 AI、開發者及設計工作快速理解「而家個產品實際係乜」。佢濃縮已批准
Contract 同 I-011–I-035 實機修正，但唔取代程式、測試、schema 或 migration 歷史。

出現衝突時依照以下優先次序：

1. 安全、資料一致性、one-time credential、idempotency、server scoring 及 migration contract；
2. 已批准 Retrieval-first Contract；
3. 目前程式、測試、`prisma/schema.prisma` 及 migration evidence；
4. 本文件所述 current product baseline；
5. EMM Style 02 原始 prototype／handoff 嘅 presentation reference。

EMM Style 02 係設計起點；其後使用者批准嘅 I-011–I-035 override 先係目前產品基線。
唔可以只按舊 prototype 嘅 tap reveal、固定 `1/13`、每三詞一測或完成頁重新改返舊流程。

## 二、目前產品定位

- 面向中文學校中學生，以「見英文能辨認中文意思」為主要詞彙目標；唔宣稱測量拼寫、
  自由回憶、文法、聽力或口語能力。
- Global `/study` 係 continuous stream，無固定完成題數；每個已確認 action 後都可以安全離開。
- Unit mode 可以有有限詞集及 summary，但使用同一 Learning Card／Objective Probe contract。
- 本地開發可用 `STUDY_V2_ASSIGNMENT_MODE=all` 令所有已登入帳戶使用 V2；production／
  Vercel runtime 會拒絕 `all`。`off` 保留 V1 rollback，`internal` 只限 allowlist。
- 呢個分支未合併或推送到 `main` 就唔代表 `main` 已經有 V2，亦唔代表 production 已發布。

## 三、學生最基本學習流程

```text
進入 continuous stream
→ server 發 Learning Card 或 Objective Probe

Learning Card：
看到英文及持續顯示嘅思考提示
→ 約 1 秒後漸進顯示「長按 3 秒揭示答案」
→ 原地長按非發音區域 3 秒
→ 卡片翻轉並顯示英文、音標位、發音及突出中文意思
→ 揭示後選擇／滑動「和剛才想的一樣」或「和剛才想的不一樣」
→ server 確認 operational action
→ 下一個 item

Objective Probe：
先回想，再選最接近嘅答案
→ 第一次合法選擇由 server 判分
→ 選項本身以 correct／wrong／dim 顏色顯示結果
→ 空白位置出現低幅度半透明呼吸圓形
→ 點一下卡面任意可用區域或用 keyboard 確認已看 feedback
→ 下一個 item
```

## 四、Learning Card 最終互動

### 未揭示狀態

- 「先試著想一想這個詞的中文意思」由卡片出現開始持續保留，唔會因 secondary hint
  出現而消失或移位。
- 約 1 秒後，「長按 3 秒揭示答案」喺發音 control 下方固定預留位置漸進出現；動畫係低幅度、
  慢速呼吸，唔可以劇烈閃動。
- 只有 stationary long-press 3 秒可以揭示：手指／pointer 中途放開、移動超過容許距離、
  pointer cancel 或開始 swipe，都要取消並重新計時。
- 按住期間喺按下位置顯示若隱若現圓形；越接近三秒，呼吸頻率／明顯度逐步增加。
- 發音 control 只播放語音，唔開始 reveal timer；未揭示時左右 swipe 無提交副作用。
- reduced-motion 必須保留可理解嘅進度／狀態提示，只移除非必要動畫。

### 揭示狀態

- 使用 one-way flip／state transition 顯示答案；唔因後續 pointer 行為翻回未揭示面。
- 答案面保留英文、音標預留位、發音及突出中文意思；有資料先顯示詞性、例句等內容。
- 右上四分之一圓／角標以 stylized「認」表示認讀卡，唔另外重複顯示「認讀卡」三字。
- level／category badge 同右上「認」保持視覺水平對齊；音標位喺英文正下方。
- 揭示後左向＝「和剛才想的不一樣」，右向＝「和剛才想的一樣」；卡下亦有同寬 accessible
  action controls。卡內唔重複顯示同一組 swipe 文案。
- swipe direction feedback 要位於 level／category metadata 以下安全區，唔可以互相重疊。

### Self-rating 嘅資料語義

- 「一樣／不一樣」只係學生對剛才心內答案嘅 self-rating／operational encounter。
- Self-rating 唔直接寫 scored `ReviewEvent`，唔直接更新 SM-2、mastery、排行榜或單元解鎖。
- 唔可以將呢兩個操作改名或解讀成「我會／還不會」並直接當客觀成績。

## 五、Objective Probe 最終互動及計分

- Objective Probe 係客觀認讀選擇題，唔係自由回憶測驗；client 只收到 opaque option IDs，
  唔收到 `correctOptionId`。
- 同一 Objective Evidence Target 只接受第一次合法答案；refresh、重連、重送或另一裝置
  唔可以產生第二次 scored result。
- `retrieval-v1` policy：答啱映射 SM-2 quality 4；答錯映射 quality 2；quality 5 暫不使用。
- 答錯後顯示正確選項，但唔容許原地重答到啱再覆寫第一次結果。
- 正誤主要由選項卡嘅 correct／wrong／dim 狀態呈現；唔再喺下方彈出「答對了」、
  「確認」或「我看到了，繼續」等 button／文字。
- Answered feedback 以固定空白 slot 嘅低幅度半透明呼吸圓形提示可繼續；整個可用卡面支援
  tap／click，亦保留 keyboard／screen-reader 可操作語義。
- 未確認 feedback 就離開時，下次只恢復一次 authoritative read-only feedback；唔重新開放答案。

## 六、排程、測試頻率及長期掌握

- 唔係固定「認三個詞就測一次」。每個 item 由 server scheduler 根據到期詞、成熟詞、
  remediation、Evidence Obligation、debt cap、delay、age、mode scope 及候選狀態決定。
- 已到期成熟詞可以直接出 Objective Probe，唔需要先重看 Learning Card。
- Learning Encounter 唔一定建立 future verification；obligation admission 有 combined cap 5、
  soft threshold 3、consecutive soft cap 2、最少 intervening 2、eligible delay 10 分鐘、
  age 24 小時及 service gap 6 嘅 `retrieval-v1` 起始政策。
- 學生長時間無登入時，逾期詞由 scheduler 按 eligibility／priority 分批處理，唔一次過要求
  清空所有 backlog；新詞會受 verification debt／到期量節制，但唔係永久禁止。
- 「已學」代表已有認讀活動／Review continuity；「長期掌握」使用既有 SM-2 interval 門檻，
  並會喺將來到期時再次出現，唔代表永遠移出學習系統。

## 七、首頁、詞表、統計及視覺基線

- 首頁進度只計目前已解鎖內容；統計頁另外按 A1／A2／B1／B2 顯示明細及解鎖狀態。
- 詞表狀態分為未學習、學習中、待複習、長期掌握；級別／單元可按實際解鎖內容篩選。
- 近 7 日活動維持柱狀圖；近 30 日使用橫向充分利用空間嘅七行熱力方格。
- 學生介面唔顯示 `Asia/Shanghai`、SM-2、REVIEW event、計算口徑等技術性說明；內部日期
  仍以 Asia/Shanghai 日曆日計算。
- tablet／desktop 嘅首頁、統計、Learning Card 及 Objective Probe 使用寬版 responsive surface；
  mobile 保留單欄及 floating bottom navigation。
- 學習頁保留圓形 EMM 返回掣；desktop header 唔重複 sidebar 已有嘅 theme／logout controls。
- 排行榜、連勝、成就、掌握詞數及日曆使用專用可換色 SVG reward icon；前三名係 numbered medal，
  指標圖示使用固定 slot 對齊。
- zh-Hant／zh-Hans 同明／暗 theme 都係現有產品能力；新增文案同視覺要同時保留。

## 八、可靠性、安全及兼容性不變條件

- 學習 action 由 server-issued session item credential、nonce／digest lineage、`operationId`、
  global receipt、Serializable transaction、Review revision CAS 及 retry 保護。
- client 唔可以自行指定可信 word、item kind、quality、correctness、score 或第二次答案。
- checkpoint、offline outbox、cross-tab／cross-device reconciliation、session rotation、expired
  credential／lease bounded recovery 必須保留；未知 credential 或 revoked session fail closed。
- V1／V2 由 `flowVersion` pinning 分流；唔接受 mixed payload。V1 bridge／rollback 保留至另行
  批准 destructive contract cleanup。
- production limiter 必須使用共享 Upstash；缺少 backend 時 fail closed，唔可靜默改用 memory。
- 已套用 migration 唔可修改；一般變更走 expand migration，唔用 `prisma db push`。

## 九、目前未完成而且唔可自行假定完成嘅項目

- 合併或推送到 `main`；
- production deploy、正式域名、production observation window、alerts threshold decision；
- 真實學生 pilot；
- 原生手機／完整 screen-reader acceptance matrix；
- research telemetry、研究資料收集、diagnostic exposure 或 experiment assignment；
- ethics／學校／家長 permission、學生 assent、retention、withdrawal 等研究批准；
- Stage E legacy cleanup／production `npm run db:contract` destructive contract migration。

Staging contract migration 嘅個別執行授權唔等於 production cleanup 授權，亦唔代表所有
backup、maintenance window、post-deploy audit 或 old-writer retirement gate 已完成。

## 十、後續 AI／開發工作守則

1. 開始新工作先讀 `AGENTS.md`、`plans/README.md`、本文件及直接相關計劃。
2. 修改核心學習語義前先更新 Contract；修改 API／schema／migration 前更新相應計劃。
3. 唔因舊 screenshot、舊 prototype 或舊 project-plan 描述而恢復 tap-to-reveal、固定三詞一測、
   swipe 直接計 mastery、固定 session denominator 或可重答 Objective Probe。
4. 小型 presentation 修正只做比例相稱驗證；gesture、study action、checkpoint、credential、
   scoring 或 migration 改動先需要相應高成本 regression。
5. 未獲明確授權唔合併／切換／推送 `main`，唔執行 production deploy、研究收集或 destructive cleanup。
