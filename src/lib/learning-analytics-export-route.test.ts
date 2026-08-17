import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@/generated/prisma";
import { createLearningAnalyticsExportPost, type ExportRouteDependencies } from "@/app/api/learning-analytics/export/route";
import type { LearningAnalyticsExportRequest } from "@/lib/learning-analytics";
import type { AnalyticsExportResult } from "@/lib/learning-analytics-export-http";

const request: LearningAnalyticsExportRequest = {
  scope: "STUDENTS",
  format: "CSV",
  fromDate: "2026-08-01",
  toDate: "2026-08-01",
  comparisonGranularity: "DAY",
};

const result = {
  rows: [{ rowType: "STUDENT", accountName: "student-001" }],
  requestedRange: { fromDate: request.fromDate, toDate: request.toDate },
  effectiveRange: { from: request.fromDate, to: request.toDate, rangeClamped: false },
  timezone: "Asia/Shanghai",
  cohortBasis: "CURRENT_MEMBERSHIP",
  asOf: "2026-08-01T00:00:00.000Z",
  granularity: "DAY",
  scope: request.scope,
  year: "2026–2027",
  rowCount: 1,
} as unknown as AnalyticsExportResult;

function recentSnapshot() {
  return {
    sessionJti: "session-jti",
    user: { tokenVersion: 3, credentialRevision: 4 },
    grant: {
      reauthenticatedAt: new Date("2026-08-17T00:00:00.000Z"),
      expiresAt: new Date("2026-08-17T00:15:00.000Z"),
    },
  } as NonNullable<Awaited<ReturnType<ExportRouteDependencies["readRecentAuthGrantSnapshot"]>>>;
}

function dependencies(overrides: Partial<ExportRouteDependencies> = {}): ExportRouteDependencies {
  const base: ExportRouteDependencies = {
    requireRole: async () => ({ ok: true, userId: "teacher-1", role: "TEACHER" as Role }),
    isSameOriginMutation: () => true,
    readRecentAuthGrantSnapshot: async () => recentSnapshot(),
    checkLimit: async () => ({ ok: true }),
    getClientIp: () => "127.0.0.1",
    readLearningAnalyticsExportRequest: async () => request,
    exportLearningAnalytics: async () => result,
    serializeAnalyticsCsv: () => "\uFEFF報告",
    serializeAnalyticsXlsx: async () => new Uint8Array([1, 2, 3]),
    recordExportAudit: async () => undefined,
  };
  return { ...base, ...overrides };
}

async function readCode(response: Response) {
  return (await response.json()) as { code: string };
}

test("analytics export route enforces same-origin before authentication", async () => {
  let authCalled = false;
  const handler = createLearningAnalyticsExportPost(dependencies({
    isSameOriginMutation: () => false,
    requireRole: async () => {
      authCalled = true;
      return { ok: true, userId: "teacher-1", role: "TEACHER" as Role };
    },
  }));
  const response = await handler(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await readCode(response), { code: "CSRF_ORIGIN_INVALID" });
  assert.equal(authCalled, false);
});

test("analytics export route maps auth, recent-auth and limiter failures without PII", async () => {
  const unauthenticated = createLearningAnalyticsExportPost(dependencies({ requireRole: async () => ({ ok: false, status: 503, message: "unavailable" }) }));
  assert.equal((await unauthenticated(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }))).status, 503);

  const authBackendFailure = createLearningAnalyticsExportPost(dependencies({ requireRole: async () => { throw new Error("database unavailable"); } }));
  const authFailureResponse = await authBackendFailure(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(authFailureResponse.status, 503);
  assert.deepEqual(await readCode(authFailureResponse), { code: "AUTH_BACKEND_UNAVAILABLE" });

  const recentAuthMissing = createLearningAnalyticsExportPost(dependencies({ readRecentAuthGrantSnapshot: async () => null }));
  const recentResponse = await recentAuthMissing(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(recentResponse.status, 401);
  assert.deepEqual(await readCode(recentResponse), { code: "RECENT_AUTH_REQUIRED" });

  const limiterUnavailable = createLearningAnalyticsExportPost(dependencies({ checkLimit: async () => ({ ok: false, backendUnavailable: true }) }));
  const limiterResponse = await limiterUnavailable(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(limiterResponse.status, 503);
  assert.deepEqual(await readCode(limiterResponse), { code: "RATE_LIMIT_BACKEND_UNAVAILABLE" });
});

test("analytics export route audits only after serialization and never returns an unaudited report", async () => {
  let audited = 0;
  let serialized = 0;
  const success = createLearningAnalyticsExportPost(dependencies({
    serializeAnalyticsCsv: () => {
      serialized += 1;
      return "\uFEFF報告";
    },
    recordExportAudit: async () => {
      audited += 1;
    },
  }));
  const response = await success(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(response.status, 200);
  assert.equal(serialized, 1);
  assert.equal(audited, 1);
  assert.equal(response.headers.get("X-Export-Row-Count"), "1");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");

  const auditFailure = createLearningAnalyticsExportPost(dependencies({
    serializeAnalyticsCsv: () => {
      serialized += 1;
      return "\uFEFF報告";
    },
    recordExportAudit: async () => {
      throw new Error("AUDIT_BACKEND_UNAVAILABLE");
    },
  }));
  const failed = await auditFailure(new Request("http://localhost/api/learning-analytics/export", { method: "POST" }));
  assert.equal(failed.status, 503);
  assert.deepEqual(await readCode(failed), { code: "AUDIT_BACKEND_UNAVAILABLE" });
  assert.equal(serialized, 2);
});
