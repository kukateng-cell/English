import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const ORIGIN = "http://127.0.0.1:3100";

async function login(browser: Browser, accountName: string, password: string, expectedPath?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/账号|賬號|帳號/).fill(accountName);
  await page.getByRole("textbox", { name: /密码|密碼/ }).fill(password);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === (expectedPath ?? (accountName === "admin" ? "/admin" : "/teacher")));
  return { context, page };
}

async function mutationHeaders(page: Page) {
  const response = await page.request.get("/api/auth/csrf");
  expect(response.ok()).toBeTruthy();
  const token = (await response.json() as { csrfToken?: string }).csrfToken;
  expect(token).toBeTruthy();
  return {
    Origin: ORIGIN,
    "x-csrf-token": token!,
    "Content-Type": "application/json",
  };
}

async function detail(page: Page, senseKey: string) {
  const response = await page.request.get(`/api/catalog/${encodeURIComponent(senseKey)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<{
    status: "DRAFT" | "ACTIVE" | "RETIRED";
    revision: number | null;
    payload: {
      definitionZh: string;
      exampleEn: string | null;
      exampleZh: string | null;
      sourceReference: string | null;
      contributorRef: string | null;
      changeNote: string | null;
    };
    pendingRequest: null | {
      restricted?: boolean;
      id?: string;
      kind: string;
      status: string;
      revision?: number;
      proposerId?: string;
      reason?: string | null;
      payload?: unknown;
    };
  }>;
}

async function approvePending(page: Page, headers: Record<string, string>, senseKey: string) {
  const current = await detail(page, senseKey);
  expect(current.pendingRequest?.restricted).not.toBe(true);
  expect(current.pendingRequest?.id).toBeTruthy();
  expect(current.pendingRequest?.revision).toBeGreaterThanOrEqual(0);
  const response = await page.request.patch(`/api/catalog/requests/${current.pendingRequest!.id}`, {
    headers,
    data: {
      decision: "APPROVE",
      expectedRevision: current.pendingRequest!.revision,
      reviewNote: "catalog workspace browser regression approved",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function rejectPending(page: Page, headers: Record<string, string>, senseKey: string, reviewNote: string) {
  const current = await detail(page, senseKey);
  expect(current.pendingRequest?.restricted).not.toBe(true);
  expect(current.pendingRequest?.id).toBeTruthy();
  const response = await page.request.patch(`/api/catalog/requests/${current.pendingRequest!.id}`, {
    headers,
    data: {
      decision: "REJECT",
      expectedRevision: current.pendingRequest!.revision,
      reviewNote,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function cleanupFixture(input: {
  connectionString: string;
  senseKey: string;
  batchId: string | null;
}) {
  const client = new Client({ connectionString: input.connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.catalog_fixture_cleanup', 'on', true)");
    await client.query(`DELETE FROM "CatalogFeedback" WHERE "senseKey" = $1`, [input.senseKey]);
    if (input.batchId) {
      await client.query(`DELETE FROM "CatalogHistoryFeedEntry" WHERE "submissionBatchId" = $1`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogAuditEvent" WHERE "submissionBatchId" = $1`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogSubmissionOperationReceipt" WHERE "batchId" = $1`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogSubmissionRow" WHERE "batchId" = $1`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogSubmissionProposalAuthor" WHERE "proposalGroupId" IN (SELECT "id" FROM "CatalogSubmissionProposalGroup" WHERE "batchId" = $1)`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogSubmissionProposalGroup" WHERE "batchId" = $1`, [input.batchId]);
      await client.query(`DELETE FROM "CatalogSubmissionBatch" WHERE "id" = $1`, [input.batchId]);
    }
    const requests = await client.query<{ id: string }>(`SELECT "id" FROM "CatalogChangeRequest" WHERE "senseKey" = $1`, [input.senseKey]);
    const requestIds = requests.rows.map((row) => row.id);
    if (requestIds.length) {
      await client.query(`DELETE FROM "CatalogHistoryFeedEntry" WHERE "requestId" = ANY($1::text[])`, [requestIds]);
      await client.query(`DELETE FROM "CatalogAuditEvent" WHERE "requestId" = ANY($1::text[])`, [requestIds]);
      await client.query(`DELETE FROM "CatalogChangeRequest" WHERE "id" = ANY($1::text[])`, [requestIds]);
    }
    const sense = await client.query<{ id: string; catalogEntryId: string }>(`SELECT "id", "catalogEntryId" FROM "WordSense" WHERE "senseKey" = $1`, [input.senseKey]);
    if (sense.rows[0]) {
      await client.query(`DELETE FROM "Word" WHERE "senseId" = $1`, [sense.rows[0].id]);
      await client.query(`UPDATE "WordSense" SET "approvedRevisionId" = NULL, "status" = 'DRAFT'::"CatalogStatus" WHERE "id" = $1`, [sense.rows[0].id]);
      await client.query(`DELETE FROM "WordSenseRevision" WHERE "senseId" = $1`, [sense.rows[0].id]);
      await client.query(`DELETE FROM "WordSense" WHERE "id" = $1`, [sense.rows[0].id]);
      await client.query(`DELETE FROM "CatalogEntry" WHERE "id" = $1 AND NOT EXISTS (SELECT 1 FROM "WordSense" WHERE "catalogEntryId" = $1)`, [sense.rows[0].catalogEntryId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function installCatalogFeatureAccessMock(
  page: Page,
  initial: { bulkEnabled: boolean; historyEnabled: boolean },
) {
  let flags = initial;
  await page.route("**/api/catalog/access", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        canReview: true,
        actorUserId: "catalog-feature-reviewer",
        ...flags,
      }),
    });
  });
  return async (next: { bulkEnabled: boolean; historyEnabled: boolean }) => {
    flags = next;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  };
}

async function installCommittedHistoryMock(page: Page) {
  const occurredAt = "2026-08-24T04:00:00.000Z";
  await page.route("**/api/catalog/history?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          feedEntryId: "feature-flags-entry",
          sourceKind: "BATCH",
          occurredAt,
          batch: {
            id: "feature-flags-batch",
            fileName: "feature-flags.csv",
            status: "COMMITTED",
            rowCount: 1,
            groupCount: 1,
            visibility: "REVIEWER",
            createdAt: occurredAt,
            submittedAt: occurredAt,
            reviewedAt: occurredAt,
            committedAt: occurredAt,
            proposerName: "提交老師",
            reviewerName: "審核老師",
            finalizerName: "審核老師",
          },
        }],
        nextCursor: null,
      }),
    });
  });
  await page.route("**/api/catalog/history/batches/feature-flags-batch?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null }),
    });
  });
}

async function installBulkWorkItemMock(page: Page) {
  const batch = {
    type: "BATCH",
    id: "feature-flags-work-batch",
    fileName: "hidden-bulk-work.csv",
    status: "PREVIEW",
    rowCount: 3,
    revision: 1,
    updatedAt: "2026-08-24T04:00:00.000Z",
  };
  await page.route("**/api/catalog/work-items?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        counts: { requestsToRevise: 0, batchesToRevise: 1, requestsToReview: 0, batchesToReview: 1, feedbackToReview: 0, totalActionable: 2 },
        canReview: true,
        bulkEnabled: true,
        itemLimit: 12,
        sectionTotals: { needsRevision: 1, toReview: 1, waiting: 0, recent: 0 },
        needsRevision: [batch],
        toReview: [{ ...batch, status: "SUBMITTED", createdAt: batch.updatedAt }],
        waiting: [],
        recent: [],
      }),
    });
  });
}

async function installEmptyCatalogWorkItemsMock(page: Page) {
  await page.route("**/api/catalog/work-items?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        counts: { requestsToRevise: 0, batchesToRevise: 0, requestsToReview: 0, batchesToReview: 0, feedbackToReview: 0, totalActionable: 0 },
        canReview: true,
        bulkEnabled: false,
        itemLimit: 12,
        sectionTotals: { needsRevision: 0, toReview: 0, waiting: 0, recent: 0 },
        needsRevision: [],
        toReview: [],
        waiting: [],
        recent: [],
      }),
    });
  });
}

function catalogRacePayload(term: string, definitionZh: string) {
  return {
    term,
    lemma: term,
    partOfSpeech: "noun",
    level: "A1",
    category: "other",
    definitionZh,
    acceptedAnswersZh: [definitionZh],
    phoneticIpa: "/reɪs/",
    exampleEn: `${term} is used in the detail race regression.`,
    exampleZh: `${definitionZh}用於詞條詳情競態回歸。`,
    acceptedFormsEn: [term],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: ["甲", "乙", "丙", "丁", "戊"],
    enableZhToEn: true,
    distractorEn: ["alpha", "beta", "gamma", "delta", "omega"],
    sourceReference: null,
    contributorRef: null,
    changeNote: null,
    retirementReason: null,
  };
}

