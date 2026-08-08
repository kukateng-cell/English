export type SwipeDirection = -1 | 1;

const PROJECTION_SECONDS = 0.16;
const DISTANCE_RATIO = 0.22;
const MIN_DISTANCE = 72;
const MAX_DISTANCE = 112;
const MAX_RELEASE_VELOCITY = 2_400;
export const OFFSCREEN_MARGIN = 40;
export const VISUAL_COMPLETION_SLACK = 12;

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
): SwipeDecision {
  const safeWidth = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : 400;
  const threshold = clamp(safeWidth * DISTANCE_RATIO, MIN_DISTANCE, MAX_DISTANCE);
  const projectedX = offsetX + velocityX * PROJECTION_SECONDS;
  const direction: SwipeDirection = projectedX < 0 ? -1 : 1;

  return {
    dismiss: Math.abs(projectedX) >= threshold,
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
