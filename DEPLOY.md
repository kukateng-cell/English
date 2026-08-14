# 部署到 Vercel + Supabase 完整流程

本项目已从 SQLite 切换到 **PostgreSQL**，部署目标为 **Supabase（数据库）+ Vercel（应用）**。

> 本地开发可使用 Docker PostgreSQL，亦可按需要连接 Supabase；项目不再支持 SQLite。

## 当前发布边界（2026-08-15）

- Retrieval-first V2 已完成本地产品实现与验证，但未因此自动部署到 production。
- 当前工作分支是 `codex/retrieval-first-learning-stream-v2`；未合并／推送 `main` 前，
  不可假定 main、Vercel 或正式数据库已经包含本分支。
- 本地 `STUDY_V2_ASSIGNMENT_MODE=all` 只供完整产品验证；Vercel preview／production 会拒绝
  `all`。Production 应保持 `internal`／明确 allowlist，直至另行批准正式 rollout。
- Production deploy、正式 observation window、真实学生 pilot 及 research collection 都未执行。
- Staging contract migration 的个别授权不等于 production Stage E cleanup 授权。执行任何
  contract migration 前仍要核对 exact target、backup／snapshot、maintenance window、confirmation、
  regression 及 post-deploy audit；没有证据不得在计划中标记完成。

---

## 整体架构

```mermaid
flowchart TD
    GitHub[GitHub repo] -- push --> Vercel[Vercel <br/>Next.js 应用]
    Vercel --> Supabase[(Supabase <br/>Postgres 数据库)]
```

| 在哪里 | 做什么 |
|--------|--------|
| **Supabase** | 提供 Postgres 数据库，存单词 / 学生 / 学习记录 |
| **Vercel**   | 跑 Next.js 应用，serverless 函数处理 API + 页面 |
| **GitHub**   | 存代码，Vercel 每次 push 自动重新部署 |

---

## 两个数据库连接串（重要）

Prisma 在两种场景用不同的连接方式，所以需要**两个环境变量**。Direct endpoint
通常只提供 IPv6；执行 migration 的 runner 无 IPv6 时，才改用 5432 Session pooler。

| 环境变量 | 连接类型 | 端口 | 用在哪 | 为什么 |
|----------|---------|------|--------|--------|
| `DATABASE_URL` | **Transaction pooler**（加 `?pgbouncer=true`） | 6543 | `src/lib/prisma.ts`（运行时） | serverless 短连接；transaction mode 不支持 prepared statements |
| `MIGRATE_URL`  | **Direct connection（优先）／Session pooler（后备）** | 5432 | migrate / seed | 两者支持 prepared statements 与 DDL；Session URL 不加 `pgbouncer=true` |

两者用户名都是 `postgres.<REF>` 格式（pooler 要求）。运行时只读取
`DATABASE_URL`；迁移与 seed 必须显式提供 `MIGRATE_URL`，两者不会互相回退，
避免把生产 DDL 权限意外带进 build 或一般运行环境。

---

## 第 1 步：创建 Supabase 项目并拿到连接串

1. 打开 <https://supabase.com> 注册并登录（可用 GitHub 登录）
2. 点击 **New project**
   - **Name**：`english`（随意）
   - **Database Password**：设一个强密码，**立刻记下来**（后面要用，Supabase 不会再显示）
   - **Region**：选离你最近的（如 `Southeast Asia (Singapore)` 或 `Northeast Asia (Tokyo)`）
   - **Plan**：Free 即可
3. 等待 ~2 分钟项目初始化完成
4. 进入项目 → 左下角 **⚙ Project Settings** → **Database**
5. 找到 **Connection string** 区域，有多个标签页：
   - 切到 **Transaction pooler** → 格式类似：

     ```text
     postgresql://postgres.[REF]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
     ```

     把 `[YOUR-PASSWORD]` 换成第 2 步设的密码 → 这就是 **`DATABASE_URL`**
   - migration 优先复制 **Direct connection**。若 runner 只有 IPv4，切到
     **Session pooler**（同一个 pooler 域名，端口 **5432**）→ 格式类似：

     ```text
     postgresql://postgres.[REF]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres
     ```

     同样替换密码 → 这就是 **`MIGRATE_URL`**（migrate / seed 用）

   > Direct connection 最适合 migration，但通常需要 IPv6；出现网络不可达时才使用
   > Session pooler。不要将 6543 transaction URL 用作 migration。

> 💡 `[REF]` 是项目的短 ID（如 `abcdwxyz...`），在 Settings → General → Reference ID 能看到。

---

## 第 2 步：本地配置 + 建表 + 导入数据

