# 部署到 Vercel + Supabase 完整流程

本项目已从 SQLite 切换到 **PostgreSQL**，准备部署到 **Supabase（数据库）+ Vercel（应用）**。

> 本地开发也从现在起连 Supabase Postgres（不再用 SQLite）。

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

Prisma 在两种场景用不同的连接方式，所以需要**两个环境变量**。
> ⚠️ 新版 Supabase 项目只有 **pooler 域名**（`aws-0-<region>.pooler.supabase.com`），旧的 `db.<REF>.supabase.co` 直连域名已不分配（连接会 `ENOTFOUND`）。所以 migrate/seed 也走 pooler 的 **5432（Session pooler）**，而不是直连。

| 环境变量 | 连接类型 | 端口 | 用在哪 | 为什么 |
|----------|---------|------|--------|--------|
| `DATABASE_URL` | **Transaction pooler**（PgBouncer 事务模式） | 6543 | `src/lib/prisma.ts`（运行时） | serverless 短连接多，pooler 复用连接，避免耗尽 |
| `MIGRATE_URL`  | **Session pooler**（同一个 pooler 域名，5432） | 5432 | `prisma.config.ts` / `seed.ts`（migrate / seed） | Transaction pooler（6543）不支持 DDL / prepared statements，跑 `migrate deploy` / seed 会卡死；**Session pooler（5432，带 `?pgbouncer=true`）支持 DDL** |

两者用户名都是 `postgres.<REF>` 格式（pooler 要求）。`prisma.config.ts` 读取 `MIGRATE_URL ?? DATABASE_URL`，所以本地只要在 `.env.local` 同时设好这两个即可。

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
     postgresql://postgres.[REF]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
     ```

     把 `[YOUR-PASSWORD]` 换成第 2 步设的密码 → 这就是 **`DATABASE_URL`**
   - 切到 **Session pooler**（同一个 pooler 域名，端口换成 **5432**，并加 `?pgbouncer=true`）→ 格式类似：

     ```text
     postgresql://postgres.[REF]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres?pgbouncer=true
     ```

     同样替换密码 → 这就是 **`MIGRATE_URL`**（migrate / seed 用）

   > ⚠️ 不要再用旧的 **Direct connection**（`db.[REF].supabase.co:5432`）。新版 Supabase 项目不分配该域名，连接会 `ENOTFOUND` 失败。migrate / seed 统一走 Session pooler（5432）即可。

> 💡 `[REF]` 是项目的短 ID（如 `abcdwxyz...`），在 Settings → General → Reference ID 能看到。

---

## 第 2 步：本地配置 + 建表 + 导入数据

### 2.1 创建本地 `.env.local`

在项目根目录新建 `.env.local`（已被 `.gitignore`，不会提交）：

```bash
# 粘贴第 1 步拿到的两个连接串（记得替换密码）
DATABASE_URL="postgresql://postgres.[REF]:[密码]@aws-0-[region].pooler.supabase.com:6543/postgres"
# migrate / seed 用 Session pooler（5432，必须带 ?pgbouncer=true）
MIGRATE_URL="postgresql://postgres.[REF]:[密码]@aws-0-[region].pooler.supabase.com:5432/postgres?pgbouncer=true"

# NextAuth
NEXTAUTH_SECRET="用下面命令生成的随机串"
NEXTAUTH_URL="http://localhost:3000"

