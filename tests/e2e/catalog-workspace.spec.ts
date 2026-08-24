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
    await feedbackDialog.getByRole("button", { name: /提交意見|提交意见/ }).click();
    await expect(feedbackDialog).toHaveCount(0);
    await expect(parentDialog).not.toHaveAttribute("aria-hidden", "true");
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

    await reviewer.page.goto("/admin/words");
    await reviewer.page.getByRole("button", { name: /我的待辦|我的待办/ }).click();
    const reviewWorkResponse = await reviewer.page.request.get("/api/catalog/work-items?limit=100");
    expect(reviewWorkResponse.ok(), await reviewWorkResponse.text()).toBeTruthy();
    const reviewWork = await reviewWorkResponse.json() as { toReview: Array<{ type: string; id: string; message?: string; revision?: number }> };
    const feedbackWork = reviewWork.toReview.find((item) => item.type === "FEEDBACK" && item.message === "呢組干擾項對學生嚟講太容易");
    expect(feedbackWork).toBeTruthy();
    const feedbackItem = reviewer.page.locator("article").filter({ hasText: "呢組干擾項對學生嚟講太容易" });
    await expect(feedbackItem).toBeVisible();
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
    await retryDialog.getByLabel(/中文釋義|中文释义/).fill("按審核意見修正的瀏覽器詞庫回歸測試詞");
    await retryDialog.getByLabel(/修改／停用理由|修改\/停用理由/).fill("已按審核意見修正中文釋義");
    const retryResponse = proposer.page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/catalog");
    await retryDialog.getByRole("button", { name: /修改後重新提交|修改后重新提交/ }).click();
    expect((await retryResponse).status()).toBe(201);
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    const approvedUpdate = await detail(proposer.page, senseKey);
    expect(approvedUpdate.payload).toMatchObject({
      definitionZh: "按審核意見修正的瀏覽器詞庫回歸測試詞",
      sourceReference: payload.sourceReference,
      contributorRef: payload.contributorRef,
      changeNote: payload.changeNote,
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
    const retire = await reviewer.page.request.post("/api/catalog", {
      headers: reviewerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "RETIRE",
        senseKey,
        expectedRevision: beforeRetire.revision,
        reason: "瀏覽器回歸測試即時停用",
        immediate: true,
      },
    });
    expect(retire.ok(), await retire.text()).toBeTruthy();
    const retired = await detail(proposer.page, senseKey);
    expect(retired.status).toBe("RETIRED");

    const reactivate = await proposer.page.request.post("/api/catalog", {
      headers: proposerHeaders,
      data: {
        operationId: randomUUID(),
        kind: "REACTIVATE",
        senseKey,
        expectedRevision: retired.revision,
        reason: "瀏覽器回歸測試重新啟用",
      },
    });
    expect(reactivate.status(), await reactivate.text()).toBe(201);
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
    await expect(historyEntries).toHaveCount(6);
    await expect(historyEntries.filter({ hasText: "APPROVED" })).toHaveCount(5);
    await expect(historyEntries.filter({ hasText: "REJECTED" })).toHaveCount(1);
  } finally {
    await Promise.all([proposer.context.close(), unrelatedTeacher.context.close(), reviewer.context.close()]);
    await cleanupFixture({
      connectionString: connectionString!,
      senseKey,
      batchId: previewBatchId,
    });
  }
});
