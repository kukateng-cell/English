This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page in `src/app/`. The page auto-updates as you edit the file.

## 环境变量（Environment Variables）

复制 `.env.example` 为 `.env.local` 并按需填写：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | 应用运行时 PostgreSQL 连接串 |
| `MIGRATE_URL` | ✅（迁移/seed） | PostgreSQL Session/direct 连接串；不会回退到 runtime URL |
| `NEXTAUTH_SECRET` | ✅ | JWT 签名密钥，生产请用 `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | 应用根 URL（本地为 `http://localhost:3000`） |
| `UPSTASH_REDIS_REST_URL` | ⚠️ 生产必填 | 登录限流用的 Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ⚠️ 生产必填 | 登录限流用的 Upstash Redis REST Token |
| `CRON_SECRET` | ⚠️ 生产必填 | Vercel StudySession cleanup cron 的 Bearer secret |
| `DATABASE_POOL_MAX` | 否 | 每个 serverless instance 的 pg pool 上限，默认 3 |

### 登录限流（Upstash Redis）

登录限流基于 `@upstash/ratelimit` + `@upstash/redis`，按「账号」与「来源 IP」双维度
滑动窗口限流：**同一账号每分钟最多 5 次、同一来源 IP 每分钟最多 120 次**。
账号桶负责防暴力破解；较宽的 IP 桶只作预认证防洪，避免同一校园/NAT 下正常集体登录被误封。
分布式存储确保 Serverless / 多实例（如 Vercel）部署下计数共享、无法被绕过。

本地未配置时会降级为单实例内存限流；Vercel production 未配置则直接拒绝
build／启动，避免多副本下静默使用可绕过的 limiter。

配置步骤：

1. 到 [upstash.com](https://upstash.com) 注册并创建一个 Redis 数据库（Global 或 Regional）。
2. 在该数据库的 **REST API** 页面复制 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。
3. 写入本地 `.env`，或填入 Vercel 项目的 **Settings → Environment Variables**。
4. 重新部署即可；限流键统一带前缀 `login:`，便于在 Upstash 控制台辨识。

### 可直接登入的本地测试学生

若不想每次用 `student01` 测试时都走首次改密流程，可在 `.env.local` 设置：

```env
SEED_TEST_STUDENT=1
TEST_STUDENT_USERNAME="__test_student__local"
TEST_STUDENT_PASSWORD="只用于本地测试的独立密码"
```

运行 `npm run seed` 后，该学生会以 `mustChangePassword=false` 建立，可直接登入学习页；
若账号已经存在，seed 会停止而不会覆盖现有账号。此功能须在生产保持关闭。

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
