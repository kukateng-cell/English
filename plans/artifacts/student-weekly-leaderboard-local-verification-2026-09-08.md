# 學生每週排行榜本地驗證紀錄

日期：2026-09-08
分支：`codex/student-leaderboard-motivation`
來源分支：`codex/teacher-learning-reward-index`
資料環境：local development only

## 本地資料重建

- 目標摘要：PostgreSQL `::1:5432/english_dev`、schema `public`、role `english_dev`。
- catalog source digest：`6b8dee4f8cb9efe0ec71e173ac34a407031dc3967c2b290e4878fda83d5fa23a`。
- 先執行 guarded dry-run，再執行：

  ```bash
  DATABASE_ENVIRONMENT=development \
  CONFIRM_DATABASE_ENVIRONMENT=development \
  CONFIRM_LOCAL_RESET_TARGET=english_dev/public \
  CONFIRM_LOCAL_CATALOG_DIGEST=6b8dee4f8cb9efe0ec71e173ac34a407031dc3967c2b290e4878fda83d5fa23a \
  npm run db:rebuild:catalog -- --execute
  ```

- 結果：67 個 migration replay；catalog 5,641 rows（5,469 ACTIVE、107 DRAFT、65 failed）；18 classes、150 students、4 teachers；90 日 demo activity；V2 checker 2,758 ReviewEvent、7,529 encounters／StudyDay。完整重建可重播，重建後 weekly checker 仍得到 class 8、grade 26、school 149 participants。
- 清空只針對上述 localhost application database；沒有執行 production migration、cleanup 或 deployment。

## 自動化驗證

| 指令 | 結果 |
|---|---|
| `npm test` | 通過，424 tests |
| `npm run lint` | 通過 |
| `npx tsc --noEmit` | 通過 |
| `npm run build` | 通過，Next.js production build及90個靜態頁面 |
| `npm run test:weekly-leaderboard:scale` | 通過，40／400／2,000 rows純排名reducer |
| `npm run test:db:weekly-leaderboard` | 通過；class 8、grade 26、school 149；50列分頁無重複；teacher 403；cursor錯誤及GET前後計數檢查通過 |
| `npm run test:db:stream-v2` | 通過，現行V2 study stream integration |
| `npm run test:e2e:weekly-leaderboard` | 通過；Chromium desktop、Chromium mobile、WebKit共8 tests |
| `git diff --check` | 通過 |

## 覆蓋的行為

- `student-weekly-v1` 固定70%投入／30%成果、每日上限及精確 milli-point 顯示。
- 本週星期一邊界、CURRENT enrollment、班／年級／全校 scope、週中加入目標、0分未上榜、並列 competition rank、gap及nearby。
- `RANKED`、`UNRANKED`、`PENDING_REVIEW` 狀態及部分coverage notice。
- opaque HMAC cursor、5分鐘TTL、scope／asOf／digest binding、跨使用者及篡改 cursor 拒絕。
- session／student role、rate limit、private no-store、public DTO PII allowlist。
- 本班完整榜每頁50列、年級／全校摘要、個人位置、7日目標、累積成果及responsive頁面。
- 舊榜reader及caller已清理；教師reward來源改由共用activity reader提供，沒有新增學生寫入或mastery副作用。

## 未完成／限制

- 只完成40／400／2,000 rows純排名scale smoke；沒有建立2,000人×7日真實資料庫fixture，因此未宣稱資料庫p95／payload預算達標。
- macOS解鎖後已完成CUA視覺walkthrough：本班榜、全年級三人並列、完整榜、計分說明、七日目標、淺色／深色、繁／簡體及底部可達性均已實際檢查；未完成實體手機、VoiceOver／TalkBack及真實學生pilot。
- 沒有執行production deployment、observation、灰度或production cleanup；本計劃範圍只包括local implementation。
