import assert from "node:assert/strict";
import test from "node:test";
import { analyticsStudentCursorFingerprint, classifyObjectiveEvent, comparisonPeriods, countEncountersForLocalDate, isObjectiveEventCandidate, objectiveEventKindBucket, readAnalyticsQuery, readLearningAnalyticsExportRequest, shouldIncludeUnassignedClassReport, shouldRejectUnfilteredClassExport } from "@/lib/learning-analytics";
import { MAX_ANALYTICS_CLASS_SELECTION, MAX_ANALYTICS_EXPORT_BODY_BYTES } from "@/lib/learning-analytics-contract";

async function parse(body: unknown, headers?: HeadersInit) {
  return readAnalyticsQuery(new Request("http://localhost/api/learning-analytics/query", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  }));
}

async function parseRoute(body: unknown, route: "STUDENTS" | "CLASSES" | "TIMELINE") {
  return readAnalyticsQuery(new Request("http://localhost/api/learning-analytics/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { route });
}

async function parseExport(body: unknown) {
  return readLearningAnalyticsExportRequest(new Request("http://localhost/api/learning-analytics/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

test("analytics export parser freezes scope, format and bounded selections", async () => {
  const request = await parseExport({ scope: "CLASSES", format: "XLSX", range: { fromDate: "2026-07-01", toDate: "2026-07-31" }, classIds: ["class-a"], comparisonGranularity: "WEEK" });
  assert.equal(request.scope, "CLASSES");
  assert.equal(request.format, "XLSX");
  assert.equal(request.comparisonGranularity, "WEEK");
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", studentIds: ["a", "a"] }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "CLASSES", format: "CSV", studentIds: ["a"] }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "CLASSES", format: "CSV", search: "學生" }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", unknown: true }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", search: 123 }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", studentIds: ["a"], search: "學生" }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", grade: "NOT_A_GRADE" }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "CLASSES", format: "CSV", grade: "NOT_A_GRADE" }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", range: [] }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", range: null }), /QUERY_INVALID/);
  const exportDefault = await parseExport({ scope: "STUDENTS", format: "CSV" });
  assert.equal(exportDefault.comparisonGranularity, "DAY");
});

test("student exports are not rejected by the class comparison cap", () => {
  assert.equal(shouldRejectUnfilteredClassExport("STUDENTS", false, MAX_ANALYTICS_CLASS_SELECTION + 1), false);
  assert.equal(shouldRejectUnfilteredClassExport("CLASSES", false, MAX_ANALYTICS_CLASS_SELECTION + 1), true);
  assert.equal(shouldRejectUnfilteredClassExport("CLASSES", true, MAX_ANALYTICS_CLASS_SELECTION + 1), false);
});

test("analytics keeps bridge events out of operational objective metrics", () => {
  assert.equal(objectiveEventKindBucket("REVIEW", false), "review");
  assert.equal(objectiveEventKindBucket("LEGACY_BRIDGE", false), "bridge");
  assert.equal(objectiveEventKindBucket("HISTORICAL_BACKFILL", true), "historical");
});

test("analytics treats incomplete V2 objective rows as candidates with missing provenance", () => {
  type ObjectiveEvent = Parameters<typeof classifyObjectiveEvent>[0];
  const base: ObjectiveEvent = {
    id: "event-1",
    operationId: "operation-1",
    userId: "student-1",
    submittedWordId: "word-1",
    wordId: "word-1",
    senseId: "sense-1",
    contentRevisionId: "content-1",
    catalogRevisionId: "catalog-1",
    quality: 4,
    createdAt: new Date("2026-08-17T08:00:00.000Z"),
    eventKind: "REVIEW",
    isHistorical: false,
    evidenceKind: null,
    flowVersion: "v2",
    qualityPolicyVersion: null,
    itemConstructionVersion: null,
    probePurpose: null,
    objectiveEvidenceTargetId: null,
    objectiveQuestionSnapshotId: null,
    objectiveEvidenceTarget: null,
  };
  assert.equal(isObjectiveEventCandidate(base), true);
  assert.equal(classifyObjectiveEvent(base), "missingProvenance");

  const missingTarget: ObjectiveEvent = {
    ...base,
    evidenceKind: "OBJECTIVE_PROBE",
    probePurpose: "DUE_REVIEW",
    objectiveEvidenceTargetId: "target-1",
    objectiveQuestionSnapshotId: "snapshot-1",
  };
  assert.equal(classifyObjectiveEvent(missingTarget), "missingProvenance");

  const targetWithoutSnapshot: NonNullable<ObjectiveEvent["objectiveEvidenceTarget"]> = {
    id: "target-1",
    userId: "student-1",
    wordId: "word-1",
    senseId: "sense-1",
    policyVersion: "retrieval-v1",
    itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
    status: "CONSUMED",
    winningOperationId: "operation-1",
    winningReviewEventId: "event-1",
    purpose: "DUE_REVIEW",
    obligation: null,
    questionSnapshot: null,
  };
  assert.equal(classifyObjectiveEvent({ ...missingTarget, objectiveEvidenceTarget: targetWithoutSnapshot }), "missingProvenance");

  const nonWinningTarget = {
    ...targetWithoutSnapshot,
    status: "SUPERSEDED",
    questionSnapshot: {
      id: "snapshot-1",
      targetId: "target-1",
      wordId: "word-1",
      senseId: "sense-1",
      contentRevisionId: "content-1",
      catalogRevisionId: "catalog-1",
      contentVersion: "retrieval-v1-mcq-curated-v2",
      itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
    },
  } satisfies NonNullable<ObjectiveEvent["objectiveEvidenceTarget"]>;
  assert.equal(classifyObjectiveEvent({ ...missingTarget, objectiveEvidenceTarget: nonWinningTarget }), "nonWinning");
});

test("unassigned class summary is limited to an admin full-range report", () => {
  assert.equal(shouldIncludeUnassignedClassReport("ADMIN", false), true);
  assert.equal(shouldIncludeUnassignedClassReport("ADMIN", true), false);
  assert.equal(shouldIncludeUnassignedClassReport("TEACHER", false), false);
});

test("export parser can carry the documented 500-student selection", async () => {
  const studentIds = Array.from({ length: 500 }, (_, index) => `student-${String(index).padStart(3, "0")}-${"x".repeat(110)}`);
  const body = JSON.stringify({ scope: "STUDENTS", format: "CSV", studentIds });
  assert.ok(Buffer.byteLength(body, "utf8") < MAX_ANALYTICS_EXPORT_BODY_BYTES);
  const request = await parseExport(JSON.parse(body) as Record<string, unknown>);
  assert.equal(request.studentIds?.length, 500);

  const oversized = new Request("http://localhost/api/learning-analytics/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: `${JSON.stringify({ scope: "STUDENTS", format: "CSV" })}${" ".repeat(MAX_ANALYTICS_EXPORT_BODY_BYTES)}`,
  });
  await assert.rejects(() => readLearningAnalyticsExportRequest(oversized), /PAYLOAD_TOO_LARGE/);
});

test("analytics parser applies the 30-day default and normalizes search", async () => {
  const query = await parse({ search: "  demo   學生  ", classIds: ["class-a"] });
  assert.equal(query.search, "demo 學生");
  assert.equal(query.classIds?.length, 1);
  assert.equal(query.limit, 50);
  assert.equal(query.sort, "STUDENT_NUMBER_ASC");
  assert.equal(query.comparisonGranularity, "DAY");
  assert.ok(query.fromDate < query.toDate);
});

test("analytics parser rejects duplicate selections, unknown fields and oversized cursors", async () => {
  await assert.rejects(() => parse({ classIds: ["a", "a"] }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ unexpected: true }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ cursor: "x".repeat(2049) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ compareStudentIds: ["a", "a"] }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ limit: "50" }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ limit: true }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ limit: null }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ range: [] }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ range: null }), /QUERY_INVALID/);
});

