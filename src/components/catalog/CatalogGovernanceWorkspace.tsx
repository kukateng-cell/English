"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { CATALOG_CATEGORIES } from "@/lib/catalog/taxonomy";

type CatalogStatus = "DRAFT" | "ACTIVE" | "RETIRED";
type FilterStatus = "ALL" | CatalogStatus | "BLOCKED" | "VALIDATION_FAILED" | "PENDING";
type CatalogPayload = {
  term: string;
  lemma: string;
  partOfSpeech: string;
  level: "A1" | "A2" | "B1" | "B2";
  category: string;
  definitionZh: string;
  acceptedAnswersZh: string[];
  phoneticIpa: string | null;
  exampleEn: string | null;
  exampleZh: string | null;
  acceptedFormsEn: string[];
  synonymsEn: string[];
  antonymsEn: string[];
  enableEnToZh: boolean;
  distractorZh: string[];
  enableZhToEn: boolean;
  distractorEn: string[];
  retirementReason: string | null;
};
type CatalogRow = {
  id: string;
  senseKey: string | null;
  catalogKey: string | null;
  sourceFile: string | null;
  sourceRow: number;
  term: string;
  lemma: string;
  definitionZh: string;
  partOfSpeech: string;
  level: string;
  category: string;
  phoneticIpa: string | null;
  enableEnToZh: boolean;
  enableZhToEn: boolean;
  status: CatalogStatus;
  revision: number | null;
  latestRevision: number | null;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  pendingRequest: { id: string; kind: string; status: string; proposerId: string; baseRevision: number | null; createdAt: string } | null;
  hasSense: boolean;
};
type Detail = {
  id: string | null;
  senseKey: string;
  catalogKey: string | null;
  sourceFile: string | null;
  sourceRow: number | null;
  status: CatalogStatus;
  revision: number | null;
  latestRevision: number | null;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  hasSense: boolean;
  issues: { errors?: string[]; warnings?: string[] } | null;
  payload: CatalogPayload | null;
  pendingRequest: { id: string; kind: string; status: string; revision: number; payload: CatalogPayload; reason: string | null; proposerId: string; createdAt: string } | null;
};
type PendingRequest = {
  id: string;
  kind: string;
  status: string;
  operationId: string;
  baseRevision: number | null;
  baseStatus: CatalogStatus | null;
  revision: number;
  payload: CatalogPayload;
  reason: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  proposerId: string;
  reviewerId: string | null;
  catalogKey: string | null;
  senseKey: string | null;
  sense: { senseKey: string; term: string; level: string; category: string } | null;
  sourceImportRow: { id: string; sourceFile: string; sourceRow: number; senseKey: string | null; catalogKey: string | null; primaryDisposition: string; eligibilityResult: string | null; issues: unknown } | null;
  proposer: { legalName: string; accountName: string };
};

const EMPTY_PAYLOAD: CatalogPayload = {
  term: "",
  lemma: "",
  partOfSpeech: "",
  level: "A1",
  category: "other",
  definitionZh: "",
  acceptedAnswersZh: [],
  phoneticIpa: null,
  exampleEn: null,
  exampleZh: null,
  acceptedFormsEn: [],
  synonymsEn: [],
  antonymsEn: [],
  enableEnToZh: true,
  distractorZh: [],
  enableZhToEn: true,
  distractorEn: [],
  retirementReason: null,
};

function parseList(value: string) {
  return value.split("|").map((item) => item.normalize("NFKC").trim()).filter(Boolean);
}

function listText(value: string[]) {
  return value.join(" | ");
}

function statusLabel(status: FilterStatus, tc: (value: string) => string) {
  const labels: Record<FilterStatus, string> = { ALL: "全部", DRAFT: "草稿", ACTIVE: "已啟用", RETIRED: "已停用", BLOCKED: "方向被阻擋", VALIDATION_FAILED: "驗證失敗", PENDING: "等待審核" };
  return tc(labels[status]);
}

