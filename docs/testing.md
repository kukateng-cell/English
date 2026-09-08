# English 測試指南

測試目標是證明改動維持目前 contract，不是追求測試數字。先選最窄而足夠的驗證，再按風險擴大。

## 快速檢查

```powershell
npm test
npm run lint
npx tsc --noEmit
```

目前 `npm test` 由 `package.json` 明確執行 `src/lib/*.test.ts`、`src/lib/catalog/*.test.ts` 及
`src/lib/i18n/*.test.ts`；它不會自動搜尋日後新增的任意子目錄。搬動測試時必須同步更新 script，
並核對 test discovery，不能只看命令 exit 0。

## 按改動範圍選擇

| 改動 | 至少執行 |
|---|---|
| 純 parser／policy／日期／DTO | `npm test`、lint、typecheck |
| page／component／route handler | 上述三項，加相關 Playwright project；必要時 `npm run build` |
| catalog CSV／治理／審核／匯出 | `npm test`、`check:catalog-governance`、`check:catalog-submission`、`check:catalog-teacher-workflow`、`test:e2e:catalog-workspace` |
| V2 action／credential／outbox／checkpoint／recovery | `test:db:stream-v2`、`test:browser:outbox`、`test:e2e:study-stream-v2`、`test:e2e:card-motion` |
| Auth／名冊／reset／角色 | `test:roster:auth`、`test:roster:invariants`、`test:e2e:admin-roster` 及相鄰 unit |
| analytics／reward／leaderboard | 相鄰 unit、`test:db:weekly-leaderboard`、`test:e2e:weekly-leaderboard` 及 fixture checker |
| schema／migration | `test:migration-checksums`、`test:migrations`、適用時 `test:migrations:contract`，再 `prisma generate` |
| production 設定／workflow | `check:production-config`，並人工核對 `.github/workflows/deploy-production.yml` |

完整 product build：

```powershell
npm run build
```

## Browser 與資料庫原則

Browser test 需要 PostgreSQL、測試帳戶環境變數、production build 及 Playwright browsers；高成本 command
未執行時要在計劃或交付紀錄明確寫出。gesture、study action、credential、scoring 變更不可只靠 unit test。

DB check 使用 disposable test DB，先核對 `MIGRATE_URL`、database environment marker 及 schema；不要對 development
demo reset。seed／demo writer 有實際副作用，重跑、failure resume 及既有資料回歸按相關計劃執行。

## V2 必測不變條件

- Learning Card 只有非發音區域 stationary long-press 3 秒揭示；放手、移動、cancel 會重置。
- Objective Probe 只接受第一次合法答案，server snapshot 判分；不得原地重答改寫第一次結果。
- self-rating 不直接寫 scored ReviewEvent；V2 receipt、Review revision CAS、credential lineage 及 operationId 只提交一次。
- offline outbox、checkpoint、cross-tab／cross-device reconciliation、expired／revoked recovery 仍然 fail-closed。
- locale、theme、keyboard、screen-reader-labelled action、mouse、touch 及 synthetic pointer 的語義一致。

## 測試輸出及證據

日常 Playwright failure output 寫入 `test-results/`，不應污染 tracked 歷史證據。
`output/playwright/` 內現有圖片是有日期的視覺驗收資料；要修改或搬移前先更新引用及保留 hash。
`outputs/` 內正式 catalog CSV／manifest 是測試與 seed 來源，不能當測試暫存刪除。
