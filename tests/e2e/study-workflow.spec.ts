import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

interface StudyWorkflowData {
  queue: Array<{ word: { id: string; term: string } }>;
  studySession: { id: string; expiresAt: string; nonces: Record<string, string> };
}

async function authenticatedUserId(page: Page): Promise<string> {
  const response = await page.request.get("/api/auth/session");
  const userId = (await response.json()).user?.id as string | undefined;
  expect(userId).toBeTruthy();
  return userId!;
}

async function sameOriginMutationHeaders(
  page: Page,
): Promise<Record<string, string>> {
  const response = await page.request.get("/api/auth/csrf");
  expect(response.ok()).toBe(true);
  const token = (await response.json() as { csrfToken?: unknown }).csrfToken;
  expect(typeof token).toBe("string");
  return {
    origin: new URL(page.url()).origin,
    "x-csrf-token": token as string,
  };
}

async function installQuizCheckpoint(
  page: Page,
  userId: string,
  data: StudyWorkflowData,
) {
  expect(data.queue.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(
    ({ ownerId, queueIds, studySessionId }) => {
      window.localStorage.setItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        JSON.stringify({
          version: 5,
          ownerId,
          ts: Date.now(),
          phase: "quiz",
          unitKey: "global",
          queueSignature: queueIds,
          studySessionId,
          currentIndex: 1,
          knownWordIds: [queueIds[0]],
          unknownWordIds: [],
          quizStats: { correct: 1, wrong: 1 },
          quizTargetId: queueIds[1],
          quizWrongCount: 1,
          pendingQuizIds: [queueIds[0]],
        }),
      );
    },
    {
      ownerId: userId,
      queueIds: data.queue.map((item) => item.word.id),
      studySessionId: data.studySession.id,
    },
  );
  await page.reload();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
  await expect(page.getByTestId("study-quiz-phase")).toHaveAttribute(
    "data-known-count",
    "1",
  );
}

async function installAssessCheckpoint(
  page: Page,
  userId: string,
  data: StudyWorkflowData,
) {
  expect(data.queue.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(
    ({ ownerId, queueIds, studySessionId }) => {
      window.localStorage.setItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        JSON.stringify({
          version: 5,
          ownerId,
          ts: Date.now(),
          phase: "assess",
          unitKey: "global",
          queueSignature: queueIds,
          studySessionId,
          currentIndex: 1,
          knownWordIds: [queueIds[0]],
          unknownWordIds: [],
          quizStats: { correct: 1, wrong: 0 },
          quizTargetId: null,
          quizWrongCount: 0,
          pendingQuizIds: [],
        }),
      );
    },
    {
      ownerId: userId,
      queueIds: data.queue.map((item) => item.word.id),
      studySessionId: data.studySession.id,
    },
  );
}

async function dispatchServerRevision(
  page: Page,
  userId: string,
  wordId: string,
  studySessionId: string,
) {
  await page.evaluate(
    ({ ownerId, affectedWordId, sessionId }) => {
      const key = `study:review-server-revision:${encodeURIComponent(ownerId)}`;
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify({
            version: 1,
            ownerId,
            wordIds: [affectedWordId],
            sessionIds: [sessionId],
            revision: `server-${Date.now()}`,
          }),
          storageArea: window.localStorage,
        }),
      );
    },
    { ownerId: userId, affectedWordId: wordId, sessionId: studySessionId },
  );
}

async function dispatchActiveLease(
  page: Page,
  userId: string,
  leaseId: string,
  wordId: string,
  studySessionId: string,
  active: boolean,
) {
  await page.evaluate(
    ({ ownerId, id, affectedWordId, sessionId, isActive }) => {
      const key = `study:review-active-lease:${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`;
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue: isActive
          ? JSON.stringify({
              version: 1,
              ownerId,
              leaseId: id,
              wordIds: [affectedWordId],
              sessionIds: [sessionId],
              expiresAt: Date.now() + 60_000,
              revision: `lease-${Date.now()}`,
            })
          : null,
        storageArea: window.localStorage,
      }));
    },
    {
      ownerId: userId,
      id: leaseId,
      affectedWordId: wordId,
      sessionId: studySessionId,
      isActive: active,
    },
  );
}

async function dispatchServerMutation(
  page: Page,
  userId: string,
  wordId: string,
  studySessionId: string,
) {
  await page.evaluate(
    ({ ownerId, affectedWordId, sessionId }) => {
      const key = `study:review-mutation:${encodeURIComponent(ownerId)}`;
      const value = JSON.stringify({
        version: 1,
        ownerId,
        kind: "server-mutated",
        wordIds: [affectedWordId],
        sessionIds: [sessionId],
        revision: `e2e-${Date.now()}`,
      });
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: value,
          storageArea: window.localStorage,
        }),
      );
    },
    { ownerId: userId, affectedWordId: wordId, sessionId: studySessionId },
  );
}

test("a cross-tab mutation lease stays closed through server markers until release", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const wordId = data.queue[0].word.id;
  const leaseId = `lease-${randomUUID()}`;
  let freshGets = 0;
  await page.route("**/api/study*", async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === "/api/study"
    ) {
      freshGets += 1;
    }
    await route.continue();
  });
  const dispatchServerMarker = async () => {
    await page.evaluate(
      ({ ownerId, affectedWordId, sessionId, id }) => {
        const key = `study:review-mutation:${encodeURIComponent(ownerId)}`;
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            newValue: JSON.stringify({
              version: 1,
              ownerId,
              kind: "server-mutated",
              wordIds: [affectedWordId],
              sessionIds: [sessionId],
              revision: `server-mutated-${Date.now()}`,
              leaseId: id,
            }),
            storageArea: window.localStorage,
          }),
        );
      },
      {
        ownerId: userId,
        affectedWordId: wordId,
        sessionId: data.studySession.id,
        id: leaseId,
      },
    );
  };

  await dispatchActiveLease(
    page, userId, leaseId, wordId, data.studySession.id, true,
  );
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  await dispatchServerRevision(page, userId, wordId, data.studySession.id);
  await dispatchServerMarker();
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(freshGets).toBe(0);

  const freshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await dispatchActiveLease(
    page, userId, leaseId, wordId, data.studySession.id, false,
  );
  await freshResponse;
  expect(freshGets).toBe(1);
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

test("a failed cross-tab lease reopens interaction without a fresh GET", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  let freshGets = 0;
  await page.route("**/api/study*", async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === "/api/study"
    ) {
      freshGets += 1;
    }
    await route.continue();
  });
  const leaseId = `failed-lease-${randomUUID()}`;
  await dispatchActiveLease(
    page,
    userId,
    leaseId,
    data.queue[0].word.id,
    data.studySession.id,
    true,
  );
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  await dispatchActiveLease(
    page,
    userId,
    leaseId,
    data.queue[0].word.id,
    data.studySession.id,
    false,
  );
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  expect(freshGets).toBe(0);
});

