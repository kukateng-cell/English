import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const ORIGIN = "http://127.0.0.1:3100";

async function login(browser: Browser, accountName: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/账号|賬號|帳號/).fill(accountName);
  await page.getByRole("textbox", { name: /密码|密碼/ }).fill(password);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === (accountName === "admin" ? "/admin" : "/teacher"));
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

    await proposer.page.goto("/teacher/words");
    await expect(proposer.page.getByRole("heading", { name: /詞庫治理工作區|词库治理工作区/ })).toBeVisible();
    await proposer.page.getByLabel(/搜尋詞條、釋義或 key|搜索词条、释义或 key/).fill(term);
    const row = proposer.page.locator("article").filter({ hasText: term }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /查看／修改|查看\/修改/ }).click();
    const dialog = proposer.page.getByRole("dialog");
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
    await approvePending(reviewer.page, reviewerHeaders, senseKey);
    const approvedUpdate = await detail(proposer.page, senseKey);
    expect(approvedUpdate.payload).toMatchObject({
      definitionZh: "已由老師修改的瀏覽器詞庫回歸測試詞",
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
    await expect(historyEntries).toHaveCount(4);
    await expect(historyEntries.filter({ hasText: "APPROVED" })).toHaveCount(4);
  } finally {
    await Promise.all([proposer.context.close(), unrelatedTeacher.context.close(), reviewer.context.close()]);
    await cleanupFixture({
      connectionString: connectionString!,
      senseKey,
      batchId: previewBatchId,
    });
  }
});
