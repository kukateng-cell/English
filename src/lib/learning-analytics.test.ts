import assert from "node:assert/strict";
import test from "node:test";
import { readAnalyticsQuery } from "@/lib/learning-analytics";

async function parse(body: unknown, headers?: HeadersInit) {
  return readAnalyticsQuery(new Request("http://localhost/api/learning-analytics/query", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  }));
}

test("analytics parser applies the 30-day default and normalizes search", async () => {
  const query = await parse({ search: "  demo   學生  ", classIds: ["class-a"] });
  assert.equal(query.search, "demo 學生");
  assert.equal(query.classIds?.length, 1);
  assert.equal(query.limit, 50);
  assert.equal(query.sort, "ACCOUNT_ASC");
  assert.ok(query.fromDate < query.toDate);
});

test("analytics parser rejects duplicate selections, unknown fields and oversized cursors", async () => {
  await assert.rejects(() => parse({ classIds: ["a", "a"] }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ unexpected: true }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ cursor: "x".repeat(2049) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ compareStudentIds: ["a", "a"] }), /QUERY_INVALID/);
});

test("analytics parser enforces range, body and selection limits", async () => {
  await assert.rejects(() => parse({ range: { fromDate: "2026-01-01", toDate: "2026-07-01" } }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ classIds: Array.from({ length: 7 }, (_, index) => `class-${index}`) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ compareStudentIds: Array.from({ length: 9 }, (_, index) => `student-${index}`) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ asOf: new Date(Date.now() + 60_000).toISOString() }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ search: "x".repeat(81) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ limit: 0 }), /QUERY_INVALID/);

  const oversized = new Request("http://localhost/api/learning-analytics/query", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
    body: JSON.stringify({}),
  });
  await assert.rejects(() => readAnalyticsQuery(oversized), /PAYLOAD_TOO_LARGE/);
});

test("analytics parser accepts the inclusive 180-day boundary", async () => {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 179 * 86_400_000).toISOString().slice(0, 10);
  const query = await parse({ range: { fromDate, toDate: to }, compareStudentIds: ["student-1"] });
  assert.equal(query.fromDate, fromDate);
  assert.equal(query.toDate, to);
});
