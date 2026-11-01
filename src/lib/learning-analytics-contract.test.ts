import assert from "node:assert/strict";
import { test } from "node:test";
import { millisecondsUntilNextShanghaiMidnight } from "@/lib/learning-analytics-contract";

test("距離東八區午夜的毫秒數在日界前後都正確", () => {
  // 2026-11-01 23:59:30 +08:00 → 距離 00:00 尚有 30 秒（另加 5 秒緩衝）。
  assert.equal(
    millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T23:59:30+08:00"), 5_000),
    35_000,
  );
  // 剛過 00:00:00 時應排到下一個午夜，即接近 24 小時。
  assert.equal(
    millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T00:00:00+08:00"), 5_000),
    86_400_000 + 5_000,
  );
  // 正午時距離下一個午夜為 12 小時。
  assert.equal(
    millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T12:00:00+08:00"), 0),
    43_200_000,
  );
});

test("以 UTC 表示同一時刻時結果一致", () => {
  assert.equal(
    millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T15:30:00Z"), 5_000),
    30 * 60 * 1000 + 5_000,
  );
  assert.equal(
    millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T16:00:00Z"), 0),
    86_400_000,
  );
});

test("結果不會是負數", () => {
  assert.equal(millisecondsUntilNextShanghaiMidnight(new Date("2026-11-01T16:00:00Z"), -60_000), 86_340_000);
  assert.ok(millisecondsUntilNextShanghaiMidnight(new Date(), 0) >= 0);
});
