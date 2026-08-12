import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 30_000 });

async function openFixture(page: Page) {
  await page.goto("/test/word-card-fidelity");
  await expect(page.getByTestId("word-card-fidelity-fixture")).toBeVisible();
}

test("stress fixtures remain readable and reflow without horizontal overflow", async ({ page }) => {
  await openFixture(page);

  const stress = page.getByTestId("word-card-fixture-stress");
  await expect(stress.getByTestId("word-card-level")).toContainText(/B2.*未分類|B2.*未分类/);
  await expect(stress.getByTestId("word-card-drag-layer")).toContainText("characteristically");
  await expect(stress.getByTestId("word-card-phonetic")).toHaveCount(0);

  const localized = page.getByTestId("word-card-fixture-localized");
  await expect(localized.getByTestId("word-card-level")).toContainText(/A2/);
  await expect(localized.getByTestId("word-card-drag-layer")).toContainText("internationalization");

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p { margin-bottom: 2em !important; }
    `,
  });
  await expect(page.getByTestId("word-card-fidelity-fixture")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("localized category follows the Traditional and Simplified locale contract", async ({ page, context }) => {
  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    await context.clearCookies();
    await context.addCookies([
      { name: "locale", value: locale, domain: "127.0.0.1", path: "/" },
    ]);
    await page.goto("/test/word-card-fidelity");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const category = page
      .getByTestId("word-card-fixture-localized")
      .getByTestId("word-card-level");
    await expect(category).toContainText(locale === "zh-Hant" ? "校園" : "校园");
    await expect(category).toContainText(locale === "zh-Hant" ? "學習" : "学习");
  }
});
