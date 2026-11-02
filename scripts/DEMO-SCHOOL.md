# 本地虛構學校

所有姓名及活動均為合成資料，分布是可調整的示範假設，不是真實學生研究。
需要已匯入的 READY catalog、MIGRATE_URL 指向 localhost、相符的
DATABASE_ENVIRONMENT / CONFIRM_DATABASE_ENVIRONMENT（development 或 test），以及資料庫持久環境 marker。

## 第一次建立

```powershell
npm run demo:init -- --seed school-2026 --days 90 --dry-run
npm run demo:init -- --seed school-2026 --days 90 --confirm-reset
npm run demo:check
```

初始化會清除本地帳戶、學年、名冊及其關聯學習資料，保留 catalog。
18 班各 28–36 人，班內學號由 1 開始；六名教師按年級任教。
admin/teacher 使用 INITIAL_ADMIN_PASSWORD；首兩名學生使用 TEST_STUDENT_USERNAME /
TEST_STUDENT_WEBKIT_USERNAME（未設定時 student-test / student-test_webkit）及 TEST_STUDENT_PASSWORD。
其餘學生各自使用隨機密碼，需要登入時由管理員重設。

其餘學生帳號為學生編號：入學年份 + 班別序號 + 兩位學號，例如 `2026105` 為 2026 年入學、
甲班 5 號（高年級按年級往前推算入學年份）。帳戶建立時間早於開學日一至九日，按學生錯開；
教職員帳戶在開學前兩星期建立。

演示前不要用演示帳戶進入 `/study`：手動學習會令 `demo:update` 報衝突。需要現場示範學習流程時，
另建一個學生帳戶。

## 每日補上活動

```powershell
npm run demo:update
npm run demo:check
```

保留身份與舊事件，補到目前 Asia/Shanghai 時間；同日重跑不重複。
停機期間不執行，下次會自動補漏。日期不得倒退，不產生未來事件。
為固定測試時間，init/update 可加 `--as-of 2026-09-08T12:00:00+08:00`。
`--dry-run` 可預覽新增量。初始化中斷未提交時原資料保留；名冊提交後活動中斷，以 update 續跑。
模擬帳戶有手動學習或身份改動會報衝突，不會覆寫；互動學習測試宜另建帳戶。

開發時可使用 `npm run dev:demo`，先補資料再啟動，支援傳入 Next.js 選項。
目前機器 3000 被 Windows 保留，使用 `npm run dev:demo -- --hostname 127.0.0.1 --port 3200`。
沒有安裝系統排程；本指令可供日後排程使用。

## 模型及界限

固定 seed 決定姓名、班級人數、學習習慣、個人能力、參與率、時段、週末偏好、近期趨勢及晚加入。
學習習慣分五類（示範假設，不是真實學生研究）：進階型約 5%、穩定型約 13%、一般型約 45%、
隨意型約 34%、停用型約 3%。第一個演示帳戶固定為進階型，第二個為穩定型。
模擬按現行 `retrieval-v3` 政策（`DEMO_POLICY_VERSION`）產生，寫入的 session、item、obligation、
target 及 encounter 版本一致；每名學生寫入後按現有規則補上已達成的成就。
`DEMO_VERSION` 改變後舊 manifest 不能 update，需要重新 `demo:init`。
日／學生 random stream 互相獨立，活動按時間排序。沿用正式純排程、admission、quality、SM-2
及全詞庫單元解鎖；歷史 writer 批次寫入 V2 target/snapshot/event/receipt，並不重播 HTTP/auth。
正確率受詞難度、重複次數及逾期影響；自評獨立抽樣，不直接推進 Review。
不提早 EXPIRE 未到期 obligation；有未完成驗證屬合理狀態。所有寫入卡片已確認、session retired。
開始日限制在目前學年，最多回填90日；跨學年不自動升班，也不把暑假倒灌入新學年。
只用目前 eligible catalog；內容／版本改變會停止更新，需重新初始化。
每名學生 transaction + checkpoint 原子提交；大型全校更新期間可短暫看到部分學生已更新。
舊 seed:demo-analytics/check:demo-analytics-fixture 專供舊固定人數 fixture，不適用本名冊。
