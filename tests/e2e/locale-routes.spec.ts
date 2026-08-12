import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("key student routes keep the Traditional source-locale contract", async ({ page }) => {
  const routes = ["/", "/study", "/words", "/stats"];
  const forbiddenSimplifiedUi = /见字会|学习|认识|单词|词表|统计|登录|平台|账号|继续/;

  for (const route of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
    await expect(page.locator("body")).not.toContainText(forbiddenSimplifiedUi);
  }
});