function catalogRaceRow(
  id: string,
  senseKey: string,
  payload: ReturnType<typeof catalogRacePayload>,
) {
  return {
    id,
    senseKey,
    catalogKey: `catalog-${id}`,
    sourceFile: "catalog-race.csv",
    sourceRow: 2,
    term: payload.term,
    lemma: payload.lemma,
    definitionZh: payload.definitionZh,
    partOfSpeech: payload.partOfSpeech,
    level: payload.level,
    category: payload.category,
    phoneticIpa: payload.phoneticIpa,
    enableEnToZh: true,
    enableZhToEn: true,
    status: "ACTIVE",
    revision: 1,
    latestRevision: 1,
    approvedRevisionId: `revision-${id}`,
    primaryDisposition: "UPDATE",
    eligibilityResult: null,
    validationErrors: [],
    validationWarnings: [],
    pendingRequest: null,
    hasSense: true,
  };
}

function catalogRaceDetailBody(
  senseKey: string,
  payload: ReturnType<typeof catalogRacePayload>,
) {
  return {
    id: senseKey,
    senseKey,
    catalogKey: `catalog-${senseKey}`,
    sourceFile: "catalog-race.csv",
    sourceRow: 2,
    status: "ACTIVE",
    revision: 1,
    latestRevision: 1,
    approvedRevisionId: `revision-${senseKey}`,
    primaryDisposition: "UPDATE",
    eligibilityResult: null,
    hasSense: true,
    issues: null,
    payload,
    pendingRequest: null,
  };
}

function catalogRacePendingRequest(
  id: string,
  senseKey: string,
  payload: ReturnType<typeof catalogRacePayload>,
) {
  return {
    id,
    kind: "UPDATE",
    status: "PENDING",
    operationId: `operation-${id}`,
    baseRevision: 1,
    baseStatus: "ACTIVE",
    revision: 0,
    payload,
    reason: "dialog intent race regression",
    reviewNote: null,
    createdAt: "2026-08-25T01:00:00.000Z",
    reviewedAt: null,
    proposerId: "teacher-race",
    reviewerId: null,
    catalogKey: `catalog-${senseKey}`,
    senseKey,
    sense: { senseKey, term: payload.term, level: payload.level, category: payload.category },
    sourceImportRow: null,
    proposer: { legalName: "競態老師", accountName: "race-teacher" },
  };
}

async function installCatalogRaceList(
  page: Page,
  rows: Array<ReturnType<typeof catalogRaceRow>>,
  options: {
    canReview?: boolean;
    pending?: Array<ReturnType<typeof catalogRacePendingRequest>>;
    beforeCatalogResponse?: (requestNumber: number) => Promise<void>;
  } = {},
) {
  const signature = "catalog-dialog-intent-race";
  let requestNumber = 0;
  await page.route("**/api/catalog?*", async (route) => {
    requestNumber += 1;
    await options.beforeCatalogResponse?.(requestNumber);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows,
        counts: { all: rows.length, ACTIVE: rows.length, pending: options.pending?.length ?? 0 },
        filteredTotal: rows.length,
        nextCursor: null,
        canReview: options.canReview === true,
        mutationRevision: 1,
        workspaceSignature: signature,
      }),
    });
  });
  if (options.canReview) {
    await page.route("**/api/catalog/requests?status=PENDING*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requests: options.pending ?? [],
          hasMore: false,
          signature,
          mutationRevision: 1,
        }),
      });
    });
  }
}

test("newer catalog detail selection survives an older delayed response and submits the selected sense", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseA = "catalog-detail-race-a";
  const senseB = "catalog-detail-race-b";
  const payloadA = catalogRacePayload("racealpha", "競態甲");
  const payloadB = catalogRacePayload("racebeta", "競態乙");
  let submittedSenseKey: string | null = null;
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await reviewer.page.route("**/api/catalog?*", async (route) => {
      const rows = [
        { id: "race-a", senseKey: senseA, payload: payloadA },
        { id: "race-b", senseKey: senseB, payload: payloadB },
      ].map((item, index) => ({
        id: item.id,
        senseKey: item.senseKey,
        catalogKey: `catalog-${item.id}`,
        sourceFile: "catalog-race.csv",
        sourceRow: index + 2,
        term: item.payload.term,
        lemma: item.payload.lemma,
        definitionZh: item.payload.definitionZh,
        partOfSpeech: item.payload.partOfSpeech,
        level: item.payload.level,
        category: item.payload.category,
        phoneticIpa: item.payload.phoneticIpa,
        enableEnToZh: true,
        enableZhToEn: true,
        status: "ACTIVE",
        revision: 1,
        latestRevision: 1,
        approvedRevisionId: `revision-${item.id}`,
        primaryDisposition: "UPDATE",
        eligibilityResult: null,
        validationErrors: [],
        validationWarnings: [],
        pendingRequest: null,
        hasSense: true,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rows,
          counts: { all: 2, ACTIVE: 2 },
          filteredTotal: 2,
          nextCursor: null,
          canReview: false,
          mutationRevision: 1,
          workspaceSignature: "catalog-detail-race",
        }),
      });
    });
    const detailBody = (senseKey: string, payload: ReturnType<typeof catalogRacePayload>) => ({
      id: senseKey,
      senseKey,
      catalogKey: `catalog-${senseKey}`,
      sourceFile: "catalog-race.csv",
      sourceRow: 2,
      status: "ACTIVE",
      revision: 1,
      latestRevision: 1,
      approvedRevisionId: `revision-${senseKey}`,
      primaryDisposition: "UPDATE",
      eligibilityResult: null,
      hasSense: true,
      issues: null,
      payload,
      pendingRequest: null,
    });
    await reviewer.page.route(`**/api/catalog/${senseA}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailBody(senseA, payloadA)) });
    });
    await reviewer.page.route(`**/api/catalog/${senseB}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailBody(senseB, payloadB)) });
    });
    await reviewer.page.route("**/api/catalog", async (route) => {
      const body = route.request().postDataJSON() as { senseKey?: string };
      submittedSenseKey = body.senseKey ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "PENDING", immediate: false }),
      });
    });

    await reviewer.page.goto("/admin/words");
    const rowA = reviewer.page.locator("article").filter({ hasText: payloadA.term });
    const rowB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await rowA.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    await rowB.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await expect(dialog.getByText(senseB)).toBeVisible();
    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText(senseB)).toBeVisible();
    await expect(dialog.getByText(senseA)).toHaveCount(0);
    await dialog.getByLabel(/中文釋義|中文释义/).fill("競態乙修訂");
    const submitted = reviewer.page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog"
    ));
    await dialog.getByRole("button", { name: /提交草稿/ }).click();
    expect((await submitted).status()).toBe(200);
    expect(submittedSenseKey).toBe(senseB);
  } finally {
    await reviewer.context.close();
  }
});

test("question preview loading resets after payload A to B to A", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseKey = "question-preview-payload-loading";
  const payload = catalogRacePayload("previewloading", "預覽載入甲");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [catalogRaceRow("question-preview-loading", senseKey, payload)]);
    await reviewer.page.route(`**/api/catalog/${senseKey}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseKey, payload)) });
    });
    await reviewer.page.route("**/api/catalog/question-preview", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            preview: {
              prompt: "已中止的舊題目",
              direction: "en-zh",
              options: [],
              correctOptionId: "correct",
              correctAnswer: payload.definitionZh,
              itemConstructionVersion: "catalog-preview-abort-v1",
            },
          }),
        });
      } catch {
        // Payload identity changes are expected to abort the request.
      }
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.locator("article").filter({ hasText: senseKey }).getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect(dialog.getByRole("button", { name: /正在出題|正在出题/ })).toBeVisible();

    const definition = dialog.getByLabel(/中文釋義|中文释义/);
    await definition.fill("預覽載入乙");
    await definition.fill(payload.definitionZh);
    await reviewer.page.waitForTimeout(500);

    const generate = dialog.getByRole("button", { name: /產生預覽|产生预览/ });
    await expect(generate).toBeEnabled();
    await expect(dialog.getByText("已中止的舊題目")).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("question preview does not restore an old result after payload A to B to A", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseKey = "question-preview-payload-result";
  const payload = catalogRacePayload("previewresult", "預覽結果甲");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [catalogRaceRow("question-preview-result", senseKey, payload)]);
    await reviewer.page.route(`**/api/catalog/${senseKey}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseKey, payload)) });
    });
    await reviewer.page.route("**/api/catalog/question-preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preview: {
            prompt: "A 已完成舊題目",
            direction: "en-zh",
            options: [
              { id: "correct", text: payload.definitionZh },
              { id: "wrong-1", text: "干擾一" },
              { id: "wrong-2", text: "干擾二" },
              { id: "wrong-3", text: "干擾三" },
            ],
            correctOptionId: "correct",
            correctAnswer: payload.definitionZh,
            itemConstructionVersion: "catalog-preview-result-v1",
          },
        }),
      });
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.locator("article").filter({ hasText: senseKey }).getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect(dialog.getByText("A 已完成舊題目")).toBeVisible();

    const definition = dialog.getByLabel(/中文釋義|中文释义/);
    await definition.fill("預覽結果乙");
    await definition.fill(payload.definitionZh);

    await expect(dialog.getByText("A 已完成舊題目")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /產生預覽|产生预览/ })).toBeEnabled();
  } finally {
    await reviewer.context.close();
  }
});

