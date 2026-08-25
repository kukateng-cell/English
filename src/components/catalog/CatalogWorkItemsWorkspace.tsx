"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";

type WorkItem = {
  type: "REQUEST" | "BATCH" | "FEEDBACK";
  id: string;
  kind?: string;
  status?: string;
  senseKey?: string | null;
  afterTermSnapshot?: string | null;
  termSnapshot?: string | null;
  fileName?: string;
  rowCount?: number;
  revision?: number;
  message?: string;
  suggestedValue?: string | null;
  reviewNote?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type WorkPayload = {
  counts: {
    requestsToRevise: number;
    batchesToRevise: number;
    requestsToReview: number;
    batchesToReview: number;
    feedbackToReview: number;
    totalActionable: number;
  };
  canReview: boolean;
  bulkEnabled: boolean;
  itemLimit: number;
  sectionTotals: { needsRevision: number; toReview: number; waiting: number; recent: number };
  needsRevision: WorkItem[];
  toReview: WorkItem[];
  waiting: WorkItem[];
  recent: WorkItem[];
};

type RetryBlockedRow = {
  rowNumber: number;
  senseKey: string | null;
  term: string;
  errors: string[];
};

function parseRetryBlockedRows(value: unknown): RetryBlockedRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (!Number.isInteger(row.rowNumber) || (row.rowNumber as number) < 1 || !Array.isArray(row.errors)) return [];
    const errors = row.errors.filter((error): error is string => typeof error === "string" && error.trim().length > 0);
    if (!errors.length) return [];
    return [{
      rowNumber: row.rowNumber as number,
      senseKey: typeof row.senseKey === "string" && row.senseKey.trim() ? row.senseKey : null,
      term: typeof row.term === "string" ? row.term.trim() : "",
      errors,
    }];
  }).slice(0, 200);
}

function itemTitle(item: WorkItem, tc: (value: string) => string): string {
  if (item.type === "BATCH") return item.fileName || tc("CSV 批次");
  return item.afterTermSnapshot || item.termSnapshot || item.senseKey || (item.type === "FEEDBACK" ? tc("一般詞庫意見") : tc("新詞義"));
}

function itemMeta(item: WorkItem, tc: (value: string) => string): string {
  if (item.type === "BATCH") return `${tc("CSV 批次")} · ${item.rowCount ?? 0} ${tc("行")} · ${item.status ?? ""}`;
  if (item.type === "FEEDBACK") return `${tc("詞庫意見")} · ${item.kind ?? "OTHER"}`;
  return `${tc("單筆申請")} · ${item.kind ?? "UPDATE"}${item.status ? ` · ${item.status}` : ""}`;
}

