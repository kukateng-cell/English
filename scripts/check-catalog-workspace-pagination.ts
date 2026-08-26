import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
const connectionString = process.env.MIGRATE_URL;
if (!connectionString) throw new Error("MIGRATE_URL is required.");
process.env.DATABASE_URL = connectionString;

const fixture = `catalog_page_${randomUUID().replaceAll("-", "")}`;
const proposerAccount = `${fixture}_proposer`;
const otherAccount = `${fixture}_other`;
const operationPrefix = `${fixture}_operation`;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { readCatalogWorkspacePage } = await import("../src/lib/catalog/workspace-read");
  const { parseCatalogWorkspaceQuery } = await import("../src/lib/catalog/workspace-query");
  const { readCatalogWorkspaceVersion } = await import("../src/lib/catalog/workspace-version");
  const { getCatalogSenseHistory } = await import("../src/lib/catalog/history");
  const metadata = await prisma.databaseMetadata.findUnique({ where: { key: "environment" }, select: { value: true } });
  if (metadata?.value === "production") throw new Error("Refusing catalog pagination fixture on production metadata.");
  const readyBatch = await prisma.catalogImportBatch.findFirst({ where: { status: "READY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (!readyBatch) throw new Error("READY catalog batch is required.");

  const payload = (term: string, definitionZh: string, enableEnToZh = false) => ({
    term,
    lemma: term,
    partOfSpeech: "noun",
    level: "A1",
    category: "other",
    definitionZh,
    acceptedAnswersZh: [definitionZh],
    phoneticIpa: null,
    exampleEn: null,
    exampleZh: null,
    acceptedFormsEn: [term],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh,
    distractorZh: [],
    enableZhToEn: false,
    distractorEn: [],
    sourceReference: null,
    contributorRef: null,
    changeNote: null,
    retirementReason: null,
  });
  let proposerId = "";
  let otherId = "";
  let senseId = "";
  let submissionBatchId = "";
  const overflowOperationPrefix = `${operationPrefix}_signature_overflow`;

  try {
    const proposer = await prisma.user.create({
      data: { accountName: proposerAccount, accountNameCanonical: proposerAccount, passwordHash: "fixture-not-login-capable", legacyName: "Catalog page proposer", role: "TEACHER", status: "ACTIVE", mustChangePassword: false, teacherProfile: { create: { legalName: "Catalog page proposer", canManageWordCatalog: false } } },
      select: { id: true },
    });
    const other = await prisma.user.create({
      data: { accountName: otherAccount, accountNameCanonical: otherAccount, passwordHash: "fixture-not-login-capable", legacyName: "Catalog page other", role: "TEACHER", status: "ACTIVE", mustChangePassword: false, teacherProfile: { create: { legalName: "Catalog page other", canManageWordCatalog: false } } },
      select: { id: true },
    });
    proposerId = proposer.id;
    otherId = other.id;

    await prisma.catalogImportRow.create({
      data: {
        batchId: readyBatch.id,
        sourceFile: `${fixture}.csv`,
        sourceRow: 1,
        rowDigest: `${fixture}_import_digest`,
        primaryDisposition: "CREATED_DRAFT",
        eligibilityResult: "DRAFT_BLOCKED",
        catalogKey: `${fixture}_import_catalog`,
        senseKey: `${fixture}_import_sense`,
        issues: { errors: [], warnings: [] },
        sourceData: payload(`${fixture}_import`, "隔離匯入詞條", true),
      },
    });

    const entry = await prisma.catalogEntry.create({
      data: {
        catalogKey: `${fixture}_catalog`,
        lemma: `${fixture}_sense`,
        normalizedLemma: `${fixture}_sense`,
        senses: {
          create: {
            senseKey: `${fixture}_sense`,
            term: `${fixture}_sense`,
            normalizedTerm: `${fixture}_sense`,
            pos: "noun",
            level: "A1",
            category: "other",
            status: "DRAFT",
            revisions: {
              create: {
                revision: 1,
                term: `${fixture}_sense`,
                lemma: `${fixture}_sense`,
                pos: "noun",
                level: "A1",
                category: "other",
                definitionZh: "隔離治理詞義",
                acceptedAnswersZh: ["隔離治理詞義"],
                acceptedFormsEn: [`${fixture}_sense`],
                enableEnToZh: true,
                enableZhToEn: false,
                contentDigest: `${fixture}_content_digest`,
              },
            },
          },
        },
      },
      select: { senses: { select: { id: true } } },
    });
    senseId = entry.senses[0]!.id;

    await prisma.catalogChangeRequest.create({
      data: {
        operationId: `${operationPrefix}_standalone_create`,
        requestFingerprint: `${fixture}_standalone_fingerprint`,
        kind: "CREATE",
        status: "PENDING",
        catalogKey: null,
        senseKey: `${fixture}_pending`,
        proposerId,
        revision: 0,
        payload: payload(`${fixture}_pending`, "隔離待審詞條"),
      },
    });

    const submission = await prisma.catalogSubmissionBatch.create({
      data: {
        proposerId,
        operationId: `${operationPrefix}_batch`,
        fileName: `${fixture}.csv`,
        fileHash: `${fixture}_file_hash`,
        requestDigest: `${fixture}_request_digest`,
        schemaVersion: "word-catalog-v1",
        validatorVersion: "fixture",
        normalizationVersion: "fixture",
        taxonomyDigest: "fixture",
        baseMutationRevision: 0,
        status: "PREVIEW",
        rowCount: 2,
        summary: {},
        expiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120_000),
        proposalGroups: {
          create: [
            {
              groupNumber: 1,
              requestedAction: "CREATE",
              dependencyDigest: `${fixture}_dependency_1`,
              finalProposalPayload: payload(`${fixture}_batch_create`, "不應進入完整詞庫"),
              payloadDigest: `${fixture}_payload_1`,
              lastContentAuthorId: proposerId,
              reviewRisk: "MATERIAL",
              reviewRiskVersion: "fixture",
              reviewRiskReason: {},
            },
            {
              groupNumber: 2,
              requestedAction: "UPDATE",
              targetCatalogKey: `${fixture}_catalog`,
              targetSenseKey: `${fixture}_sense`,
              targetSenseId: senseId,
              baseRevision: 1,
              baseStatus: "DRAFT",
              dependencyDigest: `${fixture}_dependency_2`,
              finalProposalPayload: payload(`${fixture}_sense`, "不應標成 standalone pending", true),
              payloadDigest: `${fixture}_payload_2`,
              lastContentAuthorId: proposerId,
              reviewRisk: "MATERIAL",
              reviewRiskVersion: "fixture",
              reviewRiskReason: {},
            },
          ],
        },
      },
      select: { id: true, proposalGroups: { orderBy: { groupNumber: "asc" }, select: { id: true } } },
    });
    submissionBatchId = submission.id;
    await prisma.catalogSubmissionBatch.update({ where: { id: submission.id }, data: { status: "SUBMITTED" } });
    await prisma.catalogChangeRequest.createMany({
      data: [
        {
          operationId: `${operationPrefix}_batch_create`,
          requestFingerprint: `${fixture}_batch_create_fingerprint`,
          kind: "CREATE",
          status: "PENDING",
          senseKey: `${fixture}_batch_create`,
          submissionProposalGroupId: submission.proposalGroups[0]!.id,
          proposerId,
          revision: 0,
          payload: payload(`${fixture}_batch_create`, "不應進入完整詞庫"),
        },
        {
          operationId: `${operationPrefix}_batch_update`,
          requestFingerprint: `${fixture}_batch_update_fingerprint`,
          kind: "UPDATE",
          status: "PENDING",
          catalogKey: `${fixture}_catalog`,
          senseKey: `${fixture}_sense`,
          senseId,
          submissionProposalGroupId: submission.proposalGroups[1]!.id,
          proposerId,
          baseRevision: 1,
          baseStatus: "DRAFT",
          revision: 0,
          payload: payload(`${fixture}_sense`, "不應標成 standalone pending", true),
        },
      ],
    });

    const versionBeforeOverflow = await readCatalogWorkspaceVersion();
    await prisma.catalogChangeRequest.createMany({
      data: Array.from({ length: 1002 }, (_, index) => ({
        operationId: `${overflowOperationPrefix}_${index}`,
        requestFingerprint: `${fixture}_overflow_fingerprint_${index}`,
        kind: "CREATE" as const,
        status: "PENDING" as const,
        senseKey: `catalog_signature_overflow_${fixture.slice(-12)}_${index}`,
        proposerId,
        revision: 0,
        payload: payload(`signature_overflow_${index}`, `簽章邊界詞條 ${index}`),
      })),
    });
    const versionWithOverflow = await readCatalogWorkspaceVersion();
    assert.notEqual(versionWithOverflow.signature, versionBeforeOverflow.signature, "adding requests beyond the old cutoff must change the workspace signature");
    assert.equal(versionWithOverflow.pendingCount, versionBeforeOverflow.pendingCount + 1002);
    const requestBeyondOldCutoff = await prisma.catalogChangeRequest.findFirst({
      where: { status: "PENDING", submissionProposalGroupId: null, operationId: { startsWith: overflowOperationPrefix } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 1001,
      select: { id: true },
    });
    assert.ok(requestBeyondOldCutoff, "a request beyond the former 1,001-row signature cutoff is required");
    await prisma.catalogChangeRequest.update({ where: { id: requestBeyondOldCutoff.id }, data: { revision: { increment: 1 } } });
    const versionAfterTailMutation = await readCatalogWorkspaceVersion();
    assert.notEqual(versionAfterTailMutation.signature, versionWithOverflow.signature, "mutating a request beyond the old cutoff must stale existing cursors");
    await prisma.catalogChangeRequest.deleteMany({
      where: { operationId: { startsWith: overflowOperationPrefix } },
    });

    const filters = parseCatalogWorkspaceQuery(new URLSearchParams({ q: fixture, status: "ALL", level: "ALL", direction: "ALL" })).filters;
    const beforeFixture = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: { ...filters, q: `${fixture}_not_found` }, limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const reviewer = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const proposerView = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 10, offset: 0, canReview: false, actorUserId: proposerId });
    const otherView = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 10, offset: 0, canReview: false, actorUserId: otherId });
    assert.equal(reviewer.filteredTotal, 3, "reviewer should see import, standalone sense and standalone pending CREATE only");
    assert.deepEqual(reviewer.rows.map((row) => row.term), [`${fixture}_import`, `${fixture}_sense`, `${fixture}_pending`]);
    assert.equal(reviewer.rows[1]!.pendingRequest, null, "batch UPDATE child must not mark a sense as standalone pending");
    assert.equal(
      reviewer.rows[1]!.contentScope,
      "IMPORT_DRAFT",
      "a DRAFT sense without an approved revision must not claim current content",
    );
    assert.equal(proposerView.filteredTotal, 3, "ordinary proposer should see their own standalone CREATE");
    assert.equal(otherView.filteredTotal, 2, "another ordinary teacher must not see someone else's standalone CREATE");
    assert.equal(beforeFixture.filteredTotal, 0, "zero-result query must remain empty");
    assert.equal(beforeFixture.counts.all, reviewer.counts.all, "zero-result query must preserve global counts");

    const pendingOnly = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: { ...filters, status: "PENDING" }, limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const enToZh = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: { ...filters, direction: "EN_ZH" }, limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const wrongLevel = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: { ...filters, level: "B1" }, limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    assert.equal(pendingOnly.filteredTotal, 1, "only standalone pending CREATE belongs to the governance pending filter");
    assert.equal(enToZh.filteredTotal, 2, "direction filter should run in PostgreSQL across import and standalone sense rows");
    assert.equal(wrongLevel.filteredTotal, 0, "level filter should preserve zero-result semantics");

    const v2Filters = (value: Record<string, string>) => parseCatalogWorkspaceQuery(new URLSearchParams({ q: fixture, ...value })).filters;
    const lifecycleDraft = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ lifecycle: "DRAFT" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const workflowPending = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ workflow: "PENDING" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const nounOnly = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ partOfSpeech: "noun" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const cInitial = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ initial: "C" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const otherCategory = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ category: "other" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const enToZhReady = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ readiness: "EN_TO_ZH_ONLY" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const noIssues = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ issues: "NONE" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    const descending = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters: v2Filters({ sort: "TERM_DESC" }), limit: 10, offset: 0, canReview: true, actorUserId: proposerId });
    assert.equal(lifecycleDraft.filteredTotal, 3, "orthogonal lifecycle filter should include all three draft fixtures");
    assert.equal(workflowPending.filteredTotal, 1, "orthogonal workflow filter should find the actor-visible pending request");
    assert.equal(nounOnly.filteredTotal, 3, "part-of-speech filter should apply to the complete server-side result");
    assert.equal(cInitial.filteredTotal, 3, "initial filter should use the displayed term");
    assert.equal(otherCategory.filteredTotal, 3, "category filter should apply server-side");
    assert.equal(enToZhReady.filteredTotal, 2, "readiness filter should distinguish exact direction availability");
    assert.equal(noIssues.filteredTotal, 3, "issue filter should use structured issue counts");
    assert.deepEqual(descending.rows.map((row) => row.term), [`${fixture}_sense`, `${fixture}_pending`, `${fixture}_import`], "teacher Z-A sort should be deterministic");
    assert.deepEqual(nounOnly.facets.partOfSpeech, [{ value: "noun", count: 3 }], "part-of-speech facet should self-exclude its own selected value");
    assert.deepEqual(otherCategory.facets.category, [{ value: "other", count: 3 }], "category facet should self-exclude its own selected value");

    const zeroPosFacet = await readCatalogWorkspacePage({
      batchId: readyBatch.id,
      filters: v2Filters({ level: "B1", partOfSpeech: "noun" }),
      limit: 10,
      offset: 0,
      canReview: true,
      actorUserId: proposerId,
    });
    const zeroCategoryFacet = await readCatalogWorkspacePage({
      batchId: readyBatch.id,
      filters: v2Filters({ level: "B1", category: "other" }),
      limit: 10,
      offset: 0,
      canReview: true,
      actorUserId: proposerId,
    });
    assert.equal(zeroPosFacet.filteredTotal, 0);
    assert.deepEqual(
      zeroPosFacet.facets.partOfSpeech,
      [{ value: "noun", count: 0 }],
      "a selected zero-result POS must remain visible",
    );
    assert.equal(zeroCategoryFacet.filteredTotal, 0);
    assert.deepEqual(
      zeroCategoryFacet.facets.category,
      [{ value: "other", count: 0 }],
      "a selected zero-result category must remain visible",
    );

    const page1 = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 1, offset: 0, canReview: true, actorUserId: proposerId });
    const page2 = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 1, offset: 1, canReview: true, actorUserId: proposerId });
    const page3 = await readCatalogWorkspacePage({ batchId: readyBatch.id, filters, limit: 1, offset: 2, canReview: true, actorUserId: proposerId });
    assert.deepEqual(new Set([...page1.rows, ...page2.rows, ...page3.rows].map((row) => row.id)).size, 3, "stable paging must have no duplicate or omitted fixture rows");

    const sortTraversal: Record<string, number> = {};
    for (const sort of [
      "TERM_ASC",
      "TERM_DESC",
      "UPDATED_DESC",
      "LEVEL_ASC",
      "ACTION_REQUIRED_FIRST",
    ] as const) {
      const sortFilters = parseCatalogWorkspaceQuery(
        new URLSearchParams({ sort }),
      ).filters;
      const ids = new Set<string>();
      let offset = 0;
      let expectedTotal: number | null = null;
      while (true) {
        const page = await readCatalogWorkspacePage({
          batchId: readyBatch.id,
          filters: sortFilters,
          limit: 100,
          offset,
          canReview: true,
          actorUserId: proposerId,
        });
        expectedTotal ??= page.filteredTotal;
        for (const row of page.rows) {
          assert.equal(ids.has(row.id), false, `${sort} repeated row ${row.id}`);
          ids.add(row.id);
        }
        offset += page.rows.length;
        if (!page.rows.length || offset >= page.filteredTotal) break;
      }
      assert.equal(ids.size, expectedTotal, `${sort} traversal omitted rows`);
      sortTraversal[sort] = ids.size;
    }

    const historyOperationPrefix = `${operationPrefix}_history`;
    const historyCreatedAt = new Date(Date.now() - 60_000);
    await prisma.catalogChangeRequest.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        operationId: `${historyOperationPrefix}_${index}`,
        requestFingerprint: `${fixture}_history_fingerprint_${index}`,
        kind: "UPDATE" as const,
        status: "APPROVED" as const,
        catalogKey: `${fixture}_catalog`,
        senseKey: `${fixture}_sense`,
        senseId,
        proposerId,
        reviewerId: otherId,
        baseRevision: 1,
        baseStatus: "DRAFT" as const,
        revision: index,
        payload: payload(`${fixture}_sense`, `歷史分頁 ${index}`, true),
        createdAt: new Date(historyCreatedAt.getTime() - index * 1_000),
        reviewedAt: new Date(historyCreatedAt.getTime() - index * 1_000 + 100),
      })),
    });
    const fixtureHistoryIds = new Set(
      (
        await prisma.catalogChangeRequest.findMany({
          where: { operationId: { startsWith: historyOperationPrefix } },
          select: { id: true },
        })
      ).map((request) => request.id),
    );
    const historyPage1 = await getCatalogSenseHistory({
      senseKey: `${fixture}_sense`,
      actorId: proposerId,
      canReview: true,
      limit: 25,
    });
    assert.ok(historyPage1.nextCursor, "25-row history page must have a cursor");
    await assert.rejects(
      () =>
        getCatalogSenseHistory({
          senseKey: `${fixture}_sense`,
          actorId: otherId,
          canReview: true,
          cursor: historyPage1.nextCursor,
          limit: 25,
        }),
      /CATALOG_HISTORY_CURSOR_CONTEXT_MISMATCH/,
      "reviewer A's cursor must not be reusable by reviewer B",
    );
    await assert.rejects(
      () =>
        getCatalogSenseHistory({
          senseKey: `${fixture}_different_sense`,
          actorId: proposerId,
          canReview: true,
          cursor: historyPage1.nextCursor,
          limit: 25,
        }),
      /CATALOG_HISTORY_CURSOR_CONTEXT_MISMATCH/,
      "a sense history cursor must not be reusable for another sense",
    );
    const insertedAfterSnapshot = await prisma.catalogChangeRequest.create({
      data: {
        operationId: `${historyOperationPrefix}_after_snapshot`,
        requestFingerprint: `${fixture}_history_fingerprint_after_snapshot`,
        kind: "UPDATE",
        status: "APPROVED",
        catalogKey: `${fixture}_catalog`,
        senseKey: `${fixture}_sense`,
        senseId,
        proposerId,
        reviewerId: otherId,
        baseRevision: 1,
        baseStatus: "DRAFT",
        revision: 31,
        payload: payload(`${fixture}_sense`, "快照後新增歷史", true),
        createdAt: new Date(Date.parse(historyPage1.snapshotCutoff) + 1_000),
        reviewedAt: new Date(Date.parse(historyPage1.snapshotCutoff) + 1_100),
      },
      select: { id: true },
    });
    const historyPage2 = await getCatalogSenseHistory({
      senseKey: `${fixture}_sense`,
      actorId: proposerId,
      canReview: true,
      cursor: historyPage1.nextCursor,
      limit: 25,
    });
    const pagedFixtureHistoryIds = new Set(
      [...historyPage1.items, ...historyPage2.items]
        .map((item) => item.id)
        .filter((id) => fixtureHistoryIds.has(id)),
    );
    assert.equal(pagedFixtureHistoryIds.size, 30);
    assert.equal(
      [...historyPage1.items, ...historyPage2.items].some(
        (item) => item.id === insertedAfterSnapshot.id,
      ),
      false,
      "an item inserted after the first-page snapshot must not enter later pages",
    );

    console.log(JSON.stringify({ ready: true, fixtureRows: reviewer.filteredTotal, proposerRows: proposerView.filteredTotal, otherTeacherRows: otherView.filteredTotal, pendingRows: pendingOnly.filteredTotal, enToZhRows: enToZh.filteredTotal, zeroRows: beforeFixture.filteredTotal, overflowRequests: 1002, tailMutationStaledSignature: true, zeroResultFacetsRetained: true, sortTraversal, pagedSenseHistoryRows: pagedFixtureHistoryIds.size, reviewerCursorIsolation: true, crossSenseCursorIsolation: true, historySnapshotInsertionExcluded: true }, null, 2));
  } finally {
    await prisma.catalogChangeRequest.deleteMany({ where: { operationId: { startsWith: operationPrefix } } });
    if (submissionBatchId) {
      await prisma.catalogSubmissionProposalGroup.deleteMany({ where: { batchId: submissionBatchId } });
      await prisma.catalogSubmissionBatch.deleteMany({ where: { id: submissionBatchId } });
    }
    await prisma.catalogImportRow.deleteMany({ where: { batchId: readyBatch.id, sourceFile: `${fixture}.csv` } });
    if (senseId) {
      await prisma.wordSenseRevision.deleteMany({ where: { senseId } });
      await prisma.wordSense.deleteMany({ where: { id: senseId } });
    }
    await prisma.catalogEntry.deleteMany({ where: { catalogKey: `${fixture}_catalog` } });
    await prisma.user.deleteMany({ where: { accountName: { in: [proposerAccount, otherAccount] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