test("two no-Web-Locks leases keep one barrier until both finish", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const wordId = data.queue[0].word.id;
  const firstLease = `parallel-a-${randomUUID()}`;
  const secondLease = `parallel-b-${randomUUID()}`;
  let freshGets = 0;
  await page.route("**/api/study*", async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === "/api/study"
    ) freshGets += 1;
    await route.continue();
  });
  await dispatchActiveLease(
    page, userId, firstLease, wordId, data.studySession.id, true,
  );
  await dispatchActiveLease(
    page, userId, secondLease, wordId, data.studySession.id, true,
  );
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  await dispatchServerRevision(page, userId, wordId, data.studySession.id);
  await dispatchActiveLease(
    page, userId, firstLease, wordId, data.studySession.id, false,
  );
  await page.waitForTimeout(200);
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  expect(freshGets).toBe(0);
  await dispatchActiveLease(
    page, userId, secondLease, wordId, data.studySession.id, false,
  );
  await expect.poll(() => freshGets).toBe(1);
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

test("two failed no-Web-Locks leases reopen without a random GET", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const wordId = data.queue[0].word.id;
  const leases = [`failed-a-${randomUUID()}`, `failed-b-${randomUUID()}`];
  let freshGets = 0;
  await page.route("**/api/study*", async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === "/api/study"
    ) freshGets += 1;
    await route.continue();
  });
  for (const lease of leases) {
    await dispatchActiveLease(
      page, userId, lease, wordId, data.studySession.id, true,
    );
  }
  for (const lease of leases) {
    await dispatchActiveLease(
      page, userId, lease, wordId, data.studySession.id, false,
    );
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  expect(freshGets).toBe(0);
});

test("authenticated card dismissal enters one quiz exactly once", async ({
  page,
}) => {
  await page.goto("/study");
  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok()).toBe(true);
  expect((await sessionResponse.json()).user?.id).toBeTruthy();

  const card = page.getByTestId("word-card-drag-layer");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  if (!box) throw new Error("Card bounding box is unavailable");
  const startX = box.x + box.width * 0.25;
  const y = box.y + box.height * 0.25;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) {
    await page.mouse.move(startX + step * 36, y);
  }
  await page.mouse.up();

  const quiz = page.getByTestId("study-quiz-phase");
  await expect(quiz).toBeVisible();
  await expect(quiz).toHaveAttribute("data-known-count", "1");
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  await expect(page.getByText("認字小測", { exact: true })).toBeVisible();
  await expect(page.getByText("把意思配回單詞", { exact: true })).toBeVisible();
  await expect(page.locator(".quiz-card-layout")).toBeVisible();
  await expect(page.getByTestId("quiz-option")).toHaveCount(4);
  await expect(page.locator(".level-badge")).toBeVisible();
  const speaker = page.getByRole("button", { name: "發音" });
  if (await speaker.count()) await expect(speaker).toContainText("發音");
});

test("a superseded quiz credential preserves and replays the same answer operation", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const targetWordId = initialData.queue[0].word.id;
  const freshQueueSessionId = `fresh-queue-session-${randomUUID()}`;
  const recoverySessionId = `recovery-session-${randomUUID()}`;
  const freshNonce = `fresh-nonce-${randomUUID()}`;
  const freshNonces = { ...initialData.studySession.nonces };
  delete freshNonces[targetWordId];
  const submissions: Array<{
    operationId: string;
    wordId: string;
    quality: number;
    studySessionId: string;
    nonce: string;
  }> = [];
  const recoveryRequests: Array<Record<string, unknown>> = [];
  let reloads = 0;
  await page.route("**/api/study/credentials", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    recoveryRequests.push(body);
    const operations = body.operations as Array<{
      operationId: string;
      wordId: string;
    }>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        studySession: { id: recoverySessionId },
        credentials: [{ ...operations[0], nonce: freshNonce }],
      }),
    });
  });
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      reloads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...initialData,
          queue: initialData.queue.filter(
            (item) => item.word.id !== targetWordId,
          ),
          studySession: {
            ...initialData.studySession,
            id: freshQueueSessionId,
            nonces: freshNonces,
          },
        }),
      });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as (typeof submissions)[number];
    submissions.push(body);
    if (submissions.length === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "学习 session 已由较新的凭证取代",
          code: "SESSION_SUPERSEDED",
          requiresQueueReload: true,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.getByRole("button", { name: /我會|我会/ }).click();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
  await page.locator(
    `[data-testid="quiz-option"][data-option-id="${targetWordId}"]`,
  ).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(reloads).toBeGreaterThanOrEqual(1);
  expect(recoveryRequests).toHaveLength(1);
  expect(recoveryRequests[0]).toMatchObject({
    mode: "recover",
    previousSessionId: initialData.studySession.id,
    operations: [{
      operationId: submissions[0].operationId,
      wordId: targetWordId,
      quality: submissions[0].quality,
    }],
  });
  expect(submissions[1]).toMatchObject({
    operationId: submissions[0].operationId,
    wordId: submissions[0].wordId,
    quality: submissions[0].quality,
    studySessionId: recoverySessionId,
    nonce: freshNonce,
  });
  const rows = await page.evaluate((ownerId) => {
    const prefix = `study:review-item:${encodeURIComponent(ownerId)}:`;
    return Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
  }, userId);
  expect(rows).toEqual([]);
});

test("reconciliation cancels a selected quiz answer before its delayed callback", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await page.getByRole("button", { name: /我會|我会/ }).click();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
  await page.getByTestId("quiz-option").first().click();

  await dispatchServerMutation(
    page,
    userId,
    data.queue[0].word.id,
    data.studySession.id,
  );
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await page.waitForTimeout(1_500);
  const reviewRows = await page.evaluate((ownerId) => {
    const prefix = `study:review-item:${encodeURIComponent(ownerId)}:`;
    return Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
  }, userId);
  expect(reviewRows).toEqual([]);
  await expect(page.getByTestId("study-quiz-phase")).toHaveCount(0);
});

test("reconciliation cancels the help-panel delayed advance", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await page.getByRole("button", { name: /還不會|还不会/ }).click();
  await expect(page.getByTestId("help-panel-dismiss")).toBeVisible();
  await page.getByTestId("help-panel-dismiss").click();

  const freshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await dispatchServerMutation(
    page,
    userId,
    data.queue[0].word.id,
    data.studySession.id,
  );
  const freshData = (await (await freshResponse).json()) as StudyWorkflowData;
  const card = page.getByTestId("word-card-drag-layer");
  await expect(card).toBeVisible();
  await page.waitForTimeout(350);
  await expect(
    card.getByText(freshData.queue[0].word.term, { exact: true }),
  ).toBeVisible();
});

test("queue request runs beside startup flush but interaction waits", async ({
  page,
}) => {
  await page.goto("/study");
  const sessionResponse = await page.request.get("/api/auth/session");
  const userId = (await sessionResponse.json()).user?.id as string | undefined;
  expect(userId).toBeTruthy();
  // Let the first navigation finish its own queue/lock lifecycle before
  // seeding the row used by the reload under test.
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();

  await page.evaluate((ownerId) => {
    const operationId = "startup-pending-operation";
    window.localStorage.setItem(
      `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operationId)}`,
      JSON.stringify({
        ownerId,
        operationId,
        wordId: "startup-pending-word",
        quality: 5,
        ts: Date.now(),
        attempts: 0,
        status: "pending",
        studySessionId: "startup-pending-session",
        nonce: "startup-pending-nonce",
        credentialState: "valid",
      }),
    );
  }, userId!);

  let releasePost!: () => void;
  let markPostStarted!: () => void;
  const blockedPost = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise<void>((resolve) => {
    markPostStarted = resolve;
  });
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/study"
    ) {
      markPostStarted();
      await blockedPost;
      await route.fulfill({ status: 503, body: "{}" }).catch(() => undefined);
      return;
    }
    await route.continue();
  });

  const queueLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.reload();
  await Promise.all([postStarted, queueLoaded]);
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releasePost();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

