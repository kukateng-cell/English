export type SwipeDirection = -1 | 1;
export type SwipePointerType = "mouse" | "pen" | "touch";

const DISTANCE_RATIO = 0.28;
const MIN_DISTANCE = 104;
const MAX_DISTANCE = 144;
const MAX_PROJECTED_VELOCITY = 1_800;
const MAX_RELEASE_VELOCITY = 2_400;
const DRAG_VELOCITY_BLEND = 0.65;
const DRAG_VELOCITY_DECAY_RATE = 24;
const STATIONARY_GRACE_SECONDS = 1 / 60;
const POSITION_EPSILON = 0.01;
const POINTER_VELOCITY_WINDOW_MS = 70;
const MIN_DISMISS_LAUNCH_SPEED = 1_200;
const MIN_RETURN_LAUNCH_SPEED = 220;
const MAX_RETURN_LAUNCH_SPEED = 700;
const RETURN_POSITION_SPEED_FACTOR = 18;
export const OFFSCREEN_MARGIN = 40;

export interface SpringState {
  position: number;
  velocity: number;
}

export interface RenderedDragMotion extends SpringState {
  lastTime: number | null;
  stationarySeconds: number;
}

export interface SwipePointerSample {
  position: number;
  time: number;
}

export interface SwipeDecision {
  dismiss: boolean;
  direction: SwipeDirection;
  projectedX: number;
  threshold: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Predict where the gesture is heading instead of treating distance and
 * velocity as unrelated thresholds. This lets a short flick dismiss while a
 * hesitant short drag returns to centre.
 */
export function decideSwipe(
  offsetX: number,
  velocityX: number,
  cardWidth: number,
  pointerType: SwipePointerType = "mouse",
): SwipeDecision {
  const safeWidth = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : 400;
  const threshold = clamp(safeWidth * DISTANCE_RATIO, MIN_DISTANCE, MAX_DISTANCE);
  const gesture =
    pointerType === "touch"
      ? { minimumOffset: 28, minimumVelocity: 650, projectionSeconds: 0.14 }
      : pointerType === "pen"
        ? { minimumOffset: 40, minimumVelocity: 750, projectionSeconds: 0.12 }
        : { minimumOffset: 72, minimumVelocity: 900, projectionSeconds: 0.1 };
  const projectedVelocity = clamp(
    velocityX,
    -MAX_PROJECTED_VELOCITY,
    MAX_PROJECTED_VELOCITY,
  );
  const projectedX = offsetX + projectedVelocity * gesture.projectionSeconds;
  const direction: SwipeDirection = projectedX < 0 ? -1 : 1;
  const dismissedByDistance = Math.abs(offsetX) >= threshold;
  const dismissedByFlick =
    Math.abs(offsetX) >= gesture.minimumOffset &&
    Math.abs(velocityX) >= gesture.minimumVelocity &&
    Math.abs(projectedX) >= threshold;

  return {
    dismiss: dismissedByDistance || dismissedByFlick,
    direction,
    projectedX,
    threshold,
  };
}

/** Return an x transform that puts the entire current card beyond the viewport. */
export function offscreenTarget(
  direction: SwipeDirection,
  currentX: number,
  cardLeft: number,
  cardRight: number,
  viewportWidth: number,
  margin = OFFSCREEN_MARGIN,
) {
  if (direction > 0) {
    return currentX + Math.max(0, viewportWidth + margin - cardLeft);
  }
  return currentX - Math.max(0, cardRight + margin);
}

export function boundedReleaseVelocity(velocityX: number) {
  if (!Number.isFinite(velocityX)) return 0;
  return clamp(velocityX, -MAX_RELEASE_VELOCITY, MAX_RELEASE_VELOCITY);
}

/** Start a committed dismissal moving outward even after a stationary hold. */
export function dismissalLaunchVelocity(
  releaseVelocity: number,
  direction: SwipeDirection,
) {
  const outwardSpeed = Math.max(
    0,
    boundedReleaseVelocity(releaseVelocity) * direction,
  );
  return direction * Math.max(outwardSpeed, MIN_DISMISS_LAUNCH_SPEED);
}

/**
 * A rejected swipe should react towards the centre immediately. Deliberately
 * replace stationary or outward momentum with a perceptible inward launch.
 */
export function returnLaunchVelocity(
  position: number,
  releaseVelocity: number,
) {
  if (!Number.isFinite(position) || Math.abs(position) < POSITION_EPSILON) {
    return 0;
  }
  const directionToCentre: SwipeDirection = position > 0 ? -1 : 1;
  const inwardSpeed = Math.max(
    0,
    boundedReleaseVelocity(releaseVelocity) * directionToCentre,
  );
  const minimumSpeed = clamp(
    Math.abs(position) * RETURN_POSITION_SPEED_FACTOR,
    MIN_RETURN_LAUNCH_SPEED,
    MAX_RETURN_LAUNCH_SPEED,
  );
  return directionToCentre * Math.max(inwardSpeed, minimumSpeed);
}

/**
 * Estimate pointer velocity from the most recent raw/coalesced samples. A
 * weighted linear regression is stable across rAF phases and naturally falls
 * to zero when the pointer has been stationary for longer than the window.
 */
export function estimatePointerVelocity(
  samples: SwipePointerSample[],
  releaseTime: number,
) {
  const recent = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.position) &&
        Number.isFinite(sample.time) &&
        sample.time <= releaseTime &&
        sample.time >= releaseTime - POINTER_VELOCITY_WINDOW_MS,
    )
    .sort((left, right) => left.time - right.time);
  if (recent.length < 2) return 0;

  const startTime = recent[0].time;
  const span = Math.max(releaseTime - startTime, 1);
  let weightTotal = 0;
  let meanTime = 0;
  let meanPosition = 0;
  for (const sample of recent) {
    const weight = 1 + (sample.time - startTime) / span;
    weightTotal += weight;
    meanTime += sample.time * weight;
    meanPosition += sample.position * weight;
  }
  meanTime /= weightTotal;
  meanPosition /= weightTotal;

  let covariance = 0;
  let variance = 0;
  for (const sample of recent) {
    const weight = 1 + (sample.time - startTime) / span;
    const timeDelta = sample.time - meanTime;
    covariance += weight * timeDelta * (sample.position - meanPosition);
    variance += weight * timeDelta * timeDelta;
  }
  if (variance <= 0) return 0;
  return boundedReleaseVelocity((covariance / variance) * 1_000);
}

