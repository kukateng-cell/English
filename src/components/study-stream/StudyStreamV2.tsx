"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import WordCard from "@/components/WordCard";
import ErrorBanner from "@/components/ErrorBanner";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import type {
  PublicStreamActionResponse,
  PublicStreamItemBase,
  PublicStreamResponse,
  StudyStreamActionInput,
} from "@/lib/study-stream/contracts";
import {
  enqueueStudyStreamAction,
  loadStudyStreamOutbox,
  markStudyStreamActionBlocked,
  removeStudyStreamAction,
  resetStudyStreamAction,
  saveStudyStreamCheckpoint,
  StudyStreamOutboxCorruptError,
  studyStreamCheckpointStorageKey,
  studyStreamOutboxStorageKey,
  updateStudyStreamAction,
} from "@/lib/study-stream/outbox";

interface StudyStreamV2Props {
  userId: string;
}

function scopeParameters(): URLSearchParams {
  const current = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const level = current.get("level");
  const category = current.get("category");
  if (current.get("mode") === "unit" || (level && category)) params.set("mode", "unit");
  if (level) params.set("level", level);
  if (category) params.set("category", category);
  return params;
}

function scopeCheckpointKey(): string {
  const current = new URLSearchParams(window.location.search);
  const level = current.get("level");
  const category = current.get("category");
  return level && category ? `${level}::${category}` : "global";
}

function errorText(value: unknown): string {
  if (value instanceof StudyStreamOutboxCorruptError) {
    return "本机待同步学习操作已损坏，学习流已暂停；请保留此页面并联系支持人员恢复同步。";
  }
  if (value instanceof TypeError && /fetch/i.test(value.message)) {
    return "网络暂时不可用；待同步操作已保留，请恢复网络后重试。";
  }
  if (value instanceof Error && value.message) return value.message;
  return "学习同步暂时不可用，请检查网络后重试";
}

interface StudyStreamRequestError extends Error {
  status?: number;
  code?: string;
}

function isRecoverableStudyStreamError(value: unknown): value is StudyStreamRequestError {
  if (!(value instanceof Error)) return false;
  const candidate = value as StudyStreamRequestError;
  if (candidate.code === "SESSION_EXPIRED") return true;
  if (candidate.code === "ITEM_CREDENTIAL_EXPIRED") return true;
  if (candidate.code === "EXPIRED_ITEM_LEASE") return true;
  // Keep compatibility with an older same-version server response that did
  // not include the allowlisted code, but never infer recovery from a
  // SESSION_REVOKED response or from the generic credential error.
  return candidate.code === undefined && /session\s*(已过期|已失效)/iu.test(candidate.message);
}

function newOperationId(): string {
  return `stream-${crypto.randomUUID()}`;
}

async function readResponse(response: Response): Promise<unknown> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : `学习操作失败（${response.status}）`;
    const code = typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
      ? data.code
      : undefined;
    const error = new Error(message) as StudyStreamRequestError;
    error.status = response.status;
    if (code) error.code = code;
    throw error;
  }
  return data;
}