### 2.1 创建本地 `.env.local`

在项目根目录新建 `.env.local`（已被 `.gitignore`，不会提交）：

```bash
# 粘贴第 1 步拿到的两个连接串（记得替换密码）
DATABASE_URL="postgresql://postgres.[REF]:[密码]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
# IPv4-only 示例；能使用 Direct connection 时优先填 Direct URL
MIGRATE_URL="postgresql://postgres.[REF]:[密码]@aws-0-[region].pooler.supabase.com:5432/postgres"

# NextAuth
NEXTAUTH_SECRET="用下面命令生成的随机串"
SECURITY_AUDIT_HASH_SECRET="另一组长期稳定的随机串"
NEXTAUTH_URL="http://localhost:3000"

SEED_STUDENTS=1
DATABASE_ENVIRONMENT="development"
# 只在数据库第一次分类时需要；之后持久标记会阻止误连生产库
CONFIRM_DATABASE_ENVIRONMENT="development"
SEED_TEST_STUDENT=1
TEST_STUDENT_USERNAME="__test_student__local"
TEST_STUDENT_PASSWORD="你的本地测试密码"

# 本机完整 V2 产品验证；只允许 local development，production 会拒绝此值。
STUDY_V2_ASSIGNMENT_MODE="all"

# 管理员 / 教师账号初始密码（必填；seed 时创建 admin / teacher 这两个账号）
INITIAL_ADMIN_PASSWORD="你的管理员初始密码"
```

生成 `NEXTAUTH_SECRET`（在项目根目录运行）：

