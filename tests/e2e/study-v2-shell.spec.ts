import { expect, test, type Page } from "@playwright/test";
import type { PublicStreamResponse } from "../../src/lib/study-stream/contracts";

test.describe.configure({ timeout: 60_000 });

const credential = "shell-credential-012345678901234567890123456789";

function streamResponse(overrides: Partial<PublicStreamResponse["session"]> = {}): PublicStreamResponse {
  return {
    ok: true,
    assigned: true,
    resumedFeedback: false,
    session: {
      id: "shell-session",
      mode: "global",
      flowVersion: "v2",
      policyVersion: "retrieval-v1",
      revision: 0,
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      ...overrides,
    },
    item: {
      streamItemId: "shell-item",
      kind: "LEARNING_CARD",
      flowVersion: "v2",
      policyVersion: "retrieval-v1",
      qualityPolicyVersion: "retrieval-v1-quality-v1",
      itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
      selectionReason: "shell-test",
      itemCredential: credential,
      credentialExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      clientRevision: 0,
      prompt: "apple",
      level: "A1",
      category: "daily-life",
    },
  };
}

async function installStream(page: Page) {
  await page.route("**/api/study/stream**", async (route) => {
    await route.fulfill({ json: streamResponse() });
  });
}

test("V2 study shell uses the stream endpoint and exposes a safe global exit", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/study")) requests.push(pathname);
  });
  await installStream(page);
  await page.goto("/study");

  await expect(page.getByTestId("study-stream-title")).toHaveText("連續學習");
  await expect(page.getByTestId("word-card-drag-layer")).toBeVisible();
  await expect(page.getByTestId("study-stream-title")).toBeVisible();
  await expect(page.getByRole("link", { name: "離開學習" })).toHaveAttribute("href", "/");
  expect(requests).toContain("/api/study/stream");
  expect(requests).not.toContain("/api/study");
  await expect(page.getByTestId("study-card-actions")).toHaveCount(0);
});

test("unit V2 study keeps its unit exit target", async ({ page }) => {
  await installStream(page);
  await page.goto("/study?mode=unit&level=A1&category=daily-life");

  await expect(page.getByTestId("study-stream-title")).toBeVisible();
  await expect(page.getByRole("link", { name: "離開學習" })).toHaveAttribute("href", "/units");
  await expect(page.getByTestId("word-card-drag-layer")).toHaveAttribute(
    "aria-label",
    "單詞卡，請長按 3 秒揭示答案",
  );
});

test("student navigation exposes one active surface for the current viewport", async ({ page }, testInfo) => {
  await installStream(page);
  await page.goto("/study");

  await expect(page.locator(".student-shell")).toHaveClass(/is-study/);
  await expect(page.locator(".student-nav")).toHaveCount(2);
  const mobile = testInfo.project.name.includes("mobile");
  await expect(page.locator(mobile ? ".student-nav-bottom" : ".student-nav-rail")).toBeVisible();
  await expect(page.locator(mobile ? ".student-nav-rail" : ".student-nav-bottom")).toBeHidden();
  await expect(page.locator(`${mobile ? ".student-nav-bottom" : ".student-nav-rail"} a[href="/study"]`)).toHaveAttribute("aria-current", "page");
});
