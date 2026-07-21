"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import WordCard from "@/components/WordCard";
import HelpPanel from "@/components/HelpPanel";
import QuizCard, {
  type QuizQuestion,
  type QuizOption,
} from "@/components/QuizCard";

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

interface PoolWord {
  id: string;
  term: string;
  definition: string;
}

type Phase = "assessment" | "quiz" | "done";

/** 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 为一个词构造一道配对题（中→英 / 英→中 随机） */
function buildQuestion(word: WordFull, source: PoolWord[]): QuizQuestion {
  const direction: "en-zh" | "zh-en" =
    Math.random() < 0.5 ? "en-zh" : "zh-en";
  const isEnZh = direction === "en-zh";
  const answerText = isEnZh ? word.definition : word.term;

  const correctOption: QuizOption = {
    id: word.id,
    text: answerText,
  };

  // 干扰项：排除答案词本身与同义文本
  const candidates = source.filter((w) => {
    if (w.id === word.id) return false;
    const text = isEnZh ? w.definition : w.term;
    return text !== answerText;
  });

  const distractors: QuizOption[] = [];
  const seen = new Set<string>([answerText]);
  for (const w of shuffle(candidates)) {
    const text = isEnZh ? w.definition : w.term;
    if (seen.has(text)) continue;
    seen.add(text);
    distractors.push({ id: w.id, text });
    if (distractors.length >= 3) break;
  }

  const options = shuffle([correctOption, ...distractors]);
  return { word, direction, options, correctId: word.id };
}