for (const startupFailure of [
  { name: "429", status: 429 },
  { name: "500", status: 500 },
  { name: "network failure", status: null },
] as const) {
  test(`startup ${startupFailure.name} keeps its resume snapshot without a random refetch`, async ({
    page,
  }) => {
    const initialResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await page.goto("/study");
    const data = (await (await initialResponse).json()) as StudyWorkflowData;
    const userId = await authenticatedUserId(page);
    await installAssessCheckpoint(page, userId, data);
    const operationId = `startup-${startupFailure.name}-${randomUUID()}`;
    await page.evaluate(
      ({ ownerId, operation, wordId, studySessionId, nonce }) => {
        window.localStorage.setItem(
          `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
          JSON.stringify({
            ownerId,
            operationId: operation,
            wordId,
            quality: 5,
            ts: Date.now(),
            attempts: 0,
            status: "pending",
            studySessionId,
            nonce,
            credentialState: "valid",
          }),
        );
      },
      {
        ownerId: userId,
        operation: operationId,
        wordId: data.queue[0].word.id,
        studySessionId: data.studySession.id,
        nonce: data.studySession.nonces[data.queue[0].word.id],
      },
    );

    const queueRequests: string[] = [];
    await page.route("**/api/study*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname !== "/api/study") {
        await route.continue();
        return;
      }
      if (request.method() === "GET") {
        queueRequests.push(request.url());
        await route.continue();
        return;
      }
      if (startupFailure.status === null) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: startupFailure.status,
        contentType: "application/json",
        headers: startupFailure.status === 429
          ? { "retry-after": "60" }
          : undefined,
        body: JSON.stringify({ error: `simulated ${startupFailure.name}` }),
      });
    });

    await page.reload();
    await expect(page.getByText(
      /目前學習隊列仍有同一單詞等待同步|目前学习队列仍有同一单词等待同步/,
    )).toBeVisible();
    await expect.poll(() => queueRequests.length).toBe(1);
    const resumeRequest = new URL(queueRequests[0]);
    expect(resumeRequest.searchParams.get("resumeIds")).toBe(
      data.queue.map((item) => item.word.id).join(","),
    );
    expect(resumeRequest.searchParams.get("resumeSessionId")).toBe(
      data.studySession.id,
    );
    await page.waitForTimeout(250);
    expect(queueRequests).toHaveLength(1);
    const checkpoint = await page.evaluate((ownerId) => {
      const raw = window.localStorage.getItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
      );
      return raw ? JSON.parse(raw) : null;
    }, userId);
    expect(checkpoint?.currentIndex).toBe(1);
    expect(checkpoint?.knownWordIds).toEqual([data.queue[0].word.id]);
  });
}

test("an expired startup lease does not discard a resume snapshot", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await installAssessCheckpoint(page, userId, data);
  await page.evaluate(
    ({ ownerId, wordId, sessionId }) => {
      window.localStorage.setItem(
        `study:review-active-lease:${encodeURIComponent(ownerId)}:expired-startup-lease`,
        JSON.stringify({
          version: 1,
          ownerId,
          wordIds: [wordId],
          sessionIds: [sessionId],
          revision: `expired-${Date.now()}`,
          leaseId: "expired-startup-lease",
          expiresAt: Date.now() - 1_000,
        }),
      );
    },
    {
      ownerId: userId,
      wordId: data.queue[0].word.id,
      sessionId: data.studySession.id,
    },
  );
  const queueRequests: string[] = [];
  await page.route("**/api/study*", async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === "/api/study"
    ) {
      queueRequests.push(route.request().url());
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.getByText(/已恢復上次進度|已恢复上次进度/)).toBeVisible();
  await expect(page.getByText(/認識 1|认识 1/)).toBeVisible();
  await expect.poll(() => queueRequests.length).toBe(1);
  expect(new URL(queueRequests[0]).searchParams.get("resumeSessionId")).toBe(
    data.studySession.id,
  );
});

test("startup follows lease heartbeats instead of a fixed deadline", async ({ page }) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const leaseId = `heartbeat-${randomUUID()}`;
  const initialLeaseDeadline = await page.evaluate(
    ({ ownerId, id, wordId, sessionId }) => {
      const key = `study:review-active-lease:${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`;
      const expiresAt = Date.now() + 4_000;
      window.localStorage.setItem(key, JSON.stringify({
        version: 1,
        ownerId,
        leaseId: id,
        wordIds: [wordId],
        sessionIds: [sessionId],
        expiresAt,
        revision: `heartbeat-initial-${Date.now()}`,
      }));
      return expiresAt;
    },
    {
      ownerId: userId,
      id: leaseId,
      wordId: data.queue[0].word.id,
      sessionId: data.studySession.id,
    },
  );

  await page.reload();
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  expect(Date.now()).toBeLessThan(initialLeaseDeadline);
  await page.evaluate(
    ({ ownerId, id, wordId, sessionId }) => {
      const key = `study:review-active-lease:${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`;
      window.localStorage.setItem(key, JSON.stringify({
        version: 1,
        ownerId,
        leaseId: id,
        wordIds: [wordId],
        sessionIds: [sessionId],
        expiresAt: Date.now() + 5_000,
        revision: `heartbeat-extended-${Date.now()}`,
      }));
    },
    {
      ownerId: userId,
      id: leaseId,
      wordId: data.queue[0].word.id,
      sessionId: data.studySession.id,
    },
  );
  await page.waitForTimeout(
    Math.max(0, initialLeaseDeadline - Date.now() + 250),
  );
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);

  await page.evaluate(
    ({ ownerId, id }) => {
      window.localStorage.removeItem(
        `study:review-active-lease:${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`,
      );
    },
    { ownerId: userId, id: leaseId },
  );
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

test("an expired active row enters the barrier before slow credential renewal", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const operationId = `slow-renewal-${randomUUID()}`;
  let releaseRenewal!: () => void;
  let renewalStarted!: () => void;
  const renewalGate = new Promise<void>((resolve) => {
    releaseRenewal = resolve;
  });
  const started = new Promise<void>((resolve) => {
    renewalStarted = resolve;
  });
  await page.route("**/api/study/credentials", async (route) => {
    renewalStarted();
    await renewalGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "simulated renewal delay" }),
    });
  });
  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 1,
          status: "pending",
          studySessionId,
          credentialState: "expired",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: data.queue[0].word.id,
      studySessionId: data.studySession.id,
    },
  );
  await started;
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releaseRenewal();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

test("reconciliation keeps its barrier until a second expired active row is handled", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const unrelatedOperation = `expired-unrelated-${randomUUID()}`;
  const activeOperation = `expired-active-${randomUUID()}`;
  let renewalCalls = 0;
  let releaseSecondRenewal!: () => void;
  let markSecondRenewalStarted!: () => void;
  const secondRenewalGate = new Promise<void>((resolve) => {
    releaseSecondRenewal = resolve;
  });
  const secondRenewalStarted = new Promise<void>((resolve) => {
    markSecondRenewalStarted = resolve;
  });
  await page.route("**/api/study/credentials", async (route) => {
    renewalCalls += 1;
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: Array<{ operationId: string; wordId: string }>;
    };
    if (renewalCalls === 2) {
      markSecondRenewalStarted();
      await secondRenewalGate;
    }
    const operation = body.operations[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        studySession: { id: `renewed-${operation.operationId}` },
        credentials: [{ ...operation, nonce: `nonce-${operation.operationId}` }],
      }),
    });
  });
  await page.route("**/api/study", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.evaluate(
    ({ ownerId, rows }) => {
      for (const row of rows) {
        window.localStorage.setItem(
          `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(row.operationId)}`,
          JSON.stringify({
            ownerId,
            operationId: row.operationId,
            wordId: row.wordId,
            quality: 5,
            ts: row.ts,
            attempts: 1,
            status: "pending",
            studySessionId: row.studySessionId,
            credentialState: "expired",
          }),
        );
      }
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      rows: [
        {
          operationId: unrelatedOperation,
          wordId: `outside-queue-${randomUUID()}`,
          studySessionId: `expired-session-${randomUUID()}`,
          ts: Date.now() - 1_000,
        },
        {
          operationId: activeOperation,
          wordId: data.queue[0].word.id,
          studySessionId: data.studySession.id,
          ts: Date.now(),
        },
      ],
    },
  );
  await secondRenewalStarted;
  try {
    expect(renewalCalls).toBe(2);
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releaseSecondRenewal();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
});

test("a quiz answer does not release the barrier before active backlog reconciliation", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  expect(data.queue.length).toBeGreaterThanOrEqual(2);
  const userId = await authenticatedUserId(page);
  const currentWordId = data.queue[0].word.id;
  const activeBacklogWordId = data.queue[1].word.id;
  const unrelatedOperation = `quiz-unrelated-${randomUUID()}`;
  const activeOperation = `quiz-active-${randomUUID()}`;
  let renewalCalls = 0;
  let releaseActiveRenewal!: () => void;
  let markActiveRenewalStarted!: () => void;
  const activeRenewalGate = new Promise<void>((resolve) => {
    releaseActiveRenewal = resolve;
  });
  const activeRenewalStarted = new Promise<void>((resolve) => {
    markActiveRenewalStarted = resolve;
  });
  const submittedWords: string[] = [];

  await page.route("**/api/study/credentials", async (route) => {
    renewalCalls += 1;
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: Array<{ operationId: string; wordId: string }>;
    };
    const operation = body.operations[0];
    if (operation.operationId === activeOperation) {
      markActiveRenewalStarted();
      await activeRenewalGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        studySession: { id: `renewed-${operation.operationId}` },
        credentials: [{ ...operation, nonce: `nonce-${operation.operationId}` }],
      }),
    });
  });
  await page.route("**/api/study", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { wordId: string };
      submittedWords.push(body.wordId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
      return;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ ownerId, rows }) => {
      for (const row of rows) {
        window.localStorage.setItem(
          `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(row.operationId)}`,
          JSON.stringify({
            ownerId,
            operationId: row.operationId,
            wordId: row.wordId,
            quality: 5,
            ts: row.ts,
            attempts: 1,
            status: "pending",
            studySessionId: row.studySessionId,
            credentialState: "expired",
          }),
        );
      }
    },
    {
      ownerId: userId,
      rows: [
        {
          operationId: unrelatedOperation,
          wordId: `outside-queue-${randomUUID()}`,
          studySessionId: `expired-unrelated-${randomUUID()}`,
          ts: Date.now() - 1_000,
        },
        {
          operationId: activeOperation,
          wordId: activeBacklogWordId,
          studySessionId: `expired-active-${randomUUID()}`,
          ts: Date.now(),
        },
      ],
    },
  );

  await page.getByRole("button", { name: /我會|我会/ }).click();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
  await page.locator(
    `[data-testid="quiz-option"][data-option-id="${currentWordId}"]`,
  ).click();
  await activeRenewalStarted;
  try {
    expect(renewalCalls).toBe(2);
    expect(submittedWords[0]).toBe(currentWordId);
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
    await expect(page.getByTestId("study-quiz-phase")).toHaveCount(0);
  } finally {
    releaseActiveRenewal();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect.poll(() => submittedWords).toContain(activeBacklogWordId);
});

test("legacy row consuming the current nonce forces a fresh queue session", async ({
  page,
}, testInfo) => {
  const legacyOperationId =
    `startup-legacy-${testInfo.project.name}-${randomUUID()}`;
  const initialQueueResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialQueueResponse).json()) as {
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string; nonces: Record<string, string> };
  };
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  const sessionResponse = await page.request.get("/api/auth/session");
  const userId = (await sessionResponse.json()).user?.id as string | undefined;
  expect(userId).toBeTruthy();
  const startupWordId = initialData.queue[0]?.word.id;
  expect(startupWordId).toBeTruthy();

  await page.evaluate(
    ({ ownerId, wordId, queueIds, studySessionId, operationId }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operationId)}`,
        JSON.stringify({
          ownerId,
          operationId,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          credentialState: "legacy-claimed",
        }),
      );
      window.localStorage.setItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        JSON.stringify({
          version: 5,
          ownerId,
          ts: Date.now(),
          phase: "assess",
          unitKey: "global",
          queueSignature: queueIds,
          studySessionId,
          currentIndex: 0,
          knownWordIds: [],
          unknownWordIds: [],
          quizStats: { correct: 0, wrong: 0 },
          quizTargetId: null,
          quizWrongCount: 0,
          pendingQuizIds: [],
        }),
      );
    },
    {
      ownerId: userId!,
      wordId: startupWordId!,
      queueIds: initialData.queue.map((item) => item.word.id),
      studySessionId: initialData.studySession.id,
      operationId: legacyOperationId,
    },
  );

  let releaseLegacyPost!: () => void;
  let markLegacyPostStarted!: () => void;
  const blockedLegacyPost = new Promise<void>((resolve) => {
    releaseLegacyPost = resolve;
  });
  const legacyPostStarted = new Promise<void>((resolve) => {
    markLegacyPostStarted = resolve;
  });
  const queueResponses: Array<{
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string; nonces: Record<string, string> };
  }> = [];
  const legacySubmissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      const response = await route.fetch();
      queueResponses.push(await response.json());
      await route.fulfill({ response });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    if (body.operationId === legacyOperationId) {
      legacySubmissions.push(body);
      markLegacyPostStarted();
      await blockedLegacyPost;
    }
    await route.continue();
  });

  await page.reload();
  await legacyPostStarted;
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releaseLegacyPost();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect.poll(() => queueResponses.length).toBeGreaterThanOrEqual(2);

  const legacySubmission = legacySubmissions[0];
  expect(legacySubmission?.studySessionId).toBe(queueResponses[0].studySession.id);
  expect(legacySubmission?.nonce).toBe(
    queueResponses[0].studySession.nonces[startupWordId!],
  );
  const freshResponse = queueResponses.at(-1)!;
  expect(freshResponse.studySession.id).not.toBe(queueResponses[0].studySession.id);
  expect(freshResponse.studySession.nonces[startupWordId!]).toBeUndefined();
  expect(
    freshResponse.queue.some((item) => item.word.id === startupWordId),
  ).toBe(false);
  const persistedRows = await page.evaluate((ownerId) => {
    const prefix = `study:review-item:${encodeURIComponent(ownerId)}:`;
    const rows: unknown[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) {
        rows.push(JSON.parse(window.localStorage.getItem(key) ?? "{}"));
      }
    }
    return rows;
  }, userId!);
  expect(persistedRows).toEqual([]);
});

