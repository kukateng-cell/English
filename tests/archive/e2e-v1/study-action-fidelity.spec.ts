import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

interface StudyResponse {
  queue: Array<{ word: { id: string } }>;
}

async function openStudy(page: Page): Promise<StudyResponse> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/study" &&
      candidate.ok(),
  );
  await page.goto("/study");
  const data = (await (await response).json()) as StudyResponse;
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect(page.getByTestId("study-card-actions")).toBeVisible();
  return data;
}

test("actions are outside the draggable card and match the Prototype geometry", async ({ page }, testInfo) => {
  await openStudy(page);

  const dragLayer = page.getByTestId("word-card-drag-layer");
  const left = page.getByTestId("study-card-action-left");
  const right = page.getByTestId("study-card-action-right");
  await page.waitForTimeout(350);
  await expect(left).toHaveText(/還不會|还不会/);
  await expect(right).toHaveText(/我會|我会/);
  await expect(page.getByTestId("study-swipe-guide")).toContainText(/向左滑|向左滑/);
  await expect(dragLayer).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
  await expect(dragLayer.locator('[data-testid^="study-card-action-"]')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-testid="study-card-actions"]');
    const leftButton = document.querySelector<HTMLElement>('[data-testid="study-card-action-left"]');
    const rightButton = document.querySelector<HTMLElement>('[data-testid="study-card-action-right"]');
    const card = document.querySelector<HTMLElement>('[data-testid="word-card-drag-layer"]');
    if (!region || !leftButton || !rightButton || !card) throw new Error("action geometry is unavailable");
    const regionRect = region.getBoundingClientRect();
    const leftRect = leftButton.getBoundingClientRect();
    const rightRect = rightButton.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>(".student-nav-bottom");
    const navRect = nav?.getBoundingClientRect() ?? null;
    const overlapsNav = navRect
      ? leftRect.bottom > navRect.top && leftRect.top < navRect.bottom || rightRect.bottom > navRect.top && rightRect.top < navRect.bottom
      : false;
    return {
      regionRect: { top: regionRect.top, bottom: regionRect.bottom, width: regionRect.width },
      leftRect: { top: leftRect.top, bottom: leftRect.bottom, width: leftRect.width, height: leftRect.height },
      rightRect: { top: rightRect.top, bottom: rightRect.bottom, width: rightRect.width, height: rightRect.height },
      cardBottom: cardRect.bottom,
      actionRegionContainsCard: region.contains(card),
      overlapsNav,
    };
  });
  expect(geometry.leftRect.height).toBeGreaterThanOrEqual(60);
  expect(geometry.rightRect.height).toBeGreaterThanOrEqual(60);
  expect(Math.abs(geometry.leftRect.width - geometry.rightRect.width)).toBeLessThanOrEqual(1);
  expect(geometry.regionRect.top).toBeGreaterThanOrEqual(geometry.cardBottom - 1);
  expect(geometry.actionRegionContainsCard).toBe(false);
  expect(geometry.overlapsNav).toBe(false);
  await left.focus();
  await expect(left).toBeFocused();

  if (testInfo.project.name.includes("mobile")) {
    expect(geometry.leftRect.width).toBeGreaterThanOrEqual(44);
    expect(geometry.rightRect.width).toBeGreaterThanOrEqual(44);
  }
});

test("ArrowLeft and ArrowRight use the same action pipeline as the buttons", async ({ page }) => {
  await openStudy(page);
  const card = page.getByTestId("word-card-drag-layer");
  await card.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("help-panel-dismiss").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await page.getByTestId("word-card-drag-layer").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
});

test("external action buttons preserve the left help-panel and right quiz flows", async ({ page }) => {
  await openStudy(page);
  await page.getByTestId("study-card-action-left").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("help-panel-dismiss")).toBeVisible();

  await page.getByTestId("help-panel-dismiss").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("study-card-action-right")).toBeVisible();
  await page.getByTestId("study-card-action-right").click();
  await expect(page.getByTestId("study-quiz-phase")).toBeVisible();
});
