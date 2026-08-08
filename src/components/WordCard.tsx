"use client";

import {
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import type { AnimationPlaybackControls } from "framer-motion";
import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
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
  OFFSCREEN_MARGIN,
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

interface ActivePointerDrag {
  pointerId: number;
  pointerType: SwipePointerType;
  startPointerX: number;
  startCardX: number;
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

function measureCardGeometry(
  card: HTMLElement,
  currentX: number,
  viewportWidth: number,
): CardGeometry {
  const rect = card.getBoundingClientRect();
  // getBoundingClientRect() is an axis-aligned box and includes the card's
  // derived rotation. Its center does not move when rotating around the
  // default center origin, so reconstruct the unrotated horizontal edges from
  // the layout width before calculating the offscreen target.
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
  const x = useMotionValue(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const activeMotionAnimationRef = useRef<AnimationPlaybackControls | null>(null);
  const geometryRef = useRef<CardGeometry | null>(null);
  const activeDragRef = useRef<ActivePointerDrag | null>(null);
  const mountedRef = useRef(true);
  const dismissingRef = useRef(false);
  const rotate = useTransform(x, [-300, 0, 300], [-10, 0, 10]);
  const opacityLeft = useTransform(
    x,
    [-200, -SWIPE_LABEL_THRESHOLD, 0],
    [1, 1, 0],
  );
  const opacityRight = useTransform(
    x,
    [0, SWIPE_LABEL_THRESHOLD, 200],
    [0, 1, 1],
  );

  useEffect(() => {
    mountedRef.current = true;
    const card = cardRef.current;

    const updateGeometry = () => {
      if (!card) return;
      const currentX = x.get();
      const geometry = measureCardGeometry(
        card,
        currentX,
        window.innerWidth,
      );
      geometryRef.current = geometry;
      if (activeDragRef.current) {
        activeDragRef.current.geometry = geometry;
        activeDragRef.current.cardWidth = geometry.width;
      }
    };

    updateGeometry();
    const resizeObserver =
      card && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateGeometry)
        : null;
    if (resizeObserver && card) resizeObserver.observe(card);
    const handleViewportResize = updateGeometry;
    window.addEventListener("resize", handleViewportResize);

    return () => {
      mountedRef.current = false;
      activeMotionAnimationRef.current?.stop();
      activeDragRef.current = null;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [x]);

  const cacheGeometry = (card: HTMLElement): CardGeometry => {
    const geometry = measureCardGeometry(card, x.get(), window.innerWidth);
    geometryRef.current = geometry;
    return geometry;
  };

  const stopActiveAnimation = () => {
    activeMotionAnimationRef.current?.stop();
    activeMotionAnimationRef.current = null;
  };

  const returnToCentre = () => {
    if (!cardRef.current || dismissingRef.current) return;
    stopActiveAnimation();

    const motionAnimation = animate(x, 0, {
      type: "spring",
      velocity: 0,
      stiffness: 500,
      damping: 42,
      mass: 0.75,
      restSpeed: 18,
      restDelta: 0.5,
    });
    activeMotionAnimationRef.current = motionAnimation;

    void motionAnimation.finished.then(
      () => {
        if (activeMotionAnimationRef.current === motionAnimation) {
          activeMotionAnimationRef.current = null;
        }
      },
      () => {
        if (activeMotionAnimationRef.current === motionAnimation) {
          activeMotionAnimationRef.current = null;
        }
      },
    );
  };

  const flyOff = (
    direction: SwipeDirection,
    velocityX: number,
    callback: () => void,
    geometryOverride?: CardGeometry,
  ) => {
    if (disabled || dismissingRef.current) return;
    const card = cardRef.current;
    if (!card) return;
    // Pointer swipes pass their pointerdown snapshot so pointerup does not
    // force a synchronous layout read. Button swipes use the observer-updated
    // snapshot; the fallback only covers an interaction before mount effects
    // have measured the card.
    const geometry = geometryOverride ?? geometryRef.current ?? cacheGeometry(card);

    dismissingRef.current = true;
    stopActiveAnimation();
    card.style.pointerEvents = "none";
    const currentX = x.get();
    const targetX = offscreenTarget(
      direction,
      currentX,
      geometry.baseLeft + currentX,
      geometry.baseRight + currentX,
      geometry.viewportWidth,
      OFFSCREEN_MARGIN,
    );
    const motionAnimation = animate(x, targetX, {
      type: "spring",
      velocity: launchVelocity(velocityX, direction),
      stiffness: 260,
      damping: 30,
      mass: 0.75,
      restSpeed: 80,
      restDelta: 6,
    });
    activeMotionAnimationRef.current = motionAnimation;
    let committed = false;
    let unsubscribe = () => {};

    const resetAfterFailure = () => {
      unsubscribe();
      if (activeMotionAnimationRef.current !== motionAnimation) return;
      activeMotionAnimationRef.current = null;
      if (!committed && card.isConnected) {
        card.style.pointerEvents = "";
        dismissingRef.current = false;
      }
    };

    const commit = () => {
      if (committed) return;
      committed = true;
      unsubscribe();
      motionAnimation.stop();
      if (activeMotionAnimationRef.current === motionAnimation) {
        activeMotionAnimationRef.current = null;
      }
      if (mountedRef.current) callback();
    };

    unsubscribe = x.on("change", (latest) => {
      if (hasClearedViewport(direction, latest, targetX)) commit();
    });

    if (hasClearedViewport(direction, x.get(), targetX)) commit();
    void motionAnimation.finished.then(commit, resetAfterFailure);
  };

  const pointerTypeOf = (pointerType: string): SwipePointerType => {
    if (pointerType === "touch" || pointerType === "pen") {
      return pointerType;
    }
    return "mouse";
  };

  const recordPointerSample = (
    drag: ActivePointerDrag,
    position: number,
    time: number,
  ) => {
    drag.samples.push({ position, time });
    drag.samples = drag.samples.filter((sample) => time - sample.time <= 140);
  };

  const pointerSampleTime = (event: Pick<PointerEvent, "timeStamp">) =>
    Number.isFinite(event.timeStamp) && event.timeStamp > 0
      ? event.timeStamp
      : performance.now();

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || dismissingRef.current || activeDragRef.current) return;
    if (event.button !== 0 || event.isPrimary === false) return;
    if (event.target instanceof Element && event.target.closest("button")) return;

    stopActiveAnimation();
    const geometry = cacheGeometry(event.currentTarget);
    const now = pointerSampleTime(event.nativeEvent);
    activeDragRef.current = {
      pointerId: event.pointerId,
      pointerType: pointerTypeOf(event.pointerType),
      startPointerX: event.clientX,
      startCardX: x.get(),
      cardWidth: geometry.width,
      geometry,
      samples: [{ position: event.clientX, time: now }],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grabbing";
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    const latest = coalesced[coalesced.length - 1] ?? event.nativeEvent;
    for (const sample of coalesced) {
      recordPointerSample(drag, sample.clientX, pointerSampleTime(sample));
    }
    x.set(drag.startCardX + latest.clientX - drag.startPointerX);
    event.preventDefault();
  };

  const finishPointerDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const releaseTime = pointerSampleTime(event.nativeEvent);
    if (!cancelled) {
      const releaseX =
        drag.startCardX + event.clientX - drag.startPointerX;
      x.set(releaseX);
      recordPointerSample(drag, event.clientX, releaseTime);
    }
    const velocityX = cancelled
      ? 0
      : estimateSwipeVelocity(drag.samples, releaseTime);
    activeDragRef.current = null;
    event.currentTarget.style.cursor = "";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (cancelled) {
      returnToCentre();
      return;
    }

    const decision = decideSwipe(
      x.get(),
      velocityX,
      drag.cardWidth,
      drag.pointerType,
    );
    if (!decision.dismiss) {
      // A rejected gesture should visibly snap back at once. Carrying a noisy
      // mouse velocity into this spring makes a tiny drag travel farther away
      // for a frame or two before returning, which feels like a false swipe.
      returnToCentre();
      return;
    }
    const callback = decision.direction < 0 ? onSwipeLeft : onSwipeRight;
    void flyOff(decision.direction, velocityX, callback, drag.geometry);
  };

  const handleButtonSwipe = (direction: SwipeDirection, callback: () => void) => {
    void flyOff(direction, direction * BUTTON_LAUNCH_VELOCITY, callback);
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    speakEnglish(word.term);
  };

  return (
    <div className="relative mx-auto w-full max-w-md select-none px-4">
      {/* 背景提示文字 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-12">
        <motion.span
          style={{ opacity: opacityLeft }}
          className="text-[17px] font-semibold text-[#EF6B6B]"
        >
          ← {tc("不认识")}
        </motion.span>
        <motion.span
          style={{ opacity: opacityRight }}
          className="text-[17px] font-semibold text-[#22C55E]"
        >
          {tc("认识")} ✓
        </motion.span>
      </div>

      <motion.div
        ref={cardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointerDrag(event, false)}
        onPointerCancel={(event) => finishPointerDrag(event, true)}
        onLostPointerCapture={(event) => finishPointerDrag(event, true)}
        style={{ x, rotate, touchAction: "pan-y" }}
        className="relative z-10 mx-auto flex h-[58vh] min-h-[320px] max-h-[480px] w-full cursor-grab flex-col items-center justify-center rounded-[28px] border border-[#E7EDF8] bg-white shadow-[0_12px_30px_rgba(38,65,140,0.08)] [will-change:transform] active:cursor-grabbing dark:border-[#1E293B] dark:bg-[#111827] dark:shadow-[0_12px_30px_rgba(0,0,0,0.3)]"
      >
        {/* 单词 */}
        <h2
          className="mb-2 text-[#17213C] dark:text-[#E2E8F0]"
          style={{ fontSize: "42px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15 }}
        >
          {word.term}
        </h2>

        {/* 音标 */}
        {word.phonetic && (
          <p className="mb-3 text-[15px] text-[#7C89A5] dark:text-[#64748B]">{word.phonetic}</p>
        )}

        {/* 发音按钮 */}
        <button
          onClick={handleSpeak}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFF6FF] text-lg transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:hover:bg-[#1E40AF]/30"
          aria-label={tc("发音")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        </button>

        {/* 底部按钮区域 */}
        <div className="absolute bottom-5 flex w-full items-center justify-between px-5">
          <button
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              handleButtonSwipe(-1, onSwipeLeft);
            }}
            className="flex h-12 items-center gap-1.5 rounded-full bg-[#FEF2F2] px-6 text-[15px] font-semibold text-[#EF6B6B] transition active:scale-[0.96] disabled:pointer-events-none dark:bg-[#2D0B0B]"
          >
            ← {tc("不认识")}
          </button>
          <button
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              handleButtonSwipe(1, onSwipeRight);
            }}
            className="flex h-12 items-center gap-1.5 rounded-full bg-[#ECFDF5] px-6 text-[15px] font-semibold text-[#22C55E] transition active:scale-[0.96] disabled:pointer-events-none dark:bg-[#052E16]"
          >
            {tc("认识")} ✓
          </button>
        </div>
      </motion.div>

      {children}
    </div>
  );
}
