import assert from "node:assert/strict";
import os from "node:os";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const connectionString = process.env.MIGRATE_URL;
const environment = process.env.DATABASE_ENVIRONMENT;
if (!connectionString) throw new Error("MIGRATE_URL is required.");
if (
  !environment ||
  environment === "production" ||
  process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment
) {
  throw new Error(
    "check:catalog-workspace-performance requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT.",
  );
}
process.env.DATABASE_URL = connectionString;

const PAGE_SIZE = 50;
const WARM_RUNS = 30;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(samples: number[]) {
  assert.ok(samples.length > 0);
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
  return {
    count: sorted.length,
    minMs: round(sorted[0]!),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)!),
    meanMs: round(
      sorted.reduce((total, sample) => total + sample, 0) / sorted.length,
    ),
  };
}

function planSummary(value: unknown) {
  const first = Array.isArray(value) ? value[0] : null;
  const root =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  const plan =
    root?.Plan && typeof root.Plan === "object" && !Array.isArray(root.Plan)
      ? (root.Plan as Record<string, unknown>)
      : null;
  const numberOrNull = (candidate: unknown) =>
    typeof candidate === "number" ? round(candidate) : null;
  return {
    planningMs: numberOrNull(root?.["Planning Time"]),
    executionMs: numberOrNull(root?.["Execution Time"]),
    rootNode: typeof plan?.["Node Type"] === "string" ? plan["Node Type"] : null,
    actualRows: numberOrNull(plan?.["Actual Rows"]),
    sharedHitBlocks: numberOrNull(plan?.["Shared Hit Blocks"]),
    sharedReadBlocks: numberOrNull(plan?.["Shared Read Blocks"]),
  };
}

async function timed<T>(operation: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - startedAt };
}

