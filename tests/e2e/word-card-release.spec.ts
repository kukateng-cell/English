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
    ? projectName === "mobile-chromium"
      ? "chromium-touch"
      : "synthetic-touch"
    : projectName === "desktop-firefox"
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

async function signIn(page: Page) {
  const username = process.env.TEST_STUDENT_USERNAME;
  const password = process.env.TEST_STUDENT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "TEST_STUDENT_USERNAME and TEST_STUDENT_PASSWORD are required",
    );
  }

  await page.goto("/study");
  if (page.url().includes("/login")) {
    await page.getByRole("textbox", { name: "賬號 (如 student01)" }).fill(username);
    await page.getByRole("textbox", { name: "密碼" }).fill(password);
    await page.getByRole("button", { name: "登錄" }).click();
  }
  await page.locator('[data-testid="word-card-drag-layer"]').waitFor();
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
) {
  // Reload each scenario so a dismissed card cannot transition the page into
  // its quiz phase while the next release gesture is being prepared.
  await page.goto("/study");
  const card = page.locator('[data-testid="word-card-drag-layer"]');
  await card.waitFor();
  await startPaintSampler(page);

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
    return collectReleaseFrames(page, scenario.distance);
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
    return collectReleaseFrames(page, scenario.distance);
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
  return collectReleaseFrames(page, scenario.distance);
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
      `Paint sampler timed out: ${JSON.stringify(diagnostics)}`,
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
    throw new Error(`Paint sampler failed: ${result.samplerError}`);
  }
  return result;
}

test("release motion changes the visible card on the next paint", async ({
  page,
}, testInfo) => {
  const input = inputForProject(testInfo.project.name);
  await signIn(page);

  for (const scenario of scenarios) {
    await test.step(scenario.name, async () => {
      const result = await dispatchGesture(page, scenario, input);
      const [firstFrame, secondFrame] = result.frames;
      const firstDisplacement = Math.abs(
        firstFrame.position - result.releasePosition,
      );
      const secondDisplacement = Math.abs(
        secondFrame.position - firstFrame.position,
      );
      expect(firstDisplacement).toBeGreaterThan(0.5);
      expect(secondDisplacement).toBeGreaterThan(0.5);
      expect(secondDisplacement / firstDisplacement).toBeLessThan(2.5);

      if (scenario.expected === "dismiss-right") {
        expect(firstFrame.position).toBeGreaterThan(result.releasePosition);
        expect(secondFrame.position).toBeGreaterThan(firstFrame.position);
      } else {
        expect(Math.abs(firstFrame.position)).toBeLessThan(
          Math.abs(result.releasePosition),
        );
        expect(Math.abs(secondFrame.position)).toBeLessThan(
          Math.abs(firstFrame.position),
        );
      }
    });
  }
});

test("reduced motion returns directly without spring frames", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const scenario = scenarios.find((item) => item.name === "outward-return")!;
  const result = await dispatchGesture(
    page,
    scenario,
    inputForProject(testInfo.project.name),
  );
  expect(Math.abs(result.frames[0].position)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(result.frames[1].position)).toBeLessThanOrEqual(0.5);
});
