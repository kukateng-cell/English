import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceSpring,
  boundedReleaseVelocity,
  decideSwipe,
  dismissalVelocity,
  hasClearedViewport,
  offscreenTarget,
  returnSpringVelocity,
  springSettled,
  updateRenderedDragMotion,
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

test("rendered drag frames maintain visual velocity across frames", () => {
  const first = updateRenderedDragMotion(
    { position: 0, velocity: 0, lastTime: 0, stationarySeconds: 0 },
    16,
    16,
  );
  const second = updateRenderedDragMotion(first, 32, 32);

  assert.equal(Math.round(first.velocity), 650);
  assert.equal(Math.round(second.velocity), 878);
  assert.ok(second.velocity > first.velocity);
});

test("holding a rendered drag position decays stale velocity", () => {
  const held = updateRenderedDragMotion(
    {
      position: 120,
      velocity: 1_200,
      lastTime: 1_000,
      stationarySeconds: 0,
    },
    120,
    1_100,
  );

  assert.ok(held.velocity > 0);
  assert.ok(held.velocity < 200);
});

test("repeated stationary frames consume one shared grace period", () => {
  const first = updateRenderedDragMotion(
    {
      position: 120,
      velocity: 1_200,
      lastTime: 1_000,
      stationarySeconds: 0,
    },
    120,
    1_010,
  );
  const second = updateRenderedDragMotion(first, 120, 1_020);
  const third = updateRenderedDragMotion(second, 120, 1_030);

  assert.equal(first.velocity, 1_200);
  assert.ok(second.velocity < first.velocity);
  assert.ok(third.velocity < second.velocity);
});

test("a delayed rendered frame does not inflate visual velocity", () => {
  const delayed = updateRenderedDragMotion(
    { position: 0, velocity: 0, lastTime: 0, stationarySeconds: 0 },
    28,
    100,
  );

  assert.ok(delayed.velocity > 200);
  assert.ok(delayed.velocity <= 280);
  assert.equal(decideSwipe(28, delayed.velocity, 360, "touch").dismiss, false);
});

test("a continuously rendered hold does not hide a late flick", () => {
  const held = updateRenderedDragMotion(
    { position: 0, velocity: 800, lastTime: 0, stationarySeconds: 0 },
    0,
    1_000,
  );
  const released = updateRenderedDragMotion(held, 28, 1_011);

  assert.ok(held.velocity < 1);
  assert.ok(released.velocity >= 1_500);
  assert.equal(decideSwipe(28, released.velocity, 360, "touch").dismiss, true);
});

test("an immediate pointerup preserves the last rendered velocity", () => {
  const released = updateRenderedDragMotion(
    {
      position: 100,
      velocity: 1_200,
      lastTime: 1_000,
      stationarySeconds: 0,
    },
    100,
    1_011,
  );

  assert.equal(released.velocity, 1_200);
});

test("swipe direction follows the projected release path", () => {
  assert.equal(decideSwipe(100, -1_500, 400, "mouse").direction, -1);
  assert.equal(decideSwipe(-100, 1_500, 400, "mouse").direction, 1);
});

test("offscreen targets move the whole card beyond either viewport edge", () => {
  assert.equal(offscreenTarget(1, 120, 500, 900, 1_200), 860);
  assert.equal(offscreenTarget(-1, -120, 300, 700, 1_200), -860);
});

test("release velocity keeps its direction while remaining bounded", () => {
  assert.equal(boundedReleaseVelocity(480), 480);
  assert.equal(boundedReleaseVelocity(-480), -480);
  assert.equal(boundedReleaseVelocity(9_000), 2_400);
  assert.equal(boundedReleaseVelocity(-9_000), -2_400);
});

test("return spring attenuates only outward release velocity", () => {
  assert.equal(returnSpringVelocity(120, 480), 168);
  assert.equal(returnSpringVelocity(-120, -480), -168);
  assert.equal(returnSpringVelocity(120, -480), -480);
  assert.equal(returnSpringVelocity(-120, 480), 480);
  assert.equal(returnSpringVelocity(120, 9_000), 840);
});

test("dismissal adds a distance-aware minimum departure speed", () => {
  assert.equal(dismissalVelocity(0, 1, 320), 1_000);
  assert.equal(dismissalVelocity(0, -1, 320), -1_000);
  assert.equal(dismissalVelocity(-500, 1, 320), 1_000);
  assert.equal(dismissalVelocity(1_500, 1, 320), 1_500);
  assert.equal(dismissalVelocity(0, 1, 1_000), 1_800);
});

test("visual completion resolves near the offscreen target on both sides", () => {
  assert.equal(hasClearedViewport(1, 787, 800), false);
  assert.equal(hasClearedViewport(1, 788, 800), true);
  assert.equal(hasClearedViewport(-1, -787, -800), false);
  assert.equal(hasClearedViewport(-1, -788, -800), true);
});

test("runtime spring integration reaches its target", () => {
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
