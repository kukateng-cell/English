import assert from "node:assert/strict";
import test from "node:test";
import { readRewardRequest } from "@/lib/learning-reward-analytics";

function request(body: unknown) {
  return new Request("http://localhost/api/learning-analytics/rewards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("reward query request applies the stable default policy and accepts bounded filters", async () => {
  const parsed = await readRewardRequest(request({
    range: { fromDate: "2026-08-01", toDate: "2026-08-31" },
    grade: "JUNIOR_1",
    classIds: ["class-b", "class-a"],
    weights: { effort: 40, outcome: 60 },
    policyVersion: "reward-v1",
    limit: 25,
  }), { route: "QUERY" });

  assert.deepEqual(parsed.weights, { effort: 40, outcome: 60 });
  assert.deepEqual(parsed.classIds, ["class-a", "class-b"]);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.policyVersion, "reward-v1");
});

test("reward request rejects ambiguous range, unbalanced weights, and first-page context", async () => {
  await assert.rejects(
    () => readRewardRequest(request({ range: { fromDate: "2026-08-01" }, toDate: "2026-08-31" }), { route: "QUERY" }),
    /QUERY_INVALID/,
  );
  await assert.rejects(
    () => readRewardRequest(request({ weights: { effort: 40, outcome: 40 } }), { route: "QUERY" }),
    /QUERY_INVALID/,
  );
  await assert.rejects(
    () => readRewardRequest(request({ asOf: "2026-08-31T00:00:00.000Z", scopeToken: "signed" }), { route: "QUERY" }),
    /QUERY_INVALID/,
  );
});

test("timeline and export requests require a server-issued context", async () => {
  await assert.rejects(
    () => readRewardRequest(request({}), { route: "TIMELINE" }),
    /QUERY_INVALID/,
  );
  const parsed = await readRewardRequest(request({
    asOf: "2026-08-31T00:00:00.000Z",
    scopeToken: "signed-context",
    format: "CSV",
  }), { route: "EXPORT" });
  assert.equal(parsed.format, "CSV");
});
