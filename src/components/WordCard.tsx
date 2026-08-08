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
  decideSwipe,
  estimateSwipeVelocity,
  hasClearedViewport,
  launchVelocity,
  offscreenTarget,
  sampleDismissalTrajectory,
  sampleSpringTrajectory,
  OFFSCREEN_MARGIN,
  type SpringState,
  type SwipeDirection,
  type SwipePointerType,
  type SwipePointerSample,
} from "@/lib/swipe-motion";

interface WordCardProps {
  word: { term: string; phonetic?: string | null };
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  children?: ReactNode;
  disabled?: boolean;
}

const SWIPE_LABEL_THRESHOLD = 76;
const BUTTON_LAUNCH_VELOCITY = 720;
const POINTER_SAMPLE_CAPACITY = 20;

interface PointerSampleBuffer {
  positions: Float64Array;
  times: Float64Array;
  cursor: number;
  count: number;
}

interface ActivePointerDrag {
  pointerId: number;
  pointerType: SwipePointerType;
  startPointerX: number;
  startDragX: number;
  latestPointerX: number;
  latestPointerTime: number;
  cardWidth: number;
  geometry: CardGeometry;
  samples: PointerSampleBuffer;
}

interface CardGeometry {
  width: number;
  baseLeft: number;
  baseRight: number;
  viewportWidth: number;
}

interface ActiveAnimation {
  stop: () => void;
  currentPosition?: () => number;
}

const RETURN_SPRING_CONFIG = {
  stiffness: 500,
  damping: 42,
  mass: 0.75,
};
const RELEASE_SPRING_CONFIG = {
  stiffness: 260,
  damping: 30,
  mass: 0.75,
};

const GESTURE_DEBUG = process.env.NEXT_PUBLIC_GESTURE_DEBUG === "1";

function traceGesture(
  name: string,
  details: Record<string, number | string | boolean | undefined> = {},
) {
  if (!GESTURE_DEBUG) return;
  const timestamp = performance.now();
  performance.mark(`gesture:${name}`);
  console.debug(`[gesture] ${name}`, { timestamp, ...details });
}

function createSampleBuffer(): PointerSampleBuffer {
  return {
    positions: new Float64Array(POINTER_SAMPLE_CAPACITY),
    times: new Float64Array(POINTER_SAMPLE_CAPACITY),
    cursor: 0,
    count: 0,
  };
}

function recordPointerSample(
  buffer: PointerSampleBuffer,
  position: number,
  time: number,
) {
  const index = buffer.cursor;
  buffer.positions[index] = position;
  buffer.times[index] = time;
  buffer.cursor = (index + 1) % buffer.positions.length;
  buffer.count = Math.min(buffer.count + 1, buffer.positions.length);
}

function snapshotSampleBuffer(buffer: PointerSampleBuffer): SwipePointerSample[] {
  const samples: SwipePointerSample[] = [];
  const start =
    buffer.count === buffer.positions.length
      ? buffer.cursor
      : (buffer.cursor - buffer.count + buffer.positions.length) %
        buffer.positions.length;
  for (let offset = 0; offset < buffer.count; offset++) {
    const index = (start + offset) % buffer.positions.length;
    samples.push({
      position: buffer.positions[index],
      time: buffer.times[index],
    });
  }
  return samples;
}

function pointerSampleTime(event: Pick<PointerEvent, "timeStamp">) {
  return Number.isFinite(event.timeStamp) && event.timeStamp > 0
    ? event.timeStamp
    : performance.now();
}

function pointerTypeOf(pointerType: string): SwipePointerType {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
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
  dragLayer: HTMLElement,
  leftLabel: HTMLElement | null,
  rightLabel: HTMLElement | null,
  position: number,
) {
  dragLayer.style.transform = cardTransform(position);
  if (leftLabel) leftLabel.style.opacity = String(leftLabelOpacity(position));
  if (rightLabel) rightLabel.style.opacity = String(rightLabelOpacity(position));
}

function readTransformX(element: HTMLElement, fallback: number) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return fallback;
  if (typeof DOMMatrixReadOnly !== "undefined") {
    const matrix = new DOMMatrixReadOnly(transform);
    return Number.isFinite(matrix.m41) ? matrix.m41 : fallback;
  }
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return fallback;
  const values = match[1].split(",").map(Number);
  return Number.isFinite(values[4]) ? values[4] : fallback;
}

