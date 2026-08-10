import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceReleaseTimeline,
  boundedReleaseVelocity,
  decideSwipe,
  dismissalDuration,
  dismissalLaunchVelocity,
  estimateFrameInterval,
  estimatePointerVelocity,
  offscreenTarget,
  returnLaunchVelocity,
  releaseTimelineLead,
  sampleDismissTrajectory,
  sampleReturnTrajectory,
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

test("release timeline aligns a near-paint pointerup to one display frame", () => {
  const refreshInterval = estimateFrameInterval([16, 17, 16, 17, 16, 18]);
  const lead = releaseTimelineLead(2, refreshInterval);

  assert.equal(refreshInterval, 16.5);
  assert.equal(lead, 14.5);
});

test("release timeline caps progress after a delayed first callback", () => {
  const delayed = advanceReleaseTimeline(1000 / 60, 500, 1_600, 1000 / 60);
  assert.ok(delayed.elapsedMs < 0.06 * 1_000);
  assert.equal(delayed.lastExecutionAt, 1_600);

  const nextFrame = advanceReleaseTimeline(
    delayed.elapsedMs,
    delayed.lastExecutionAt,
    1_600 + 1000 / 60,
    1000 / 60,
  );
  assert.ok(nextFrame.elapsedMs > delayed.elapsedMs);
  assert.ok(nextFrame.elapsedMs < 0.08 * 1_000);
});

test("committed dismissal always launches outward perceptibly", () => {
  assert.equal(dismissalLaunchVelocity(0, 1), 1_200);
  assert.equal(dismissalLaunchVelocity(600, 1), 1_200);
  assert.equal(dismissalLaunchVelocity(-900, 1), 1_200);
  assert.equal(dismissalLaunchVelocity(-1_800, -1), -1_800);
});

test("rejected swipe launches immediately towards centre", () => {
  assert.equal(returnLaunchVelocity(5, 0), -220);
  assert.equal(returnLaunchVelocity(20, 600), -360);
  assert.equal(returnLaunchVelocity(-80, -600), 700);
  assert.equal(returnLaunchVelocity(80, -900), -900);
});

test("pointer regression estimates recent velocity independent of rAF", () => {
  const samples = [
    { position: 0, time: 940 },
    { position: 16, time: 956 },
    { position: 32, time: 972 },
    { position: 48, time: 988 },
    { position: 60, time: 1_000 },
  ];
  const velocity = estimatePointerVelocity(samples, 1_000);
  const shiftedVelocity = estimatePointerVelocity(
    samples.map((sample) => ({ ...sample, time: sample.time + 7 })),
    1_007,
  );
  assert.ok(Math.abs(velocity - 1_000) < 1);
  assert.ok(Math.abs(shiftedVelocity - velocity) < 0.001);
});

test("pointer regression decays to zero after a stationary hold", () => {
  assert.equal(
    estimatePointerVelocity(
      [
        { position: 0, time: 850 },
        { position: 70, time: 900 },
        { position: 70, time: 1_000 },
      ],
      1_000,
    ),
    0,
  );
});

test("dismissal duration remains bounded across distances and speeds", () => {
  assert.equal(dismissalDuration(100, 2_400), 0.18);
  assert.equal(dismissalDuration(300, 1_000), 0.3);
  assert.equal(dismissalDuration(1_000, 0), 0.32);
});

test("dismissal trajectory matches release velocity and offscreen target", () => {
  const start = sampleDismissTrajectory(120, 900, 860, 0, 0.32);
  const finish = sampleDismissTrajectory(120, 900, 860, 0.32, 0.32);

  assert.deepEqual(start, { position: 120, velocity: 900 });
  assert.deepEqual(finish, { position: 860, velocity: 0 });
});

test("dismissal frame displacement does not jump after release", () => {
  const first = sampleDismissTrajectory(120, 900, 860, 1 / 60, 0.32);
  const second = sampleDismissTrajectory(120, 900, 860, 2 / 60, 0.32);
  const firstDisplacement = first.position - 120;
  const secondDisplacement = second.position - first.position;

  assert.ok(firstDisplacement > 0);
  assert.ok(secondDisplacement / firstDisplacement < 2.5);
});

test("stationary release moves perceptibly on the first 120 Hz frame", () => {
  const dismissVelocity = dismissalLaunchVelocity(0, 1);
  const dismissDuration = dismissalDuration(380, dismissVelocity);
  const dismissed = sampleDismissTrajectory(
    120,
    dismissVelocity,
    500,
    1 / 120,
    dismissDuration,
  );
  const returnVelocity = returnLaunchVelocity(5, 0);
  const returned = sampleReturnTrajectory(5, returnVelocity, 1 / 120);

  assert.ok(dismissed.position - 120 > 1);
  assert.ok(5 - returned.position > 1);
});

test("phase-aligned dismissal avoids a tiny first visible frame", () => {
  const start = 328;
  const target = 983;
  const velocity = dismissalLaunchVelocity(0, 1);
  const duration = dismissalDuration(target - start, velocity);
  const refreshInterval = estimateFrameInterval([16, 17, 16, 17]);
  const lead = releaseTimelineLead(2, refreshInterval);
  const first = sampleDismissTrajectory(
    start,
    velocity,
    target,
    (2 + lead) / 1_000,
    duration,
  );
  const second = sampleDismissTrajectory(
    start,
    velocity,
    target,
    (18 + lead) / 1_000,
    duration,
  );
  const firstDisplacement = first.position - start;
  const secondDisplacement = second.position - first.position;

  assert.ok(firstDisplacement > 15);
  assert.ok(secondDisplacement / firstDisplacement < 2.5);
});

test("closed-form return preserves initial velocity and settles", () => {
  const start = sampleReturnTrajectory(80, 600, 0);
  const finish = sampleReturnTrajectory(80, 600, 0.8);

  assert.deepEqual(start, { position: 80, velocity: 600 });
  assert.ok(Math.abs(finish.position) < 0.01);
  assert.ok(Math.abs(finish.velocity) < 0.2);
});
