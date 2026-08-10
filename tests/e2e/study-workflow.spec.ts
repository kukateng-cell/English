import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

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
