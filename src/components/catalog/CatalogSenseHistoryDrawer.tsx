"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import {
  catalogCategoryLabel,
  catalogFieldLabel,
  catalogRequestKindLabel,
  catalogRequestStatusLabel,
} from "@/lib/catalog/teacher-presentation";
import {
  catalogHistoryArrayChangeText,
  catalogHistoryComparable,
  catalogHistoryDate,
  catalogHistoryValueText,
} from "@/components/catalog/catalogHistoryPresentation";

type HistorySnapshot = {
  term: string | null;
  definitionZh: string | null;
  level: string | null;
  category: string | null;
  status: string | null;
  payload: Record<string, unknown> | null;
};

type SenseHistoryItem = {
  id: string;
  kind: string;
  status: string;
  visibility: string;
  before: HistorySnapshot;
  after: HistorySnapshot;
  createdAt: string;
  reviewedAt: string | null;
  proposerName?: string | null;
  reviewerName?: string | null;
  reason?: string | null;
  reviewNote?: string | null;
  catalogKey?: string | null;
  senseKey?: string | null;
  resultRevisionId?: string | null;
};

function changedFields(
  item: SenseHistoryItem,
): Array<{ field: string; before: unknown; after: unknown }> {
  const before: Record<string, unknown> = {
    ...item.before.payload,
    term: item.before.term,
    definitionZh: item.before.definitionZh,
    level: item.before.level,
    category: item.before.category,
  };
  const after: Record<string, unknown> = {
    ...item.after.payload,
    term: item.after.term,
    definitionZh: item.after.definitionZh,
    level: item.after.level,
    category: item.after.category,
  };
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (field) =>
        catalogHistoryComparable(before[field]) !==
        catalogHistoryComparable(after[field]),
    )
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

