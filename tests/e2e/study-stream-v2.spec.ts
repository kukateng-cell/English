import { expect, test } from "@playwright/test";

test("local all-user assignment serves the V2 stream", async ({ page }) => {
  const response = await page.request.get("/api/study/stream?assignmentOnly=1");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, assigned: true, flowVersion: "v2" });
});

test("V2 gives a retrieval opportunity before Learning Card self-rating", async ({ page }) => {
  await page.goto("/study");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const card = page.getByTestId("word-card-drag-layer");
    const flip = page.getByTestId("word-card-flip");
    const selfRecall = page.getByRole("button", { name: "和剛才想的一樣" });
    if (await card.isVisible().catch(() => false)) {
      const isFlipped = await flip.getAttribute("data-flipped");
      if (isFlipped === "false") {
        const front = page.getByTestId("word-card-front");
        const term = (await front.locator(".word-card-term").textContent())?.trim() ?? "";
        await expect(card).toHaveRole("button");
        await expect(card).toHaveAttribute("aria-label", "單詞卡，請長按 3 秒揭示答案");
        await expect(card).not.toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
        const hint = page.getByTestId("word-card-hint");
        const secondaryHint = page.getByTestId("word-card-secondary-hint");
        const indicator = page.getByTestId("word-card-long-press-indicator");
        await expect(indicator).toHaveCount(1);
        await expect(secondaryHint).toHaveCount(0);
        await expect(hint).toHaveClass(/word-card-retrieval-hint/);
        await expect(hint).toHaveClass(/is-think-hint/);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        const earlyHintBox = await hint.boundingBox();
        expect(earlyHintBox).not.toBeNull();
        await page.mouse.move(
          (earlyHintBox?.x ?? 0) + (earlyHintBox?.width ?? 0) / 2,
          (earlyHintBox?.y ?? 0) + (earlyHintBox?.height ?? 0) / 2,
        );
        await page.mouse.down();
        await page.waitForTimeout(1_150);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        await expect(secondaryHint).toHaveText("長按 3 秒揭示答案");
        await expect(secondaryHint).toHaveClass(/is-long-press-hint/);
        await expect(indicator).toHaveClass(/is-active/);
        await page.mouse.up();
        await expect(indicator).not.toHaveClass(/is-active/);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        await expect(secondaryHint).toHaveText("長按 3 秒揭示答案");
        await expect(page.getByTestId("study-stream-self-rating-actions")).toHaveCount(0);

        await front.getByRole("button", { name: "發音" }).click();
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await expect(page.getByTestId("word-card-back-face")).toHaveCount(0);

        await hint.click();
        await expect(flip).toHaveAttribute("data-flipped", "false");

        const hintBox = await hint.boundingBox();
        expect(hintBox).not.toBeNull();
        const holdX = (hintBox?.x ?? 0) + (hintBox?.width ?? 0) / 2;
        const holdY = (hintBox?.y ?? 0) + (hintBox?.height ?? 0) / 2;
        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(450);
        await expect(indicator).toHaveClass(/is-active/);
        const firstHoldVisual = await indicator.evaluate((element) => ({
          progress: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-progress")),
          pulseDuration: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-pulse-duration")),
        }));
        await page.waitForTimeout(450);
        const secondHoldVisual = await indicator.evaluate((element) => ({
          progress: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-progress")),
          pulseDuration: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-pulse-duration")),
        }));
        expect(secondHoldVisual.progress).toBeGreaterThan(firstHoldVisual.progress);
        expect(secondHoldVisual.pulseDuration).toBeLessThan(firstHoldVisual.pulseDuration);
        await page.mouse.up();
        await expect(indicator).not.toHaveClass(/is-active/);

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(2_100);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await page.mouse.up();

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(1_200);
        await page.mouse.move(holdX + 20, holdY);
        await page.waitForTimeout(2_100);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await expect(indicator).not.toHaveClass(/is-active/);
        await page.mouse.up();

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(2_900);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await page.waitForTimeout(250);
        await expect(flip).toHaveAttribute("data-flipped", "true");
        const back = page.getByTestId("word-card-back-face");
        await expect(back).toBeVisible();
        await expect(back.locator(".word-card-term")).toHaveText(term);
        await expect(back.locator(".word-card-answer-content")).toContainText("中文意思");
        await expect(back.getByRole("button", { name: "發音" })).toBeVisible();
        await page.mouse.up();
        await expect(card).toHaveRole("group");
        await expect(card).toHaveAttribute("aria-label", "已揭示的單詞卡，右掃和剛才想的一樣，左掃和剛才想的不一樣");
        await expect(card).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");

        const actions = page.getByTestId("study-stream-self-rating-actions");
        await expect(actions).toBeVisible();
        await expect(actions.getByRole("button", { name: "和剛才想的不一樣" })).toBeVisible();
        await expect(actions.getByRole("button", { name: "和剛才想的一樣" })).toBeVisible();
        const metrics = await page.evaluate(() => {
          const cardElement = document.querySelector<HTMLElement>('[data-testid="word-card-drag-layer"]');
          const actionsElement = document.querySelector<HTMLElement>('[data-testid="study-stream-self-rating-actions"]');
          if (!cardElement || !actionsElement) return null;
          return {
            cardWidth: cardElement.getBoundingClientRect().width,
            actionsWidth: actionsElement.getBoundingClientRect().width,
            nestedInCard: Boolean(actionsElement.closest('[data-testid="word-card-drag-layer"]')),
          };
        });
        expect(metrics).not.toBeNull();
        expect(Math.abs((metrics?.cardWidth ?? 0) - (metrics?.actionsWidth ?? 0))).toBeLessThanOrEqual(1);
        expect(metrics?.nestedInCard).toBe(false);
        await selfRecall.click();
        return;
      }

      if (isFlipped === "true") {
        await selfRecall.click();
        return;
      }
    }

    if (await selfRecall.isVisible().catch(() => false)) {
      await selfRecall.click();
      return;
    }

    if (await card.isVisible().catch(() => false)) {
      await expect(card).not.toHaveAttribute("aria-disabled", "true");
    }

    /*
     * Objective Probe may be resumed in an answered, read-only state before
     * the stream reaches a Learning Card. Acknowledge it and continue.
     */
    const probe = page.getByRole("radiogroup", { name: "客觀題選項" });
    if (await probe.isVisible().catch(() => false)) {
      const acknowledge = page.getByRole("button", { name: "我看到了，繼續" });
      if (await acknowledge.isVisible().catch(() => false)) {
        // The read-only feedback can remain disabled while its authoritative
        // response is still settling; keep polling the stream instead of
        // turning a transient transition into a test failure.
        if (!(await acknowledge.isEnabled().catch(() => false))) {
          await page.waitForTimeout(250);
          continue;
        }
        await acknowledge.click();
        continue;
      }
      const options = page.getByRole("radio");
      await expect(options).toHaveCount(4);
      if (!(await options.first().isEnabled())) {
        await page.waitForTimeout(250);
        continue;
      }
      await options.first().locator("xpath=..").click();
      await expect(acknowledge).toBeVisible();
      continue;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("The local V2 stream did not expose a Learning Card within 12 items");
});

test("expired V2 item credential retry uses one bounded recovery request and clears the outbox", async ({ page }) => {
  const sessionId = "recovery-session-01";
  const streamItemId = "recovery-item-01";
  const itemCredential = "recovery-credential-012345678901234567890123456789";
  const actionBodies: Array<Record<string, unknown>> = [];
  const recoveryBodies: Array<Record<string, unknown>> = [];
  let revealed = false;
  let allowRecovery = false;

  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assignmentOnly") === "1") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        assigned: true,
        session: {
          id: sessionId,
          flowVersion: "v2",
          mode: "global",
          policyVersion: "retrieval-v1",
          revision: 0,
          expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
        },
        item: {
          streamItemId,
          kind: "LEARNING_CARD",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality",
          itemConstructionVersion: "retrieval-v1-item",
          selectionReason: "recovery-test",
          itemCredential,
          credentialExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          clientRevision: 0,
          prompt: "resilience",
          ...(revealed ? {
            learningCard: {
              term: "resilience",
              phonetic: "/rɪˈzɪliəns/",
              definition: "恢复力；韧性",
              pos: "n.",
              examples: [{ en: "Resilience helps us recover.", zh: "恢复力帮助我们重新站起来。" }],
            },
          } : {}),
        },
        resumedFeedback: false,
      }),
    });
  });

  await page.route("**/api/study/actions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/study/actions/recover") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      recoveryBodies.push(body);
      if (!allowRecovery) {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "学习项目凭证无效或已过期", code: "ITEM_CREDENTIAL_INVALID" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          actionKind: body.actionKind,
          duplicate: false,
          itemStatus: "ACKNOWLEDGED",
          clientRevision: 1,
          requiresFeedbackAck: false,
          nextItem: null,
        }),
      });
      return;
    }
    if (pathname !== "/api/study/actions") {
      await route.continue();
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    actionBodies.push(body);
    if (body.actionKind === "REVEAL") {
      revealed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          actionKind: "REVEAL",
          duplicate: false,
          itemStatus: "REVEALED",
          clientRevision: 0,
          requiresFeedbackAck: false,
          learningCard: {
            term: "resilience",
            phonetic: "/rɪˈzɪliəns/",
            definition: "恢复力；韧性",
            pos: "n.",
            examples: [{ en: "Resilience helps us recover.", zh: "恢复力帮助我们重新站起来。" }],
          },
          nextItem: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "学习项目凭证无效或已过期", code: "ITEM_CREDENTIAL_EXPIRED" }),
    });
  });

  await page.goto("/study");
  const card = page.getByTestId("word-card-drag-layer");
  await expect(card).toBeVisible();
  const hint = page.getByTestId("word-card-hint");
  const hintBox = await hint.boundingBox();
  expect(hintBox).not.toBeNull();
  const holdX = (hintBox?.x ?? 0) + (hintBox?.width ?? 0) / 2;
  const holdY = (hintBox?.y ?? 0) + (hintBox?.height ?? 0) / 2;
  await page.mouse.move(holdX, holdY);
  await page.mouse.down();
  await page.waitForTimeout(3_250);
  await page.mouse.up();
  await expect(page.getByTestId("word-card-back-face")).toBeVisible();

  await page.getByRole("button", { name: "和剛才想的一樣" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "學習項目憑證" });
  await expect(alert).toContainText("學習項目憑證無效或已過期");
  const selfRatingBodies = () => actionBodies.filter((body) => body.actionKind === "SELF_RATING");
  expect(selfRatingBodies()).toHaveLength(1);
  expect(recoveryBodies).toHaveLength(1);
  const selfRatingOperationId = selfRatingBodies()[0]?.operationId;

  allowRecovery = true;
  await alert.getByRole("button", { name: "重試" }).click();
  await expect(alert).toHaveCount(0);
  expect(selfRatingBodies()).toHaveLength(2);
  expect(recoveryBodies).toHaveLength(2);
  expect(recoveryBodies[0]?.operationId).toBe(selfRatingOperationId);
  expect(recoveryBodies[1]?.operationId).toBe(selfRatingOperationId);
  const outboxRows = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.includes("study-stream-v2:outbox"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]") : [];
  });
  expect(outboxRows).toEqual([]);
});

