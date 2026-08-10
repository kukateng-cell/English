"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import WordCard, {
  type WordCardMotionProbe,
} from "@/components/WordCard";
import HelpPanel from "@/components/HelpPanel";
import SpeechRateControl from "@/components/SpeechRateControl";
import QuizCard, {
  type QuizQuestion,
  type QuizOption,
} from "@/components/QuizCard";
import { warmUpSpeech } from "@/lib/speech";
import ErrorBanner from "@/components/ErrorBanner";
import { useLocale } from "@/components/LocaleProvider";
import StreakBadge from "@/components/StreakBadge";
import LogoutButton from "@/components/LogoutButton";
import StreakCalendar from "@/components/StreakCalendar";
import type { StreakInfo } from "@/lib/streak";
import type { AchievementDef } from "@/lib/achievements";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  updateCheckpointStudySession,
} from "@/lib/checkpoint";
import {
  enqueuePendingReview,
  attachStudySessionCredentials,
  finalizeLegacyCredentialClaims,
  flushPendingReviews,
  loadPendingReviews,
  rebindStudySessionCredentials,
  pendingReviewCount,
  blockedReviewCount,
  blockedReviewMessage,
  discardBlockedReviews,
  discardPendingReview,
  legacyReviewCount,
  claimLegacyReviews,
  discardLegacyReviews,
  parseReviewQueueMutationEvent,
  planReviewQueueMutation,
  reviewQueueItemStoragePrefix,
  reviewQueueMutationStorageKey,
  ReviewQueueStorageError,
  type ReviewQueueMutationPlan,
  type ReviewSubmissionCredentials,
} from "@/lib/review-queue";
import { canResumeStudySession } from "@/lib/study-session";

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

interface StudySessionInfo {
  id: string;
  expiresAt: string;
  nonces: Record<string, string>;
}

interface StudyQueueResponse {
  queue?: QueueItem[];
  pool?: PoolWord[];
  unitMode?: boolean;
  category?: string | null;
  streak?: StreakInfo | null;
  studySession?: StudySessionInfo | null;
}

interface PendingFlushOutcome {
  remaining: number;
  submittedWordIds: string[];
  adoptedWordIds: string[];
  storageError: boolean;
}

type ReconcileResult =
  | { kind: "safe" }
  | { kind: "passive-pending"; nextAttemptAt: number | null }
  | { kind: "reload-started" }
  | { kind: "retryable-error" }
  | { kind: "permanent-error"; blockedWordIds: string[] }
  | { kind: "storage-error" };

function canRotateAfterReconcile(result: ReconcileResult): boolean {
  return result.kind === "safe" || result.kind === "passive-pending";
}

const STUDY_QUEUE_REQUEST_TIMEOUT_MS = 15_000;

