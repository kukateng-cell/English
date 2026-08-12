import { expect, test, type Page } from "@playwright/test";

interface StudyWorkflowData {
  queue: Array<{ word: { id: string } }>;
  studySession: { id: string };
}

test.describe.configure({ timeout: 90_000 });

async function openStudy(page: Page): Promise<StudyWorkflowData> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/study" &&
      candidate.ok(),
  );
  await page.goto("/study");
  return (await (await response).json()) as StudyWorkflowData;
}

async function authenticatedUserId(page: Page): Promise<string> {
  const response = await page.request.get("/api/auth/session");
  const userId = (await response.json()).user?.id as string | undefined;
  expect(userId).toBeTruthy();
  return userId!;
}

function navigationLink(page: Page, href: string, mobile: boolean) {
  return page.locator(
    `${mobile ? ".student-nav-bottom" : ".student-nav-rail"} a[href="${href}"]`,
  );
}

test("study keeps a real active navigation in every shell mode", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  await page.goto("/");
  await openStudy(page);

  await expect(page.locator(".student-shell")).toHaveClass(/is-study/);
  await expect(page.locator(".student-nav")).toHaveCount(2);
  if (mobile) {
    await expect(page.locator(".student-nav-bottom")).toBeVisible();
    await expect(page.locator(".student-nav-rail")).toBeHidden();
  } else {
    await expect(page.locator(".student-nav-rail")).toBeVisible();
    await expect(page.locator(".student-nav-bottom")).toBeHidden();
  }
  await expect(navigationLink(page, "/study", mobile)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".student-shell")).toHaveAttribute(
    "data-study-navigation-phase",
    /assess|done|error|locked|loading/,
  );
  await page.screenshot({
    path: `output/playwright/phase2/study-nav-${mobile ? "mobile-390x844" : "desktop-1440x900"}.png`,
  });

  await navigationLink(page, "/words", mobile).click();
  await expect(page).toHaveURL(/\/words$/);
  await expect(page.getByRole("heading", { name: /词表|詞表/ })).toBeVisible();
});

test("quiz navigation is visible but uses the same guarded exit path", async ({ page }) => {
  await page.goto("/");
  const data = await openStudy(page);
  const userId = await authenticatedUserId(page);
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
          quizStats: { correct: 1, wrong: 0 },
          quizTargetId: queueIds[1],
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
  await page.reload();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
  await expect(page.locator(".student-shell")).toHaveAttribute(
    "data-study-navigation-phase",
    "quiz",
  );
  await expect(page.locator(".student-shell")).toHaveAttribute(
    "data-study-navigation-blocked",
    "true",
  );

  const visibleWordsLink = page.locator(".student-nav a[href=\"/words\"]:visible");
  await expect(visibleWordsLink).toHaveAttribute("aria-disabled", "true");
  await visibleWordsLink.evaluate((element) => {
    (element as HTMLAnchorElement).click();
  });
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByTestId("study-navigation-notice")).toContainText(
    /當前測試尚未完成|当前测试尚未完成/,
  );

  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByTestId("study-navigation-notice")).toContainText(
    /當前測試尚未完成|当前测试尚未完成/,
  );
});

test("pending sync keeps navigation visible while blocking direct exit", async ({ page }) => {
  const data = await openStudy(page);
  const userId = await authenticatedUserId(page);
  const operationId = `navigation-pending-${Date.now()}`;
  await page.evaluate(
    ({ ownerId, operation, wordId, sessionId }) => {
      window.localStorage.setItem(
        `study:review-item:${encodeURIComponent(ownerId)}:${encodeURIComponent(operation)}`,
        JSON.stringify({
          ownerId,
          operationId: operation,
          wordId,
          quality: 2,
          ts: Date.now(),
          attempts: 1,
          status: "pending",
          nextAttemptAt: Date.now() + 10 * 60_000,
          studySessionId: sessionId,
          nonce: "reserved-for-navigation-test",
          credentialState: "valid",
        }),
      );
    },
    {
      ownerId: userId,
      operation: operationId,
      wordId: data.queue[0].word.id,
      sessionId: data.studySession.id,
    },
  );
  await page.reload();

  await expect(page.locator(".student-shell")).toHaveAttribute(
    "data-study-navigation-blocked",
    "true",
  );
  const visibleWordsLink = page.locator(".student-nav a[href=\"/words\"]:visible");
  await expect(visibleWordsLink).toHaveAttribute("aria-disabled", "true");
  await visibleWordsLink.evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.getByTestId("study-navigation-notice")).toContainText(
    /待同步記錄|待同步记录/,
  );
});

test("done state keeps the student destinations real and available", async ({ page }) => {
  await page.route("**/api/study*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue: [],
        pool: [],
        unitMode: false,
        category: null,
        streak: null,
        resumedSession: false,
        studySession: null,
      }),
    });
  });
  await page.goto("/study");
  await expect(page.getByRole("heading", { name: /全部完成|全部完成/ })).toBeVisible();
  await expect(page.locator(".student-shell")).toHaveAttribute(
    "data-study-navigation-phase",
    "done",
  );
  await expect(page.locator(".student-shell")).not.toHaveAttribute(
    "data-study-navigation-blocked",
  );
  await expect(page.locator(".student-nav a[href=\"/words\"]:visible")).toBeVisible();
});

test("Coach dialog makes both navigation surfaces inert and restores them on close", async ({ page }) => {
  await openStudy(page);
  await page.getByRole("button", { name: /不认识|不認識/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".student-rail")).toHaveAttribute("inert", "");
  await expect(page.locator("[data-testid=student-nav-bottom-layer]")).toHaveAttribute("inert", "");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);

  await page.getByTestId("help-panel-dismiss").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".student-rail")).not.toHaveAttribute("inert");
  await expect(page.locator("[data-testid=student-nav-bottom-layer]")).not.toHaveAttribute("inert");
});

test("mobile study navigation stays inside the visual viewport and leaves action space", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile geometry assertion");
  await openStudy(page);

  const geometry = await page.locator(".student-nav-bottom").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const links = [...element.querySelectorAll("a")].map((link) => {
      const linkBox = link.getBoundingClientRect();
      return { width: linkBox.width, height: linkBox.height };
    });
    const main = document.querySelector(".student-main");
    return {
      viewportHeight: window.innerHeight,
      y: box.y,
      bottom: box.bottom,
      height: box.height,
      links,
      paddingBottom: main ? getComputedStyle(main).paddingBottom : "0px",
    };
  });

  expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.height).toBeGreaterThanOrEqual(58);
  expect(geometry.links).toHaveLength(4);
  for (const link of geometry.links) {
    expect(link.width).toBeGreaterThanOrEqual(44);
    expect(link.height).toBeGreaterThanOrEqual(44);
  }
  expect(Number.parseFloat(geometry.paddingBottom)).toBeGreaterThanOrEqual(96);
});

test("mobile navigation survives orientation, visual-viewport resize, and scroll", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile viewport assertion");
  await openStudy(page);

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 390, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".student-nav-bottom")).toBeVisible();
    const geometry = await page.locator(".student-nav-bottom").evaluate((element) => {
      const box = element.getBoundingClientRect();
      const visualViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      return { top: box.top, bottom: box.bottom, visualViewportHeight };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visualViewportHeight + 1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".student-nav-bottom")).toBeVisible();
  }
});
