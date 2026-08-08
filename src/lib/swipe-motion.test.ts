import test from "node:test";
import assert from "node:assert/strict";
import {
  decideSwipe,
  hasClearedViewport,
  launchVelocity,
  offscreenTarget,
} from "./swipe-motion";

test("mouse swipe requires meaningful physical movement before velocity counts", () => {
  assert.equal(decideSwipe(12, 2_000, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(43, 2_000, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(44, 900, 416, "mouse").dismiss, true);
  assert.equal(decideSwipe(99, 0, 416, "mouse").dismiss, false);
  assert.equal(decideSwipe(100, 0, 416, "mouse").dismiss, true);
});

test("touch keeps a shorter intentional flick without accepting tiny jitter", () => {
  assert.equal(decideSwipe(20, 1_400, 360, "touch").dismiss, false);
  assert.equal(decideSwipe(24, 700, 360, "touch").dismiss, true);
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