```powershell
npx auth secret
# 或
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2.2 重新生成 Prisma Client（schema 改了）

```powershell
npx prisma generate
```

### 2.3 在 Supabase 建表（用 migrate，不要用 db push）

```powershell
npx prisma migrate deploy
# 或等价的 npm 脚本：
npm run db:deploy
# migration 後的 V1／V2 credential、receipt、provenance、index 兼容性 gate：
npm run check:study-credential-v2
# CI／production verification 亦會執行 V2 transaction／compatibility integration 及 bounded soak：
npm run test:db:stream-v2
STUDY_STREAM_SOAK_ITERATIONS=3 npm run check:study-stream-v2:soak
```

这会用 `MIGRATE_URL`（Session pooler，5432）连 Supabase，按顺序执行
`prisma/migrations/` 里的 expand migrations；legacy ledger contract 是之后独立运行的发布步骤。
完成后去 Supabase → **Table Editor** 应该能看到 `User` / `Word` / `Review` / `ReviewEvent` 等表，以及 `Level` / `Role` 两个 enum。

> ⚠️ **不要用 `npx prisma db push` 建表**。`db push` 只改表结构、不写迁移历史，会让 `_prisma_migrations` 与真实库结构脱节（本项目早期就是因此出现过 migration 重复 / `migrate status` 不一致等问题）。新环境一律用 `migrate deploy`，保证迁移历史可由空库重放。
>
> 迁移必须可由全新空数据库从头重放；CI／发布 gate 会在部署前完成代码检查。
> `npm run db:deploy` 亦会先比较数据库已套用 migration 的 SHA-256 checksum 与
> 仓库文件；任何已发布 migration 被改写都会立即中止。不要手改
> `_prisma_migrations`。若某个开发库曾套用未定稿 migration，请保留原库作备份，
> 将资料迁到由当前仓库从空 schema 建立的 canonical 环境，再切换连接串。

### 2.4 导入单词数据 + 账号

```powershell
npm run seed
```

会创建：

- `word list.md` 里的所有单词
- 管理员账号 `admin`、教师账号 `teacher`（密码 = 你设的 `INITIAL_ADMIN_PASSWORD`）
- `student01` ~ `student40`（仅在 `SEED_STUDENTS=1` 时处理；每个账号获发不同的一次性临时密码，仍未首次改密的旧账号亦会轮换；seed 每成功写入一笔便立即输出，请安全保存）
- 本地测试学生 `__test_student__local`（或 `TEST_STUDENT_USERNAME` 指定的、带
  `__test_student__` 保留前缀的全新账号），密码为 `TEST_STUDENT_PASSWORD`；该账号
  `mustChangePassword=false`，可直接进入学习页。若账号已经存在，seed 会停止而不会
  覆盖密码、姓名或角色。

测试学生只有在 `SEED_TEST_STUDENT=1` 时才会创建；生产必须保持为 `0`。

> ⚠️ `INITIAL_ADMIN_PASSWORD` 必填；未设置时 seed 会直接抛错中止（安全审计要求：禁止硬编码密码）。

### 2.5 本地验证

```powershell
npm run dev
```

打开 <http://localhost:3000/login>，用 `student01` 及 seed 当次输出的一次性临时密码登录，确认能正常学习。
**本地能跑通，说明 Supabase 连接 OK，可以进下一步。**

---

## 第 3 步：把代码推到 GitHub

```powershell
git add -A
git commit -m "切换到 PostgreSQL (Supabase) 并准备 Vercel 部署"
git push
```

> 注意：`.env.local` 不会上传（被 gitignore），秘密只留在本地。`src/generated` 也不上传（Vercel 会自己生成）。

---

## 第 4 步：在 Vercel 部署

1. 打开 <https://vercel.com> 用 GitHub 登录
2. 点 **Add New... → Project**
3. Import 你的仓库（`english`）
4. **Framework Preset** 应自动识别为 **Next.js**
5. **Environment Variables**（关键！）—— 逐个添加：

   | Name | Value | 说明 |
   |------|-------|------|
   | `DATABASE_URL` | （第 1 步的 Transaction pooler，6543） | 运行时连库 |
   | `MIGRATE_URL`  | 不要填入 Vercel Preview / Runtime | 只存入 GitHub `production` environment secret；build 不可持有 DDL 凭证 |
   | `NEXTAUTH_SECRET` | （和本地一样的那串） | 生产环境要重新生成一串新的也行 |
   | `SECURITY_AUDIT_HASH_SECRET` | 至少 32 字符独立随机串 | 审计账号/IP HMAC；必须长期稳定，不跟 JWT 密钥一同轮换 |
   | `NEXTAUTH_URL` | `https://你的应用名.vercel.app` | 部署后 Vercel 会给你域名；**首次可先留空或填预计域名，部署拿到真实域名后再回来改** |
   | `INITIAL_ADMIN_PASSWORD` | （和本地一样） | 仅 seed 时需要；Vercel 上一般不在构建期跑 seed |
   | `DATABASE_ENVIRONMENT` | `production` | 仅 seed 时使用；必须与数据库持久环境标记一致 |
   | `SEED_TEST_STUDENT` | `0` | 生产不可自动建立本地测试学生 |
   | `UPSTASH_REDIS_REST_URL/TOKEN` | Upstash REST credentials | production 必填，所有 limiter 共用分布式计数 |
   | `CRON_SECRET` | 至少 16 字符随机值 | 保护每日 expired StudySession cleanup endpoint |
   | `DATABASE_POOL_MAX` | `3` | 每个 serverless instance 最多 3 条 runtime 连接 |
   | `STUDY_OPERATION_ID_COMPAT_UNTIL` | 默认留空 | 只可填未来 30 分钟内的绝对 ISO 截止时间 |
   | `STUDY_V2_ASSIGNMENT_MODE` | `internal` | Production 不可使用 `all`；只对明确 allowlist 开启 V2 |
   | `STUDY_V2_INTERNAL_USER_IDS` | 默认留空 | 获批准的 internal／test user IDs，逗号分隔；不是学生 cohort 或研究 assignment |

   > `DATABASE_URL` / `NEXTAUTH_*` 按需要勾选环境；`MIGRATE_URL` 不可放进 Vercel。

6. **Build & Development Settings**：保持默认即可
   - `postinstall` 脚本会自动跑 `prisma generate` 生成 Client
   - Build Command 维持 `next build`
7. 点 **Deploy**，等 1~3 分钟

### 4.1 生产迁移与发布门闩

正式启用后，请在 Vercel 关闭 `main` 的自动 Production deployment。把 Vercel 的
`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`，以及 Session pooler 的
`MIGRATE_URL` 保存为 GitHub `production` environment secrets。之后每次发布只从
`main` 运行 GitHub Actions 的
**Migrate and deploy production**：workflow 会先执行全部 migration，成功后才触发
Vercel CLI 部署当前 workflow 的精确 checkout；migration 失败则不会 promotion，亦
不会出现「一个 SHA 做 migration、另一个 SHA 被 Deploy Hook 发布」的问题。

本次 `ReviewEvent` 迁移采用 expand/contract bridge：数据库 trigger 会捕捉仍在运行
的旧版本写入，迁移结束亦会再核对补齐 snapshot gap；`eventKind` 明确区分真实
`REVIEW`、`LEGACY_BRIDGE` 与 `HISTORICAL_BACKFILL`，不再用 `quality=-1` 表示语义。
新版学习页会取得短期 `StudySession` 及每词一次性 nonce；session/nonce authorization
永远开启。受控 rollout 若只欠 operationId，可把 `STUDY_OPERATION_ID_COMPAT_UNTIL`
设为未来不超过 30 分钟的 ISO 时间；server 只代为生成 operationId，截止后自动恢复严格。

