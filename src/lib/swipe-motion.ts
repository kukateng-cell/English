export type SwipeDirection = -1 | 1;
export type SwipePointerType = "mouse" | "pen" | "touch";

export interface SwipePointerSample {
  position: number;
  time: number;
}

const DISTANCE_RATIO = 0.28;
const MIN_DISTANCE = 104;
const MAX_DISTANCE = 144;
const MAX_PROJECTED_VELOCITY = 1_800;
const MAX_RELEASE_VELOCITY = 2_400;
const VELOCITY_WINDOW_MS = 100;
export const OFFSCREEN_MARGIN = 40;
export const VISUAL_COMPLETION_SLACK = 12;

export interface SpringState {
  position: number;
  velocity: number;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/**
 * Advance a one-dimensional damped spring with small bounded substeps. The
 * bounded integration keeps a delayed fallback frame from destabilising the
 * spring. Release trajectories are sampled before they are handed to WAAPI,
 * so the main-thread clamp is never used to drive the visible flight.
 */
export function advanceSpring(
  state: SpringState,
  target: number,
  deltaSeconds: number,
  config: SpringConfig,
): SpringState {
  const elapsed = Math.min(Math.max(deltaSeconds, 0), 0.064);
  const substeps = Math.max(1, Math.ceil(elapsed / 0.008));
  const step = elapsed / substeps;
  let position = state.position;
  let velocity = state.velocity;

  for (let index = 0; index < substeps; index++) {
    const acceleration =
      ((target - position) * config.stiffness - velocity * config.damping) /
      config.mass;
    velocity += acceleration * step;
    position += velocity * step;
  }

  return { position, velocity };
}

const TRAJECTORY_STEP_SECONDS = 1 / 120;
const TRAJECTORY_MAX_SECONDS = 1.2;
const MIN_RELEASE_SPEED = 1_200;

/**
 * Sample a spring into deterministic keyframe positions. This is deliberately
 * an offline calculation: the returned points can be handed to a compositor
 * animation instead of asking the main thread to integrate every release
 * frame.
 */
export function sampleSpringTrajectory(
  initialState: SpringState,
  target: number,
  config: SpringConfig,
  restSpeed: number,
  restDelta: number,
  options: {
    stepSeconds?: number;
    maxSeconds?: number;
    monotonicDirection?: SwipeDirection;
  } = {},
) {
  const stepSeconds = Math.min(
    Math.max(options.stepSeconds ?? TRAJECTORY_STEP_SECONDS, 1 / 240),
    0.064,
  );
  const maxSteps = Math.max(
    1,
    Math.ceil(
      Math.min(options.maxSeconds ?? TRAJECTORY_MAX_SECONDS, 2) /
        stepSeconds,
    ),
  );
  const samples: SpringState[] = [{ ...initialState }];
  let state = { ...initialState };

  for (let index = 0; index < maxSteps; index++) {
    let next = advanceSpring(state, target, stepSeconds, config);
    if (options.monotonicDirection) {
      if (options.monotonicDirection > 0) {
        next = {
          ...next,
          position: Math.max(next.position, state.position),
        };
      } else {
        next = {
          ...next,
          position: Math.min(next.position, state.position),
        };
      }
    }

    const reachedTarget =
      options.monotonicDirection === 1
        ? next.position >= target
        : options.monotonicDirection === -1
          ? next.position <= target
          : springSettled(next, target, restSpeed, restDelta);
    if (reachedTarget || springSettled(next, target, restSpeed, restDelta)) {
      samples.push({ position: target, velocity: 0 });
      return samples;
    }

    samples.push(next);
    state = next;
  }

  samples.push({ position: target, velocity: 0 });
  return samples;
}

/**
 * Build a one-direction dismissal path. A stationary release still receives
 * a minimum departure velocity, so crossing the swipe threshold and pausing
 * cannot leave the card visually parked before it starts its flight.
 */
export function sampleDismissalTrajectory(
  distance: number,
  releaseVelocity: number,
  config: SpringConfig,
) {
  const safeDistance = Math.max(0, Math.abs(distance));
  if (safeDistance === 0) return [{ position: 0, velocity: 0 }];
  const initialVelocity = Math.max(MIN_RELEASE_SPEED, Math.abs(releaseVelocity));
  return sampleSpringTrajectory(
    { position: 0, velocity: initialVelocity },
    safeDistance,
    config,
    80,
    6,
    { monotonicDirection: 1 },
  );
}

export function springSettled(
  state: SpringState,
  target: number,
  restSpeed: number,
  restDelta: number,
) {
  return (
    Math.abs(state.velocity) <= restSpeed &&
    Math.abs(target - state.position) <= restDelta
  );
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

/**
 * Estimate release velocity from only the final part of a pointer gesture.
 * Including the release sample means that holding the card still before
 * letting go naturally reduces the launch velocity to zero.
 */
export function estimateSwipeVelocity(
  samples: SwipePointerSample[],
  releaseTime: number,
) {
  const recent = samples.filter(
    (sample) =>
      Number.isFinite(sample.position) &&
      Number.isFinite(sample.time) &&
      releaseTime - sample.time >= 0 &&
      releaseTime - sample.time <= VELOCITY_WINDOW_MS,
  );
  if (recent.length < 2) return 0;

  const first = recent[0];
  const last = recent[recent.length - 1];
  const elapsed = last.time - first.time;
  if (elapsed <= 0) return 0;
  return ((last.position - first.position) / elapsed) * 1_000;
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

/**
 * Preserve release velocity only when it points towards the chosen edge.
 * Opposing velocity would create the small backwards hitch we are avoiding.
 */
export function launchVelocity(
  velocityX: number,
  direction: SwipeDirection,
) {
  const directionalSpeed = clamp(
    velocityX * direction,
    0,
    MAX_RELEASE_VELOCITY,
  );
  return directionalSpeed * direction;
}

/**
 * Springs approach their target asymptotically. Resolve once the card has
 * crossed the still-offscreen visual threshold instead of waiting for an
 * invisible mathematical tail.
 */
export function hasClearedViewport(
  direction: SwipeDirection,
  currentX: number,
  targetX: number,
  slack = VISUAL_COMPLETION_SLACK,
) {
  return direction > 0
    ? currentX >= targetX - slack
    : currentX <= targetX + slack;
}
