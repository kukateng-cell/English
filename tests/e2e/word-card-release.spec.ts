import { expect, test, type Page } from "@playwright/test";

type GestureScenario = {
  name: "fast-flick" | "slow-threshold" | "outward-return" | "held-late-flick";
  distance: number;
  steps: number;
  delayMs: number;
  preHoldMs: number;
  holdMs: number;
  expected: "dismiss-right" | "return";
};

type InputMode =
  | "mouse"
  | "chromium-touch"
  | "synthetic-mouse"
  | "synthetic-touch";

function inputForProject(projectName: string): InputMode {
  const touch = projectName.startsWith("mobile-");
  return touch
    ? projectName === "mobile-chromium-emulation"
      ? "chromium-touch"
      : "synthetic-touch"
    : projectName.startsWith("desktop-firefox")
      ? "synthetic-mouse"
      : "mouse";
}

const scenarios: GestureScenario[] = [
  {
    name: "fast-flick",
    distance: 120,
    steps: 3,
    delayMs: 1,
    preHoldMs: 0,
    holdMs: 0,
    expected: "dismiss-right",
  },
  {
    name: "slow-threshold",
    distance: 120,
    steps: 12,
    delayMs: 25,
    preHoldMs: 0,
    holdMs: 160,
    expected: "dismiss-right",
  },
  {
    name: "outward-return",
    distance: 20,
    steps: 2,
    delayMs: 4,
    preHoldMs: 0,
    holdMs: 0,
    expected: "return",
  },
  {
    name: "held-late-flick",
    distance: 120,
    steps: 2,
    delayMs: 4,
    preHoldMs: 160,
    holdMs: 0,
    expected: "dismiss-right",
  },
];

declare global {
  interface Window {
    __wordCardPaintTrace?: Array<{ timestamp: number; position: number }>;
    __wordCardPaintSamplerActive?: boolean;
    __wordCardPaintSamplerError?: string;
    __wordCardReleaseObserved?: boolean;
  }
}

async function startPaintSampler(page: Page) {
  await page.evaluate(() => {
    window.__wordCardPaintTrace = [];
    window.__wordCardPaintSamplerError = undefined;
    window.__wordCardReleaseObserved = false;

    const horizontalTranslation = (transform: string) => {
      if (transform === "none") return 0;
      const openingParenthesis = transform.indexOf("(");
      if (openingParenthesis < 0 || !transform.endsWith(")")) {
        throw new Error(`Unexpected computed transform: ${transform}`);
      }
      const values = transform
        .slice(openingParenthesis + 1, -1)
        .split(",")
        .map((value) => Number(value.trim()));
      const position = transform.startsWith("matrix3d(")
        ? values[12]
        : transform.startsWith("matrix(")
          ? values[4]
          : undefined;
      if (position === undefined || !Number.isFinite(position)) {
        throw new Error(`Cannot read x translation from: ${transform}`);
      }
      return position;
    };

    const sample = (timestamp: number) => {
      try {
        const card = document.querySelector<HTMLElement>(
          '[data-testid="word-card-drag-layer"]',
        );
        if (card) {
          const position = horizontalTranslation(
            getComputedStyle(card).transform,
          );
          window.__wordCardPaintTrace?.push({ timestamp, position });
        }
      } catch (error) {
        window.__wordCardPaintSamplerError =
          error instanceof Error ? error.message : String(error);
        window.__wordCardPaintSamplerActive = false;
        return;
      }
      if (window.__wordCardPaintSamplerActive) requestAnimationFrame(sample);
    };
    window.addEventListener(
      "pointerup",
      () => {
        window.__wordCardReleaseObserved = true;
        window.__wordCardPaintSamplerActive = true;
        requestAnimationFrame(sample);
      },
      { once: true },
    );
  });
}

