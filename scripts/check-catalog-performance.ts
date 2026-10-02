import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import type { CatalogSourceRow } from "../src/lib/catalog/csv";
import type { CatalogGovernancePayload } from "../src/lib/catalog/governance";

dotenv.config({ path: ".env.local", override: true });

const environment = process.env.DATABASE_ENVIRONMENT;
if (!process.env.MIGRATE_URL) throw new Error("MIGRATE_URL is required");
if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
  throw new Error("test:catalog:performance requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
}
process.env.DATABASE_URL = process.env.MIGRATE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.MIGRATE_URL }),
});

const HISTORY_ROWS = 5_000;
const BULK_ROWS = 200;
const PREVIEW_RUNS = 5;
const STUDENT_CONCURRENCY_PER_PATH = 50;
const FIXTURE_ACCOUNT_PREFIX = "catalog-perf-";
const FIXTURE_REQUEST_PREFIX = "catalog-perf:";
const FIXTURE_FILE_PREFIX = "catalog-performance-";
const FIXTURE_TERM_PREFIX = "catalogperf";

type TimingSummary = {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
};

type NumericSummary = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
};

type PlanSummary = {
  planningMs: number | null;
  executionMs: number | null;
  rootNode: string | null;
  sharedHitBlocks: number | null;
  sharedReadBlocks: number | null;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(samples: number[]): TimingSummary {
  assert.ok(samples.length > 0, "timing samples are required");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!;
  return {
    count: samples.length,
    minMs: round(sorted[0]!),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)!),
    meanMs: round(samples.reduce((total, sample) => total + sample, 0) / samples.length),
  };
}

function summarizeNumbers(samples: number[]): NumericSummary {
  const summary = summarize(samples);
  return {
    count: summary.count,
    min: summary.minMs,
    p50: summary.p50Ms,
    p95: summary.p95Ms,
    max: summary.maxMs,
    mean: summary.meanMs,
  };
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - startedAt };
}

async function withPeakRss<T>(operation: () => Promise<T>): Promise<{ value: T; peakRssDeltaMiB: number }> {
  const start = process.memoryUsage().rss;
  let peak = start;
  const interval = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  interval.unref();
  try {
    return { value: await operation(), peakRssDeltaMiB: round((peak - start) / 1024 / 1024) };
  } finally {
    clearInterval(interval);
  }
}

function chunks<T>(values: T[], size = 250): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function planSummary(value: Prisma.JsonValue | null | undefined): PlanSummary {
  const first = Array.isArray(value) ? value[0] : null;
  const record = first && typeof first === "object" && !Array.isArray(first) ? first as Record<string, unknown> : null;
  const plan = record?.Plan && typeof record.Plan === "object" && !Array.isArray(record.Plan)
    ? record.Plan as Record<string, unknown>
    : null;
  const numberOrNull = (candidate: unknown) => typeof candidate === "number" ? round(candidate) : null;
  return {
    planningMs: numberOrNull(record?.["Planning Time"]),
    executionMs: numberOrNull(record?.["Execution Time"]),
    rootNode: typeof plan?.["Node Type"] === "string" ? plan["Node Type"] : null,
    sharedHitBlocks: numberOrNull(plan?.["Shared Hit Blocks"]),
    sharedReadBlocks: numberOrNull(plan?.["Shared Read Blocks"]),
  };
}

async function cleanupStandaloneHistoryFixtures(): Promise<void> {
  const rows = await prisma.catalogChangeRequest.findMany({
    where: { requestFingerprint: { startsWith: FIXTURE_REQUEST_PREFIX } },
    select: { id: true },
  });
  for (const part of chunks(rows.map((row) => row.id), 500)) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.catalog_fixture_cleanup', 'on', true)`;
      await tx.catalogHistoryFeedEntry.deleteMany({ where: { requestId: { in: part } } });
      await tx.catalogAuditEvent.deleteMany({ where: { requestId: { in: part } } });
      await tx.catalogChangeRequest.deleteMany({ where: { id: { in: part } } });
    });
  }
}

