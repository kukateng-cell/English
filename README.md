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

复制 `.env.example` 为 `.env` 并按需填写：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Prisma 数据库连接串（本地 SQLite 或生产 PostgreSQL） |
| `NEXTAUTH_SECRET` | ✅ | JWT 签名密钥，生产请用 `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | 应用根 URL（本地为 `http://localhost:3000`） |
| `UPSTASH_REDIS_REST_URL` | ⚠️ 生产必填 | 登录限流用的 Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ⚠️ 生产必填 | 登录限流用的 Upstash Redis REST Token |

### 登录限流（Upstash Redis）

登录限流基于 `@upstash/ratelimit` + `@upstash/redis`，按「账号」与「来源 IP」双维度
滑动窗口限流：**同一账号或同一 IP 每 1 分钟最多 5 次登录尝试**，超出即拒绝并返回剩余等待秒数。
分布式存储确保 Serverless / 多实例（如 Vercel）部署下计数共享、无法被绕过。

**未配置** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 时，会自动降级为
**单实例内存限流**（仅适合本地开发，多副本下计数不共享、可被绕过，启动时会打印一条警告）。

配置步骤：

1. 到 [upstash.com](https://upstash.com) 注册并创建一个 Redis 数据库（Global 或 Regional）。
2. 在该数据库的 **REST API** 页面复制 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`。
3. 写入本地 `.env`，或填入 Vercel 项目的 **Settings → Environment Variables**。
4. 重新部署即可；限流键统一带前缀 `login:`，便于在 Upstash 控制台辨识。

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
