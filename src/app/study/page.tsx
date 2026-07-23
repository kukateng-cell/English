"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import WordCard from "@/components/WordCard";
import HelpPanel from "@/components/HelpPanel";
import SpeechRateControl from "@/components/SpeechRateControl";
import QuizCard, {
  type QuizQuestion,
  type QuizOption,
} from "@/components/QuizCard";
import { warmUpSpeech } from "@/lib/speech";
import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
} from "@/lib/checkpoint";

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

/** 是否包含中日韩字符（用来判定「中文释义」是否真的是中文） */
function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/**
 * 判断一个词能否生成有意义的配对题。
 * 像 `DVD — DVD` / `Wi-Fi — Wi-Fi` 这类「英文 ↔ 英文」的词条，
 * 无论哪个方向都会出现「英文配英文」，必须从配对题里剔除。
 */
function isQuizzable(word: { term: string; definition: string }): boolean {
  return (
    hasCJK(word.definition) && // 释义必须是中文
    word.definition.trim().length > 0 &&
    word.term.trim().length > 0 &&
    word.term.trim() !== word.definition.trim() // 排除 term === definition
  );
}

/** 为一个词构造一道配对题（中→英 / 英→中 随机）；无法出题时返回 null */
function buildQuestion(
  word: WordFull,
  source: PoolWord[]
): QuizQuestion | null {
  if (!isQuizzable(word)) return null;

  const direction: "en-zh" | "zh-en" =
    Math.random() < 0.5 ? "en-zh" : "zh-en";
  const isEnZh = direction === "en-zh";
  const answerText = isEnZh ? word.definition : word.term;

  const correctOption: QuizOption = {
    id: word.id,
    text: answerText,
  };

  // 干扰项筛选规则：
  //  1. 排除词条自身；
  //  2. 排除与正确答案文字相同的项（去重）；
  //  3. 保证干扰项与正确答案处于同一语言：
  //     - en-zh（给英文选中文）：干扰项释义必须也是中文；
  //     - zh-en（给中文选英文）：干扰项 term 必须非中文；
  //  4. 排除「同义替代答案」：在 zh-en 方向，若某词的中文释义与题目相同
  //     （如「严重的」同时对应 severe / serious / nasty），把它当干扰项会
  //     让用户「选了正确翻译却被判错」，必须剔除。en-zh 方向同理剔除
  //     term 与题目 term 相同的重复词条。
  const candidates = source.filter((w) => {
    if (w.id === word.id) return false;
    const text = isEnZh ? w.definition : w.term;
    if (text.trim() === answerText.trim()) return false;
    if (isEnZh) {
      // 干扰项必须是中文释义
      if (!hasCJK(text)) return false;
      // 排除 term 与题目 term 相同的重复词条（避免同英文多释义造成混淆）
      if (w.term.trim() === word.term.trim()) return false;
    } else {
      // 干扰项 term 不应是中文
      if (hasCJK(text)) return false;
      // 排除「释义与题目相同」的同义词 —— 它们是替代正确答案
      if (w.definition.trim() === word.definition.trim()) return false;
    }
    return true;
  });

  const distractors: QuizOption[] = [];
  const seen = new Set<string>([answerText.trim().toLowerCase()]);
  for (const w of shuffle(candidates)) {
    const text = isEnZh ? w.definition : w.term;
    const key = text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push({ id: w.id, text });
    if (distractors.length >= 3) break;
  }

  // 若有效干扰项不足 3 个，这道题质量不够，直接跳过
  if (distractors.length < 3) return null;

  const options = shuffle([correctOption, ...distractors]);
  return { word, direction, options, correctId: word.id };
}

/**
 * 提交测试结果（更新 SM-2）。
 * 只有测试阶段「答对」的词才会调用，确保单词的掌握记录来自真实的测试表现，
 * 而非认字阶段的自我评估手势。
 */
function submitQuizReview(wordId: string, quality: number) {
  void fetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wordId, quality }),
  });
}

/**
 * 当前答题上下文的存档点 key：
 * - 单元练习模式：`${level}::${category}`
 * - 全局今日队列：`'global'`
 * 仅在浏览器端调用（均在 effect / 事件回调中读取 window）。 */
function getUnitKey(): string {
  if (typeof window === "undefined") return "global";
  const params = new URLSearchParams(window.location.search);
  const level = params.get("level");
  const category = params.get("category");
  return level && category ? `${level}::${category}` : "global";
}