/**
 * Update the velocity that was actually rendered by the card motion loop.
 * A long stationary interval strongly decays stale velocity, while regular
 * drag frames favour the newest measured movement.
 */
export function updateRenderedDragMotion(
  state: RenderedDragMotion,
  nextPosition: number,
  nowMs: number,
): RenderedDragMotion {
  const position = Number.isFinite(nextPosition)
    ? nextPosition
    : state.position;
  const now = Number.isFinite(nowMs) ? nowMs : state.lastTime;
  if (now === null || state.lastTime === null || now <= state.lastTime) {
    return {
      position,
      velocity: boundedReleaseVelocity(state.velocity),
      lastTime: now,
      stationarySeconds: state.stationarySeconds,
    };
  }

  const elapsedSeconds = (now - state.lastTime) / 1_000;
  const positionDelta = position - state.position;
  if (Math.abs(positionDelta) < POSITION_EPSILON) {
    const stationarySeconds = state.stationarySeconds + elapsedSeconds;
    const previousDecaySeconds = Math.max(
      0,
      state.stationarySeconds - STATIONARY_GRACE_SECONDS,
    );
    const decaySeconds =
      Math.max(0, stationarySeconds - STATIONARY_GRACE_SECONDS) -
      previousDecaySeconds;
    return {
      position,
      velocity: boundedReleaseVelocity(
        state.velocity * Math.exp(-decaySeconds * DRAG_VELOCITY_DECAY_RATE),
      ),
      lastTime: now,
      stationarySeconds,
    };
  }

  const measuredVelocity = boundedReleaseVelocity(
    positionDelta / elapsedSeconds,
  );
  const blend = Math.max(
    DRAG_VELOCITY_BLEND,
    1 - Math.exp(-elapsedSeconds * DRAG_VELOCITY_DECAY_RATE),
  );

  return {
    position,
    velocity: boundedReleaseVelocity(
      state.velocity * (1 - blend) + measuredVelocity * blend,
    ),
    lastTime: now,
    stationarySeconds: 0,
  };
}

export function dismissalDuration(distance: number, releaseVelocity: number) {
  const safeDistance = Math.max(0, Math.abs(distance));
  const speed = Math.max(Math.abs(boundedReleaseVelocity(releaseVelocity)), 1_000);
  return clamp(safeDistance / speed, 0.18, 0.32);
}

/**
 * Cubic Hermite dismissal with exact start position/velocity and a zero-speed
 * offscreen endpoint. Sampling by absolute elapsed time makes delayed frames
 * catch up instead of slowing the whole animation.
 */
export function sampleDismissTrajectory(
  startPosition: number,
  startVelocity: number,
  target: number,
  elapsedSeconds: number,
  durationSeconds: number,
): SpringState {
  const duration = Math.max(durationSeconds, 0.001);
  const progress = clamp(elapsedSeconds / duration, 0, 1);
  const progress2 = progress * progress;
  const progress3 = progress2 * progress;
  const h00 = 2 * progress3 - 3 * progress2 + 1;
  const h10 = progress3 - 2 * progress2 + progress;
  const h01 = -2 * progress3 + 3 * progress2;
  const velocity = boundedReleaseVelocity(startVelocity);
  const position =
    h00 * startPosition + h10 * velocity * duration + h01 * target;

  const dh00 = 6 * progress2 - 6 * progress;
  const dh10 = 3 * progress2 - 4 * progress + 1;
  const dh01 = -6 * progress2 + 6 * progress;
  const sampledVelocity =
    (dh00 * startPosition +
      dh10 * velocity * duration +
      dh01 * target) /
    duration;
  return {
    position: progress >= 1 ? target : position,
    velocity: progress >= 1 ? 0 : sampledVelocity,
  };
}

/** Closed-form critically damped spring returning to zero. */
export function sampleReturnTrajectory(
  startPosition: number,
  startVelocity: number,
  elapsedSeconds: number,
  omega = 20,
): SpringState {
  const elapsed = Math.max(elapsedSeconds, 0);
  const safeOmega = Math.max(omega, 0.001);
  const velocity = boundedReleaseVelocity(startVelocity);
  const coefficient = velocity + safeOmega * startPosition;
  const decay = Math.exp(-safeOmega * elapsed);
  const position = (startPosition + coefficient * elapsed) * decay;
  const sampledVelocity =
    (coefficient -
      safeOmega * (startPosition + coefficient * elapsed)) *
    decay;
  return { position, velocity: sampledVelocity };
}
