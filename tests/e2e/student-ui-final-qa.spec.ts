import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

const viewports = [
  { name: "mobile-320x568", width: 320, height: 568 },
  { name: "mobile-360x800", width: 360, height: 800 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-430x932", width: 430, height: 932 },
  { name: "mobile-landscape-844x390", width: 844, height: 390 },
  { name: "tablet-600x960", width: 600, height: 960 },
  { name: "tablet-820x1180", width: 820, height: 1180 },
  { name: "tablet-landscape-1024x768", width: 1024, height: 768 },
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "wide-1920x1080", width: 1920, height: 1080 },
] as const;

const studentRoutes = [
  { path: "/", heading: /今天继续学习|今天繼續學習/, ready: ".next-session-card" },
  { path: "/words", heading: /词表|詞表/, ready: ".word-list-card" },
  { path: "/stats", heading: /学习统计|學習統計/, ready: ".stats-range-row" },
] as const;

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth, `${label} horizontal overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function openStudy(page: Page) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/study" &&
      candidate.ok(),
  );
  await page.goto("/study", { waitUntil: "domcontentloaded" });
  await response;
  await expect(page.locator(".student-shell")).toBeVisible();
  await expect(page.locator("[data-testid=word-card-drag-layer], .study-success-icon").first()).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(350);
}

async function assertNavigation(page: Page, viewport: { width: number; height: number }, label: string) {
  const visibleNav = page.locator(".student-nav:visible");
  await expect(visibleNav, `${label} visible navigation`).toHaveCount(1);
  await expect(visibleNav.locator("a")).toHaveCount(4);

  const linkMetrics = await visibleNav.locator("a").evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  for (const metrics of linkMetrics) {
    expect(metrics.width, `${label} nav target width`).toBeGreaterThanOrEqual(44);
    expect(metrics.height, `${label} nav target height`).toBeGreaterThanOrEqual(44);
  }

  if (viewport.width < 980) {
    await expect(visibleNav).toHaveClass(/student-nav-bottom/);
    const navMetrics = await visibleNav.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        paddingBottom: Number.parseFloat(style.paddingBottom),
      };
    });
    expect(navMetrics.top, `${label} bottom nav top`).toBeGreaterThanOrEqual(0);
    expect(navMetrics.bottom, `${label} bottom nav bottom`).toBeLessThanOrEqual(viewport.height + 1);
    expect(navMetrics.height, `${label} bottom nav height`).toBeGreaterThanOrEqual(58);
    expect(navMetrics.paddingBottom, `${label} bottom nav safe-area padding`).toBeGreaterThan(0);
  } else {
    await expect(visibleNav).toHaveClass(/student-nav-rail/);
  }
}

test("student destinations reflow and retain real navigation across the final viewport matrix", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of studentRoutes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await expect(page.locator(route.ready)).toBeVisible();
      await assertNavigation(page, viewport, `${route.path} ${viewport.name}`);
      await assertNoHorizontalOverflow(page, `${route.path} ${viewport.name}`);
    }

    await openStudy(page);
    await assertNavigation(page, viewport, `/study ${viewport.name}`);
    await assertNoHorizontalOverflow(page, `/study ${viewport.name}`);

    const actions = page.getByTestId("study-card-actions");
    if (await actions.isVisible()) {
      await actions.scrollIntoViewIfNeeded();
      const actionMetrics = await actions.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("button")].map((button) => {
          const buttonRect = button.getBoundingClientRect();
          return { left: buttonRect.left, right: buttonRect.right, top: buttonRect.top, bottom: buttonRect.bottom, height: buttonRect.height };
        });
        const nav = document.querySelector<HTMLElement>(".student-nav-bottom");
        const navRect = nav?.getBoundingClientRect();
        const speech = document.querySelector<HTMLElement>(".study-speech-rate-control");
        const speechRect = speech?.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          buttons,
          navTop: navRect?.top ?? null,
          navBottom: navRect?.bottom ?? null,
          speechTop: speechRect?.top ?? null,
          speechBottom: speechRect?.bottom ?? null,
        };
      });
      expect(actionMetrics.left, `/study ${viewport.name} actions left`).toBeGreaterThanOrEqual(0);
      expect(actionMetrics.right, `/study ${viewport.name} actions right`).toBeLessThanOrEqual(viewport.width + 1);
      for (const button of actionMetrics.buttons) {
        expect(button.height, `/study ${viewport.name} action target`).toBeGreaterThanOrEqual(60);
      }
      if (actionMetrics.navTop !== null && actionMetrics.navBottom !== null) {
        const overlapsNav = actionMetrics.bottom > actionMetrics.navTop && actionMetrics.top < actionMetrics.navBottom;
        expect(overlapsNav, `/study ${viewport.name} actions overlap fixed nav`).toBe(false);
      }
      if (actionMetrics.speechTop !== null && actionMetrics.speechBottom !== null) {
        const overlapsSpeech = actionMetrics.bottom > actionMetrics.speechTop && actionMetrics.top < actionMetrics.speechBottom;
        expect(overlapsSpeech, `/study ${viewport.name} actions overlap speech-rate control`).toBe(false);
      }
    }
  }
});

test("final reference captures cover home and learn at mobile, tablet, and desktop sizes", async ({ page }) => {
  const captures = [
    { name: "mobile-320x568", width: 320, height: 568 },
    { name: "mobile-390x844", width: 390, height: 844 },
    { name: "tablet-820x1180", width: 820, height: 1180 },
    { name: "desktop-1440x900", width: 1440, height: 900 },
  ] as const;

  for (const capture of captures) {
    await page.setViewportSize(capture);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /今天继续学习|今天繼續學習/ })).toBeVisible();
    await expect(page.locator(".next-session-card")).toBeVisible();
    await page.screenshot({ path: `output/playwright/phase6/home-${capture.name}.png`, fullPage: true });

    await openStudy(page);
    await page.screenshot({ path: `output/playwright/phase6/learn-${capture.name}.png`, fullPage: true });
  }
});

test("personalized surfaces are private and the dashboard/words flows never mint study sessions", async ({ page }) => {
  const dashboard = await page.request.get("/api/student/dashboard");
  const words = await page.request.get("/api/words");
  const insights = await page.request.get("/api/study/insights?days=7");
  expect(dashboard.status()).toBe(200);
  expect(words.status()).toBe(200);
  expect(insights.status()).toBe(200);
  for (const response of [dashboard, words, insights]) {
    expect(response.headers()["cache-control"]).toMatch(/private/i);
    expect(response.headers()["cache-control"]).toMatch(/no-store/i);
  }

  const studyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/study") studyRequests.push(request.method());
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".next-session-card")).toBeVisible();
  await page.goto("/words", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".word-list-card")).toBeVisible();
  await page.locator(".word-list-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(studyRequests).toEqual([]);
});

test("keyboard and accessibility tree expose skip, navigation, live status, card actions, and dialog semantics", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveClass(/skip-link/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByRole("navigation", { name: /学生主导航|學生主導航/ }).first()).toBeAttached();

  await openStudy(page);
  await expect(page.locator("[aria-live=polite]").first()).toBeAttached();
  await expect(page.getByTestId("word-card-drag-layer")).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
  await expect(page.getByTestId("study-card-action-left")).toHaveAttribute("type", "button");
  await expect(page.getByTestId("study-card-action-right")).toHaveAttribute("type", "button");

  const snapshot = await page.locator("body").ariaSnapshot();
  expect(snapshot).toMatch(/学生主导航|學生主導航/);
  expect(snapshot).toMatch(/今日学习|今日學習/);
  expect(snapshot).toMatch(/还不会|還不會/);
  expect(snapshot).toMatch(/我会|我會/);

  await page.getByTestId("study-card-action-left").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/教認字釋義|教认字释义/);
  await expect(page.locator(".student-nav-bottom-layer")).toHaveAttribute("inert", "");
});

test("Chrome 400% zoom keeps the student home reflowed and reachable", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: false,
    scale: 4,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".next-session-card")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(400);
  await assertNoHorizontalOverflow(page, "home 400% zoom-equivalent viewport");
  await expect(page.locator(".student-nav:visible")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: /学生主导航|學生主導航/ }).locator("a").first()).toBeVisible();
});

test("locale and theme combinations keep the selected script and first-frame theme contract", async ({ page, context }) => {
  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await context.addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1:3100/" }]);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.evaluate((nextTheme) => window.localStorage.setItem("theme", nextTheme), theme);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect.poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(theme === "dark");
      if (locale === "zh-Hant") {
        await expect(page.locator("body")).not.toContainText(/见字会|学习|认识|单词|词表|统计|登录|平台|账号|继续/);
      } else {
        await expect(page.locator("body")).toContainText("学习");
      }
    }
  }
});