async function cleanupSenseFixtures(senseIds?: string[]): Promise<void> {
  const senses = await prisma.wordSense.findMany({
    where: senseIds?.length
      ? { id: { in: senseIds } }
      : { normalizedTerm: { startsWith: FIXTURE_TERM_PREFIX } },
    select: { id: true, catalogEntryId: true },
  });
  for (const part of chunks(senses, 200)) {
    const ids = part.map((sense) => sense.id);
    const entryIds = [...new Set(part.map((sense) => sense.catalogEntryId))];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.catalog_fixture_cleanup', 'on', true)`;
      await tx.catalogAuditEvent.deleteMany({ where: { senseId: { in: ids } } });
      await tx.legacyWordSenseMap.deleteMany({ where: { senseId: { in: ids } } });
      await tx.word.deleteMany({ where: { senseId: { in: ids } } });
      await tx.wordSense.updateMany({ where: { id: { in: ids } }, data: { approvedRevisionId: null, status: "DRAFT" } });
      await tx.wordSenseRevision.deleteMany({ where: { senseId: { in: ids } } });
      await tx.wordSense.deleteMany({ where: { id: { in: ids } } });
      await tx.catalogEntry.deleteMany({ where: { id: { in: entryIds }, senses: { none: {} } } });
    });
  }
}

async function cleanupBatchFixture(batchId: string): Promise<void> {
  const batch = await prisma.catalogSubmissionBatch.findUnique({
    where: { id: batchId },
    include: {
      proposalGroups: {
        include: { changeRequest: { select: { id: true, senseId: true } } },
      },
    },
  });
  if (!batch) return;
  const requests = batch.proposalGroups.flatMap((group) => group.changeRequest ? [group.changeRequest] : []);
  const requestIds = requests.map((request) => request.id);
  const senseIds = [...new Set(requests.flatMap((request) => request.senseId ? [request.senseId] : []))];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.catalog_fixture_cleanup', 'on', true)`;
    await tx.catalogHistoryFeedEntry.deleteMany({
      where: {
        OR: [
          { submissionBatchId: batchId },
          ...(requestIds.length ? [{ requestId: { in: requestIds } }] : []),
        ],
      },
    });
    await tx.catalogAuditEvent.deleteMany({
      where: {
        OR: [
          { submissionBatchId: batchId },
          ...(requestIds.length ? [{ requestId: { in: requestIds } }] : []),
          ...(senseIds.length ? [{ senseId: { in: senseIds } }] : []),
        ],
      },
    });
    await tx.catalogSubmissionOperationReceipt.deleteMany({ where: { batchId } });
    if (requestIds.length) await tx.catalogChangeRequest.deleteMany({ where: { id: { in: requestIds } } });
    await tx.catalogSubmissionRow.deleteMany({ where: { batchId } });
    await tx.catalogSubmissionProposalAuthor.deleteMany({ where: { proposalGroup: { batchId } } });
    await tx.catalogSubmissionProposalGroup.deleteMany({ where: { batchId } });
    await tx.catalogSubmissionBatch.delete({ where: { id: batchId } });
  });
  if (senseIds.length) await cleanupSenseFixtures(senseIds);
}

async function cleanupBatchFixtures(): Promise<void> {
  const batches = await prisma.catalogSubmissionBatch.findMany({
    where: { fileName: { startsWith: FIXTURE_FILE_PREFIX } },
    select: { id: true },
  });
  for (const batch of batches) await cleanupBatchFixture(batch.id);
}

async function cleanupAllPerformanceFixtures(): Promise<void> {
  await cleanupBatchFixtures();
  await cleanupStandaloneHistoryFixtures();
  await cleanupSenseFixtures();
  await prisma.recentAuthGrant.deleteMany({ where: { id: { startsWith: "catalog-perf-grant-" } } });
  await prisma.user.deleteMany({ where: { accountName: { startsWith: FIXTURE_ACCOUNT_PREFIX } } });
}

async function createActor(accountName: string) {
  return prisma.user.create({
    data: {
      accountName,
      passwordHash: "catalog-performance-fixture-not-a-login-secret",
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: true,
    },
    select: { id: true, tokenVersion: true, credentialRevision: true },
  });
}