test("claiming a current-word legacy review re-enters the reconciliation barrier", async ({
  page,
}) => {
  const initialQueueResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialQueueResponse).json()) as {
    queue: Array<{ word: { id: string } }>;
  };
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  const sessionResponse = await page.request.get("/api/auth/session");
  const userId = (await sessionResponse.json()).user?.id as string | undefined;
  const currentWordId = initialData.queue[0]?.word.id;
  expect(userId).toBeTruthy();
  expect(currentWordId).toBeTruthy();

  const queueResponses: Array<{
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string; nonces: Record<string, string> };
  }> = [];
  const legacySubmissions: Array<Record<string, unknown>> = [];
  let releaseLegacyPost!: () => void;
  let markLegacyPostStarted!: () => void;
  const blockedLegacyPost = new Promise<void>((resolve) => {
    releaseLegacyPost = resolve;
  });
  const legacyPostStarted = new Promise<void>((resolve) => {
    markLegacyPostStarted = resolve;
  });
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      const response = await route.fetch();
      queueResponses.push(await response.json());
      await route.fulfill({ response });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    if (
      body.wordId === currentWordId &&
      String(body.operationId).startsWith("legacy-claim:")
    ) {
      legacySubmissions.push(body);
      markLegacyPostStarted();
      await blockedLegacyPost;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ wordId, ts }) => {
      window.localStorage.setItem(
        "study:review-queue",
        JSON.stringify({ items: [{ wordId, quality: 5, ts }] }),
      );
      window.dispatchEvent(new Event("online"));
    },
    { wordId: currentWordId!, ts: Date.now() + Math.random() * 10_000 },
  );
  const claimButton = page.getByRole("button", { name: /歸入我的記錄|归入我的记录/ });
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await legacyPostStarted;
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releaseLegacyPost();
  }

  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect.poll(() => queueResponses.length).toBeGreaterThanOrEqual(2);
  const legacySubmission = legacySubmissions[0];
  expect(legacySubmission?.studySessionId).toBe(queueResponses[0].studySession.id);
  expect(legacySubmission?.nonce).toBe(
    queueResponses[0].studySession.nonces[currentWordId!],
  );
  const freshResponse = queueResponses.at(-1)!;
  expect(freshResponse.studySession.id).not.toBe(queueResponses[0].studySession.id);
  expect(freshResponse.studySession.nonces[currentWordId!]).toBeUndefined();
  expect(
    freshResponse.queue.some((item) => item.word.id === currentWordId),
  ).toBe(false);
  const remaining = await page.evaluate((ownerId) => {
    const ownerPrefix = `study:review-item:${encodeURIComponent(ownerId)}:`;
    return Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key) => key?.startsWith(ownerPrefix));
  }, userId!);
  expect(remaining).toEqual([]);
});

