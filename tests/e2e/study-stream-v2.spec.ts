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
        await expect(acknowledge).toBeEnabled({ timeout: 10_000 });
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