首次大型 ledger backfill 前，workflow 会输出预计 event rows 与 database size；超过
100,000 rows 默认中止，必须先制定分批／监控／回滚方案。旧 writer 全部离线至少
30 分钟后，手动运行 **Contract legacy review ledger bridge** workflow，并输入
`REMOVE_LEGACY_BRIDGE`。这个 workflow 与 application expand release 分开，
会套用 `prisma/contract-migrations/` 中的正式 Prisma contract migrations；migration
若发现最近 30 分钟仍有 `LEGACY_BRIDGE` event 会直接拒绝，成功后 trigger/function
的移除亦会完整记录在 `_prisma_migrations`。普通 `npm run db:deploy` 永远不会提前
移除旧 writer bridge。

### 4.2 修正 NEXTAUTH_URL（重要）

部署完成后，Vercel 会给你一个域名（如 `https://english-xxx.vercel.app`）：

1. 回到 Vercel → 项目 → **Settings → Environment Variables**
2. 把 `NEXTAUTH_URL` 改成这个真实域名
3. **Redeploy**（Deployments → 最新那条 → 右侧菜单 → Redeploy）

---

## 第 5 步：验证线上

1. 打开 `https://你的域名.vercel.app/login`
2. 用 `student01` / 该账号获发的一次性临时密码登录
3. 按实际 assignment 确认 V1 或 V2；V2 要验证 Learning Card 3 秒 long-press reveal、
   揭示后 self-rating、Objective Probe first response、feedback acknowledgement 及安全续接
4. 确认 `STUDY_V2_ASSIGNMENT_MODE=all`、`ENABLE_TEST_ROUTES=1` 及本地测试账号开关没有进入 production
5. 核对 migration SHA、production config gate、Upstash limiter、cron、日志及 rollback target

如果报错，看 Vercel → **Logs**（或 Functions 标签），最常见的是：

- `DATABASE_URL` 密码没替换对 → 检查连接串
- `NEXTAUTH_URL` 没改成真实域名 → 第 4.1 步
- 表没建 / 没 seed → 回第 2.3 / 2.4 步确认 Supabase 有数据

---

## 常见问题

### Q: 为什么要两个连接串（DATABASE_URL + MIGRATE_URL）？

Vercel 是 serverless，每个 instance 都有自己的 driver pool。本项目明确把 pool 限为
3，并设 5 秒连接 timeout。6543 transaction pooler 适合 runtime，但 URL 必须加
`pgbouncer=true`；migration 优先 Direct connection，IPv4-only runner 使用 5432
Session pooler，而且 Session URL 不加 `pgbouncer=true`。

### Q: 以后改了 schema 怎么同步到 Supabase？

1. 本地改 `prisma/schema.prisma`。
2. 生成迁移：`npx prisma migrate dev --name <说明>`（本地开发库用）；或在已上线库上手写迁移文件 + `npx prisma migrate deploy`。
3. 重新生成 Client：`npx prisma generate`（**每次改 schema 后必做**，否则 `src/generated/prisma` 过时会引发运行时海异故障）。
4. Vercel 上 `postinstall` 只 `generate` Client，**不同步 schema**。使用 `.github/workflows/deploy-production.yml` 的 production environment gate；它先以 `MIGRATE_URL` 执行 `npm run db:deploy`，成功后才以 Vercel CLI 发布同一 checkout。不要在 Preview 或 build 阶段迁移正式数据库。

> 切勿用 `npx prisma db push` 同步生产 schema：它不写迁移历史，会造成 `_prisma_migrations` 与真实库脱节。

### Q: 以后要重新导入单词？

改 `word list.md` → `npm run seed`（幂等，已存在的词会跳过）。

### Q: 本地开发怎么连数据库？

两种方式（任选其一）：

1. **本地 Docker Postgres（推荐，离线开发）**：仓库根目录的 `docker-compose.yml` 已配好，
   `docker compose up -d` 启动后，`.env.local` 用 `.env.example` 里的本地连接串即可
   （`localhost:5432`，`DATABASE_URL` 与 `MIGRATE_URL` 相同）。
2. **直连 Supabase**：用第 1 步拿到的 pooler 连接串（`DATABASE_URL`=6543、`MIGRATE_URL`=5432）。

代码已统一为 Postgres，不再支持 SQLite。

### Q: 部署后数据库是空的怎么办？

说明第 2.3（`migrate deploy`）或 2.4（`seed`）没在本地对 Supabase 跑过。回第 2 步重做即可——数据是存在 Supabase 里的，Vercel 只是访问它。