test("an online flush cannot leave a consumed active nonce interactive", async ({
  page,
}) => {
  const initialQueueResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialQueueResponse).json()) as {
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string; nonces: Record<string, string> };
  };
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  const sessionResponse = await page.request.get("/api/auth/session");
  const userId = (await sessionResponse.json()).user?.id as string | undefined;
  const activeWordId = initialData.queue[0]?.word.id;
  expect(userId).toBeTruthy();
  expect(activeWordId).toBeTruthy();
  const operationId = `online-active-${randomUUID()}`;

  let releasePost!: () => void;
  let markPostStarted!: () => void;
  const blockedPost = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise<void>((resolve) => {
    markPostStarted = resolve;
  });
  const queueResponses: Array<{
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string; nonces: Record<string, string> };
  }> = [];
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      const response = await route.fetch();
      queueResponses.push(await response.json());
      await route.fulfill({ response });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    if (body.operationId === operationId) {
      markPostStarted();
      await blockedPost;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId!,
      operation: operationId,
      wordId: activeWordId!,
      studySessionId: initialData.studySession.id,
      nonce: initialData.studySession.nonces[activeWordId!],
    },
  );

  await postStarted;
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releasePost();
  }
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect.poll(() => queueResponses.length).toBeGreaterThanOrEqual(1);
  const freshResponse = queueResponses.at(-1)!;
  // The server may retain a safe session identity for its remaining words;
  // the contract is that the consumed word and nonce cannot remain usable.
  expect(freshResponse.studySession.nonces[activeWordId!]).toBeUndefined();
  expect(
    freshResponse.queue.some((item) => item.word.id === activeWordId),
  ).toBe(false);
});

