/**
 * Vercel 构建预置脚本：
 * 仅在 Vercel 部署环境执行 prisma migrate deploy，自动同步数据库 schema。
 * 本地开发和 GitHub Actions CI 不会执行数据库操作。
 */
const { execSync } = require("child_process");

if (process.env.VERCEL === "1") {
  console.log("🔄 Vercel 环境检测，执行 prisma migrate deploy...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  console.log("✅ 数据库迁移完成");
} else {
  console.log("⏭️ 非 Vercel 环境，跳过数据库迁移");
}
