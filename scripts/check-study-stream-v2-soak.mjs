import { spawnSync } from "node:child_process";

const iterations = Number(process.env.STUDY_STREAM_SOAK_ITERATIONS ?? 3);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20) {
  throw new Error("STUDY_STREAM_SOAK_ITERATIONS must be an integer from 1 to 20");
}

const durations = [];
for (let index = 1; index <= iterations; index += 1) {
  const startedAt = Date.now();
  console.log(`Study Stream v2 internal soak iteration ${index}/${iterations}`);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-study-stream-v2.ts"],
    { stdio: "inherit", env: process.env },
  );
  const durationMs = Date.now() - startedAt;
  durations.push(durationMs);
  if (result.status !== 0) {
    throw new Error(
      `Study Stream v2 internal soak failed at iteration ${index} ` +
        `(status=${result.status ?? "signal"})`,
    );
  }
}

const p50 = durations.slice().sort((a, b) => a - b)[Math.floor((durations.length - 1) / 2)];
const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
const p95 = durations.slice().sort((a, b) => a - b)[p95Index];
console.log(
  `Study Stream v2 internal soak passed: iterations=${iterations}, ` +
    `p50_ms=${p50}, p95_ms=${p95}, max_ms=${Math.max(...durations)}`,
);
