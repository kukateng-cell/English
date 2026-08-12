import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

test("first visit and brand use the approved Traditional Chinese contract", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page).toHaveTitle("英語單詞認讀 · 中學生學習平臺");
  await expect(page.locator(".brand-mark")).toHaveText("見");
  await expect(page.locator(".brand-name")).toHaveText("見字會");
  await expect(page.locator(".brand-lockup")).toHaveAttribute(
    "aria-label",
    "見字會 SeeWord",
  );
});

test("cookie is the deterministic SSR locale source and switching updates both stores", async ({
  page,
  context,
}) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("locale", "zh-Hans"));
  await context.addCookies([
    { name: "locale", value: "zh-Hant", url: "http://127.0.0.1:3100/" },
  ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page).toHaveTitle("英語單詞認讀 · 中學生學習平臺");
  await expect.poll(() => page.evaluate(() => ({
    storage: localStorage.getItem("locale"),
    cookie: document.cookie.match(/(?:^|; )locale=([^;]+)/)?.[1] ?? null,
  }))).toEqual({ storage: "zh-Hant", cookie: "zh-Hant" });

  await page.locator('.auth-locale-control button[aria-pressed="false"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page).toHaveTitle("英语单词认读 · 中学生学习平台");
  await expect(page.locator("h1")).toHaveText("英语单词认读");
  await expect.poll(() => page.evaluate(() => ({
    storage: localStorage.getItem("locale"),
    cookie: document.cookie.match(/(?:^|; )locale=([^;]+)/)?.[1] ?? null,
  }))).toEqual({ storage: "zh-Hans", cookie: "zh-Hans" });
  await expect(page.locator(".brand-mark")).toHaveText("見");
  await expect(page.locator(".brand-name")).toHaveText("見字會");
});

test("captures the locale and theme foundation fixture", async ({ browser }) => {
  const cases = [
    ["zh-Hant", "light"],
    ["zh-Hant", "dark"],
    ["zh-Hans", "light"],
    ["zh-Hans", "dark"],
  ] as const;

  for (const [locale, theme] of cases) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
    });
    await context.addCookies([
      { name: "locale", value: locale, url: "http://127.0.0.1:3100/" },
    ]);
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.evaluate((nextTheme) => {
      localStorage.setItem("theme", nextTheme);
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator(".auth-locale-control")).toBeVisible();
    await expect.poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark"))).toBe(theme === "dark");
    await page.screenshot({
      path: `output/playwright/phase1/login-${locale}-${theme}-390x844.png`,
      fullPage: true,
    });
    await context.close();
  }
});
