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
  samples: SwipePointerSample[];
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
  const activeAnimationRef = useRef<AnimationPlaybackControls | null>(null);
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
    return () => {
      mountedRef.current = false;
      activeAnimationRef.current?.stop();
    };
  }, []);

  const stopReturnAnimation = () => {
    if (dismissingRef.current) return;
    activeAnimationRef.current?.stop();
    activeAnimationRef.current = null;
  };

  const returnToCentre = (velocityX: number) => {
    const animation = animate(x, 0, {
      type: "spring",
      velocity: Math.max(-2_400, Math.min(2_400, velocityX)),
      stiffness: 480,
      damping: 38,
      mass: 0.85,
      restSpeed: 18,
      restDelta: 0.5,
    });
    activeAnimationRef.current = animation;
    void animation.finished.then(
      () => {
        if (activeAnimationRef.current === animation) {
          activeAnimationRef.current = null;
        }
      },
      () => {
        if (activeAnimationRef.current === animation) {
          activeAnimationRef.current = null;
        }
      },
    );
  };

  const flyOff = async (
    direction: SwipeDirection,
    velocityX: number,
    callback: () => void,
  ) => {
    if (disabled || dismissingRef.current) return;
    const card = cardRef.current;
    if (!card) return;

    dismissingRef.current = true;
    activeAnimationRef.current?.stop();
    // Pointer movement is owned by this component, so the release spring can
    // take over the same motion value immediately without a drag teardown race.
    card.style.pointerEvents = "none";
    let animation: AnimationPlaybackControls | null = null;
    let committed = false;

    try {
      if (!mountedRef.current || !card.isConnected) return;

      const rect = card.getBoundingClientRect();
      const target = offscreenTarget(
        direction,
        x.get(),
        rect.left,
        rect.right,
        window.innerWidth,
      );
      animation = animate(x, target, {
        type: "spring",
        velocity: launchVelocity(velocityX, direction),
        stiffness: 150,
        damping: 20,
        mass: 0.9,
        restSpeed: 120,
        restDelta: 8,
      });
      activeAnimationRef.current = animation;

      let unsubscribe = () => {};
      const clearedViewport = new Promise<void>((resolve) => {
        const checkPosition = (latest: number) => {
          if (hasClearedViewport(direction, latest, target)) resolve();
        };
        unsubscribe = x.on("change", checkPosition);
        checkPosition(x.get());
      });
      await Promise.race([
        clearedViewport,
        animation.finished.then(
          () => undefined,
          () => undefined,
        ),
      ]);
      unsubscribe();
      animation.stop();
      if (mountedRef.current) {
        committed = true;
        callback();
      }
    } catch {
      // Stopping an animation during unmount is expected; never commit the swipe.
    } finally {
      if (animation && activeAnimationRef.current === animation) {
        activeAnimationRef.current = null;
      }
      if (!committed && card.isConnected) {
        card.style.pointerEvents = "";
        dismissingRef.current = false;
      }
    }
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || dismissingRef.current || activeDragRef.current) return;
    if (event.button !== 0 || event.isPrimary === false) return;
    if ((event.target as HTMLElement).closest("button")) return;

    stopReturnAnimation();
    const now = performance.now();
    activeDragRef.current = {
      pointerId: event.pointerId,
      pointerType: pointerTypeOf(event.pointerType),
      startPointerX: event.clientX,
      startCardX: x.get(),
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
    const now = performance.now();
    x.set(drag.startCardX + latest.clientX - drag.startPointerX);
    for (const sample of coalesced) {
      recordPointerSample(drag, sample.clientX, now);
    }
    event.preventDefault();
  };

  const finishPointerDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const now = performance.now();
    recordPointerSample(drag, event.clientX, now);
    const velocityX = cancelled
      ? 0
      : estimateSwipeVelocity(drag.samples, now);
    activeDragRef.current = null;
    event.currentTarget.style.cursor = "";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (cancelled) {
      returnToCentre(0);
      return;
    }

    const cardWidth = cardRef.current?.offsetWidth ?? 400;
    const decision = decideSwipe(
      x.get(),
      velocityX,
      cardWidth,
      drag.pointerType,
    );
    if (!decision.dismiss) {
      // A rejected gesture should visibly snap back at once. Carrying a noisy
      // mouse velocity into this spring makes a tiny drag travel farther away
      // for a frame or two before returning, which feels like a false swipe.
      returnToCentre(0);
      return;
    }
    const callback = decision.direction < 0 ? onSwipeLeft : onSwipeRight;
    void flyOff(decision.direction, velocityX, callback);
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
