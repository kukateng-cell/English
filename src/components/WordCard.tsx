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
  advanceSpring,
  boundedReleaseVelocity,
  decideSwipe,
  dismissalVelocity,
  hasClearedViewport,
  offscreenTarget,
  springSettled,
  updateRenderedDragMotion,
  OFFSCREEN_MARGIN,
  type SpringConfig,
  type SwipeDirection,
  type SwipePointerType,
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

interface ActivePointerDrag {
  pointerId: number;
  captureGeneration: number;
  pointerType: SwipePointerType;
  startPointerX: number;
  startDragX: number;
  latestPointerX: number;
  cardWidth: number;
  geometry: CardGeometry;
}

interface CardGeometry {
  width: number;
  baseLeft: number;
  baseRight: number;
  viewportWidth: number;
}

type MotionMode = "idle" | "drag" | "spring";

interface MotionState {
  mode: MotionMode;
  position: number;
  velocity: number;
  target: number;
  lastTime: number | null;
  stationarySeconds: number;
  springConfig: SpringConfig | null;
  direction: SwipeDirection | null;
  onComplete: (() => void) | null;
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
  const traceWindow = window as typeof window & {
    __wordCardGestureTrace?: Array<
      Record<string, number | string | boolean | undefined>
    >;
  };
  const trace = traceWindow.__wordCardGestureTrace ?? [];
  trace.push({ name, timestamp, ...details });
  if (trace.length > 240) trace.shift();
  traceWindow.__wordCardGestureTrace = trace;
  console.debug(`[gesture] ${name}`, { timestamp, ...details });
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
  const motionStateRef = useRef<MotionState>({
    mode: "idle",
    position: 0,
    velocity: 0,
    target: 0,
    lastTime: null,
    stationarySeconds: 0,
    springConfig: null,
    direction: null,
    onComplete: null,
  });
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
    if (motionFrameRef.current !== null) return;
    motionFrameRef.current = requestAnimationFrame((timestamp) => {
      motionFrameRef.current = null;
      motionTickRef.current(timestamp);
    });
  }, []);

  const cancelScheduledMotionFrame = useCallback(() => {
    if (motionFrameRef.current === null) return;
    cancelAnimationFrame(motionFrameRef.current);
    motionFrameRef.current = null;
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

  const completeSpring = useCallback(() => {
    const motion = motionStateRef.current;
    const onComplete = motion.onComplete;
    motion.mode = "idle";
    motion.velocity = 0;
    motion.lastTime = null;
    motion.stationarySeconds = 0;
    motion.springConfig = null;
    motion.direction = null;
    motion.onComplete = null;
    if (onComplete && mountedRef.current) onComplete();
  }, []);

  const renderMotionFrame = useCallback(
    () => {
      const motion = motionStateRef.current;
      const now = performance.now();

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
        const previousTime = motion.lastTime;
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
        writeCurrentDragFrame(next.position);
        traceGesture("drag-render", {
          position: next.position,
          velocity: next.velocity,
          deltaMs: previousTime === null ? 0 : now - previousTime,
        });
        scheduleMotionFrame();
        return;
      }

      if (motion.mode !== "spring") return;

      const deltaSeconds =
        motion.lastTime === null
          ? 0
          : Math.min(Math.max((now - motion.lastTime) / 1_000, 0), 0.032);
      motion.lastTime = now;
      if (deltaSeconds <= 0) {
        scheduleMotionFrame();
        return;
      }
      const next = advanceSpring(
        { position: motion.position, velocity: motion.velocity },
        motion.target,
        deltaSeconds,
        motion.springConfig ?? RETURN_SPRING_CONFIG,
      );
      motion.position = next.position;
      motion.velocity = next.velocity;
      writeCurrentDragFrame(next.position);
      traceGesture("spring-frame", {
        direction: motion.direction ?? "return",
        deltaMs: deltaSeconds * 1_000,
        position: next.position,
        velocity: next.velocity,
      });

      if (
        motion.direction !== null &&
        hasClearedViewport(motion.direction, next.position, motion.target)
      ) {
        completeSpring();
        return;
      }

      if (
        springSettled(
          next,
          motion.target,
          motion.direction === null ? 18 : 80,
          motion.direction === null ? 0.5 : 12,
        )
      ) {
        motion.position = motion.target;
        motion.velocity = 0;
        writeCurrentDragFrame(motion.target);
        completeSpring();
        return;
      }

      scheduleMotionFrame();
    },
    [completeSpring, scheduleMotionFrame, writeCurrentDragFrame],
  );

  const beginSpring = useCallback(
    (
      target: number,
      velocity: number,
      springConfig: SpringConfig,
      direction: SwipeDirection | null,
      onComplete: (() => void) | null,
    ) => {
      const motion = motionStateRef.current;
      cancelScheduledMotionFrame();
      motion.mode = "spring";
      motion.target = target;
      motion.velocity = boundedReleaseVelocity(velocity);
      motion.lastTime = performance.now();
      motion.springConfig = springConfig;
      motion.direction = direction;
      motion.onComplete = onComplete;
      traceGesture("spring-handoff", {
        direction: direction ?? "return",
        releasePosition: motion.position,
        releaseVelocity: motion.velocity,
      });
      scheduleMotionFrame();
    },
    [cancelScheduledMotionFrame, scheduleMotionFrame],
  );

  const returnToCentre = useCallback(
    () => {
      if (dismissingRef.current) return;
      const motion = motionStateRef.current;
      const position = motion.position;
      if (Math.abs(position) < 0.5) {
        const motion = motionStateRef.current;
        motion.mode = "idle";
        motion.velocity = 0;
        motion.lastTime = null;
        motion.stationarySeconds = 0;
        motion.springConfig = null;
        motion.direction = null;
        motion.onComplete = null;
        writeCurrentDragFrame(0);
        return;
      }

      beginSpring(
        0,
        boundedReleaseVelocity(motion.velocity),
        RETURN_SPRING_CONFIG,
        null,
        null,
      );
    },
    [beginSpring, writeCurrentDragFrame],
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
        traceGesture("flight-animation-finish", {
          direction,
          releasePosition: currentX,
        });
        if (mountedRef.current) callback();
      };

      if (hasClearedViewport(direction, currentX, targetX)) {
        commit();
        return;
      }

      const directionalVelocity = dismissalVelocity(
        velocityX,
        direction,
        remainingDistance,
      );
      traceGesture("flight-animation-start", {
        direction,
        releasePosition: currentX,
        remainingDistance,
        releaseVelocity: velocityX,
        departureVelocity: directionalVelocity,
      });
      beginSpring(
        targetX,
        directionalVelocity,
        RELEASE_SPRING_CONFIG,
        direction,
        commit,
      );
    },
    [beginSpring, cacheGeometry],
  );

  const handleButtonSwipe = useCallback(
    (direction: SwipeDirection, callback: () => void) => {
      startFlight(direction, direction * BUTTON_LAUNCH_VELOCITY, callback);
    },
    [startFlight],
  );

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
    window.addEventListener("resize", updateGeometry);

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
      motion.mode = "drag";
      motion.position = dragXRef.current;
      motion.velocity = 0;
      motion.target = motion.position;
      motion.lastTime = performance.now();
      motion.stationarySeconds = 0;
      motion.springConfig = null;
      motion.direction = null;
      motion.onComplete = null;
      activeDragRef.current = {
        pointerId: event.pointerId,
        captureGeneration,
        pointerType: pointerTypeOf(event.pointerType),
        startPointerX: event.clientX,
        startDragX: dragXRef.current,
        latestPointerX: event.clientX,
        cardWidth: geometry.width,
        geometry,
      };
      activeCaptureGenerationRef.current = captureGeneration;
      dragLayer.setPointerCapture(event.pointerId);
      event.preventDefault();
      traceGesture("pointerdown", {
        pointerType: event.pointerType,
        position: dragXRef.current,
      });
      scheduleMotionFrame();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const coalesced = event.getCoalescedEvents?.() ?? [event];
      const latest = coalesced[coalesced.length - 1] ?? event;
      drag.latestPointerX = latest.clientX;
      scheduleMotionFrame();
      if (event.cancelable) event.preventDefault();
    };

    const finishPointerDrag = (event: PointerEvent, cancelled: boolean) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const motion = motionStateRef.current;
      const releaseTime = performance.now();
      if (!cancelled) drag.latestPointerX = event.clientX;
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
      writeCurrentDragFrame(releaseMotion.position);
      if (!cancelled) {
        traceGesture("pointerup-handler-entry", {
          releasePosition: releaseMotion.position,
          releaseVelocity: releaseMotion.velocity,
          releaseEventTime: releaseTime,
        });
      } else {
        traceGesture("pointercancel", {
          position: releaseMotion.position,
          velocity: releaseMotion.velocity,
        });
      }
      activeDragRef.current = null;
      if (activeCaptureGenerationRef.current === drag.captureGeneration) {
        activeCaptureGenerationRef.current = null;
      }

      if (cancelled) {
        returnToCentre();
        return;
      }

      const velocityX = boundedReleaseVelocity(motion.velocity);
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
      motionTickRef.current = () => {};
      motionState.mode = "idle";
      motionState.velocity = 0;
      motionState.lastTime = null;
      motionState.stationarySeconds = 0;
      motionState.springConfig = null;
      motionState.direction = null;
      motionState.onComplete = null;
      activeCaptureGenerationRef.current = null;
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
          data-motion-owner="single-raf"
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
