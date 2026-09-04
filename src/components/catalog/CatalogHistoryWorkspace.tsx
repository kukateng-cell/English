"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CATALOG_CATEGORIES } from "@/lib/catalog/taxonomy";
import {
  catalogBatchStatusLabel,
  catalogCategoryLabel,
  catalogFieldLabel,
  catalogHistorySourceLabel,
  catalogLifecycleLabel,
  catalogRequestKindLabel,
  catalogRequestStatusLabel,
} from "@/lib/catalog/teacher-presentation";
import {
  catalogHistoryArrayChangeText,
  catalogHistoryComparable,
  catalogHistoryDate,
  catalogHistoryValueText,
} from "@/components/catalog/catalogHistoryPresentation";

type Change = {
  id: string;
  kind: string;
  status: string;
  senseKey: string | null;
  before: {
    term: string | null;
    definitionZh: string | null;
    level: string | null;
    category: string | null;
    status: string | null;
    payload: Record<string, unknown> | null;
  };
  after: {
    term: string | null;
    definitionZh: string | null;
    level: string | null;
    category: string | null;
    status: string | null;
    payload: Record<string, unknown> | null;
  };
  createdAt: string;
  reviewedAt: string | null;
  visibility: string;
  proposerName?: string | null;
  reviewerName?: string | null;
  reason?: string | null;
  reviewNote?: string | null;
  retryOfRequestId?: string | null;
  successorRequestId?: string | null;
};

type HistoryEntry = {
  feedEntryId: string;
  sourceKind: "STANDALONE_REQUEST" | "BATCH" | "INITIAL_BASELINE";
  occurredAt: string;
  request?: Change;
  batch?: {
    id: string;
    fileName?: string;
    status: string;
    rowCount: number;
    groupCount: number;
    visibility: string;
    createdAt: string;
    submittedAt: string | null;
    reviewedAt: string | null;
    committedAt: string | null;
    proposerName?: string | null;
    reviewerName?: string | null;
    finalizerName?: string | null;
    correctiveOfBatchId?: string | null;
    retryOfBatchId?: string | null;
  };
  baseline?: { id: string; report: unknown; createdAt: string };
};

function tone(status: string) {
  if (status === "APPROVED" || status === "COMMITTED")
    return "bg-[var(--success-bg)] text-[var(--success)]";
  if (status === "PENDING" || status === "REVIEWING" || status === "REVIEWED")
    return "bg-[var(--warning-bg)] text-[var(--warning)]";
  return "bg-[var(--border-soft)] text-[var(--muted)]";
}

