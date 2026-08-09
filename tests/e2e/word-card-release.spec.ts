import { expect, test, type Page } from "@playwright/test";

type GestureScenario = {
  name:
    | "fast-flick"
    | "slow-threshold"
    | "outward-return"
    | "held-late-flick";
  distance: number;
  steps: number;
  delayMs: number;
  preHoldMs: number;
  holdMs: number;
  expected: "dismiss-right" | "return";
};

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
    distance: 100,
    steps: 2,
    delayMs: 4,
    preHoldMs: 160,
    holdMs: 0,
    expected: "dismiss-right",
  },
];

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

async function dispatchGesture(
  page: Page,
  scenario: GestureScenario,
  input:
    | "mouse"
    | "chromium-touch"
    | "synthetic-mouse"
    | "synthetic-touch",
) {
  await page.goto(`/study?gesture=${scenario.name}`);
  const card = page.locator('[data-testid="word-card-drag-layer"]');
  await card.waitFor();
  await page.evaluate(() => {
    window.__wordCardGestureTrace = [];
    window.__wordCardPaintTrace = [];
    window.__wordCardPaintSamplerActive = true;
    const sample = (timestamp: number) => {
      const card = document.querySelector<HTMLElement>(
        '[data-testid="word-card-drag-layer"]',
      );
      if (card) {
        const transform = getComputedStyle(card).transform;
        const values = transform.match(/^matrix(3d)?\((.+)\)$/)?.[2]
          ?.split(",")
          .map(Number);
        const position = values
          ? transform.startsWith("matrix3d")
            ? values[12]
            : values[4]
          : 0;
        window.__wordCardPaintTrace?.push({ timestamp, position });
      }
      if (window.__wordCardPaintSamplerActive) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.waitForFunction(() => (window.__wordCardPaintTrace?.length ?? 0) >= 6);

  const box = await card.boundingBox();
  if (!box) throw new Error("Card bounding box is unavailable");
  const start = {
    x: box.x + box.width * 0.25,
    y: box.y + box.height * 0.25,
  };

  if (input === "chromium-touch") {
    const client = await page.context().newCDPSession(page);
    const points = (x: number) => [
      {
        x,
        y: start.y,
        radiusX: 1,
        radiusY: 1,
        force: 1,
        id: 1,
      },
    ];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(start.x),
    });
    if (scenario.preHoldMs) await page.waitForTimeout(scenario.preHoldMs);
    for (let step = 1; step <= scenario.steps; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(
          start.x + (scenario.distance * step) / scenario.steps,
        ),
      });
      if (step < scenario.steps) {
        await page.waitForTimeout(scenario.delayMs);
      }
    }
    if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await client.detach();
  } else if (input === "synthetic-touch" || input === "synthetic-mouse") {
    const pointerType = input === "synthetic-touch" ? "touch" : "mouse";
    await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-testid="word-card-drag-layer"]',
      );
      if (!card) throw new Error("Card is unavailable");
      card.setPointerCapture = () => {};
      card.hasPointerCapture = () => true;
    });
    const dispatch = (type: string, x: number) =>
      page.evaluate(
        ({ type, x, y, pointerType }) => {
          const card = document.querySelector<HTMLElement>(
            '[data-testid="word-card-drag-layer"]',
          );
          if (!card) throw new Error("Card is unavailable");
          card.dispatchEvent(
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
        "pointermove",
        start.x + (scenario.distance * step) / scenario.steps,
      );
      if (step < scenario.steps) {
        await page.waitForTimeout(scenario.delayMs);
      }
    }
    if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
    await dispatch("pointerup", start.x + scenario.distance);
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (scenario.preHoldMs) await page.waitForTimeout(scenario.preHoldMs);
    for (let step = 1; step <= scenario.steps; step++) {
      await page.mouse.move(
        start.x + (scenario.distance * step) / scenario.steps,
        start.y,
      );
      if (step < scenario.steps) {
        await page.waitForTimeout(scenario.delayMs);
      }
    }
    if (scenario.holdMs) await page.waitForTimeout(scenario.holdMs);
    await page.mouse.up();
  }

  await page.waitForFunction(
    () =>
      (window.__wordCardGestureTrace ?? []).filter(
        (entry) => entry.name === "release-frame",
      ).length >= 3,
  );

  return page.evaluate(() => {
    window.__wordCardPaintSamplerActive = false;
    const trace = window.__wordCardGestureTrace ?? [];
    return {
      owner: document
        .querySelector('[data-testid="word-card-drag-layer"]')
        ?.getAttribute("data-motion-owner"),
      pointerdown: trace.find((entry) => entry.name === "pointerdown"),
      pointerup: trace.find(
        (entry) => entry.name === "pointerup-handler-entry",
      ),
      handoff: trace.find((entry) => entry.name === "release-handoff"),
      dragFrames: trace.filter((entry) => entry.name === "drag-render"),
      paintFrames: window.__wordCardPaintTrace ?? [],
      frames: trace
        .filter((entry) => entry.name === "release-frame")
        .slice(0, 3),
    };
  });
}