test("a tab opened during another tab's commit discards its stale startup snapshot", async ({
  page,
}) => {
  const initialQueueResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialQueueResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const activeWordId = initialData.queue[0].word.id;
  const operationId = `late-tab-${randomUUID()}`;
  let releasePost!: () => void;
  let markPostStarted!: () => void;
  const postGate = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise<void>((resolve) => {
    markPostStarted = resolve;
  });
  await page.route("**/api/study", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operationId?: string;
    };
    if (body.operationId === operationId) {
      markPostStarted();
      await postGate;
    }
    await route.continue();
  });
  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: activeWordId,
      studySessionId: initialData.studySession.id,
      nonce: initialData.studySession.nonces[activeWordId],
    },
  );
  await postStarted;
  await page.evaluate((ownerId) => {
    window.localStorage.removeItem(
      `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
    );
  }, userId);

  const lateTab = await page.context().newPage();
  const lateTabQueueResponses: StudyWorkflowData[] = [];
  await lateTab.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      new URL(request.url()).pathname !== "/api/study"
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    lateTabQueueResponses.push(await response.json());
    await route.fulfill({ response });
  });
  try {
    const firstLateSnapshot = lateTab.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await lateTab.goto("/study");
    await firstLateSnapshot;
    await expect(lateTab.getByTestId("word-card-drag-layer")).toHaveCount(0);
  } finally {
    releasePost();
  }
  await expect.poll(() => lateTabQueueResponses.length).toBeGreaterThanOrEqual(2);
  await expect(lateTab.getByText(initialData.queue[0].word.term, { exact: true }))
    .toHaveCount(0);
  const freshSnapshot = lateTabQueueResponses.at(-1)!;
  expect(freshSnapshot.studySession.nonces[activeWordId]).toBeUndefined();
  expect(
    freshSnapshot.queue.some((item) => item.word.id === activeWordId),
  ).toBe(false);
  await lateTab.unrouteAll({ behavior: "ignoreErrors" });
  await lateTab.close();
});

test("an unrelated startup submission preserves a matching checkpoint", async ({
  page,
}) => {
  const initialQueueResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialQueueResponse).json()) as {
    queue: Array<{ word: { id: string } }>;
    studySession: { id: string };
  };
  expect(initialData.queue.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  const sessionResponse = await page.request.get("/api/auth/session");
  const userId = (await sessionResponse.json()).user?.id as string | undefined;
  expect(userId).toBeTruthy();
  const operationId = `unrelated-checkpoint-${randomUUID()}`;
  const unrelatedWordId = `unrelated-word-${randomUUID()}`;

  await page.evaluate(
    ({ ownerId, operation, wordId, queueIds, studySessionId }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId: `unrelated-session-${operation}`,
          nonce: `unrelated-nonce-${operation}`,
          credentialState: "valid",
        }),
      );
      window.localStorage.setItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        JSON.stringify({
          version: 5,
          ownerId,
          ts: Date.now(),
          phase: "assess",
          unitKey: "global",
          queueSignature: queueIds,
          studySessionId,
          currentIndex: 1,
          knownWordIds: [queueIds[0]],
          unknownWordIds: [],
          quizStats: { correct: 1, wrong: 0 },
          quizTargetId: null,
          quizWrongCount: 0,
          pendingQuizIds: [],
        }),
      );
    },
    {
      ownerId: userId!,
      operation: operationId,
      wordId: unrelatedWordId,
      queueIds: initialData.queue.map((item) => item.word.id),
      studySessionId: initialData.studySession.id,
    },
  );

  const queueRequests: string[] = [];
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      queueRequests.push(request.url());
      await route.continue();
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    if (body.operationId === operationId) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
      return;
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.getByText(/已恢復上次進度|已恢复上次进度/)).toBeVisible();
  await expect(page.getByText(/認識 1|认识 1/)).toBeVisible();
  await expect.poll(() => queueRequests.length).toBe(2);
  for (const requestUrl of queueRequests) {
    const resumeRequest = new URL(requestUrl);
    expect(resumeRequest.searchParams.get("resumeIds")).toBe(
      initialData.queue.map((item) => item.word.id).join(","),
    );
    expect(resumeRequest.searchParams.get("resumeSessionId")).toBe(
      initialData.studySession.id,
    );
  }
  const checkpoint = await page.evaluate((ownerId) => {
    const raw = window.localStorage.getItem(
      `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
    );
    return raw ? JSON.parse(raw) : null;
  }, userId!);
  expect(checkpoint?.currentIndex).toBe(1);
  expect(checkpoint?.knownWordIds).toEqual([initialData.queue[0].word.id]);
});

test("a later unrelated revision cannot hide an earlier active-word revision", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await installAssessCheckpoint(page, userId, data);
  await page.evaluate((ownerId) => {
    window.localStorage.setItem(
      `study:review-server-revision:${encodeURIComponent(ownerId)}`,
      JSON.stringify({
        version: 1,
        ownerId,
        wordIds: [],
        sessionIds: [],
        revision: "revision-before-startup",
      }),
    );
  }, userId);

  const queueRequests: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      new URL(request.url()).pathname !== "/api/study"
    ) {
      await route.continue();
      return;
    }
    queueRequests.push(request.url());
    if (queueRequests.length === 1) {
      markFirstStarted();
      await firstGate;
    }
    await route.continue();
  });

  const reload = page.reload();
  await firstStarted;
  await page.evaluate(
    ({ ownerId, activeWordId }) => {
      const key = `study:review-server-revision:${encodeURIComponent(ownerId)}`;
      window.localStorage.setItem(key, JSON.stringify({
        version: 1,
        ownerId,
        wordIds: [activeWordId],
        sessionIds: [],
        revision: "relevant-revision",
      }));
      window.localStorage.setItem(key, JSON.stringify({
        version: 1,
        ownerId,
        wordIds: [`unrelated-${Date.now()}`],
        sessionIds: [],
        revision: "later-unrelated-revision",
      }));
    },
    { ownerId: userId, activeWordId: data.queue[0].word.id },
  );
  releaseFirst();
  await reload;
  await expect.poll(() => queueRequests.length).toBe(2);
  for (const requestUrl of queueRequests) {
    expect(new URL(requestUrl).searchParams.get("resumeSessionId")).toBe(
      data.studySession.id,
    );
  }
  await expect(page.getByText(/已恢復上次進度|已恢复上次进度/)).toBeVisible();
  await expect(page.getByText(/認識 1|认识 1/)).toBeVisible();
});

test("an affected fresh queue resets stale quiz and classification state", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await installQuizCheckpoint(page, userId, initialData);

  const operationId = `reset-fresh-state-${randomUUID()}`;
  const freshResponses: StudyWorkflowData[] = [];
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/study") {
      await route.continue();
      return;
    }
    if (request.method() === "GET") {
      const response = await route.fetch();
      freshResponses.push(await response.json());
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: initialData.queue[0].word.id,
      studySessionId: initialData.studySession.id,
      nonce: initialData.studySession.nonces[initialData.queue[0].word.id],
    },
  );

  await expect.poll(() => freshResponses.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("study-quiz-phase")).toHaveCount(0);
  const card = page.getByTestId("word-card-drag-layer");
  await expect(card).toBeVisible();
  const freshData = freshResponses.at(-1)!;
  await expect(card.getByText(freshData.queue[0].word.term, { exact: true })).toBeVisible();
  const studyProgress = page.locator(".study-header-progress");
  await expect(studyProgress).toHaveAttribute("aria-valuenow", "1");
  await expect(studyProgress).toHaveAttribute("aria-valuetext", /第 1 个，共 \d+ 个|第 1 個，共 \d+ 個/);
  await expect(studyProgress.locator(".sr-only")).toHaveText(/已(認識|认识) 0 (個|个)，不(認識|认识) 0 (個|个)/);
  expect(
    freshData.queue.some(
      (item) => item.word.id === initialData.queue[0].word.id,
    ),
  ).toBe(false);
  await expect
    .poll(async () =>
      page.evaluate((ownerId) => {
        const raw = window.localStorage.getItem(
          `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        );
        if (!raw) return null;
        const checkpoint = JSON.parse(raw);
        return {
          currentIndex: checkpoint.currentIndex,
          phase: checkpoint.phase,
          knownWordIds: checkpoint.knownWordIds,
          unknownWordIds: checkpoint.unknownWordIds,
          pendingQuizIds: checkpoint.pendingQuizIds,
          quizTargetId: checkpoint.quizTargetId,
        };
      }, userId),
    )
    .toEqual({
      currentIndex: 0,
      phase: "assess",
      knownWordIds: [],
      unknownWordIds: [],
      pendingQuizIds: [],
      quizTargetId: null,
    });
});

test("a future-backoff active row preserves the in-memory quiz and checkpoint", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await installQuizCheckpoint(page, userId, initialData);
  let getCount = 0;
  let postCount = 0;
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/api/study") {
      if (request.method() === "GET") getCount++;
      if (request.method() === "POST") postCount++;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 1,
          status: "pending",
          nextAttemptAt: Date.now() + 60_000,
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: `future-backoff-${randomUUID()}`,
      wordId: initialData.queue[0].word.id,
      studySessionId: initialData.studySession.id,
      nonce: initialData.studySession.nonces[initialData.queue[0].word.id],
    },
  );

  await expect(page.getByText(/有 1 條學習記錄待同步|有 1 条学习记录待同步/)).toBeVisible();
  await expect(page.getByTestId("study-quiz-phase")).toHaveAttribute(
    "data-known-count",
    "1",
  );
  expect(getCount).toBe(0);
  expect(postCount).toBe(0);
  const checkpoint = await page.evaluate((ownerId) => {
    const raw = window.localStorage.getItem(
      `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
    );
    return raw ? JSON.parse(raw) : null;
  }, userId);
  expect(checkpoint?.currentIndex).toBe(1);
  expect(checkpoint?.phase).toBe("quiz");
  expect(checkpoint?.quizTargetId).toBe(initialData.queue[1].word.id);
  expect(checkpoint?.knownWordIds).toEqual([initialData.queue[0].word.id]);
  expect(checkpoint?.pendingQuizIds).toEqual([initialData.queue[0].word.id]);
});