interface KeyframeAnimationOptions {
  element: HTMLElement;
  positions: number[];
  durationMs: number;
  transformForPosition: (position: number) => string;
  renderFallback: (position: number) => void;
  onFinish: () => void;
  cancelOnFinish?: boolean;
}

/**
 * Prefer a compositor-eligible transform animation. The fallback exists for
 * older browsers without Element.animate; modern release gestures never use
 * a main-thread spring loop after pointerup.
 */
function startKeyframeAnimation({
  element,
  positions,
  durationMs,
  transformForPosition,
  renderFallback,
  onFinish,
  cancelOnFinish = false,
}: KeyframeAnimationOptions): ActiveAnimation {
  if (positions.length < 2) {
    renderFallback(positions[0] ?? 0);
    onFinish();
    return { stop: () => {} };
  }

  if (typeof element.animate === "function") {
    const animation = element.animate(
      positions.map((position) => ({
        transform: transformForPosition(position),
      })),
      {
        duration: durationMs,
        easing: "linear",
        fill: "forwards",
      },
    );
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      onFinish();
      if (cancelOnFinish) animation.cancel();
    };
    void animation.finished.then(finish, () => undefined);
    return {
      stop: () => {
        if (settled) return;
        settled = true;
        animation.cancel();
      },
      currentPosition: () => readTransformX(element, positions[0]),
    };
  }

  let stopped = false;
  let frameId: number | null = null;
  const startedAt = performance.now();
  let currentPosition = positions[0];
  const tick = (timestamp: number) => {
    if (stopped) return;
    const progress = Math.min(
      1,
      Math.max(0, (timestamp - startedAt) / Math.max(durationMs, 1)),
    );
    const scaled = progress * (positions.length - 1);
    const index = Math.min(positions.length - 2, Math.floor(scaled));
    const localProgress = scaled - index;
    currentPosition =
      positions[index] +
      (positions[index + 1] - positions[index]) * localProgress;
    renderFallback(currentPosition);
    if (progress >= 1) {
      stopped = true;
      frameId = null;
      onFinish();
      return;
    }
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);
  return {
    stop: () => {
      stopped = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    },
    currentPosition: () => currentPosition,
  };
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

function positionSamplesToNumbers(samples: SpringState[]) {
  return samples.map((sample) => sample.position);
}

