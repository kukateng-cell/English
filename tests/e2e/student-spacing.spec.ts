import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

test.describe.configure({ timeout: 120_000 });

const routes = [
  { path: "/", heading: /今天继续学习|今天繼續學習/, ready: ".next-session-card" },
  { path: "/words", heading: /词表|詞表/, ready: ".word-list-card" },
  { path: "/stats", heading: /学习统计|學習統計/, ready: ".stats-range-row" },
] as const;

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

interface StackMetrics {
  pageGap: number;
  sectionGap: number;
  pageChildGaps: number[];
  sectionChildGaps: number[];
  viewportWidth: number;
  documentWidth: number;
}

async function readStackMetrics(page: Page): Promise<StackMetrics> {
  return page.locator(".student-page-stack").evaluate((pageStack) => {
    const visibleChildren = (element: Element) =>
      Array.from(element.children).filter((child) => {
        const style = getComputedStyle(child);
        const rect = child.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const gaps = (children: Element[]) =>
      children.slice(1).map((child, index) => {
        const previous = children[index].getBoundingClientRect();
        return Math.round((child.getBoundingClientRect().top - previous.bottom) * 100) / 100;
      });
    const section = pageStack.querySelector<HTMLElement>(".student-section-stack");
    if (!section) throw new Error("student-section-stack is missing");

    const pageChildren = visibleChildren(pageStack);
    const sectionChildren = visibleChildren(section);
    return {
      pageGap: Number.parseFloat(getComputedStyle(pageStack).rowGap),
      sectionGap: Number.parseFloat(getComputedStyle(section).rowGap),
      pageChildGaps: gaps(pageChildren),
      sectionChildGaps: gaps(sectionChildren),
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

test("student page stacks keep the approved rhythm across routes and viewports", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const expectedPageGap = viewport.width < 980 ? 24 : 32;

    for (const route of routes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await expect(page.locator(route.ready)).toBeVisible();
      await expect(page.locator(".student-page-stack")).toBeVisible();
      await expect(page.locator(".student-section-stack")).toBeVisible();

      const metrics = await readStackMetrics(page);
      expect(metrics.pageGap, `${route.path} ${viewport.width}px page gap`).toBeCloseTo(expectedPageGap, 1);
      expect(metrics.sectionGap, `${route.path} ${viewport.width}px section gap`).toBeCloseTo(24, 1);
      for (const gap of metrics.pageChildGaps) {
        expect(gap, `${route.path} ${viewport.width}px page child gap`).toBeCloseTo(expectedPageGap, 1);
      }
      for (const gap of metrics.sectionChildGaps) {
        expect(gap, `${route.path} ${viewport.width}px section child gap`).toBeCloseTo(24, 1);
      }
      expect(metrics.documentWidth, `${route.path} ${viewport.width}px horizontal overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    }
  }
});

test("dashboard spacing references are captured at mobile, tablet, and desktop sizes", async ({ page }) => {
  const captures = [
    { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
    { name: "tablet-820x1180", viewport: { width: 820, height: 1180 } },
    { name: "desktop-1440x900", viewport: { width: 1440, height: 900 } },
  ] as const;

  for (const capture of captures) {
    await page.setViewportSize(capture.viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /今天继续学习|今天繼續學習/ })).toBeVisible();
    await expect(page.locator(".next-session-card")).toBeVisible();
    await page.screenshot({
      path: `output/playwright/phase3/home-spacing-${capture.name}.png`,
      fullPage: true,
    });
  }
});

test("student surfaces reflow without clipping under WCAG text-spacing overrides", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });

  for (const route of routes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expect(page.locator(route.ready)).toBeVisible();
    await page.addStyleTag({
      content: `
        body, body * {
          letter-spacing: 0.12em !important;
          line-height: 1.5 !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }
      `,
    });

    const result = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const visibleTextNodes = Array.from(document.querySelectorAll("h1,h2,h3,p,a,button,label"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, text: element.textContent?.trim().slice(0, 40), right: rect.right, left: rect.left };
        })
        .filter(({ right, left }) => right > viewportWidth + 1 || left < -1);
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        visibleTextNodes,
      };
    });

    expect(result.documentWidth, `${route.path} document width under text spacing`).toBeLessThanOrEqual(result.viewportWidth + 1);
    expect(result.visibleTextNodes, `${route.path} visible text outside viewport`).toEqual([]);
  }
});

test("student surfaces have no axe WCAG 2A/2AA violations", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expect(page.locator(route.ready)).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const axeApi = (window as Window & {
        axe?: { run: (context: Document, options: { runOnly: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
      }).axe;
      if (!axeApi) throw new Error("axe failed to load");
      const result = await axeApi.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return result.violations.map(({ id, impact }) => ({ id, impact }));
    });
    expect(violations, `${route.path} axe violations`).toEqual([]);
  }
});
