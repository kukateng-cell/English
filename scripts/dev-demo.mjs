import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Command failed (${code})`)));
  });
}

try {
  await run(["--import", "tsx", "scripts/demo-school.ts", "update"]);
  await run(["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development startup failed");
  process.exitCode = 1;
}
