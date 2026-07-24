import { execSync } from "node:child_process";

if (process.env.VERCEL === "1") {
  console.log("🔄 Vercel 环境检测，执行 prisma migrate deploy...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  console.log("✅ 数据库迁移完成");
} else {
  console.log("⏭️ 非 Vercel 环境，跳过数据库迁移");
}