test("V2 assignment loading copy follows the selected Chinese locale", async ({ page, context }) => {
  let releaseAssignment!: () => void;
  let assignmentGate: Promise<void> | null = null;
  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assignmentOnly") === "1" && assignmentGate) await assignmentGate;
    await route.continue();
  });

  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    assignmentGate = new Promise<void>((resolve) => {
      releaseAssignment = resolve;
    });
    await context.addCookies([
      { name: "locale", value: locale, url: "http://127.0.0.1:3100/" },
    ]);
    await page.goto("/study");
    await expect(page.getByText(locale === "zh-Hant" ? "加載學習流程..." : "加载学习流程...", { exact: true })).toBeVisible();
    releaseAssignment();
    assignmentGate = null;
    await expect(page.getByText(locale === "zh-Hant" ? "加載學習流程..." : "加载学习流程...", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-testid="word-card-drag-layer"], [role="radiogroup"]')).toBeVisible();
  }
});

test("student account names follow the selected Chinese locale", async ({ page, context }) => {
  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    await context.addCookies([
      { name: "locale", value: locale, url: "http://127.0.0.1:3100/" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const account = page.locator(".account-trigger").first();
    await account.click();
    const heading = page.locator(".account-menu-heading");
    await expect(heading).toBeVisible();
    const headingText = (await heading.textContent()) ?? "";
    if (locale === "zh-Hant") {
      expect(headingText).not.toContain("学生");
    } else {
      expect(headingText).not.toContain("學生");
    }
    await expect(account.locator(".account-avatar")).toHaveText(headingText.slice(0, 1));
  }
});
