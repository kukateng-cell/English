import { expect, test as setup } from "@playwright/test";

function webkitUsername(base: string) {
  // A separate WebKit fixture is optional.  When seed did not create one,
  // reuse the explicitly configured student instead of inventing an account
  // that cannot authenticate and masking the actual study regression.
  return process.env.TEST_STUDENT_WEBKIT_USERNAME ?? base;
}

setup("authenticate a real study session", async ({ page }, testInfo) => {
  const baseUsername = process.env.TEST_STUDENT_USERNAME;
  const password = process.env.TEST_STUDENT_PASSWORD;
  if (!baseUsername || !password) {
    throw new Error(
      "TEST_STUDENT_USERNAME and TEST_STUDENT_PASSWORD are required",
    );
  }
  const isWebkit = testInfo.project.name === "auth-setup-webkit";
  const username = isWebkit ? webkitUsername(baseUsername) : baseUsername;
  const authState = isWebkit
    ? "test-results/.auth/student-webkit.json"
    : "test-results/.auth/student-chromium.json";

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
  await page.context().storageState({ path: authState });
});