/** 顶部「已恢复上次进度」轻提示。 */
function ResumeToast({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-zinc-100/90 dark:text-zinc-900"
        >
          💾 已恢复上次进度，继续答题吧
        </motion.div>
      )}
    </AnimatePresence>
  );
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
  const [reloadKey, setReloadKey] = useState(0);
  const [unitCategory, setUnitCategory] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // 始终指向最新的 handleQuizAnswer，供 effect 调用而不破坏其依赖数组
  const handleQuizAnswerRef = useRef<(correct: boolean) => void>(() => {});
  // 测试阶段每个词的答错次数，决定最终 SM-2 quality（0 错=5、1 错=4、≥2 错=3）
  const quizWrongCounts = useRef<Record<string, number>>({});

  // 「已恢复上次进度」轻提示
  const [showResumedBanner, setShowResumedBanner] = useState(false);
  const resumedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashResumed = useCallback(() => {
    setShowResumedBanner(true);
    if (resumedTimerRef.current) clearTimeout(resumedTimerRef.current);
    resumedTimerRef.current = setTimeout(
      () => setShowResumedBanner(false),
      2600,
    );
  }, []);

  // 组件卸载时清理提示计时器
  useEffect(
    () => () => {
      if (resumedTimerRef.current) clearTimeout(resumedTimerRef.current);
    },
    [],
  );

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

  // 预热语音引擎：让浏览器提前加载英文 voice，
  // 避免首次点击「发音」时出现吞音 / 卡顿。
  useEffect(() => {
    warmUpSpeech();
  }, []);

  /**
   * 尝试用本地存档点恢复进度。返回是否成功恢复。
   * 仅在刚从服务端拉取到队列后调用一次：用队列重建 WordFull，
   * 若存档与当前队列指纹不一致或引用了不存在的词，则视为过期并丢弃。
   */
  const restoreProgress = useCallback(
    (loadedQueue: QueueItem[]): boolean => {
      const unitKey = getUnitKey();
      const cp = loadCheckpoint(unitKey);
      if (!cp) return false;

      // 用「词的集合」比对而非顺序：单元练习的服务端队列会按 SM-2 状态
      // （未学/到期/已排期）重排，同一单元两次访问顺序可能不同，但词集合稳定。
      // 全局模式下若换天导致队列变化，集合不一致 → 视为过期、从头开始。
      const loadedIds = new Set(loadedQueue.map((q) => q.word.id));
      const cpSet = new Set(cp.queueSignature);
      const sigMatch =
        loadedIds.size === cpSet.size &&
        [...loadedIds].every((id) => cpSet.has(id));
      if (!sigMatch) return false;

      const wordMap = new Map(loadedQueue.map((q) => [q.word.id, q.word]));
      const needIds = [
        ...cp.knownWordIds,
        ...cp.unknownWordIds,
        ...cp.quizQueueIds,
      ];
      if (needIds.some((id) => !wordMap.has(id))) return false;

      setKnownWords(cp.knownWordIds.map((id) => wordMap.get(id)!));
      setUnknownWords(cp.unknownWordIds.map((id) => wordMap.get(id)!));
      quizWrongCounts.current = cp.quizWrongCounts ?? {};

      if (cp.phase === "quiz") {
        setQuizQueue(cp.quizQueueIds.map((id) => wordMap.get(id)!));
        setQuizTotal(cp.quizTotal);
        setQuizIndex(cp.quizIndex);
        setQuizAnswered(cp.quizAnswered);
        setQuizStats(cp.quizStats);
        setPhase("quiz");
      } else {
        // assessment（done 不恢复，已完成无需续做）
        setCurrentIndex(cp.currentIndex);
        setPhase("assessment");
      }
      return true;
    },
    [],
  );

  // 加载队列：认证通过后，以及每次 restart（reloadKey 变化）触发。
  // 通过 URL query 决定是「全局今日队列」还是「指定单元练习」。
  // 用内联 async IIFE 触发请求，符合 react-hooks/set-state-in-effect 规则。
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(window.location.search);
        const res = await fetch(`/api/study?${params.toString()}`);
        if (cancelled) return;
        if (res.status === 403) {
          // 被锁单元：直接访问 URL 才会走到这里（/units 列表已禁用入口）
          setLocked(true);
          setQueue([]);
          setPool([]);
          setUnitCategory(null);
          return;
        }
        if (!res.ok) return;
        setLocked(false);
        const data = await res.json();
        setQueue(data.queue || []);
        setPool(data.pool || []);
        setUnitCategory(data.unitMode ? data.category : null);
        // 恢复存档点：若有匹配的本地进度，直接续做，无需从头开始
        if (!cancelled && restoreProgress(data.queue || [])) {
          flashResumed();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, reloadKey, restoreProgress, flashResumed]);

  // 测试阶段的当前题目（由 quizIndex 派生，不再用 effect 驱动）
  const currentQuestion = useMemo(() => {
    if (phase !== "quiz") return null;
    if (quizIndex >= quizQueue.length) return null;
    return buildQuestion(quizQueue[quizIndex], distractorSource);
  }, [phase, quizIndex, quizQueue, distractorSource]);

  // 若当前词无法生成有效配对题（如 DVD↔DVD 这类纯英文词条，或干扰项不足），
  // 自动判对并跳到下一题，避免界面卡住。
  useEffect(() => {
    if (phase !== "quiz") return;
    if (quizIndex >= quizQueue.length) return;
    if (currentQuestion !== null) return;
    // 用 setTimeout(0) 推迟到下一帧，避免在渲染期间 setState
    const t = setTimeout(() => handleQuizAnswerRef.current(true), 0);
    return () => clearTimeout(t);
  }, [phase, quizIndex, quizQueue.length, currentQuestion]);

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
      quizWrongCounts.current = {};
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
      const word = quizQueue[quizIndex];
      setQuizAnswered((n) => n + 1);
      setQuizStats((s) => ({
        correct: s.correct + (correct ? 1 : 0),
        wrong: s.wrong + (correct ? 0 : 1),
      }));

      const nextIndex = quizIndex + 1;

      if (!correct) {
        // 记录该词答错次数，影响最终掌握评级（quality）。
        if (word) {
          quizWrongCounts.current[word.id] =
            (quizWrongCounts.current[word.id] ?? 0) + 1;
        }
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
        // 答对：依据答错次数计算 quality 并写入 SM-2。
        // 认字阶段不再记录，单词的掌握程度完全由测试表现决定。
        if (word) {
          const wrongs = quizWrongCounts.current[word.id] ?? 0;
          const quality = wrongs === 0 ? 5 : wrongs === 1 ? 4 : 3;
          submitQuizReview(word.id, quality);
        }
        // 若是最后一题则进入完成阶段，否则进入下一题
        if (nextIndex >= quizQueue.length) {
          setPhase("done");
        } else {
          setQuizIndex(nextIndex);
        }
      }
    },
    [quizIndex, quizQueue]
  );

  // 让 ref 始终持有最新的 handleQuizAnswer（在 effect 中同步，避免渲染期写 ref）
  useEffect(() => {
    handleQuizAnswerRef.current = handleQuizAnswer;
  }, [handleQuizAnswer]);

  // 存档点：每答完一题（认字 / 测试）都会写入本地存档，方便用户中途离开后续做。
  // 完成阶段自动清除存档；加载中或队列为空时不写。recycle。
  useEffect(() => {
    if (loading || status !== "authenticated") return;
    const unitKey = getUnitKey();
    if (phase === "done") {
      clearCheckpoint(unitKey);
      return;
    }
    if (queue.length === 0) return;
    saveCheckpoint(unitKey, {
      phase,
      unitKey,
      queueSignature: queue.map((q) => q.word.id),
      currentIndex,
      knownWordIds: knownWords.map((w) => w.id),
      unknownWordIds: unknownWords.map((w) => w.id),
      quizQueueIds: quizQueue.map((w) => w.id),
      quizIndex,
      quizTotal,
      quizAnswered,
      quizStats,
      quizWrongCounts: quizWrongCounts.current,
    });
  }, [
    loading,
    status,
    phase,
    queue,
    currentIndex,
    knownWords,
    unknownWords,
    quizQueue,
    quizIndex,
    quizTotal,
    quizAnswered,
    quizStats,
  ]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  const current = queue[currentIndex];

  // 右滑：认识（仅本地分类，不写记录；掌握与否交给后续测试判定）
  const handleSwipeRight = () => {
    if (!current) return;
    // 记下本次加入后的「认识」列表（供本回调内判断阶段转换使用）
    const newKnown = [...knownWords, current.word];
    setKnownWords(newKnown);
    setDirection("right");
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

  // 左滑：不认识 → 展示助记面板（仅本地分类，不写记录）
  const handleSwipeLeft = () => {
    if (!current) return;
    setUnknownWords((prev) => [...prev, current.word]);
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

  // 重新开始：清空状态并清除存档点，触发重新拉取
  const restart = () => {
    clearCheckpoint(getUnitKey());
    setQueue([]);
    setPool([]);
    setLocked(false);
    setCurrentIndex(0);
    setPhase("assessment");
    setKnownWords([]);
    setUnknownWords([]);
    setQuizQueue([]);
    setQuizIndex(0);
    setQuizTotal(0);
    setQuizAnswered(0);
    setQuizStats({ correct: 0, wrong: 0 });
    quizWrongCounts.current = {};
    setReloadKey((k) => k + 1);
  };

  // ───────── 被锁单元渲染（仅手动改 URL 访问锁住单元时出现） ─────────
  if (locked) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-4 text-center">
        <p className="text-4xl mb-4">🔒</p>
        <h2 className="text-xl font-bold text-zinc-900 mb-2 dark:text-zinc-50">单元尚未解锁</h2>
        <p className="text-sm text-zinc-500 mb-6 dark:text-zinc-400">
          请先回到单元列表，按顺序把前面的单元认字率练到 80% 以上，
          即可解锁这个单元。
        </p>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/units"
            className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← 返回单元列表
          </Link>
          <Link href="/" className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  // ───────── 测试阶段渲染 ─────────
  if (phase === "quiz") {
    const remaining = Math.max(0, quizQueue.length - quizIndex);
    const progressPct = quizTotal > 0 ? (quizAnswered / quizTotal) * 100 : 0;

    return (
      <div className="flex min-h-full flex-col items-center justify-center pb-20">
        <ResumeToast visible={showResumedBanner} />
        <SpeechRateControl />
        {/* 单元上下文（仅单元练习模式显示） */}
        {unitCategory && (
          <div className="mb-4 flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-300">
            <Link href="/units" className="hover:underline">
              ← 单元列表
            </Link>
            <span className="text-blue-300 dark:text-blue-700">·</span>
            <span>{unitCategory}</span>
          </div>
        )}

        {/* 顶部进度 */}
        <div className="mb-6 w-full max-w-md px-4">
          <div className="flex items-center justify-between text-sm text-zinc-400 mb-2 dark:text-zinc-500">
            <span className="font-medium text-blue-600 dark:text-blue-400">📝 测试</span>
            <span>
              剩余 {remaining} 题 · 答对 {quizStats.correct} · 答错{" "}
              {quizStats.wrong}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
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
        <h2 className="text-xl font-bold text-zinc-900 mb-2 dark:text-zinc-50">
          {hasQuiz ? "测试完成！" : "全部完成！"}
        </h2>
        {hasQuiz ? (
          <p className="text-sm text-zinc-500 mb-6 dark:text-zinc-400">
            本次共 {knownWords.length + unknownWords.length} 词，你认识{" "}
            {knownWords.length} 个、不认识 {unknownWords.length} 个。
            <br />
            测试答对 {quizStats.correct} 题、答错 {quizStats.wrong} 题，全部攻克！
          </p>
        ) : (
          <p className="text-sm text-zinc-500 mb-6 dark:text-zinc-400">
            今天没有更多单词了，明天再来复习吧
          </p>
        )}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={restart}
            className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {unitCategory ? "再练一轮" : "刷新单词"}
          </button>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/units"
              className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              ← 返回单元列表
            </Link>
            <Link
              href="/"
              className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  // ───────── 认字评估阶段渲染 ─────────
  return (
    <div className="flex min-h-full flex-col items-center justify-center pb-20">
      <ResumeToast visible={showResumedBanner} />
      <SpeechRateControl />
      {/* 单元上下文（仅单元练习模式显示） */}
      {unitCategory && (
        <div className="mb-4 flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-300">
          <Link href="/units" className="hover:underline">
            ← 单元列表
          </Link>
          <span className="text-blue-300 dark:text-blue-700">·</span>
          <span>{unitCategory}</span>
        </div>
      )}

      {/* 顶部进度 */}
      <div className="mb-6 w-full max-w-md px-4">
        <div className="flex items-center justify-between text-sm text-zinc-400 mb-2 dark:text-zinc-500">
          <span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">👀 认字</span>{" "}
            <span className="ml-2">
              {currentIndex + 1} / {queue.length}
            </span>
          </span>
          <span>
            <span className="text-green-500 dark:text-green-400">认识 {knownWords.length}</span>
            {" · "}
            <span className="text-red-400 dark:text-red-400">
              不认识 {unknownWords.length}
            </span>
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
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
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-200 text-red-400 transition hover:bg-red-50 active:scale-95 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          aria-label="不认识"
        >
          ✕
        </button>
        <button
          onClick={handleSwipeRight}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-green-200 text-green-500 transition hover:bg-green-50 active:scale-95 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950"
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