test("question preview can restart after switching direction during loading", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseKey = "question-preview-direction-loading";
  const payload = catalogRacePayload("previewdirection", "預覽方向競態");
  let enToZhRequests = 0;
  let releaseFirstRequest = () => {};
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [catalogRaceRow("question-preview-direction-loading", senseKey, payload)]);
    await reviewer.page.route(`**/api/catalog/${senseKey}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseKey, payload)) });
    });
    await reviewer.page.route("**/api/catalog/question-preview", async (route) => {
      const body = route.request().postDataJSON() as { direction: "en-zh" | "zh-en" };
      const requestNumber = body.direction === "en-zh" ? ++enToZhRequests : 0;
      if (requestNumber === 1) {
        await firstRequestGate;
      }
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            preview: {
              prompt: requestNumber === 1 ? "已中止方向題目" : "重新產生方向題目",
              direction: body.direction,
              options: [
                { id: "correct", text: payload.definitionZh },
                { id: "wrong-1", text: "干擾一" },
                { id: "wrong-2", text: "干擾二" },
                { id: "wrong-3", text: "干擾三" },
              ],
              correctOptionId: "correct",
              correctAnswer: payload.definitionZh,
              itemConstructionVersion: `catalog-preview-direction-loading-${requestNumber}`,
            },
          }),
        });
      } catch {
        // Direction changes are expected to abort the first request.
      }
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.locator("article").filter({ hasText: senseKey }).getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect.poll(() => enToZhRequests).toBe(1);
    const direction = dialog.getByRole("combobox", { name: /預覽方向|预览方向/ });
    await direction.selectOption("zh-en");
    await expect(direction).toHaveValue("zh-en");
    await direction.selectOption("en-zh");
    await expect(direction).toHaveValue("en-zh");

    const generate = dialog.getByRole("button", { name: /產生預覽|产生预览/ });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(() => enToZhRequests).toBe(2);
    await expect(dialog.getByText("重新產生方向題目")).toBeVisible();
    releaseFirstRequest();
    await reviewer.page.waitForTimeout(100);
    await expect(dialog.getByText("已中止方向題目")).toHaveCount(0);
  } finally {
    releaseFirstRequest();
    await reviewer.context.close();
  }
});

test("question preview is scoped to sense identity and ignores an older delayed response", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseA = "question-preview-sense-a";
  const senseB = "question-preview-sense-b";
  const sharedPayload = catalogRacePayload("sharedpreview", "相同內容預覽");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [
      catalogRaceRow("question-preview-a", senseA, sharedPayload),
      catalogRaceRow("question-preview-b", senseB, sharedPayload),
    ]);
    await reviewer.page.route(`**/api/catalog/${senseA}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseA, sharedPayload)) });
    });
    await reviewer.page.route(`**/api/catalog/${senseB}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseB, sharedPayload)) });
    });
    await reviewer.page.route("**/api/catalog/question-preview", async (route) => {
      const body = route.request().postDataJSON() as { senseKey?: string };
      if (body.senseKey === senseA) await new Promise((resolve) => setTimeout(resolve, 400));
      const label = body.senseKey === senseA ? "A 舊題目" : "B 正確題目";
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            preview: {
              prompt: label,
              direction: "en-zh",
              options: [
                { id: "correct", text: "相同內容預覽" },
                { id: "wrong-1", text: "干擾一" },
                { id: "wrong-2", text: "干擾二" },
                { id: "wrong-3", text: "干擾三" },
              ],
              correctOptionId: "correct",
              correctAnswer: "相同內容預覽",
              itemConstructionVersion: "catalog-preview-race-v1",
            },
          }),
        });
      } catch {
        // The A request is expected to be aborted when the B dialog intent starts.
      }
    });

    await reviewer.page.goto("/admin/words");
    const rowA = reviewer.page.locator("article").filter({ hasText: senseA });
    const rowB = reviewer.page.locator("article").filter({ hasText: senseB });
    await rowA.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    let dialog = reviewer.page.getByRole("dialog");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await dialog.getByRole("button", { name: /關閉|关闭/ }).click();

    await rowB.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    dialog = reviewer.page.getByRole("dialog");
    await expect(dialog.getByText("A 舊題目")).toHaveCount(0);
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect(dialog.getByText("B 正確題目")).toBeVisible();
    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText("B 正確題目")).toBeVisible();
    await expect(dialog.getByText("A 舊題目")).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("question preview automatically selects the only enabled direction", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseKey = "question-preview-direction";
  const payload = catalogRacePayload("directionpreview", "方向預覽");
  let requestedDirection: string | null = null;
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [catalogRaceRow("question-preview-direction", senseKey, payload)]);
    await reviewer.page.route(`**/api/catalog/${senseKey}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogRaceDetailBody(senseKey, payload)) });
    });
    await reviewer.page.route("**/api/catalog/question-preview", async (route) => {
      const body = route.request().postDataJSON() as { direction?: string };
      requestedDirection = body.direction ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preview: {
            prompt: "方向預覽",
            direction: "zh-en",
            options: [
              { id: "correct", text: "directionpreview" },
              { id: "wrong-1", text: "wrongone" },
              { id: "wrong-2", text: "wrongtwo" },
              { id: "wrong-3", text: "wrongthree" },
            ],
            correctOptionId: "correct",
            correctAnswer: "directionpreview",
            itemConstructionVersion: "catalog-preview-direction-v1",
          },
        }),
      });
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.locator("article").filter({ hasText: senseKey }).getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: /啟用英譯中|启用英译中/ }).uncheck();
    await expect(dialog.getByLabel(/預覽方向|预览方向/)).toHaveValue("zh-en");
    const generate = dialog.getByRole("button", { name: /產生預覽|产生预览/ });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(dialog.getByText("catalog-preview-direction-v1")).toBeVisible();
    expect(requestedDirection).toBe("zh-en");
  } finally {
    await reviewer.context.close();
  }
});