async function main() {
  const [
    { prisma, Prisma },
    { catalogWorkspacePageSql, readCatalogWorkspacePage },
    { parseCatalogWorkspaceQuery },
  ] = await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/catalog/workspace-read"),
      import("../src/lib/catalog/workspace-query"),
    ]);

  try {
    const [metadata, readyBatch, reviewer, teacher, databaseVersion] =
      await Promise.all([
        prisma.databaseMetadata.findUnique({
          where: { key: "environment" },
          select: { value: true },
        }),
        prisma.catalogImportBatch.findFirst({
          where: { status: "READY" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        }),
        prisma.user.findFirst({
          where: { role: "ADMIN", status: "ACTIVE" },
          orderBy: { id: "asc" },
          select: { id: true },
        }),
        prisma.user.findFirst({
          where: { role: "TEACHER", status: "ACTIVE" },
          orderBy: { id: "asc" },
          select: { id: true },
        }),
        prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`,
      ]);
    if (metadata?.value !== environment) {
      throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT.");
    }
    if (!readyBatch || !reviewer || !teacher) {
      throw new Error("READY catalog batch, active admin and active teacher are required.");
    }

    const scenarios = [
      { name: "term-first", params: { sort: "TERM_ASC" }, offset: 0 },
      { name: "term-deep", params: { sort: "TERM_ASC" }, offset: 5_000 },
      {
        name: "level-a1",
        params: { level: "A1", sort: "TERM_ASC" },
        offset: 0,
      },
      {
        name: "lifecycle-active",
        params: { lifecycle: "ACTIVE", sort: "TERM_ASC" },
        offset: 0,
      },
      {
        name: "workflow-pending",
        params: { workflow: "PENDING", sort: "TERM_ASC" },
        offset: 0,
      },
      {
        name: "readiness-both",
        params: { readiness: "BOTH", sort: "TERM_ASC" },
        offset: 0,
      },
      {
        name: "issues-none",
        params: { issues: "NONE", sort: "TERM_ASC" },
        offset: 0,
      },
      {
        name: "category-society-law",
        params: { category: "society-law-politics", sort: "TERM_ASC" },
        offset: 0,
      },
      { name: "updated", params: { sort: "UPDATED_DESC" }, offset: 0 },
    ] as const;
    const scopes = [
      { name: "teacher", canReview: false, actorUserId: teacher.id },
      { name: "reviewer", canReview: true, actorUserId: reviewer.id },
    ] as const;
    const results: Array<Record<string, unknown>> = [];

    for (const scope of scopes) {
      for (const scenario of scenarios) {
        const filters = parseCatalogWorkspaceQuery(
          new URLSearchParams(scenario.params),
        ).filters;
        const input = {
          batchId: readyBatch.id,
          filters,
          limit: PAGE_SIZE,
          offset: scenario.offset,
          canReview: scope.canReview,
          actorUserId: scope.actorUserId,
        };
        const run = () => readCatalogWorkspacePage(input);
        const first = await timed(run);
        const planRows = await prisma.$queryRaw<
          Array<{ "QUERY PLAN": unknown }>
        >(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${catalogWorkspacePageSql(input, [])}`,
        );
        const warmSamples: number[] = [];
        let last = first.value;
        for (let index = 0; index < WARM_RUNS; index += 1) {
          const measured = await timed(run);
          warmSamples.push(measured.elapsedMs);
          last = measured.value;
        }
        results.push({
          scope: scope.name,
          scenario: scenario.name,
          offset: scenario.offset,
          firstCallMs: round(first.elapsedMs),
          warm: summarize(warmSamples),
          filteredTotal: last.filteredTotal,
          returnedRows: last.rows.length,
          responseBytes: Buffer.byteLength(JSON.stringify(last), "utf8"),
          plan: planSummary(planRows[0]?.["QUERY PLAN"]),
        });
      }
    }

    const totalRows = Number(results[0]?.filteredTotal ?? 0);
    const warmP95Values = results.map(
      (result) => (result.warm as ReturnType<typeof summarize>).p95Ms,
    );
    const maxWarmP95Ms = Math.max(...warmP95Values);
    const maxResponseBytes = Math.max(
      ...results.map((result) => Number(result.responseBytes)),
    );
    const findings = [
      ...(totalRows < 5_000
        ? [`catalog workspace contains ${totalRows} rows; expected at least 5,000`]
        : []),
      ...(maxWarmP95Ms > 750
        ? [`maximum local warm-cache p95 ${maxWarmP95Ms}ms exceeds 750ms`]
        : []),
      ...(maxResponseBytes > 512 * 1024
        ? [`maximum 50-row response ${maxResponseBytes} bytes exceeds 512KiB`]
        : []),
    ];

    console.log(
      JSON.stringify(
        {
          status: findings.length ? "NEEDS_HARDENING" : "LOCAL_BASELINE_PASS",
          scope:
            "read-only local catalog workspace baseline; one bounded data/facet SQL query per measured call; not staging or Vercel evidence",
          environment: {
            databaseEnvironment: environment,
            databaseVersion: databaseVersion[0]?.version ?? "unknown",
            node: process.version,
            platform: `${os.platform()} ${os.arch()}`,
            cpuCount: os.cpus().length,
            totalMemoryGiB: round(os.totalmem() / 1024 / 1024 / 1024),
          },
          dataset: { catalogRows: totalRows, pageSize: PAGE_SIZE },
          methodology: {
            scopes: scopes.map((scope) => scope.name),
            scenarios: scenarios.length,
            firstCallsPerScenario: 1,
            warmCallsPerScenario: WARM_RUNS,
            measuredCalls: results.length * (WARM_RUNS + 1),
            explainAnalyzePlans: results.length,
          },
          maxWarmP95Ms,
          maxResponseBytes,
          results,
          findings,
          deferred: [
            "managed PostgreSQL and Vercel network latency",
            "production-like concurrency and cache behavior",
            "pre-redesign code-path interleaved comparison",
          ],
        },
        null,
        2,
      ),
    );
    if (findings.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