export default function StudyPage() {
  const { status } = useSession();
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pool, setPool] = useState<PoolWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [helpVisible, setHelpVisible] = useState(false);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  // 阶段流转：认字评估 → 测试 → 完成
  const [phase, setPhase] = useState<Phase>("assessment");
  const [knownWords, setKnownWords] = useState<WordFull[]>([]);
  const [unknownWords, setUnknownWords] = useState<WordFull[]>([]);

  // 测试阶段状态
  const [quizQueue, setQuizQueue] = useState<WordFull[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizTotal, setQuizTotal] = useState(0); // 题目总数（含重做，用于进度）
  const [quizAnswered, setQuizAnswered] = useState(0); // 已答次数
  const [quizStats, setQuizStats] = useState({
    correct: 0,
    wrong: 0,
  });

  // 干扰项来源池：外部词 + 本次评估队列词
  const distractorSource: PoolWord[] = useMemo(
    () => [
      ...pool,
      ...queue.map((q) => ({
        id: q.word.id,
        term: q.word.term,
        definition: q.word.definition,
      })),
    ],
    [pool, queue]
  );

  // 认证检查
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  // 加载队列（仅在首次认证通过时）
  useEffect(() => {
    if (status === "authenticated" && !initialized.current) {
      initialized.current = true;
      (async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/study");
          if (res.ok) {
            const data = await res.json();
            setQueue(data.queue || []);
            setPool(data.pool || []);
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [status]);

  // 测试阶段的当前题目（由 quizIndex 派生，不再用 effect 驱动）
  const currentQuestion = useMemo(() => {
    if (phase !== "quiz") return null;
    if (quizIndex >= quizQueue.length) return null;
    return buildQuestion(quizQueue[quizIndex], distractorSource);
  }, [phase, quizIndex, quizQueue, distractorSource]);

  // 评估阶段全部滑完 → 进入测试或完成阶段
  // （在事件回调里触发，避免在 effect 内 setState，符合 react-hooks 规则）
  const transitionFromAssessment = (
    known: WordFull[],
    unknown: WordFull[]
  ) => {
    const qq = [...known, ...unknown];
    if (qq.length === 0) {
      setPhase("done");
    } else {
      setQuizQueue(qq);
      setQuizTotal(qq.length);
      setQuizIndex(0);
      setQuizAnswered(0);
      setPhase("quiz");
    }
  };

  // 测试作答（必须在所有 early return 之前调用，遵守 Rules of Hooks）
  const handleQuizAnswer = useCallback(
    (correct: boolean) => {
      setQuizAnswered((n) => n + 1);
      setQuizStats((s) => ({
        correct: s.correct + (correct ? 1 : 0),
        wrong: s.wrong + (correct ? 0 : 1),
      }));

      const nextIndex = quizIndex + 1;

      if (!correct) {
        // 答错：把这个词插到 2~3 题之后重新考，趁记忆新鲜立刻复习，
        // 反复出题直到答对一次为止（不再算作"已掌握"）。
        setQuizQueue((prev) => {
          const wrongWord = prev[quizIndex];
          if (!wrongWord) return prev;
          const insertAt = Math.min(
            quizIndex + 2 + Math.floor(Math.random() * 2), // 当前位置后 2~3 题
            prev.length
          );
          const next = [...prev];
          next.splice(insertAt, 0, wrongWord);
          return next;
        });
        setQuizTotal((n) => n + 1);
        setQuizIndex(nextIndex);
      } else {
        // 答对：若是最后一题则进入完成阶段，否则进入下一题
        if (nextIndex >= quizQueue.length) {
          setPhase("done");
        } else {
          setQuizIndex(nextIndex);
        }
      }
    },
    [quizIndex, quizQueue.length]
  );

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  const current = queue[currentIndex];

  // 提交滑动结果（更新 SM-2）
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
    if (!current) return;
    // 记下本次加入后的「认识」列表（供本回调内判断阶段转换使用）
    const newKnown = [...knownWords, current.word];
    setKnownWords(newKnown);
    setDirection("right");
    await submitReview("right");
    setTimeout(() => {
      // 若是评估阶段最后一张，则进入测试 / 完成；否则进入下一张
      if (currentIndex + 1 >= queue.length) {
        transitionFromAssessment(newKnown, unknownWords);
      } else {
        setCurrentIndex((i) => i + 1);
      }
      setDirection(null);
    }, 350);
  };

  // 左滑：不认识 → 展示助记面板
  const handleSwipeLeft = async () => {
    if (!current) return;
    setUnknownWords((prev) => [...prev, current.word]);
    await submitReview("left");
    setDirection("left");
    setTimeout(() => setHelpVisible(true), 350);
  };

  // 助记面板关闭 → 下一个单词
  const handleHelpDismiss = () => {
    setHelpVisible(false);
    setDirection(null);
    setTimeout(() => {
      // 若是评估阶段最后一张，则进入测试 / 完成；否则进入下一张
      if (currentIndex + 1 >= queue.length) {
        transitionFromAssessment(knownWords, unknownWords);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    }, 200);
  };

  // 重新开始（清空状态重新拉取）
  const restart = () => {
    initialized.current = false;
    setQueue([]);
    setPool([]);
    setCurrentIndex(0);
    setPhase("assessment");
    setKnownWords([]);
    setUnknownWords([]);
    setQuizQueue([]);
    setQuizIndex(0);
    setQuizTotal(0);
    setQuizAnswered(0);
    setQuizStats({ correct: 0, wrong: 0 });
  };

  // ───────── 测试阶段渲染 ─────────
  if (phase === "quiz") {
    const remaining = Math.max(0, quizQueue.length - quizIndex);
    const progressPct = quizTotal > 0 ? (quizAnswered / quizTotal) * 100 : 0;

    return (
      <div className="flex min-h-full flex-col items-center justify-center pb-20">
        {/* 顶部进度 */}
        <div className="mb-6 w-full max-w-md px-4">
          <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
            <span className="font-medium text-blue-600">📝 测试</span>
            <span>
              剩余 {remaining} 题 · 答对 {quizStats.correct} · 答错{" "}
              {quizStats.wrong}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {currentQuestion && (
            <motion.div
              key={
                currentQuestion.word.id + quizIndex + currentQuestion.direction
              }
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
            >
              <QuizCard
                question={currentQuestion}
                onAnswer={handleQuizAnswer}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ───────── 完成渲染 ─────────
  if (phase === "done" || (queue.length === 0 && !loading)) {
    const hasQuiz = quizStats.correct + quizStats.wrong > 0;
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
        <p className="text-4xl mb-4">🎉</p>
        <h2 className="text-xl font-bold text-zinc-900 mb-2">
          {hasQuiz ? "测试完成！" : "全部完成！"}
        </h2>
        {hasQuiz ? (
          <p className="text-sm text-zinc-500 mb-6">
            本次共 {knownWords.length + unknownWords.length} 词，你认识{" "}
            {knownWords.length} 个、不认识 {unknownWords.length} 个。
            <br />
            测试答对 {quizStats.correct} 题、答错 {quizStats.wrong} 题，全部攻克！
          </p>
        ) : (
          <p className="text-sm text-zinc-500 mb-6">
            今天没有更多单词了，明天再来复习吧
          </p>
        )}
        <button
          onClick={restart}
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          刷新单词
        </button>
      </div>
    );
  }

  if (!current) return null;

  // ───────── 认字评估阶段渲染 ─────────
  return (
    <div className="flex min-h-full flex-col items-center justify-center pb-20">
      {/* 顶部进度 */}
      <div className="mb-6 w-full max-w-md px-4">
        <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
          <span>
            <span className="font-medium text-zinc-600">👀 认字</span>{" "}
            <span className="ml-2">
              {currentIndex + 1} / {queue.length}
            </span>
          </span>
          <span>
            <span className="text-green-500">认识 {knownWords.length}</span>
            {" · "}
            <span className="text-red-400">
              不认识 {unknownWords.length}
            </span>
          </span>
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
