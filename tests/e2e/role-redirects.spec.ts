import { expect, test } from "@playwright/test";

test("unauthenticated root, student pages, and student APIs follow the role contract", async ({ page }) => {
  for (const path of ["/", "/words", "/stats"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?callbackUrl=%2F${path === "/" ? "" : path.slice(1)}`));
  }
  for (const path of ["/api/student/dashboard", "/api/words", "/api/study/insights"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(401);
  }
});

test("teacher and admin fixtures retain role boundaries when seeded credentials are available", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the real seeded role fixtures.");
  for (const fixture of [
    { username: "teacher", home: "/teacher", links: ["/teacher", "/teacher/students"] },
    { username: "admin", home: "/admin", links: ["/admin", "/admin/users", "/admin/words"] },
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/账号|賬號/).fill(fixture.username);
    await page.getByLabel(/密码|密碼/).fill(password!);
    await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await page.waitForURL((url) => url.pathname === fixture.home);
    const workspaceNav = page.getByRole("navigation", { name: /工作區導航|工作区导航/ });
    await expect(workspaceNav).toBeVisible();
    for (const href of fixture.links) {
      await expect(workspaceNav.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await page.getByRole("button", { name: /賬戶菜單|账户菜单/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    expect((await page.request.get("/api/words")).status()).toBe(403);
    expect((await page.request.get("/api/student/dashboard")).status()).toBe(403);
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`${fixture.home}$`));
    await context.close();
  }
});