test("analytics parser rejects null values instead of treating them as omitted", async () => {
  await assert.rejects(() => readAnalyticsQuery(new Request("http://localhost", { method: "POST", body: JSON.stringify({ search: null }) })), /QUERY_INVALID/);
  await assert.rejects(() => readAnalyticsQuery(new Request("http://localhost", { method: "POST", body: JSON.stringify({ grade: null }) })), /QUERY_INVALID/);
  await assert.rejects(() => readAnalyticsQuery(new Request("http://localhost", { method: "POST", body: JSON.stringify({ asOf: null }) })), /QUERY_INVALID/);
});

test("analytics route parsers reject fields belonging to another endpoint", async () => {
  await assert.rejects(() => parseRoute({ search: "學生" }, "CLASSES"), /QUERY_INVALID/);
  await assert.rejects(() => parseRoute({ classIds: ["class-a"] }, "STUDENTS"), /QUERY_INVALID/);
  await assert.rejects(() => parseRoute({ classFilter: { kind: "CLASS", classId: "class-a" } }, "TIMELINE"), /QUERY_INVALID/);
});

test("analytics class filters are strict nested objects", async () => {
  const unassigned = await parse({ classFilter: { kind: "UNASSIGNED" } });
  assert.equal(unassigned.classFilter?.kind, "UNASSIGNED");
  await assert.rejects(() => parse({ classFilter: { kind: "UNASSIGNED", classId: "unexpected" } }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ classFilter: { kind: "CLASS", classId: "class-a", extra: true } }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ classFilter: [] }), /QUERY_INVALID/);
});

