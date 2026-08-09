import { expect, test as setup } from "@playwright/test";

const AUTH_STATE = "test-results/.auth/student.json";

setup("authenticate a real study session", async ({ page }) => {
  const username = process.env.TEST_STUDENT_USERNAME;
  const password = process.env.TEST_STUDENT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "TEST_STUDENT_USERNAME and TEST_STUDENT_PASSWORD are required",
    );
  }

  await page.goto("/login");
  await page.getByRole("textbox", { name: /賬號|账号/ }).fill(username);
  await page.getByRole("textbox", { name: /密碼|密码/ }).fill(password);
  const callbackResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/auth/callback/credentials"),
  );
  await page.getByRole("button", { name: /登錄|登录/ }).click();
  expect((await callbackResponse).ok()).toBe(true);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  expect(session.user?.id).toBeTruthy();
  await page.context().storageState({ path: AUTH_STATE });
});
