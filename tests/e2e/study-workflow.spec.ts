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
  await page.getByRole("button", { name: /認識.*✓|认识.*✓/ }).click();
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
  await page.getByRole("button", { name: /不認識|不认识/ }).click();
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
  await expect.poll(() => queueRequests.length).toBe(1);
  const resumeRequest = new URL(queueRequests[0]);
  expect(resumeRequest.searchParams.get("resumeIds")).toBe(
    initialData.queue.map((item) => item.word.id).join(","),
  );
  expect(resumeRequest.searchParams.get("resumeSessionId")).toBe(
    initialData.studySession.id,
  );
  const checkpoint = await page.evaluate((ownerId) => {
    const raw = window.localStorage.getItem(
      `study:checkpoint:${encodeURIComponent(ownerId)}:global`,
    );
    return raw ? JSON.parse(raw) : null;
  }, userId!);
  expect(checkpoint?.currentIndex).toBe(1);
  expect(checkpoint?.knownWordIds).toEqual([initialData.queue[0].word.id]);
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
  await expect(page.getByText(/^(認識|认识) 0$/)).toBeVisible();
  await expect(page.getByText(/^(不認識|不认识) 0$/)).toBeVisible();
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
    name: /認識.*✓|认识.*✓/,
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
      .poll(async () =>
        (await otherKnownButton.count()) === 0 || otherKnownButton.isDisabled(),
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
    const secondResponse = independentPage.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await independentPage.goto("/study");
    const secondData = (await (await secondResponse).json()) as StudyWorkflowData;
    const independentUserId = await authenticatedUserId(independentPage);
    expect(secondData.queue.some((item) => item.word.id === wordId)).toBe(true);

    const firstOperationId = `device-a-${randomUUID()}`;
    const firstSubmit = await page.request.post("/api/study", {
      data: {
        wordId,
        quality: 5,
        operationId: firstOperationId,
        studySessionId: firstData.studySession.id,
        nonce: firstData.studySession.nonces[wordId!],
      },
    });
    expect(firstSubmit.ok()).toBe(true);

    const secondOperationId = `device-b-${randomUUID()}`;
    const freshResponse = independentPage.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/study" &&
        response.ok(),
    );
    await independentPage.evaluate(
      ({ ownerId, operationId, targetWordId, studySessionId, nonce }) => {
        window.localStorage.setItem(
          `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operationId)}`,
          JSON.stringify({
            ownerId,
            operationId,
            wordId: targetWordId,
            quality: 4,
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
        ownerId: independentUserId,
        operationId: secondOperationId,
        targetWordId: wordId!,
        // This independent context represents a device that loaded the same
        // server-issued credential before device A consumed it. Its current
        // UI may already have refreshed to a newer session; the durable row
        // deliberately retains the stale shared credential being reconciled.
        studySessionId: firstData.studySession.id,
        nonce: firstData.studySession.nonces[wordId!],
      },
    );

    const freshData = (await (await freshResponse).json()) as StudyWorkflowData;
    expect(freshData.queue.some((item) => item.word.id === wordId)).toBe(false);
    await expect
      .poll(() =>
        independentPage.evaluate(
          ({ ownerId, operationId }) => ({
            row: window.localStorage.getItem(
              `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operationId)}`,
            ),
            blocked: Object.keys(window.localStorage)
              .filter((key) =>
                key.startsWith(`study:review-item:${encodeURIComponent(ownerId)}:`),
              )
              .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"))
              .filter((row) => row.status === "blocked").length,
          }),
          { ownerId: independentUserId, operationId: secondOperationId },
        ),
      )
      .toEqual({ row: null, blocked: 0 });
  } finally {
    await independentContext.close();
  }
});