export default function WordCard({
  word,
  onSwipeLeft,
  onSwipeRight,
  children,
  disabled,
}: WordCardProps) {
  const { tc } = useLocale();
  const flightLayerRef = useRef<HTMLDivElement>(null);
  const dragLayerRef = useRef<HTMLDivElement>(null);
  const leftLabelRef = useRef<HTMLSpanElement>(null);
  const rightLabelRef = useRef<HTMLSpanElement>(null);
  const activeAnimationRef = useRef<ActiveAnimation | null>(null);
  const geometryRef = useRef<CardGeometry | null>(null);
  const activeDragRef = useRef<ActivePointerDrag | null>(null);
  const dragXRef = useRef(0);
  const dragRenderFrameRef = useRef<number | null>(null);
  const lastDragRenderTimeRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const dismissingRef = useRef(false);
  const interactionPropsRef = useRef({
    disabled,
    onSwipeLeft,
    onSwipeRight,
  });

  useEffect(() => {
    interactionPropsRef.current = { disabled, onSwipeLeft, onSwipeRight };
  }, [disabled, onSwipeLeft, onSwipeRight]);

  const stopScheduledDragRender = useCallback(() => {
    if (dragRenderFrameRef.current !== null) {
      cancelAnimationFrame(dragRenderFrameRef.current);
      dragRenderFrameRef.current = null;
    }
  }, []);

  const writeCurrentDragFrame = useCallback((position: number) => {
    const dragLayer = dragLayerRef.current;
    if (!dragLayer) return;
    dragXRef.current = position;
    writeDragFrame(
      dragLayer,
      leftLabelRef.current,
      rightLabelRef.current,
      position,
    );
  }, []);

  const stopActiveAnimation = useCallback(() => {
    const animation = activeAnimationRef.current;
    if (!animation) return;
    const currentPosition = animation.currentPosition?.();
    animation.stop();
    activeAnimationRef.current = null;
    if (Number.isFinite(currentPosition)) {
      writeCurrentDragFrame(currentPosition!);
    }
  }, [writeCurrentDragFrame]);

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

  const returnToCentre = useCallback(() => {
    if (dismissingRef.current) return;
    const dragLayer = dragLayerRef.current;
    if (!dragLayer) return;
    stopActiveAnimation();
    const samples = sampleSpringTrajectory(
      { position: dragXRef.current, velocity: 0 },
      0,
      RETURN_SPRING_CONFIG,
      18,
      0.5,
      { monotonicDirection: dragXRef.current < 0 ? 1 : -1 },
    );
    const positions = positionSamplesToNumbers(samples);
    if (positions.length < 2 || Math.abs(dragXRef.current) < 0.5) {
      writeCurrentDragFrame(0);
      return;
    }

    let returnAnimation: ActiveAnimation | null = null;
    returnAnimation = startKeyframeAnimation({
      element: dragLayer,
      positions,
      durationMs: (positions.length - 1) * (1_000 / 120),
      transformForPosition: cardTransform,
      renderFallback: writeCurrentDragFrame,
      onFinish: () => {
        writeCurrentDragFrame(0);
        if (activeAnimationRef.current === returnAnimation) {
          activeAnimationRef.current = null;
        }
      },
      cancelOnFinish: true,
    });
    activeAnimationRef.current = returnAnimation;
  }, [stopActiveAnimation, writeCurrentDragFrame]);

  const startFlight = useCallback(
    (
      direction: SwipeDirection,
      velocityX: number,
      callback: () => void,
      geometryOverride?: CardGeometry,
    ) => {
      const { disabled: isDisabled } = interactionPropsRef.current;
      if (isDisabled || dismissingRef.current) return;
      const flightLayer = flightLayerRef.current;
      const dragLayer = dragLayerRef.current;
      if (!flightLayer || !dragLayer) return;
      const geometry = geometryOverride ?? geometryRef.current ?? cacheGeometry();
      if (!geometry) return;

      dismissingRef.current = true;
      stopActiveAnimation();
      stopScheduledDragRender();
      const currentX = dragXRef.current;
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
      let flightAnimation: ActiveAnimation | null = null;

      const commit = () => {
        if (committed) return;
        committed = true;
        traceGesture("flight-animation-finish", {
          direction,
          releasePosition: currentX,
        });
        if (activeAnimationRef.current === flightAnimation) {
          activeAnimationRef.current = null;
        }
        if (mountedRef.current) callback();
      };

      if (hasClearedViewport(direction, currentX, targetX)) {
        commit();
        return;
      }

      // The inner drag layer is frozen at the exact release position. The
      // outer layer starts at zero and owns the whole remaining flight, so
      // the first composited flight frame is exactly the release frame.
      flightLayer.style.transform = "translate3d(0px, 0, 0)";
      const directionalVelocity = launchVelocity(velocityX, direction) * direction;
      const trajectory = sampleDismissalTrajectory(
        remainingDistance,
        directionalVelocity,
        RELEASE_SPRING_CONFIG,
      );
      const positions = positionSamplesToNumbers(trajectory);
      traceGesture("flight-animation-start", {
        direction,
        releasePosition: currentX,
        remainingDistance,
        releaseVelocity: velocityX,
        keyframes: positions.length,
      });
      flightAnimation = startKeyframeAnimation({
        element: flightLayer,
        positions,
        durationMs: (positions.length - 1) * (1_000 / 120),
        transformForPosition: (position) =>
          `translate3d(${position * direction}px, 0, 0)`,
        renderFallback: (position) => {
          flightLayer.style.transform = `translate3d(${position * direction}px, 0, 0)`;
        },
        onFinish: commit,
      });
      activeAnimationRef.current = flightAnimation;
      requestAnimationFrame(() => {
        traceGesture("flight-first-frame", {
          flightPosition: readTransformX(flightLayer, 0),
          releaseToFrameMs:
            lastDragRenderTimeRef.current === null
              ? undefined
              : performance.now() - lastDragRenderTimeRef.current,
        });
      });
    },
    [cacheGeometry, stopActiveAnimation, stopScheduledDragRender],
  );

  const handleButtonSwipe = useCallback(
    (direction: SwipeDirection, callback: () => void) => {
      startFlight(direction, direction * BUTTON_LAUNCH_VELOCITY, callback);
    },
    [startFlight],
  );

  useEffect(() => {
    mountedRef.current = true;
    const flightLayer = flightLayerRef.current;
    const dragLayer = dragLayerRef.current;
    if (!flightLayer || !dragLayer) return;

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

    flightLayer.style.transform = "translate3d(0px, 0, 0)";
    writeCurrentDragFrame(0);
    updateGeometry();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateGeometry)
        : null;
    resizeObserver?.observe(dragLayer);
    window.addEventListener("resize", updateGeometry);

    const renderDragFrame = (timestamp: number) => {
      dragRenderFrameRef.current = null;
      const drag = activeDragRef.current;
      if (!drag) return;
      const position =
        drag.startDragX + drag.latestPointerX - drag.startPointerX;
      writeCurrentDragFrame(position);
      lastDragRenderTimeRef.current = timestamp;
      traceGesture("drag-render", { position });
    };

    const scheduleDragRender = () => {
      if (dragRenderFrameRef.current !== null) return;
      dragRenderFrameRef.current = requestAnimationFrame(renderDragFrame);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const { disabled: isDisabled } = interactionPropsRef.current;
      if (isDisabled || dismissingRef.current || activeDragRef.current) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }

      stopActiveAnimation();
      const geometry = cacheGeometry();
      if (!geometry) return;
      const now = pointerSampleTime(event);
      const samples = createSampleBuffer();
      recordPointerSample(samples, event.clientX, now);
      activeDragRef.current = {
        pointerId: event.pointerId,
        pointerType: pointerTypeOf(event.pointerType),
        startPointerX: event.clientX,
        startDragX: dragXRef.current,
        latestPointerX: event.clientX,
        latestPointerTime: now,
        cardWidth: geometry.width,
        geometry,
        samples,
      };
      dragLayer.setPointerCapture(event.pointerId);
      event.preventDefault();
      traceGesture("pointerdown", {
        pointerType: event.pointerType,
        position: dragXRef.current,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const coalesced = event.getCoalescedEvents?.() ?? [event];
      const latest = coalesced[coalesced.length - 1] ?? event;
      for (const sample of coalesced) {
        const time = pointerSampleTime(sample);
        recordPointerSample(drag.samples, sample.clientX, time);
        drag.latestPointerTime = time;
      }
      drag.latestPointerX = latest.clientX;
      scheduleDragRender();
      event.preventDefault();
    };

    const finishPointerDrag = (event: PointerEvent, cancelled: boolean) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      stopScheduledDragRender();
      const releaseTime = pointerSampleTime(event);
      if (!cancelled) {
        drag.latestPointerX = event.clientX;
        drag.latestPointerTime = releaseTime;
        recordPointerSample(drag.samples, event.clientX, releaseTime);
        const releaseX =
          drag.startDragX + event.clientX - drag.startPointerX;
        writeCurrentDragFrame(releaseX);
        traceGesture("pointerup-handler-entry", {
          releasePosition: releaseX,
          releaseEventTime: releaseTime,
        });
      } else {
        traceGesture("pointercancel", { position: dragXRef.current });
      }
      activeDragRef.current = null;

      if (cancelled) {
        returnToCentre();
        return;
      }

      const velocityX = estimateSwipeVelocity(
        snapshotSampleBuffer(drag.samples),
        releaseTime,
      );
      const decision = decideSwipe(
        dragXRef.current,
        velocityX,
        drag.cardWidth,
        drag.pointerType,
      );
      if (!decision.dismiss) {
        returnToCentre();
        return;
      }
      const callback =
        decision.direction < 0
          ? interactionPropsRef.current.onSwipeLeft
          : interactionPropsRef.current.onSwipeRight;
      startFlight(decision.direction, velocityX, callback, drag.geometry);
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishPointerDrag(event, false);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      finishPointerDrag(event, true);
    };
    const handleLostPointerCapture = (event: PointerEvent) => {
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
      stopScheduledDragRender();
      activeAnimationRef.current?.stop();
      activeAnimationRef.current = null;
      activeDragRef.current = null;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateGeometry);
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
    returnToCentre,
    startFlight,
    stopActiveAnimation,
    stopScheduledDragRender,
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
        ref={flightLayerRef}
        data-testid="word-card-flight-layer"
        className="relative z-10 w-full [will-change:transform]"
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
