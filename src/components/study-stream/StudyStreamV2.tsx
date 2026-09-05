"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WordCard from "@/components/WordCard";
import ErrorBanner from "@/components/ErrorBanner";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import Icon from "@/components/ui/Icon";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { clearStudyClientState } from "@/lib/study-client-state";
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
    return "本機待同步學習操作已損壞，學習流已暫停；請保留此頁面並聯絡支援人員恢復同步。";
  }
  if (value instanceof TypeError && /fetch/i.test(value.message)) {
    return "網絡暫時不可用；待同步操作已保留，請恢復網絡後重試。";
  }
  if (value instanceof Error && value.message) return value.message;
  return "學習同步暫時不可用，請檢查網絡後重試";
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

function isTerminalStudyStreamConflict(
  value: unknown,
  action: StudyStreamActionInput,
): value is StudyStreamRequestError {
  if (!(value instanceof Error) || action.actionKind !== "OBJECTIVE_ANSWER") return false;
  const candidate = value as StudyStreamRequestError;
  return candidate.status === 409 && (
    candidate.code === "OBJECTIVE_TARGET_CONSUMED" ||
    candidate.code === "OBJECTIVE_TARGET_CLOSED" ||
    candidate.code === "STALE_EVIDENCE_TARGET" ||
    candidate.code === "SUPERSEDED_STREAM_ITEM"
  );
}

function newOperationId(): string {
  return `stream-${crypto.randomUUID()}`;
}

