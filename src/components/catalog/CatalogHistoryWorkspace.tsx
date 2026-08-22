"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { responseErrorMessage } from "@/lib/api-error";
import { rosterFetch } from "@/lib/roster-client";
import { CATALOG_CATEGORIES } from "@/lib/catalog/taxonomy";

type Change = {
  id: string;
  kind: string;
  status: string;
  senseKey: string | null;
  before: { term: string | null; definitionZh: string | null; level: string | null; category: string | null; status: string | null; payload: Record<string, unknown> | null };
  after: { term: string | null; definitionZh: string | null; level: string | null; category: string | null; status: string | null; payload: Record<string, unknown> | null };
  createdAt: string;
  reviewedAt: string | null;
  visibility: string;
  proposerName?: string | null;
  reviewerName?: string | null;
  reason?: string | null;
  reviewNote?: string | null;
};

type HistoryEntry = {
  feedEntryId: string;
  sourceKind: "STANDALONE_REQUEST" | "BATCH" | "INITIAL_BASELINE";
  occurredAt: string;
  request?: Change;
  batch?: { id: string; fileName?: string; status: string; rowCount: number; groupCount: number; visibility: string };
  baseline?: { id: string; report: unknown; createdAt: string };
};

function tone(status: string) {
  if (status === "APPROVED" || status === "COMMITTED") return "bg-[var(--success-bg)] text-[var(--success)]";
  if (status === "PENDING" || status === "REVIEWING" || status === "REVIEWED") return "bg-[var(--warning-bg)] text-[var(--warning)]";
  return "bg-[var(--border-soft)] text-[var(--muted)]";
}