declare global {
  interface Window {
    __wordCardMotionProbe?: WordCardMotionProbe;
  }
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
function submitQuizReview(
  userId: string,
  wordId: string,
  quality: number,
  credentials: ReviewSubmissionCredentials,
  onDone?: (s: StreakInfo) => void,
  onAchievements?: (list: AchievementDef[]) => void,
  onQueueChange?: () => void,
  onStorageError?: () => void,
  saveNextCheckpoint?: () => boolean,
): boolean {
  const operationId = crypto.randomUUID();
  // Write-ahead：先同步写入本地 outbox，再推进页面／发网络请求。即使用户立即
  // 关页，下一次打开仍能用同一个 operationId 幂等补交。
  try {
    enqueuePendingReview(userId, operationId, wordId, quality, credentials);
    if (saveNextCheckpoint && !saveNextCheckpoint()) {
      // 两个 localStorage key 无事务；checkpoint 写入失败时补偿删除尚未发送的
      // outbox operation，停在当前题让用户修复存储后重试。
      discardPendingReview(userId, operationId);
      throw new Error("CHECKPOINT_STORAGE_UNAVAILABLE");
    }
  } catch {
    onStorageError?.();
    return false;
  }
  onQueueChange?.();
  void flushPendingReviews(userId, (_id, data) => {
    if (data?.streak && onDone) onDone(data.streak as StreakInfo);
    if (Array.isArray(data?.newlyUnlocked) && data.newlyUnlocked.length) {
      onAchievements?.(data.newlyUnlocked as AchievementDef[]);
    }
  })
    .catch((error) => {
      if (error instanceof ReviewQueueStorageError) onStorageError?.();
    })
    .finally(() => onQueueChange?.());
  return true;
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

/** 成就解锁弹窗（fixed 定位，学习各阶段共用）。 */
function AchievementToast({
  items,
  onClose,
}: {
  items: AchievementDef[];
  onClose: () => void;
}) {
  const { tc } = useLocale();
  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className="fixed left-1/2 top-16 z-50 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl bg-[#17213C]/95 px-5 py-3 text-center text-white shadow-lg backdrop-blur dark:bg-white/95 dark:text-[#17213C]"
        >
          <div className="text-[13px] font-bold">🎉 {tc("解锁新成就")}</div>
          {items.map((a) => (
            <div key={a.key} className="text-[13px]">
              {a.icon} {tc(a.title)}
            </div>
          ))}
          <button
            onClick={onClose}
            className="mt-1 text-[11px] text-[#94A3B8] underline dark:text-[#64748B]"
          >
            {tc("知道了")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 「待同步」提示条：当存在本地缓冲、尚未成功提交的评测时显示。
 *
 * 提交失败不再静默丢弃 —— 用户能看到「N 条待同步」，并可手动点「立即重试」，
 * 也会在联网 / 重新进入页面 / 定时器触发时自动重试（见 StudyPage 的 flush）。
 */
function PendingSyncBanner({
  pending,
  blocked,
  blockedError,
  legacy,
  onRetry,
  onDiscardBlocked,
  onClaimLegacy,
  onDiscardLegacy,
}: {
  pending: number;
  blocked: number;
  blockedError: string | null;
  legacy: number;
  onRetry: () => void;
  onDiscardBlocked: () => void;
  onClaimLegacy: () => void;
  onDiscardLegacy: () => void;
}) {
  const { tc } = useLocale();
  return (
    <AnimatePresence>
      {pending + blocked + legacy > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mx-auto mb-3 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-[#FFF7E6] px-4 py-2.5 text-[12px] font-medium text-[#B45309] dark:bg-[#2A1E00] dark:text-[#FBBF24]"
        >
          <span className="flex items-center gap-1.5">
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              <polyline points="21 4 21 10 15 10" />
            </svg>
            {legacy > 0
              ? tc(`发现旧版留下的 ${legacy} 条记录，请确认是否属于当前账号`)
              : blocked > 0
                ? tc(`${blocked} 条记录无法自动同步，已停止重试：${blockedError ?? "请求无效"}`)
                : tc(`有 ${pending} 条学习记录待同步，网络恢复后自动上传`)}
          </span>
          <span className="flex shrink-0 gap-1.5">
            {legacy > 0 ? (
              <>
                <button onClick={onClaimLegacy} className="rounded-full bg-[#F59E0B] px-3 py-1 text-[11px] font-semibold text-white">{tc("归入我的记录")}</button>
                <button onClick={onDiscardLegacy} className="rounded-full border border-[#F59E0B] px-3 py-1 text-[11px] font-semibold">{tc("不是我的")}</button>
              </>
            ) : blocked > 0 ? (
              <button onClick={onDiscardBlocked} className="rounded-full border border-[#F59E0B] px-3 py-1 text-[11px] font-semibold">{tc("清除失败记录")}</button>
            ) : (
              <button onClick={onRetry} className="rounded-full bg-[#F59E0B] px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-[#D97706] active:scale-95 dark:bg-[#FBBF24] dark:text-[#2A1E00]">{tc("立即重试")}</button>
            )}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RotationNotice({
  message,
  onRetry,
  onReload,
}: {
  message: string | null;
  onRetry: () => void;
  onReload: () => void;
}) {
  const { tc } = useLocale();
  if (!message) return null;
  return (
    <div className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-xs text-amber-900 shadow-lg backdrop-blur dark:border-amber-800 dark:bg-amber-950/95 dark:text-amber-100">
      <span className="leading-relaxed">{tc(message)}</span>
      <span className="flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-amber-500 px-3 py-1.5 font-semibold text-white hover:bg-amber-600"
        >
          {tc("重试")}
        </button>
        <button
          type="button"
          onClick={onReload}
          className="rounded-full border border-amber-400 px-3 py-1.5 font-semibold"
        >
          {tc("重新载入")}
        </button>
      </span>
    </div>
  );
}

function CardMotionProbePanel({
  enabled,
  probe,
  onClear,
  onClose,
}: {
  enabled: boolean;
  probe: WordCardMotionProbe | null;
  onClear: () => void;
  onClose: () => void;
}) {
  const { tc } = useLocale();
  const [copied, setCopied] = useState(false);
  if (!enabled) return null;
  const json = probe ? JSON.stringify(probe, null, 2) : "card probe waiting for pointerup";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md overflow-hidden rounded-2xl bg-slate-950/95 text-[10px] text-emerald-300 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-3 py-2 text-[11px] font-semibold text-white">
        <span>Card motion probe</span>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => void copy()} className="rounded-full bg-slate-700 px-2 py-1 hover:bg-slate-600">
            {copied ? tc("已复制") : tc("复制 JSON")}
          </button>
          <button type="button" onClick={onClear} className="rounded-full bg-slate-700 px-2 py-1 hover:bg-slate-600">
            {tc("清除")}
          </button>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-700 px-2 py-1 hover:bg-slate-600">
            {tc("关闭")}
          </button>
        </span>
      </div>
      <pre data-testid="study-card-probe" className="max-h-48 overflow-auto px-3 py-2 whitespace-pre-wrap">
        {json}
      </pre>
    </aside>
  );
}

export default function StudyPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id ?? null;
  const router = useRouter();
  const { tc } = useLocale();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pool, setPool] = useState<PoolWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [helpVisible, setHelpVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [unitCategory, setUnitCategory] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 连续学习天数（GET /api/study 返回，POST 提交后实时刷新）
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  // 当前服务端发出的词目／nonce 清单；quality 提交必须从这里取凭证。
  const [studySession, setStudySession] = useState<StudySessionInfo | null>(null);
  const [cardProbeEnabled, setCardProbeEnabled] = useState(false);
  const [cardMotionProbe, setCardMotionProbe] =
    useState<WordCardMotionProbe | null>(null);
  // 本次学习中新解锁的成就（POST 返回，用于即时弹提示）
  const [newAchievements, setNewAchievements] = useState<AchievementDef[]>([]);
  // 「下一个单元」按钮的加载态（完成画面用）
  const [nextLoading, setNextLoading] = useState(false);
  // 待同步到服务端的评测条数：POST /api/study 失败时本地缓冲，稍后自动重试。
  // 提交失败不再静默丢弃 —— 有条数时顶部会显示「待同步」提示条。
  const [pendingSync, setPendingSync] = useState(0);
  const [blockedSync, setBlockedSync] = useState(0);
  const [blockedSyncError, setBlockedSyncError] = useState<string | null>(null);
  const [legacySync, setLegacySync] = useState(0);
  const [guardedPendingWordIds, setGuardedPendingWordIds] = useState<string[]>([]);
  const [rotationNotice, setRotationNotice] = useState<string | null>(null);
  const isRotatingSessionRef = useRef(false);
  const rotationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotationRetryAttemptRef = useRef(0);
  const rotationSessionRef = useRef<StudySessionInfo | null>(null);
  const rotateStudySessionRef = useRef<() => Promise<void>>(async () => {});
  const scheduleRotationRetryRef = useRef<
    (session: StudySessionInfo, retryAfterMs?: number) => void
  >(() => {});
  const reconciliationServerMutatedWordIdsRef = useRef<Set<string> | null>(null);
  const reconciliationGenerationRef = useRef(0);
  const externalMutationLeaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [interactionEpoch, setInteractionEpoch] = useState(0);
  const interactionEpochRef = useRef(0);
  const helpDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assessment gestures and help dismissal share the same page generation.
  const swipeLockRef = useRef(false);
  const [swipeTransitioning, setSwipeTransitioning] = useState(false);
  const performanceEntriesRef = useRef<
    Array<{ entryType: string; startTime: number; duration: number }>
  >([]);

  const invalidateInteractions = useCallback(() => {
    interactionEpochRef.current += 1;
    setInteractionEpoch(interactionEpochRef.current);
    if (helpDismissTimerRef.current) {
      clearTimeout(helpDismissTimerRef.current);
      helpDismissTimerRef.current = null;
    }
    swipeLockRef.current = false;
    setSwipeTransitioning(false);
  }, []);

  const beginReconciliation = useCallback(() => {
    const generation = ++reconciliationGenerationRef.current;
    invalidateInteractions();
    setLoading(true);
    return generation;
  }, [invalidateInteractions]);

  const isCurrentReconciliation = useCallback(
    (generation: number) => reconciliationGenerationRef.current === generation,
    [],
  );

  const endReconciliation = useCallback((generation: number) => {
    if (reconciliationGenerationRef.current === generation) setLoading(false);
  }, []);

  const reloadStudyQueue = useCallback(() => {
    beginReconciliation();
    setReloadKey((key) => key + 1);
  }, [beginReconciliation]);

  useEffect(() => {
    rotationSessionRef.current = studySession;
  }, [studySession]);

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("cardProbe") === "1";
    const enableTimer = window.setTimeout(() => setCardProbeEnabled(enabled), 0);
    const restoreTimer = enabled
      ? window.setTimeout(() => {
          try {
            const saved = window.sessionStorage.getItem("word-card-motion-probe");
            if (saved) setCardMotionProbe(JSON.parse(saved) as WordCardMotionProbe);
          } catch {
            // Diagnostics must never prevent the study page from loading.
          }
        }, 0)
      : null;
    if (!enabled || typeof PerformanceObserver === "undefined") {
      return () => {
        window.clearTimeout(enableTimer);
        if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      };
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        performanceEntriesRef.current.push({
          entryType: entry.entryType,
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
      if (performanceEntriesRef.current.length > 200) {
        performanceEntriesRef.current = performanceEntriesRef.current.slice(-200);
      }
    });
    try {
      observer.observe({ type: "longtask", buffered: true });
      observer.observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      observer.disconnect();
    }
    return () => {
      window.clearTimeout(enableTimer);
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      observer.disconnect();
    };
  }, []);

  const recordCardMotionProbe = useCallback((probe: WordCardMotionProbe) => {
    const gestureStart = probe.pointerupStartedAt ?? performance.now();
    const gestureEnd = performance.now();
    const overlap = (entry: { startTime: number; duration: number }) =>
      Math.max(
        0,
        Math.min(entry.startTime + entry.duration, gestureEnd) -
          Math.max(entry.startTime, gestureStart),
      );
    const longTaskDurationMs = performanceEntriesRef.current
      .filter((entry) => entry.entryType === "longtask")
      .reduce((total, entry) => total + overlap(entry), 0);
    const eventObserverDurationMs = performanceEntriesRef.current
      .filter((entry) => entry.entryType === "event")
      .reduce((longest, entry) => Math.max(longest, overlap(entry)), 0);
    const recordedProbe = {
      ...probe,
      longTaskDurationMs,
      eventObserverDurationMs,
    };
    setCardMotionProbe(recordedProbe);
    try {
      window.__wordCardMotionProbe = recordedProbe;
      window.sessionStorage.setItem(
        "word-card-motion-probe",
        JSON.stringify(recordedProbe),
      );
    } catch {
      // Keep the in-memory probe available when storage is blocked.
    }
  }, []);

  const clearCardMotionProbe = useCallback(() => {
    setCardMotionProbe(null);
    try {
      delete window.__wordCardMotionProbe;
      window.sessionStorage.removeItem("word-card-motion-probe");
    } catch {
      // Ignore unavailable diagnostic storage.
    }
  }, []);

  const refreshSyncCounts = useCallback(() => {
    if (!userId) return;
    const reviews = loadPendingReviews(userId);
    setPendingSync(reviews.filter((item) => item.status === "pending").length);
    setBlockedSync(reviews.filter((item) => item.status === "blocked").length);
    setBlockedSyncError(
      reviews.find((item) => item.status === "blocked")?.lastError ?? null,
    );
    setGuardedPendingWordIds(
      reviews
        .filter((item) => item.status === "pending" || item.status === "blocked")
        .map((item) => item.wordId),
    );
    setLegacySync(legacyReviewCount());
  }, [userId]);

  const discardBlocked = useCallback(() => {
    if (!userId) return;
    try {
      discardBlockedReviews(userId);
    } catch {
      setError(
        "浏览器无法清除失败记录，请释放存储空间或允许网站存储后重试",
      );
      return;
    }
    refreshSyncCounts();
    reloadStudyQueue();
  }, [userId, refreshSyncCounts, reloadStudyQueue]);

  const claimLegacy = useCallback(() => {
    if (!userId) return;
    try {
      claimLegacyReviews(userId);
    } catch {
      setError("浏览器无法保存旧版记录，请释放存储空间后重试");
      return;
    }
    refreshSyncCounts();
    // Claimed rows can adopt a nonce from the card already on screen. Hide
    // that card immediately and let the startup barrier reconcile the claim
    // against a fresh queue/session before interaction resumes.
    beginReconciliation();
    setReloadKey((key) => key + 1);
  }, [userId, refreshSyncCounts, beginReconciliation]);

  const discardLegacy = useCallback(() => {
    try {
      discardLegacyReviews();
    } catch {
      setError(
        "浏览器无法清除旧版记录，请释放存储空间或允许网站存储后重试",
      );
      return;
    }
    refreshSyncCounts();
  }, [refreshSyncCounts]);
  // 始终指向最新的 handleQuizAnswer，供 effect 调用而不破坏其依赖数组
  const handleQuizAnswerRef = useRef<
    (correct: boolean | null, interactionEpoch: number) => void
  >(() => {});
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

  // 成就解锁提示：3.2s 后自动消失
  useEffect(() => {
    if (newAchievements.length === 0) return;
    const t = setTimeout(() => setNewAchievements([]), 3200);
    return () => clearTimeout(t);
  }, [newAchievements]);

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
  // 「不认识」的词的测试会延后：不立即测，而是记入 pendingQuizzes。
  // 在下一个生字认完且测完后，再回头测这些延后的词（FIFO）。
  // quizTarget 指向「当前正在测的词」，可能是刚认完的词，也可能是延后的词。
  // pendingQuizzes 用 ref：它只被各回调读写、从不参与渲染，用 ref 避免
  // 多余重渲染，也不会触发 ESLint 「声明但未读取」警告。
  const pendingQuizzes = useRef<WordFull[]>([]);
  const [quizTarget, setQuizTarget] = useState<WordFull | null>(null);

  const resetLearningStateForFreshQueue = useCallback(() => {
    invalidateInteractions();
    setCurrentIndex(0);
    setHelpVisible(false);
    setWordStep("assess");
    setDone(false);
    setKnownWords([]);
    setUnknownWords([]);
    setQuizStats({ correct: 0, wrong: 0 });
    setQuizAttempt(0);
    setQuizTarget(null);
    pendingQuizzes.current = [];
    quizWrongCounts.current = {};
    setSwipeTransitioning(false);
    swipeLockRef.current = false;
    setShowResumedBanner(false);
  }, [invalidateInteractions]);

  useEffect(
    () => () => {
      if (helpDismissTimerRef.current) {
        clearTimeout(helpDismissTimerRef.current);
      }
    },
    [],
  );

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

  // 把本地缓冲的待提交评测尽量同步到服务端。
  // flushPendingReviews 成功提交一条即回传最新 streak / 成就，与即时提交一致。
  const flushPending = useCallback(async (
    sessionOverride?: StudySessionInfo | null,
    finalizeLegacy = false,
    onWillMutate?: (plan: ReviewQueueMutationPlan) => void,
    canApply: () => boolean = () => true,
  ): Promise<PendingFlushOutcome> => {
    if (!userId) {
      return {
        remaining: 0,
        submittedWordIds: [],
        adoptedWordIds: [],
        storageError: false,
      };
    }
    const adoptedWordIds: string[] = [];
    const activeSession =
      sessionOverride === undefined ? rotationSessionRef.current : sessionOverride;
    if (activeSession) {
      const attachment = attachStudySessionCredentials(
        userId,
        activeSession.id,
        activeSession.nonces,
      );
      adoptedWordIds.push(...attachment.adoptedWordIds);
      if (!attachment.storageAvailable) {
        if (canApply()) setError(
          "浏览器无法保存学习凭证，请释放存储空间或允许网站存储后重试",
        );
        return {
          remaining: attachment.pendingCount,
          submittedWordIds: [],
          adoptedWordIds,
          storageError: true,
        };
      }
    }
    // Only a successful queue response is definitive for credential-less
    // legacy rows. Before that response, retain them for nonce adoption.
    if (finalizeLegacy) {
      const finalization = finalizeLegacyCredentialClaims(userId);
      if (!finalization.storageAvailable) {
        if (canApply()) setError(
          "浏览器无法更新旧版待同步记录，请释放存储空间或允许网站存储后重试",
        );
        return {
          remaining: pendingReviewCount(userId),
          submittedWordIds: [],
          adoptedWordIds,
          storageError: true,
        };
      }
    }
    // Current queue may be empty; durable rows already carry their own
    // credentials (or provenance for reauthorization), so they still flush.
    // The queue library serializes concurrent callers and runs a trailing scan.
    const submittedWordIds = new Set<string>();
    let remaining: number;
    try {
      remaining = await flushPendingReviews(userId, (wordId, data) => {
        submittedWordIds.add(wordId);
        if (!canApply()) return;
        if (data?.streak) setStreak(data.streak as StreakInfo);
        const unlocked = data?.newlyUnlocked as AchievementDef[] | undefined;
        if (unlocked?.length) {
          setNewAchievements((prev) => [...prev, ...unlocked]);
        }
      }, onWillMutate);
    } catch (error) {
      if (!(error instanceof ReviewQueueStorageError)) throw error;
      if (canApply()) setError(
        "浏览器无法更新待同步记录，请释放存储空间或允许网站存储后重试",
      );
      return {
        remaining: pendingReviewCount(userId),
        submittedWordIds: [...submittedWordIds],
        adoptedWordIds,
        storageError: true,
      };
    }
    if (canApply()) {
      setPendingSync(remaining);
      setBlockedSync(blockedReviewCount(userId));
      setBlockedSyncError(blockedReviewMessage(userId));
      setGuardedPendingWordIds(
        loadPendingReviews(userId)
          .filter((item) => item.status === "pending" || item.status === "blocked")
          .map((item) => item.wordId),
      );
      setLegacySync(legacyReviewCount());
    }
    return {
      remaining,
      submittedWordIds: [...submittedWordIds],
      adoptedWordIds,
      storageError: false,
    };
  }, [userId]);

  // The queue library classifies a flush after it owns the cross-tab lock and
  // invokes onWillMutate synchronously before the first request. That closes
  // the TOCTOU window where a passive row could become due while waiting.
  const flushAndReconcile = useCallback(async (): Promise<ReconcileResult> => {
    if (!userId) return { kind: "retryable-error" };
    const checkpoint = loadCheckpoint(userId, getUnitKey());
    const activeWordIds = new Set([
      ...queue.map((item) => item.word.id),
      ...(checkpoint?.queueSignature ?? []),
    ]);
    const activeSession = rotationSessionRef.current;
    const startingGeneration = reconciliationGenerationRef.current;
    let barrierGeneration: number | null = null;
    const onWillMutate = (plan: ReviewQueueMutationPlan) => {
      if (
        barrierGeneration === null &&
        plan.willMutateWordIds.some((wordId) => activeWordIds.has(wordId))
      ) {
        barrierGeneration = beginReconciliation();
      }
    };
    const canApply = () =>
      barrierGeneration === null
        ? reconciliationGenerationRef.current === startingGeneration
        : isCurrentReconciliation(barrierGeneration);

    try {
      const outcome = await flushPending(
        undefined,
        false,
        onWillMutate,
        canApply,
      );
      if (!canApply()) return { kind: "reload-started" };
      if (outcome.storageError) {
        if (barrierGeneration !== null) endReconciliation(barrierGeneration);
        return { kind: "storage-error" };
      }
      const submittedActiveWordIds = outcome.submittedWordIds.filter(
        (wordId) => activeWordIds.has(wordId),
      );
      if (submittedActiveWordIds.length > 0) {
        reconciliationServerMutatedWordIdsRef.current = new Set(
          submittedActiveWordIds,
        );
        if (barrierGeneration === null) barrierGeneration = beginReconciliation();
        setReloadKey((key) => key + 1);
        return { kind: "reload-started" };
      }
      const unresolvedAdoptedActiveWord = outcome.adoptedWordIds.some(
        (wordId) =>
          activeWordIds.has(wordId) &&
          !outcome.submittedWordIds.includes(wordId),
      );
      if (unresolvedAdoptedActiveWord) {
        setError(
          "待同步记录已占用目前学习凭证，但尚未成功提交，请稍后重试",
        );
        if (barrierGeneration !== null) endReconciliation(barrierGeneration);
        return { kind: "retryable-error" };
      }
      if (barrierGeneration !== null) endReconciliation(barrierGeneration);
      const finalPlan = planReviewQueueMutation(
        userId,
        activeSession
          ? { studySessionId: activeSession.id, nonces: activeSession.nonces }
          : null,
      );
      const blockedActiveWordIds = finalPlan.blockedWordIds.filter((wordId) =>
        activeWordIds.has(wordId),
      );
      if (blockedActiveWordIds.length > 0) {
        setError(
          "目前题目有无法自动恢复的同步记录，请重新载入题目或清除失败记录后再继续",
        );
        return {
          kind: "permanent-error",
          blockedWordIds: blockedActiveWordIds,
        };
      }
      const hasPassiveActivePending = finalPlan.passivePendingWordIds.some(
        (wordId) => activeWordIds.has(wordId),
      );
      return hasPassiveActivePending
        ? { kind: "passive-pending", nextAttemptAt: finalPlan.nextAttemptAt }
        : { kind: "safe" };
    } catch (error) {
      if (barrierGeneration !== null) endReconciliation(barrierGeneration);
      if (canApply()) setError(networkErrorMessage(error));
      return { kind: "retryable-error" };
    }
  }, [
    userId,
    queue,
    flushPending,
    beginReconciliation,
    isCurrentReconciliation,
    endReconciliation,
  ]);

  // 网络恢复 / 页面重新可见 / 定时器：自动重试缓冲的待提交评测，
  // 保证用户离线时记下的学习在恢复连接后不丢失。
  useEffect(() => {
    if (status !== "authenticated" || loading) return;
    const onOnline = () => void flushAndReconcile();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flushAndReconcile();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    // 每 30s 兜底重试一次（仅在有待提交时才会真正发请求）。
    const timer = window.setInterval(() => {
      if (userId && pendingReviewCount(userId) > 0) {
        void flushAndReconcile();
      }
    }, 30000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [status, userId, loading, flushAndReconcile]);

  const scheduleRotationRetry = useCallback(
    (currentSession: StudySessionInfo, retryAfterMs?: number) => {
      if (rotationRetryTimerRef.current) {
        clearTimeout(rotationRetryTimerRef.current);
        rotationRetryTimerRef.current = null;
      }
      const remainingMs = Date.parse(currentSession.expiresAt) - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 30_000) return;
      const attempt = rotationRetryAttemptRef.current++;
      const exponentialDelay = Math.min(
        60_000,
        1_000 * 2 ** Math.min(attempt, 6),
      );
      const delay = Math.min(
        Math.max(1_000, retryAfterMs ?? exponentialDelay),
        Math.max(1_000, remainingMs - 30_000),
      );
      rotationRetryTimerRef.current = setTimeout(async () => {
        rotationRetryTimerRef.current = null;
        const result = await flushAndReconcile();
        if (canRotateAfterReconcile(result)) {
          void rotateStudySessionRef.current();
          return;
        }
        scheduleRotationRetryRef.current(currentSession);
      }, delay);
    },
    [flushAndReconcile],
  );

  useEffect(() => {
    scheduleRotationRetryRef.current = scheduleRotationRetry;
  }, [scheduleRotationRetry]);

  // localStorage is shared across tabs, but React state is not. Row changes
  // refresh the guard banner immediately; a successful submission in another
  // tab invalidates any matching in-memory queue/session and re-enters the
  // same fresh-load barrier used by this tab's own flush.
  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    const itemPrefix = reviewQueueItemStoragePrefix(userId);
    const mutationKey = reviewQueueMutationStorageKey(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key) return;
      if (event.key.startsWith(itemPrefix)) {
        refreshSyncCounts();
        return;
      }
      if (event.key !== mutationKey) return;
      const mutation = parseReviewQueueMutationEvent(userId, event.newValue);
      if (!mutation) return;
      refreshSyncCounts();
      const checkpoint = loadCheckpoint(userId, getUnitKey());
      const activeWordIds = new Set([
        ...queue.map((item) => item.word.id),
        ...(checkpoint?.queueSignature ?? []),
      ]);
      const affectsActiveQueue = mutation.wordIds.some((wordId) =>
        activeWordIds.has(wordId),
      );
      if (mutation.kind === "mutation-started") {
        if (!affectsActiveQueue) return;
        beginReconciliation();
        if (externalMutationLeaseTimerRef.current) {
          clearTimeout(externalMutationLeaseTimerRef.current);
        }
        const delay = Math.max(0, (mutation.expiresAt ?? Date.now()) - Date.now());
        externalMutationLeaseTimerRef.current = setTimeout(() => {
          externalMutationLeaseTimerRef.current = null;
          reloadStudyQueue();
        }, delay);
        return;
      }
      if (mutation.kind === "mutation-released") {
        if (!affectsActiveQueue) return;
        if (externalMutationLeaseTimerRef.current) {
          clearTimeout(externalMutationLeaseTimerRef.current);
          externalMutationLeaseTimerRef.current = null;
        }
        reloadStudyQueue();
        return;
      }
      if (
        mutation.kind === "session-rotated" &&
        studySession &&
        mutation.sessionIds[0] === studySession.id &&
        mutation.sessionIds[1]
      ) {
        const checkpoint = loadCheckpoint(userId, getUnitKey());
        if (
          checkpoint &&
          updateCheckpointStudySession(
            userId,
            getUnitKey(),
            mutation.sessionIds[1],
          )
        ) {
          beginReconciliation();
          setReloadKey((key) => key + 1);
          return;
        }
        invalidateInteractions();
        setError(
          "学习凭证已在另一分页轮换，请重新载入题目后继续",
        );
        return;
      }
      if (
        mutation.kind === "credentials-renewed" &&
        studySession &&
        mutation.sessionIds.includes(studySession.id)
      ) {
        invalidateInteractions();
        setError(
          "学习凭证已在另一分页更新，请重新载入题目后继续",
        );
        return;
      }
      if (mutation.kind !== "server-mutated") return;
      const affectedWordIds = mutation.wordIds.filter((wordId) =>
        activeWordIds.has(wordId),
      );
      if (affectedWordIds.length === 0) return;
      if (externalMutationLeaseTimerRef.current) {
        clearTimeout(externalMutationLeaseTimerRef.current);
        externalMutationLeaseTimerRef.current = null;
      }
      reconciliationServerMutatedWordIdsRef.current = new Set(
        affectedWordIds,
      );
      beginReconciliation();
      setReloadKey((key) => key + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (externalMutationLeaseTimerRef.current) {
        clearTimeout(externalMutationLeaseTimerRef.current);
        externalMutationLeaseTimerRef.current = null;
      }
    };
  }, [
    status,
    userId,
    queue,
    studySession,
    refreshSyncCounts,
    beginReconciliation,
    invalidateInteractions,
    reloadStudyQueue,
  ]);

  const rotateStudySession = useCallback(async () => {
    const currentSession = rotationSessionRef.current ?? studySession;
    if (!userId || !currentSession || isRotatingSessionRef.current) return;
    isRotatingSessionRef.current = true;
    if (rotationRetryTimerRef.current) {
      clearTimeout(rotationRetryTimerRef.current);
      rotationRetryTimerRef.current = null;
    }
    const reconciliationGeneration = beginReconciliation();
    const canApply = () =>
      isCurrentReconciliation(reconciliationGeneration) &&
      rotationSessionRef.current?.id === currentSession.id;

    const retryLater = (message: string, retryAfterMs?: number) => {
      if (!canApply()) return;
      setRotationNotice(message);
      scheduleRotationRetry(currentSession, retryAfterMs);
    };

    try {
      const checkpoint = loadCheckpoint(userId, getUnitKey());
      const queueIds = checkpoint?.queueSignature ?? queue.map((item) => item.word.id);
      if (!canResumeStudySession(queueIds)) {
        retryLater("学习队列无法安全续期，请重新载入页面");
        return;
      }
      const response = await fetch("/api/study/session/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousSessionId: currentSession.id,
          queueIds,
          rotationKey: `rotate-${currentSession.id}`,
        }),
      });
      if (!canApply()) return;
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        retryLater(
          await responseErrorMessage(response),
          Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1_000) : undefined,
        );
        return;
      }
      const payload = (await response.json()) as {
        studySession?: StudySessionInfo | null;
      };
      if (!canApply()) return;
      const nextSession = payload.studySession;
      if (!nextSession) {
        retryLater("学习 session 续期失败，请稍后重试");
        return;
      }
      rebindStudySessionCredentials(
        userId,
        currentSession.id,
        nextSession.id,
        nextSession.nonces,
      );
      if (!canApply()) return;
      if (checkpoint) {
        updateCheckpointStudySession(userId, getUnitKey(), nextSession.id);
      }
      rotationRetryAttemptRef.current = 0;
      setRotationNotice(null);
      rotationSessionRef.current = nextSession;
      setStudySession(nextSession);
    } catch (error) {
      if (!canApply()) return;
      if (error instanceof ReviewQueueStorageError) {
        setError(
          "浏览器无法保存续期后的待同步记录，请释放存储空间或允许网站存储后重新载入",
        );
      } else {
        retryLater(networkErrorMessage(error));
      }
    } finally {
      isRotatingSessionRef.current = false;
      endReconciliation(reconciliationGeneration);
    }
  }, [
    userId,
    studySession,
    queue,
    beginReconciliation,
    isCurrentReconciliation,
    endReconciliation,
    scheduleRotationRetry,
  ]);

  useEffect(() => {
    rotateStudySessionRef.current = rotateStudySession;
  }, [rotateStudySession]);

  // Rotate the server-issued nonce set while the old session is still live.
  // The rotation endpoint preserves queue order and has response-loss idempotency.
  useEffect(() => {
    if (!studySession) return;
    const expiresAt = Date.parse(studySession.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const delay = Math.max(0, expiresAt - Date.now() - 5 * 60_000);
    const timer = window.setTimeout(
      () => {
        void flushAndReconcile().then((result) => {
          if (canRotateAfterReconcile(result)) {
            void rotateStudySessionRef.current();
            return;
          }
          scheduleRotationRetryRef.current(studySession);
        });
      },
      Math.min(delay, 2_147_000_000),
    );
    return () => {
      window.clearTimeout(timer);
      if (rotationRetryTimerRef.current) {
        clearTimeout(rotationRetryTimerRef.current);
        rotationRetryTimerRef.current = null;
      }
    };
  }, [studySession, flushAndReconcile]);

  /**
   * 尝试用本地存档点恢复进度。返回是否成功恢复。
   * 仅在刚从服务端拉取到队列后调用一次：用队列重建 WordFull，
   * 若存档与当前队列指纹不一致或引用了不存在的词，则视为过期并丢弃。
   */
  const restoreProgress = useCallback(
    (loadedQueue: QueueItem[]): QueueItem[] | null => {
      if (!userId) return null;
      const unitKey = getUnitKey();
      const cp = loadCheckpoint(userId, unitKey);
      if (!cp) return null;

      // 用「词的集合」比对而非顺序：单元练习的服务端队列会按 SM-2 状态
      // （未学/到期/已排期）重排，同一单元两次访问顺序可能不同，但词集合稳定。
      // 全局模式下若换天导致队列变化，集合不一致 → 视为过期、从头开始。
      const loadedIds = new Set(loadedQueue.map((q) => q.word.id));
      const cpSet = new Set(cp.queueSignature);
      const sigMatch =
        loadedIds.size === cpSet.size &&
        [...loadedIds].every((id) => cpSet.has(id));
      if (!sigMatch) {
        // 词被删除、移组或权限变化时，服务端会回退到一条新队列。清除失效
        // checkpoint，避免之后每次进入都反复尝试同一批旧 id。
        clearCheckpoint(userId, unitKey);
        return null;
      }

      // API 会随机洗牌；按 checkpoint 保存的原顺序重建，确保 currentIndex 仍指
      // 向同一个词，而不是把旧 index 套到新顺序。
      const loadedMap = new Map(loadedQueue.map((q) => [q.word.id, q]));
      const restoredQueue = cp.queueSignature.map((id) => loadedMap.get(id)!);

      const wordMap = new Map(restoredQueue.map((q) => [q.word.id, q.word]));
      const needIds = [...cp.knownWordIds, ...cp.unknownWordIds];
      if (needIds.some((id) => !wordMap.has(id))) return null;

      setKnownWords(cp.knownWordIds.map((id) => wordMap.get(id)!));
      setUnknownWords(cp.unknownWordIds.map((id) => wordMap.get(id)!));
      setQuizStats(cp.quizStats);

      const restoredQuizTarget = cp.quizTargetId
        ? wordMap.get(cp.quizTargetId) ?? null
        : null;
      if (cp.phase === "quiz" && !restoredQuizTarget) return null;
      quizWrongCounts.current = restoredQuizTarget
        ? { [restoredQuizTarget.id]: cp.quizWrongCount ?? 0 }
        : {};
      // 恢复「延后待测」的不认识词：恢复后继续测试它们，不再静默丢弃
      // （丢弃会导致这些词不测试、无 SM-2 记录，第二天又当新词出现）。
      pendingQuizzes.current = (cp.pendingQuizIds ?? [])
        .map((id) => wordMap.get(id))
        .filter((w): w is WordFull => Boolean(w));
      setQuizAttempt(0);
      setWordStep(cp.phase === "quiz" ? "quiz" : "assess");
      setQuizTarget(cp.phase === "quiz" ? restoredQuizTarget : null);

      if (cp.phase === "done" || cp.currentIndex >= restoredQueue.length) {
        setDone(true);
        setCurrentIndex(restoredQueue.length);
      } else {
        setDone(false);
        setCurrentIndex(cp.currentIndex);
      }
      return restoredQueue;
    },
    [userId],
  );

  // 加载队列：认证通过后，以及每次 restart（reloadKey 变化）触发。
  // 通过 URL query 决定是「全局今日队列」还是「指定单元练习」。
  // 用内联 async IIFE 触发请求，符合 react-hooks/set-state-in-effect 规则。
  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    const controllers = new Set<AbortController>();
    let reconciliationGeneration: number | null = null;
    const canApply = () =>
      !cancelled &&
      reconciliationGeneration !== null &&
      isCurrentReconciliation(reconciliationGeneration);

    const requestQueue = async (
      params: URLSearchParams,
    ): Promise<StudyQueueResponse | null> => {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(
        () => controller.abort(),
        STUDY_QUEUE_REQUEST_TIMEOUT_MS,
      );
      try {
        const res = await fetch(`/api/study?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!canApply()) return null;
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (res.status === 403) {
          setLocked(true);
          setQueue([]);
          setPool([]);
          setUnitCategory(null);
          return null;
        }
        if (!res.ok) {
          setError(await responseErrorMessage(res));
          return null;
        }
        return (await res.json()) as StudyQueueResponse;
      } finally {
        window.clearTimeout(timeout);
        controllers.delete(controller);
      }
    };

    (async () => {
      reconciliationGeneration = beginReconciliation();
      if (canApply()) setError(null);
      try {
        const params = new URLSearchParams(window.location.search);
        const postStartServerMutatedWordIds =
          reconciliationServerMutatedWordIdsRef.current ?? new Set<string>();
        // 固定恢复队列：成功提交一题后，动态 due/new/补救集合会立刻变化；把
        // checkpoint 的原 id 顺序交回服务端作当前权限验证并重建，才可真正续做。
        let checkpoint = loadCheckpoint(userId, getUnitKey());
        if (checkpoint && !canResumeStudySession(checkpoint.queueSignature)) {
          // 旧版本可能保存过超过当前请求上限的单元；先丢弃再让服务端
          // 生成同样受限的新队列，避免每次 Retry 都重复收到 400。
          clearCheckpoint(userId, getUnitKey());
          checkpoint = null;
        } else if (checkpoint && postStartServerMutatedWordIds.size === 0) {
          params.set("resumeIds", checkpoint.queueSignature.join(","));
          params.set("resumeSessionId", checkpoint.studySessionId);
        }

        // Start credentialed outbox recovery and queue loading together. The
        // page remains in its loading state until both phases reconcile, so a
        // stale queue/session can never become interactive.
        const initialFlushPromise = flushPending(
          null,
          false,
          undefined,
          canApply,
        );
        let data = await requestQueue(params);
        if (!data) {
          await initialFlushPromise;
          return;
        }
        const firstSession = data.studySession ?? null;
        const adoptionPromise = flushPending(
          firstSession,
          true,
          undefined,
          canApply,
        );
        const [initialFlush, adoptionFlush] = await Promise.all([
          initialFlushPromise,
          adoptionPromise,
        ]);
        if (!canApply()) return;
        if (initialFlush.storageError || adoptionFlush.storageError) return;

        const concurrentServerMutatedWordIds = new Set([
          ...initialFlush.submittedWordIds,
          ...adoptionFlush.submittedWordIds,
        ]);
        const concurrentSessionReservedWordIds = new Set([
          ...initialFlush.adoptedWordIds,
          ...adoptionFlush.adoptedWordIds,
        ]);
        const serverMutatedWordIds = new Set([
          ...postStartServerMutatedWordIds,
          ...concurrentServerMutatedWordIds,
        ]);
        const firstQueueWordIds = new Set(
          (data.queue ?? []).map((item) => item.word.id),
        );
        const activeServerMutation = [...concurrentServerMutatedWordIds].some(
          (wordId) => firstQueueWordIds.has(wordId),
        );
        const unresolvedSessionReservation = [
          ...concurrentSessionReservedWordIds,
        ].some(
          (wordId) =>
            firstQueueWordIds.has(wordId) &&
            !concurrentServerMutatedWordIds.has(wordId),
        );
        let restoreAllowed = true;
        if (activeServerMutation) {
          // A startup submission changed SM-2 state, or consumed a nonce from
          // the first response. Discard that response and request a wholly
          // fresh queue/session, but retain the checkpoint until this request
          // succeeds and we know whether the reconciled words affect it.
          data = await requestQueue(
            new URLSearchParams(window.location.search),
          );
          if (!data || !canApply()) return;
        }
        if (unresolvedSessionReservation) {
          setError(
            "待同步记录已占用目前学习凭证，但尚未成功提交，请稍后重试",
          );
          return;
        }
        if (
          reconciliationServerMutatedWordIdsRef.current ===
          postStartServerMutatedWordIds
        ) {
          reconciliationServerMutatedWordIdsRef.current = null;
        }
        const checkpointAffected = Boolean(
          checkpoint?.queueSignature.some((wordId) =>
            serverMutatedWordIds.has(wordId),
          ),
        );
        if (checkpointAffected) {
          clearCheckpoint(userId, getUnitKey());
          restoreAllowed = false;
        }

        const loadedQueue = (data.queue || []) as QueueItem[];
        const pendingWordIds = new Set(
          loadPendingReviews(userId)
            .filter((item) => item.status === "pending")
            .map((item) => item.wordId),
        );
        const conflictingWords = loadedQueue.filter((item) =>
          pendingWordIds.has(item.word.id),
        );
        if (conflictingWords.length > 0) {
          setError(
            "目前学习队列仍有同一单词等待同步，请恢复网络后重试，避免重复记录学习进度",
          );
          return;
        }

        setLocked(false);
        const restoredQueue = restoreAllowed && canApply()
          ? restoreProgress(loadedQueue)
          : null;
        if (!restoredQueue) resetLearningStateForFreshQueue();
        setQueue(restoredQueue ?? loadedQueue);
        setPool(data.pool || []);
        setUnitCategory(data.unitMode ? data.category ?? null : null);
        setStreak(data.streak ?? null);
        const nextSession = (data.studySession ?? null) as StudySessionInfo | null;
        rotationSessionRef.current = nextSession;
        setStudySession(nextSession);
        setRotationNotice(null);
        rotationRetryAttemptRef.current = 0;
        // 恢复存档点：若有匹配的本地进度，直接续做，无需从头开始
        if (restoredQueue) {
          flashResumed();
        }
      } catch (e) {
        if (canApply()) setError(networkErrorMessage(e));
      } finally {
        if (reconciliationGeneration !== null) {
          endReconciliation(reconciliationGeneration);
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [
    status,
    userId,
    reloadKey,
    restoreProgress,
    flashResumed,
    router,
    flushPending,
    resetLearningStateForFreshQueue,
    beginReconciliation,
    isCurrentReconciliation,
    endReconciliation,
  ]);

  // 认字评估阶段的词：取队列中 currentIndex 位置的词（经 current 引用）。
  // 测试阶段的词可能不同（延后回来的不认识词），由 quizTarget 单独追踪。

  // 当前词的测试题（仅在该词的「测试」步生成）。答错后 quizAttempt 自增，
  // 强制重新出题（新的方向 / 干扰项），让用户原地重测直到答对。
  // 测试目标 quizTarget 可能是刚认完的词，也可能是延后回来的不认识词。
  const currentQuestion = useMemo(() => {
    if (done || wordStep !== "quiz" || !quizTarget) return null;
    void quizAttempt; // 答错重测时自增 → 触发重新生成题目
    return buildQuestion(quizTarget, distractorSource);
  }, [done, wordStep, quizTarget, distractorSource, quizAttempt]);

  // 若当前词无法生成有效配对题（如 DVD↔DVD 这类纯英文词条，或干扰项不足），
  // 只推进流程而不写入 SM-2，避免把不可出题词自动判成满分。
  useEffect(() => {
    if (done || wordStep !== "quiz" || !quizTarget) return;
    if (currentQuestion !== null) return;
    // 用 setTimeout(0) 推迟到下一帧，避免在渲染期间 setState
    const answerEpoch = interactionEpochRef.current;
    const t = setTimeout(
      () => handleQuizAnswerRef.current(null, answerEpoch),
      0,
    );
    return () => clearTimeout(t);
  }, [done, wordStep, quizTarget, currentQuestion, interactionEpoch]);

  // 推进到下一个生字的「认字评估」步。
  // 如果还有延后未测的词，不推进，而是回头测它们（在全部认字评估完成后，
  // 或与下一个生字的测试交错进行）。
  const advanceToNextAssess = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      // 已经是最后一个生字：先回头测延后队列里的不认识词（FIFO），
      // 全部测完后再标记整轮完成。
      const pending = pendingQuizzes.current;
      if (pending.length > 0) {
        const [next, ...rest] = pending;
        pendingQuizzes.current = rest;
        setQuizTarget(next);
        setQuizAttempt(0);
        quizWrongCounts.current = {};
        setWordStep("quiz");
      } else {
        // 没有延后词了 → 整轮完成。
        setWordStep("assess");
        setQuizTarget(null);
        setDone(true);
      }
    } else {
      setCurrentIndex(nextIndex);
      setWordStep("assess");
      setQuizTarget(null);
      setQuizAttempt(0);
      quizWrongCounts.current = {};
    }
  }, [currentIndex, queue.length]);

  // 测试作答（必须在所有 early return 之前调用，遵守 Rules of Hooks）
  const handleQuizAnswer = useCallback(
    (correct: boolean | null, answerEpoch: number) => {
      if (answerEpoch !== interactionEpochRef.current || loading) return;
      // 测试目标可能是刚认完的词，也可能是延后回来的不认识词
      const word = quizTarget;
      if (word && guardedPendingWordIds.includes(word.id)) return;
      if (correct === false) {
        setQuizStats((s) => ({
          correct: s.correct,
          wrong: s.wrong + 1,
        }));
      }

      if (correct === false) {
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
      // correct === null 代表没有办法生成有效题目；这种词只推进流程，
      // 不把「自我评估」伪装成 quality=5 写入 SM-2。
      if (word) {
        const wrongs = quizWrongCounts.current[word.id] ?? 0;
        const quality = wrongs === 0 ? 5 : wrongs === 1 ? 4 : 3;
        const nextQuizStats =
          correct === true
            ? { ...quizStats, correct: quizStats.correct + 1 }
            : quizStats;
        const pending = pendingQuizzes.current;
        const nextIndex = currentIndex + 1;
        const nextPhase =
          pending.length > 0
            ? "quiz"
            : nextIndex >= queue.length
              ? "done"
              : "assess";
        const unitKey = getUnitKey();
        const saveNextCheckpoint = () =>
          saveCheckpoint(userId!, unitKey, {
            phase: nextPhase,
            unitKey,
            queueSignature: queue.map((q) => q.word.id),
            studySessionId: studySession!.id,
            currentIndex:
              nextPhase === "done"
                ? queue.length
                : currentIndex + (nextPhase === "assess" ? 1 : 0),
            knownWordIds: knownWords.map((w) => w.id),
            unknownWordIds: unknownWords.map((w) => w.id),
            quizStats: nextQuizStats,
            quizTargetId:
              nextPhase === "quiz" ? pending[0]?.id ?? null : null,
            quizWrongCount: 0,
            pendingQuizIds:
              nextPhase === "quiz"
                ? pending.slice(1).map((w) => w.id)
                : [],
          });
        const nonce = studySession?.nonces[word.id];
        const credentials =
          studySession && nonce
            ? { studySessionId: studySession.id, nonce }
            : null;
        const persisted =
          correct === null
            ? saveNextCheckpoint() ||
              (setError(
                "浏览器无法保存学习进度，请释放存储空间或允许网站存储后重试",
              ), false)
            : credentials
              ? submitQuizReview(
                  userId!,
                  word.id,
                  quality,
                  credentials,
                  setStreak,
                  (list) => setNewAchievements((prev) => [...prev, ...list]),
                  refreshSyncCounts,
                  () =>
                    setError(
                      "浏览器无法保存待同步记录，请释放存储空间或允许网站存储后重试",
                    ),
                  saveNextCheckpoint,
                )
              : (setError("学习 session 已失效，请重新载入题目后再试"), false);
        if (!persisted) return;
        if (correct === true) setQuizStats(nextQuizStats);
      }

      // 答对后：优先回头测延后队列里的不认识词（FIFO），
      // 队列空了才推进到下一个生字的认字评估。
      const pending = pendingQuizzes.current;
      if (pending.length > 0) {
        const [next, ...rest] = pending;
        pendingQuizzes.current = rest;
        setQuizTarget(next);
        setQuizAttempt(0);
        quizWrongCounts.current = {};
      } else {
        // 没有延后词了 → 推进到下一个生字
        advanceToNextAssess();
      }
    },
    [
      quizTarget,
      advanceToNextAssess,
      userId,
      unknownWords,
      refreshSyncCounts,
      quizStats,
      currentIndex,
      queue,
      knownWords,
      studySession,
      guardedPendingWordIds,
      loading,
    ]
  );

  // 让 ref 始终持有最新的 handleQuizAnswer（在 effect 中同步，避免渲染期写 ref）
  useEffect(() => {
    handleQuizAnswerRef.current = handleQuizAnswer;
  }, [handleQuizAnswer]);

  // 存档点：每完成一步都写入本地存档，方便用户中途离开后续做。
  // 完成时自动清除存档；加载中或队列为空时不写。
  useEffect(() => {
    if (
      loading ||
      status !== "authenticated" ||
      !userId ||
      !studySession ||
      swipeTransitioning
    )
      return;
    const unitKey = getUnitKey();
    if (done) {
      if (pendingReviewCount(userId) === 0) {
        clearCheckpoint(userId, unitKey);
      } else {
        saveCheckpoint(userId, unitKey, {
          phase: "done",
          unitKey,
          queueSignature: queue.map((q) => q.word.id),
          studySessionId: studySession!.id,
          currentIndex: queue.length,
          knownWordIds: knownWords.map((w) => w.id),
          unknownWordIds: unknownWords.map((w) => w.id),
          quizStats,
          quizTargetId: null,
          quizWrongCount: 0,
          pendingQuizIds: [],
        });
      }
      return;
    }
    if (queue.length === 0) return;
    saveCheckpoint(userId, unitKey, {
      phase: wordStep,
      unitKey,
      queueSignature: queue.map((q) => q.word.id),
      studySessionId: studySession!.id,
      currentIndex,
      knownWordIds: knownWords.map((w) => w.id),
      unknownWordIds: unknownWords.map((w) => w.id),
      quizStats,
      quizTargetId: wordStep === "quiz" ? quizTarget?.id ?? null : null,
      quizWrongCount:
        wordStep === "quiz" && quizTarget
          ? quizWrongCounts.current[quizTarget.id] ?? 0
          : 0,
      pendingQuizIds: pendingQuizzes.current.map((w) => w.id),
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
    quizTarget,
    userId,
    swipeTransitioning,
    pendingSync,
    studySession,
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
  const currentInteractionWordId =
    wordStep === "quiz" ? quizTarget?.id : current?.word.id;
  const interactionGuarded = Boolean(
    currentInteractionWordId &&
      guardedPendingWordIds.includes(currentInteractionWordId),
  );

  // 右滑：认识（仅本地分类，不写记录；掌握与否交给随后的测试判定）
  // 选好「认识」后，立刻进入该词的测试步。
  const handleSwipeRight = () => {
    if (!current || interactionGuarded || swipeLockRef.current) return;
    swipeLockRef.current = true;
    setKnownWords((prev) => [...prev, current.word]);
    setQuizTarget(current.word);
    setQuizAttempt(0);
    quizWrongCounts.current = {};
    setWordStep("quiz");
    swipeLockRef.current = false;
  };

  // 左滑：不认识 → 展示助记面板（仅本地分类，不写记录）
  const handleSwipeLeft = () => {
    if (!current || interactionGuarded || swipeLockRef.current) return;
    swipeLockRef.current = true;
    setSwipeTransitioning(true);
    setHelpVisible(true);
    swipeLockRef.current = false;
  };

  // 助记面板关闭 → 进入下一个生字的认字评估，而不是当前词的测试。
  // 当前词（不认识）的测试会延后：先去认下一个生字，等下一个生字认完且测完后，
  // 再回头测这个词。
  const handleHelpDismiss = () => {
    if (!current || interactionGuarded || loading) return;
    const dismissEpoch = interactionEpochRef.current;
    const dismissedWord = current.word;
    setHelpVisible(false);
    // 推进到下一个生字的认字评估
    if (helpDismissTimerRef.current) clearTimeout(helpDismissTimerRef.current);
    helpDismissTimerRef.current = setTimeout(() => {
      helpDismissTimerRef.current = null;
      if (dismissEpoch !== interactionEpochRef.current) return;
      // Classification, delayed-quiz insertion and index advancement are one
      // business commit. A reconciliation that cancels this timer therefore
      // leaves the current word wholly unclassified and safe to retry.
      setUnknownWords((prev) =>
        prev.some((word) => word.id === dismissedWord.id)
          ? prev
          : [...prev, dismissedWord],
      );
      if (!pendingQuizzes.current.some((word) => word.id === dismissedWord.id)) {
        pendingQuizzes.current = [...pendingQuizzes.current, dismissedWord];
      }
      advanceToNextAssess();
      setSwipeTransitioning(false);
    }, 200);
  };

  // 重新开始：清空状态并清除存档点，触发重新拉取
  const restart = () => {
    if (userId) clearCheckpoint(userId, getUnitKey());
    setQueue([]);
    setPool([]);
    setStudySession(null);
    setLocked(false);
    resetLearningStateForFreshQueue();
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

  // ───────── 加载／本地持久化失败渲染 ─────────
  // 必须早于 quiz/done 等 early return：例如 localStorage quota 错误发生时，
  // QuizCard 已锁定答案；这里卸载它并让用户修复存储后从 checkpoint 重试。
  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
        <ErrorBanner
          message={error}
          onRetry={reloadStudyQueue}
        />
      </div>
    );
  }

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
  if (wordStep === "quiz" && quizTarget) {
    // 以「词」为单位的进度：当前是第几个词 / 总词数
    const progressPct =
      queue.length > 0 ? (currentIndex / queue.length) * 100 : 0;

    return (
      <div
        data-testid="study-quiz-phase"
        data-known-count={knownWords.length}
        className="flex min-h-full flex-col pb-24"
      >
        <RotationNotice
          message={rotationNotice}
          onRetry={() => void rotateStudySession()}
          onReload={reloadStudyQueue}
        />
        <CardMotionProbePanel
          enabled={cardProbeEnabled}
          probe={cardMotionProbe}
          onClear={clearCardMotionProbe}
          onClose={() => setCardProbeEnabled(false)}
        />
        <ResumeToast visible={showResumedBanner} />
        <AchievementToast
          items={newAchievements}
          onClose={() => setNewAchievements([])}
        />
        <PendingSyncBanner
          pending={pendingSync}
          blocked={blockedSync}
          blockedError={blockedSyncError}
          legacy={legacySync}
          onRetry={() => void flushAndReconcile()}
          onDiscardBlocked={discardBlocked}
          onClaimLegacy={claimLegacy}
          onDiscardLegacy={discardLegacy}
        />
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
          <div className="flex items-center gap-2">
            {streak && <StreakBadge streak={streak} />}
            <LogoutButton />
          </div>
        </div>

        {/* 单元上下文 */}
        {unitCategory && (
          <div className="mx-auto mb-4 flex w-full max-w-md px-5">
            <div className="flex items-center gap-2 rounded-full bg-[#EEF4FF] px-4 py-1.5 text-[13px] font-medium text-[#2563EB] dark:bg-[#1E3A5F] dark:text-[#60A5FA]">
              <span>{tc(unitCategory)}</span>
            </div>
          </div>
        )}

        {/* 进度条：只保留一条安静的位置感，不显示「第 N / 总数」
            以免给学生「还有好多要做」的压迫感。可以随时退出，进度会自动保留。 */}
        <div className="mx-auto mb-5 w-full max-w-md px-5">
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
                  disabled={interactionGuarded}
                  interactionEpoch={interactionEpoch}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ───────── 完成渲染 ─────────
  if (done || (queue.length === 0 && !loading)) {
    const hasQuiz = quizStats.correct + quizStats.wrong > 0;
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-5 text-center">
        <RotationNotice
          message={rotationNotice}
          onRetry={() => void rotateStudySession()}
          onReload={reloadStudyQueue}
        />
        <CardMotionProbePanel
          enabled={cardProbeEnabled}
          probe={cardMotionProbe}
          onClear={clearCardMotionProbe}
          onClose={() => setCardProbeEnabled(false)}
        />
        <AchievementToast
          items={newAchievements}
          onClose={() => setNewAchievements([])}
        />
        <PendingSyncBanner
          pending={pendingSync}
          blocked={blockedSync}
          blockedError={blockedSyncError}
          legacy={legacySync}
          onRetry={() => void flushAndReconcile()}
          onDiscardBlocked={discardBlocked}
          onClaimLegacy={claimLegacy}
          onDiscardLegacy={discardLegacy}
        />
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
        {streak && streak.count > 0 && (
          <div className="mb-6 flex items-center gap-2 rounded-2xl bg-[#FFF7E6] px-5 py-3 text-[14px] font-semibold text-[#F59E0B] dark:bg-[#2A1E00] dark:text-[#FBBF24]">
            🔥 {tc(`已连续学习 ${streak.count} 天，继续加油！`)}
          </div>
        )}
        {/* 打卡日历：当月视图，激励保持连续学习 */}
        <div className="mb-6 w-full max-w-sm">
          <StreakCalendar />
        </div>
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
          <Link
            href="/achievements"
            className="text-[13px] font-medium text-[#F59E0B] transition hover:text-[#FBBF24] dark:text-[#FBBF24]"
          >
            🎖 {tc("查看我的成就")}
          </Link>
        </div>
      </div>
    );
  }

  if (!current) return null;

  // ───────── 认字评估阶段渲染 ─────────
  return (
    <div className="flex min-h-full flex-col pb-8">
      <RotationNotice
        message={rotationNotice}
        onRetry={() => void rotateStudySession()}
        onReload={reloadStudyQueue}
      />
      <CardMotionProbePanel
        enabled={cardProbeEnabled}
        probe={cardMotionProbe}
        onClear={clearCardMotionProbe}
        onClose={() => setCardProbeEnabled(false)}
      />
      <ResumeToast visible={showResumedBanner} />
      <AchievementToast
        items={newAchievements}
        onClose={() => setNewAchievements([])}
      />
      <PendingSyncBanner
        pending={pendingSync}
        blocked={blockedSync}
        blockedError={blockedSyncError}
        legacy={legacySync}
        onRetry={() => void flushAndReconcile()}
        onDiscardBlocked={discardBlocked}
        onClaimLegacy={claimLegacy}
        onDiscardLegacy={discardLegacy}
      />
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

        <span className="text-[13px] font-medium text-[#7C89A5] dark:text-[#64748B]">
          {tc("今日学习 · 认识这个单词吗？")}
        </span>

        <div className="flex items-center gap-2">
          {streak && <StreakBadge streak={streak} />}
          <LogoutButton />
        </div>
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
        <div className="mb-2 flex items-center justify-center gap-3 text-[13px]">
          <span className="font-medium text-[#22C55E] dark:text-[#4ADE80]">{tc("认识")} {knownWords.length}</span>
          <span className="text-[#E7EDF8] dark:text-[#1E293B]">·</span>
          <span className="font-medium text-[#EF6B6B] dark:text-[#F87171]">{tc("不认识")} {unknownWords.length}</span>
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
        <motion.div
          key={current.word.id + currentIndex}
          className="w-full"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <WordCard
            word={current.word}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
            disabled={helpVisible || interactionGuarded}
            interactionEpoch={interactionEpoch}
            onMotionProbe={cardProbeEnabled ? recordCardMotionProbe : undefined}
          />
        </motion.div>
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