export default function CatalogSenseHistoryDrawer({
  senseKey,
  term,
  canReview,
  onClose,
  onOpenFullHistory,
}: {
  senseKey: string;
  term: string;
  canReview: boolean;
  onClose: () => void;
  onOpenFullHistory: () => void;
}) {
  const { tc } = useLocale();
  const [items, setItems] = useState<SenseHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const loadRef = useRef<(cursor?: string | null) => Promise<void>>(
    async () => undefined,
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      const generation = ++generationRef.current;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(
          `/api/catalog/${encodeURIComponent(senseKey)}/history?${params}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (response.status === 409 && cursor) {
          const problem = (await response
            .clone()
            .json()
            .catch(() => null)) as {
            code?: string;
            recoverable?: boolean;
          } | null;
          if (
            problem?.code === "CATALOG_HISTORY_CURSOR_CONTEXT_MISMATCH" &&
            problem.recoverable
          ) {
            setItems([]);
            setNextCursor(null);
            window.setTimeout(() => {
              void loadRef.current();
            }, 0);
            return;
          }
        }
        if (!response.ok)
          throw new Error(await responseErrorMessage(response, tc));
        const payload = (await response.json()) as {
          items: SenseHistoryItem[];
          nextCursor: string | null;
        };
        if (generation !== generationRef.current) return;
        setItems((current) =>
          cursor ? [...current, ...payload.items] : payload.items,
        );
        setNextCursor(payload.nextCursor);
      } catch (cause) {
        if (
          generation !== generationRef.current ||
          (cause instanceof DOMException && cause.name === "AbortError")
        )
          return;
        setError(
          cause instanceof Error ? cause.message : tc("讀取詞條歷史失敗"),
        );
      } finally {
        if (generation === generationRef.current) setLoading(false);
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [senseKey, tc],
  );
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      generationRef.current += 1;
      requestRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          "button, a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-sense-history-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={tc("關閉詞條歷史") as string}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-[var(--surface)] p-5 shadow-2xl sm:p-6"
      >
        <header className="sticky top-0 z-10 -mx-5 -mt-5 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:-mx-6 sm:-mt-6 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--muted)]">
              {tc("詞條修改歷史")}
            </p>
            <h2
              id="catalog-sense-history-title"
              className="mt-1 truncate text-xl font-bold text-[var(--text)]"
            >
              {term || tc("未完成詞條")}
            </h2>
          </div>
          <button
            type="button"
            className="ui-button ui-button-quiet ui-button-small"
            onClick={onClose}
            aria-label={tc("關閉") as string}
          >
            ×
          </button>
        </header>
        <p className="mt-5 text-sm text-[var(--muted)]">
          {tc("這裡只顯示此詞義的提交、審核和正式套用記錄。")}
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 space-y-3" aria-live="polite">
          {items.map((item) => {
            const changes = changedFields(item);
            const actor =
              item.proposerName ||
              (item.visibility === "OWNER" ? tc("你") : tc("提交老師"));
            const event = `${actor}${tc("提交了")}${tc(catalogRequestKindLabel(item.kind))}`;
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-[var(--border)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">
                      {tc(event)}
                    </h3>
                    <time
                      dateTime={item.createdAt}
                      className="mt-1 block text-xs text-[var(--muted)]"
                    >
                      {catalogHistoryDate(item.createdAt)}
                    </time>
                  </div>
                  <span className="rounded-full bg-[var(--border-soft)] px-2 py-1 text-xs text-[var(--text)]">
                    {tc(catalogRequestStatusLabel(item.status))}
                  </span>
                </div>
                {changes.length ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[var(--primary)]">
                      {tc("查看內容差異")} ({changes.length})
                    </summary>
                    <dl className="mt-3 space-y-2">
                      {changes.map((change) => {
                        const arraySummary = catalogHistoryArrayChangeText(
                          change.before,
                          change.after,
                          tc,
                        );
                        return (
                          <div
                            key={change.field}
                            className="rounded-xl bg-[var(--border-soft)] p-3 text-xs"
                          >
                            <dt className="font-semibold text-[var(--text)]">
                              {tc(catalogFieldLabel(change.field))}
                            </dt>
                            {arraySummary ? (
                              <dd className="mt-2 text-[var(--text)]">
                                {arraySummary}
                              </dd>
                            ) : (
                              <dd className="mt-2 grid gap-2 sm:grid-cols-2">
                                <span>
                                  <b>{tc("修改前")}：</b>
                                  {change.field === "category"
                                    ? tc(
                                        catalogCategoryLabel(
                                          String(change.before ?? ""),
                                        ),
                                      )
                                    : tc(catalogHistoryValueText(change.before))}
                                </span>
                                <span>
                                  <b>{tc("修改後")}：</b>
                                  {change.field === "category"
                                    ? tc(
                                        catalogCategoryLabel(
                                          String(change.after ?? ""),
                                        ),
                                      )
                                    : tc(catalogHistoryValueText(change.after))}
                                </span>
                              </dd>
                            )}
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                ) : (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {tc("這項記錄只改變詞義狀態，沒有內容欄位差異。")}
                  </p>
                )}
                {item.reviewedAt ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    {item.status === "APPROVED"
                      ? tc("審核老師已批准")
                      : item.status === "REJECTED"
                        ? tc("審核老師已拒絕")
                        : tc("審核完成")}{" "}
                    · {catalogHistoryDate(item.reviewedAt)} ·{" "}
                    {item.reviewerName || tc("審核老師")}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-[var(--warning)]">
                    {tc("等待審核")}
                  </p>
                )}
                {item.reason || item.reviewNote ? (
                  <dl className="mt-3 space-y-1 text-xs text-[var(--muted)]">
                    {item.reason ? (
                      <div>
                        <dt className="inline font-semibold">
                          {tc("提交理由")}：
                        </dt>
                        <dd className="inline">{item.reason}</dd>
                      </div>
                    ) : null}
                    {item.reviewNote ? (
                      <div>
                        <dt className="inline font-semibold">
                          {tc("審核備註")}：
                        </dt>
                        <dd className="inline">{item.reviewNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {canReview && item.visibility === "REVIEWER" ? (
                  <details className="mt-3 text-xs text-[var(--muted)]">
                    <summary className="cursor-pointer">
                      {tc("進階資料")}
                    </summary>
                    <dl className="mt-2 break-all font-mono">
                      <div>
                        <dt className="inline">request：</dt>
                        <dd className="inline">{item.id}</dd>
                      </div>
                      <div>
                        <dt className="inline">sense：</dt>
                        <dd className="inline">{item.senseKey ?? "—"}</dd>
                      </div>
                    </dl>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
        {!items.length && !loading ? (
          <p className="mt-4 rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
            {tc("這個詞義未有可見的修改歷史。")}
          </p>
        ) : null}
        {loading ? (
          <p
            role="status"
            className="mt-4 text-center text-sm text-[var(--muted)]"
          >
            {tc("載入中…")}
          </p>
        ) : null}
        {nextCursor ? (
          <button
            type="button"
            className="ui-button ui-button-secondary mt-4 w-full"
            disabled={loading}
            onClick={() => void load(nextCursor)}
          >
            {tc("載入更多歷史")}
          </button>
        ) : null}
        <button
          type="button"
          className="ui-button ui-button-quiet mt-3 w-full"
          onClick={onOpenFullHistory}
        >
          {tc("在完整歷史中查看")}
        </button>
      </section>
    </div>
  );
}
