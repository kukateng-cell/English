export type CardMotionProbeEventType =
  | "gesture-start"
  | "pointerrawupdate"
  | "pointermove"
  | "duplicate-sample"
  | "pointerup-start"
  | "pointerup-end"
  | "release-start"
  | "raf"
  | "longtask";

export interface CardMotionProbeFrame {
  type: CardMotionProbeEventType;
  time: number;
  x?: number;
  velocity?: number;
  renderedVelocity?: number;
  mode?: string;
  frameGap?: number;
  duration?: number;
}

export interface CardMotionProbeReport {
  pointerupReceivedAt?: number;
  pointerupHandlerFinishedAt?: number;
  pointerupHandlerDuration?: number;
  releaseStartedAt?: number;
  firstReleaseRafAt?: number;
  firstReleaseRafDelay?: number;
  releasePosition?: number;
  sampledReleaseVelocity?: number;
  renderedReleaseVelocity?: number;
  firstFramePosition?: number;
  firstFrameVelocity?: number;
  secondFramePosition?: number;
  secondFrameVelocity?: number;
  maxRafGap: number;
  returnTurnDelay?: number;
  pointerRawUpdateCount: number;
  pointerMoveCount: number;
  duplicateSampleCount: number;
  longTasks: Array<{ time: number; duration: number }>;
}

export function summarizeCardMotionProbe(
  frames: CardMotionProbeFrame[],
): CardMotionProbeReport {
  const pointerupStart = frames.find((frame) => frame.type === "pointerup-start");
  const pointerupEnd = frames.find((frame) => frame.type === "pointerup-end");
  const releaseStart = frames.find((frame) => frame.type === "release-start");
  const releaseFrames = frames.filter((frame) => frame.type === "raf");
  const firstFrame = releaseFrames[0];
  const secondFrame = releaseFrames[1];
  const returnTurn =
    releaseStart?.mode === "return" && releaseStart.x !== undefined
      ? releaseFrames.find(
          (frame) =>
            frame.velocity !== undefined &&
            frame.velocity * releaseStart.x! < 0,
        )
      : undefined;

  return {
    pointerupReceivedAt: pointerupStart?.time,
    pointerupHandlerFinishedAt: pointerupEnd?.time,
    pointerupHandlerDuration:
      pointerupStart && pointerupEnd
        ? pointerupEnd.time - pointerupStart.time
        : undefined,
    releaseStartedAt: releaseStart?.time,
    firstReleaseRafAt: firstFrame?.time,
    firstReleaseRafDelay:
      releaseStart && firstFrame ? firstFrame.time - releaseStart.time : undefined,
    releasePosition: releaseStart?.x,
    sampledReleaseVelocity: pointerupEnd?.velocity,
    renderedReleaseVelocity: pointerupEnd?.renderedVelocity,
    firstFramePosition: firstFrame?.x,
    firstFrameVelocity: firstFrame?.velocity,
    secondFramePosition: secondFrame?.x,
    secondFrameVelocity: secondFrame?.velocity,
    maxRafGap: releaseFrames.reduce(
      (largest, frame) => Math.max(largest, frame.frameGap ?? 0),
      0,
    ),
    returnTurnDelay:
      releaseStart && returnTurn ? returnTurn.time - releaseStart.time : undefined,
    pointerRawUpdateCount: frames.filter(
      (frame) => frame.type === "pointerrawupdate",
    ).length,
    pointerMoveCount: frames.filter((frame) => frame.type === "pointermove").length,
    duplicateSampleCount: frames.filter(
      (frame) => frame.type === "duplicate-sample",
    ).length,
    longTasks: frames
      .filter(
        (frame): frame is CardMotionProbeFrame & { duration: number } =>
          frame.type === "longtask" && frame.duration !== undefined,
      )
      .map((frame) => ({ time: frame.time, duration: frame.duration })),
  };
}
