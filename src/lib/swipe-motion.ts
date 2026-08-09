export type SwipeDirection = -1 | 1;
export type SwipePointerType = "mouse" | "pen" | "touch";

const DISTANCE_RATIO = 0.28;
const MIN_DISTANCE = 104;
const MAX_DISTANCE = 144;
const MAX_PROJECTED_VELOCITY = 1_800;
const MAX_RELEASE_VELOCITY = 2_400;
const MIN_DISMISS_SPEED = 900;
const MAX_DISMISS_SPEED = 1_800;
const DISMISS_TARGET_SECONDS = 0.32;
const DRAG_VELOCITY_BLEND = 0.65;
const DRAG_VELOCITY_DECAY_RATE = 24;
const STATIONARY_GRACE_SECONDS = 1 / 60;
const POSITION_EPSILON = 0.01;
const OUTWARD_RETURN_VELOCITY_SCALE = 0.35;
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

export interface RenderedDragMotion extends SpringState {
  lastTime: number | null;
  stationarySeconds: number;
}

/**
 * Advance a one-dimensional damped spring with small bounded substeps. The
 * bounded integration keeps a delayed animation frame from destabilising the
 * spring. The same integrator is used for drag release, return, and flight so
 * all phases can share one motion owner.
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

/**
 * Keep inward return momentum intact, but shorten the outward coast before
 * the spring turns back towards the centre.
 */
export function returnSpringVelocity(position: number, releaseVelocity: number) {
  const velocity = boundedReleaseVelocity(releaseVelocity);
  if (!Number.isFinite(position)) return velocity;
  return position * velocity > 0
    ? velocity * OUTWARD_RETURN_VELOCITY_SCALE
    : velocity;
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

/**
 * Keep outward release velocity, but guarantee that a distance-dismissed card
 * has enough departure speed to leave in roughly one third of a second.
 */
export function dismissalVelocity(
  releaseVelocity: number,
  direction: SwipeDirection,
  remainingDistance: number,
) {
  const distance = Math.max(0, Math.abs(remainingDistance));
  if (distance === 0) return 0;
  const minimumSpeed = clamp(
    distance / DISMISS_TARGET_SECONDS,
    MIN_DISMISS_SPEED,
    MAX_DISMISS_SPEED,
  );
  const towardSpeed = Math.max(
    0,
    boundedReleaseVelocity(releaseVelocity) * direction,
  );
  return direction * Math.max(towardSpeed, minimumSpeed);
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
