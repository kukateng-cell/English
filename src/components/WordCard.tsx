"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { speakEnglish } from "@/lib/speech";
import { useLocale } from "@/components/LocaleProvider";
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

interface WordCardProps {
  word: { term: string; phonetic?: string | null };
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  children?: ReactNode;
  disabled?: boolean;
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
  position: number,
) {
  card.style.transform = cardTransform(position);
  if (leftLabel) leftLabel.style.opacity = String(leftLabelOpacity(position));
  if (rightLabel) rightLabel.style.opacity = String(rightLabelOpacity(position));
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
  disabled,
  onMotionProbe,
  timelineLeadEnabled = true,
  immediateReleasePoseEnabled = true,
}: WordCardProps) {
  const { tc } = useLocale();
  const dragLayerRef = useRef<HTMLDivElement>(null);
  const leftLabelRef = useRef<HTMLSpanElement>(null);
  const rightLabelRef = useRef<HTMLSpanElement>(null);
  const geometryRef = useRef<CardGeometry | null>(null);
  const activeDragRef = useRef<ActivePointerDrag | null>(null);
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
    onSwipeLeft,
    onSwipeRight,
    onMotionProbe,
    timelineLeadEnabled,
    immediateReleasePoseEnabled,
  });

  useEffect(() => {
    interactionPropsRef.current = {
      disabled,
      onSwipeLeft,
      onSwipeRight,
      onMotionProbe,
      timelineLeadEnabled,
      immediateReleasePoseEnabled,
    };
  }, [
    disabled,
    onSwipeLeft,
    onSwipeRight,
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

      const commit = () => {
        if (committed) return;
        committed = true;
        if (mountedRef.current) callback();
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
      const { disabled: isDisabled } = interactionPropsRef.current;
      if (isDisabled || dismissingRef.current || activeDragRef.current) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target instanceof Element && event.target.closest("button")) {
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

  return (
    <div className="relative mx-auto w-full max-w-md select-none px-4">
      {/* 背景提示文字 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-12">
        <span
          ref={leftLabelRef}
          style={{ opacity: 0 }}
          className="text-[17px] font-semibold text-[#EF6B6B]"
        >
          ← {tc("不认识")}
        </span>
        <span
          ref={rightLabelRef}
          style={{ opacity: 0 }}
          className="text-[17px] font-semibold text-[#22C55E]"
        >
          {tc("认识")} ✓
        </span>
      </div>

      <div
        data-testid="word-card-flight-layer"
        className="relative z-10 w-full"
      >
        <div
          ref={dragLayerRef}
          data-testid="word-card-drag-layer"
          style={{ touchAction: "pan-y" }}
          className="relative mx-auto flex h-[58vh] min-h-[320px] max-h-[480px] w-full cursor-grab flex-col items-center justify-center rounded-[28px] border border-[#E7EDF8] bg-white shadow-[0_12px_30px_rgba(38,65,140,0.08)] [will-change:transform] active:cursor-grabbing dark:border-[#1E293B] dark:bg-[#111827] dark:shadow-[0_12px_30px_rgba(38,65,140,0.3)]"
        >
          {/* 单词 */}
          <h2
            className="mb-2 text-[#17213C] dark:text-[#E2E8F0]"
            style={{
              fontSize: "42px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
            }}
          >
            {word.term}
          </h2>

          {/* 音标 */}
          {word.phonetic && (
            <p className="mb-3 text-[15px] text-[#7C89A5] dark:text-[#64748B]">
              {word.phonetic}
            </p>
          )}

          {/* 发音按钮 */}
          <button
            onClick={handleSpeak}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFF6FF] text-lg transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:hover:bg-[#1E40AF]/30"
            aria-label={tc("发音")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2563EB"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>

          {/* 底部按钮区域 */}
          <div className="absolute bottom-5 flex w-full items-center justify-between px-5">
            <button
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                handleButtonSwipe(-1, onSwipeLeft);
              }}
              className="flex h-12 items-center gap-1.5 rounded-full bg-[#FEF2F2] px-6 text-[15px] font-semibold text-[#EF6B6B] transition active:scale-[0.96] disabled:pointer-events-none dark:bg-[#2D0B0B]"
            >
              ← {tc("不认识")}
            </button>
            <button
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                handleButtonSwipe(1, onSwipeRight);
              }}
              className="flex h-12 items-center gap-1.5 rounded-full bg-[#ECFDF5] px-6 text-[15px] font-semibold text-[#22C55E] transition active:scale-[0.96] disabled:pointer-events-none dark:bg-[#052E16]"
            >
              {tc("认识")} ✓
            </button>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
