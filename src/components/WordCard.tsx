"use client";

import { motion, useMotionValue, useTransform } from "framer-motion";
import type { ReactNode } from "react";
import { speakEnglish } from "@/lib/speech";

interface WordCardProps {
  word: { term: string; phonetic?: string | null };
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  children?: ReactNode;
  disabled?: boolean;
}

const SWIPE_THRESHOLD = 80;

export default function WordCard({
  word,
  onSwipeLeft,
  onSwipeRight,
  children,
  disabled,
}: WordCardProps) {
  const x = useMotionValue(0);

  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);
  const opacityLeft = useTransform(x, [-200, -SWIPE_THRESHOLD, 0], [1, 1, 0]);
  const opacityRight = useTransform(x, [0, SWIPE_THRESHOLD, 200], [0, 1, 1]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      onSwipeLeft();
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      onSwipeRight();
    }
  };

  return (
    <div className="relative mx-auto w-full max-w-md select-none px-4">
      {/* 背景提示文字 */}
      <div className="absolute inset-0 flex items-center justify-between px-8 text-sm font-bold pointer-events-none">
        <motion.span
          style={{ opacity: opacityLeft }}
          className="text-red-400"
        >
          不认识
        </motion.span>
        <motion.span
          style={{ opacity: opacityRight }}
          className="text-green-500"
        >
          认识 ✓
        </motion.span>
      </div>

      <motion.div
        drag={disabled ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        style={{ x, rotate }}
        whileTap={{ scale: disabled ? 1 : 1.02 }}
        className="relative z-10 mx-auto flex h-72 w-full flex-col items-center justify-center rounded-3xl border border-zinc-200/60 bg-white shadow-lg shadow-zinc-200/50"
      >
        {/* 单词 */}
        <h2 className="mb-2 text-5xl font-bold tracking-tight text-zinc-900">
          {word.term}
        </h2>
        {word.phonetic && (
          <p className="text-sm text-zinc-400">{word.phonetic}</p>
        )}
        {!word.phonetic && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              speakEnglish(word.term);
            }}
            className="mt-2 text-xs text-blue-500 hover:text-blue-600"
          >
            🔊 发音
          </button>
        )}

        {/* 滑动提示 */}
        <p className="absolute bottom-4 text-xs text-zinc-300">
          ← 不认识 · 认识 →
        </p>
      </motion.div>

      {children}
    </div>
  );
}