async function createHistoryFixture(actorId: string, runId: string) {
  const from = new Date(Date.now() - 10_000);
  const requests: Prisma.CatalogChangeRequestCreateManyInput[] = [];
  const feed: Prisma.CatalogHistoryFeedEntryCreateManyInput[] = [];
  for (let index = 0; index < HISTORY_ROWS; index += 1) {
    const id = randomUUID();
    const occurredAt = new Date(from.getTime() + index + 1);
    const term = `${FIXTURE_TERM_PREFIX}history${runId}${String(index).padStart(5, "0")}`;
    const payload = json({ term, definitionZh: `效能歷史詞 ${index}`, level: ["A1", "A2", "B1", "B2"][index % 4] });
    requests.push({
      id,
      operationId: randomUUID(),
      requestFingerprint: `${FIXTURE_REQUEST_PREFIX}${runId}:${index}`,
      kind: "UPDATE",
      status: "REJECTED",
      proposerId: actorId,
      reviewerId: actorId,
      baseRevision: 1,
      baseStatus: "ACTIVE",
      payload,
      beforePayloadSnapshot: payload,
      afterPayloadSnapshot: payload,
      reason: "local performance fixture",
      reviewNote: "local performance fixture",
      reviewedAt: occurredAt,
      beforeTermSnapshot: term,
      afterTermSnapshot: term,
      beforeNormalizedTermSnapshot: term,
      afterNormalizedTermSnapshot: term,
      beforeDefinitionSnapshot: `效能歷史詞 ${index}`,
      afterDefinitionSnapshot: `效能歷史詞 ${index}`,
      beforeLevelSnapshot: ["A1", "A2", "B1", "B2"][index % 4] as "A1" | "A2" | "B1" | "B2",
      afterLevelSnapshot: ["A1", "A2", "B1", "B2"][index % 4] as "A1" | "A2" | "B1" | "B2",
      beforeCategorySnapshot: "other",
      afterCategorySnapshot: "other",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    feed.push({ id: randomUUID(), occurredAt, sourceKind: "STANDALONE_REQUEST", requestId: id, createdAt: occurredAt });
  }
  const measured = await withPeakRss(async () => {
    const startedAt = performance.now();
    for (const part of chunks(requests)) await prisma.catalogChangeRequest.createMany({ data: part });
    for (const part of chunks(feed)) await prisma.catalogHistoryFeedEntry.createMany({ data: part });
    return performance.now() - startedAt;
  });
  return {
    from: new Date(from.getTime() + 1),
    to: new Date(from.getTime() + HISTORY_ROWS),
    setupMs: round(measured.value),
    peakRssDeltaMiB: measured.peakRssDeltaMiB,
    uniqueSearchTerm: `${FIXTURE_TERM_PREFIX}history${runId}${String(HISTORY_ROWS - 1).padStart(5, "0")}`,
  };
}

async function runHistoryMeasurements(actorId: string, fixture: Awaited<ReturnType<typeof createHistoryFixture>>) {
  const { listCatalogHistory } = await import("../src/lib/catalog/history");
  const filters = { dateFrom: fixture.from.toISOString(), dateTo: fixture.to.toISOString() };
  for (let index = 0; index < 3; index += 1) {
    await listCatalogHistory({ actorId, canReview: true, limit: 50, filters });
  }
  const firstPageSamples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    firstPageSamples.push((await timed(() => listCatalogHistory({ actorId, canReview: true, limit: 50, filters }))).elapsedMs);
  }

  let cursor: string | null = null;
  let total = 0;
  let maxResponseBytes = 0;
  const ids = new Set<string>();
  const paginationSamples: number[] = [];
  do {
    const measured = await timed(() => listCatalogHistory({ actorId, canReview: true, cursor, limit: 50, filters }));
    paginationSamples.push(measured.elapsedMs);
    maxResponseBytes = Math.max(maxResponseBytes, Buffer.byteLength(JSON.stringify(measured.value), "utf8"));
    for (const item of measured.value.items) {
      const feedEntryId = (item as { feedEntryId: string }).feedEntryId;
      assert.ok(!ids.has(feedEntryId), `duplicate history cursor item ${feedEntryId}`);
      ids.add(feedEntryId);
      total += 1;
    }
    cursor = measured.value.nextCursor;
  } while (cursor);
  assert.equal(total, HISTORY_ROWS, "history cursor traversal omitted fixture rows");

  const searchSamples: number[] = [];
  let searchCount = 0;
  for (let index = 0; index < 10; index += 1) {
    const measured = await timed(() => listCatalogHistory({
      actorId,
      canReview: true,
      limit: 50,
      filters: { ...filters, search: fixture.uniqueSearchTerm },
    }));
    searchSamples.push(measured.elapsedMs);
    searchCount = measured.value.items.length;
  }
  assert.equal(searchCount, 1, "history search did not isolate the expected row");

  const pagePlanRows = await prisma.$queryRaw<Array<{ "QUERY PLAN": Prisma.JsonValue }>>(Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT h."id"
    FROM "CatalogHistoryFeedEntry" h
    WHERE h."occurredAt" >= ${fixture.from} AND h."occurredAt" <= ${fixture.to}
    ORDER BY h."occurredAt" DESC, h."sourceKind" DESC, h."id" DESC
    LIMIT 51
  `);
  const searchPattern = `%${fixture.uniqueSearchTerm}%`;
  const searchPlanRows = await prisma.$queryRaw<Array<{ "QUERY PLAN": Prisma.JsonValue }>>(Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT h."id"
    FROM "CatalogHistoryFeedEntry" h
    JOIN "CatalogChangeRequest" r ON r."id" = h."requestId"
    WHERE h."occurredAt" >= ${fixture.from} AND h."occurredAt" <= ${fixture.to}
      AND (r."beforeNormalizedTermSnapshot" LIKE ${searchPattern} OR r."afterNormalizedTermSnapshot" LIKE ${searchPattern})
    ORDER BY h."occurredAt" DESC, h."sourceKind" DESC, h."id" DESC
    LIMIT 51
  `);
  return {
    rows: total,
    pages: paginationSamples.length,
    firstPage: summarize(firstPageSamples),
    cursorPages: summarize(paginationSamples),
    exactSearch: summarize(searchSamples),
    maxResponseBytes,
    plans: {
      firstPage: planSummary(pagePlanRows[0]?.["QUERY PLAN"]),
      exactSearch: planSummary(searchPlanRows[0]?.["QUERY PLAN"]),
    },
  };
}

function payloadForRow(runId: string, index: number): CatalogGovernancePayload {
  const key = `${runId}${String(index).padStart(3, "0")}`;
  return {
    term: `${FIXTURE_TERM_PREFIX}${key}`,
    lemma: `${FIXTURE_TERM_PREFIX}${key}`,
    partOfSpeech: "noun",
    level: ["A1", "A2", "B1", "B2"][index % 4] as "A1" | "A2" | "B1" | "B2",
    category: "other",
    definitionZh: `效能測試詞 ${key}`,
    acceptedAnswersZh: [`效能測試詞 ${key}`],
    phoneticIpa: "/test/",
    exampleEn: `This is performance word ${key}.`,
    exampleZh: `這是效能測試詞 ${key}。`,
    acceptedFormsEn: [],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: Array.from({ length: 5 }, (_, distractor) => `錯誤中文 ${key}-${distractor}`),
    enableZhToEn: true,
    distractorEn: Array.from({ length: 5 }, (_, distractor) => `wrong${key}${distractor}`),
    sourceReference: null,
    contributorRef: null,
    changeNote: "local performance fixture",
    retirementReason: null,
  };
}

function sourceRow(payload: CatalogGovernancePayload, sourceRowNumber: number): CatalogSourceRow {
  return {
    sourceFile: "catalog-performance.csv",
    sourceRow: sourceRowNumber,
    schema_version: "word-catalog-v1",
    requested_action: "CREATE",
    catalog_key: "",
    sense_key: "",
    record_revision: "",
    catalog_status: "",
    term: payload.term,
    lemma: payload.lemma,
    part_of_speech: payload.partOfSpeech,
    level: payload.level,
    category: payload.category,
    definition_zh: payload.definitionZh,
    accepted_answers_zh: payload.acceptedAnswersZh.join("|"),
    prompt_en: "",
    prompt_zh: "",
    phonetic_ipa: payload.phoneticIpa ?? "",
    example_en: payload.exampleEn ?? "",
    example_zh: payload.exampleZh ?? "",
    accepted_forms_en: "",
    synonyms_en: "",
    antonyms_en: "",
    enable_en_to_zh: "TRUE",
    distractor_zh_1: payload.distractorZh[0]!,
    distractor_zh_2: payload.distractorZh[1]!,
    distractor_zh_3: payload.distractorZh[2]!,
    distractor_zh_4: payload.distractorZh[3]!,
    distractor_zh_5: payload.distractorZh[4]!,
    distractor_zh_6: "",
    enable_zh_to_en: "TRUE",
    distractor_en_1: payload.distractorEn[0]!,
    distractor_en_2: payload.distractorEn[1]!,
    distractor_en_3: payload.distractorEn[2]!,
    distractor_en_4: payload.distractorEn[3]!,
    distractor_en_5: payload.distractorEn[4]!,
    distractor_en_6: "",
    source_reference: "",
    contributor_ref: "",
    change_note: payload.changeNote ?? "",
    retirement_reason: "",
  };
}

async function runBulkMeasurements(
  proposer: { id: string },
  reviewer: { id: string; tokenVersion: number; credentialRevision: number },
  runId: string,
  onCommitted: () => void,
) {
  const { CATALOG_GOVERNANCE_HEADERS, catalogRowsToCsv } = await import("../src/lib/catalog/csv");
  const {
    claimCatalogSubmissionBatch,
    createCatalogSubmissionPreview,
    finalizeCatalogSubmissionBatch,
    getCatalogSubmissionBatch,
    reviewCatalogSubmissionGroup,
    submitCatalogSubmissionBatch,
  } = await import("../src/lib/catalog/submission-server");
  const previewSamples: number[] = [];
  const previewMemory: number[] = [];
  const previewResponseBytes: number[] = [];
  for (let run = 0; run < PREVIEW_RUNS; run += 1) {
    const rows = Array.from({ length: BULK_ROWS }, (_, index) => sourceRow(payloadForRow(`${runId}p${run}`, index), index + 2));
    const bytes = new TextEncoder().encode(catalogRowsToCsv(rows, CATALOG_GOVERNANCE_HEADERS));
    let previewBatchId: string | null = null;
    try {
      const measured = await withPeakRss(() => timed(() => createCatalogSubmissionPreview({
        actorId: proposer.id,
        operationId: randomUUID(),
        fileName: `${FIXTURE_FILE_PREFIX}preview-${runId}-${run}.csv`,
        bytes,
      })));
      previewBatchId = measured.value.value.batch.id;
      assert.equal(measured.value.value.batch.rowCount, BULK_ROWS);
      assert.equal(measured.value.value.batch.groups.length, BULK_ROWS);
      previewSamples.push(measured.value.elapsedMs);
      previewMemory.push(measured.peakRssDeltaMiB);
      previewResponseBytes.push(Buffer.byteLength(JSON.stringify(measured.value.value), "utf8"));
    } finally {
      if (previewBatchId) await cleanupBatchFixture(previewBatchId);
    }
  }

  const rows = Array.from({ length: BULK_ROWS }, (_, index) => sourceRow(payloadForRow(`${runId}f`, index), index + 2));
  const bytes = new TextEncoder().encode(catalogRowsToCsv(rows, CATALOG_GOVERNANCE_HEADERS));
  let batchId: string | null = null;
  let lifecycleResult: Record<string, unknown> | null = null;
  try {
    const preview = await timed(() => createCatalogSubmissionPreview({
      actorId: proposer.id,
      operationId: randomUUID(),
      fileName: `${FIXTURE_FILE_PREFIX}finalize-${runId}.csv`,
      bytes,
    }));
    const activeBatchId = preview.value.batch.id;
    batchId = activeBatchId;
    assert.equal(preview.value.batch.groups.length, BULK_ROWS);
    const submitted = await timed(() => submitCatalogSubmissionBatch({
      batchId: activeBatchId,
      actorId: proposer.id,
      expectedRevision: preview.value.batch.revision,
      operationId: randomUUID(),
      reason: "local 200-row performance fixture",
    }));
    const submitResponseBytes = Buffer.byteLength(JSON.stringify(submitted.value), "utf8");
    assert.equal(submitted.value.patch.batch.status, "SUBMITTED");
    assert.equal(await prisma.catalogChangeRequest.count({ where: { submissionProposalGroup: { batchId: activeBatchId } } }), BULK_ROWS);
    const claimed = await timed(() => claimCatalogSubmissionBatch({
      batchId: activeBatchId,
      actorId: reviewer.id,
      expectedRevision: submitted.value.patch.revision,
      release: false,
    }));
    const claimResponseBytes = Buffer.byteLength(JSON.stringify(claimed.value), "utf8");
    const detail = await timed(() => getCatalogSubmissionBatch({ batchId: activeBatchId, actorId: reviewer.id, canReview: true }));
    let currentRevision = detail.value.revision;
    let currentStatus: string = detail.value.status;
    const groups = new Map(detail.value.groups.map((group) => [group.id, group]));
    const groupIds = detail.value.groups.map((group) => group.id);
    const reviewSamples: number[] = [];
    const reviewResponseBytes: number[] = [];
    const reviewStartedAt = performance.now();
    for (const groupId of groupIds) {
      const group = groups.get(groupId);
      assert.ok(group?.payloadDigest, `review payload digest missing for ${groupId}`);
      const reviewed = await timed(() => reviewCatalogSubmissionGroup({
        batchId: activeBatchId,
        groupId,
        actorId: reviewer.id,
        expectedBatchRevision: currentRevision,
        expectedGroupRevision: group.revision,
        decision: "APPROVE",
        reviewNote: "local performance review",
        acknowledgedPayloadDigest: group.payloadDigest,
      }));
      reviewSamples.push(reviewed.elapsedMs);
      reviewResponseBytes.push(Buffer.byteLength(JSON.stringify(reviewed.value), "utf8"));
      const patch = reviewed.value.patch;
      assert.equal(patch.group?.value.id, groupId);
      currentRevision = patch.revision;
      currentStatus = patch.batch.status;
      groups.set(groupId, patch.group!.value);
    }
    const reviewTotalMs = performance.now() - reviewStartedAt;
    assert.equal(currentStatus, "REVIEWED");
    const reauthenticatedAt = new Date();
    const expiresAt = new Date(reauthenticatedAt.getTime() + 30 * 60_000);
    const grantId = `catalog-perf-grant-${runId}`;
    await prisma.recentAuthGrant.create({
      data: {
        id: grantId,
        userId: reviewer.id,
        tokenVersion: reviewer.tokenVersion,
        credentialRevision: reviewer.credentialRevision,
        reauthenticatedAt,
        expiresAt,
      },
    });
    const finalized = await withPeakRss(() => timed(() => finalizeCatalogSubmissionBatch({
      batchId: activeBatchId,
      actorId: reviewer.id,
      expectedRevision: currentRevision,
      operationId: randomUUID(),
      recentAuth: {
        grantId,
        tokenVersion: reviewer.tokenVersion,
        credentialRevision: reviewer.credentialRevision,
        reauthenticatedAt,
        expiresAt,
      },
    })));
    assert.equal(finalized.value.value.patch.batch.status, "COMMITTED");
    onCommitted();
    const committedRequests = await prisma.catalogChangeRequest.findMany({
      where: { submissionProposalGroup: { batchId: activeBatchId } },
      select: { status: true, resultRevisionId: true, senseId: true },
    });
    const approvedChildren = committedRequests.filter((request) => request.status === "APPROVED").length;
    const resultRevisions = committedRequests.filter((request) => request.resultRevisionId !== null).length;
    const committedSenseIds = committedRequests.flatMap((request) => request.senseId ? [request.senseId] : []);
    const [projections, historyRows] = await Promise.all([
      prisma.word.count({ where: { senseId: { in: committedSenseIds } } }),
      prisma.catalogHistoryFeedEntry.count({ where: { submissionBatchId: activeBatchId } }),
    ]);
    assert.equal(approvedChildren, BULK_ROWS);
    assert.equal(resultRevisions, BULK_ROWS);
    assert.equal(projections, BULK_ROWS);
    assert.equal(historyRows, 1);
    lifecycleResult = {
      rows: BULK_ROWS,
      previewMs: round(preview.elapsedMs),
      previewResponseBytes: Buffer.byteLength(JSON.stringify(preview.value), "utf8"),
      submitMs: round(submitted.elapsedMs),
      submitResponseBytes,
      claimMs: round(claimed.elapsedMs),
      claimResponseBytes,
      initialReviewerDetailMs: round(detail.elapsedMs),
      initialReviewerDetailResponseBytes: Buffer.byteLength(JSON.stringify(detail.value), "utf8"),
      reviewTotalMs: round(reviewTotalMs),
      reviewPerGroup: summarize(reviewSamples),
      reviewResponseBytes: summarizeNumbers(reviewResponseBytes),
      reviewResponseTotalMiB: round(reviewResponseBytes.reduce((total, bytes) => total + bytes, 0) / 1024 / 1024),
      finalizeMs: round(finalized.value.elapsedMs),
      finalizePeakRssDeltaMiB: finalized.peakRssDeltaMiB,
      approvedChildren,
      resultRevisions,
      projections,
      historyRows,
      finalResponseBytes: Buffer.byteLength(JSON.stringify(finalized.value.value), "utf8"),
    };
  } finally {
    if (batchId) await cleanupBatchFixture(batchId);
  }
  assert.ok(lifecycleResult);
  return {
    preview: summarize(previewSamples),
    previewPeakRssDeltaMiB: summarizeNumbers(previewMemory),
    previewResponseBytes: summarizeNumbers(previewResponseBytes),
    lifecycle: lifecycleResult,
  };
}

async function runStudentConcurrency() {
  const student = await prisma.user.findFirst({
    where: { role: "STUDENT", status: "ACTIVE" },
    orderBy: { id: "asc" },
    select: { id: true, reviews: { select: { id: true }, take: 1 } },
  });
  if (!student) throw new Error("an ACTIVE demo student is required for student concurrency measurements");
  const [{ getStudentDashboard }, { fetchUnitProgress }] = await Promise.all([
    import("../src/lib/student-metrics"),
    import("../src/lib/unit-progress-server"),
  ]);
  await getStudentDashboard(student.id);
  await fetchUnitProgress(student.id);
  const dashboardSamples: number[] = [];
  const unitSamples: number[] = [];
  const jobs: Array<Promise<void>> = [];
  const startedAt = performance.now();
  for (let index = 0; index < STUDENT_CONCURRENCY_PER_PATH; index += 1) {
    jobs.push((async () => {
      dashboardSamples.push((await timed(() => getStudentDashboard(student.id))).elapsedMs);
    })());
    jobs.push((async () => {
      unitSamples.push((await timed(() => fetchUnitProgress(student.id))).elapsedMs);
    })());
  }
  const settled = await Promise.allSettled(jobs);
  const failures = settled.filter((result) => result.status === "rejected");
  assert.equal(failures.length, 0, `student concurrency had ${failures.length} failures`);
  return {
    studentHasReview: student.reviews.length > 0,
    concurrentJobs: jobs.length,
    wallMs: round(performance.now() - startedAt),
    dashboard: summarize(dashboardSamples),
    unitProgress: summarize(unitSamples),
    failures: failures.length,
  };
}

async function main() {
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata && metadata.value !== environment) throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  await cleanupAllPerformanceFixtures();
  const runId = randomUUID().replaceAll("-", "").slice(0, 10);
  const mutationBefore = await prisma.catalogMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
  let committedMutationIncrements = 0;
  try {
    const proposer = await createActor(`${FIXTURE_ACCOUNT_PREFIX}proposer-${runId}`);
    const reviewer = await createActor(`${FIXTURE_ACCOUNT_PREFIX}reviewer-${runId}`);
    const [databaseVersion, activeSenses] = await Promise.all([
      prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`,
      prisma.wordSense.count({ where: { status: "ACTIVE" } }),
    ]);
    const historyFixture = await createHistoryFixture(proposer.id, runId);
    const history = await runHistoryMeasurements(proposer.id, historyFixture);
    await cleanupStandaloneHistoryFixtures();
    const bulk = await runBulkMeasurements(proposer, reviewer, runId, () => {
      committedMutationIncrements += 1;
    });
    const student = await runStudentConcurrency();

    const lifecycle = bulk.lifecycle as {
      previewMs: number;
      submitResponseBytes: number;
      submitMs: number;
      claimResponseBytes: number;
      reviewTotalMs: number;
      reviewResponseBytes: NumericSummary;
      finalizeMs: number;
      finalResponseBytes: number;
      reviewResponseTotalMiB: number;
    };
    const findings = [
      ...(history.firstPage.p95Ms > 500 ? [`history first-page local p95 ${history.firstPage.p95Ms}ms > 500ms`] : []),
      ...(history.exactSearch.p95Ms > 250 ? [`history exact-search local p95 ${history.exactSearch.p95Ms}ms > 250ms`] : []),
      ...(bulk.preview.p95Ms > 2_000 ? [`200-row preview local p95 ${bulk.preview.p95Ms}ms > 2000ms`] : []),
      ...(lifecycle.submitMs > 5_000 ? [`200-row submit ${lifecycle.submitMs}ms > 5000ms`] : []),
      ...(lifecycle.submitResponseBytes > 8 * 1024 ? [`submit response ${lifecycle.submitResponseBytes} bytes > 8KiB compact-response gate`] : []),
      ...(lifecycle.claimResponseBytes > 8 * 1024 ? [`claim response ${lifecycle.claimResponseBytes} bytes > 8KiB compact-response gate`] : []),
      ...(lifecycle.reviewTotalMs > 30_000 ? [`200-group review total ${lifecycle.reviewTotalMs}ms > 30000ms`] : []),
      ...(lifecycle.reviewResponseBytes.p95 > 16 * 1024 ? [`review response p95 ${lifecycle.reviewResponseBytes.p95} bytes > 16KiB compact-response gate`] : []),
      ...(lifecycle.reviewResponseTotalMiB > 2 ? [`200-group review responses total ${lifecycle.reviewResponseTotalMiB}MiB > 2MiB compact-response gate`] : []),
      ...(lifecycle.finalizeMs > 30_000 ? [`200-row finalize ${lifecycle.finalizeMs}ms > 30000ms`] : []),
      ...(lifecycle.finalResponseBytes > 8 * 1024 ? [`finalize response ${lifecycle.finalResponseBytes} bytes > 8KiB compact-response gate`] : []),
      ...(student.dashboard.p95Ms > 2_000 ? [`dashboard concurrent local p95 ${student.dashboard.p95Ms}ms > 2000ms`] : []),
      ...(student.unitProgress.p95Ms > 2_000 ? [`unit-progress concurrent local p95 ${student.unitProgress.p95Ms}ms > 2000ms`] : []),
    ];
    console.log(JSON.stringify({
      status: findings.length ? "NEEDS_HARDENING" : "LOCAL_BASELINE_PASS",
      scope: "local service/database baseline only; not staging or Vercel evidence",
      environment: {
        databaseEnvironment: environment,
        databaseVersion: databaseVersion[0]?.version ?? "unknown",
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cpuCount: os.cpus().length,
        totalMemoryGiB: round(os.totalmem() / 1024 / 1024 / 1024),
        databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 3),
      },
      dataset: { activeSenses, historyRows: HISTORY_ROWS, bulkRows: BULK_ROWS },
      fixtureSetup: { historyMs: historyFixture.setupMs, peakRssDeltaMiB: historyFixture.peakRssDeltaMiB },
      history,
      bulk,
      student,
      findings,
      deferred: ["managed PostgreSQL/network latency", "Vercel function duration/memory", "production-like Upstash", "multi-instance HTTP concurrency"],
    }, null, 2));
  } finally {
    await cleanupAllPerformanceFixtures();
    if (mutationBefore) {
      const mutationAfter = await prisma.catalogMutationState.findUnique({ where: { id: 1 }, select: { revision: true } });
      const expectedRevision = mutationBefore.revision + committedMutationIncrements;
      if (committedMutationIncrements > 0 && mutationAfter?.revision === expectedRevision) {
        await prisma.$executeRaw`
          UPDATE "CatalogMutationState"
          SET "revision" = ${mutationBefore.revision}, "updatedAt" = NOW()
          WHERE "id" = 1 AND "revision" = ${expectedRevision}
        `;
      } else if (committedMutationIncrements > 0) {
        console.warn(`CatalogMutationState was not restored because revision ${mutationAfter?.revision ?? "missing"} did not match isolated fixture revision ${expectedRevision}.`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "catalog performance check failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
