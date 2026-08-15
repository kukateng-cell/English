"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { speakEnglish } from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";
import Icon from "@/components/ui/Icon";
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
  OFFSCREEN_MARGIN,
  type SwipeDirection,
  type SwipePointerSample,
  type SwipePointerType,
} from "@/lib/swipe-motion";

export interface WordCardMotionProbe {
  mode: "dismiss" | "return";
  reducedMotion: boolean;
  wallElapsedMs: number;
  estimatedRefreshIntervalMs: number;
  timelineLeadMs: number;
  releasePosition: number;
  releaseVelocity: number;
  releasePreviewApplied: boolean;
  releasePreviewAt: number | null;
  releasePreviewPosition: number | null;
  releasePreviewVelocity: number | null;
  firstFramePosition: number;
  firstFrameVelocity: number;
  frameCount: number;
  pointerupStartedAt: number | null;
  pointerupEndedAt: number | null;
  lastDragRafAt: number | null;
  firstReleaseRafAt: number | null;
  secondReleaseRafAt: number | null;
  thirdReleaseRafAt: number | null;
  lastDragPosition: number;
  secondFramePosition: number | null;
  thirdFramePosition: number | null;
  secondFrameVelocity: number | null;
  thirdFrameVelocity: number | null;
  firstReleaseRafDelayMs: number | null;
  firstReleaseRafSignedDeltaMs: number | null;
  firstReleaseRafExecutionAt: number | null;
  firstReleaseRafExecutionDelayMs: number | null;
  eventProcessingDurationMs: number | null;
  frameGapMs: number | null;
  longTaskDurationMs?: number;
  eventObserverDurationMs?: number;
}

export interface WordCardActionControls {
  disabled: boolean;
  onLeft: () => void;
  onRight: () => void;
}

interface WordCardProps {
  word: {
    term: string;
    phonetic?: string | null;
    level?: string | null;
    category?: string | null;
  };
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  children?: ReactNode;
  /** Optional answer face rendered inside the card's front/back flip. */
  cardBackContent?: ReactNode;
  /** Presentation hint shown on the front face before reveal. */
  cardHint?: ReactNode;
  /** Optional follow-up hint appended without replacing the primary hint. */
  cardHintSecondary?: ReactNode;
  /** Visual state of the presentation hint; V2 uses this for retrieval emphasis. */
  cardHintState?: "think" | "longPress";
  /** Keep the answer face visible after a presentation-only reveal. */
  isFlipped?: boolean;
  /** Activate the card body for reveal or another presentation-only action. */
  onCardTap?: () => void;
  /** Reveal the card after a stationary long press. */
  onCardLongPress?: () => void;
  /** Hold duration required by the stationary long-press interaction. */
  longPressDurationMs?: number;
  /** Disable horizontal dismissal while keeping a card-body tap available. */
  swipeEnabled?: boolean;
  /** Semantic labels used by swipe affordances; V1 keeps the legacy defaults. */
  swipeLeftLabel?: ReactNode;
  swipeRightLabel?: ReactNode;
  queueNote?: ReactNode;
  actionControllerRef?: { current: WordCardActionControls | null };
  disabled?: boolean;
  /** Show in-card swipe/self-rating affordances; external actions may still remain visible. */
  showInteractionHint?: boolean;
  /** Monotonic page generation; changes invalidate every in-flight gesture. */
  interactionEpoch?: number;
  /** Test-harness instrumentation; production callers leave this unset. */
  onMotionProbe?: (probe: WordCardMotionProbe) => void;
  /** A/B switch used only by the isolated motion harness. */
  timelineLeadEnabled?: boolean;
  /** Write the first absolute-time release pose in the pointerup task. */
  immediateReleasePoseEnabled?: boolean;
}

const SWIPE_LABEL_THRESHOLD = 76;
const BUTTON_LAUNCH_VELOCITY = 720;
const POINTER_SAMPLE_CAPACITY = 32;
const RETURN_MAX_SECONDS = 0.8;
const FRAME_CALIBRATION_FRAMES = 4;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const LONG_PRESS_INITIAL_PULSE_MS = 1_050;
const LONG_PRESS_FINAL_PULSE_MS = 260;

interface ActivePointerDrag {
  pointerId: number;
  captureGeneration: number;
  pointerType: SwipePointerType;
  startPointerX: number;
  startDragX: number;
  latestPointerX: number;
  cardWidth: number;
  geometry: CardGeometry;
  samples: SwipePointerSample[];
}

interface ActiveLongPress {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  durationMs: number;
  timerId: number;
  triggered: boolean;
}

interface CardGeometry {
  width: number;
  baseLeft: number;
  baseRight: number;
  viewportWidth: number;
}

type MotionMode = "idle" | "drag" | "dismiss" | "return";

interface MotionState {
  mode: MotionMode;
  generation: number;
  position: number;
  velocity: number;
  target: number;
  lastTime: number | null;
  stationarySeconds: number;
  releaseStartedAt: number | null;
  releaseStartPosition: number;
  releaseStartVelocity: number;
  releaseTimelineLeadMs: number | null;
  releaseTimelineOffsetMs: number | null;
  releaseElapsedMs: number;
  releaseLastExecutionAt: number;
  duration: number;
  direction: SwipeDirection | null;
  onComplete: (() => void) | null;
  probeEmitted: boolean;
  releaseFrameCount: number;
  releaseFrameTimes: number[];
  releaseFrameExecutionTimes: number[];
  releaseFramePositions: number[];
  releaseFrameVelocities: number[];
  lastDragRafAt: number | null;
  pointerupStartedAt: number | null;
  pointerupEndedAt: number | null;
  releasePreviewAt: number | null;
  releasePreviewPosition: number | null;
  releasePreviewVelocity: number | null;
  releasePreviewApplied: boolean;
}

function pointerTypeOf(pointerType: string): SwipePointerType {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}

type RefLike<T> = { current: T };

/** Ignore a drag rAF that was queued before the pointerup/release handoff. */
function requestMotionFrame(
  frameRef: RefLike<number | null>,
  motionRef: RefLike<MotionState>,
  tickRef: RefLike<(timestamp: number) => void>,
) {
  if (frameRef.current !== null) return;
  const scheduledGeneration = motionRef.current.generation;
  frameRef.current = requestAnimationFrame((timestamp) => {
    frameRef.current = null;
    if (motionRef.current.generation !== scheduledGeneration) {
      requestMotionFrame(frameRef, motionRef, tickRef);
      return;
    }
    tickRef.current(timestamp);
  });
}

function pointerSampleTime(
  event: Pick<PointerEvent, "timeStamp">,
  receivedAt: number,
  referenceTimeStamp: number,
) {
  const relativeTime = event.timeStamp - referenceTimeStamp;
  return Number.isFinite(relativeTime) && Math.abs(relativeTime) <= 1_000
    ? receivedAt + relativeTime
    : receivedAt;
}

