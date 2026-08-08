import test from "node:test";
import assert from "node:assert/strict";
import {
  decideSwipe,
  hasClearedViewport,
  launchVelocity,
  offscreenTarget,
} from "./swipe-motion";

test("swipe projection accepts a short fast flick but rejects a hesitant drag", () => {
  assert.equal(decideSwipe(32, 520, 400).dismiss, true);
  assert.equal(decideSwipe(58, 40, 400).dismiss, false);
});

test("swipe direction follows the projected release path", () => {
  assert.equal(decideSwipe(100, -1_500, 400).direction, -1);
  assert.equal(decideSwipe(-100, 1_500, 400).direction, 1);
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