async function readResponse(response: Response): Promise<unknown> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : `學習操作失敗（${response.status}）`;
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
  const router = useRouter();
  const [session, setSession] = useState<PublicStreamResponse["session"] | null>(null);
  const [item, setItem] = useState<PublicStreamItemBase | null>(null);
  const [unitSummary, setUnitSummary] = useState<PublicStreamResponse["unitSummary"]>();
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [syncBlocked, setSyncBlocked] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const loadedRef = useRef(false);
  const authInvalidatedRef = useRef(false);
  const bootstrapGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleAuthInvalidation = useCallback(() => {
    if (authInvalidatedRef.current) return;
    authInvalidatedRef.current = true;
    clearStudyClientState(userId);
    setSession(null);
    setItem(null);
    setUnitSummary(undefined);
    setOutboxCount(0);
    setSyncBlocked(true);
    setSyncError("登入已失效，請重新登入");
    setRefreshPending(false);
    setRefreshError(null);
    if (typeof window !== "undefined") {
      const callbackUrl = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [router, userId]);

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
      throw new Error("目前帳戶未獲得 V2 學習流分配");
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
      const response = await rosterFetch("/api/study/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(action),
    });
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || (data as Record<string, unknown>).ok !== true) {
      throw new Error("學習操作回執無效");
    }
    return data as PublicStreamActionResponse;
  }, []);

  const recoverAction = useCallback(async (action: StudyStreamActionInput): Promise<PublicStreamActionResponse> => {
    const response = await rosterFetch("/api/study/actions/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(action),
    });
    const data = await readResponse(response);
    if (typeof data !== "object" || data === null || (data as Record<string, unknown>).ok !== true) {
      throw new Error("學習操作恢復回執無效");
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

  const reloadStream = useCallback(async (credential?: string | null): Promise<"loaded" | "stale" | "failed"> => {
    if (!mountedRef.current) return "stale";
    const generation = ++bootstrapGenerationRef.current;
    const scope = scopeCheckpointKey();
    const isCurrent = () => generation === bootstrapGenerationRef.current &&
      scope === scopeCheckpointKey() && mountedRef.current && !authInvalidatedRef.current;
    setLoading(true);
    try {
      const data = await fetchStream(credential);
      if (!isCurrent()) return "stale";
      applyBootstrap(data);
      setSyncError(null);
      setRefreshPending(false);
      setRefreshError(null);
      setEpoch((value) => value + 1);
      refreshOutbox();
      return "loaded";
    } catch (error) {
      if (!isCurrent()) return "stale";
      const status = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
      if (status === 401 || code === "SESSION_REVOKED") handleAuthInvalidation();
      setSyncError(errorText(error));
      return "failed";
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [applyBootstrap, fetchStream, handleAuthInvalidation, refreshOutbox]);

  const refreshAuthoritativeState = useCallback(async (): Promise<boolean> => {
    const result = await reloadStream();
    if (result === "loaded") return true;
    if (result === "failed" && !authInvalidatedRef.current && mountedRef.current) {
      setRefreshPending(true);
      setRefreshError("操作已儲存，但畫面尚未更新；請重新載入");
    }
    return false;
  }, [reloadStream]);

  const applyActionResponse = useCallback(async (
    action: StudyStreamActionInput,
    response: PublicStreamActionResponse,
  ): Promise<boolean> => {
    if (response.operationId !== action.operationId || response.actionKind !== action.actionKind) {
      throw new Error("學習操作回執身份不符");
    }
    // Outbox is learner-wide, but this screen is scope-local. Never merge a
    // receipt's card, feedback or revision into whichever item is now visible.
    // Even a same-item replay can be older than the current server state.
    return refreshAuthoritativeState();
  }, [refreshAuthoritativeState]);

  const discardTerminalAction = useCallback(async (action: StudyStreamActionInput): Promise<boolean> => {
    try {
      await removeStudyStreamAction(userId, action.operationId);
    } catch {
      return false;
    }
    await refreshAuthoritativeState();
    refreshOutbox();
    return true;
  }, [refreshAuthoritativeState, refreshOutbox, userId]);

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
      await removeStudyStreamAction(userId, row.action.operationId);
      setSyncError(null);
      await applyActionResponse(row.action, response);
      refreshOutbox();
    } catch (error) {
      const status = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
      if (isTerminalStudyStreamConflict(error, row.action) && await discardTerminalAction(row.action)) return;
      if (status === 401 || code === "SESSION_REVOKED") {
        handleAuthInvalidation();
        return;
      }
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
            await updateStudyStreamAction(userId, row.action.operationId, {
              studySessionId: rebound.studySessionId,
              streamItemId: rebound.streamItemId,
              itemCredential: rebound.itemCredential,
              clientKnownRevision: rebound.clientKnownRevision,
            });
            const response = await postAction(rebound);
            await removeStudyStreamAction(userId, rebound.operationId);
            await applyActionResponse(rebound, response);
            setSyncError(null);
            refreshOutbox();
            return;
          }
        } catch (reboundError) {
          if (isTerminalStudyStreamConflict(reboundError, row.action) && await discardTerminalAction(row.action)) return;
          // The original authorization/expiry error remains the actionable state.
        }
      }
      try {
        await markStudyStreamActionBlocked(userId, row.action.operationId, errorText(error));
      } catch {
        // The visible sync error below is still actionable when storage is unavailable.
      }
      setSyncBlocked(true);
      setSyncError(errorText(error));
      refreshOutbox();
    }
  }, [applyActionResponse, discardTerminalAction, fetchStream, handleAuthInvalidation, postAction, postActionWithRecovery, refreshOutbox, userId]);

  const submitAction = useCallback(async (
    actionKind: StudyStreamActionInput["actionKind"],
    payload: StudyStreamActionInput["payload"],
  ) => {
    if (!item || !session || actionPending || syncBlocked || refreshPending) return;
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
    setActionPending(true);
    const queued = await enqueueStudyStreamAction(userId, action);
    if (!queued.ok) {
      setActionPending(false);
      setSyncBlocked(true);
      setSyncError(queued.error);
      return;
    }
    setOutboxCount((count) => count + 1);
    try {
      const response = await postActionWithRecovery(action);
      await removeStudyStreamAction(userId, action.operationId);
      await applyActionResponse(action, response);
      setSyncError(null);
    } catch (error) {
      const status = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
      if (isTerminalStudyStreamConflict(error, action) && await discardTerminalAction(action)) return;
      if (status === 401 || code === "SESSION_REVOKED") {
        handleAuthInvalidation();
        return;
      }
      try {
        await markStudyStreamActionBlocked(userId, action.operationId, errorText(error));
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
  }, [actionPending, applyActionResponse, discardTerminalAction, handleAuthInvalidation, item, postActionWithRecovery, refreshOutbox, refreshPending, session, syncBlocked, updateCheckpoint, userId]);

  const retryRefresh = useCallback(async () => {
    if (!refreshPending || actionPending) return;
    setActionPending(true);
    await refreshAuthoritativeState();
    if (mountedRef.current) setActionPending(false);
  }, [actionPending, refreshAuthoritativeState, refreshPending]);

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
      if (refreshPending) {
        setActionPending(true);
        await refreshAuthoritativeState();
        if (mountedRef.current) setActionPending(false);
        return;
      }
      setSyncBlocked(false);
      setSyncError(null);
      return;
    }
    try {
      await resetStudyStreamAction(userId, row.action.operationId);
    } catch (error) {
      setSyncBlocked(true);
      setSyncError(errorText(error));
      return;
    }
    setActionPending(true);
    await flushOne();
    setActionPending(false);
  }, [flushOne, refreshAuthoritativeState, refreshPending, userId]);

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
    return <div className="flex min-h-full items-center justify-center text-[var(--muted)]">{tc("載入連續學習流...")}</div>;
  }
  if (syncError && !item) {
    return <ErrorBanner message={syncError} onRetry={() => void reloadStream()} />;
  }

  const interactionDisabled = actionPending || syncBlocked || refreshPending;

  return (
    <div className="flex min-h-full flex-col pb-8">
      <div className="study-stream-header mx-auto flex w-full items-center justify-between px-5 pt-5 pb-3">
        <Link href={leaveHref} aria-label={tc("離開學習")} className="study-header-icon study-header-back">
          <Icon name="chevron-left" size={26} />
        </Link>
        <h1 data-testid="study-stream-title" className="study-stream-title">{tc("連續學習")}</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle className="study-header-icon study-header-theme" />
          <LogoutButton />
        </div>
      </div>

      {syncBlocked && (
        <div className="mx-auto mb-4 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-[13px] text-[var(--danger)]" role="alert">
          <span>{tc(syncError ?? "學習操作尚未同步，目前項目已暫停")}</span>
          <button type="button" onClick={() => void retrySync()} disabled={actionPending} className="shrink-0 font-semibold underline disabled:opacity-50">{tc("重試")}</button>
        </div>
      )}
      {refreshPending && (
        <div data-testid="study-stream-refresh-pending" className="mx-auto mb-4 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-3 text-[13px] text-[var(--text)]" role="alert">
          <span>{tc(refreshError ?? "操作已儲存，但畫面尚未更新；請重新載入")}</span>
          <button type="button" onClick={() => void retryRefresh()} disabled={actionPending || loading} className="shrink-0 font-semibold underline disabled:opacity-50">{tc("重新載入")}</button>
        </div>
      )}
      {outboxCount > 0 && !syncBlocked ? <p className="mx-auto mb-3 w-full max-w-md px-5 text-center text-[12px] text-[var(--muted)]">{tc(`待同步 ${outboxCount} 項`)}</p> : null}

      {unitSummary ? (
        <div className="study-stream-summary mx-auto mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12px] text-[var(--muted)]" aria-label={tc("單元學習摘要") as string}>
          <span>{tc("覆蓋詞數")} {unitSummary.encounteredWordCount}/{unitSummary.totalWordCount}</span>
          <span>{tc("客觀認讀證據")} {unitSummary.objectiveRecognitionCount}</span>
        </div>
      ) : null}

      <div className="flex-1 px-2 pt-2">
        {item ? (
          item.kind === "LEARNING_CARD" ? (
            <LearningCardView
              item={item}
              disabled={interactionDisabled}
              epoch={epoch}
              onReveal={() => void submitAction("REVEAL", {})}
              onSelfRating={(rating) => void submitAction("SELF_RATING", { selfRating: rating })}
            />
          ) : (
            <ObjectiveProbeView
              item={item}
              disabled={interactionDisabled}
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
            <p className="mb-4 text-[var(--muted)]">{tc(unitSummary ? "本單元目前沒有可安全安排的學習項目" : "目前沒有可安全安排的學習項目")}</p>
            <button type="button" onClick={() => void reloadStream()} className="study-primary-action rounded-2xl px-5 py-3 text-sm font-semibold">{tc("重新載入")}</button>
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
  const answerPos = item.learningCard?.pos?.trim() || null;
  const [longPressHintKey, setLongPressHintKey] = useState<string | null>(null);

  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => setLongPressHintKey(hintKey), 1_000);
    return () => window.clearTimeout(timer);
  }, [hintKey, revealed]);

  const showLongPressHint = !revealed && longPressHintKey === hintKey;

  return (
    <div className="study-stream-learning-card mx-auto w-full">
      <WordCard
        word={{
          term: item.learningCard?.term ?? item.prompt,
          phonetic: item.learningCard?.phonetic,
          level: item.level,
          category: item.category,
        }}
        onSwipeLeft={() => onSelfRating("selfForgot")}
        onSwipeRight={() => onSelfRating("selfRecalled")}
        disabled={disabled}
        cardHint={tc("先試著想一想這個詞的中文意思")}
        cardHintSecondary={showLongPressHint ? tc("長按 3 秒揭示答案") : undefined}
        cardHintState="think"
        cardBackContent={revealed ? (
          <div className="word-card-answer-definition">
            <p className="word-card-answer-label">{tc("中文意思")}</p>
            <p className="word-card-answer-meaning">{tc(item.learningCard?.definition ?? "")}</p>
            {answerPos ? <p data-testid="word-card-answer-pos" className="word-card-answer-pos">{tc(answerPos)}</p> : null}
            {item.learningCard?.examples.length ? <p className="word-card-answer-example">{item.learningCard.examples[0].en}</p> : null}
          </div>
        ) : null}
        isFlipped={revealed}
        onCardLongPress={revealed ? undefined : onReveal}
        longPressDurationMs={3_000}
        swipeEnabled={revealed}
        swipeLeftLabel={tc("和剛才想的不一樣")}
        swipeRightLabel={tc("和剛才想的一樣")}
        showInteractionHint={revealed}
        interactionEpoch={epoch}
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
                {tc("和剛才想的不一樣")}
              </button>
              <button
                type="button"
                data-testid="study-stream-self-rating-right"
                onClick={() => onSelfRating("selfRecalled")}
                disabled={disabled}
                className="swipe-action swipe-action-right"
              >
                {tc("和剛才想的一樣")}
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
  const feedbackContinuationEnabled = answered && !disabled;
  const isEnglishToChinese = question.direction === "en-zh";
  return (
    <div className="study-stream-probe mx-auto w-full px-3">
      <div className="quiz-intro">
        <div className="quiz-intro-copy">
          <span className="quiz-eyebrow">{tc("認字小測")}</span>
          <h2 data-testid="study-stream-probe-title">{tc("把意思配回單詞")}</h2>
          <p>{tc("先回想，再選出最貼近的意思。")}</p>
        </div>
      </div>
      <div
        data-testid="study-stream-probe-card"
        className={`quiz-card-surface quiz-card-layout${feedbackContinuationEnabled ? " is-feedback-continuation" : ""}`}
        onClick={feedbackContinuationEnabled ? onAcknowledge : undefined}
        onKeyDown={feedbackContinuationEnabled ? (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onAcknowledge();
        } : undefined}
        role={feedbackContinuationEnabled ? "button" : undefined}
        tabIndex={feedbackContinuationEnabled ? 0 : undefined}
        aria-label={feedbackContinuationEnabled ? tc("輕點一下任意區域") : undefined}
      >
        <div className="quiz-prompt-meta">
          <span className="quiz-prompt-label">{tc(isEnglishToChinese ? "看英文" : "看中文")}</span>
          {item.level ? (
            <span data-testid="study-stream-probe-level" className="level-badge">
              {item.level} · {tc(item.category ?? "未分類")}
            </span>
          ) : null}
        </div>
        <h2 className={`quiz-card-term quiz-probe-prompt${isEnglishToChinese ? "" : " is-definition"}`}>
          {tc(question.prompt)}
        </h2>
        <p className="quiz-instruction">{tc(isEnglishToChinese ? "選出它的中文意思" : "選出最貼近的英文解釋")}</p>
        <div data-testid="study-stream-probe-options" className="quiz-options" role="radiogroup" aria-label={tc("客觀題選項") as string}>
          {question.options.map((option, index) => {
            const feedback = item.feedback;
            const isCorrect = feedback?.correctOptionId === option.id;
            const isWrong = feedback?.selectedOptionId === option.id && !isCorrect;
            const stateClass = isCorrect ? "quiz-option-correct" : isWrong ? "quiz-option-wrong" : feedback ? "quiz-option-dim" : "";
            return (
              <label
                key={option.id}
                className={`quiz-option ${stateClass} ${disabled || answered ? "cursor-default opacity-80" : "cursor-pointer"}`}
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
        <div
          data-testid="study-stream-feedback-affordance"
          className={`quiz-feedback-affordance-slot${item.feedback ? " is-visible" : ""}`}
          aria-hidden="true"
        >
          <span className="quiz-feedback-affordance-circle" />
        </div>
        <span className="sr-only" aria-live="polite">
          {item.feedback
            ? tc(item.feedback.isCorrect ? "答案已顯示為正確" : "答案已顯示為不正確")
            : null}
        </span>
      </div>
    </div>
  );
}