test("analytics parser enforces range, body and selection limits", async () => {
  await assert.rejects(() => parse({ range: { fromDate: "2026-01-01", toDate: "2026-07-01" } }), /QUERY_INVALID/);
  const maximum = await parse({ classIds: Array.from({ length: MAX_ANALYTICS_CLASS_SELECTION }, (_, index) => `class-${index}`) });
  assert.equal(maximum.classIds?.length, MAX_ANALYTICS_CLASS_SELECTION);
  await assert.rejects(() => parse({ classIds: Array.from({ length: MAX_ANALYTICS_CLASS_SELECTION + 1 }, (_, index) => `class-${index}`) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ compareStudentIds: Array.from({ length: 9 }, (_, index) => `student-${index}`) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ asOf: new Date(Date.now() + 60_000).toISOString() }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ search: "x".repeat(81) }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ limit: 0 }), /QUERY_INVALID/);
  await assert.rejects(() => parse({ range: { fromDate: "2026-07-01", toDate: "2026-07-02" }, fromDate: "2026-07-01" }), /QUERY_INVALID/);
  await assert.rejects(() => parseExport({ scope: "STUDENTS", format: "CSV", range: { fromDate: "2026-07-01", toDate: "2026-07-02" }, toDate: "2026-07-02" }), /QUERY_INVALID/);

  const oversized = new Request("http://localhost/api/learning-analytics/query", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(16 * 1024 + 1) },
    body: JSON.stringify({}),
  });
  await assert.rejects(() => readAnalyticsQuery(oversized), /PAYLOAD_TOO_LARGE/);
});

test("analytics parser cancels an oversized chunked body without Content-Length", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(8 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/learning-analytics/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(() => readAnalyticsQuery(request), /PAYLOAD_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4, `analytics body was over-read: ${pulls}`);
});

test("analytics parser accepts the inclusive 180-day boundary", async () => {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 179 * 86_400_000).toISOString().slice(0, 10);
  const query = await parse({ range: { fromDate, toDate: to }, compareStudentIds: ["student-1"] });
  assert.equal(query.fromDate, fromDate);
  assert.equal(query.toDate, to);
});

test("analytics parser accepts only the supported comparison granularities", async () => {
  for (const comparisonGranularity of ["DAY", "WEEK", "MONTH"] as const) {
    const query = await parse({ comparisonGranularity });
    assert.equal(query.comparisonGranularity, comparisonGranularity);
  }
  await assert.rejects(() => parse({ comparisonGranularity: "YEAR" }), /QUERY_INVALID/);
});

test("analytics student cursor fingerprint binds comparison selection and granularity", () => {
  const base = {
    role: "TEACHER" as const,
    userId: "teacher-1",
    range: { requestedFrom: "2026-07-01", requestedTo: "2026-07-30", from: "2026-07-01", to: "2026-07-30", rangeClamped: false, timezone: "Asia/Shanghai" },
    asOf: new Date("2026-07-30T00:00:00.000Z"),
    sort: "STUDENT_NUMBER_ASC" as const,
    limit: 50,
  };
  const day = analyticsStudentCursorFingerprint({ ...base, compareStudentIds: ["student-2", "student-1"], comparisonGranularity: "DAY" });
  const reordered = analyticsStudentCursorFingerprint({ ...base, compareStudentIds: ["student-1", "student-2"], comparisonGranularity: "DAY" });
  const month = analyticsStudentCursorFingerprint({ ...base, compareStudentIds: ["student-1", "student-2"], comparisonGranularity: "MONTH" });
  const differentStudent = analyticsStudentCursorFingerprint({ ...base, compareStudentIds: ["student-3"], comparisonGranularity: "DAY" });
  assert.equal(day, reordered);
  assert.notEqual(day, month);
  assert.notEqual(day, differentStudent);
});

test("comparison periods cover the selected range without overlap", () => {
  assert.deepEqual(comparisonPeriods("2026-01-28", "2026-02-03", "WEEK"), [
    { periodStart: "2026-01-28", periodEnd: "2026-02-01" },
    { periodStart: "2026-02-02", periodEnd: "2026-02-03" },
  ]);
  assert.deepEqual(comparisonPeriods("2026-01-29", "2026-03-02", "MONTH"), [
    { periodStart: "2026-01-29", periodEnd: "2026-01-31" },
    { periodStart: "2026-02-01", periodEnd: "2026-02-28" },
    { periodStart: "2026-03-01", periodEnd: "2026-03-02" },
  ]);
  const days = comparisonPeriods("2026-02-01", "2026-02-03", "DAY");
  assert.deepEqual(days, [
    { periodStart: "2026-02-01", periodEnd: "2026-02-01" },
    { periodStart: "2026-02-02", periodEnd: "2026-02-02" },
    { periodStart: "2026-02-03", periodEnd: "2026-02-03" },
  ]);
});

test("today recognition count uses the Shanghai calendar date and as-of boundary", () => {
  const rows = [
    { acknowledgedAt: new Date("2026-08-17T15:30:00.000Z") }, // 2026-08-17 23:30 in Shanghai
    { acknowledgedAt: new Date("2026-08-17T16:30:00.000Z") }, // 2026-08-18 00:30 in Shanghai
    { acknowledgedAt: new Date("2026-08-17T14:00:00.000Z") },
  ];
  assert.equal(countEncountersForLocalDate(rows, "2026-08-17", new Date("2026-08-17T15:45:00.000Z")), 2);
  assert.equal(countEncountersForLocalDate(rows, "2026-08-18", new Date("2026-08-17T15:45:00.000Z")), 0);
});
