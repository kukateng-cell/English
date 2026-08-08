import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceSpring,
  decideSwipe,
  estimateSwipeVelocity,
  hasClearedViewport,
  launchVelocity,
  offscreenTarget,
  sampleDismissalTrajectory,
  springSettled,
} from "./swipe-motion";

test("mouse swipe requires meaningful physical movement before velocity counts", () => {
  assert.equal(decideSwipe(12, 2_000, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(71, 2_000, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(72, 900, 416, "mouse").dismiss, true);
  assert.equal(decideSwipe(116, 0, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(117, 0, 416, "mouse").dismiss, true);
});

test("touch keeps a shorter intentional flick without accepting tiny jitter", () => {
  assert.equal(decideSwipe(27, 1_400, 360, "touch").dismiss, false);
  assert.equal(decideSwipe(28, 700, 360, "touch").dismiss, true);
});

test("release velocity uses recent pointer movement and decays after a hold", () => {
  assert.equal(
    Math.round(
      estimateSwipeVelocity(
        [
          { position: 10, time: 920 },
          { position: 40, time: 960 },
          { position: 70, time: 1_000 },
        ],
        1_000,
      ),
    ),
    750,
  );
  assert.equal(
    estimateSwipeVelocity(
      [
        { position: 10, time: 800 },
        { position: 70, time: 850 },
        { position: 70, time: 1_000 },
      ],
      1_000,
    ),
    0,
  );
});

test("swipe direction follows the projected release path", () => {
  assert.equal(decideSwipe(100, -1_500, 400, "mouse").direction, -1);
  assert.equal(decideSwipe(-100, 1_500, 400, "mouse").direction, 1);
});

test("offscreen targets move the whole card beyond either viewport edge", () => {
  assert.equal(offscreenTarget(1, 120, 500, 900, 1_200), 860);
  assert.equal(offscreenTarget(-1, -120, 300, 700, 1_200), -860);
});

test("launch velocity preserves only velocity aimed at the chosen edge", () => {
  assert.equal(launchVelocity(900, 1), 900);
  assert.equal(launchVelocity(-900, 1), 0);
  assert.equal(launchVelocity(-9_000, -1), -2_400);
});

test("visual completion resolves near the offscreen target on both sides", () => {
  assert.equal(hasClearedViewport(1, 787, 800), false);
  assert.equal(hasClearedViewport(1, 788, 800), true);
  assert.equal(hasClearedViewport(-1, -787, -800), false);
  assert.equal(hasClearedViewport(-1, -788, -800), true);
});

test("dismissal trajectory starts immediately and stays monotonic", () => {
  const positions = sampleDismissalTrajectory(
    740,
    0,
    { stiffness: 260, damping: 30, mass: 0.75 },
  ).map((state) => state.position);

  assert.ok(positions.length > 2);
  assert.ok(positions[1] > positions[0]);
  assert.equal(positions.at(-1), 740);
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index] >= positions[index - 1]);
  }
});

test("offline spring sampling reaches its exact target", () => {
  const target = 860;
  let state = { position: 120, velocity: 0 };
  for (let index = 0; index < 180; index++) {
    state = advanceSpring(
      state,
      target,
      1 / 60,
      { stiffness: 260, damping: 30, mass: 0.75 },
    );
  }

  assert.equal(springSettled(state, target, 80, 6), true);
  assert.ok(Math.abs(state.position - target) <= 6);
});
