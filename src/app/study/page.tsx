"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import WordCard from "@/components/WordCard";
import HelpPanel from "@/components/HelpPanel";

interface WordFull {
  id: string;
  term: string;
  phonetic?: string | null;
  pos?: string | null;
  definition: string;
  level: string;
  category?: string | null;
  examples?: { en: string; zh: string }[] | null;
  synonyms: string[];
  antonyms: string[];
  imageUrl?: string | null;
}

interface QueueItem {
  reviewId: string | null;
  word: WordFull;
  state: {
    easeFactor: number;
    interval: number;
    repetitions: number;
    nextReviewDate: string;
    lastReviewedAt: string | null;
  };
}

export default function StudyPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [helpVisible, setHelpVisible] = useState(false);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [loading, setLoading] = useState(true);

  // 认证检查
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  // 加载队列
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/study");
    if (res.ok) {
      const data = await res.json();
      setQueue(data.queue || []);
      setCurrentIndex(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchQueue();
  }, [status, fetchQueue]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  const current = queue[currentIndex];
  const isLast = currentIndex >= queue.length - 1;

  // 提交滑动结果到后端
  const submitReview = async (gesture: "left" | "right") => {
    if (!current) return;
    await fetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wordId: current.word.id,
        gesture,
        reviewId: current.reviewId,
      }),
    });
  };

  // 右滑：认识
  const handleSwipeRight = async () => {
    setDirection("right");
    await submitReview("right");
    setTimeout(() => {
      setCurrentIndex((i) => i + 1);
      setDirection(null);
    }, 350);
  };

  // 左滑：不认识 → 展示助记面板
  const handleSwipeLeft = async () => {
    await submitReview("left");
    setDirection("left");
    setTimeout(() => setHelpVisible(true), 350);
  };

  // 助记面板关闭 → 下一个单词
  const handleHelpDismiss = () => {
    setHelpVisible(false);
    setDirection(null);
    setTimeout(() => setCurrentIndex((i) => i + 1), 200);
  };

  // 全部学完
  if (!current && queue.length === 0) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
        <p className="text-4xl mb-4">🎉</p>
        <h2 className="text-xl font-bold text-zinc-900 mb-2">全部完成！</h2>
        <p className="text-sm text-zinc-500 mb-6">
          今天没有更多单词了，明天再来复习吧
        </p>
        <button
          onClick={fetchQueue}
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          刷新单词
        </button>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="flex min-h-full flex-col items-center justify-center pb-20">
      {/* 顶部进度 */}
      <div className="mb-6 w-full max-w-md px-4">
        <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
          <span>
            {currentIndex + 1} / {queue.length}
          </span>
          {current.reviewId && <span className="text-amber-500">复习</span>}
          {!current.reviewId && <span className="text-blue-500">新词</span>}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{
              width: `${((currentIndex + 1) / queue.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.word.id + currentIndex}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{
            opacity: 0,
            x: direction === "right" ? 300 : direction === "left" ? -300 : 0,
            transition: { duration: 0.3 },
          }}
        >
          <WordCard
            word={current.word}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
            disabled={helpVisible}
          />
        </motion.div>
      </AnimatePresence>

      {/* 底部按钮（桌面端备选） */}
      <div className="mt-8 flex gap-6">
        <button
          onClick={handleSwipeLeft}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-200 text-red-400 transition hover:bg-red-50 active:scale-95"
          aria-label="不认识"
        >
          ✕
        </button>
        <button
          onClick={handleSwipeRight}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-green-200 text-green-500 transition hover:bg-green-50 active:scale-95"
          aria-label="认识"
        >
          ✓
        </button>
      </div>

      {/* 助记面板 */}
      <HelpPanel
        word={current.word}
        visible={helpVisible}
        onDismiss={handleHelpDismiss}
      />
    </div>
  );
}