async function dispatchGesture(
  page: Page,
  scenario: GestureScenario,
  input: InputMode,
  collectFrames = true,
  path = "/test/word-card-motion",
) {
  // Reload each scenario because a completed dismissal intentionally leaves
  // this isolated card offscreen. The callback never unmounts the component.
  await page.goto(path);
  const card = page.locator('[data-testid="word-card-drag-layer"]');
  await card.waitFor();
  if (collectFrames) await startPaintSampler(page);

  const box = await card.boundingBox();
  if (!box) throw new Error("Card bounding box is unavailable");
  const start = {
    x: box.x + box.width * 0.25,
    y: box.y + box.height * 0.25,
  };

  if (input === "chromium-touch") {
    const client = await page.context().newCDPSession(page);
    const points = (x: number) => [
      { x, y: start.y, radiusX: 1, radiusY: 1, force: 1, id: 1 },
    ];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(start.x),
    });
    if (scenario.preHoldMs) await page.waitForTimeout(scenario.preHoldMs);
    for (let step = 1; step <= scenario.steps; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(start.x + (scenario.distance * step) / scenario.steps),
      });
      if (step < scenario.steps) await page.waitForTimeout(scenario.delayMs);
    }
    if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await client.detach();
    return collectFrames
      ? collectReleaseFrames(page, scenario.distance)
      : { releasePosition: scenario.distance, frames: [], samplerError: null };
  }

  if (input === "synthetic-touch" || input === "synthetic-mouse") {
    const pointerType = input === "synthetic-touch" ? "touch" : "mouse";
    const moveEventType = await page.evaluate(() =>
      "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove",
    );
    await page.evaluate(() => {
      const dragLayer = document.querySelector<HTMLElement>(
        '[data-testid="word-card-drag-layer"]',
      );
      if (!dragLayer) throw new Error("Card is unavailable");
      dragLayer.setPointerCapture = () => {};
      dragLayer.hasPointerCapture = () => true;
    });
    const dispatch = (type: string, x: number) =>
      page.evaluate(
        ({ type, x, y, pointerType }) => {
          const dragLayer = document.querySelector<HTMLElement>(
            '[data-testid="word-card-drag-layer"]',
          );
          if (!dragLayer) throw new Error("Card is unavailable");
          dragLayer.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType,
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: x,
              clientY: y,
            }),
          );
        },
        { type, x, y: start.y, pointerType },
      );
    await dispatch("pointerdown", start.x);
    if (scenario.preHoldMs) await page.waitForTimeout(scenario.preHoldMs);
    for (let step = 1; step <= scenario.steps; step++) {
      await dispatch(
        moveEventType,
        start.x + (scenario.distance * step) / scenario.steps,
      );
      if (step < scenario.steps) await page.waitForTimeout(scenario.delayMs);
    }
    if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
    await dispatch("pointerup", start.x + scenario.distance);
    return collectFrames
      ? collectReleaseFrames(page, scenario.distance)
      : { releasePosition: scenario.distance, frames: [], samplerError: null };
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (scenario.preHoldMs) await page.waitForTimeout(scenario.preHoldMs);
  for (let step = 1; step <= scenario.steps; step++) {
    await page.mouse.move(
      start.x + (scenario.distance * step) / scenario.steps,
      start.y,
    );
    if (step < scenario.steps) await page.waitForTimeout(scenario.delayMs);
  }
  if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
  await page.mouse.up();
  return collectFrames
    ? collectReleaseFrames(page, scenario.distance)
    : { releasePosition: scenario.distance, frames: [], samplerError: null };
}