export default function CatalogWorkItemsWorkspace({ bulkEnabled, onOpenCatalog, onOpenBatch, onRetryRequest }: {
  bulkEnabled: boolean;
  onOpenCatalog: (senseKey?: string | null) => void;
  onOpenBatch: (batchId: string) => void;
  onRetryRequest: (requestId: string) => void;
}) {
  const { tc } = useLocale();
  const [data, setData] = useState<WorkPayload | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryBlockedRows, setRetryBlockedRows] = useState<Record<string, RetryBlockedRow[]>>({});
  const [requestedLimit, setRequestedLimit] = useState(12);
  const retryOperationIdsRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/catalog/work-items?limit=${requestedLimit}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      setData(await response.json() as WorkPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally {
      setLoading(false);
    }
  }, [requestedLimit, tc]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function resolveFeedback(item: WorkItem, status: "RESOLVED" | "DISMISSED") {
    const resolutionNote = (notes[item.id] ?? "").trim();
    if (resolutionNote.length < 3) {
      setError(tc("處理意見前，請填寫至少三個字的回覆。"));
      return;
    }
    setBusyId(item.id); setError(null); setMessage(null);
    try {
      const response = await rosterFetch(`/api/catalog/feedback/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNote, expectedRevision: item.revision }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      setMessage(status === "RESOLVED" ? tc("意見已標記為已跟進；正式內容修改仍須另行提交審核。") : tc("意見已駁回並保留處理紀錄。"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally { setBusyId(null); }
  }

  async function retryBatch(item: WorkItem) {
    setBusyId(item.id); setError(null); setMessage(null);
    setRetryBlockedRows((current) => {
      if (!(item.id in current)) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      const operationId = retryOperationIdsRef.current[item.id] ?? window.crypto.randomUUID();
      retryOperationIdsRef.current[item.id] = operationId;
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(item.id)}/retry-preview`, {
        method: "POST",
        headers: { "Idempotency-Key": operationId },
      });
      if (!response.ok) {
        const failure = await response.clone().json().catch(() => null) as { code?: unknown; rows?: unknown } | null;
        const blockedRows = failure?.code === "CATALOG_BATCH_RETRY_BLOCKED"
          ? parseRetryBlockedRows(failure.rows)
          : [];
        if (blockedRows.length) {
          setRetryBlockedRows((current) => ({ ...current, [item.id]: blockedRows }));
          setError(tc("批次目前有阻擋問題，請查看下面的行號及錯誤。"));
          return;
        }
        throw new Error(await responseErrorMessage(response, tc));
      }
      const body = await response.json() as {
        batch?: { id: string };
        closed?: boolean;
        code?: string;
      };
      delete retryOperationIdsRef.current[item.id];
      if (body.closed && body.code === "CATALOG_BATCH_RETRY_NO_LONGER_APPLICABLE") {
        setMessage(tc("重新比對後已沒有實際修改，項目已由待辦移除。"));
        await load();
        return;
      }
      if (!body.batch?.id) throw new Error(tc("建立修正版失敗"));
      onOpenBatch(body.batch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally { setBusyId(null); }
  }

  if (loading && !data) return <div role="status" className="py-16 text-center text-sm text-[var(--muted)]">{tc("正在整理你的詞庫待辦…")}</div>;
  if (!data && error) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const renderItems = (rawItems: WorkItem[], mode: "revision" | "review" | "waiting" | "recent", total: number) => {
    const items = bulkEnabled && data.bulkEnabled ? rawItems : rawItems.filter((item) => item.type !== "BATCH");
    return items.length
    ? <><div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]"><span>{tc("顯示")} {items.length} / {total}</span>{items.length < total ? <button type="button" className="ui-button ui-button-quiet ui-button-small" disabled={loading || requestedLimit >= 500} onClick={() => setRequestedLimit((current) => Math.min(500, current + 24))}>{requestedLimit >= 500 ? tc("已達顯示上限") : tc("顯示更多")}</button> : null}</div><div className="mt-3 grid gap-3 lg:grid-cols-2">{items.map((item) => <article key={`${item.type}-${item.id}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-bold text-[var(--text)]">{itemTitle(item, tc)}</h3><p className="mt-1 text-xs text-[var(--muted)]">{itemMeta(item, tc)}</p></div>{mode === "revision" || mode === "review" ? <span className="rounded-full bg-[var(--warning-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--warning)]">{tc("需要行動")}</span> : null}</div>
        {item.message ? <p className="mt-3 line-clamp-3 text-sm text-[var(--text)]">{item.message}</p> : null}
        {item.suggestedValue ? <p className="mt-3 rounded-xl bg-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text)]"><strong>{tc("建議修改")}：</strong>{item.suggestedValue}</p> : null}
        {item.reviewNote ? <p className="mt-3 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]"><strong>{tc("審核意見")}：</strong>{item.reviewNote}</p> : null}
        {item.resolutionNote ? <p className="mt-3 rounded-xl bg-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text)]"><strong>{tc("處理回覆")}：</strong>{item.resolutionNote}</p> : null}
        {retryBlockedRows[item.id]?.length ? <div className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-3 text-sm text-[var(--danger)]"><p className="font-semibold">{tc("修正版預覽暫時無法建立")}</p><div className="mt-2 space-y-2">{retryBlockedRows[item.id]!.map((row) => <div key={row.rowNumber} data-testid={`catalog-retry-blocked-row-${row.rowNumber}`}><strong>{tc("CSV 第")} {row.rowNumber} {tc("行")}{row.term ? ` · ${row.term}` : ""}</strong>{row.senseKey ? <span className="ml-2 break-all text-xs opacity-80">{row.senseKey}</span> : null}<ul className="mt-1 list-disc space-y-1 pl-5">{row.errors.map((rowError, index) => <li key={`${index}-${rowError}`}>{tc(rowError)}</li>)}</ul></div>)}</div></div> : null}
        {mode === "revision" ? <div className="mt-3 flex flex-wrap gap-2">{item.type === "REQUEST" ? <button type="button" className="ui-button ui-button-primary ui-button-small" onClick={() => onRetryRequest(item.id)}>{tc("修改後重新提交")}</button> : item.type === "BATCH" ? ["STALE", "REJECTED", "CANCELLED", "EXPIRED"].includes(item.status ?? "") ? <button type="button" className="ui-button ui-button-primary ui-button-small" disabled={busyId === item.id} onClick={() => void retryBatch(item)}>{busyId === item.id ? tc("建立中…") : tc("一鍵建立修正版預覽")}</button> : <button type="button" className="ui-button ui-button-primary ui-button-small" onClick={() => onOpenBatch(item.id)}>{item.status === "PREVIEW" ? tc("繼續處理預覽") : tc("解決批次問題")}</button> : null}</div> : null}
        {mode === "review" ? <div className="mt-3">{item.type === "BATCH" ? <button type="button" className="ui-button ui-button-primary ui-button-small" onClick={() => onOpenBatch(item.id)}>{tc("打開批次審核")}</button> : item.type === "REQUEST" ? <button type="button" className="ui-button ui-button-primary ui-button-small" onClick={() => onOpenCatalog(item.senseKey)}>{tc("打開單筆審核")}</button> : <><textarea className="min-h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--text)]" value={notes[item.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={tc("簡短回覆回報人（必填）") as string} /> <div className="mt-2 flex flex-wrap gap-2">{item.senseKey ? <button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => onOpenCatalog(item.senseKey)}>{tc("打開詞條修改")}</button> : null}<button type="button" className="ui-button ui-button-primary ui-button-small" disabled={busyId === item.id} onClick={() => void resolveFeedback(item, "RESOLVED")}>{tc("標記已跟進")}</button><button type="button" className="ui-button ui-button-quiet ui-button-small" disabled={busyId === item.id} onClick={() => void resolveFeedback(item, "DISMISSED")}>{tc("駁回意見")}</button></div></>}</div> : null}
      </article>)}</div></>
    : <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">{tc("目前沒有項目。")}</p>;
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)]">{tc("我的詞庫待辦")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("集中查看要修正、要審核、等待處理及最近結果；紅色數字只計真正需要你行動的項目。")}</p></div><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={loading} onClick={() => void load()}>{tc("重新整理")}</button></div>
    {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
    {message ? <p role="status" className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">{message}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{tc("需要你行動")}</p><p className="mt-1 text-2xl font-bold text-[var(--danger)]">{data.counts.totalActionable}</p></div><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{tc("要修改再交")}</p><p className="mt-1 text-2xl font-bold text-[var(--text)]">{data.counts.requestsToRevise + data.counts.batchesToRevise}</p></div><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{tc("要審核")}</p><p className="mt-1 text-2xl font-bold text-[var(--text)]">{data.counts.requestsToReview + data.counts.batchesToReview + data.counts.feedbackToReview}</p></div><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{tc("等待別人處理")}</p><p className="mt-1 text-2xl font-bold text-[var(--text)]">{data.sectionTotals.waiting}</p></div></div>
    <section><h2 className="text-lg font-bold text-[var(--text)]">{tc("要修改後重新提交")}</h2>{renderItems(data.needsRevision, "revision", data.sectionTotals.needsRevision)}</section>
    {data.canReview ? <section><h2 className="text-lg font-bold text-[var(--text)]">{tc("等你審核或跟進")}</h2>{renderItems(data.toReview, "review", data.sectionTotals.toReview)}</section> : null}
    <section><h2 className="text-lg font-bold text-[var(--text)]">{tc("等待處理")}</h2>{renderItems(data.waiting, "waiting", data.sectionTotals.waiting)}</section>
    <section><h2 className="text-lg font-bold text-[var(--text)]">{tc("最近 14 日結果")}</h2>{renderItems(data.recent, "recent", data.sectionTotals.recent)}</section>
  </div>;
}