test("a future-backoff row does not starve session rotation", async ({ page }) => {
  await page.clock.install();
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const operationId = `rotation-backoff-${randomUUID()}`;
  const retryAt = Date.now() + 60 * 60_000;
  const replacementSessionId = `rotation-e2e-${randomUUID()}`;
  await page.route("**/api/study/session/rotate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        studySession: {
          id: replacementSessionId,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          nonces: data.studySession.nonces,
        },
      }),
    });
  });
  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce, nextAttemptAt }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 1,
          status: "pending",
          nextAttemptAt,
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: data.queue[0].word.id,
      studySessionId: data.studySession.id,
      nonce: data.studySession.nonces[data.queue[0].word.id],
      nextAttemptAt: retryAt,
    },
  );
  const rotated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/study/session/rotate" &&
      response.ok(),
  );
  const rotationDelay = Math.max(
    0,
    Date.parse(data.studySession.expiresAt) - Date.now() - 5 * 60_000,
  );
  await page.clock.fastForward(rotationDelay + 1_000);
  await rotated;

  const row = await page.evaluate(
    ({ ownerId, operation }) => {
      const raw = window.localStorage.getItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
      );
      return raw ? JSON.parse(raw) : null;
    },
    { ownerId: userId, operation: operationId },
  );
  expect(row?.studySessionId).toBe(replacementSessionId);
  expect(row?.nextAttemptAt).toBe(retryAt);
});

for (const failureStatus of [429, 500]) {
  test(`a ${failureStatus} active flush failure preserves quiz progress`, async ({
    page,
  }) => {
    const initialResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await page.goto("/study");
    const initialData = (await (await initialResponse).json()) as StudyWorkflowData;
    const userId = await authenticatedUserId(page);
    await installQuizCheckpoint(page, userId, initialData);
    const operationId = `failed-${failureStatus}-${randomUUID()}`;
    let getCount = 0;
    let postCount = 0;
    await page.route("**/api/study*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname !== "/api/study") {
        await route.continue();
        return;
      }
      if (request.method() === "GET") {
        getCount++;
        await route.continue();
        return;
      }
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      if (body.operationId === operationId) {
        postCount++;
        await route.fulfill({
          status: failureStatus,
          headers: failureStatus === 429 ? { "Retry-After": "60" } : {},
          contentType: "application/json",
          body: JSON.stringify({ error: `simulated ${failureStatus}` }),
        });
        return;
      }
      await route.continue();
    });

    await page.evaluate(
      ({ ownerId, operation, wordId, studySessionId, nonce }) => {
        window.localStorage.setItem(
          `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
          JSON.stringify({
            ownerId,
            operationId: operation,
            wordId,
            quality: 5,
            ts: Date.now(),
            attempts: 0,
            status: "pending",
            studySessionId,
            nonce,
            credentialState: "valid",
          }),
        );
        window.dispatchEvent(new Event("online"));
      },
      {
        ownerId: userId,
        operation: operationId,
        wordId: initialData.queue[0].word.id,
        studySessionId: initialData.studySession.id,
        nonce: initialData.studySession.nonces[initialData.queue[0].word.id],
      },
    );

    await expect
      .poll(async () =>
        page.evaluate(
          ({ ownerId, operation }) => {
            const raw = window.localStorage.getItem(
              `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
            );
            return raw ? JSON.parse(raw).attempts : null;
          },
          { ownerId: userId, operation: operationId },
        ),
      )
      .toBe(1);
    await expect(page.getByTestId("study-quiz-phase")).toHaveAttribute(
      "data-known-count",
      "1",
    );
    expect(postCount).toBe(1);
    expect(getCount).toBe(0);
    const checkpoint = await page.evaluate((ownerId) => {
      const raw = window.localStorage.getItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
      );
      return raw ? JSON.parse(raw) : null;
    }, userId);
    expect(checkpoint?.currentIndex).toBe(1);
    expect(checkpoint?.phase).toBe("quiz");
    expect(checkpoint?.quizTargetId).toBe(initialData.queue[1].word.id);
  });
}

test("an active permanent failure remains guarded until queue revalidation", async ({
  page,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const data = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  const operationId = `blocked-active-${randomUUID()}`;
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/study" &&
      JSON.parse(request.postData() ?? "{}").operationId === operationId
    ) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "该学习题目已经提交" }),
      });
      return;
    }
    await route.continue();
  });
  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
      window.dispatchEvent(new Event("online"));
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: data.queue[0].word.id,
      studySessionId: data.studySession.id,
      nonce: data.studySession.nonces[data.queue[0].word.id],
    },
  );

  await expect(page.getByText(/無法自動恢復|无法自动恢复/)).toBeVisible();
  await expect(page.getByTestId("word-card-drag-layer")).toHaveCount(0);
  const row = await page.evaluate(
    ({ ownerId, operation }) => {
      const raw = window.localStorage.getItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
      );
      return raw ? JSON.parse(raw) : null;
    },
    { ownerId: userId, operation: operationId },
  );
  expect(row?.status).toBe("blocked");
});

