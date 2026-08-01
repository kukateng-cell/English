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
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
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

/** 当前词处在哪一步：先认字评估，随即立刻测试。 */
type WordStep = "assess" | "quiz";

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
  const { tc } = useLocale();
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-[#17213C]/90 px-5 py-2.5 text-[13px] font-medium text-white shadow-lg backdrop-blur dark:bg-white/90 dark:text-[#17213C]"
        >
          💾 {tc("已恢复上次进度，继续答题吧")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function StudyPage() {
  const { status } = useSession();
  const router = useRouter();
  const { tc } = useLocale();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pool, setPool] = useState<PoolWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [helpVisible, setHelpVisible] = useState(false);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [unitCategory, setUnitCategory] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「下一个单元」按钮的加载态（完成画面用）
  const [nextLoading, setNextLoading] = useState(false);
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

  // 逐词流转：每个词「认字评估 → 立即测试 → 下一词」交替进行。
  // wordStep 表示「当前这个词」处在哪一步；done 表示整轮已全部完成。
  const [wordStep, setWordStep] = useState<WordStep>("assess");
  const [done, setDone] = useState(false);
  const [knownWords, setKnownWords] = useState<WordFull[]>([]);
  const [unknownWords, setUnknownWords] = useState<WordFull[]>([]);

  // 测试统计：每答一次（对/错）累计；答错立即原地重测，直到答对再进入下一词。
  const [quizStats, setQuizStats] = useState({ correct: 0, wrong: 0 });
  // 重测计数器：答错后自增，用来强制重新生成题目（新的干扰项 / 方向）。
  const [quizAttempt, setQuizAttempt] = useState(0);

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
      const needIds = [...cp.knownWordIds, ...cp.unknownWordIds];
      if (needIds.some((id) => !wordMap.has(id))) return false;

      setKnownWords(cp.knownWordIds.map((id) => wordMap.get(id)!));
      setUnknownWords(cp.unknownWordIds.map((id) => wordMap.get(id)!));
      setQuizStats(cp.quizStats);

      // 永远从「认字评估」步开始当前词，不恢复某个词进行到一半的测试状态。
      // 这样用户中途离开后回来，不会被强制回到「上次那个还没测完的词」。
      quizWrongCounts.current = {};
      setQuizAttempt(0);
      setWordStep("assess");

      if (cp.phase === "done" || cp.currentIndex >= loadedQueue.length) {
        setDone(true);
        setCurrentIndex(loadedQueue.length);
      } else {
        setDone(false);
        setCurrentIndex(cp.currentIndex);
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
      setError(null);
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
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return;
        }
        setLocked(false);
        const data = await res.json();
        setQueue(data.queue || []);
        setPool(data.pool || []);
        setUnitCategory(data.unitMode ? data.category : null);
        // 恢复存档点：若有匹配的本地进度，直接续做，无需从头开始
        if (!cancelled && restoreProgress(data.queue || [])) {
          flashResumed();
        }
      } catch (e) {
        if (!cancelled) setError(networkErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, reloadKey, restoreProgress, flashResumed]);

  // 当前词：取队列中 currentIndex 位置。逐词推进，每个词评估完立刻测试。
  const currentWord = queue[currentIndex]?.word ?? null;

  // 当前词的测试题（仅在该词的「测试」步生成）。答错后 quizAttempt 自增，
  // 强制重新出题（新的方向 / 干扰项），让用户原地重测直到答对。
  const currentQuestion = useMemo(() => {
    if (done || wordStep !== "quiz" || !currentWord) return null;
    void quizAttempt; // 答错重测时自增 → 触发重新生成题目
    return buildQuestion(currentWord, distractorSource);
  }, [done, wordStep, currentWord, distractorSource, quizAttempt]);

  // 若当前词无法生成有效配对题（如 DVD↔DVD 这类纯英文词条，或干扰项不足），
  // 自动判对并进入下一词，避免界面卡住。
  useEffect(() => {
    if (done || wordStep !== "quiz" || !currentWord) return;
    if (currentQuestion !== null) return;
    // 用 setTimeout(0) 推迟到下一帧，避免在渲染期间 setState
    const t = setTimeout(() => handleQuizAnswerRef.current(true), 0);
    return () => clearTimeout(t);
  }, [done, wordStep, currentWord, currentQuestion]);

  // 测试作答（必须在所有 early return 之前调用，遵守 Rules of Hooks）
  const handleQuizAnswer = useCallback(
    (correct: boolean) => {
      const word = queue[currentIndex]?.word;
      setQuizStats((s) => ({
        correct: s.correct + (correct ? 1 : 0),
        wrong: s.wrong + (correct ? 0 : 1),
      }));

      if (!correct) {
        // 记录该词答错次数，影响最终掌握评级（quality）。
        if (word) {
          quizWrongCounts.current[word.id] =
            (quizWrongCounts.current[word.id] ?? 0) + 1;
        }
        // 答错：立刻原地重测（重新出题），反复直到答对一次，再进入下一词。
        setQuizAttempt((n) => n + 1);
        return;
      }

      // 答对：依据答错次数计算 quality 并写入 SM-2。
      // 单词的掌握程度完全由测试表现决定，认字阶段的手势不参与记录。
      if (word) {
        const wrongs = quizWrongCounts.current[word.id] ?? 0;
        const quality = wrongs === 0 ? 5 : wrongs === 1 ? 4 : 3;
        submitQuizReview(word.id, quality);
      }

      // 进入下一个词（或整轮完成）
      const nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        // 整轮完成。必须把 wordStep 移出 "quiz"，否则上面的
        // `wordStep === "quiz" && current` 分支会抢先渲染最后一题的测试画面，
        // 把完成画面（含「下一个单元 / 返回单元列表」按钮）挡住。
        setWordStep("assess");
        setDone(true);
      } else {
        setCurrentIndex(nextIndex);
        setWordStep("assess");
        setQuizAttempt(0);
        quizWrongCounts.current = {};
      }
    },
    [currentIndex, queue]
  );

  // 让 ref 始终持有最新的 handleQuizAnswer（在 effect 中同步，避免渲染期写 ref）
  useEffect(() => {
    handleQuizAnswerRef.current = handleQuizAnswer;
  }, [handleQuizAnswer]);

  // 存档点：每完成一步都写入本地存档，方便用户中途离开后续做。
  // 完成时自动清除存档；加载中或队列为空时不写。
  useEffect(() => {
    if (loading || status !== "authenticated") return;
    const unitKey = getUnitKey();
    if (done) {
      clearCheckpoint(unitKey);
      return;
    }
    if (queue.length === 0) return;
    // 一旦进入「测试」步，存档即视为该词已完成：currentIndex 存为下一个词。
    // 这样用户中途离开后再回来，不会被强制回到「上次那个还没测完的词」，
    // 而是直接从下一个新词开始认字评估。
    const savedIndex = wordStep === "quiz" ? currentIndex + 1 : currentIndex;
    saveCheckpoint(unitKey, {
      phase: savedIndex >= queue.length ? "done" : "assess",
      unitKey,
      queueSignature: queue.map((q) => q.word.id),
      currentIndex: savedIndex,
      knownWordIds: knownWords.map((w) => w.id),
      unknownWordIds: unknownWords.map((w) => w.id),
      quizStats,
    });
  }, [
    loading,
    status,
    done,
    wordStep,
    queue,
    currentIndex,
    knownWords,
    unknownWords,
    quizStats,
  ]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
          <span className="text-[14px] text-[#7C89A5] dark:text-[#64748B]">{tc("加载中...")}</span>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  const current = queue[currentIndex];

  // 右滑：认识（仅本地分类，不写记录；掌握与否交给随后的测试判定）
  // 选好「是否认识」后，立刻进入该词的测试步。
  const handleSwipeRight = () => {
    if (!current) return;
    setKnownWords((prev) => [...prev, current.word]);
    setDirection("right");
    setTimeout(() => {
      setDirection(null);
      setWordStep("quiz");
    }, 350);
  };

  // 左滑：不认识 → 展示助记面板（仅本地分类，不写记录）
  const handleSwipeLeft = () => {
    if (!current) return;
    setUnknownWords((prev) => [...prev, current.word]);
    setDirection("left");
    setTimeout(() => setHelpVisible(true), 350);
  };

  // 助记面板关闭 → 立刻进入该词的测试步
  const handleHelpDismiss = () => {
    setHelpVisible(false);
    setDirection(null);
    setTimeout(() => setWordStep("quiz"), 200);
  };

  // 重新开始：清空状态并清除存档点，触发重新拉取
  const restart = () => {
    clearCheckpoint(getUnitKey());
    setQueue([]);
    setPool([]);
    setLocked(false);
    setCurrentIndex(0);
    setWordStep("assess");
    setDone(false);
    setKnownWords([]);
    setUnknownWords([]);
    setQuizStats({ correct: 0, wrong: 0 });
    setQuizAttempt(0);
    quizWrongCounts.current = {};
    setReloadKey((k) => k + 1);
  };

  // 进入「下一个单元」：在当前级别内找当前单元之后的下一个「已解锁且未完成」
  // 单元；当前级别没有了，就跨到下一个已解锁、有未完成单元的级别。
  // 仅单元练习模式可用（全局今日学习模式没有「下一个单元」概念）。
  const goToNextUnit = async () => {
    const params = new URLSearchParams(window.location.search);
    const level = params.get("level");
    const category = params.get("category");
    if (!level || !category) return; // 非单元模式，没有「下一单元」
    setNextLoading(true);
    try {
      // 1) 拿当前级别的单元列表 + 各级别状态
      const data = await fetch(`/api/units?level=${encodeURIComponent(level)}`).then(
        (r) => r.json(),
      );
      type U = { name: string; unlocked: boolean; completed: boolean };
      // 在给定单元列表里挑「当前 category 之后」第一个 unlocked && !completed 的单元
      const findNext = (units: U[], fromCat: string): U | null => {
        const idx = units.findIndex((u) => u.name === fromCat);
        return units.find((u, i) => i > idx && u.unlocked && !u.completed) ?? null;
      };
      const inLevel = findNext((data.units ?? []) as U[], category);
      if (inLevel) {
        window.location.assign(
          `/study?level=${encodeURIComponent(level)}&category=${encodeURIComponent(inLevel.name)}`,
        );
        return;
      }
      // 2) 当前级别没有下一个可练单元 → 跨级别找下一个已解锁、有未完成单元的级别
      const levelStatus: {
        level: string;
        unlocked: boolean;
        completed: boolean;
      }[] = data.levelStatus ?? [];
      const order = [level, ...levelStatus.map((l) => l.level)];
      const seen = new Set<string>();
      for (const lvl of [...new Set(order)]) {
        if (seen.has(lvl) || lvl === level) {
          seen.add(lvl);
          continue;
        }
        seen.add(lvl);
        const st = levelStatus.find((l) => l.level === lvl);
        if (!st?.unlocked) continue; // 级别未解锁
        const ld = await fetch(`/api/units?level=${encodeURIComponent(lvl)}`).then((r) =>
          r.json(),
        );
        const first = (ld.units ?? []).find(
          (u: U) => u.unlocked && !u.completed,
        );
        if (first) {
          window.location.assign(
            `/study?level=${encodeURIComponent(lvl)}&category=${encodeURIComponent(first.name)}`,
          );
          return;
        }
      }
      // 3) 所有可练单元都已完成 → 回单元列表
      window.location.assign("/units");
    } catch {
      setNextLoading(false);
    }
  };

  // ───────── 被锁单元渲染（仅手动改 URL 访问锁住单元时出现） ─────────
  if (locked) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-[#FEF3C7] dark:bg-[#291800]">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">{tc("单元尚未解锁")}</h2>
        <p className="mb-8 max-w-xs text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
          {tc("请先回到单元列表，按顺序把前面的单元认字率练到 80% 以上，即可解锁这个单元。")}
        </p>
        <div className="flex items-center gap-6 text-[14px]">
          <Link
            href="/units"
            className="font-medium text-[#2563EB] transition hover:text-[#1D4ED8] dark:text-[#60A5FA] dark:hover:text-[#93BBFD]"
          >
            {tc("← 返回单元列表")}
          </Link>
          <Link href="/" className="text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]">
            {tc("返回首页")}
          </Link>
        </div>
      </div>
    );
  }

  // ───────── 当前词测试步渲染（认字评估后立刻测试该词） ─────────
  if (wordStep === "quiz" && current) {
    // 以「词」为单位的进度：当前是第几个词 / 总词数
    const progressPct =
      queue.length > 0 ? (currentIndex / queue.length) * 100 : 0;

    return (
      <div className="flex min-h-full flex-col pb-24">
        <ResumeToast visible={showResumedBanner} />
        <SpeechRateControl />

        {/* 顶部导航栏 */}
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pt-5 pb-3">
          <Link
            href="/units"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB] transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:text-[#60A5FA] dark:hover:bg-[#1E40AF]/30"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-[14px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            {tc("📝 测试中")}
          </span>
          <div className="w-9" />
        </div>

        {/* 单元上下文 */}
        {unitCategory && (
          <div className="mx-auto mb-4 flex w-full max-w-md px-5">
            <div className="flex items-center gap-2 rounded-full bg-[#EEF4FF] px-4 py-1.5 text-[13px] font-medium text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
              <span>{tc(unitCategory)}</span>
            </div>
          </div>
        )}

        {/* 进度条（以「词」为单位） */}
        <div className="mx-auto mb-5 w-full max-w-md px-5">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-medium text-[#2563EB] dark:text-[#60A5FA]">
              {tc(`第 ${currentIndex + 1} / ${queue.length} 词`)}
            </span>
            <span className="text-[#7C89A5] dark:text-[#64748B]">
              {tc(`答对 ${quizStats.correct} · 答错 ${quizStats.wrong}`)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#E7EDF8] dark:bg-[#1E293B]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
              style={{ width: `${progressPct}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* 题目卡片 */}
        <div className="flex-1">
          <AnimatePresence mode="wait">
            {currentQuestion && (
              <motion.div
                key={
                  currentQuestion.word.id + quizAttempt + currentQuestion.direction
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
      </div>
    );
  }

  // ───────── 加载失败渲染 ─────────
  // 必须放在「完成」分支之前：fetch 出错时 queue 为空、loading 为 false，
  // 否则会被下面的 done 分支当成「今日无词」误报「全部完成」。
  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
        <ErrorBanner
          message={error}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  // ───────── 完成渲染 ─────────
  if (done || (queue.length === 0 && !loading)) {
    const hasQuiz = quizStats.correct + quizStats.wrong > 0;
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-[#ECFDF5] dark:bg-[#052E16]">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12l3 3 5-5" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-[#17213C] dark:text-[#E2E8F0]">
          {hasQuiz ? tc("测试完成！") : tc("全部完成！")}
        </h2>
        {hasQuiz ? (
          <p className="mb-8 max-w-xs text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
            {tc(`本次共 ${knownWords.length + unknownWords.length} 词，你认识`)}{" "}
            {knownWords.length}{tc(` 个、不认识 `)}{unknownWords.length}{tc(` 个。`)}
            <br />
            {tc(`测试答对 ${quizStats.correct} 题、答错 ${quizStats.wrong} 题，全部攻克！`)}
          </p>
        ) : (
          <p className="mb-8 max-w-xs text-[14px] leading-relaxed text-[#7C89A5] dark:text-[#64748B]">
            {tc("今天没有更多单词了，明天再来复习吧")}
          </p>
        )}
        <div className="flex flex-col items-center gap-3">
          {unitCategory ? (
            // 单元练习模式：主按钮 = 下一个单元；找不到可练单元时回退到 /units
            <button
              onClick={goToNextUnit}
              disabled={nextLoading}
              className="flex h-[44px] min-w-[160px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-8 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98] disabled:opacity-60"
            >
              {nextLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {tc("加载中...")}
                </>
              ) : (
                <>
                  {tc("下一个单元")}
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </>
              )}
            </button>
          ) : (
            // 全局今日学习模式：主按钮 = 刷新今日单词
            <button
              onClick={restart}
              className="flex h-[44px] min-w-[160px] items-center justify-center rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#5B6FEF] px-8 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.18)] transition-all hover:shadow-[0_12px_30px_rgba(37,99,235,0.25)] active:scale-[0.98]"
            >
              {tc("刷新单词")}
            </button>
          )}
          <div className="flex items-center gap-6 text-[14px]">
            <Link
              href="/units"
              className="font-medium text-[#2563EB] transition hover:text-[#1D4ED8] dark:text-[#60A5FA] dark:hover:text-[#93BBFD]"
            >
              {tc("← 返回单元列表")}
            </Link>
            <Link
              href="/"
              className="text-[#7C89A5] transition hover:text-[#17213C] dark:text-[#64748B] dark:hover:text-[#E2E8F0]"
            >
              {tc("返回首页")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  // ───────── 认字评估阶段渲染 ─────────
  return (
    <div className="flex min-h-full flex-col pb-24">
      <ResumeToast visible={showResumedBanner} />
      <SpeechRateControl />

      {/* 顶部导航栏 */}
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 pt-5 pb-3">
        <Link
          href="/units"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#2563EB] transition hover:bg-[#DBEAFE] active:scale-[0.95] dark:bg-[#1E3A5F] dark:text-[#60A5FA] dark:hover:bg-[#1E40AF]/30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>

        <div className="text-center">
          <span className="text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
            {tc("今日学习 · 认识这个单词吗？")}
          </span>
        </div>

        <div className="w-9" />
      </div>

      {/* 单元上下文 */}
      {unitCategory && (
        <div className="mx-auto mb-4 flex w-full max-w-md px-4">
          <div className="flex items-center gap-2 rounded-full bg-[#EEF4FF] px-4 py-1.5 text-[13px] font-medium text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
            <Link href="/units" className="hover:underline">
              {tc("← 单元列表")}
            </Link>
            <span className="opacity-40">·</span>
            <span>{tc(unitCategory)}</span>
          </div>
        </div>
      )}

      {/* 进度信息 */}
      <div className="mx-auto mb-6 w-full max-w-md px-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[24px] font-bold tabular-nums text-[#17213C] dark:text-[#E2E8F0]">
              {currentIndex + 1}
            </span>
            <span className="text-[14px] text-[#7C89A5] dark:text-[#64748B]">
              / {queue.length}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="font-medium text-[#22C55E] dark:text-[#4ADE80]">{tc("认识")} {knownWords.length}</span>
            <span className="text-[#E7EDF8] dark:text-[#1E293B]">·</span>
            <span className="font-medium text-[#EF6B6B] dark:text-[#F87171]">{tc("不认识")} {unknownWords.length}</span>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#E7EDF8] dark:bg-[#1E293B]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#5B6FEF]"
            style={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* 卡片区域 */}
      <div className="flex-1 flex w-full flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.word.id + currentIndex}
            className="w-full"
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
        <div className="mt-6 flex w-full justify-center gap-10 px-5">
          <button
            onClick={handleSwipeLeft}
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#FECACA] text-xl text-[#EF6B6B] transition hover:bg-[#FEF2F2] active:scale-95 dark:border-[#7F1D1D] dark:hover:bg-[#2D0B0B]"
            aria-label="不认识"
          >
            ✕
          </button>
          <button
            onClick={handleSwipeRight}
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#BBF7D0] text-xl text-[#22C55E] transition hover:bg-[#ECFDF5] active:scale-95 dark:border-[#14532D] dark:hover:bg-[#052E16]"
            aria-label="认识"
          >
            ✓
          </button>
        </div>
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