export default function CatalogHistoryWorkspace({ canReview, onOpenCorrectiveBatch, initialSenseKey }: { canReview: boolean; onOpenCorrectiveBatch: (batchId: string) => void; initialSenseKey?: string | null }) {
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
  const [batchChildren, setBatchChildren] = useState<Record<string, Array<{ groupNumber: number; decision: string; reviewRisk: string; request: Change }>>>({});
  const [batchChildCursor, setBatchChildCursor] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  async function createCorrectivePreview(batchId: string) {
    setCorrecting(batchId); setError(null);
    try {
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(batchId)}/corrective-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { batch: { id: string } };
      onOpenCorrectiveBatch(payload.batch.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("建立修正批次失敗")); }
    finally { setCorrecting(null); }
  }

  const load = useCallback(async (append = false, cursor?: string | null) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (status) params.set("status", status);
      if (kind) params.set("kind", kind);
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (sourceKind) params.set("sourceKind", sourceKind);
      if (cursor) params.set("cursor", cursor);
      const privateFilters = { search: search.trim(), catalogKey: catalogKey.trim(), senseKey: senseKey.trim(), batchId: batchId.trim(), actor: actor.trim(), dateFrom: dateFrom ? `${dateFrom}T00:00:00.000+08:00` : undefined, dateTo: dateTo ? `${dateTo}T23:59:59.999+08:00` : undefined };
      const usePrivateSearch = Object.values(privateFilters).some(Boolean);
      const response = usePrivateSearch
        ? await rosterFetch("/api/catalog/history/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 20, cursor: cursor ?? null, filters: { ...privateFilters, status, kind, level, category, sourceKind } }),
            signal: controller.signal,
          })
        : await fetch(`/api/catalog/history?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { items: HistoryEntry[]; nextCursor: string | null };
      setItems((current) => append ? [...current, ...payload.items] : payload.items);
      setNextCursor(payload.nextCursor);
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : tc("讀取修改歷史失敗")); }
    finally { if (activeRequest.current === controller) setLoading(false); }
  }, [actor, batchId, catalogKey, category, dateFrom, dateTo, kind, level, search, senseKey, sourceKind, status, tc]);

  async function loadBatchChildren(id: string, append = false) {
    const cursor = append ? batchChildCursor[id] : null;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/catalog/history/batches/${encodeURIComponent(id)}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { items: Array<{ groupNumber: number; decision: string; reviewRisk: string; request: Change }>; nextCursor: string | null };
      setBatchChildren((current) => ({ ...current, [id]: append ? [...(current[id] ?? []), ...payload.items] : payload.items }));
      setBatchChildCursor((current) => ({ ...current, [id]: payload.nextCursor }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取批次修改失敗")); }
    finally { setLoading(false); }
  }

  function toggleEntry(entry: HistoryEntry) {
    const opening = expanded !== entry.feedEntryId;
    setExpanded(opening ? entry.feedEntryId : null);
    if (opening && entry.batch && !batchChildren[entry.batch.id]) void loadBatchChildren(entry.batch.id);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <div className="space-y-4">
    <div><h1 className="text-xl font-bold text-[var(--text)]">{tc("詞條修改歷史")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("按不可變時間線查看逐條申請、CSV 批次及最初詞庫基線；批次子項只在批次內展開。")}</p></div>
    <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("搜尋修改前後詞語或釋義")}<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <Filter label={tc("狀態") as string} value={status} onChange={setStatus} options={["PENDING", "APPROVED", "REJECTED", "CANCELLED"]} all={tc("全部狀態") as string} />
      <Filter label={tc("類型") as string} value={kind} onChange={setKind} options={["CREATE", "UPDATE", "RETIRE", "REACTIVATE"]} all={tc("全部類型") as string} />
      <Filter label={tc("程度") as string} value={level} onChange={setLevel} options={["A1", "A2", "B1", "B2"]} all={tc("全部程度") as string} />
      <Filter label={tc("分類") as string} value={category} onChange={setCategory} options={[...CATALOG_CATEGORIES]} all={tc("全部分類") as string} />
      <Filter label={tc("來源") as string} value={sourceKind} onChange={setSourceKind} options={["STANDALONE_REQUEST", "BATCH", "INITIAL_BASELINE"]} all={tc("全部來源") as string} />
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">Catalog key<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={catalogKey} onChange={(event) => setCatalogKey(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">Sense key<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={senseKey} onChange={(event) => setSenseKey(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">Batch ID<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={batchId} onChange={(event) => setBatchId(event.target.value)} /></label>
      {canReview ? <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("提交者／審核者")}<input className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={actor} onChange={(event) => setActor(event.target.value)} /></label> : null}
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("由日期")}<input type="date" className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("至日期")}<input type="date" className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
    </div>
    {error ? <p role="alert" className="rounded-xl bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">{error}</p> : null}
    <div className="space-y-3" aria-live="polite">{items.map((entry) => {
      const changes = entry.request ? [entry.request] : entry.batch ? (batchChildren[entry.batch.id] ?? []).map((group) => group.request) : [];
      const title = entry.sourceKind === "INITIAL_BASELINE" ? tc("最初正式詞庫基線") : entry.sourceKind === "BATCH" ? entry.batch?.fileName ?? tc("CSV 批次") : changes[0]?.after.term ?? changes[0]?.before.term ?? tc("詞條修改");
      const currentStatus = entry.batch?.status ?? entry.request?.status ?? "BASELINE";
      return <article key={entry.feedEntryId} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <button type="button" className="flex w-full flex-wrap items-start justify-between gap-3 text-left" aria-expanded={expanded === entry.feedEntryId} onClick={() => toggleEntry(entry)}><span className="min-w-0"><strong className="block break-words text-[var(--text)]">{title}</strong><small className="mt-1 block text-[var(--muted)]">{entry.sourceKind} · {new Date(entry.occurredAt).toLocaleString("zh-HK", { timeZone: "Asia/Shanghai" })} {entry.batch ? `· ${entry.batch.rowCount} ${tc("行")} · ${entry.batch.groupCount} ${tc("項提案")}` : ""}</small></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tone(currentStatus)}`}>{currentStatus}</span></button>
        {expanded === entry.feedEntryId ? <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">{entry.baseline ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--border-soft)] p-3 text-xs text-[var(--text)]">{JSON.stringify(entry.baseline.report, null, 2)}</pre> : changes.map((change) => <ChangeDiff key={change.id} change={change} tc={tc} />)}{entry.batch && batchChildCursor[entry.batch.id] ? <button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={loading} onClick={() => void loadBatchChildren(entry.batch!.id, true)}>{tc("載入更多批次子項")}</button> : null}{canReview && entry.batch?.status === "COMMITTED" ? <button type="button" className="ui-button ui-button-secondary" disabled={correcting === entry.batch.id} onClick={() => void createCorrectivePreview(entry.batch!.id)}>{correcting === entry.batch.id ? tc("建立中…") : tc("建立反向修正預覽")}</button> : null}</div> : null}
      </article>;
    })}</div>
    {!items.length && !loading ? <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">{tc("未有符合條件的修改歷史。")}</p> : null}
    {loading ? <p role="status" className="text-center text-sm text-[var(--muted)]">{tc("載入中…")}</p> : null}
    {nextCursor ? <button type="button" className="ui-button ui-button-secondary mx-auto block" disabled={loading} onClick={() => void load(true, nextCursor)}>{tc("載入更多")}</button> : null}
  </div>;
}