function statusClass(status: CatalogStatus) {
  if (status === "ACTIVE") return "bg-[var(--success-bg)] text-[var(--success)]";
  if (status === "RETIRED") return "bg-[var(--danger-bg)] text-[var(--danger)]";
  return "bg-[var(--border-soft)] text-[var(--muted)]";
}

export default function CatalogGovernanceWorkspace() {
  const { tc } = useLocale();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canReview, setCanReview] = useState(false);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [status, setStatus] = useState<FilterStatus>("ALL");
  const [level, setLevel] = useState("ALL");
  const [direction, setDirection] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [form, setForm] = useState<CatalogPayload>(EMPTY_PAYLOAD);
  const [reason, setReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { rows: CatalogRow[]; counts: Record<string, number>; canReview: boolean };
      setRows(payload.rows);
      setCounts(payload.counts);
      setCanReview(payload.canReview);
      if (payload.canReview) {
        const reviewResponse = await fetch("/api/catalog/requests?status=PENDING", { cache: "no-store" });
        if (!reviewResponse.ok) throw new Error(await responseErrorMessage(reviewResponse, tc));
        const reviewPayload = await reviewResponse.json() as { requests: PendingRequest[]; hasMore: boolean };
        setPending(reviewPayload.requests);
        setPendingHasMore(reviewPayload.hasMore);
      } else {
        setPending([]);
        setPendingHasMore(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCatalog(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  function startCreate() {
    const identity = `governance_${window.crypto.randomUUID().replaceAll("-", "")}`;
    setSelected({ id: null, senseKey: identity, catalogKey: null, sourceFile: null, sourceRow: null, status: "DRAFT", revision: null, latestRevision: null, approvedRevisionId: null, primaryDisposition: "CREATED_DRAFT", eligibilityResult: "DRAFT_BLOCKED", hasSense: false, issues: null, payload: EMPTY_PAYLOAD, pendingRequest: null });
    setForm({ ...EMPTY_PAYLOAD, acceptedAnswersZh: [], acceptedFormsEn: [], synonymsEn: [], antonymsEn: [], distractorZh: [], distractorEn: [] });
    setReason("");
    setReviewNote("");
  }

  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")].filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener("keydown", handleKeyDown); previous?.focus(); };
  }, [selected]);

  const filtered = useMemo(() => {
    const query = search.normalize("NFKC").toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesStatus = status === "ALL" || (status === "BLOCKED" ? row.eligibilityResult === "DRAFT_BLOCKED" : status === "VALIDATION_FAILED" ? row.primaryDisposition === "VALIDATION_FAILED" : status === "PENDING" ? Boolean(row.pendingRequest) : row.status === status);
      const matchesLevel = level === "ALL" || row.level === level;
      const matchesDirection = direction === "ALL" || (direction === "EN_ZH" ? row.enableEnToZh : row.enableZhToEn);
      const matchesSearch = !query || `${row.term} ${row.lemma} ${row.definitionZh} ${row.senseKey ?? ""} ${row.catalogKey ?? ""} ${row.category} ${row.phoneticIpa ?? ""}`.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesLevel && matchesDirection && matchesSearch;
    });
  }, [direction, level, rows, search, status]);

  async function openDetail(row: CatalogRow) {
    if (!row.senseKey) return;
    setError(null);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(row.senseKey)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const detail = await response.json() as Detail;
      setSelected(detail);
      setForm(detail.pendingRequest?.payload ?? detail.payload ?? EMPTY_PAYLOAD);
      setReason("");
      setReviewNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("讀取詞條失敗"));
    }
  }

  function updateForm<K extends keyof CatalogPayload>(key: K, value: CatalogPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitChange(kind: "UPDATE" | "CREATE" | "RETIRE" | "REACTIVATE") {
    if (!selected || !selected.senseKey) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await rosterFetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: window.crypto.randomUUID(), kind, senseKey: selected.senseKey, sourceRowId: selected.sourceFile && selected.sourceFile !== "governance" ? selected.id : undefined, expectedRevision: selected.revision, payload: kind === "UPDATE" || kind === "CREATE" ? form : undefined, reason: reason.trim() || undefined }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      setMessage(tc("已提交草稿，等待有權限的老師或管理員審核。"));
      await loadCatalog();
      if (kind === "CREATE") { setSelected(null); return; }
      const refreshed = rows.find((row) => row.senseKey === selected.senseKey);
      if (refreshed) await openDetail(refreshed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("提交詞庫修改失敗"));
    } finally { setSaving(false); }
  }

  async function reviewRequest(request: PendingRequest, decision: "APPROVE" | "REJECT") {
    setSaving(true); setError(null); setMessage(null);
    try {
      const note = reviewNotes[request.id] ?? (selected?.pendingRequest?.id === request.id ? reviewNote : "");
      const response = await rosterFetch(`/api/catalog/requests/${encodeURIComponent(request.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, expectedRevision: request.revision, reviewNote: note.trim() }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      setMessage(decision === "APPROVE" ? tc("草稿已批准並更新詞庫。") : tc("草稿已拒絕。"));
      setReviewNote("");
      setReviewNotes((current) => { const next = { ...current }; delete next[request.id]; return next; });
      await loadCatalog();
      if (selected?.senseKey) {
        const refreshed = rows.find((row) => row.senseKey === selected.senseKey);
        if (refreshed) await openDetail(refreshed);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("審核詞庫修改失敗"));
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" /></div>;
  if (error && rows.length === 0) return <ErrorBanner message={error} onRetry={() => void loadCatalog()} />;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)]">{tc("詞庫治理工作區")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("管理員及老師可以查看全部詞條；修改先成為草稿，再由有權限人員審核。")}</p></div>
      <button type="button" className="ui-button ui-button-primary" onClick={startCreate}>{tc("新增詞條")}</button>
      <div className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]">{tc("完整詞庫")}：{counts.all ?? rows.length} {tc("條")}</div>
    </div>
    {error ? <ErrorBanner message={error} onRetry={() => void loadCatalog()} /> : null}
    {message ? <p role="status" className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">{message}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {(["all", "ACTIVE", "DRAFT", "RETIRED", "blocked", "validationFailed", "pending"] as const).map((key) => <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-xs text-[var(--muted)]">{key === "all" ? tc("全部") : key === "ACTIVE" ? tc("已啟用") : key === "DRAFT" ? tc("草稿") : key === "RETIRED" ? tc("已停用") : key === "blocked" ? tc("方向被阻擋") : key === "validationFailed" ? tc("驗證失敗") : tc("等待審核")}</p><p className="mt-1 text-xl font-bold text-[var(--text)]">{counts[key] ?? 0}</p></div>)}
    </div>
    <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_150px_170px_190px]">
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("搜尋詞條、釋義或 key")}<input aria-label={tc("搜尋詞條、釋義或 key")} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("狀態")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}>{(["ALL", "ACTIVE", "DRAFT", "RETIRED", "BLOCKED", "VALIDATION_FAILED", "PENDING"] as FilterStatus[]).map((item) => <option key={item} value={item}>{statusLabel(item, tc)}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("程度")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={level} onChange={(event) => setLevel(event.target.value)}><option value="ALL">{tc("全部程度")}</option>{["A1", "A2", "B1", "B2"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("出題方向")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="ALL">{tc("全部方向")}</option><option value="EN_ZH">{tc("英譯中可用")}</option><option value="ZH_EN">{tc("中譯英可用")}</option></select></label>
    </div>
    {canReview ? <section className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-[var(--text)]">{tc("待審核草稿")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{tc("批准前會重新檢查版本、答案安全及干擾項；不能批准自己提交的修改。")}</p></div><span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--primary)]">{pending.length} {tc("項")}</span></div>{pendingHasMore ? <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]">{tc("待審核項目超過目前顯示上限，請先處理現有項目。")}</p> : null}{pending.length ? <div className="mt-3 grid gap-2 lg:grid-cols-2">{pending.map((request) => <article key={request.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--text)]">{request.sense?.term ?? request.payload.term ?? tc("新詞義")}</p><p className="mt-1 break-all text-[10px] text-[var(--muted)]">{request.senseKey ?? request.sourceImportRow?.senseKey ?? tc("尚未建立 sense key")} · {request.kind} · {request.proposer.legalName || request.proposer.accountName} · r{request.baseRevision ?? 0}</p></div><span className="rounded-full bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--warning)]">{tc("待審核")}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--text)]">{request.payload.definitionZh}</p><textarea className="mt-3 min-h-16 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--text)]" placeholder={tc("審核備註（拒絕時必填）")} value={reviewNotes[request.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))} aria-label={tc("審核備註")} /><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => { setForm(request.payload); setReviewNote(reviewNotes[request.id] ?? ""); setSelected({ id: request.sourceImportRow?.id ?? null, senseKey: request.sense?.senseKey ?? request.senseKey ?? request.sourceImportRow?.senseKey ?? "", catalogKey: request.sourceImportRow?.catalogKey ?? request.catalogKey ?? null, sourceFile: request.sourceImportRow?.sourceFile ?? null, sourceRow: request.sourceImportRow?.sourceRow ?? null, status: request.baseStatus ?? "DRAFT", revision: request.baseRevision, latestRevision: request.baseRevision, approvedRevisionId: null, primaryDisposition: request.sourceImportRow?.primaryDisposition ?? "", eligibilityResult: request.sourceImportRow?.eligibilityResult ?? null, hasSense: Boolean(request.sense), issues: null, payload: request.payload, pendingRequest: { id: request.id, kind: request.kind, status: request.status, revision: request.revision, payload: request.payload, reason: request.reason, proposerId: request.proposerId, createdAt: request.createdAt } }); }}>{tc("查看草稿")}</button><button type="button" className="ui-button ui-button-primary ui-button-small" disabled={saving} onClick={() => void reviewRequest(request, "APPROVE")}>{tc("批准")}</button><button type="button" className="ui-button ui-button-danger ui-button-small" disabled={saving} onClick={() => void reviewRequest(request, "REJECT")}>{tc("拒絕")}</button></div></article>)}</div> : <p className="mt-3 text-sm text-[var(--muted)]">{tc("目前沒有等待審核的草稿。")}</p>}</section> : null}
    <p className="text-sm text-[var(--muted)]">{tc("目前篩選")}: {filtered.length} / {rows.length} {tc("條；全部結果已載入")}</p>
    <div className="space-y-2">{filtered.map((row) => <article key={row.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.6fr)_100px_150px_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-[17px] text-[var(--text)]">{row.term || tc("未完成詞條")}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status, tc)}</span></div><p className="mt-1 break-all text-[11px] text-[var(--muted)]">{row.senseKey ?? tc("尚未建立 sense key")}</p></div><div className="min-w-0"><p className="line-clamp-2 text-sm text-[var(--text)]">{row.definitionZh || tc("尚未填寫中文釋義")}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.partOfSpeech || "—"} · {row.level || "—"} · {tc(row.category || "other")}</p></div><div className="text-xs text-[var(--muted)]"><p>{row.enableEnToZh ? tc("英譯中") : tc("英譯中停用")}</p><p>{row.enableZhToEn ? tc("中譯英") : tc("中譯英停用")}</p></div><div className="text-xs text-[var(--muted)]"><p>{row.primaryDisposition === "VALIDATION_FAILED" ? tc("需修訂 validator 問題") : row.eligibilityResult === "DRAFT_BLOCKED" ? tc("出題方向未就緒") : row.approvedRevisionId ? `${tc("已批准 revision")} ${row.revision ?? "—"}` : tc("未批准")}</p><p>{row.pendingRequest ? tc("已有待審核修改") : row.sourceFile ? `${row.sourceFile}:${row.sourceRow}` : tc("治理草稿")}</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => void openDetail(row)}>{tc("查看／修改")}</button>{row.validationErrors.length ? <span className="rounded-full bg-[var(--danger-bg)] px-2 py-1 text-[10px] text-[var(--danger)]">{row.validationErrors.length} {tc("個問題")}</span> : null}</div></div></article>)}</div>
    {selected ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title"><section ref={dialogRef} tabIndex={-1} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[var(--muted)]">{selected.senseKey}</p><h2 id="catalog-dialog-title" className="mt-1 text-xl font-bold text-[var(--text)]">{form.term || tc("詞條內容")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{statusLabel(selected.status, tc)} · {selected.revision === null ? tc("未有 revision") : `revision ${selected.revision}`}</p></div><button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => setSelected(null)} aria-label={tc("關閉") as string}>×</button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文詞") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.term} onChange={(event) => updateForm("term", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("Lemma") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)] disabled:cursor-not-allowed disabled:bg-[var(--border-soft)]" value={form.lemma} disabled={selected.hasSense} onChange={(event) => updateForm("lemma", event.target.value)} />{selected.hasSense ? <small className="font-normal text-[var(--muted)]">{tc("Lemma 屬於穩定詞頭身份；如要改成另一個詞頭，請新增詞義並停用舊詞義。")}</small> : null}</label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("詞性") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.partOfSpeech} onChange={(event) => updateForm("partOfSpeech", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("程度") }<select className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.level} onChange={(event) => updateForm("level", event.target.value as CatalogPayload["level"])}>{["A1", "A2", "B1", "B2"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("Category") }<select className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.category} onChange={(event) => updateForm("category", event.target.value)}>{CATALOG_CATEGORIES.includes(form.category as (typeof CATALOG_CATEGORIES)[number]) ? null : <option value={form.category}>{form.category} ({tc("無效，請重新選擇")})</option>}{CATALOG_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("音標") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.phoneticIpa ?? ""} onChange={(event) => updateForm("phoneticIpa", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("中文釋義") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.definitionZh} onChange={(event) => updateForm("definitionZh", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("例句英文") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.exampleEn ?? ""} onChange={(event) => updateForm("exampleEn", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("例句中文") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.exampleZh ?? ""} onChange={(event) => updateForm("exampleZh", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("中文正確答案（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.acceptedAnswersZh)} onChange={(event) => updateForm("acceptedAnswersZh", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文正確形式（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.acceptedFormsEn)} onChange={(event) => updateForm("acceptedFormsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文近義詞（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.synonymsEn)} onChange={(event) => updateForm("synonymsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文反義詞（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={listText(form.antonymsEn)} onChange={(event) => updateForm("antonymsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("英譯中干擾項（用 | 分隔；5–6 個）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.distractorZh)} onChange={(event) => updateForm("distractorZh", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("中譯英干擾項（用 | 分隔；5–6 個）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.distractorEn)} onChange={(event) => updateForm("distractorEn", parseList(event.target.value))} /></label></div><div className="mt-4 flex flex-wrap gap-4 rounded-2xl border border-[var(--border)] p-3 text-sm text-[var(--text)]"><label className="flex items-center gap-2"><input type="checkbox" checked={form.enableEnToZh} onChange={(event) => updateForm("enableEnToZh", event.target.checked)} />{tc("啟用英譯中")}</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.enableZhToEn} onChange={(event) => updateForm("enableZhToEn", event.target.checked)} />{tc("啟用中譯英")}</label></div><label className="mt-4 grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("修改／停用理由") }<textarea className="min-h-16 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={tc("簡單說明修改原因，停用時必須填寫。")} /></label>{selected.pendingRequest ? <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">{tc("此詞條已有待審核版本，請先完成該審核。")}</p> : null}<div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4"><button type="button" className="ui-button ui-button-quiet" onClick={() => setSelected(null)}>{tc("取消")}</button>{selected.status === "RETIRED" ? <><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange("UPDATE")}>{saving ? tc("提交中…") : tc("提交內容修改草稿")}</button><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange("REACTIVATE")}>{tc("提交重新啟用申請")}</button></> : <><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange(selected.hasSense === false ? "CREATE" : "UPDATE")}>{saving ? tc("提交中…") : tc("提交草稿")}</button>{selected.status === "ACTIVE" ? <button type="button" className="ui-button ui-button-danger" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange("RETIRE")}>{tc("提交停用申請")}</button> : null}</>}</div></section></div> : null}
  </div>;
}