export default function CatalogHistoryWorkspace({
  canReview,
  bulkEnabled,
  onOpenCorrectiveBatch,
  onBackToCatalog,
  initialSenseKey,
}: {
  canReview: boolean;
  bulkEnabled: boolean;
  onOpenCorrectiveBatch: (batchId: string) => void;
  onBackToCatalog: () => void;
  initialSenseKey?: string | null;
}) {
  const { tc } = useLocale();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [catalogKey, setCatalogKey] = useState("");
  const [senseKey, setSenseKey] = useState(initialSenseKey ?? "");
  const [batchId, setBatchId] = useState("");
  const [actor, setActor] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [batchChildren, setBatchChildren] = useState<
    Record<
      string,
      Array<{
        groupNumber: number;
        decision: string;
        reviewRisk: string;
        request: Change;
      }>
    >
  >({});
  const [batchChildCursor, setBatchChildCursor] = useState<
    Record<string, string | null>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  async function createCorrectivePreview(batchId: string) {
    setCorrecting(batchId);
    setError(null);
    try {
      const response = await rosterFetch(
        `/api/catalog/submissions/${encodeURIComponent(batchId)}/corrective-preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: "{}",
        },
      );
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, tc));
      const payload = (await response.json()) as { batch: { id: string } };
      onOpenCorrectiveBatch(payload.batch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("建立修正批次失敗"));
    } finally {
      setCorrecting(null);
    }
  }

  const load = useCallback(
    async (append = false, cursor?: string | null) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (status) params.set("status", status);
        if (kind) params.set("kind", kind);
        if (level) params.set("level", level);
        if (category) params.set("category", category);
        if (sourceKind) params.set("sourceKind", sourceKind);
        if (cursor) params.set("cursor", cursor);
        const privateFilters = {
          search: search.trim(),
          catalogKey: catalogKey.trim(),
          senseKey: senseKey.trim(),
          batchId: batchId.trim(),
          actor: actor.trim(),
          dateFrom: dateFrom ? `${dateFrom}T00:00:00.000+08:00` : undefined,
          dateTo: dateTo ? `${dateTo}T23:59:59.999+08:00` : undefined,
        };
        const usePrivateSearch = Object.values(privateFilters).some(Boolean);
        const response = usePrivateSearch
          ? await rosterFetch("/api/catalog/history/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                limit: 20,
                cursor: cursor ?? null,
                filters: {
                  ...privateFilters,
                  status,
                  kind,
                  level,
                  category,
                  sourceKind,
                },
              }),
              signal: controller.signal,
            })
          : await fetch(`/api/catalog/history?${params}`, {
              cache: "no-store",
              signal: controller.signal,
            });
        if (!response.ok)
          throw new Error(await responseErrorMessage(response, tc));
        const payload = (await response.json()) as {
          items: HistoryEntry[];
          nextCursor: string | null;
        };
        setItems((current) =>
          append ? [...current, ...payload.items] : payload.items,
        );
        setNextCursor(payload.nextCursor);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error ? cause.message : tc("讀取修改歷史失敗"),
          );
      } finally {
        if (activeRequest.current === controller) setLoading(false);
      }
    },
    [
      actor,
      batchId,
      catalogKey,
      category,
      dateFrom,
      dateTo,
      kind,
      level,
      search,
      senseKey,
      sourceKind,
      status,
      tc,
    ],
  );

  async function loadBatchChildren(id: string, append = false) {
    const cursor = append ? batchChildCursor[id] : null;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/catalog/history/batches/${encodeURIComponent(id)}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, tc));
      const payload = (await response.json()) as {
        items: Array<{
          groupNumber: number;
          decision: string;
          reviewRisk: string;
          request: Change;
        }>;
        nextCursor: string | null;
      };
      setBatchChildren((current) => ({
        ...current,
        [id]: append
          ? [...(current[id] ?? []), ...payload.items]
          : payload.items,
      }));
      setBatchChildCursor((current) => ({
        ...current,
        [id]: payload.nextCursor,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("讀取批次修改失敗"));
    } finally {
      setLoading(false);
    }
  }

  function toggleEntry(entry: HistoryEntry) {
    const opening = expanded !== entry.feedEntryId;
    setExpanded(opening ? entry.feedEntryId : null);
    if (opening && entry.batch && !batchChildren[entry.batch.id])
      void loadBatchChildren(entry.batch.id);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">
            {tc("詞條修改歷史")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {tc(
              "按不可變時間線查看逐條申請、批量提交及最初詞庫基線；批次子項只在批次內展開。",
            )}
          </p>
        </div>
        <button
          type="button"
          className="ui-button ui-button-secondary ui-button-small"
          onClick={onBackToCatalog}
        >
          {tc("返回完整詞庫")}
        </button>
      </div>
      {senseKey.trim() ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)] px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">
              {tc("正在查看所選詞義的完整修改流程")}
            </p>
            <p className="mt-1 text-sm font-bold text-[var(--text)]">
              {tc("已鎖定由完整詞庫開啟的詞義")}
            </p>
          </div>
          <button
            type="button"
            className="ui-button ui-button-quiet ui-button-small"
            onClick={() => setSenseKey("")}
          >
            {tc("查看全部歷史")}
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          {tc("搜尋修改前後詞語或釋義")}
          <input
            className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Filter
          label={tc("狀態") as string}
          value={status}
          onChange={setStatus}
          options={["PENDING", "APPROVED", "REJECTED", "CANCELLED"]}
          all={tc("全部狀態") as string}
          optionLabel={catalogRequestStatusLabel}
        />
        <Filter
          label={tc("類型") as string}
          value={kind}
          onChange={setKind}
          options={["CREATE", "UPDATE", "RETIRE", "REACTIVATE"]}
          all={tc("全部類型") as string}
          optionLabel={catalogRequestKindLabel}
        />
        <Filter
          label={tc("程度") as string}
          value={level}
          onChange={setLevel}
          options={["A1", "A2", "B1", "B2"]}
          all={tc("全部程度") as string}
        />
        <Filter
          label={tc("分類") as string}
          value={category}
          onChange={setCategory}
          options={[...CATALOG_CATEGORIES]}
          all={tc("全部分類") as string}
          optionLabel={catalogCategoryLabel}
        />
        <Filter
          label={tc("來源") as string}
          value={sourceKind}
          onChange={setSourceKind}
          options={["STANDALONE_REQUEST", "BATCH", "INITIAL_BASELINE"]}
          all={tc("全部來源") as string}
          optionLabel={catalogHistorySourceLabel}
        />
        {canReview ? (
          <details className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
              {tc("進階搜尋（系統識別碼）")}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
                Catalog key
                <input
                  className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  value={catalogKey}
                  onChange={(event) => setCatalogKey(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
                Sense key
                <input
                  className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  value={senseKey}
                  onChange={(event) => setSenseKey(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
                Batch ID
                <input
                  className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  value={batchId}
                  onChange={(event) => setBatchId(event.target.value)}
                />
              </label>
            </div>
          </details>
        ) : null}
        {canReview ? (
          <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
            {tc("提交者／審核者")}
            <input
              className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          {tc("由日期")}
          <input
            type="date"
            className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          {tc("至日期")}
          <input
            type="date"
            className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      <div className="space-y-3" aria-live="polite">
        {items.map((entry) => {
          const changes = entry.request
            ? [entry.request]
            : entry.batch
              ? (batchChildren[entry.batch.id] ?? []).map(
                  (group) => group.request,
                )
              : [];
          const title =
            entry.sourceKind === "INITIAL_BASELINE"
              ? tc("最初正式詞庫基線")
              : entry.sourceKind === "BATCH"
                ? (entry.batch?.fileName ?? tc("批量提交"))
                : (changes[0]?.after.term ??
                  changes[0]?.before.term ??
                  tc("詞條修改"));
          const currentStatus =
            entry.batch?.status ?? entry.request?.status ?? "BASELINE";
          const statusText = entry.batch
            ? catalogBatchStatusLabel(currentStatus)
            : entry.request
              ? catalogRequestStatusLabel(currentStatus)
              : tc("最初基線");
          return (
            <article
              key={entry.feedEntryId}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
                aria-expanded={expanded === entry.feedEntryId}
                onClick={() => toggleEntry(entry)}
              >
                <span className="min-w-0">
                  <strong className="block break-words text-[var(--text)]">
                    {title}
                  </strong>
                  <small className="mt-1 block text-[var(--muted)]">
                    {tc(catalogHistorySourceLabel(entry.sourceKind))} ·{" "}
                    {catalogHistoryDate(entry.occurredAt)}{" "}
                    {entry.batch
                      ? `· ${entry.batch.rowCount} ${tc("行")} · ${entry.batch.groupCount} ${tc("項提案")}`
                      : ""}
                  </small>
                </span>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone(currentStatus)}`}
                >
                  {tc(statusText)}
                </span>
              </button>
              {expanded === entry.feedEntryId ? (
                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  {entry.baseline ? (
                    <section className="rounded-xl bg-[var(--border-soft)] p-3">
                      <p className="text-sm text-[var(--text)]">
                        {tc("這項記錄儲存最初正式詞庫建立時的匯入摘要。")}
                      </p>
                      {canReview ? (
                        <details className="mt-3 text-xs text-[var(--muted)]">
                          <summary className="cursor-pointer">
                            {tc("進階資料")}
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--surface)] p-3 text-xs text-[var(--text)]">
                            {JSON.stringify(entry.baseline.report, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </section>
                  ) : (
                    <>
                      {entry.batch ? (
                        <BatchTimeline batch={entry.batch} tc={tc} />
                      ) : null}
                      {entry.batch?.retryOfBatchId ? (
                        <p className="rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]">
                          {tc(
                            "此批次是被拒絕／要求修正批次的修正版；原批次紀錄仍然保留。",
                          )}
                        </p>
                      ) : null}
                      {entry.batch?.correctiveOfBatchId ? (
                        <p className="rounded-xl bg-[var(--border-soft)] px-3 py-2 text-xs text-[var(--muted)]">
                          {tc("此批次是已套用批次的反向修正預覽。")}
                        </p>
                      ) : null}
                      {changes.map((change) => (
                        <ChangeDiff key={change.id} change={change} tc={tc} />
                      ))}
                    </>
                  )}
                  {entry.batch && batchChildCursor[entry.batch.id] ? (
                    <button
                      type="button"
                      className="ui-button ui-button-secondary ui-button-small"
                      disabled={loading}
                      onClick={() =>
                        void loadBatchChildren(entry.batch!.id, true)
                      }
                    >
                      {tc("載入更多批次子項")}
                    </button>
                  ) : null}
                  {canReview &&
                  bulkEnabled &&
                  entry.batch?.status === "COMMITTED" ? (
                    <button
                      type="button"
                      className="ui-button ui-button-secondary"
                      disabled={correcting === entry.batch.id}
                      onClick={() =>
                        void createCorrectivePreview(entry.batch!.id)
                      }
                    >
                      {correcting === entry.batch.id
                        ? tc("建立中…")
                        : tc("建立反向修正預覽")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {!items.length && !loading ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
          {tc("未有符合條件的修改歷史。")}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-center text-sm text-[var(--muted)]">
          {tc("載入中…")}
        </p>
      ) : null}
      {nextCursor ? (
        <button
          type="button"
          className="ui-button ui-button-secondary mx-auto block"
          disabled={loading}
          onClick={() => void load(true, nextCursor)}
        >
          {tc("載入更多")}
        </button>
      ) : null}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  all,
  optionLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  all: string;
  optionLabel?: (value: string) => string;
}) {
  const { tc } = useLocale();
  return (
    <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
      {label}
      <select
        className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {tc(optionLabel?.(option) ?? option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChangeDiff({
  change,
  tc,
}: {
  change: Change;
  tc: (value: string) => string;
}) {
  const proposer =
    change.proposerName ??
    (change.visibility === "OWNER" ? tc("你") : tc("提交老師"));
  const reviewer = change.reviewerName ?? tc("審核老師");
  const reviewAction =
    change.status === "APPROVED"
      ? tc("已批准")
      : change.status === "REJECTED"
        ? tc("已拒絕")
        : change.status === "CANCELLED"
          ? tc("已取消")
          : tc("待審核");
  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm text-[var(--text)]">
          {tc(catalogRequestKindLabel(change.kind))}
        </strong>
        <span
          className={`rounded-full px-2 py-1 text-[10px] ${tone(change.status)}`}
        >
          {tc(catalogRequestStatusLabel(change.status))}
        </span>
        {change.retryOfRequestId ? (
          <span className="rounded-full bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--warning)]">
            {tc("修正版")}
          </span>
        ) : null}
        {change.successorRequestId ? (
          <span className="rounded-full bg-[var(--border-soft)] px-2 py-1 text-[10px] text-[var(--muted)]">
            {tc("已有後續修正版")}
          </span>
        ) : null}
      </div>
      <div
        className="mt-3 grid gap-2 md:grid-cols-2"
        aria-label={tc("提交及審核時間線")}
      >
        <TimelineStep
          label={tc("已提交")}
          actor={proposer}
          occurredAt={change.createdAt}
        />
        <TimelineStep
          label={reviewAction}
          actor={change.reviewedAt ? reviewer : tc("尚未審核")}
          occurredAt={change.reviewedAt}
          pending={!change.reviewedAt}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Snapshot title={tc("修改前")} value={change.before} />
        <Snapshot title={tc("修改後")} value={change.after} />
      </div>
      <PayloadDiff
        before={change.before.payload}
        after={change.after.payload}
        tc={tc}
      />
      {change.reason || change.reviewNote ? (
        <dl className="mt-3 grid gap-1 text-xs text-[var(--muted)]">
          {change.reason ? (
            <div>
              <dt className="inline font-semibold">{tc("理由")}：</dt>
              <dd className="inline">{change.reason}</dd>
            </div>
          ) : null}
          {change.reviewNote ? (
            <div>
              <dt className="inline font-semibold">{tc("審核備註")}：</dt>
              <dd className="inline">{change.reviewNote}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {change.visibility === "REVIEWER" ? (
        <details className="mt-3 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">{tc("進階資料")}</summary>
          <p className="mt-2 break-all font-mono">
            sense: {change.senseKey ?? "—"} · request: {change.id}
          </p>
        </details>
      ) : null}
    </section>
  );
}

function TimelineStep({
  label,
  actor,
  occurredAt,
  pending = false,
}: {
  label: string;
  actor: string;
  occurredAt: string | null;
  pending?: boolean;
}) {
  return (
    <div
      className={`flex gap-3 rounded-xl border p-3 ${pending ? "border-dashed border-[var(--border)]" : "border-[var(--primary)]/25 bg-[var(--border-soft)]"}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${pending ? "bg-[var(--muted)]" : "bg-[var(--primary)]"}`}
      />
      <div className="min-w-0">
        <p className="text-xs font-bold text-[var(--text)]">{label}</p>
        <p className="mt-1 break-words text-xs text-[var(--muted)]">{actor}</p>
        <time
          className="mt-1 block text-xs tabular-nums text-[var(--muted)]"
          dateTime={occurredAt ?? undefined}
        >
          {catalogHistoryDate(occurredAt)}
        </time>
      </div>
    </div>
  );
}

function BatchTimeline({
  batch,
  tc,
}: {
  batch: NonNullable<HistoryEntry["batch"]>;
  tc: (value: string) => string;
}) {
  const owner =
    batch.proposerName ??
    (batch.visibility === "OWNER" ? tc("你") : tc("提交老師"));
  const reviewer = batch.reviewerName ?? tc("審核老師");
  const finalizer = batch.finalizerName ?? reviewer;
  return (
    <section className="rounded-xl bg-[var(--border-soft)] p-3">
      <h3 className="text-sm font-bold text-[var(--text)]">
        {tc("批次處理時間線")}
      </h3>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <TimelineStep
          label={tc("已提交批次")}
          actor={owner}
          occurredAt={batch.submittedAt ?? batch.createdAt}
        />
        <TimelineStep
          label={batch.reviewedAt ? tc("已完成審核") : tc("待審核")}
          actor={batch.reviewedAt ? reviewer : tc("尚未審核")}
          occurredAt={batch.reviewedAt}
          pending={!batch.reviewedAt}
        />
        <TimelineStep
          label={batch.committedAt ? tc("已正式套用") : tc("尚未套用")}
          actor={batch.committedAt ? finalizer : tc("—")}
          occurredAt={batch.committedAt}
          pending={!batch.committedAt}
        />
      </div>
    </section>
  );
}

function Snapshot({
  title,
  value,
}: {
  title: string;
  value: Change["before"];
}) {
  const { tc } = useLocale();
  const lifecycle =
    value.status === "ACTIVE" ||
    value.status === "DRAFT" ||
    value.status === "RETIRED"
      ? catalogLifecycleLabel(value.status)
      : "—";
  return (
    <div className="rounded-xl bg-[var(--border-soft)] p-3">
      <h4 className="text-xs font-bold text-[var(--muted)]">{title}</h4>
      <p className="mt-2 font-semibold text-[var(--text)]">
        {value.term || "—"}
      </p>
      <p className="mt-1 text-sm text-[var(--text)]">
        {value.definitionZh || "—"}
      </p>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {value.level || "—"} · {tc(catalogCategoryLabel(value.category))} ·{" "}
        {tc(lifecycle)}
      </p>
    </div>
  );
}

function PayloadDiff({
  before,
  after,
  tc,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  tc: (value: string) => string;
}) {
  const hidden = new Set(["term", "definitionZh", "level", "category"]);
  const fields = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ].filter(
    (field) =>
      !hidden.has(field) &&
      catalogHistoryComparable(before?.[field]) !==
      catalogHistoryComparable(after?.[field]),
  );
  if (!fields.length) return null;
  return (
    <details className="mt-3 rounded-xl border border-[var(--border)] p-3">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--text)]">
        {tc("其他欄位差異")} ({fields.length})
      </summary>
      <div className="mt-3 space-y-2">
        {fields.map((field) => {
          const arraySummary = catalogHistoryArrayChangeText(
            before?.[field],
            after?.[field],
            tc,
          );
          return (
            <div
              key={field}
              className="grid gap-2 rounded-lg bg-[var(--border-soft)] p-2 text-xs md:grid-cols-[150px_1fr_1fr]"
            >
              <strong className="break-all text-[var(--muted)]">
                {tc(catalogFieldLabel(field))}
              </strong>
              {arraySummary ? (
                <span className="break-words text-[var(--text)] md:col-span-2">
                  {arraySummary}
                </span>
              ) : (
                <>
                  <span className="break-words text-[var(--text)]">
                    <span className="font-semibold">{tc("修改前")}：</span>
                    {tc(catalogHistoryValueText(before?.[field]))}
                  </span>
                  <span className="break-words text-[var(--text)]">
                    <span className="font-semibold">{tc("修改後")}：</span>
                    {tc(catalogHistoryValueText(after?.[field]))}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