async function collectReleaseFrames(page: Page, releasePosition: number) {
  try {
    await page.waitForFunction(
      () =>
        Boolean(window.__wordCardPaintSamplerError) ||
        (window.__wordCardReleaseObserved === true &&
          (window.__wordCardPaintTrace?.length ?? 0) >= 3),
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    const diagnostics = await page.evaluate(() => ({
      releaseObserved: window.__wordCardReleaseObserved ?? false,
      frameCount: window.__wordCardPaintTrace?.length ?? 0,
      samplerError: window.__wordCardPaintSamplerError ?? null,
    }));
    throw new Error(
      `Frame sampler timed out: ${JSON.stringify(diagnostics)}`,
    );
  }

  const result = await page.evaluate((position) => {
    window.__wordCardPaintSamplerActive = false;
    return {
      releasePosition: position,
      frames: window.__wordCardPaintTrace ?? [],
      samplerError: window.__wordCardPaintSamplerError ?? null,
    };
  }, releasePosition);
  if (result.samplerError) {
    throw new Error(`Frame sampler failed: ${result.samplerError}`);
  }
  return result;
}

for (const scenario of scenarios) {
  test(`release pose and trajectory remain valid after pointerup: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    const input = inputForProject(testInfo.project.name);
    const result = await dispatchGesture(page, scenario, input);
    await expect(page.getByTestId("motion-probe")).not.toHaveText("none");
    const probe = JSON.parse(
      (await page.getByTestId("motion-probe").textContent()) ?? "{}",
    ) as {
      firstReleaseRafDelayMs?: number | null;
      releasePreviewApplied?: boolean;
      releasePreviewAt?: number | null;
      releasePreviewPosition?: number | null;
      releasePreviewVelocity?: number | null;
      pointerupStartedAt?: number | null;
      pointerupEndedAt?: number | null;
      releasePosition?: number;
      firstFramePosition?: number;
      frameCount?: number;
    };
    expect(probe.frameCount).toBeGreaterThanOrEqual(1);
    expect(probe.releasePreviewApplied).toBe(true);
    expect(Number.isFinite(probe.releasePreviewAt)).toBe(true);
    expect(Number.isFinite(probe.releasePreviewPosition)).toBe(true);
    expect(Number.isFinite(probe.releasePreviewVelocity)).toBe(true);
    expect(Number.isFinite(probe.pointerupStartedAt)).toBe(true);
    expect(Number.isFinite(probe.pointerupEndedAt)).toBe(true);
    expect(probe.releasePreviewAt!).toBeGreaterThanOrEqual(
      probe.pointerupStartedAt!,
    );
    expect(probe.releasePreviewAt!).toBeLessThanOrEqual(
      probe.pointerupEndedAt!,
    );

    if (scenario.expected === "dismiss-right") {
      expect(probe.releasePreviewPosition).toBeGreaterThan(
        probe.releasePosition!,
      );
    } else {
      expect(Math.abs(probe.releasePreviewPosition!)).toBeLessThan(
        Math.abs(probe.releasePosition!),
      );
    }

    // A headless WebKit worker can delay its first rAF by hundreds of ms or
    // more. That is scheduler evidence, not evidence that the release pose
    // was duplicated. The synchronous release preview above is the contract;
    // this optional check only confirms direction when the first rAF is timely.
    if (
      result.frames.length >= 2 &&
      (probe.firstReleaseRafDelayMs ?? Number.POSITIVE_INFINITY) <= 120 &&
      probe.firstFramePosition !== undefined
    ) {
      if (scenario.expected === "dismiss-right") {
        expect(probe.firstFramePosition).toBeGreaterThan(probe.releasePosition!);
      } else {
        expect(Math.abs(probe.firstFramePosition)).toBeLessThan(
          Math.abs(probe.releasePosition!),
        );
      }
    }

    if (scenario.expected === "dismiss-right") {
      await expect(page.getByTestId("callback-count")).toHaveText("1");
      await expect(page.getByTestId("callback-direction")).toHaveText("right");
    } else {
      await expect(page.getByTestId("callback-count")).toHaveText("0");
    }
  });
}

test("reduced motion returns directly without spring frames", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scenario = scenarios.find((item) => item.name === "outward-return")!;
  await dispatchGesture(
    page,
    scenario,
    inputForProject(testInfo.project.name),
    false,
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"reducedMotion":true',
  );
  await expect(page.getByTestId("callback-count")).toHaveText("0");
  await expect(page.locator('[data-testid="word-card-drag-layer"]')).toHaveCSS(
    "transform",
    /matrix\(1, 0, 0, 1, 0, 0\)|none/,
  );
});

test("reduced motion dismissal snaps and invokes its callback once", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scenario = scenarios.find((item) => item.name === "fast-flick")!;
  await dispatchGesture(
    page,
    scenario,
    inputForProject(testInfo.project.name),
    false,
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"mode":"dismiss"',
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"releasePreviewApplied":false',
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"reducedMotion":true',
  );
  await expect(page.getByTestId("callback-count")).toHaveText("1");
  await expect(page.getByTestId("callback-direction")).toHaveText("right");
});

test("timeline lead can be disabled for an A/B diagnostic", async ({
  page,
}, testInfo) => {
  await dispatchGesture(
    page,
    scenarios[0],
    inputForProject(testInfo.project.name),
    false,
    "/test/word-card-motion?timelineLead=0",
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"timelineLeadMs":0',
  );
  await expect(page.getByTestId("callback-count")).toHaveText("1");
});

test("synchronous release pose can be disabled for an A/B diagnostic", async ({
  page,
}, testInfo) => {
  await dispatchGesture(
    page,
    scenarios[0],
    inputForProject(testInfo.project.name),
    false,
    "/test/word-card-motion?immediateRelease=0",
  );
  await expect(page.getByTestId("motion-probe")).toContainText(
    '"mode":"dismiss"',
  );
  await expect(page.getByTestId("callback-count")).toHaveText("1");
});
