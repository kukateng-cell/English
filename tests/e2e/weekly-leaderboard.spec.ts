import { test, expect } from "@playwright/test";

test.describe("student weekly leaderboard", () => {
  test("shows the weekly snapshot, personal goal, and complete class list", async ({ page }) => {
    await page.goto("/leaderboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("leaderboard-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: /學習排行榜|学习排行榜/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /我的排行榜概覽|我的排行榜概览/ })).toBeVisible();
    await expect(page.getByText(/本週日期|本周日期/)).toBeVisible();
    await expect(page.getByText(/本週目標|本周目标/)).toBeVisible();
    await expect(page.getByText(/本週學習日|本周学习日/)).toBeVisible();

    const fullList = page.getByRole("button", { name: /查看完整榜單|查看完整榜单/ });
    await expect(fullList).toBeVisible();
    const allResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/leaderboard" && url.searchParams.get("view") === "all" && response.ok();
    });
    await fullList.click();
    await allResponse;
    await expect(page.getByRole("button", { name: /返回我的位置/ })).toBeVisible();
    await expect(page.locator("[data-me='true']")).toBeVisible();
    await expect(page.locator("[data-testid='leaderboard-detail']")).toBeVisible();
  });

  test("switches scope and keeps the page within the viewport", async ({ page }) => {
    await page.goto("/leaderboard", { waitUntil: "domcontentloaded" });
    const tabs = page.getByRole("tablist", { name: /排行榜範圍|排行榜范围/ });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    const grade = tabs.getByRole("tab").nth(1);
    const response = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return candidate.request().method() === "GET" && url.pathname === "/api/leaderboard" && url.searchParams.get("scope") === "grade" && candidate.ok();
    });
    await grade.click();
    await response;
    await expect(grade).toHaveAttribute("aria-selected", "true");

    const viewport = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      detailWidth: document.querySelector<HTMLElement>("[data-testid='leaderboard-detail']")?.scrollWidth ?? 0,
    }));
    expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
    expect(viewport.detailWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  });
});
