import { expect, test } from "@playwright/test";

test("login password visibility toggle reveals and hides the entered value", async ({ page }) => {
  await page.goto("/login");

  const password = page.getByRole("textbox", { name: /密码|密碼/ });
  await password.fill("test-secret");
  await expect(password).toHaveAttribute("type", "password");

  const showButton = page.getByRole("button", { name: /显示密码|顯示密碼/ });
  await expect(showButton).toHaveAttribute("aria-pressed", "false");
  await showButton.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("test-secret");

  const hideButton = page.getByRole("button", { name: /隐藏密码|隱藏密碼/ });
  await expect(hideButton).toHaveAttribute("aria-pressed", "true");
  await hideButton.click();
  await expect(password).toHaveAttribute("type", "password");
});

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

test("authentication outage document is a retryable no-store 503", async ({ page }) => {
  const response = await page.request.get("/auth-unavailable?returnTo=%2Fadmin");
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["retry-after"]).toBe("30");
  const body = await response.text();
  expect(body).toMatch(/登入服務暫時無法使用|登录服务暂时无法使用/);
  expect(body).toContain('href="/admin"');
});

test("teacher and admin fixtures retain role boundaries when seeded credentials are available", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the real seeded role fixtures.");
  for (const fixture of [
    { username: "teacher", home: "/teacher", links: ["/teacher", "/teacher/roster"] },
    { username: "admin", home: "/admin", links: ["/admin", "/admin/users", "/admin/words"] },
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/账号|賬號|帳號/).fill(fixture.username);
    await page.getByRole("textbox", { name: /密码|密碼/ }).fill(password!);
    await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await page.waitForURL((url) => url.pathname === fixture.home);
    const workspaceNav = page.getByRole("navigation", { name: /工作區導航|工作区导航/ });
    await expect(workspaceNav).toBeVisible();
    for (const href of fixture.links) {
      await expect(workspaceNav.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await page.getByRole("button", { name: /帳戶選單|帐户选单/ }).click();
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

test("admin workspace highlights only the current route and keeps role metrics readable", async ({ page }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the admin workspace smoke.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號|帳號/).fill("admin");
  await page.getByRole("textbox", { name: /密码|密碼/ }).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const workspaceNav = page.getByRole("navigation", { name: /工作區導航|工作区导航/ });
  const assertActive = async (currentHref: string) => {
    const states = await workspaceNav.locator("a").evaluateAll((links) => links.map((link) => ({
      href: new URL((link as HTMLAnchorElement).href).pathname,
      active: link.classList.contains("is-active"),
    })));
    expect(states.filter((link) => link.active).map((link) => link.href)).toEqual([currentHref]);
  };

  await expect(page.locator(".admin-role-metrics")).toBeVisible();
  await expect(page.locator(".admin-role-metric")).toHaveCount(3);
  await expect(page.locator(".admin-role-metric strong")).toHaveCount(3);
  await assertActive("/admin");

  for (const route of ["/admin/users", "/admin/words"] as const) {
    await page.goto(route);
    await expect(page.locator(`h1`)).toBeVisible();
    await assertActive(route);
    await expect(page.locator(".ui-icon").first()).toBeVisible();
  }

  await page.goto("/admin/analytics");
  await expect(page.getByRole("heading", { name: /學習分析|学习分析/ })).toBeVisible();
  const viewStudents = page.getByRole("link", { name: /查看學生|查看学生/ }).first();
  await expect(viewStudents).toHaveAttribute("href", /\/admin\/analytics\?classId=/);
  await viewStudents.click();
  await expect(page).toHaveURL(/\/admin\/analytics\?classId=/);
  await expect(page.getByRole("heading", { name: /學生|学生/ }).last()).toBeVisible();
  await expect(page.getByRole("textbox", { name: /搜尋學生|搜索学生/ })).toBeVisible();
});

test("teacher and admin desktop sidebars keep account controls in the viewport on long pages", async ({ browser }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the seeded workspace smoke.");

  for (const fixture of [
    { username: "teacher", home: "/teacher", longRoute: "/teacher/roster" },
    { username: "admin", home: "/admin", longRoute: "/admin/roster" },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/账号|賬號|帳號/).fill(fixture.username);
    await page.getByRole("textbox", { name: /密码|密碼/ }).fill(password!);
    await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await page.waitForURL((url) => url.pathname === fixture.home);
    await page.goto(fixture.longRoute, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".workspace-sidebar")).toBeVisible();

    const readSidebar = () => page.locator(".workspace-sidebar").evaluate((sidebar) => {
      const style = getComputedStyle(sidebar);
      const account = sidebar.querySelector<HTMLElement>(".account-controls")?.getBoundingClientRect();
      return {
        position: style.position,
        height: sidebar.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        accountBottom: account?.bottom ?? 0,
      };
    });

    const initial = await readSidebar();
    expect(initial.position).toBe("sticky");
    expect(initial.height).toBeGreaterThanOrEqual(initial.viewportHeight);
    expect(initial.accountBottom).toBeGreaterThan(initial.viewportHeight - 100);

    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }));
    const afterScroll = await readSidebar();
    expect(afterScroll.accountBottom).toBeGreaterThan(afterScroll.viewportHeight - 100);
    await context.close();
  }
});
