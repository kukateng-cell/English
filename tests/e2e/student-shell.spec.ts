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
