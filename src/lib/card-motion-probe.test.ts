import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeCardMotionProbe,
  type CardMotionProbeFrame,
} from "./card-motion-probe";

test("card motion probe summarizes release latency, motion, and input events", () => {
  const frames: CardMotionProbeFrame[] = [
    { type: "gesture-start", time: 90 },
    { type: "pointerrawupdate", time: 95, x: 10 },
    { type: "pointermove", time: 96, x: 10 },
    { type: "duplicate-sample", time: 96.2, x: 10 },
    { type: "pointerup-start", time: 100, x: 20 },
    {
      type: "release-start",
      time: 102,
      x: 20,
      velocity: -360,
      mode: "return",
    },
    {
      type: "pointerup-end",
      time: 103,
      x: 20,
      velocity: 0,
      renderedVelocity: 240,
    },
    {
      type: "raf",
      time: 116,
      x: 14,
      velocity: -400,
      mode: "return",
    },
    {
      type: "raf",
      time: 133,
      x: 8,
      velocity: -300,
      mode: "return",
      frameGap: 17,
    },
    { type: "longtask", time: 140, duration: 55 },
  ];

  assert.deepEqual(summarizeCardMotionProbe(frames), {
    pointerupReceivedAt: 100,
    pointerupHandlerFinishedAt: 103,
    pointerupHandlerDuration: 3,
    releaseStartedAt: 102,
    firstReleaseRafAt: 116,
    firstReleaseRafDelay: 14,
    releasePosition: 20,
    sampledReleaseVelocity: 0,
    renderedReleaseVelocity: 240,
    firstFramePosition: 14,
    firstFrameVelocity: -400,
    secondFramePosition: 8,
    secondFrameVelocity: -300,
    maxRafGap: 17,
    returnTurnDelay: 14,
    pointerRawUpdateCount: 1,
    pointerMoveCount: 1,
    duplicateSampleCount: 1,
    longTasks: [{ time: 140, duration: 55 }],
  });
});