SEED_STUDENTS=1
TEST_ACCOUNT_PASSWORD="你的测试账号密码"

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
```

这会用 `MIGRATE_URL`（Session pooler，5432）连 Supabase，按顺序执行 `prisma/migrations/` 里的全部迁移。
完成后去 Supabase → **Table Editor** 应该能看到 `User` / `Word` / `Review` 三张表，以及 `Level` / `Role` 两个 enum。

> ⚠️ **不要用 `npx prisma db push` 建表**。`db push` 只改表结构、不写迁移历史，会让 `_prisma_migrations` 与真实库结构脱节（本项目早期就是因此出现过 migration 重复 / `migrate status` 不一致等问题）。新环境一律用 `migrate deploy`，保证迁移历史可由空库重放。
>
> 已在全新空数据库上实测：5 个迁移可由头到尾全部成功（不再出现 `type "Role" already exists` / `column "role" already exists`），seed 也能正常导入。详见 `PLAN.md` 的「迁移历史」一节。

### 2.4 导入单词数据 + 账号

```powershell
npm run seed
```

会创建：

- `word list.md` 里的所有单词
- 管理员账号 `admin`、教师账号 `teacher`（密码 = 你设的 `INITIAL_ADMIN_PASSWORD`）
- `student01` ~ `student40`（密码统一 `english123`，需在 `.env.local` 设 `SEED_STUDENTS=1`）
- 测试账号 `qa-4347e0aa14`（密码是你设的 `TEST_ACCOUNT_PASSWORD`）

> ⚠️ `INITIAL_ADMIN_PASSWORD` 必填；未设置时 seed 会直接抛错中止（安全审计要求：禁止硬编码密码）。

### 2.5 本地验证

```powershell
npm run dev
```

打开 <http://localhost:3000/login，用> `student01` / `english123` 登录，确认能正常学习。
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
   | `MIGRATE_URL`  | （第 1 步的 Session pooler，5432，带 `?pgbouncer=true`） | 构建期 / 本地 migrate / seed 用（**可选**：Vercel 构建默认只 `generate`，不同步 schema） |
   | `NEXTAUTH_SECRET` | （和本地一样的那串） | 生产环境要重新生成一串新的也行 |
   | `NEXTAUTH_URL` | `https://你的应用名.vercel.app` | 部署后 Vercel 会给你域名；**首次可先留空或填预计域名，部署拿到真实域名后再回来改** |
   | `INITIAL_ADMIN_PASSWORD` | （和本地一样） | 仅 seed 时需要；Vercel 上一般不在构建期跑 seed |
   | `TEST_ACCOUNT_PASSWORD` | （和本地一样） | 可选 |

   > 勾选所有环境（Production / Preview / Development）。

6. **Build & Development Settings**：保持默认即可
   - `postinstall` 脚本会自动跑 `prisma generate` 生成 Client
   - Build Command 维持 `next build`
7. 点 **Deploy**，等 1~3 分钟

### 4.1 修正 NEXTAUTH_URL（重要）

部署完成后，Vercel 会给你一个域名（如 `https://english-xxx.vercel.app`）：

1. 回到 Vercel → 项目 → **Settings → Environment Variables**
2. 把 `NEXTAUTH_URL` 改成这个真实域名
3. **Redeploy**（Deployments → 最新那条 → 右侧菜单 → Redeploy）

---

## 第 5 步：验证线上

1. 打开 `https://你的域名.vercel.app/login`
2. 用 `student01` / `english123` 登录
3. 确认能加载单词、滑动学习、记录进度

如果报错，看 Vercel → **Logs**（或 Functions 标签），最常见的是：

- `DATABASE_URL` 密码没替换对 → 检查连接串
- `NEXTAUTH_URL` 没改成真实域名 → 第 4.1 步
- 表没建 / 没 seed → 回第 2.3 / 2.4 步确认 Supabase 有数据

---

## 常见问题

### Q: 为什么要两个连接串（DATABASE_URL + MIGRATE_URL）？

Vercel 是 serverless，每个请求可能新建数据库连接。**Transaction pooler（6543）** 复用连接，适合 serverless 运行时（但它是 PgBouncer 事务模式，不支持 DDL / prepared statements）。**Session pooler（5432）** 支持完整 DDL，所以 migrate / seed 走它（`MIGRATE_URL`）。两者都是同一个 pooler 域名，只是端口不同；旧版 Supabase 的 `db.<REF>` 直连域名已不可用。

### Q: 以后改了 schema 怎么同步到 Supabase？

1. 本地改 `prisma/schema.prisma`。
2. 生成迁移：`npx prisma migrate dev --name <说明>`（本地开发库用）；或在已上线库上手写迁移文件 + `npx prisma migrate deploy`。
3. 重新生成 Client：`npx prisma generate`（**每次改 schema 后必做**，否则 `src/generated/prisma` 过时会引发运行时海异故障）。
4. Vercel 上 `postinstall` 只 `generate` Client，**不同步 schema**——schema 变更要在本地 / CI 用 `migrate deploy` 先推到 Supabase。

> 切勿用 `npx prisma db push` 同步生产 schema：它不写迁移历史，会造成 `_prisma_migrations` 与真实库脱节。

### Q: 以后要重新导入单词？

改 `word list.md` → `npm run seed`（幂等，已存在的词会跳过）。

### Q: 本地还能用 SQLite 吗？

不能了。代码已统一切到 Postgres。旧的 SQLite schema 备份在 `prisma/schema.sqlite.prisma`，本地数据库 `prisma/dev.db` 仍在但不再使用。

### Q: 部署后数据库是空的怎么办？

说明第 2.3（`migrate deploy`）或 2.4（`seed`）没在本地对 Supabase 跑过。回第 2 步重做即可——数据是存在 Supabase 里的，Vercel 只是访问它。
