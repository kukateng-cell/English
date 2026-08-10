import { expect, test } from "@playwright/test";

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

test("study queue loads while an outbox submission is still pending", async ({
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

  await page.reload();
  await postStarted;
  try {
    await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  } finally {
    releasePost();
  }
});