test("opening a pending draft cancels an older delayed detail intent", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseA = "catalog-pending-race-a";
  const senseB = "catalog-pending-race-b";
  const payloadA = catalogRacePayload("pendingracealpha", "草稿競態甲");
  const payloadB = catalogRacePayload("pendingracebeta", "草稿競態乙");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(
      reviewer.page,
      [catalogRaceRow("pending-race-a", senseA, payloadA)],
      {
        canReview: true,
        pending: [catalogRacePendingRequest("pending-race-b", senseB, payloadB)],
      },
    );
    await reviewer.page.route(`**/api/catalog/${senseA}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(catalogRaceDetailBody(senseA, payloadA)),
      });
    });

    await reviewer.page.goto("/admin/words");
    const rowA = reviewer.page.locator("article").filter({ hasText: payloadA.term });
    const pendingB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await expect(pendingB.getByRole("button", { name: /查看草稿/ })).toBeVisible();
    await rowA.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    await pendingB.getByRole("button", { name: /查看草稿/ }).click();

    const dialog = reviewer.page.getByRole("dialog");
    await expect(dialog.getByText(senseB)).toBeVisible();
    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText(senseB)).toBeVisible();
    await expect(dialog.getByText(senseA)).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("a completed older review cannot close or clear a newer draft dialog", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const payloadA = catalogRacePayload("reviewracealpha", "審核競態甲");
  const payloadB = catalogRacePayload("reviewracebeta", "審核競態乙");
  const requestA = catalogRacePendingRequest("review-race-a", "review-sense-a", payloadA);
  const requestB = catalogRacePendingRequest("review-race-b", "review-sense-b", payloadB);
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [], { canReview: true, pending: [requestA, requestB] });
    await reviewer.page.route("**/api/catalog/requests/review-race-a", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ replay: false, request: { status: "APPROVED" } }),
      });
    });

    await reviewer.page.goto("/admin/words");
    const cardA = reviewer.page.locator("article").filter({ hasText: payloadA.term });
    const cardB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await cardA.getByRole("button", { name: /批准/ }).click();
    const note = cardB.getByLabel(/審核備註|审核备注/);
    await note.fill("B 草稿仍然要保留的審核備註");
    await cardB.getByRole("button", { name: /查看草稿/ }).click();
    const dialog = reviewer.page.getByRole("dialog");

    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText("review-sense-b")).toBeVisible();
    await expect(note).toHaveValue("B 草稿仍然要保留的審核備註");
    const notice = reviewer.page.getByTestId("catalog-review-action-notice");
    await expect(notice).toContainText(payloadA.term);
    await expect(notice).toContainText(/草稿已批准並更新詞庫|草稿已批准并更新词库/);
  } finally {
    await reviewer.context.close();
  }
});

test("an older review error uses a global notice without polluting the newer draft", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const payloadA = catalogRacePayload("reviewerroralpha", "錯誤競態甲");
  const payloadB = catalogRacePayload("reviewerrorbeta", "錯誤競態乙");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [], {
      canReview: true,
      pending: [
        catalogRacePendingRequest("review-error-a", "review-error-sense-a", payloadA),
        catalogRacePendingRequest("review-error-b", "review-error-sense-b", payloadB),
      ],
    });
    await reviewer.page.route("**/api/catalog/requests/review-error-a", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "A 專用審核錯誤" }) });
    });

    await reviewer.page.goto("/admin/words");
    const cardA = reviewer.page.locator("article").filter({ hasText: payloadA.term });
    const cardB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await cardA.getByRole("button", { name: /批准/ }).click();
    const note = cardB.getByLabel(/審核備註|审核备注/);
    await note.fill("B 錯誤競態備註");
    await cardB.getByRole("button", { name: /查看草稿/ }).click();
    const dialog = reviewer.page.getByRole("dialog");

    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText("review-error-sense-b")).toBeVisible();
    await expect(note).toHaveValue("B 錯誤競態備註");
    await expect(dialog.getByText("A 專用審核錯誤")).toHaveCount(0);
    const notice = reviewer.page.getByTestId("catalog-review-action-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(payloadA.term);
    await expect(notice).toContainText("A 專用審核錯誤");
  } finally {
    await reviewer.context.close();
  }
});

test("a delayed review success remains visible after switching workspace tabs", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const payload = catalogRacePayload("reviewtabsuccess", "跨分頁審核成功");
  const request = catalogRacePendingRequest("review-tab-success", "review-tab-success-sense", payload);
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [], { canReview: true, pending: [request] });
    await installEmptyCatalogWorkItemsMock(reviewer.page);
    await reviewer.page.route("**/api/catalog/requests/review-tab-success", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ replay: false, request: { status: "APPROVED" } }),
      });
    });

    await reviewer.page.goto("/admin/words");
    const reviewStarted = reviewer.page.waitForRequest((candidate) => candidate.url().endsWith("/api/catalog/requests/review-tab-success"));
    await reviewer.page.locator("article").filter({ hasText: payload.term }).getByRole("button", { name: /批准/ }).click();
    await reviewStarted;
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await expect(reviewer.page.getByRole("heading", { name: /我的詞庫待辦|我的词库待办/ })).toBeVisible();

    const notice = reviewer.page.getByTestId("catalog-review-action-notice");
    await expect(notice).toContainText(payload.term);
    await expect(notice).toContainText(/草稿已批准並更新詞庫|草稿已批准并更新词库/);
  } finally {
    await reviewer.context.close();
  }
});

test("a delayed review error remains visible after switching workspace tabs", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const payload = catalogRacePayload("reviewtaberror", "跨分頁審核失敗");
  const request = catalogRacePendingRequest("review-tab-error", "review-tab-error-sense", payload);
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [], { canReview: true, pending: [request] });
    await installEmptyCatalogWorkItemsMock(reviewer.page);
    await reviewer.page.route("**/api/catalog/requests/review-tab-error", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "跨分頁 A 審核失敗" }) });
    });

    await reviewer.page.goto("/admin/words");
    const reviewStarted = reviewer.page.waitForRequest((candidate) => candidate.url().endsWith("/api/catalog/requests/review-tab-error"));
    await reviewer.page.locator("article").filter({ hasText: payload.term }).getByRole("button", { name: /批准/ }).click();
    await reviewStarted;
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await expect(reviewer.page.getByRole("heading", { name: /我的詞庫待辦|我的词库待办/ })).toBeVisible();

    const notice = reviewer.page.getByTestId("catalog-review-action-notice");
    await expect(notice).toContainText(payload.term);
    await expect(notice).toContainText("跨分頁 A 審核失敗");
  } finally {
    await reviewer.context.close();
  }
});

test("an older delayed retry loader cannot replace a newer catalog detail intent", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseA = "catalog-retry-race-a";
  const senseB = "catalog-retry-race-b";
  const payloadA = catalogRacePayload("retryracealpha", "重試競態甲");
  const payloadB = catalogRacePayload("retryracebeta", "重試競態乙");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(reviewer.page, [catalogRaceRow("retry-race-b", senseB, payloadB)]);
    await reviewer.page.route("**/api/catalog/work-items?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          counts: { requestsToRevise: 1, batchesToRevise: 0, requestsToReview: 0, batchesToReview: 0, feedbackToReview: 0, totalActionable: 1 },
          canReview: true,
          bulkEnabled: false,
          itemLimit: 12,
          sectionTotals: { needsRevision: 1, toReview: 0, waiting: 0, recent: 0 },
          needsRevision: [{
            type: "REQUEST",
            id: "retry-race-request-a",
            kind: "UPDATE",
            status: "REJECTED",
            senseKey: senseA,
            afterTermSnapshot: payloadA.term,
            reviewNote: "請修改後重交",
            updatedAt: "2026-08-25T02:00:00.000Z",
          }],
          toReview: [],
          waiting: [],
          recent: [],
        }),
      });
    });
    await reviewer.page.route("**/api/catalog/requests/retry-race-request-a/retry", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          replay: false,
          retry: {
            supersedesRequestId: "retry-race-request-a",
            kind: "UPDATE",
            senseKey: senseA,
            sourceRowId: null,
            expectedRevision: 1,
            payload: payloadA,
            mergeBaseline: payloadA,
            conflicts: [],
            previousReason: "舊申請理由",
            reviewNote: "請修改後重交",
          },
        }),
      });
    });
    await reviewer.page.route(`**/api/catalog/${senseB}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(catalogRaceDetailBody(senseB, payloadB)),
      });
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await reviewer.page.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    const rowB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await rowB.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();

    const dialog = reviewer.page.getByRole("dialog");
    await expect(dialog.getByText(senseB)).toBeVisible();
    await reviewer.page.waitForTimeout(500);
    await expect(dialog.getByText(senseB)).toBeVisible();
    await expect(dialog.getByText(senseA)).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("a completed submit does not reopen its old dialog after the user opens another draft", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  const senseA = "catalog-submit-race-a";
  const senseB = "catalog-submit-race-b";
  const payloadA = catalogRacePayload("submitracealpha", "提交競態甲");
  const payloadB = catalogRacePayload("submitracebeta", "提交競態乙");
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installCatalogRaceList(
      reviewer.page,
      [catalogRaceRow("submit-race-a", senseA, payloadA)],
      {
        canReview: true,
        pending: [catalogRacePendingRequest("submit-race-b", senseB, payloadB)],
        beforeCatalogResponse: async (requestNumber) => {
          if (requestNumber > 1) await new Promise((resolve) => setTimeout(resolve, 500));
        },
      },
    );
    await reviewer.page.route(`**/api/catalog/${senseA}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(catalogRaceDetailBody(senseA, payloadA)),
      });
    });
    await reviewer.page.route("**/api/catalog", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "PENDING", immediate: false }),
      });
    });

    await reviewer.page.goto("/admin/words");
    const rowA = reviewer.page.locator("article").filter({ hasText: payloadA.term });
    const pendingB = reviewer.page.locator("article").filter({ hasText: payloadB.term });
    await rowA.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = reviewer.page.getByRole("dialog");
    await dialog.getByLabel(/中文釋義|中文释义/).fill("提交競態甲修訂");
    const submitted = reviewer.page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog"
    ));
    await dialog.getByRole("button", { name: /提交草稿/ }).click();
    expect((await submitted).status()).toBe(200);
    await dialog.getByRole("button", { name: /關閉|关闭/ }).click();
    await pendingB.getByRole("button", { name: /查看草稿/ }).click();

    await expect(dialog.getByText(senseB)).toBeVisible();
    await reviewer.page.waitForTimeout(650);
    await expect(dialog.getByText(senseB)).toBeVisible();
    await expect(dialog.getByText(senseA)).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("a no-change batch retry closes the source and removes it from actionable work", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  let closed = false;
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: true, historyEnabled: false });
    await reviewer.page.route("**/api/catalog/work-items?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          counts: { requestsToRevise: 0, batchesToRevise: closed ? 0 : 1, requestsToReview: 0, batchesToReview: 0, feedbackToReview: 0, totalActionable: closed ? 0 : 1 },
          canReview: true,
          bulkEnabled: true,
          itemLimit: 12,
          sectionTotals: { needsRevision: closed ? 0 : 1, toReview: 0, waiting: 0, recent: 0 },
          needsRevision: closed ? [] : [{
            type: "BATCH",
            id: "no-change-retry-batch",
            fileName: "no-change-retry.csv",
            rowCount: 1,
            status: "STALE",
            updatedAt: "2026-08-25T04:00:00.000Z",
          }],
          toReview: [],
          waiting: [],
          recent: [],
        }),
      });
    });
    await reviewer.page.route("**/api/catalog/submissions/no-change-retry-batch/retry-preview", async (route) => {
      closed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          replay: false,
          closed: true,
          code: "CATALOG_BATCH_RETRY_NO_LONGER_APPLICABLE",
          sourceBatchId: "no-change-retry-batch",
        }),
      });
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await reviewer.page.getByRole("button", { name: /一鍵建立修正版預覽|一键建立修正版预览/ }).click();
    await expect(reviewer.page.getByText(/重新比對後已沒有實際修改，項目已由待辦移除|重新比对后已没有实际修改，项目已由待办移除/)).toBeVisible();
    await expect(reviewer.page.getByText("no-change-retry.csv")).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /一鍵建立修正版預覽|一键建立修正版预览/ })).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("blocked batch retry shows the CSV row and readable reason without opening a successor", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  let retryCalls = 0;
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: true, historyEnabled: false });
    await reviewer.page.route("**/api/catalog/work-items?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          counts: { requestsToRevise: 0, batchesToRevise: 1, requestsToReview: 0, batchesToReview: 0, feedbackToReview: 0, totalActionable: 1 },
          canReview: true,
          bulkEnabled: true,
          itemLimit: 12,
          sectionTotals: { needsRevision: 1, toReview: 0, waiting: 0, recent: 0 },
          needsRevision: [{
            type: "BATCH",
            id: "blocked-retry-batch",
            fileName: "blocked-retry.csv",
            rowCount: 2,
            status: "STALE",
            updatedAt: "2026-08-25T03:00:00.000Z",
          }],
          toReview: [],
          waiting: [],
          recent: [],
        }),
      });
    });
    await reviewer.page.route("**/api/catalog/submissions/blocked-retry-batch/retry-preview", async (route) => {
      retryCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "CATALOG_BATCH_RETRY_BLOCKED",
          rows: [{
            rowNumber: 2,
            senseKey: "sense_blocked_word",
            term: "blockedword",
            errors: ["目標詞條已有另一項待審核修改。 等待現有修改完成審核後，再重新建立修正版預覽。"],
          }],
        }),
      });
    });

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await reviewer.page.getByRole("button", { name: /一鍵建立修正版預覽|一键建立修正版预览/ }).click();

    const blockedRow = reviewer.page.getByTestId("catalog-retry-blocked-row-2");
    await expect(blockedRow).toContainText(/CSV 第 2 行/);
    await expect(blockedRow).toContainText("blockedword");
    await expect(blockedRow).toContainText(/已有另一項待審核修改|已有另一项待审核修改/);
    await expect(reviewer.page.getByRole("heading", { name: /我的詞庫待辦|我的词库待办/ })).toBeVisible();
    expect(retryCalls).toBe(1);
  } finally {
    await reviewer.context.close();
  }
});

test("catalog feature flags hide bulk, history and corrective entry points when both are disabled", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: false });
    await installBulkWorkItemMock(reviewer.page);
    await reviewer.page.goto("/admin/words");
    await expect(reviewer.page.getByRole("heading", { name: /詞庫治理工作區|词库治理工作区/ })).toBeVisible();
    await expect(reviewer.page.getByRole("button", { name: /CSV 批量提交/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /修改歷史|修改历史/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /匯出所選作 CSV 更新|汇出所选作 CSV 更新/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /查看歷史|查看历史/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /建立反向修正預覽|建立反向修正预览/ })).toHaveCount(0);
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await expect(reviewer.page.getByText("hidden-bulk-work.csv")).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /一鍵建立修正版預覽|一键建立修正版预览|打開批次審核|打开批次审核/ })).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("catalog feature flags allow history without bulk or corrective preview", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  try {
    await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: false, historyEnabled: true });
    await installCommittedHistoryMock(reviewer.page);
    await reviewer.page.goto("/admin/words");
    await expect(reviewer.page.getByRole("button", { name: /CSV 批量提交/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /匯出所選作 CSV 更新|汇出所选作 CSV 更新/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /查看歷史|查看历史/ }).first()).toBeVisible();
    await reviewer.page.getByRole("button", { name: /修改歷史|修改历史/ }).click();
    const entry = reviewer.page.locator("article").filter({ hasText: "feature-flags.csv" });
    await expect(entry).toBeVisible();
    await entry.getByRole("button").first().click();
    await expect(reviewer.page.getByRole("button", { name: /建立反向修正預覽|建立反向修正预览/ })).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("catalog feature flags expose all entry points and return to catalog after runtime disable", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "Seeded admin credentials are required.");
  const reviewer = await login(browser, "admin", password!);
  try {
    const updateFlags = await installCatalogFeatureAccessMock(reviewer.page, { bulkEnabled: true, historyEnabled: true });
    await installCommittedHistoryMock(reviewer.page);
    await installBulkWorkItemMock(reviewer.page);
    await reviewer.page.goto("/admin/words");
    await expect(reviewer.page.getByRole("button", { name: /CSV 批量提交/ })).toBeVisible();
    await expect(reviewer.page.getByRole("button", { name: /匯出所選作 CSV 更新|汇出所选作 CSV 更新/ })).toBeVisible();
    await expect(reviewer.page.getByRole("button", { name: /查看歷史|查看历史/ }).first()).toBeVisible();
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    await expect(reviewer.page.getByRole("button", { name: /繼續處理預覽|继续处理预览/ })).toBeVisible();
    await reviewer.page.getByRole("button", { name: /完整詞庫|完整词库/ }).click();
    await reviewer.page.getByRole("button", { name: /修改歷史|修改历史/ }).click();
    const entry = reviewer.page.locator("article").filter({ hasText: "feature-flags.csv" });
    await expect(entry).toBeVisible();
    await entry.getByRole("button").first().click();
    await expect(reviewer.page.getByRole("button", { name: /建立反向修正預覽|建立反向修正预览/ })).toBeVisible();

    await updateFlags({ bulkEnabled: false, historyEnabled: false });
    await expect(reviewer.page.getByRole("heading", { name: /詞庫治理工作區|词库治理工作区/ })).toBeVisible();
    await expect(reviewer.page.getByRole("button", { name: /CSV 批量提交/ })).toHaveCount(0);
    await expect(reviewer.page.getByRole("button", { name: /修改歷史|修改历史/ })).toHaveCount(0);
  } finally {
    await reviewer.context.close();
  }
});

test("catalog workspace keeps drafts private and completes one-reviewer lifecycle with a clean CSV round-trip", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const connectionString = process.env.DATABASE_URL;
  test.skip(!password || !connectionString, "Seeded teacher/admin credentials and DATABASE_URL are required.");
  const environment = process.env.DATABASE_ENVIRONMENT;
  if (!environment || environment === "production" || process.env.CONFIRM_DATABASE_ENVIRONMENT !== environment) {
    throw new Error("catalog workspace E2E requires matching non-production DATABASE_ENVIRONMENT and CONFIRM_DATABASE_ENVIRONMENT");
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const term = `e2ecatalog${suffix}`;
  const senseKey = `governance_e2e_${suffix}`;
  let previewBatchId: string | null = null;
  const client = new Client({ connectionString: connectionString! });
  await client.connect();
  const metadata = await client.query<{ value: string }>(`SELECT "value" FROM "DatabaseMetadata" WHERE "key" = 'environment'`);
  await client.end();
  if (metadata.rows[0]?.value !== environment) {
    throw new Error("DatabaseMetadata.environment does not match DATABASE_ENVIRONMENT");
  }

  const proposer = await login(browser, "teacher", password!);
  const unrelatedTeacher = await login(browser, "teacher-reset", password!);
  const reviewer = await login(browser, "admin", password!);
  const proposerHeaders = await mutationHeaders(proposer.page);
  const unrelatedTeacherHeaders = await mutationHeaders(unrelatedTeacher.page);
  const reviewerHeaders = await mutationHeaders(reviewer.page);
  const payload = {
    term,
    lemma: term,
    partOfSpeech: "noun",
    level: "A1",
    category: "other",
    definitionZh: "瀏覽器詞庫回歸測試詞",
    acceptedAnswersZh: ["瀏覽器詞庫回歸測試詞"],
    phoneticIpa: "/tɛst/",
    exampleEn: "This catalog word is used in a browser regression test.",
    exampleZh: "這個詞用於瀏覽器詞庫回歸測試。",
    acceptedFormsEn: [],
    synonymsEn: [],
    antonymsEn: [],
    enableEnToZh: true,
    distractorZh: ["瀏覽器頁面", "測試班級", "詞彙清單", "審核按鈕", "學習記錄"],
    enableZhToEn: true,
    distractorEn: ["browserline", "testclass", "wordlist", "reviewbutton", "studyrecord"],
    sourceReference: "catalog-e2e-source",
    contributorRef: "catalog-e2e-contributor",
    changeNote: "catalog e2e initial provenance",
    retirementReason: null,
  };

  try {
    const create = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: { operationId: randomUUID(), kind: "CREATE", senseKey, payload },
    });
    expect(create.status(), await create.text()).toBe(201);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    expect((await detail(proposer.page, senseKey)).status).toBe("ACTIVE");

    const concurrentOperationId = randomUUID();
    const concurrentPayload = { ...payload, definitionZh: "並發冪等性驗證後的瀏覽器詞庫回歸測試詞", acceptedAnswersZh: ["並發冪等性驗證後的瀏覽器詞庫回歸測試詞"] };
    const concurrentRequest = {
      headers: proposerHeaders,
      data: {
        operationId: concurrentOperationId,
        kind: "UPDATE",
        senseKey,
        expectedRevision: (await detail(proposer.page, senseKey)).revision,
        payload: concurrentPayload,
        reason: "驗證同一操作並發重送會安全 replay",
      },
    };
    const concurrentResponses = await Promise.all([
      proposer.page.request.post("/api/catalog", concurrentRequest),
      proposer.page.request.post("/api/catalog", concurrentRequest),
    ]);
    expect(concurrentResponses.map((response) => response.status()).sort()).toEqual([200, 201]);
    const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json() as Promise<{ requestId: string }>));
    expect(concurrentBodies[0]!.requestId).toBe(concurrentBodies[1]!.requestId);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);

    await proposer.page.goto("/teacher/words");
    await expect(proposer.page.getByRole("heading", { name: /詞庫治理工作區|词库治理工作区/ })).toBeVisible();
    await proposer.page.getByLabel(/搜尋詞條、釋義或 key|搜索词条、释义或 key/).fill(term);
    const row = proposer.page.locator("article").filter({ hasText: term }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = proposer.page.getByRole("dialog");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect(dialog.getByText(/正確答案|正确答案/)).toBeVisible();
    await dialog.getByLabel(/預覽方向|预览方向/).selectOption("zh-en");
    await dialog.getByRole("button", { name: /產生預覽|产生预览/ }).click();
    await expect(dialog.getByText(/選出正確英文詞|选出正确英文词/)).toBeVisible();
    const studentUsername = process.env.TEST_STUDENT_USERNAME;
    const studentPassword = process.env.TEST_STUDENT_PASSWORD;
    expect(studentUsername, "TEST_STUDENT_USERNAME is required for the preview role boundary").toBeTruthy();
    expect(studentPassword, "TEST_STUDENT_PASSWORD is required for the preview role boundary").toBeTruthy();
    const student = await login(browser, studentUsername!, studentPassword!, "/");
    try {
      const studentHeaders = await mutationHeaders(student.page);
      const unauthorizedPreview = await student.page.request.post("/api/catalog/question-preview", {
        headers: studentHeaders,
        data: { payload, senseKey, direction: "en-zh", seed: randomUUID() },
      });
      expect(unauthorizedPreview.status()).toBe(403);
      expect(await unauthorizedPreview.text()).not.toContain("correctOptionId");
    } finally {
      await student.context.close();
    }
    await dialog.getByRole("button", { name: /報告問題|报告问题/ }).click();
    const parentDialog = proposer.page.locator('[aria-labelledby="catalog-dialog-title"]');
    await expect(parentDialog).toHaveAttribute("aria-hidden", "true");
    const feedbackDialog = proposer.page.getByRole("dialog").filter({ has: proposer.page.getByRole("heading", { name: /提出詞庫意見|提出词库意见/ }) });
    await feedbackDialog.getByLabel(/問題類型|问题类型/).selectOption("DISTRACTOR");
    await feedbackDialog.getByLabel(/發現咗咩問題|发现咗咩问题/).fill("呢組干擾項對學生嚟講太容易");
    await feedbackDialog.getByLabel(/建議點改|建议点改/).fill("改用同一語境但意思不同的詞");
    const feedbackOperationIds: string[] = [];
    let hideFirstFeedbackResponse = true;
    await proposer.page.route("**/api/catalog/feedback", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const requestBody = route.request().postDataJSON() as { operationId: string };
      feedbackOperationIds.push(requestBody.operationId);
      const upstream = await route.fetch();
      if (hideFirstFeedbackResponse) {
        hideFirstFeedbackResponse = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "AUTH_BACKEND_UNAVAILABLE" }) });
        return;
      }
      await route.fulfill({ response: upstream });
    });
    await feedbackDialog.getByRole("button", { name: /提交意見|提交意见/ }).click();
    await expect(feedbackDialog.getByRole("alert")).toBeVisible();
    await feedbackDialog.getByRole("button", { name: /提交意見|提交意见/ }).click();
    await expect(feedbackDialog).toHaveCount(0);
    await proposer.page.unroute("**/api/catalog/feedback");
    expect(feedbackOperationIds).toHaveLength(2);
    expect(feedbackOperationIds[1]).toBe(feedbackOperationIds[0]);
    await expect(parentDialog).not.toHaveAttribute("aria-hidden", "true");
    const proposerFeedbackResponse = await proposer.page.request.get("/api/catalog/feedback?scope=mine&limit=100");
    expect(proposerFeedbackResponse.ok(), await proposerFeedbackResponse.text()).toBeTruthy();
    const proposerFeedback = await proposerFeedbackResponse.json() as { feedback: Array<{ message: string; senseKey: string | null }> };
    expect(proposerFeedback.feedback.filter((item) => item.message === "呢組干擾項對學生嚟講太容易" && item.senseKey === senseKey)).toHaveLength(1);
    const unrelatedFeedbackResponse = await unrelatedTeacher.page.request.get("/api/catalog/feedback?scope=mine");
    expect(unrelatedFeedbackResponse.ok(), await unrelatedFeedbackResponse.text()).toBeTruthy();
    const unrelatedFeedback = await unrelatedFeedbackResponse.json() as { feedback: Array<{ message: string }> };
    expect(unrelatedFeedback.feedback.some((item) => item.message === "呢組干擾項對學生嚟講太容易")).toBe(false);
    const concurrentFeedbackResponse = await proposer.page.request.post("/api/catalog/feedback", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        senseKey,
        term,
        kind: "EXAMPLE",
        message: "並發處理 replay 驗證意見",
        suggestedValue: "請檢查例句",
      },
    });
    expect(concurrentFeedbackResponse.status(), await concurrentFeedbackResponse.text()).toBe(201);
    const concurrentFeedback = await concurrentFeedbackResponse.json() as { feedback: { id: string; revision: number } };
    await dialog.getByLabel(/中文釋義|中文释义/).fill("已由老師修改的瀏覽器詞庫回歸測試詞");
    await dialog.getByLabel(/修改／停用理由|修改\/停用理由/).fill("驗證一般老師提交修改草稿");
    const updateResponse = proposer.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog");
    await dialog.getByRole("button", { name: /提交草稿/ }).click();
    expect((await updateResponse).status()).toBe(201);
    await proposer.page.keyboard.press("Escape");

    const restrictedResponse = await unrelatedTeacher.page.request.get(`/api/catalog/${encodeURIComponent(senseKey)}`);
    expect(restrictedResponse.ok(), await restrictedResponse.text()).toBeTruthy();
    const restricted = await restrictedResponse.json() as { pendingRequest?: Record<string, unknown> };
    expect(restricted.pendingRequest).toEqual({ restricted: true, kind: "UPDATE", status: "PENDING" });
    const restrictedListResponse = await unrelatedTeacher.page.request.get(`/api/catalog?q=${encodeURIComponent(term)}&limit=20`);
    expect(restrictedListResponse.ok(), await restrictedListResponse.text()).toBeTruthy();
    const restrictedList = await restrictedListResponse.json() as { rows: Array<{ senseKey: string | null; pendingRequest?: Record<string, unknown> }> };
    const restrictedListRow = restrictedList.rows.find((item) => item.senseKey === senseKey);
    expect(restrictedListRow?.pendingRequest).toEqual({ restricted: true, kind: "UPDATE", status: "PENDING" });
    await rejectPending(reviewer.page, reviewerHeaders, senseKey, "請按學生程度重新寫得更清楚");

    const beforeInterveningUpdate = await detail(unrelatedTeacher.page, senseKey);
    const interveningPayload = {
      ...(beforeInterveningUpdate.payload as typeof payload),
      definitionZh: "另一位老師已批准的正式中文釋義",
      exampleEn: "Another teacher approved this newer example before the retry.",
      exampleZh: "另一位老師在重新提交前批准了這個較新的例句。",
    };
    const interveningUpdate = await unrelatedTeacher.page.request.post("/api/catalog", {
      headers: unrelatedTeacherHeaders,
      data: {
        operationId: randomUUID(),
        kind: "UPDATE",
        senseKey,
        expectedRevision: beforeInterveningUpdate.revision,
        payload: interveningPayload,
        reason: "驗證重新提交會保留中途獲批的正式修改",
      },
    });
    expect(interveningUpdate.status(), await interveningUpdate.text()).toBe(201);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    const reviewWorkResponse = await reviewer.page.request.get("/api/catalog/work-items?limit=100");
    expect(reviewWorkResponse.ok(), await reviewWorkResponse.text()).toBeTruthy();
    const reviewWork = await reviewWorkResponse.json() as { toReview: Array<{ type: string; id: string; message?: string; suggestedValue?: string | null; revision?: number }> };
    const feedbackWork = reviewWork.toReview.find((item) => item.type === "FEEDBACK" && item.message === "呢組干擾項對學生嚟講太容易");
    expect(feedbackWork).toBeTruthy();
    expect(feedbackWork?.suggestedValue).toBe("改用同一語境但意思不同的詞");
    const feedbackItem = reviewer.page.locator("article").filter({ hasText: "呢組干擾項對學生嚟講太容易" });
    await expect(feedbackItem).toBeVisible();
    await expect(feedbackItem).toContainText("改用同一語境但意思不同的詞");
    await feedbackItem.getByRole("textbox").fill("已檢視意見，內容修改會另行審核");
    await feedbackItem.getByRole("button", { name: /標記已跟進|标记已跟进/ }).click();
    await expect(feedbackItem).toHaveCount(0);
    const feedbackReplay = await reviewer.page.request.patch(`/api/catalog/feedback/${feedbackWork!.id}`, {
      headers: reviewerHeaders,
      data: { status: "RESOLVED", resolutionNote: "已檢視意見，內容修改會另行審核", expectedRevision: feedbackWork!.revision },
    });
    expect(feedbackReplay.ok(), await feedbackReplay.text()).toBeTruthy();
    const concurrentResolution = {
      headers: reviewerHeaders,
      data: { status: "RESOLVED", resolutionNote: "並發處理已完成", expectedRevision: concurrentFeedback.feedback.revision },
    };
    const concurrentFeedbackResolutions = await Promise.all([
      reviewer.page.request.patch(`/api/catalog/feedback/${concurrentFeedback.feedback.id}`, concurrentResolution),
      reviewer.page.request.patch(`/api/catalog/feedback/${concurrentFeedback.feedback.id}`, concurrentResolution),
    ]);
    expect(concurrentFeedbackResolutions.map((response) => response.status())).toEqual([200, 200]);

    await proposer.page.goto("/teacher/words");
    await proposer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    const retryItem = proposer.page.locator("article").filter({ hasText: term }).filter({
      has: proposer.page.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }),
    });
    await expect(retryItem).toBeVisible();
    await retryItem.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    const retryDialog = proposer.page.getByRole("dialog");
    await expect(retryDialog.getByText(/重新提交修正版/)).toBeVisible();
    await expect(retryDialog.getByText(/正式版本同原提案有欄位衝突|正式版本同原提案有栏位冲突/)).toBeVisible();
    await retryDialog.getByLabel(/衝突欄位 definitionZh|冲突栏位 definitionZh/).selectOption("PROPOSAL");
    await retryDialog.getByLabel(/中文釋義|中文释义/).fill("按審核意見修正的瀏覽器詞庫回歸測試詞");
    await retryDialog.getByLabel(/修改／停用理由|修改\/停用理由/).fill("已按審核意見修正中文釋義");
    const retryOperationIds: string[] = [];
    let hideFirstRetryResponse = true;
    await proposer.page.route("**/api/catalog", async (route) => {
      if (route.request().method() !== "POST" || new URL(route.request().url()).pathname !== "/api/catalog") {
        await route.continue();
        return;
      }
      const requestBody = route.request().postDataJSON() as { operationId: string; supersedesRequestId?: string };
      if (!requestBody.supersedesRequestId) {
        await route.continue();
        return;
      }
      retryOperationIds.push(requestBody.operationId);
      const upstream = await route.fetch();
      if (hideFirstRetryResponse) {
        hideFirstRetryResponse = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "AUTH_BACKEND_UNAVAILABLE" }) });
        return;
      }
      await route.fulfill({ response: upstream });
    });
    const lostRetryResponse = proposer.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog");
    await retryDialog.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    expect((await lostRetryResponse).status()).toBe(503);
    const retryResponse = proposer.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog");
    await retryDialog.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    expect((await retryResponse).status()).toBe(200);
    await proposer.page.unroute("**/api/catalog");
    expect(retryOperationIds).toHaveLength(2);
    expect(retryOperationIds[1]).toBe(retryOperationIds[0]);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    const approvedUpdate = await detail(proposer.page, senseKey);
    expect(approvedUpdate.payload).toMatchObject({
      definitionZh: "按審核意見修正的瀏覽器詞庫回歸測試詞",
      sourceReference: payload.sourceReference,
      contributorRef: payload.contributorRef,
      changeNote: payload.changeNote,
      exampleEn: interveningPayload.exampleEn,
      exampleZh: interveningPayload.exampleZh,
    });

    const exportResponse = await proposer.page.request.post("/api/catalog/submissions/export", {
      headers: proposerHeaders,
      data: { senseKeys: [senseKey] },
    });
    expect(exportResponse.ok(), await exportResponse.text()).toBeTruthy();
    const csv = await exportResponse.text();
    expect(csv.split("\n", 1)[0]!.split(",")).toHaveLength(34);
    const previewResponse = await proposer.page.request.post("/api/catalog/submissions/preview", {
      headers: {
        ...proposerHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Idempotency-Key": randomUUID(),
        "X-Catalog-Filename": encodeURIComponent("catalog-roundtrip.csv"),
      },
      data: Buffer.from(csv, "utf8"),
    });
    expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
    const preview = await previewResponse.json() as { batch: { id: string; revision: number; rows: Array<{ primaryDisposition: string }>; groups: unknown[] } };
    previewBatchId = preview.batch.id;
    expect(preview.batch.rows[0]?.primaryDisposition).toBe("NO_CHANGE");
    expect(preview.batch.groups).toHaveLength(0);

    const cancel = await proposer.page.request.post(`/api/catalog/submissions/${previewBatchId}/cancel`, {
      headers: proposerHeaders,
      data: { expectedRevision: preview.batch.revision },
    });
    expect(cancel.ok(), await cancel.text()).toBeTruthy();

    const beforeRetire = await detail(reviewer.page, senseKey);
    const pendingStatusPayload = {
      ...(beforeRetire.payload as typeof payload),
      exampleEn: "This pending update is the form baseline for immediate retirement.",
      exampleZh: "這個待審核修改是立即停用操作的表單基線。",
    };
    const pendingStatusUpdate = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "UPDATE",
        senseKey,
        expectedRevision: beforeRetire.revision,
        payload: pendingStatusPayload,
        reason: "驗證審核員開啟 pending UPDATE 後仍可立即停用",
      },
    });
    expect(pendingStatusUpdate.status(), await pendingStatusUpdate.text()).toBe(201);

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByLabel(/搜尋詞條、釋義或 key|搜索词条、释义或 key/).fill(term);
    const statusActionRow = reviewer.page.locator("article").filter({ hasText: term }).filter({
      has: reviewer.page.getByRole("button", { name: /查看／修改|查看\/修改/ }),
    }).first();
    await expect(statusActionRow).toBeVisible();
    await statusActionRow.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const statusActionDialog = reviewer.page.getByRole("dialog");
    await statusActionDialog.getByLabel(/例句英文/).fill("This unsaved edit must not be dropped by a status action.");
    await statusActionDialog.getByLabel(/修改／停用理由|修改\/停用理由/).fill("驗證狀態操作不會靜默丟棄內容修改");
    await statusActionDialog.getByRole("button", { name: /立即停用/ }).click();
    await expect(reviewer.page.getByText(/請先提交 UPDATE 並完成審核|请先提交 UPDATE 并完成审核/)).toBeVisible();
    await statusActionDialog.getByRole("button", { name: /關閉|关闭/ }).click();
    await expect(statusActionDialog).toHaveCount(0);
    await statusActionRow.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    await expect(statusActionDialog.getByLabel(/例句英文/)).toHaveValue(pendingStatusPayload.exampleEn);
    await statusActionDialog.getByLabel(/修改／停用理由|修改\/停用理由/).fill("驗證 pending UPDATE baseline 不會阻止即時停用");
    const immediateRetireResponsePromise = reviewer.page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog",
      { timeout: 5_000 },
    ).catch(() => null);
    reviewer.page.once("dialog", (dialog) => void dialog.accept());
    await statusActionDialog.getByRole("button", { name: /立即停用/ }).click();
    const immediateRetireResponse = await immediateRetireResponsePromise;
    if (!immediateRetireResponse) {
      const alertText = await reviewer.page.getByRole("alert").filter({ hasText: /修改咗詞條內容|修改了词条内容/ }).textContent().catch(() => null);
      throw new Error(`immediate retire did not submit: ${alertText ?? "no UI error"}`);
    }
    expect(immediateRetireResponse.ok()).toBeTruthy();
    const retired = await detail(proposer.page, senseKey);
    expect(retired.status).toBe("RETIRED");
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    const retiredAfterPendingApproval = await detail(proposer.page, senseKey);
    expect(retiredAfterPendingApproval.status).toBe("RETIRED");

    const statusPayloadResponse = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "REACTIVATE",
        senseKey,
        expectedRevision: retiredAfterPendingApproval.revision,
        payload: interveningPayload,
        reason: "狀態申請不可同時夾帶內容",
      },
    });
    expect(statusPayloadResponse.status()).toBe(422);
    expect(await statusPayloadResponse.json()).toMatchObject({ code: "CATALOG_STATUS_PAYLOAD_NOT_ALLOWED" });

    const reactivate = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "REACTIVATE",
        senseKey,
        expectedRevision: retiredAfterPendingApproval.revision,
        reason: "瀏覽器回歸測試重新啟用",
      },
    });
    expect(reactivate.status(), await reactivate.text()).toBe(201);
    const pendingReactivate = await detail(proposer.page, senseKey);
    expect(pendingReactivate.pendingRequest?.id).toBeTruthy();
    await rejectPending(reviewer.page, reviewerHeaders, senseKey, "請補充重新啟用理由後再提交");

    const rejectedReactivatePatch = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "REACTIVATE",
        senseKey,
        expectedRevision: retiredAfterPendingApproval.revision,
        reason: "惡意內容 patch 應被拒絕",
        supersedesRequestId: pendingReactivate.pendingRequest!.id,
        retryPayloadPatch: { definitionZh: "不應生效" },
      },
    });
    expect(rejectedReactivatePatch.status()).toBe(422);

    const statusRetryCurrentPayload = {
      ...(retiredAfterPendingApproval.payload as typeof payload),
      definitionZh: "按審核意見修正的瀏覽器詞庫回歸測試詞",
      exampleEn: "A newer approved example must appear in the reactivation retry.",
      exampleZh: "重新提交啟用申請時必須顯示這個較新的正式例句。",
    };
    const retiredContentUpdate = await unrelatedTeacher.page.request.post("/api/catalog", {
      headers: unrelatedTeacherHeaders,
      data: {
        operationId: randomUUID(),
        kind: "UPDATE",
        senseKey,
        expectedRevision: retiredAfterPendingApproval.revision,
        payload: statusRetryCurrentPayload,
        reason: "驗證狀態重試顯示目前正式 revision",
      },
    });
    expect(retiredContentUpdate.status(), await retiredContentUpdate.text()).toBe(201);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);

    await proposer.page.goto("/teacher/words");
    await proposer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    const reactivateRetryItem = proposer.page.locator("article").filter({ hasText: term }).filter({
      has: proposer.page.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }),
    });
    await expect(reactivateRetryItem).toBeVisible();
    await reactivateRetryItem.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    const reactivateRetryDialog = proposer.page.getByRole("dialog");
    await expect(reactivateRetryDialog.getByText(/狀態變更申請|状态变更申请/)).toBeVisible();
    await expect(reactivateRetryDialog.getByLabel(/中文釋義|中文释义/)).toBeDisabled();
    await expect(reactivateRetryDialog.getByLabel(/例句英文/)).toHaveValue(statusRetryCurrentPayload.exampleEn);
    const reactivateReason = reactivateRetryDialog.getByLabel(/修改／停用理由|修改\/停用理由/);
    await expect(reactivateReason).toBeEnabled();
    await reactivateReason.fill("已補充重新啟用理由並重新提交");
    const reactivateRetryResponse = proposer.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog");
    await reactivateRetryDialog.getByRole("button", { name: /重新提交狀態申請|重新提交状态申请/ }).click();
    expect((await reactivateRetryResponse).status()).toBe(201);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    expect((await detail(proposer.page, senseKey)).status).toBe("ACTIVE");

    await proposer.page.goto("/teacher/words");
    await proposer.page.getByLabel(/搜尋詞條、釋義或 key|搜索词条、释义或 key/).fill(term);
    const activeRow = proposer.page.locator("article").filter({ hasText: term }).first();
    await expect(activeRow).toBeVisible();
    await activeRow.getByRole("button", { name: /查看歷史|查看历史/ }).click();
    await expect(proposer.page.getByRole("heading", { name: /詞條修改歷史|词条修改历史/ })).toBeVisible();
    await expect(proposer.page.getByText(senseKey, { exact: true }).first()).toBeVisible();
    const historyEntries = proposer.page.locator("main article");
    await expect(historyEntries).toHaveCount(10);
    await expect(historyEntries.filter({ hasText: "APPROVED" })).toHaveCount(8);
    await expect(historyEntries.filter({ hasText: "REJECTED" })).toHaveCount(2);

    const activeBeforeInapplicableRetire = await detail(proposer.page, senseKey);
    const obsoleteRetire = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "RETIRE",
        senseKey,
        expectedRevision: activeBeforeInapplicableRetire.revision,
        reason: "建立稍後會失效的停用申請",
      },
    });
    expect(obsoleteRetire.status(), await obsoleteRetire.text()).toBe(201);
    const obsoleteRetireBody = await obsoleteRetire.json() as { requestId: string };
    await rejectPending(reviewer.page, reviewerHeaders, senseKey, "暫不接受這次停用申請");
    const pendingBlockerPayload = {
      ...(activeBeforeInapplicableRetire.payload as typeof payload),
      exampleEn: "A pending update temporarily blocks retrying an older rejected request.",
      exampleZh: "另一個待審核修改會暫時阻止重新提交舊申請。",
    };
    const pendingBlocker = await unrelatedTeacher.page.request.post("/api/catalog", {
      headers: unrelatedTeacherHeaders,
      data: {
        operationId: randomUUID(),
        kind: "UPDATE",
        senseKey,
        expectedRevision: activeBeforeInapplicableRetire.revision,
        payload: pendingBlockerPayload,
        reason: "驗證 pending change 會暫時隱藏舊 rejected retry",
      },
    });
    expect(pendingBlocker.status(), await pendingBlocker.text()).toBe(201);
    const blockedWorkResponse = await proposer.page.request.get("/api/catalog/work-items?limit=100");
    expect(blockedWorkResponse.ok(), await blockedWorkResponse.text()).toBeTruthy();
    const blockedWork = await blockedWorkResponse.json() as { counts: { requestsToRevise: number }; needsRevision: Array<{ id: string }> };
    expect(blockedWork.needsRevision.some((item) => item.id === obsoleteRetireBody.requestId)).toBe(false);
    expect(blockedWork.counts.requestsToRevise).toBe(0);
    const pendingBlockedRetry = await proposer.page.request.get(`/api/catalog/requests/${obsoleteRetireBody.requestId}/retry`);
    expect(pendingBlockedRetry.status()).toBe(409);
    expect(await pendingBlockedRetry.json()).toMatchObject({ code: "CATALOG_CHANGE_PENDING", reason: "CHANGE_PENDING" });

    await rejectPending(reviewer.page, reviewerHeaders, senseKey, "完成 pending blocker 回歸並釋放舊 retry");
    const unblockedWorkResponse = await proposer.page.request.get("/api/catalog/work-items?limit=100");
    expect(unblockedWorkResponse.ok(), await unblockedWorkResponse.text()).toBeTruthy();
    const unblockedWork = await unblockedWorkResponse.json() as { counts: { requestsToRevise: number }; needsRevision: Array<{ id: string }> };
    expect(unblockedWork.needsRevision.some((item) => item.id === obsoleteRetireBody.requestId)).toBe(true);
    expect(unblockedWork.counts.requestsToRevise).toBe(1);

    const immediateRetire = await reviewer.page.request.post("/api/catalog", {
      headers: reviewerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "RETIRE",
        senseKey,
        expectedRevision: activeBeforeInapplicableRetire.revision,
        reason: "另一個獲授權流程已經停用詞義",
        immediate: true,
      },
    });
    expect(immediateRetire.ok(), await immediateRetire.text()).toBeTruthy();
    const obsoleteWorkResponse = await proposer.page.request.get("/api/catalog/work-items?limit=100");
    expect(obsoleteWorkResponse.ok(), await obsoleteWorkResponse.text()).toBeTruthy();
    const obsoleteWork = await obsoleteWorkResponse.json() as { counts: { requestsToRevise: number }; needsRevision: Array<{ id: string }> };
    expect(obsoleteWork.needsRevision.some((item) => item.id === obsoleteRetireBody.requestId)).toBe(false);
    expect(obsoleteWork.counts.requestsToRevise).toBe(0);
    const obsoleteRetry = await proposer.page.request.get(`/api/catalog/requests/${obsoleteRetireBody.requestId}/retry`);
    expect(obsoleteRetry.status()).toBe(409);
    expect(await obsoleteRetry.json()).toMatchObject({
      code: "CATALOG_REQUEST_RETRY_NO_LONGER_APPLICABLE",
      reason: "ALREADY_RETIRED",
    });
  } finally {
    try {
      await cleanupFixture({
        connectionString: connectionString!,
        senseKey,
        batchId: previewBatchId,
      });
    } finally {
      await Promise.allSettled([proposer.context.close(), unrelatedTeacher.context.close(), reviewer.context.close()]);
    }
  }
});
