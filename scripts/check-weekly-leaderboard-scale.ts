/** In-memory ranking scale check for the weekly leaderboard's pure reducer. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { rankWeeklyEntries } from "../src/lib/student-weekly-leaderboard-policy";

const sizes = [40, 400, 2_000];
const results = sizes.map((size) => {
  const candidates = Array.from({ length: size }, (_, index) => ({
    studentId: `student-${String(index).padStart(5, "0")}`,
    nickname: `學習者${index}`,
    scoreMilliPoints: (size - index) % 11 === 0 ? 0 : (size - index) * 17,
    rankingState: (size - index) % 11 === 0 ? "UNRANKED" as const : (size - index) % 97 === 0 ? "PENDING_REVIEW" as const : "RANKED" as const,
  }));
  const start = performance.now();
  const ranked = rankWeeklyEntries(candidates);
  const elapsedMs = performance.now() - start;
  assert.equal(ranked.length, size);
  assert.equal(new Set(ranked.map((entry) => entry.studentId)).size, size);
  return { size, elapsedMs: Math.round(elapsedMs * 100) / 100 };
});

console.log(JSON.stringify({ ready: true, reducer: "rankWeeklyEntries", results }, null, 2));