test("a successful submission in another tab invalidates the shared active session", async ({
  page,
  context,
}) => {
  const initialResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const initialData = (await (await initialResponse).json()) as StudyWorkflowData;
  const userId = await authenticatedUserId(page);
  await page.evaluate(
    ({ ownerId, queueIds, studySessionId }) => {
      window.localStorage.setItem(
        `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
        JSON.stringify({
          version: 5,
          ownerId,
          ts: Date.now(),
          phase: "assess",
          unitKey: "global",
          queueSignature: queueIds,
          studySessionId,
          currentIndex: 0,
          knownWordIds: [],
          unknownWordIds: [],
          quizStats: { correct: 0, wrong: 0 },
          quizTargetId: null,
          quizWrongCount: 0,
          pendingQuizIds: [],
        }),
      );
    },
    {
      ownerId: userId,
      queueIds: initialData.queue.map((item) => item.word.id),
      studySessionId: initialData.studySession.id,
    },
  );

  const otherPage = await context.newPage();
  const otherInitialResponse = otherPage.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await otherPage.goto("/study");
  const otherInitialData = (await (await otherInitialResponse).json()) as StudyWorkflowData;
  expect(otherInitialData.studySession.id).toBe(initialData.studySession.id);
  expect(otherInitialData.queue.map((item) => item.word.id)).toEqual(
    initialData.queue.map((item) => item.word.id),
  );
  await expect(otherPage.getByTestId("word-card-drag-layer")).toBeVisible();

  const operationId = `cross-tab-${randomUUID()}`;
  let releasePost!: () => void;
  let markPostStarted!: () => void;
  const blockedPost = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const postStarted = new Promise<void>((resolve) => {
    markPostStarted = resolve;
  });
  await page.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      new URL(request.url()).pathname === "/api/study" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      if (body.operationId === operationId) {
        markPostStarted();
        await blockedPost;
      }
    }
    await route.continue();
  });
  const otherFreshResponses: StudyWorkflowData[] = [];
  await otherPage.route("**/api/study*", async (route) => {
    const request = route.request();
    if (
      new URL(request.url()).pathname === "/api/study" &&
      request.method() === "GET"
    ) {
      const response = await route.fetch();
      otherFreshResponses.push(await response.json());
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  // Start a gesture before the shared outbox row arrives. Dynamic disabled
  // must release capture, cancel the drag generation and centre the card.
  const otherCard = otherPage.getByTestId("word-card-drag-layer");
  const otherCardBox = await otherCard.boundingBox();
  if (!otherCardBox) throw new Error("Other tab card bounding box is unavailable");
  const dragStartX = otherCardBox.x + otherCardBox.width * 0.4;
  const dragY = otherCardBox.y + otherCardBox.height * 0.4;
  await otherPage.mouse.move(dragStartX, dragY);
  await otherPage.mouse.down();
  await otherPage.mouse.move(dragStartX + 90, dragY);
  await expect
    .poll(() => otherCard.evaluate((element) => element.style.transform))
    .not.toContain("translate3d(0px");

  await page.evaluate(
    ({ ownerId, operation, wordId, studySessionId, nonce }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 5,
          ts: Date.now(),
          attempts: 0,
          status: "pending",
          studySessionId,
          nonce,
          credentialState: "valid",
        }),
      );
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: initialData.queue[0].word.id,
      studySessionId: initialData.studySession.id,
      nonce: initialData.studySession.nonces[initialData.queue[0].word.id],
    },
  );
  const otherKnownButton = otherPage.getByRole("button", {
    name: /我會|我会/,
  });
  await expect(otherKnownButton).toBeDisabled();
  await expect
    .poll(() => otherCard.evaluate((element) => element.style.transform))
    .toContain("translate3d(0px");
  await otherPage.mouse.up();
  await expect(otherPage.getByTestId("study-quiz-phase")).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await postStarted;
  try {
    await expect
      .poll(() =>
        otherKnownButton.evaluateAll(
          (buttons) =>
            buttons.length === 0 ||
            buttons.every((button) => (button as HTMLButtonElement).disabled),
        ),
      )
      .toBe(true);
  } finally {
    releasePost();
  }

  await expect.poll(() => otherFreshResponses.length).toBeGreaterThanOrEqual(1);
  await expect(otherPage.getByTestId("word-card-drag-layer")).toBeVisible();
  const otherFreshData = otherFreshResponses.at(-1)!;
  expect(
    otherFreshData.queue.some(
      (item) => item.word.id === initialData.queue[0].word.id,
    ),
  ).toBe(false);
  expect(
    otherFreshData.studySession.nonces[initialData.queue[0].word.id],
  ).toBeUndefined();
  await otherPage.close();
});

test("independent browser contexts reconcile a nonce consumed on another device", async ({
  page,
  context,
  browser,
}) => {
  const firstResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/study" &&
      response.ok(),
  );
  await page.goto("/study");
  const firstData = (await (await firstResponse).json()) as StudyWorkflowData;
  const wordId = firstData.queue[0]?.word.id;
  expect(wordId).toBeTruthy();

  const independentContext = await browser.newContext({
    storageState: await context.storageState(),
  });
  const independentPage = await independentContext.newPage();
  try {
    await independentPage.goto("/");
    const independentUserId = await authenticatedUserId(independentPage);
    await independentPage.evaluate(
      ({ ownerId, queueIds, studySessionId }) => {
        window.localStorage.setItem(
          `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
          JSON.stringify({
            version: 5,
            ownerId,
            ts: Date.now(),
            phase: "assess",
            unitKey: "global",
            queueSignature: queueIds,
            studySessionId,
            currentIndex: 0,
            knownWordIds: [],
            unknownWordIds: [],
            quizStats: { correct: 0, wrong: 0 },
            quizTargetId: null,
            quizWrongCount: 0,
            pendingQuizIds: [],
          }),
        );
      },
      {
        ownerId: independentUserId,
        queueIds: firstData.queue.map((item) => item.word.id),
        studySessionId: firstData.studySession.id,
      },
    );
    const secondResponse = independentPage.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await independentPage.goto("/study");
    const secondData = (await (await secondResponse).json()) as StudyWorkflowData;
    expect(secondData.studySession.id).toBe(firstData.studySession.id);
    expect(secondData.queue.map((item) => item.word.id)).toEqual(
      firstData.queue.map((item) => item.word.id),
    );
    expect(secondData.studySession.nonces[wordId!]).toBe(
      firstData.studySession.nonces[wordId!],
    );

    const firstOperationId = `device-a-${randomUUID()}`;
    const firstSubmit = await page.request.post("/api/study", {
      headers: await sameOriginMutationHeaders(page),
      data: {
        wordId,
        quality: 5,
        operationId: firstOperationId,
        studySessionId: firstData.studySession.id,
        nonce: firstData.studySession.nonces[wordId!],
      },
    });
    expect(firstSubmit.ok()).toBe(true);

    const freshResponse = independentPage.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    const conflictResponse = independentPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.status() === 409,
    );
    await independentPage.getByRole("button", {
      name: /我會|我会/,
    }).click();
    await expect(independentPage.getByTestId("study-quiz-phase")).toBeVisible();
    await independentPage.locator(`[data-option-id="${wordId}"]`).click();
    const conflictPayload = (await (await conflictResponse).json()) as {
      code?: string;
      requiresQueueReload?: boolean;
    };
    expect(conflictPayload).toMatchObject({
      code: "REVIEW_ALREADY_PROCESSED",
      requiresQueueReload: true,
    });

    const freshData = (await (await freshResponse).json()) as StudyWorkflowData;
    expect(freshData.queue.some((item) => item.word.id === wordId)).toBe(false);
    await expect
      .poll(() =>
        independentPage.evaluate(
          ({ ownerId, targetWordId }) => ({
            wordRows: Object.keys(window.localStorage)
              .filter((key) =>
                key.startsWith(`study:review-item:${encodeURIComponent(ownerId)}:`),
              )
              .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"))
              .filter((row) => row.wordId === targetWordId).length,
            blocked: Object.keys(window.localStorage)
              .filter((key) =>
                key.startsWith(`study:review-item:${encodeURIComponent(ownerId)}:`),
              )
              .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"))
              .filter((row) => row.status === "blocked").length,
          }),
          { ownerId: independentUserId, targetWordId: wordId! },
        ),
      )
      .toEqual({ wordRows: 0, blocked: 0 });
  } finally {
    await independentContext.close();
  }
});