function Filter({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: string[]; all: string }) {
  return <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{label}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{all}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function ChangeDiff({ change, tc }: { change: Change; tc: (value: string) => string }) {
  return <section className="rounded-xl border border-[var(--border)] p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[var(--text)]">{change.kind}</strong><span className={`rounded-full px-2 py-1 text-[10px] ${tone(change.status)}`}>{change.status}</span><span className="break-all text-xs text-[var(--muted)]">{change.senseKey}</span></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Snapshot title={tc("修改前")} value={change.before} /><Snapshot title={tc("修改後")} value={change.after} /></div><PayloadDiff before={change.before.payload} after={change.after.payload} tc={tc} />{change.reason || change.reviewNote || change.proposerName ? <dl className="mt-3 grid gap-1 text-xs text-[var(--muted)]">{change.proposerName ? <div><dt className="inline font-semibold">{tc("提交者")}：</dt><dd className="inline">{change.proposerName}</dd></div> : null}{change.reviewerName ? <div><dt className="inline font-semibold">{tc("審核者")}：</dt><dd className="inline">{change.reviewerName}</dd></div> : null}{change.reason ? <div><dt className="inline font-semibold">{tc("理由")}：</dt><dd className="inline">{change.reason}</dd></div> : null}{change.reviewNote ? <div><dt className="inline font-semibold">{tc("審核備註")}：</dt><dd className="inline">{change.reviewNote}</dd></div> : null}</dl> : null}</section>;
}

function Snapshot({ title, value }: { title: string; value: Change["before"] }) {
  return <div className="rounded-xl bg-[var(--border-soft)] p-3"><h4 className="text-xs font-bold text-[var(--muted)]">{title}</h4><p className="mt-2 font-semibold text-[var(--text)]">{value.term || "—"}</p><p className="mt-1 text-sm text-[var(--text)]">{value.definitionZh || "—"}</p><p className="mt-2 text-xs text-[var(--muted)]">{value.level || "—"} · {value.category || "—"} · {value.status || "—"}</p></div>;
}

function comparable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort((a, b) => a.localeCompare(b, "en")));
  return JSON.stringify(value ?? null);
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join(" ｜ ") : "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function PayloadDiff({ before, after, tc }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null; tc: (value: string) => string }) {
  const hidden = new Set(["term", "definitionZh", "level", "category"]);
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((field) => !hidden.has(field) && comparable(before?.[field]) !== comparable(after?.[field]));
  if (!fields.length) return null;
  return <details className="mt-3 rounded-xl border border-[var(--border)] p-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--text)]">{tc("其他欄位差異")} ({fields.length})</summary><div className="mt-3 space-y-2">{fields.map((field) => <div key={field} className="grid gap-2 rounded-lg bg-[var(--border-soft)] p-2 text-xs md:grid-cols-[150px_1fr_1fr]"><strong className="break-all text-[var(--muted)]">{field}</strong><span className="break-words text-[var(--text)]"><span className="font-semibold">{tc("修改前")}：</span>{displayValue(before?.[field])}</span><span className="break-words text-[var(--text)]"><span className="font-semibold">{tc("修改後")}：</span>{displayValue(after?.[field])}</span></div>)}</div></details>;
}
