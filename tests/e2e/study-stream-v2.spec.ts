import { expect, test } from "@playwright/test";

test("local all-user assignment serves the V2 stream", async ({ page }) => {
  const response = await page.request.get("/api/study/stream?assignmentOnly=1");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, assigned: true, flowVersion: "v2" });
});

test("V2 gives a retrieval opportunity before Learning Card self-rating", async ({ page }) => {
  await page.goto("/study");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reveal = page.getByRole("button", { name: "揭示中文意思" });
    const selfRecall = page.getByRole("button", { name: "我會 →" });
    if (await reveal.isVisible().catch(() => false)) {
      const card = page.getByRole("group", { name: "單詞卡，請先揭示中文意思" });
      await expect(card).toHaveAttribute("aria-disabled", "true");
      await expect(card).not.toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
      await expect(page.getByRole("button", { name: "我會 →" })).toHaveCount(0);

      await reveal.click();
      await expect(selfRecall).toBeVisible();
      await expect(page.getByRole("button", { name: "← 還不會" })).toBeVisible();
      await selfRecall.click();
      return;
    }

    if (await selfRecall.isVisible().catch(() => false)) {
      await selfRecall.click();
      return;
    }

    const probe = page.getByRole("radiogroup", { name: "客觀題選項" });
    if (await probe.isVisible().catch(() => false)) {
      const acknowledge = page.getByRole("button", { name: "我看到了，繼續" });
      if (await acknowledge.isVisible().catch(() => false)) {
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
      await acknowledge.click();
      continue;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("The local V2 stream did not expose a Learning Card within 12 items");
});