function recordPointerSample(
  samples: SwipePointerSample[],
  position: number,
  time: number,
) {
  if (!Number.isFinite(position) || !Number.isFinite(time)) return;
  const previous = samples[samples.length - 1];
  if (
    previous &&
    previous.position === position &&
    time - previous.time >= 0 &&
    time - previous.time <= 4
  ) {
    return;
  }
  if (previous && previous.time === time) {
    time += 0.01;
  }
  samples.push({ position, time });
  if (samples.length > POINTER_SAMPLE_CAPACITY) samples.shift();
}

function cardRotation(position: number) {
  return Math.max(-10, Math.min(10, position / 30));
}

function cardTransform(position: number) {
  return `translate3d(${position}px, 0, 0) rotate(${cardRotation(position)}deg)`;
}

function leftLabelOpacity(position: number) {
  if (position <= -SWIPE_LABEL_THRESHOLD) return 1;
  if (position >= 0) return 0;
  return Math.abs(position) / SWIPE_LABEL_THRESHOLD;
}

function rightLabelOpacity(position: number) {
  if (position >= SWIPE_LABEL_THRESHOLD) return 1;
  if (position <= 0) return 0;
  return position / SWIPE_LABEL_THRESHOLD;
}

function writeDragFrame(
  card: HTMLElement,
  leftLabel: HTMLElement | null,
  rightLabel: HTMLElement | null,
  leftBadge: HTMLElement | null,
  rightBadge: HTMLElement | null,
  position: number,
) {
  card.style.transform = cardTransform(position);
  const leftOpacity = String(leftLabelOpacity(position));
  const rightOpacity = String(rightLabelOpacity(position));
  if (leftLabel) leftLabel.style.opacity = leftOpacity;
  if (rightLabel) rightLabel.style.opacity = rightOpacity;
  if (leftBadge) leftBadge.style.opacity = leftOpacity;
  if (rightBadge) rightBadge.style.opacity = rightOpacity;
}

function measureCardGeometry(
  card: HTMLElement,
  currentX: number,
  viewportWidth: number,
): CardGeometry {
  const rect = card.getBoundingClientRect();
  // The rect includes the drag layer's rotation. Reconstruct the unrotated
  // edges from the layout width so release never needs a forced layout read.
  const width = card.offsetWidth || rect.width;
  const centerX = (rect.left + rect.right) / 2;
  return {
    width,
    baseLeft: centerX - width / 2 - currentX,
    baseRight: centerX + width / 2 - currentX,
    viewportWidth,
  };
}

