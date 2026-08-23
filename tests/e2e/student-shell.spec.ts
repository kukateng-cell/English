import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

test("student shell exposes four real destinations without minting study sessions", async ({ page }) => {
  let studyRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/study") studyRequests += 1;
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  const nav = page.getByRole("navigation", { name: /学生主导航|學生主導航/ });
  await expect(nav).toBeVisible();
  for (const href of ["/", "/study", "/words", "/stats"]) await expect(nav.locator(`a[href="${href}"]`)).toHaveAttribute("href", href);
  await expect(page.getByRole("button", { name: /账户菜单|賬戶菜單/ })).toBeVisible();
  await page.getByRole("button", { name: /账户菜单|賬戶菜單/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");

  const wordsResponse = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/words");
  await nav.locator('a[href="/words"]').click();
  await expect(page).toHaveURL(/\/words$/);
  expect((await wordsResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: /词表|詞表/ })).toBeVisible();
  await expect(nav.locator('a[href="/words"]')).toHaveAttribute("aria-current", "page");
  await page.locator(".word-list-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  const insightsResponse = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/study/insights");
  await page.getByRole("link", { name: /统计|統計/ }).first().click();
  await expect(page).toHaveURL(/\/stats$/);
  expect((await insightsResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: /学习统计|學習統計/ })).toBeVisible();
  expect(studyRequests).toBe(0);
});

test("student shell keeps mobile navigation inside the safe-area surface", async ({ page }, testInfo) => {
  if (!testInfo.project.name.includes("mobile")) return;
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: /学生主导航|學生主導航/ });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveClass(/student-nav-bottom/);
  await expect(page.locator(".student-rail")).toBeHidden();
  const paddingBottom = await page.locator(".student-nav-bottom").evaluate((element) => getComputedStyle(element).paddingBottom);
  expect(paddingBottom).not.toBe("0px");
});

test("word filters are URL-addressable and survive refresh/back navigation", async ({ page }) => {
  await page.goto("/words");
  await page.getByRole("button", { name: "A1", exact: true }).click();
  const statusFilter = page.getByRole("group", { name: /按状态筛选|按狀態篩選/ });
  await statusFilter.getByRole("button", { name: /学习中|學習中/ }).click();
  await expect(page).toHaveURL(/level=A1.*status=learning|status=learning.*level=A1/);
  await expect(page.getByRole("button", { name: "A1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(statusFilter.getByRole("button", { name: /学习中|學習中/ })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page).toHaveURL(/level=A1.*status=learning|status=learning.*level=A1/);
  await page.goBack();
  await expect(page).toHaveURL(/\/words\?level=A1$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/words$/);
});

test("statistics level badges agree with the unit unlock source of truth", async ({ page }) => {
  const [unitsResponse, insightsResponse] = await Promise.all([
    page.request.get("/api/units?level=A1"),
    page.request.get("/api/study/insights?days=7"),
  ]);
  expect(unitsResponse.ok()).toBeTruthy();
  expect(insightsResponse.ok()).toBeTruthy();
  const units = await unitsResponse.json() as {
    levelStatus: Array<{ level: string; unlocked: boolean }>;
  };
  const insights = await insightsResponse.json() as {
    libraryByLevel: Array<{ level: string; unlocked: boolean }>;
  };
  const expected = new Map(units.levelStatus.map((level) => [level.level, level.unlocked]));
  expect([...expected.values()].some(Boolean)).toBeTruthy();
  for (const level of insights.libraryByLevel) {
    expect(level.unlocked, `${level.level} unlock status`).toBe(expected.get(level.level) ?? false);
  }
});

test("word pagination ignores a stale page after the student changes filters", async ({ page }) => {
  const word = (id: string, term: string, level: string) => ({
    id,
    term,
    phonetic: null,
    pos: "noun",
    definition: `${term} 定義`,
    level,
    category: "測試",
    learned: false,
    mastered: false,
    status: "unseen",
    nextReviewAt: null,
  });
  let resolveStaleRequest: (() => void) | undefined;
  const staleRequestStarted = new Promise<void>((resolve) => {
    resolveStaleRequest = resolve;
  });
  await page.route("**/api/words?**", async (route) => {
    const url = new URL(route.request().url());
    const level = url.searchParams.get("level") ?? "A1";
    const cursor = url.searchParams.get("cursor");
    if (level === "A1" && cursor) {
      resolveStaleRequest?.();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            word("a1-current", "A1 current page", "A1"),
            word("a1-stale", "A1 stale page", "A1"),
            word("a1-stale", "A1 stale page", "A1"),
          ],
          nextCursor: null,
          total: 2,
          availableLevels: ["A1", "B1"],
          availableCategories: ["測試"],
        }),
      }).catch(() => undefined);
      return;
    }
    const item = level === "B1"
      ? word("b1-current", "B1 current page", "B1")
      : word("a1-current", "A1 current page", "A1");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [item],
        nextCursor: level === "A1" ? "a1-next" : null,
        total: level === "A1" ? 2 : 1,
        availableLevels: ["A1", "B1"],
        availableCategories: ["測試"],
      }),
    });
  });

  await page.goto("/words?level=A1");
  await expect(page.getByText("A1 current page", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /加载更多|加載更多/ }).click();
  await staleRequestStarted;
  await page.getByRole("button", { name: "B1", exact: true }).click();
  await expect(page.getByText("B1 current page", { exact: true })).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByText("A1 stale page", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A1 current page", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "A1", exact: true }).click();
  await expect(page.getByText("A1 current page", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: /加载更多|加載更多/ }).click();
  await expect(page.getByText("A1 stale page", { exact: true })).toHaveCount(1);
  await expect(page.getByText("A1 current page", { exact: true })).toHaveCount(1);
});