declare global {
  interface Window {
    __wordCardGestureTrace?: Array<
      Record<string, number | string | boolean | undefined>
    >;
    __wordCardPaintTrace?: Array<{ timestamp: number; position: number }>;
    __wordCardPaintSamplerActive?: boolean;
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

test("release velocity stays continuous", async ({ page }, testInfo) => {
  const touch = testInfo.project.name.startsWith("mobile-");
  const input = touch
    ? testInfo.project.name === "mobile-chromium"
      ? "chromium-touch"
      : "synthetic-touch"
    : testInfo.project.name === "desktop-firefox"
      ? "synthetic-mouse"
      : "mouse";
  await signIn(page);
  await expect(page.getByTestId("card-motion-build-badge")).toContainText(
    "card-motion-2026.08.09-r3",
  );

  for (const scenario of scenarios) {
    const result = await dispatchGesture(page, scenario, input);
    expect(result.owner).toBe("single-raf");
    expect(result.pointerdown?.pointerType).toBe(touch ? "touch" : "mouse");
    expect(result.pointerup).toBeTruthy();
    expect(result.handoff).toBeTruthy();
    expect(result.frames).toHaveLength(3);

    const handoffTimestamp = Number(result.handoff?.timestamp);
    const preHandoffPaints = result.paintFrames.filter(
      (frame) => frame.timestamp < handoffTimestamp,
    );
    const refreshIntervals = preHandoffPaints
      .slice(-8)
      .slice(1)
      .map(
        (frame, index) =>
          frame.timestamp - preHandoffPaints.slice(-8)[index].timestamp,
      )
      .filter((interval) => interval > 0);
    const medianFrameInterval = median(refreshIntervals);
    const handoffToFirstFrameMs =
      Number(result.frames[0].timestamp) - handoffTimestamp;
    expect(handoffToFirstFrameMs).toBeLessThanOrEqual(
      medianFrameInterval * 1.5 + 2,
    );

    if (scenario.name === "held-late-flick") {
      expect(
        result.dragFrames.filter(
          (frame) => Math.abs(Number(frame.position)) < 0.01,
        ).length,
      ).toBeGreaterThanOrEqual(3);
    }

    for (const frame of result.frames) {
      expect(Number(frame.frameDeltaMs)).toBeGreaterThan(0);
    }
    for (let index = 1; index < result.frames.length; index++) {
      expect(
        Math.abs(
          Number(result.frames[index].position) -
            Number(result.frames[index - 1].position),
        ),
      ).toBeGreaterThan(0.01);
    }

    if (scenario.expected === "dismiss-right") {
      expect(result.handoff?.direction).toBe(1);
      const releaseVelocity = Math.abs(Number(result.handoff?.releaseVelocity));
      if (releaseVelocity > 100) {
        const speedRatio =
          Math.abs(Number(result.frames[0].velocity)) / releaseVelocity;
        expect(speedRatio).toBeGreaterThan(0.55);
        expect(speedRatio).toBeLessThan(1.8);
      }
      expect(Number(result.frames[0].position)).toBeGreaterThan(
        Number(result.pointerup?.releasePosition),
      );
      expect(Number(result.frames[1].position)).toBeGreaterThan(
        Number(result.frames[0].position),
      );
      expect(Number(result.frames[2].position)).toBeGreaterThan(
        Number(result.frames[1].position),
      );
    } else {
      expect(result.handoff?.direction).toBe("return");
      expect(Number(result.handoff?.releaseVelocity)).toBeCloseTo(
        Number(result.pointerup?.releaseVelocity),
        5,
      );
    }

    const firstElapsedSeconds = Number(result.frames[0].elapsedMs) / 1_000;
    const secondElapsedSeconds =
      (Number(result.frames[1].elapsedMs) -
        Number(result.frames[0].elapsedMs)) /
      1_000;
    const firstSampledSpeed =
      Math.abs(
        Number(result.frames[0].position) -
          Number(result.handoff?.releasePosition),
      ) / Math.max(firstElapsedSeconds, 0.001);
    const secondSampledSpeed =
      Math.abs(
        Number(result.frames[1].position) -
          Number(result.frames[0].position),
      ) / Math.max(secondElapsedSeconds, 0.001);
    if (
      Math.abs(Number(result.handoff?.releaseVelocity)) > 100 &&
      firstSampledSpeed > 40
    ) {
      expect(secondSampledSpeed / firstSampledSpeed).toBeLessThan(2.5);
    }
  }
});