export default function WordCard({
  word,
  onSwipeLeft,
  onSwipeRight,
  children,
  cardBackContent,
  cardHint,
  cardHintSecondary,
  cardHintState,
  isFlipped = false,
  onCardTap,
  onCardLongPress,
  longPressDurationMs = 3_000,
  swipeEnabled = true,
  swipeLeftLabel,
  swipeRightLabel,
  queueNote,
  actionControllerRef,
  disabled,
  showInteractionHint = true,
  interactionEpoch = 0,
  onMotionProbe,
  timelineLeadEnabled = true,
  immediateReleasePoseEnabled = true,
}: WordCardProps) {
  const { tc } = useLocale();
  const dragLayerRef = useRef<HTMLDivElement>(null);
  const leftLabelRef = useRef<HTMLSpanElement>(null);
  const rightLabelRef = useRef<HTMLSpanElement>(null);
  const leftBadgeRef = useRef<HTMLSpanElement>(null);
  const rightBadgeRef = useRef<HTMLSpanElement>(null);
  const longPressIndicatorRef = useRef<HTMLSpanElement>(null);
  const geometryRef = useRef<CardGeometry | null>(null);
  const activeDragRef = useRef<ActivePointerDrag | null>(null);
  const activeLongPressRef = useRef<ActiveLongPress | null>(null);
  const longPressIndicatorFrameRef = useRef<number | null>(null);
  const [longPressIndicatorActive, setLongPressIndicatorActive] = useState(false);
  const captureGenerationRef = useRef(0);
  const activeCaptureGenerationRef = useRef<number | null>(null);
  const dragXRef = useRef(0);
  const motionFrameRef = useRef<number | null>(null);
  const motionTickRef = useRef<(timestamp: number) => void>(() => {});
  const previousMotionRafTimeRef = useRef<number | null>(null);
  const recentFrameIntervalsRef = useRef<number[]>([]);
  const frameCalibrationRemainingRef = useRef(0);
  const motionStateRef = useRef<MotionState>({
    mode: "idle",
    generation: 0,
    position: 0,
    velocity: 0,
    target: 0,
    lastTime: null,
    stationarySeconds: 0,
    releaseStartedAt: null,
    releaseStartPosition: 0,
    releaseStartVelocity: 0,
    releaseTimelineLeadMs: null,
    releaseTimelineOffsetMs: null,
    releaseElapsedMs: 0,
    releaseLastExecutionAt: 0,
    duration: 0,
    direction: null,
    onComplete: null,
    probeEmitted: false,
    releaseFrameCount: 0,
    releaseFrameTimes: [],
    releaseFrameExecutionTimes: [],
    releaseFramePositions: [],
    releaseFrameVelocities: [],
    lastDragRafAt: null,
    pointerupStartedAt: null,
    pointerupEndedAt: null,
    releasePreviewAt: null,
    releasePreviewPosition: null,
    releasePreviewVelocity: null,
    releasePreviewApplied: false,
  });
  const reducedMotionRef = useRef(false);
  const mountedRef = useRef(true);
  const dismissingRef = useRef(false);
  const interactionPropsRef = useRef({
    disabled,
    interactionEpoch,
    onSwipeLeft,
    onSwipeRight,
    onCardLongPress,
    longPressDurationMs,
    swipeEnabled,
    onMotionProbe,
    timelineLeadEnabled,
    immediateReleasePoseEnabled,
  });

  useEffect(() => {
    interactionPropsRef.current = {
      disabled,
      interactionEpoch,
      onSwipeLeft,
      onSwipeRight,
      onCardLongPress,
      longPressDurationMs,
      swipeEnabled,
      onMotionProbe,
      timelineLeadEnabled,
      immediateReleasePoseEnabled,
    };
  }, [
    disabled,
    interactionEpoch,
    onSwipeLeft,
    onSwipeRight,
    onCardLongPress,
    longPressDurationMs,
    swipeEnabled,
    onMotionProbe,
    timelineLeadEnabled,
    immediateReleasePoseEnabled,
  ]);

  const writeCurrentDragFrame = useCallback((position: number) => {
    const dragLayer = dragLayerRef.current;
    if (!dragLayer) return;
    dragXRef.current = position;
    motionStateRef.current.position = position;
    writeDragFrame(
      dragLayer,
      leftLabelRef.current,
      rightLabelRef.current,
      leftBadgeRef.current,
      rightBadgeRef.current,
      position,
    );
  }, []);

  const scheduleMotionFrame = useCallback(() => {
    requestMotionFrame(motionFrameRef, motionStateRef, motionTickRef);
  }, []);

  const cacheGeometry = useCallback((): CardGeometry | null => {
    const dragLayer = dragLayerRef.current;
    if (!dragLayer) return null;
    const geometry = measureCardGeometry(
      dragLayer,
      dragXRef.current,
      window.innerWidth,
    );
    geometryRef.current = geometry;
    return geometry;
  }, []);

  const completeReleaseMotion = useCallback(() => {
    const motion = motionStateRef.current;
    const onComplete = motion.onComplete;
    motion.mode = "idle";
    motion.velocity = 0;
    motion.lastTime = null;
    motion.stationarySeconds = 0;
    motion.releaseStartedAt = null;
    motion.releaseStartPosition = motion.position;
    motion.releaseStartVelocity = 0;
    motion.releaseTimelineLeadMs = null;
    motion.releaseTimelineOffsetMs = null;
    motion.releaseElapsedMs = 0;
    motion.releaseLastExecutionAt = 0;
    motion.duration = 0;
    motion.direction = null;
    motion.onComplete = null;
    if (onComplete && mountedRef.current) onComplete();
  }, []);

  const renderMotionFrame = useCallback(
    (timestamp: number) => {
      const motion = motionStateRef.current;
      const rafTimestamp = Number.isFinite(timestamp)
        ? timestamp
        : performance.now();
      const executionNow = performance.now();
      const now = motion.mode === "drag" ? rafTimestamp : executionNow;
      const previousRafTime = previousMotionRafTimeRef.current;
      if (previousRafTime !== null) {
        const interval = rafTimestamp - previousRafTime;
        if (interval >= 4 && interval <= 40) {
          recentFrameIntervalsRef.current.push(interval);
          if (recentFrameIntervalsRef.current.length > 8) {
            recentFrameIntervalsRef.current.shift();
          }
        }
      }
      previousMotionRafTimeRef.current = rafTimestamp;

      if (motion.mode === "idle") {
        if (frameCalibrationRemainingRef.current > 0) {
          frameCalibrationRemainingRef.current -= 1;
          scheduleMotionFrame();
        }
        return;
      }

      if (motion.mode === "drag") {
        const drag = activeDragRef.current;
        if (!drag) {
          motion.mode = "idle";
          motion.velocity = 0;
          motion.lastTime = null;
          motion.stationarySeconds = 0;
          return;
        }
        const position =
          drag.startDragX + drag.latestPointerX - drag.startPointerX;
        const next = updateRenderedDragMotion(
          {
            position: motion.position,
            velocity: motion.velocity,
            lastTime: motion.lastTime,
            stationarySeconds: motion.stationarySeconds,
          },
          position,
          now,
        );
        motion.position = next.position;
        motion.velocity = next.velocity;
        motion.lastTime = next.lastTime;
        motion.stationarySeconds = next.stationarySeconds;
        motion.lastDragRafAt = now;
        writeCurrentDragFrame(next.position);
        scheduleMotionFrame();
        return;
      }

      if (motion.mode !== "dismiss" && motion.mode !== "return") return;
      if (motion.releaseStartedAt === null) return;

      const emitProbe = (
        wallElapsedMs: number,
        refreshIntervalMs: number,
        timelineLeadMs: number,
        reducedMotion: boolean,
        force = false,
      ) => {
        motion.releaseFrameCount += 1;
        motion.releaseFrameTimes.push(rafTimestamp);
        motion.releaseFrameExecutionTimes.push(executionNow);
        motion.releaseFramePositions.push(motion.position);
        motion.releaseFrameVelocities.push(motion.velocity);
        const firstReleaseRafAt = motion.releaseFrameTimes[0] ?? null;
        const firstReleaseRafSignedDeltaMs =
          firstReleaseRafAt !== null && motion.pointerupEndedAt !== null
            ? firstReleaseRafAt - motion.pointerupEndedAt
            : null;
        const firstReleaseRafExecutionAt =
          motion.releaseFrameExecutionTimes[0] ?? null;
        const firstReleaseRafExecutionDelayMs =
          firstReleaseRafExecutionAt !== null && motion.pointerupEndedAt !== null
            ? firstReleaseRafExecutionAt - motion.pointerupEndedAt
            : null;
        const probe: WordCardMotionProbe = {
          mode: motion.mode === "dismiss" ? "dismiss" : "return",
          reducedMotion,
          wallElapsedMs,
          estimatedRefreshIntervalMs: refreshIntervalMs,
          timelineLeadMs,
          releasePosition: motion.releaseStartPosition,
          releaseVelocity: motion.releaseStartVelocity,
          releasePreviewApplied: motion.releasePreviewApplied,
          releasePreviewAt: motion.releasePreviewAt,
          releasePreviewPosition: motion.releasePreviewPosition,
          releasePreviewVelocity: motion.releasePreviewVelocity,
          firstFramePosition: motion.releaseFramePositions[0] ?? motion.position,
          firstFrameVelocity: motion.releaseFrameVelocities[0] ?? motion.velocity,
          frameCount: motion.releaseFrameCount,
          pointerupStartedAt: motion.pointerupStartedAt,
          pointerupEndedAt: motion.pointerupEndedAt,
          lastDragRafAt: motion.lastDragRafAt,
          firstReleaseRafAt,
          secondReleaseRafAt: motion.releaseFrameTimes[1] ?? null,
          thirdReleaseRafAt: motion.releaseFrameTimes[2] ?? null,
          lastDragPosition: motion.releaseStartPosition,
          secondFramePosition: motion.releaseFramePositions[1] ?? null,
          thirdFramePosition: motion.releaseFramePositions[2] ?? null,
          secondFrameVelocity: motion.releaseFrameVelocities[1] ?? null,
          thirdFrameVelocity: motion.releaseFrameVelocities[2] ?? null,
          firstReleaseRafDelayMs: firstReleaseRafSignedDeltaMs,
          firstReleaseRafSignedDeltaMs,
          firstReleaseRafExecutionAt,
          firstReleaseRafExecutionDelayMs,
          eventProcessingDurationMs:
            motion.pointerupStartedAt !== null && motion.pointerupEndedAt !== null
              ? Math.max(motion.pointerupEndedAt - motion.pointerupStartedAt, 0)
              : null,
          frameGapMs: firstReleaseRafSignedDeltaMs,
        };
        if (
          !motion.probeEmitted &&
          (force || motion.releaseFrameCount >= 3)
        ) {
          motion.probeEmitted = true;
          interactionPropsRef.current.onMotionProbe?.(probe);
        }
      };

      if (reducedMotionRef.current) {
        motion.position = motion.mode === "dismiss" ? motion.target : 0;
        motion.velocity = 0;
        emitProbe(
          Math.max(now - motion.releaseStartedAt, 0),
          estimateFrameInterval(recentFrameIntervalsRef.current),
          0,
          true,
          true,
        );
        writeCurrentDragFrame(motion.position);
        completeReleaseMotion();
        return;
      }

      const wallElapsedMs = Math.max(now - motion.releaseStartedAt, 0);
      const refreshIntervalMs = estimateFrameInterval(
        recentFrameIntervalsRef.current,
      );
      if (motion.releaseTimelineOffsetMs === null) {
        motion.releaseTimelineOffsetMs = interactionPropsRef.current
          .timelineLeadEnabled
          ? releaseTimelineLead(wallElapsedMs, refreshIntervalMs)
          : 0;
        motion.releaseTimelineLeadMs = motion.releaseTimelineOffsetMs;
        motion.releaseElapsedMs += motion.releaseTimelineOffsetMs;
      }
      const timeline = advanceReleaseTimeline(
        motion.releaseElapsedMs,
        motion.releaseLastExecutionAt,
        now,
        refreshIntervalMs,
      );
      motion.releaseElapsedMs = timeline.elapsedMs;
      motion.releaseLastExecutionAt = timeline.lastExecutionAt;
      const timelineElapsedMs = timeline.elapsedMs;
      const elapsedSeconds = timelineElapsedMs / 1_000;
      const next =
        motion.mode === "dismiss"
          ? sampleDismissTrajectory(
              motion.releaseStartPosition,
              motion.releaseStartVelocity,
              motion.target,
              elapsedSeconds,
              motion.duration,
            )
          : sampleReturnTrajectory(
              motion.releaseStartPosition,
              motion.releaseStartVelocity,
              elapsedSeconds,
            );
      motion.position = next.position;
      motion.velocity = next.velocity;
      motion.lastTime = now;
      const complete =
        motion.mode === "dismiss"
          ? elapsedSeconds >= motion.duration
          : (motion.releaseStartPosition > 0 && next.position <= 0) ||
            (motion.releaseStartPosition < 0 && next.position >= 0) ||
            (Math.abs(next.position) <= 0.5 &&
              Math.abs(next.velocity) <= 18) ||
            elapsedSeconds >= RETURN_MAX_SECONDS;
      emitProbe(
        wallElapsedMs,
        refreshIntervalMs,
        motion.releaseTimelineLeadMs ?? 0,
        false,
        complete,
      );
      writeCurrentDragFrame(next.position);

      if (complete) {
        motion.position = motion.mode === "dismiss" ? motion.target : 0;
        motion.velocity = 0;
        writeCurrentDragFrame(motion.position);
        completeReleaseMotion();
        return;
      }

      scheduleMotionFrame();
    },
    [completeReleaseMotion, scheduleMotionFrame, writeCurrentDragFrame],
  );

  const beginReleaseMotion = useCallback(
    (
      mode: "dismiss" | "return",
      target: number,
      velocity: number,
      duration: number,
      direction: SwipeDirection | null,
      onComplete: (() => void) | null,
    ) => {
      const motion = motionStateRef.current;
      const now = performance.now();
      if (motionFrameRef.current !== null) {
        cancelAnimationFrame(motionFrameRef.current);
        motionFrameRef.current = null;
      }
      motion.generation += 1;
      const releasePosition = motion.position;
      const releaseVelocity = boundedReleaseVelocity(velocity);
      motion.mode = mode;
      motion.target = target;
      motion.velocity = releaseVelocity;
      motion.releaseStartedAt = now;
      motion.releaseStartPosition = releasePosition;
      motion.releaseStartVelocity = releaseVelocity;
      motion.releaseTimelineLeadMs = null;
      motion.releaseTimelineOffsetMs = null;
      motion.releaseElapsedMs = 0;
      motion.releaseLastExecutionAt = now;
      motion.duration = duration;
      motion.lastTime = now;
      motion.direction = direction;
      motion.onComplete = onComplete;
      motion.stationarySeconds = 0;
      motion.probeEmitted = false;
      motion.releaseFrameCount = 0;
      motion.releaseFrameTimes = [];
      motion.releaseFrameExecutionTimes = [];
      motion.releaseFramePositions = [];
      motion.releaseFrameVelocities = [];
      motion.releasePreviewAt = null;
      motion.releasePreviewPosition = null;
      motion.releasePreviewVelocity = null;
      motion.releasePreviewApplied = false;
      if (
        interactionPropsRef.current.immediateReleasePoseEnabled &&
        !reducedMotionRef.current
      ) {
        const refreshIntervalMs = estimateFrameInterval(
          recentFrameIntervalsRef.current,
        );
        const preview =
          mode === "dismiss"
            ? sampleDismissTrajectory(
                releasePosition,
                releaseVelocity,
                target,
                refreshIntervalMs / 1_000,
                duration,
              )
            : sampleReturnTrajectory(
                releasePosition,
                releaseVelocity,
                refreshIntervalMs / 1_000,
              );
        motion.position = preview.position;
        motion.velocity = preview.velocity;
        // The synchronous preview is already one display interval into the
        // absolute trajectory. Keep the release clock at that same point so
        // a pending pre-pointerup rAF can never sample t=0 and rewind it.
        motion.releaseTimelineLeadMs = interactionPropsRef.current.timelineLeadEnabled
          ? refreshIntervalMs
          : 0;
        motion.releaseTimelineOffsetMs = refreshIntervalMs;
        motion.releaseElapsedMs = refreshIntervalMs;
        motion.releasePreviewAt = performance.now();
        motion.releasePreviewPosition = preview.position;
        motion.releasePreviewVelocity = preview.velocity;
        motion.releasePreviewApplied = true;
        writeCurrentDragFrame(preview.position);
      }
      scheduleMotionFrame();
    },
    [scheduleMotionFrame, writeCurrentDragFrame],
  );

  const returnToCentre = useCallback(
    () => {
      if (dismissingRef.current) return;
      const motion = motionStateRef.current;
      const position = motion.position;
      if (Math.abs(position) < 0.5) {
        const motion = motionStateRef.current;
        motion.generation += 1;
        motion.mode = "idle";
        motion.velocity = 0;
        motion.lastTime = null;
        motion.stationarySeconds = 0;
        motion.releaseStartedAt = null;
        motion.releaseStartPosition = 0;
        motion.releaseStartVelocity = 0;
        motion.releaseTimelineLeadMs = null;
        motion.releaseTimelineOffsetMs = null;
        motion.releaseElapsedMs = 0;
        motion.releaseLastExecutionAt = 0;
        motion.duration = 0;
        motion.direction = null;
        motion.onComplete = null;
        motion.probeEmitted = false;
        writeCurrentDragFrame(0);
        return;
      }

      beginReleaseMotion(
        "return",
        0,
        returnLaunchVelocity(position, motion.velocity),
        RETURN_MAX_SECONDS,
        null,
        null,
      );
    },
    [beginReleaseMotion, writeCurrentDragFrame],
  );

  const startFlight = useCallback(
    (
      direction: SwipeDirection,
      velocityX: number,
      callback: () => void,
      geometryOverride?: CardGeometry,
    ) => {
      const { disabled: isDisabled } = interactionPropsRef.current;
      if (isDisabled || dismissingRef.current) return;
      const dragLayer = dragLayerRef.current;
      if (!dragLayer) return;
      const geometry = geometryOverride ?? geometryRef.current ?? cacheGeometry();
      if (!geometry) return;

      dismissingRef.current = true;
      const currentX = motionStateRef.current.position;
      const targetX = offscreenTarget(
        direction,
        currentX,
        geometry.baseLeft + currentX,
        geometry.baseRight + currentX,
        geometry.viewportWidth,
        OFFSCREEN_MARGIN,
      );
      const remainingDistance = Math.abs(targetX - currentX);
      let committed = false;
      const startedEpoch = interactionPropsRef.current.interactionEpoch;

      const commit = () => {
        if (committed) return;
        committed = true;
        if (
          mountedRef.current &&
          !interactionPropsRef.current.disabled &&
          interactionPropsRef.current.interactionEpoch === startedEpoch
        ) {
          callback();
        }
      };

      if (remainingDistance <= 0) {
        commit();
        return;
      }

      const launchVelocity = dismissalLaunchVelocity(velocityX, direction);
      const duration = dismissalDuration(remainingDistance, launchVelocity);
      beginReleaseMotion(
        "dismiss",
        targetX,
        launchVelocity,
        duration,
        direction,
        commit,
      );
    },
    [beginReleaseMotion, cacheGeometry],
  );

  const handleButtonSwipe = useCallback(
    (direction: SwipeDirection, callback: () => void) => {
      startFlight(direction, direction * BUTTON_LAUNCH_VELOCITY, callback);
    },
    [startFlight],
  );

  const handleLeftAction = useCallback(() => {
    handleButtonSwipe(-1, onSwipeLeft);
  }, [handleButtonSwipe, onSwipeLeft]);

  const handleRightAction = useCallback(() => {
    handleButtonSwipe(1, onSwipeRight);
  }, [handleButtonSwipe, onSwipeRight]);

  useEffect(() => {
    if (!actionControllerRef) return;
    const controller: WordCardActionControls = {
      disabled: Boolean(disabled),
      onLeft: handleLeftAction,
      onRight: handleRightAction,
    };
    actionControllerRef.current = controller;
    return () => {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
      }
    };
  }, [actionControllerRef, disabled, handleLeftAction, handleRightAction]);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      if (disabled) return;
      if (
        (event.key === "Enter" || event.key === " ") &&
        (onCardLongPress || onCardTap) &&
        !swipeEnabled
      ) {
        event.preventDefault();
        (onCardLongPress ?? onCardTap)?.();
        return;
      }
      if (!swipeEnabled) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleLeftAction();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleRightAction();
      }
    },
    [disabled, handleLeftAction, handleRightAction, onCardLongPress, onCardTap, swipeEnabled],
  );

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || !onCardTap || swipeEnabled) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      onCardTap();
    },
    [disabled, onCardTap, swipeEnabled],
  );

  const clearLongPressIndicator = useCallback(() => {
    if (longPressIndicatorFrameRef.current !== null) {
      cancelAnimationFrame(longPressIndicatorFrameRef.current);
      longPressIndicatorFrameRef.current = null;
    }
    setLongPressIndicatorActive(false);
    const indicator = longPressIndicatorRef.current;
    if (!indicator) return;
    indicator.classList.remove("is-active");
    indicator.style.removeProperty("--word-card-hold-progress");
    indicator.style.removeProperty("--word-card-hold-pulse-duration");
    indicator.style.removeProperty("--word-card-hold-opacity");
    indicator.style.removeProperty("--word-card-hold-scale");
    indicator.style.removeProperty("left");
    indicator.style.removeProperty("top");
  }, []);

  const beginLongPressIndicator = useCallback(
    (startedAt: number, durationMs: number, clientX: number, clientY: number) => {
      const indicator = longPressIndicatorRef.current;
      const dragLayer = dragLayerRef.current;
      if (!indicator || !dragLayer) return;
      if (longPressIndicatorFrameRef.current !== null) {
        cancelAnimationFrame(longPressIndicatorFrameRef.current);
      }
      const prefersReducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const rect = dragLayer.getBoundingClientRect();
      indicator.style.left = `${clientX - rect.left}px`;
      indicator.style.top = `${clientY - rect.top}px`;
      indicator.style.setProperty("--word-card-hold-progress", "0");
      indicator.style.setProperty(
        "--word-card-hold-pulse-duration",
        `${LONG_PRESS_INITIAL_PULSE_MS}ms`,
      );
      indicator.style.setProperty("--word-card-hold-opacity", "0.16");
      indicator.style.setProperty(
        "--word-card-hold-scale",
        prefersReducedMotion ? "0.92" : "0.84",
      );
      setLongPressIndicatorActive(true);
      indicator.classList.add("is-active");

      const tick = (timestamp: number) => {
        const activeLongPress = activeLongPressRef.current;
        const activeIndicator = longPressIndicatorRef.current;
        if (
          !activeLongPress ||
          activeLongPress.startedAt !== startedAt ||
          activeLongPress.triggered ||
          !activeIndicator
        ) {
          longPressIndicatorFrameRef.current = null;
          return;
        }
        const progress = Math.min(
          Math.max((timestamp - activeLongPress.startedAt) / activeLongPress.durationMs, 0),
          1,
        );
        const pulseDuration =
          LONG_PRESS_INITIAL_PULSE_MS -
          (LONG_PRESS_INITIAL_PULSE_MS - LONG_PRESS_FINAL_PULSE_MS) * progress;
        activeIndicator.style.setProperty(
          "--word-card-hold-progress",
          progress.toFixed(3),
        );
        activeIndicator.style.setProperty(
          "--word-card-hold-pulse-duration",
          `${pulseDuration.toFixed(0)}ms`,
        );
        activeIndicator.style.setProperty(
          "--word-card-hold-opacity",
          (0.16 + progress * 0.22).toFixed(3),
        );
        activeIndicator.style.setProperty(
          "--word-card-hold-scale",
          (prefersReducedMotion ? 0.92 : 0.84 + progress * 0.12).toFixed(3),
        );
        if (progress >= 1) {
          longPressIndicatorFrameRef.current = null;
          return;
        }
        longPressIndicatorFrameRef.current = requestAnimationFrame(tick);
      };

      longPressIndicatorFrameRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  const clearActiveLongPress = useCallback((pointerId?: number) => {
    const activeLongPress = activeLongPressRef.current;
    if (!activeLongPress) return;
    window.clearTimeout(activeLongPress.timerId);
    activeLongPressRef.current = null;
    clearLongPressIndicator();
    const dragLayer = dragLayerRef.current;
    const capturedPointerId = pointerId ?? activeLongPress.pointerId;
    if (
      dragLayer?.hasPointerCapture(capturedPointerId)
    ) {
      dragLayer.releasePointerCapture(capturedPointerId);
    }
  }, [clearLongPressIndicator]);

  const cancelActiveInteraction = useCallback(() => {
    clearActiveLongPress();
    const dragLayer = dragLayerRef.current;
    const activeDrag = activeDragRef.current;
    activeDragRef.current = null;
    activeCaptureGenerationRef.current = null;
    captureGenerationRef.current += 1;
    if (
      dragLayer &&
      activeDrag &&
      dragLayer.hasPointerCapture(activeDrag.pointerId)
    ) {
      dragLayer.releasePointerCapture(activeDrag.pointerId);
    }
    if (motionFrameRef.current !== null) {
      cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    const motion = motionStateRef.current;
    motion.generation += 1;
    motion.mode = "idle";
    motion.position = 0;
    motion.velocity = 0;
    motion.target = 0;
    motion.lastTime = null;
    motion.stationarySeconds = 0;
    motion.releaseStartedAt = null;
    motion.releaseStartPosition = 0;
    motion.releaseStartVelocity = 0;
    motion.releaseTimelineLeadMs = null;
    motion.releaseTimelineOffsetMs = null;
    motion.releaseElapsedMs = 0;
    motion.releaseLastExecutionAt = 0;
    motion.duration = 0;
    motion.direction = null;
    motion.onComplete = null;
    motion.probeEmitted = false;
    dismissingRef.current = false;
    geometryRef.current = null;
    writeCurrentDragFrame(0);
  }, [clearActiveLongPress, writeCurrentDragFrame]);

  const previousInteractionEpochRef = useRef(interactionEpoch);
  useEffect(() => {
    const epochChanged = previousInteractionEpochRef.current !== interactionEpoch;
    previousInteractionEpochRef.current = interactionEpoch;
    if (disabled || epochChanged) cancelActiveInteraction();
  }, [disabled, interactionEpoch, cancelActiveInteraction]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reducedMotionRef.current = preference.matches;
    };
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const dragLayer = dragLayerRef.current;
    const motionState = motionStateRef.current;
    motionTickRef.current = renderMotionFrame;
    if (!dragLayer) return;

    const updateGeometry = () => {
      const geometry = measureCardGeometry(
        dragLayer,
        dragXRef.current,
        window.innerWidth,
      );
      geometryRef.current = geometry;
      if (activeDragRef.current) {
        activeDragRef.current.geometry = geometry;
        activeDragRef.current.cardWidth = geometry.width;
      }
    };

    writeCurrentDragFrame(0);
    updateGeometry();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateGeometry)
        : null;
    resizeObserver?.observe(dragLayer);
    const handleResize = () => {
      updateGeometry();
      previousMotionRafTimeRef.current = null;
      recentFrameIntervalsRef.current = [];
      frameCalibrationRemainingRef.current = FRAME_CALIBRATION_FRAMES;
      scheduleMotionFrame();
    };
    window.addEventListener("resize", handleResize);
    frameCalibrationRemainingRef.current = FRAME_CALIBRATION_FRAMES;
    scheduleMotionFrame();

    const handlePointerDown = (event: PointerEvent) => {
      const {
        disabled: isDisabled,
        onCardLongPress: longPressReveal,
        swipeEnabled: canSwipe,
      } = interactionPropsRef.current;
      if (
        isDisabled ||
        dismissingRef.current ||
        activeDragRef.current ||
        activeLongPressRef.current
      ) return;
      if (!canSwipe && !longPressReveal) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }

      if (!canSwipe && longPressReveal) {
        const durationMs = Math.max(interactionPropsRef.current.longPressDurationMs, 1);
        const startedAt = performance.now();
        const timerId = window.setTimeout(() => {
          const activeLongPress = activeLongPressRef.current;
          if (
            !activeLongPress ||
            activeLongPress.pointerId !== event.pointerId ||
            activeLongPress.triggered
          ) return;
          activeLongPress.triggered = true;
          clearLongPressIndicator();
          if (!interactionPropsRef.current.disabled) {
            interactionPropsRef.current.onCardLongPress?.();
          }
        }, durationMs);
        activeLongPressRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startedAt,
          durationMs,
          timerId,
          triggered: false,
        };
        beginLongPressIndicator(startedAt, durationMs, event.clientX, event.clientY);
        dragLayer.setPointerCapture(event.pointerId);
        if (event.cancelable) event.preventDefault();
        return;
      }

      const geometry = cacheGeometry();
      if (!geometry) return;
      const captureGeneration = captureGenerationRef.current + 1;
      captureGenerationRef.current = captureGeneration;
      const motion = motionStateRef.current;
      motion.generation += 1;
      motion.mode = "drag";
      motion.position = dragXRef.current;
      motion.velocity = 0;
      motion.target = motion.position;
      motion.lastTime = performance.now();
      motion.stationarySeconds = 0;
      motion.releaseStartedAt = null;
      motion.releaseStartPosition = motion.position;
      motion.releaseStartVelocity = 0;
      motion.releaseTimelineLeadMs = null;
      motion.releaseTimelineOffsetMs = null;
      motion.releaseElapsedMs = 0;
      motion.releaseLastExecutionAt = 0;
      motion.duration = 0;
      motion.direction = null;
      motion.onComplete = null;
      motion.probeEmitted = false;
      motion.pointerupStartedAt = null;
      motion.pointerupEndedAt = null;
      motion.releasePreviewAt = null;
      motion.releasePreviewPosition = null;
      motion.releasePreviewVelocity = null;
      motion.releasePreviewApplied = false;
      const samples: SwipePointerSample[] = [];
      const receivedAt = performance.now();
      recordPointerSample(
        samples,
        event.clientX,
        pointerSampleTime(event, receivedAt, event.timeStamp),
      );
      activeDragRef.current = {
        pointerId: event.pointerId,
        captureGeneration,
        pointerType: pointerTypeOf(event.pointerType),
        startPointerX: event.clientX,
        startDragX: dragXRef.current,
        latestPointerX: event.clientX,
        cardWidth: geometry.width,
        geometry,
        samples,
      };
      activeCaptureGenerationRef.current = captureGeneration;
      dragLayer.setPointerCapture(event.pointerId);
      event.preventDefault();
      scheduleMotionFrame();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const longPress = activeLongPressRef.current;
      if (longPress && longPress.pointerId === event.pointerId) {
        const movedX = event.clientX - longPress.startX;
        const movedY = event.clientY - longPress.startY;
        if (Math.hypot(movedX, movedY) > LONG_PRESS_MOVE_TOLERANCE) {
          clearActiveLongPress(event.pointerId);
        } else if (event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const coalescedEvents = event.getCoalescedEvents?.() ?? [];
      const coalesced = coalescedEvents.length > 0 ? coalescedEvents : [event];
      const latest = coalesced[coalesced.length - 1] ?? event;
      const receivedAt = performance.now();
      for (const sample of coalesced) {
        recordPointerSample(
          drag.samples,
          sample.clientX,
          pointerSampleTime(sample, receivedAt, event.timeStamp),
        );
      }
      drag.latestPointerX = latest.clientX;
      scheduleMotionFrame();
      if (event.cancelable) event.preventDefault();
    };

    const finishPointerDrag = (
      event: PointerEvent,
      cancelled: boolean,
    ) => {
      const longPress = activeLongPressRef.current;
      if (longPress && longPress.pointerId === event.pointerId) {
        clearActiveLongPress(event.pointerId);
        if (event.cancelable) event.preventDefault();
        return;
      }
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const motion = motionStateRef.current;
      motion.pointerupStartedAt = performance.now();
      const releaseTime = performance.now();
      const releaseSampleTime = releaseTime;
      if (!cancelled) {
        drag.latestPointerX = event.clientX;
        recordPointerSample(drag.samples, event.clientX, releaseSampleTime);
      }
      const velocitySampleTime = Math.max(
        releaseSampleTime,
        drag.samples[drag.samples.length - 1]?.time ?? releaseSampleTime,
      );
      const releaseX =
        drag.startDragX + drag.latestPointerX - drag.startPointerX;
      const releaseMotion = updateRenderedDragMotion(
        {
          position: motion.position,
          velocity: motion.velocity,
          lastTime: motion.lastTime,
          stationarySeconds: motion.stationarySeconds,
        },
        releaseX,
        releaseTime,
      );
      motion.position = releaseMotion.position;
      motion.velocity = releaseMotion.velocity;
      motion.lastTime = releaseMotion.lastTime;
      motion.stationarySeconds = releaseMotion.stationarySeconds;
      const sampledVelocity = cancelled
        ? releaseMotion.velocity
        : estimatePointerVelocity(drag.samples, velocitySampleTime);
      motion.velocity = sampledVelocity;
      writeCurrentDragFrame(releaseMotion.position);
      activeDragRef.current = null;
      if (activeCaptureGenerationRef.current === drag.captureGeneration) {
        activeCaptureGenerationRef.current = null;
      }
      if (cancelled) {
        returnToCentre();
        motion.pointerupEndedAt = performance.now();
        return;
      }

      const velocityX = sampledVelocity;
      const decision = decideSwipe(
        dragXRef.current,
        velocityX,
        drag.cardWidth,
        drag.pointerType,
      );
      if (!decision.dismiss) {
        returnToCentre();
        motion.pointerupEndedAt = performance.now();
        return;
      }
      const callback =
        decision.direction < 0
          ? interactionPropsRef.current.onSwipeLeft
          : interactionPropsRef.current.onSwipeRight;
      startFlight(decision.direction, velocityX, callback, drag.geometry);
      motion.pointerupEndedAt = performance.now();
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishPointerDrag(event, false);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      finishPointerDrag(event, true);
    };
    const handleLostPointerCapture = (event: PointerEvent) => {
      const longPress = activeLongPressRef.current;
      if (longPress && longPress.pointerId === event.pointerId) {
        clearActiveLongPress();
        return;
      }
      const drag = activeDragRef.current;
      if (
        !drag ||
        drag.pointerId !== event.pointerId ||
        drag.captureGeneration !== activeCaptureGenerationRef.current
      ) {
        return;
      }
      // A late lost-capture event from the previous gesture must not cancel a
      // new gesture that has already re-captured the same mouse pointer.
      if (dragLayer.hasPointerCapture(event.pointerId)) return;
      finishPointerDrag(event, true);
    };

    const moveEventName =
      "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";

    const listenerOptions = { passive: false };
    const moveListener = handlePointerMove as EventListener;
    dragLayer.addEventListener("pointerdown", handlePointerDown, listenerOptions);
    dragLayer.addEventListener(moveEventName, moveListener, listenerOptions);
    dragLayer.addEventListener("pointerup", handlePointerUp, listenerOptions);
    dragLayer.addEventListener("pointercancel", handlePointerCancel, listenerOptions);
    dragLayer.addEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
      listenerOptions,
    );

    return () => {
      mountedRef.current = false;
      clearActiveLongPress();
      if (motionFrameRef.current !== null) {
        cancelAnimationFrame(motionFrameRef.current);
        motionFrameRef.current = null;
      }
      previousMotionRafTimeRef.current = null;
      recentFrameIntervalsRef.current = [];
      frameCalibrationRemainingRef.current = 0;
      motionTickRef.current = () => {};
      motionState.mode = "idle";
      motionState.generation += 1;
      motionState.velocity = 0;
      motionState.lastTime = null;
      motionState.stationarySeconds = 0;
      motionState.releaseStartedAt = null;
      motionState.releaseStartPosition = motionState.position;
      motionState.releaseStartVelocity = 0;
      motionState.releaseTimelineLeadMs = null;
      motionState.releaseTimelineOffsetMs = null;
      motionState.releaseElapsedMs = 0;
      motionState.releaseLastExecutionAt = 0;
      motionState.duration = 0;
      motionState.direction = null;
      motionState.onComplete = null;
      motionState.probeEmitted = false;
      motionState.releaseFrameCount = 0;
      motionState.releaseFrameTimes = [];
      motionState.releaseFrameExecutionTimes = [];
      motionState.releaseFramePositions = [];
      motionState.releaseFrameVelocities = [];
      motionState.lastDragRafAt = null;
      motionState.pointerupStartedAt = null;
      motionState.pointerupEndedAt = null;
      motionState.releasePreviewAt = null;
      motionState.releasePreviewPosition = null;
      motionState.releasePreviewVelocity = null;
      motionState.releasePreviewApplied = false;
      activeCaptureGenerationRef.current = null;
      activeDragRef.current = null;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      dragLayer.removeEventListener("pointerdown", handlePointerDown);
      dragLayer.removeEventListener(moveEventName, moveListener);
      dragLayer.removeEventListener("pointerup", handlePointerUp);
      dragLayer.removeEventListener("pointercancel", handlePointerCancel);
      dragLayer.removeEventListener(
        "lostpointercapture",
        handleLostPointerCapture,
      );
    };
  }, [
    cacheGeometry,
    beginLongPressIndicator,
    clearActiveLongPress,
    clearLongPressIndicator,
    renderMotionFrame,
    returnToCentre,
    scheduleMotionFrame,
    startFlight,
    writeCurrentDragFrame,
  ]);

  const handleSpeak = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    speakEnglish(word.term);
  };

  const level = ["A1", "A2", "B1", "B2"].includes(word.level ?? "")
    ? word.level
    : null;
  const category = word.category?.trim() || null;
  const revealInteractionEnabled = Boolean((onCardTap || onCardLongPress) && !swipeEnabled);
  const revealLongPressEnabled = Boolean(onCardLongPress && !swipeEnabled);
  const resolvedCardHint = cardHint ?? tc("认得它的中文意思吗？");
  const hasSecondaryHint = cardHintSecondary !== undefined && cardHintSecondary !== null;
  const resolvedSwipeLeftLabel = swipeLeftLabel ?? tc("还不会");
  const resolvedSwipeRightLabel = swipeRightLabel ?? tc("我会");
  const cardHintClassName = revealLongPressEnabled
    ? `word-card-hint word-card-retrieval-hint ${cardHintState === "longPress" ? "is-long-press-hint" : "is-think-hint"}`
    : "word-card-hint";
  const secondaryHintClassName = revealLongPressEnabled
    ? "word-card-hint word-card-retrieval-hint is-long-press-hint"
    : "word-card-hint";
  const cardLabel = revealLongPressEnabled
    ? tc("单词卡，请长按 3 秒揭示答案")
    : revealInteractionEnabled
      ? tc("单词卡，请点击揭示中文意思")
      : isFlipped
        ? tc("已揭示的单词卡，右扫和刚才想的一样，左扫和刚才想的不一样")
        : tc("可左右拖曳的单词卡");

  const renderSpeakButton = (tabIndex: number) => (
    <button
      onClick={handleSpeak}
      tabIndex={tabIndex}
      className="word-card-speak"
      aria-label={tc("发音")}
    >
      <Icon name="volume" size={18} />
      <span>{tc("发音")}</span>
    </button>
  );

  const renderCardMeta = () => (
    <div className="word-card-top">
      {level ? <span data-testid="word-card-level" className="level-badge">{level} · {tc(category ?? "未分类")}</span> : null}
      <span
        data-testid="word-card-context"
        className="word-context"
        role="img"
        aria-label={tc("认读卡")}
      >
        {tc("认")}
      </span>
    </div>
  );

  return (
    <div className="word-card-frame select-none">
      {/* 背景提示文字 */}
      {showInteractionHint ? (
        <div aria-hidden="true" className="word-card-swipe-labels pointer-events-none absolute inset-0 flex items-center justify-between px-12">
          <span
            ref={leftLabelRef}
            style={{ opacity: 0 }}
            className="word-card-swipe-label word-card-swipe-label-danger"
          >
            <Icon name="arrow-left" size={14} /> {resolvedSwipeLeftLabel}
          </span>
          <span
            ref={rightLabelRef}
            style={{ opacity: 0 }}
            className="word-card-swipe-label word-card-swipe-label-success"
          >
            {resolvedSwipeRightLabel} <Icon name="arrow-right" size={14} />
          </span>
        </div>
      ) : null}

      <div data-testid="word-card-stack" className="word-card-stack">
        <div data-testid="word-card-back" className="word-card-back" aria-hidden="true" />
        <div
          data-testid="word-card-flight-layer"
          className="word-card-flight-layer relative z-10 w-full"
        >
          <div
            ref={dragLayerRef}
            data-testid="word-card-drag-layer"
            role={revealInteractionEnabled ? "button" : "group"}
            aria-label={cardLabel}
            aria-keyshortcuts={swipeEnabled ? "ArrowLeft ArrowRight" : undefined}
            aria-disabled={disabled || undefined}
            tabIndex={0}
            onClick={handleCardClick}
            onKeyDown={handleCardKeyDown}
            style={{ touchAction: swipeEnabled ? "pan-y" : revealLongPressEnabled ? "none" : "manipulation" }}
            className={`word-card-surface word-card-draggable${revealLongPressEnabled ? " is-long-press-to-reveal" : revealInteractionEnabled ? " is-tap-to-reveal" : ""}`}
          >
            {showInteractionHint ? (
              <>
                <span ref={leftBadgeRef} style={{ opacity: 0 }} className="word-card-drag-badge word-card-drag-badge-left" aria-hidden="true">
                  <Icon name="arrow-left" size={14} /> {resolvedSwipeLeftLabel}
                </span>
                <span ref={rightBadgeRef} style={{ opacity: 0 }} className="word-card-drag-badge word-card-drag-badge-right" aria-hidden="true">
                  {resolvedSwipeRightLabel} <Icon name="arrow-right" size={14} />
                </span>
              </>
            ) : null}

            {revealLongPressEnabled ? (
              <span
                ref={longPressIndicatorRef}
                data-testid="word-card-long-press-indicator"
                className={`word-card-long-press-indicator${longPressIndicatorActive ? " is-active" : ""}`}
                aria-hidden="true"
              />
            ) : null}

            <div
              data-testid="word-card-flip"
              data-flipped={isFlipped ? "true" : "false"}
              className={`word-card-flip${isFlipped ? " is-flipped" : ""}`}
            >
              <div data-testid="word-card-front" className="word-card-face word-card-face-front" aria-hidden={isFlipped}>
                {renderCardMeta()}
                <div className="word-card-center">
                  <h2 className="word-card-term">{word.term}</h2>
                  <p
                    data-testid="word-card-phonetic"
                    className={`word-card-phonetic word-card-phonetic-slot${word.phonetic ? "" : " is-empty"}`}
                    aria-hidden={word.phonetic ? undefined : true}
                  >
                    {word.phonetic ?? "\u00a0"}
                  </p>
                  <div data-testid="word-card-hints" aria-live="polite" className="word-card-hints">
                    <p data-testid="word-card-hint" className={cardHintClassName}>{resolvedCardHint}</p>
                  </div>
                  {renderSpeakButton(isFlipped ? -1 : 0)}
                  {hasSecondaryHint ? (
                    <div
                      data-testid="word-card-secondary-hint-slot"
                      aria-live="polite"
                      aria-hidden={!hasSecondaryHint}
                      className="word-card-secondary-hint-slot is-visible"
                    >
                      <p data-testid="word-card-secondary-hint" className={`${secondaryHintClassName} word-card-secondary-hint`}>{cardHintSecondary}</p>
                    </div>
                  ) : (
                    <div data-testid="word-card-secondary-hint-slot" aria-hidden="true" className="word-card-secondary-hint-slot" />
                  )}
                </div>
                <div className="word-card-bottom">
                  {queueNote ? <span data-testid="word-card-queue-note">{queueNote}</span> : null}
                </div>
              </div>

              {cardBackContent ? (
                <div data-testid="word-card-back-face" className="word-card-face word-card-face-back" aria-hidden={!isFlipped}>
                  {renderCardMeta()}
                  <div className="word-card-center word-card-answer-center">
                    <h2 className="word-card-term">{word.term}</h2>
                    <p
                      data-testid="word-card-phonetic"
                      className={`word-card-phonetic word-card-phonetic-slot${word.phonetic ? "" : " is-empty"}`}
                      aria-hidden={word.phonetic ? undefined : true}
                    >
                      {word.phonetic ?? "\u00a0"}
                    </p>
                    {renderSpeakButton(isFlipped ? 0 : -1)}
                    <div className="word-card-answer-content">{cardBackContent}</div>
                  </div>
                  <div className="word-card-bottom">
                    {queueNote ? <span data-testid="word-card-queue-note-back">{queueNote}</span> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