export default function StudyStreamV2({ userId }: StudyStreamV2Props) {
  const { tc } = useLocale();
  const [session, setSession] = useState<PublicStreamResponse["session"] | null>(null);
  const [item, setItem] = useState<PublicStreamItemBase | null>(null);
  const [unitSummary, setUnitSummary] = useState<PublicStreamResponse["unitSummary"]>();
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [syncBlocked, setSyncBlocked] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const loadedRef = useRef(false);

  const updateCheckpoint = useCallback((nextItem: PublicStreamItemBase | null, nextSession = session, blocked = false) => {
    if (!nextSession) return;
    const phase = blocked
      ? "sync-blocked"
      : nextItem?.feedback
        ? "feedback"
        : nextItem?.kind === "OBJECTIVE_PROBE"
          ? "objective-probe"
          : "learning-card";
    saveStudyStreamCheckpoint(userId, scopeCheckpointKey(), {
      sessionId: nextSession.id,
      streamItemId: nextItem?.streamItemId ?? null,
      clientRevision: nextItem?.clientRevision ?? nextSession.revision,
      phase,
    });
  }, [session, userId]);

  const fetchStream = useCallback(async (credential?: string | null): Promise<PublicStreamResponse> => {
    const params = scopeParameters();
    if (credential) params.set("itemCredential", credential);
    const query = params.toString();
    const response = await fetch(`/api/study/stream${query ? `?${query}` : ""}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || !((data as Record<string, unknown>).assigned === true)) {
      throw new Error("当前账户未获得 V2 学习流分配");
    }
    return data as PublicStreamResponse;
  }, []);

  const applyBootstrap = useCallback((data: PublicStreamResponse) => {
    setSession(data.session);
    setItem(data.item);
    setUnitSummary(data.unitSummary);
    setSelectedOptionId(data.item?.feedback?.selectedOptionId ?? null);
    updateCheckpoint(data.item, data.session);
  }, [updateCheckpoint]);

  const postAction = useCallback(async (action: StudyStreamActionInput): Promise<PublicStreamActionResponse> => {
    const response = await fetch("/api/study/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(action),
    });
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || (data as Record<string, unknown>).ok !== true) {
      throw new Error("学习操作回执无效");
    }
    return data as PublicStreamActionResponse;
  }, []);

  const recoverAction = useCallback(async (action: StudyStreamActionInput): Promise<PublicStreamActionResponse> => {
    const response = await fetch("/api/study/actions/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(action),
    });
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || (data as Record<string, unknown>).ok !== true) {
      throw new Error("学习操作恢复回执无效");
    }
    return data as PublicStreamActionResponse;
  }, []);

  const postActionWithRecovery = useCallback(async (action: StudyStreamActionInput): Promise<PublicStreamActionResponse> => {
    try {
      return await postAction(action);
    } catch (error) {
      // Exactly one explicit recovery request is allowed. If the recovery
      // route rejects it, the durable outbox remains blocked and no client
      // loop silently resubmits the same operation.
      if (!isRecoverableStudyStreamError(error)) throw error;
      return recoverAction(action);
    }
  }, [postAction, recoverAction]);

  const refreshOutbox = useCallback(() => {
    try {
      const rows = loadStudyStreamOutbox(userId);
      setOutboxCount(rows.length);
      setSyncBlocked(rows.some((row) => row.status === "blocked"));
      setSyncError(rows.find((row) => row.status === "blocked")?.lastError ?? null);
    } catch (error) {
      setSyncBlocked(true);
      setSyncError(errorText(error));
    }
  }, [userId]);

  const reloadStream = useCallback(async (credential?: string | null) => {
    setLoading(true);
    try {
      const data = await fetchStream(credential);
      applyBootstrap(data);
      setSyncError(null);
      setEpoch((value) => value + 1);
      refreshOutbox();
    } catch (error) {
      setSyncError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap, fetchStream, refreshOutbox]);

  const applyActionResponse = useCallback(async (
    action: StudyStreamActionInput,
    response: PublicStreamActionResponse,
  ) => {
    if (action.actionKind === "REVEAL") {
      setItem((current) => current && response.learningCard
        ? { ...current, learningCard: response.learningCard }
        : current);
      updateCheckpoint(item, session);
      return;
    }
    if (action.actionKind === "OBJECTIVE_ANSWER") {
      setItem((current) => current && response.feedback
        ? { ...current, feedback: response.feedback, clientRevision: response.clientRevision }
        : current);
      setSelectedOptionId(response.feedback?.selectedOptionId ?? selectedOptionId);
      if (session && item && response.feedback) {
        updateCheckpoint({ ...item, feedback: response.feedback, clientRevision: response.clientRevision }, session);
      }
      return;
    }
    await reloadStream();
  }, [item, reloadStream, selectedOptionId, session, updateCheckpoint]);

  const flushOne = useCallback(async (rows?: ReturnType<typeof loadStudyStreamOutbox>) => {
    let availableRows: ReturnType<typeof loadStudyStreamOutbox>;
    try {
      availableRows = rows ?? loadStudyStreamOutbox(userId);
    } catch (error) {
      setSyncBlocked(true);
      setSyncError(errorText(error));
      return;
    }
    const row = availableRows[0];
    if (!row) {
      refreshOutbox();
      return;
    }
    try {
      const response = await postActionWithRecovery(row.action);
      removeStudyStreamAction(userId, row.action.operationId);
      setSyncError(null);
      await applyActionResponse(row.action, response);
      refreshOutbox();
    } catch (error) {
      const status = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
      if (status === 403) {
        try {
          const refreshed = await fetchStream(row.action.itemCredential);
          if (
            refreshed.item &&
            refreshed.item.streamItemId === row.action.streamItemId &&
            refreshed.session.id === row.action.studySessionId
          ) {
            const rebound = {
              ...row.action,
              itemCredential: refreshed.item.itemCredential,
              clientKnownRevision: refreshed.item.clientRevision,
            };
            updateStudyStreamAction(userId, row.action.operationId, {
              studySessionId: rebound.studySessionId,
              streamItemId: rebound.streamItemId,
              itemCredential: rebound.itemCredential,
              clientKnownRevision: rebound.clientKnownRevision,
            });
            const response = await postAction(rebound);
            removeStudyStreamAction(userId, rebound.operationId);
            await applyActionResponse(rebound, response);
            setSyncError(null);
            refreshOutbox();
            return;
          }
        } catch {
          // The original authorization/expiry error remains the actionable state.
        }
      }
      try {
        markStudyStreamActionBlocked(userId, row.action.operationId, errorText(error));
      } catch {
        // The visible sync error below is still actionable when storage is unavailable.
      }
      setSyncBlocked(true);
      setSyncError(errorText(error));
      refreshOutbox();
    }
  }, [applyActionResponse, fetchStream, postAction, postActionWithRecovery, refreshOutbox, userId]);

  const submitAction = useCallback(async (
    actionKind: StudyStreamActionInput["actionKind"],
    payload: StudyStreamActionInput["payload"],
  ) => {
    if (!item || !session || actionPending || syncBlocked) return;
    const action: StudyStreamActionInput = {
      flowVersion: "v2",
      studySessionId: session.id,
      streamItemId: item.streamItemId,
      operationId: newOperationId(),
      itemCredential: item.itemCredential,
      actionKind,
      clientKnownRevision: item.clientRevision,
      payload,
    };
    const queued = enqueueStudyStreamAction(userId, action);
    if (!queued.ok) {
      setSyncBlocked(true);
      setSyncError(queued.error);
      return;
    }
    setOutboxCount((count) => count + 1);
    setActionPending(true);
    try {
      const response = await postActionWithRecovery(action);
      removeStudyStreamAction(userId, action.operationId);
      await applyActionResponse(action, response);
      setSyncError(null);
    } catch (error) {
      try {
        markStudyStreamActionBlocked(userId, action.operationId, errorText(error));
      } catch {
        // Keep the operation blocked in the visible state even if local storage is unavailable.
      }
      setSyncBlocked(true);
      setSyncError(errorText(error));
      updateCheckpoint(item, session, true);
    } finally {
      setActionPending(false);
      refreshOutbox();
    }
  }, [actionPending, applyActionResponse, item, postActionWithRecovery, refreshOutbox, session, syncBlocked, updateCheckpoint, userId]);

  const retrySync = useCallback(async () => {
    let rows: ReturnType<typeof loadStudyStreamOutbox>;
    try {
      rows = loadStudyStreamOutbox(userId);
    } catch (error) {
      setSyncBlocked(true);
      setSyncError(errorText(error));
      return;
    }
    const row = rows[0];
    if (!row) {
      setSyncBlocked(false);
      setSyncError(null);
      return;
    }
    try {
      resetStudyStreamAction(userId, row.action.operationId);
    } catch (error) {
      setSyncBlocked(true);
      setSyncError(errorText(error));
      return;
    }
    setActionPending(true);
    await flushOne();
    setActionPending(false);
  }, [flushOne, userId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    let pending: ReturnType<typeof loadStudyStreamOutbox>[number] | undefined;
    try {
      pending = loadStudyStreamOutbox(userId)[0];
    } catch (error) {
      // Defer the state transition so React's effect lint rule remains
      // satisfied. Do not cancel this callback: in Strict Mode the first
      // effect is cleaned up before its microtask runs, but it is still the
      // only bootstrap attempt after the corrupt-storage fail-closed branch.
      queueMicrotask(() => {
        setSyncBlocked(true);
        setSyncError(errorText(error));
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void reloadStream(pending?.action.itemCredential ?? null).then(() => {
      if (cancelled) return;
      refreshOutbox();
      if (pending?.status === "pending") {
        setActionPending(true);
        void flushOne().finally(() => setActionPending(false));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flushOne, refreshOutbox, reloadStream, userId]);

  useEffect(() => {
    const handleOnline = () => {
      if (!actionPending) void retrySync();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [actionPending, retrySync]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const outboxKey = studyStreamOutboxStorageKey(userId);
      const checkpointKey = studyStreamCheckpointStorageKey(userId, scopeCheckpointKey());
      if (event.key === outboxKey) {
        refreshOutbox();
        return;
      }
      if (event.key === checkpointKey || event.key === null) {
        refreshOutbox();
        if (!actionPending) void reloadStream();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [actionPending, refreshOutbox, reloadStream, userId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Speech warm-up remains presentation-only and never affects admission or scoring.
      void import("@/lib/speech").then(({ warmUpSpeech }) => warmUpSpeech());
    }
  }, []);

  const leaveHref = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).has("category")
    ? "/units"
    : "/";

  if (loading && !item) {
    return <div className="flex min-h-full items-center justify-center text-[var(--muted)]">{tc("加载连续学习流...")}</div>;
  }
  if (syncError && !item) {
    return <ErrorBanner message={syncError} onRetry={() => void reloadStream()} />;
  }

  return (
    <div className="flex min-h-full flex-col pb-8">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pt-5 pb-3">
        <Link href={leaveHref} aria-label={tc("离开学习")} className="study-icon-action flex h-9 w-9 items-center justify-center rounded-xl">
          <Icon name="arrow-left" size={18} />
        </Link>
        <span className="study-muted text-[14px] font-medium">{tc("连续学习")}</span>
        <div className="flex items-center gap-2">
          <ThemeToggle className="study-header-icon study-header-theme" />
          <LogoutButton />
        </div>
      </div>

      {syncBlocked && (
        <div className="mx-auto mb-4 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-[13px] text-[var(--danger)]" role="alert">
          <span>{tc(syncError ?? "学习操作尚未同步，当前项目已暂停")}</span>
          <button type="button" onClick={() => void retrySync()} disabled={actionPending} className="shrink-0 font-semibold underline disabled:opacity-50">{tc("重试")}</button>
        </div>
      )}
      {outboxCount > 0 && !syncBlocked ? <p className="mx-auto mb-3 w-full max-w-md px-5 text-center text-[12px] text-[var(--muted)]">{tc(`待同步 ${outboxCount} 项`)}</p> : null}

      {unitSummary ? (
        <div className="mx-auto mb-4 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12px] text-[var(--muted)]" aria-label={tc("单元学习摘要") as string}>
          <span>{tc("覆盖词数")} {unitSummary.encounteredWordCount}/{unitSummary.totalWordCount}</span>
          <span>{tc("客观认读证据")} {unitSummary.objectiveRecognitionCount}</span>
        </div>
      ) : null}

      <div className="flex-1 px-2 pt-2">
        {item ? (
          item.kind === "LEARNING_CARD" ? (
            <LearningCardView
              item={item}
              disabled={actionPending || syncBlocked}
              epoch={epoch}
              onReveal={() => void submitAction("REVEAL", {})}
              onSelfRating={(rating) => void submitAction("SELF_RATING", { selfRating: rating })}
            />
          ) : (
            <ObjectiveProbeView
              item={item}
              disabled={actionPending || syncBlocked}
              selectedOptionId={selectedOptionId}
              onSelect={(optionId) => {
                setSelectedOptionId(optionId);
                void submitAction("OBJECTIVE_ANSWER", { selectedOptionId: optionId });
              }}
              onAcknowledge={() => void submitAction("FEEDBACK_ACK", {})}
            />
          )
        ) : (
          <div className="mx-auto flex min-h-[50vh] w-full max-w-md flex-col items-center justify-center text-center">
            <p className="mb-4 text-[var(--muted)]">{tc(unitSummary ? "本单元目前没有可安全安排的学习项目" : "目前没有可安全安排的学习项目")}</p>
            <button type="button" onClick={() => void reloadStream()} className="study-primary-action rounded-2xl px-5 py-3 text-sm font-semibold">{tc("重新载入")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function LearningCardView({
  item,
  disabled,
  epoch,
  onReveal,
  onSelfRating,
}: {
  item: PublicStreamItemBase;
  disabled: boolean;
  epoch: number;
  onReveal: () => void;
  onSelfRating: (rating: "selfForgot" | "selfRecalled") => void;
}) {
  const { tc } = useLocale();
  const revealed = Boolean(item.learningCard);
  const hintKey = `${item.streamItemId}:${item.clientRevision}`;
  const [longPressHintKey, setLongPressHintKey] = useState<string | null>(null);

  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => setLongPressHintKey(hintKey), 1_000);
    return () => window.clearTimeout(timer);
  }, [hintKey, revealed]);

  const showLongPressHint = !revealed && longPressHintKey === hintKey;

  return (
    <div className="mx-auto w-full max-w-md">
      <WordCard
        word={{ term: item.prompt, phonetic: item.learningCard?.phonetic }}
        onSwipeLeft={() => onSelfRating("selfForgot")}
        onSwipeRight={() => onSelfRating("selfRecalled")}
        disabled={disabled}
        cardHint={tc("先试着想一想这个词的中文意思")}
        cardHintSecondary={showLongPressHint ? tc("长按 3 秒揭示答案") : undefined}
        cardHintState="think"
        cardBackContent={revealed ? (
          <div className="word-card-answer-definition">
            <p className="mb-2 text-xs font-semibold text-[var(--muted)]">{tc("中文意思")}</p>
            <p className="text-base font-semibold leading-relaxed text-[var(--text)]">{tc(item.learningCard?.definition ?? "")}</p>
            {item.learningCard?.examples.length ? <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{item.learningCard.examples[0].en}</p> : null}
          </div>
        ) : null}
        isFlipped={revealed}
        onCardLongPress={revealed ? undefined : onReveal}
        longPressDurationMs={3_000}
        swipeEnabled={revealed}
        swipeLeftLabel={tc("和刚才想的不一样")}
        swipeRightLabel={tc("和刚才想的一样")}
        showInteractionHint={revealed}
        interactionEpoch={epoch}
        queueNote={tc("可随时离开，进度会安全保留")}
      >
        {revealed ? (
          <div data-testid="study-stream-self-rating-actions" className="word-card-actions">
            <div className="swipe-actions">
              <button
                type="button"
                data-testid="study-stream-self-rating-left"
                onClick={() => onSelfRating("selfForgot")}
                disabled={disabled}
                className="swipe-action swipe-action-left"
              >
                <Icon name="arrow-left" size={22} />
                {tc("和刚才想的不一样")}
              </button>
              <button
                type="button"
                data-testid="study-stream-self-rating-right"
                onClick={() => onSelfRating("selfRecalled")}
                disabled={disabled}
                className="swipe-action swipe-action-right"
              >
                {tc("和刚才想的一样")}
                <Icon name="arrow-right" size={22} />
              </button>
            </div>
          </div>
        ) : null}
      </WordCard>
    </div>
  );
}

function ObjectiveProbeView({
  item,
  disabled,
  selectedOptionId,
  onSelect,
  onAcknowledge,
}: {
  item: PublicStreamItemBase;
  disabled: boolean;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  onAcknowledge: () => void;
}) {
  const { tc } = useLocale();
  const question = item.objectiveQuestion;
  if (!question) return null;
  const answered = Boolean(item.feedback);
  return (
    <div className="mx-auto w-full max-w-md px-3">
      <div className="mb-4 text-center"><span className="quiz-prompt-label inline-block rounded-full px-4 py-1.5 text-[13px] font-medium">{tc(question.direction === "en-zh" ? "看英文，选中文" : "看中文，选英文")}</span></div>
      <div className="quiz-card-surface mb-6 rounded-[28px] border p-8 text-center">
        <p className="mb-2 text-xs font-semibold text-[var(--muted)]">{tc("客观检索题")}</p>
        <h2 className="text-3xl font-bold leading-tight text-[var(--text)]">{question.prompt}</h2>
      </div>
      <div className="flex flex-col gap-3" role="radiogroup" aria-label={tc("客观题选项") as string}>
        {question.options.map((option, index) => {
          const feedback = item.feedback;
          const isCorrect = feedback?.correctOptionId === option.id;
          const isWrong = feedback?.selectedOptionId === option.id && !isCorrect;
          const stateClass = isCorrect ? "quiz-option-correct" : isWrong ? "quiz-option-wrong" : feedback ? "quiz-option-dim" : "";
          return (
            <label
              key={option.id}
              className={`quiz-option flex items-center gap-3 rounded-2xl border-2 px-5 py-4 text-left text-[15px] leading-snug transition-all focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:ring-offset-2 ${stateClass} ${disabled || answered ? "cursor-default opacity-80" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={`study-stream-option-${item.streamItemId}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                disabled={disabled || answered}
                onChange={() => onSelect(option.id)}
                className="sr-only"
              />
              <span className="quiz-option-index flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">{String.fromCharCode(65 + index)}</span>
              <span>{tc(option.text)}</span>
            </label>
          );
        })}
      </div>
      {item.feedback ? (
        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center" aria-live="polite">
          <p className="font-semibold text-[var(--text)]">{item.feedback.isCorrect ? tc("答对了") : tc("这次先记住正确答案")}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{tc("这是只读反馈；确认后继续下一项，不会重复改分")}</p>
          <button type="button" onClick={onAcknowledge} disabled={disabled} className="study-primary-action mt-4 rounded-2xl px-6 py-3 text-sm font-semibold disabled:opacity-50">{tc("我看到了，继续")}</button>
        </div>
      ) : null}
    </div>
  );
}
