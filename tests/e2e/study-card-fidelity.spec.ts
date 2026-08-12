import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

test.describe.configure({ timeout: 90_000 });

interface StudyResponse {
  queue: Array<{ word: { id: string; term: string; level: string; category: string | null } }>;
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
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(300);
  return data;
}

test("study card renders real level/category data and prototype structure", async ({ page }) => {
  const data = await openStudy(page);
  expect(data.queue.length).toBeGreaterThan(0);

  await expect(page.getByTestId("study-assess-title")).toHaveText(/今日學習|今日学习/);
  await expect(page.getByTestId("word-card-stack")).toBeVisible();
  await expect(page.getByTestId("word-card-context")).toHaveText(/認讀卡|认读卡/);
  await expect(page.getByTestId("word-card-level")).toContainText(data.queue[0].word.level);
  if (data.queue[0].word.category) {
    await expect(page.getByTestId("word-card-level")).toContainText(data.queue[0].word.category);
  } else {
    await expect(page.getByTestId("word-card-level")).toContainText(/未分類|未分类/);
  }
  await expect(page.getByTestId("word-card-drag-layer")).toContainText(data.queue[0].word.term);
  await expect(page.getByTestId("word-card-queue-note")).toContainText(/今日隊列第|今日队列第/);

  const back = page.getByTestId("word-card-back");
  await expect(back).toHaveAttribute("aria-hidden", "true");
  expect(await back.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  expect(await back.evaluate((element) => getComputedStyle(element).zIndex)).toBe("1");
  const geometry = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("[data-testid=word-card-drag-layer]");
    const back = document.querySelector<HTMLElement>("[data-testid=word-card-back]");
    if (!card || !back) throw new Error("card geometry elements are missing");
    const cardRect = card.getBoundingClientRect();
    const backRect = back.getBoundingClientRect();
    return { cardWidth: cardRect.width, cardHeight: cardRect.height, backWidth: backRect.width, backHeight: backRect.height };
  });
  expect(geometry.cardWidth).toBeGreaterThan(0);
  expect(geometry.cardHeight).toBeGreaterThanOrEqual(geometry.backHeight - 24);
  expect(geometry.backWidth).toBeGreaterThan(geometry.cardWidth - 40);
});

test("study card remains accessible in dark, reduced-motion, and forced-colors states", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await openStudy(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("word-card-back")).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.getByTestId("word-card-back")).toBeVisible();
  expect(await page.getByTestId("word-card-back").evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  expect(await page.getByTestId("word-card-level").evaluate((element) => getComputedStyle(element).borderStyle)).toBe("solid");
});

test("captures study card reference sizes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop project owns the shared reference captures");
  const captures = [
    { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
    { name: "tablet-820x1180", viewport: { width: 820, height: 1180 } },
    { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  ] as const;
  await openStudy(page);

  for (const capture of captures) {
    await page.setViewportSize(capture.viewport);
    await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
    await page.screenshot({
      path: `output/playwright/phase5/learn-card-${capture.name}.png`,
      fullPage: true,
    });
  }
});

test("study card assess surface has no axe WCAG 2A/2AA violations", async ({ page }) => {
  await openStudy(page);
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const axeApi = (window as Window & {
      axe?: { run: (context: Document, options: { runOnly: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> };
    }).axe;
    if (!axeApi) throw new Error("axe failed to load");
    const result = await axeApi.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
    return result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map((node) => node.target) }));
  });
  expect(violations).toEqual([]);
});
