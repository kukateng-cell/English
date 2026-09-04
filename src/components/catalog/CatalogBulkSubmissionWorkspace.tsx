"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { rosterFetch } from "@/lib/roster-client";
import { responseErrorMessage } from "@/lib/api-error";
import { parseCatalogExportKeys } from "@/lib/catalog/workspace-selection";
import RecentAuthDialog from "@/components/auth/RecentAuthDialog";
import CatalogQuestionPreview from "@/components/catalog/CatalogQuestionPreview";
import type { CatalogGovernancePayload } from "@/lib/catalog/governance";
import {
  applyCatalogSubmissionBatchPatch,
  type CatalogSubmissionBatchPatch,
} from "@/lib/catalog/submission-patch";

type Payload = CatalogGovernancePayload;
type WorkbookFormat = "XLSX" | "CSV";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type BatchRow = {
  id: string;
  rowNumber: number;
  requestedAction: string;
  primaryDisposition: string;
  warnings: unknown;
  errors: unknown;
  normalizedSourcePayload: Payload | null;
};

type Group = {
  id: string;
  groupNumber: number;
  requestedAction: string;
  resolution: string | null;
  resolutionReason: string | null;
  reviewNote: string | null;
  finalProposalPayload: Payload;
  baseProposalPayload: Payload | null;
  reviewRisk: string;
  reviewRiskReason: unknown;
  decision: string;
  revision: number;
  payloadDigest?: string;
  sourceSetDigest: string;
  targetSenseId: string | null;
  targetSenseKey: string | null;
  sourceRows: Array<{ rowNumber: number; rowDigest: string; rowRole: string; normalizedSourcePayload: Payload | null }>;
  changeRequest: { id: string; status: string; revision: number } | null;
};

type Batch = {
  id: string;
  fileName: string;
  status: string;
  revision: number;
  rowCount: number;
  summary: Record<string, unknown>;
  proposerId: string;
  resolutionOwnerId: string | null;
  reviewerId: string | null;
  resolutionClaimed: boolean;
  reviewClaimed: boolean;
  expiresAt: string;
  absoluteExpiresAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  committedAt: string | null;
  createdAt: string;
  rows: BatchRow[];
  groups: Group[];
};

type BatchSummary = Pick<Batch, "id" | "fileName" | "status" | "revision" | "rowCount" | "summary" | "proposerId" | "reviewerId" | "createdAt">;
type SourceSelection = { mode: "SOURCE_ROW"; rowNumber: number } | { mode: "CUSTOM" };
const GROUP_PAGE_SIZE = 20;

function sourcePayloadsDiffer(group: Group): boolean {
  return new Set(group.sourceRows.flatMap((row) => row.normalizedSourcePayload ? [JSON.stringify(row.normalizedSourcePayload)] : [])).size > 1;
}

function resolutionOptions(group: Group): string[] {
  const options: string[] = [];
  if (group.sourceRows.length > 1) options.push("MERGE");
  if (group.targetSenseId) options.push("REPLACE_EXISTING");
  else if (group.sourceRows.length === 1) options.push("KEEP_SEPARATE");
  options.push("REJECT", "ESCALATE");
  return options;
}

function statusTone(status: string): string {
  if (status === "COMMITTED") return "bg-[var(--success-bg)] text-[var(--success)]";
  if (["REJECTED", "STALE", "EXPIRED", "CANCELLED"].includes(status)) return "bg-[var(--danger-bg)] text-[var(--danger)]";
  if (["NEEDS_RESOLUTION", "REVIEWING", "REVIEWED"].includes(status)) return "bg-[var(--warning-bg)] text-[var(--warning)]";
  return "bg-[var(--border-soft)] text-[var(--muted)]";
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export default function CatalogBulkSubmissionWorkspace({ canReview, actorUserId, initialBatchId }: { canReview: boolean; actorUserId: string; initialBatchId?: string | null }) {
  const { tc } = useLocale();
  const [mine, setMine] = useState<BatchSummary[]>([]);
  const [reviewable, setReviewable] = useState<BatchSummary[]>([]);
  const [selected, setSelected] = useState<Batch | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [templateFormat, setTemplateFormat] = useState<WorkbookFormat>("XLSX");
  const [exportFormat, setExportFormat] = useState<WorkbookFormat>("XLSX");
  const [exportKeys, setExportKeys] = useState("");
  const [exportKeysError, setExportKeysError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editedPayloads, setEditedPayloads] = useState<Record<string, Payload>>({});
  const [sourceSelections, setSourceSelections] = useState<Record<string, SourceSelection>>({});
  const [reviewAcknowledged, setReviewAcknowledged] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupPage, setGroupPage] = useState(1);
  const [batchNote, setBatchNote] = useState("");
  const [mineCursor, setMineCursor] = useState<string | null>(null);
  const [reviewCursor, setReviewCursor] = useState<string | null>(null);
  const [recentAuthOpen, setRecentAuthOpen] = useState(false);
  const [pendingFinalizeOperationId, setPendingFinalizeOperationId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const installBatch = useCallback((batch: Batch) => {
    setSelected(batch);
    setResolution(Object.fromEntries(batch.groups.map((group) => [group.id, group.resolution ?? ""])));
    setNotes(Object.fromEntries(batch.groups.map((group) => [group.id, group.reviewNote ?? group.resolutionReason ?? ""])));
    setEditedPayloads(Object.fromEntries(batch.groups.map((group) => [group.id, group.finalProposalPayload])));
    setSourceSelections({});
    setReviewAcknowledged(new Set());
    setExpandedGroups(new Set());
    setGroupPage(1);
  }, []);

  const installMutationPatch = useCallback((base: Batch, patch: CatalogSubmissionBatchPatch<Group>): boolean => {
    const merged = applyCatalogSubmissionBatchPatch(base, patch);
    if (!merged.ok) return false;
    setSelected(merged.batch);
    if (patch.group) {
      const group = patch.group.value;
      setResolution((current) => ({ ...current, [group.id]: group.resolution ?? "" }));
      setNotes((current) => ({ ...current, [group.id]: group.reviewNote ?? group.resolutionReason ?? "" }));
      setEditedPayloads((current) => ({ ...current, [group.id]: group.finalProposalPayload }));
      setReviewAcknowledged((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
    return true;
  }, []);

  const loadQueues = useCallback(async () => {
    setError(null);
    try {
      const [mineResponse, reviewResponse] = await Promise.all([
        fetch("/api/catalog/submissions?scope=mine", { cache: "no-store" }),
        canReview ? fetch("/api/catalog/submissions?scope=reviewable", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      if (!mineResponse.ok) throw new Error(await responseErrorMessage(mineResponse, tc));
      const minePayload = await mineResponse.json() as { items: BatchSummary[]; nextCursor: string | null };
      setMine(minePayload.items);
      setMineCursor(minePayload.nextCursor);
      if (reviewResponse) {
        if (!reviewResponse.ok) throw new Error(await responseErrorMessage(reviewResponse, tc));
        const reviewPayload = await reviewResponse.json() as { items: BatchSummary[]; nextCursor: string | null };
        setReviewable(reviewPayload.items);
        setReviewCursor(reviewPayload.nextCursor);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("讀取批次失敗"));
    }
  }, [canReview, tc]);

  async function loadMoreQueue(scope: "mine" | "reviewable") {
    const cursor = scope === "mine" ? mineCursor : reviewCursor;
    if (!cursor) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/catalog/submissions?scope=${scope}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { items: BatchSummary[]; nextCursor: string | null };
      if (scope === "mine") { setMine((current) => [...current, ...payload.items]); setMineCursor(payload.nextCursor); }
      else { setReviewable((current) => [...current, ...payload.items]); setReviewCursor(payload.nextCursor); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取批次失敗")); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQueues(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQueues]);

  const openBatch = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/catalog/submissions/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const batch = (await response.json() as { batch: Batch }).batch;
      installBatch(batch);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("讀取批次失敗")); }
    finally { setBusy(false); }
  }, [installBatch, tc]);

  useEffect(() => {
    if (!initialBatchId) return;
    const timer = window.setTimeout(() => { void openBatch(initialBatchId); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialBatchId, openBatch]);

  async function upload() {
    if (!file) return;
    const format: WorkbookFormat = file.name.toLocaleLowerCase("en-US").endsWith(".xlsx") ? "XLSX" : "CSV";
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await rosterFetch("/api/catalog/submissions/preview", {
        method: "POST",
        headers: {
          "Content-Type": format === "XLSX" ? XLSX_CONTENT_TYPE : "text/csv; charset=utf-8",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Catalog-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const result = await response.json() as { batch: Batch };
      installBatch(result.batch);
      setMessage(tc(`${format} 預覽已建立；資料尚未提交審核。`));
      await loadQueues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("檔案預覽失敗")); }
    finally { setBusy(false); }
  }

  async function exportSelected() {
    const parsed = parseCatalogExportKeys(exportKeys);
    if (!parsed.ok) {
      setExportKeysError(tc(parsed.issue === "TOO_MANY"
        ? "每次最多匯出 200 個 sense key。"
        : parsed.issue === "DUPLICATE"
          ? "sense key 不可重複；請移除重複項目。"
          : "請先輸入至少一個 sense key。"));
      return;
    }
    const senseKeys = parsed.senseKeys;
    setBusy(true); setExportKeysError(null);
    try {
      const response = await rosterFetch("/api/catalog/submissions/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senseKeys, format: exportFormat }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `catalog-export.${exportFormat.toLocaleLowerCase("en-US")}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setExportKeysError(cause instanceof Error ? cause.message : tc("匯出失敗")); }
    finally { setBusy(false); }
  }

  async function saveResolution(group: Group) {
    if (!selected) return;
    const needsSourceSelection = resolution[group.id] === "MERGE" && sourcePayloadsDiffer(group);
    const sourceSelection = sourceSelections[group.id];
    if (needsSourceSelection && !sourceSelection) { setError(tc("來源行內容不同；請明確採用其中一行，或編輯自訂最終提案。")); return; }
    setBusy(true); setError(null);
    try {
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(selected.id)}/resolutions`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          groupId: group.id,
          expectedBatchRevision: selected.revision,
          expectedGroupRevision: group.revision,
          resolution: resolution[group.id],
          reason: notes[group.id] ?? "",
          payload: editedPayloads[group.id] ?? group.finalProposalPayload,
          ...(needsSourceSelection ? {
            sourceSelectionMode: sourceSelection!.mode,
            ...(sourceSelection!.mode === "SOURCE_ROW" ? { selectedSourceRowNumber: sourceSelection!.rowNumber } : {}),
            acknowledgedSourceSetDigest: group.sourceSetDigest,
          } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { patch: CatalogSubmissionBatchPatch<Group> };
      if (!installMutationPatch(selected, payload.patch)) await openBatch(selected.id);
      setMessage(tc("處理方式已儲存。"));
      await loadQueues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("儲存處理方式失敗")); }
    finally { setBusy(false); }
  }

  async function batchAction(action: "submit" | "cancel" | "claim" | "release" | "finalize", existingOperationId?: string) {
    if (!selected) return;
    const operationId = action === "submit" || action === "finalize" ? existingOperationId ?? crypto.randomUUID() : null;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(selected.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(operationId ? { "Idempotency-Key": operationId } : {}) },
        body: JSON.stringify({ expectedRevision: selected.revision, reason: batchNote.trim() || tc("詞庫批量提交") }),
      });
      if (!response.ok && action === "finalize") {
        const detail = await response.clone().json().catch(() => null) as { code?: string } | null;
        if (detail?.code === "RECENT_AUTH_REQUIRED") {
          setPendingFinalizeOperationId(operationId);
          setRecentAuthOpen(true);
          return;
        }
      }
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { patch: CatalogSubmissionBatchPatch<Group> };
      if (!installMutationPatch(selected, payload.patch)) await openBatch(selected.id);
      setPendingFinalizeOperationId(null);
      setMessage(action === "finalize" ? tc("批次已完成。") : tc("批次狀態已更新。"));
      await loadQueues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("更新批次失敗")); }
    finally { setBusy(false); }
  }

  async function reviewGroup(group: Group, decision: "APPROVE" | "REJECT") {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(selected.id)}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          groupId: group.id,
          expectedBatchRevision: selected.revision,
          expectedGroupRevision: group.revision,
          decision,
          reviewNote: notes[group.id] ?? "",
          ...(decision === "APPROVE" ? { acknowledgedPayloadDigest: reviewAcknowledged.has(group.id) ? group.payloadDigest : "" } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { patch: CatalogSubmissionBatchPatch<Group> };
      if (!installMutationPatch(selected, payload.patch)) await openBatch(selected.id);
      await loadQueues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("儲存審核失敗")); }
    finally { setBusy(false); }
  }

  async function requestResolution(group: Group) {
    if (!selected) return;
    const reason = (notes[group.id] ?? "").trim();
    if (reason.length < 3) { setError(tc("請先填寫需要修正的原因。")); return; }
    setBusy(true); setError(null);
    try {
      const response = await rosterFetch(`/api/catalog/submissions/${encodeURIComponent(selected.id)}/request-resolution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, expectedBatchRevision: selected.revision, expectedGroupRevision: group.revision, reason }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as { patch: CatalogSubmissionBatchPatch<Group> };
      if (!installMutationPatch(selected, payload.patch)) await openBatch(selected.id);
      setMessage(tc("已要求提交者修正；本批次已封存，修正內容須建立新預覽。"));
      await loadQueues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("要求修正失敗")); }
    finally { setBusy(false); }
  }

  const invalidCount = useMemo(() => selected?.rows.filter((row) => arrayText(row.errors).length).length ?? 0, [selected]);
  const ownsSelected = Boolean(selected && selected.proposerId === actorUserId);
  const claimedByMe = Boolean(selected && selected.reviewerId === actorUserId);
  const resolutionClaimedByMe = Boolean(selected && selected.resolutionOwnerId === actorUserId);
  const canEditResolution = (ownsSelected && !selected?.resolutionClaimed) || resolutionClaimedByMe;
  const filteredGroups = useMemo(() => (selected?.groups ?? []).filter((group) => {
    if (groupFilter === "ALL") return true;
    if (groupFilter === "CREATE" || groupFilter === "UPDATE") return group.requestedAction === groupFilter;
    if (groupFilter === "MATERIAL") return group.reviewRisk === "MATERIAL";
    return group.decision === groupFilter;
  }), [groupFilter, selected]);
  const groupPageCount = Math.max(1, Math.ceil(filteredGroups.length / GROUP_PAGE_SIZE));
  const visibleGroups = filteredGroups.slice((Math.min(groupPage, groupPageCount) - 1) * GROUP_PAGE_SIZE, Math.min(groupPage, groupPageCount) * GROUP_PAGE_SIZE);

  return <div className="space-y-5">
    <header><h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)]">{tc("批量提交")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("支援 Excel（XLSX）及 CSV。先建立安全預覽，再提交新增或修改內容；預覽不會修改正式詞庫。")}</p></header>
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-bold text-[var(--text)]">{tc("上載新增或修改檔案")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{tc("接受 Excel（XLSX）或 UTF-8 CSV，最多 200 行及 4 MiB。新增詞條時請將系統 key 留空；修改現有詞條時，請先匯出有關詞條。")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2"><label className="text-xs font-semibold text-[var(--muted)]">{tc("範本格式")}<select aria-label={tc("範本格式") as string} value={templateFormat} onChange={(event) => setTemplateFormat(event.target.value as WorkbookFormat)} className="ml-2 h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"><option value="XLSX">{tc("Excel（XLSX）")}</option><option value="CSV">CSV</option></select></label><button type="button" className="ui-button ui-button-secondary" onClick={() => window.location.assign(`/api/catalog/submissions/template?format=${templateFormat.toLocaleLowerCase("en-US")}`)}>{tc("下載新增詞條範本")}</button><span className="rounded-xl bg-[var(--border-soft)] px-3 py-2 text-xs text-[var(--muted)]">{tc("請勿刪除、重新命名或移動欄位；必須保留老師範本原有 34 欄次序。完整 39 欄只供受控基線工具使用。")}</span></div>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-[var(--text)]">{tc("選擇 XLSX 或 CSV 檔案")}<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full rounded-xl border border-[var(--border)] p-3 text-sm" /></label>
        <button type="button" className="ui-button ui-button-primary mt-3" disabled={!file || busy} onClick={() => void upload()}>{busy ? tc("處理中…") : tc("建立安全預覽")}</button>
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-bold text-[var(--text)]">{tc("按 Sense key 匯出詞條")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{tc("輸入最多 200 個 sense key，每行一個。預設匯出 Excel（XLSX），亦可選擇 CSV。")}</p>
        <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("Sense keys（每行一個）")}<textarea className="min-h-28 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-normal text-[var(--text)]" value={exportKeys} onChange={(event) => { setExportKeys(event.target.value); setExportKeysError(null); }} placeholder="sense_…" aria-invalid={Boolean(exportKeysError)} aria-describedby={exportKeysError ? "catalog-export-keys-error" : undefined} /></label>
        {exportKeysError ? <p id="catalog-export-keys-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">{exportKeysError}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-xs font-semibold text-[var(--muted)]">{tc("匯出格式")}<select aria-label={tc("Sense key 匯出格式") as string} value={exportFormat} onChange={(event) => setExportFormat(event.target.value as WorkbookFormat)} className="ml-2 h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"><option value="XLSX">{tc("Excel（XLSX）")}</option><option value="CSV">CSV</option></select></label><button type="button" className="ui-button ui-button-secondary" disabled={busy || !exportKeys.trim()} onClick={() => void exportSelected()}>{tc(`匯出所選詞條（${exportFormat}）`)}</button></div>
      </div>
    </section>
    {error ? <p role="alert" className="rounded-xl bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p> : null}
    {message ? <p role="status" aria-live="polite" className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">{message}</p> : null}
    <section className={`grid gap-4 ${canReview ? "xl:grid-cols-2" : ""}`}>
      <BatchList title={tc("我的批次")} items={mine} empty={tc("未有批次。") as string} onOpen={openBatch} hasMore={Boolean(mineCursor)} onLoadMore={() => void loadMoreQueue("mine")} loading={busy} />
      {canReview ? <BatchList title={tc("待處理／待審批次")} items={reviewable} empty={tc("目前沒有待處理批次。") as string} onOpen={openBatch} hasMore={Boolean(reviewCursor)} onLoadMore={() => void loadMoreQueue("reviewable")} loading={busy} /> : null}
    </section>
    {selected ? <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="catalog-batch-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="catalog-batch-title" className="break-all text-lg font-bold text-[var(--text)]">{selected.fileName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{selected.id} · {selected.rowCount} {tc("行")} · revision {selected.revision}</p><p className="mt-1 text-xs text-[var(--muted)]">{tc("活動期限")}：{new Date(selected.expiresAt).toLocaleString("zh-HK", { timeZone: "Asia/Shanghai" })} · {tc("最長期限")}：{new Date(selected.absoluteExpiresAt).toLocaleString("zh-HK", { timeZone: "Asia/Shanghai" })}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(selected.status)}`}>{selected.status}</span></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><Metric label={tc("有效行") as string} value={Number(selected.summary.validRows ?? 0)} /><Metric label={tc("問題行") as string} value={invalidCount} /><Metric label={tc("提案組") as string} value={selected.groups.length} /></div>
      {invalidCount ? <button type="button" className="ui-button ui-button-secondary mt-3" onClick={() => window.location.assign(`/api/catalog/submissions/${encodeURIComponent(selected.id)}/errors.csv`)}>{tc("下載錯誤報告")}</button> : null}
      <label className="mt-4 grid max-w-xs gap-1 text-xs font-semibold text-[var(--muted)]">{tc("篩選提案組")}<select className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); setGroupPage(1); setExpandedGroups(new Set()); }}>{["ALL", "PENDING", "APPROVE", "REJECT", "CREATE", "UPDATE", "MATERIAL"].map((value) => <option key={value} value={value}>{value === "ALL" ? tc("全部提案") : value}</option>)}</select></label>
      <p className="mt-2 text-xs text-[var(--muted)]">{tc("每頁最多顯示 20 組；完整差異及編輯器只會在展開個別提案時載入。")} {filteredGroups.length ? `${Math.min(groupPage, groupPageCount)} / ${groupPageCount}` : ""}</p>
      <div className="mt-4 space-y-3">{visibleGroups.map((group) => {
        const expanded = expandedGroups.has(group.id);
        const differingSources = sourcePayloadsDiffer(group);
        const sourceSelection = sourceSelections[group.id];
        return <article key={group.id} className="rounded-xl border border-[var(--border)] p-3">
          <button type="button" className="flex w-full flex-wrap items-start justify-between gap-2 text-left" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><span><strong className="text-[var(--text)]">#{group.groupNumber} {group.finalProposalPayload.term ?? tc("未命名詞條")}</strong><small className="mt-1 block text-xs text-[var(--muted)]">{group.requestedAction} · {group.finalProposalPayload.level} · {group.finalProposalPayload.category} · {tc("來源行")} {group.sourceRows.map((row) => row.rowNumber).join(", ")}</small></span><span className="flex gap-2"><span className={`rounded-full px-2 py-1 text-[10px] ${statusTone(group.decision)}`}>{group.decision}</span><span className="rounded-full bg-[var(--border-soft)] px-2 py-1 text-[10px] text-[var(--muted)]">{group.reviewRisk}</span></span></button>
          {expanded ? <div className="mt-3 border-t border-[var(--border)] pt-3">
            <FullPayloadDiff before={group.baseProposalPayload} after={group.finalProposalPayload} tc={tc} />
            <CatalogQuestionPreview payload={editedPayloads[group.id] ?? group.finalProposalPayload} senseKey={group.targetSenseKey} />
            {group.sourceRows.length > 1 ? <details open className="mt-3 rounded-xl border border-[var(--border)] p-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--text)]">{tc("比較各來源行全部欄位")} ({group.sourceRows.length})</summary>{differingSources ? <p className="mt-2 rounded-lg bg-[var(--warning-bg)] p-2 text-xs font-semibold text-[var(--warning)]">{tc("來源行內容不同。MERGE 前必須明確採用一行，或實際編輯自訂最終提案；系統不會預設採用第一行。")}</p> : null}<div className="mt-2 space-y-3">{group.sourceRows.map((row) => <div key={row.rowNumber} className="rounded-lg bg-[var(--border-soft)] p-3 text-xs text-[var(--text)]"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{tc("來源行")} {row.rowNumber}</b><span className="ml-2 text-[var(--muted)]">{row.rowRole}</span></span>{canEditResolution && row.normalizedSourcePayload ? <button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => { setEditedPayloads((current) => ({ ...current, [group.id]: row.normalizedSourcePayload! })); setSourceSelections((current) => ({ ...current, [group.id]: { mode: "SOURCE_ROW", rowNumber: row.rowNumber } })); }}>{sourceSelection?.mode === "SOURCE_ROW" && sourceSelection.rowNumber === row.rowNumber ? tc("已採用此行") : tc("採用此行")}</button> : null}</div>{row.normalizedSourcePayload ? <PayloadSnapshot value={row.normalizedSourcePayload} tc={tc} /> : <p className="mt-2">—</p>}</div>)}</div></details> : null}
            {canEditResolution && ["PREVIEW", "NEEDS_RESOLUTION"].includes(selected.status) && editedPayloads[group.id] ? <PayloadEditor value={editedPayloads[group.id]!} onChange={(payload) => { setEditedPayloads((current) => ({ ...current, [group.id]: payload })); setSourceSelections((current) => ({ ...current, [group.id]: { mode: "CUSTOM" } })); }} tc={tc} /> : null}
            {canEditResolution && ["PREVIEW", "NEEDS_RESOLUTION"].includes(selected.status) ? <div className="mt-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]"><select aria-label={tc("重複／衝突處理方式") as string} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={resolution[group.id] ?? ""} onChange={(event) => setResolution((current) => ({ ...current, [group.id]: event.target.value }))}><option value="">{tc("請選擇處理方式")}</option>{resolutionOptions(group).map((item) => <option key={item} value={item}>{item}</option>)}</select><input aria-label={tc("處理理由") as string} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" value={notes[group.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [group.id]: event.target.value }))} placeholder={tc("需要時說明理由") as string} /><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={busy || !resolution[group.id] || (resolution[group.id] === "MERGE" && differingSources && !sourceSelection)} onClick={() => void saveResolution(group)}>{tc("儲存最終提案")}</button></div> : null}
            {canReview && claimedByMe && ["REVIEWING", "SUBMITTED", "REVIEWED"].includes(selected.status) && group.changeRequest ? <div className="mt-3"><p className="rounded-lg bg-[var(--warning-bg)] p-2 text-xs text-[var(--warning)]">{tc("風險判定")}：{group.reviewRisk} · {arrayText(group.reviewRiskReason).join(" ｜ ") || tc("所有未分類改動均按重大內容處理")}</p><label className="mt-3 flex items-start gap-2 text-sm font-semibold text-[var(--text)]"><input type="checkbox" className="mt-1" checked={reviewAcknowledged.has(group.id)} onChange={(event) => setReviewAcknowledged((current) => { const next = new Set(current); if (event.target.checked) next.add(group.id); else next.delete(group.id); return next; })} /><span>{tc("我已展開並核對以上所有修改欄位、正確答案、例句、方向及干擾項")}</span></label><textarea className="mt-3 min-h-16 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" value={notes[group.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [group.id]: event.target.value }))} placeholder={tc("審核備註；拒絕或要求修正時必填") as string} /><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-primary ui-button-small" disabled={busy || !reviewAcknowledged.has(group.id)} onClick={() => void reviewGroup(group, "APPROVE")}>{tc("批准提案")}</button><button type="button" className="ui-button ui-button-danger ui-button-small" disabled={busy} onClick={() => void reviewGroup(group, "REJECT")}>{tc("拒絕提案")}</button><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={busy || (notes[group.id] ?? "").trim().length < 3} onClick={() => void requestResolution(group)}>{tc("要求修正並封存批次")}</button></div></div> : null}
          </div> : null}
        </article>;
      })}</div>
      {groupPageCount > 1 ? <div className="mt-3 flex items-center justify-between gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={groupPage <= 1} onClick={() => { setGroupPage((page) => Math.max(1, page - 1)); setExpandedGroups(new Set()); }}>{tc("上一頁")}</button><span className="text-xs text-[var(--muted)]">{Math.min(groupPage, groupPageCount)} / {groupPageCount}</span><button type="button" className="ui-button ui-button-secondary ui-button-small" disabled={groupPage >= groupPageCount} onClick={() => { setGroupPage((page) => Math.min(groupPageCount, page + 1)); setExpandedGroups(new Set()); }}>{tc("下一頁")}</button></div> : null}
      {ownsSelected && ["PREVIEW", "NEEDS_RESOLUTION"].includes(selected.status) ? <label className="mt-4 grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("整批提交說明")}<textarea className="min-h-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]" value={batchNote} onChange={(event) => setBatchNote(event.target.value)} placeholder={tc("說明本批新增或修改的目的，方便審核者理解。") as string} /></label> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
        {ownsSelected && ["PREVIEW", "NEEDS_RESOLUTION"].includes(selected.status) ? <><button type="button" className="ui-button ui-button-primary" disabled={busy || invalidCount > 0 || selected.groups.some((group) => !group.resolution || group.resolution === "ESCALATE")} onClick={() => void batchAction("submit")}>{tc("提交整批審核")}</button><button type="button" className="ui-button ui-button-danger" disabled={busy} onClick={() => void batchAction("cancel")}>{tc("取消批次")}</button></> : null}
        {canReview && selected.status === "NEEDS_RESOLUTION" && !selected.resolutionOwnerId ? <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={() => void batchAction("claim")}>{tc("領取衝突處理")}</button> : null}
        {canReview && resolutionClaimedByMe && selected.status === "NEEDS_RESOLUTION" ? <button type="button" className="ui-button ui-button-quiet" disabled={busy} onClick={() => void batchAction("release")}>{tc("釋放衝突處理")}</button> : null}
        {canReview && ["SUBMITTED", "REVIEWING", "REVIEWED"].includes(selected.status) && !selected.reviewerId ? <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={() => void batchAction("claim")}>{tc("領取審核")}</button> : null}
        {canReview && claimedByMe && ["SUBMITTED", "REVIEWING", "REVIEWED"].includes(selected.status) ? <button type="button" className="ui-button ui-button-quiet" disabled={busy} onClick={() => void batchAction("release")}>{tc("釋放審核")}</button> : null}
        {canReview && claimedByMe && selected.status === "REVIEWED" ? <div className="w-full rounded-xl bg-[var(--warning-bg)] p-3"><p className="text-sm font-semibold text-[var(--warning)]">{tc("即將原子套用")}：{selected.groups.filter((group) => group.decision === "APPROVE").length} {tc("項批准")}／{selected.groups.filter((group) => group.decision === "REJECT").length} {tc("項拒絕")}。{tc("任何一項重新驗證失敗，整批批准內容都不會寫入。")}</p><button type="button" className="ui-button ui-button-primary mt-2" disabled={busy} onClick={() => void batchAction("finalize")}>{tc("覆核並原子套用")}</button></div> : null}
      </div>
    </section> : null}
    <RecentAuthDialog open={recentAuthOpen} onClose={() => { setRecentAuthOpen(false); setPendingFinalizeOperationId(null); }} onSuccess={() => { setRecentAuthOpen(false); const operationId = pendingFinalizeOperationId; setPendingFinalizeOperationId(null); if (operationId) void batchAction("finalize", operationId); }} />
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[var(--border-soft)] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-xl font-bold text-[var(--text)]">{value}</p></div>;
}

function BatchList({ title, items, empty, onOpen, hasMore, onLoadMore, loading }: { title: string; items: BatchSummary[]; empty: string; onOpen: (id: string) => Promise<void>; hasMore: boolean; onLoadMore: () => void; loading: boolean }) {
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-bold text-[var(--text)]">{title}</h2>{items.length ? <div className="mt-3 space-y-2">{items.map((batch) => <button type="button" key={batch.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-left hover:bg-[var(--border-soft)]" onClick={() => void onOpen(batch.id)}><span className="min-w-0"><strong className="block break-all text-sm text-[var(--text)]">{batch.fileName}</strong><small className="text-[var(--muted)]">{batch.rowCount} rows · {new Date(batch.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Shanghai" })}</small></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusTone(batch.status)}`}>{batch.status}</span></button>)}{hasMore ? <button type="button" className="ui-button ui-button-secondary ui-button-small w-full" disabled={loading} onClick={onLoadMore}>{loading ? "…" : "載入更多"}</button> : null}</div> : <p className="mt-3 text-sm text-[var(--muted)]">{empty}</p>}</section>;
}

const PAYLOAD_LABELS: Record<keyof Payload, string> = {
  term: "英文詞語", lemma: "Lemma", partOfSpeech: "詞性", level: "程度", category: "分類", definitionZh: "中文釋義",
  acceptedAnswersZh: "其他可接受中文譯法", phoneticIpa: "音標", exampleEn: "英文例句", exampleZh: "中文例句",
  acceptedFormsEn: "其他可接受英文形式", synonymsEn: "同義詞", antonymsEn: "反義詞", enableEnToZh: "啟用英譯中",
  distractorZh: "英譯中干擾項", enableZhToEn: "啟用中譯英", distractorEn: "中譯英干擾項",
  sourceReference: "來源參考", contributorRef: "貢獻者參考", changeNote: "內容備註", retirementReason: "停用原因",
};

function payloadValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(" ｜ ") : "—";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function payloadComparable(value: unknown): string {
  return Array.isArray(value) ? JSON.stringify([...value].map(String).sort()) : JSON.stringify(value ?? null);
}

function FullPayloadDiff({ before, after, tc }: { before: Payload | null; after: Payload; tc: (value: string) => string }) {
  const fields = (Object.keys(PAYLOAD_LABELS) as Array<keyof Payload>).filter((field) => payloadComparable(before?.[field]) !== payloadComparable(after[field]));
  return <details open className="mt-3 rounded-xl border border-[var(--border)] p-3"><summary className="cursor-pointer text-xs font-bold text-[var(--text)]">{tc("完整欄位差異")} ({fields.length})</summary>{fields.length ? <div className="mt-3 space-y-2">{fields.map((field) => <div key={field} className="grid gap-2 rounded-lg bg-[var(--border-soft)] p-2 text-xs md:grid-cols-[150px_1fr_1fr]"><strong className="text-[var(--muted)]">{tc(PAYLOAD_LABELS[field])}</strong><span className="break-words text-[var(--text)]"><b>{tc("修改前")}：</b>{payloadValue(before?.[field])}</span><span className="break-words text-[var(--text)]"><b>{tc("修改後")}：</b>{payloadValue(after[field])}</span></div>)}</div> : <p className="mt-2 text-xs text-[var(--muted)]">{tc("沒有內容差異。")}</p>}</details>;
}

function PayloadSnapshot({ value, tc }: { value: Payload; tc: (value: string) => string }) {
  return <dl className="mt-3 grid gap-2 sm:grid-cols-2">{(Object.keys(PAYLOAD_LABELS) as Array<keyof Payload>).map((field) => <div key={field} className="min-w-0"><dt className="font-semibold text-[var(--muted)]">{tc(PAYLOAD_LABELS[field])}</dt><dd className="break-words text-[var(--text)]">{payloadValue(value[field])}</dd></div>)}</dl>;
}

function PayloadEditor({ value, onChange, tc }: { value: Payload; onChange: (payload: Payload) => void; tc: (value: string) => string }) {
  const text = (field: keyof Payload, nullable = false) => <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc(PAYLOAD_LABELS[field])}<input className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--text)]" value={String(value[field] ?? "")} onChange={(event) => onChange({ ...value, [field]: nullable ? event.target.value || null : event.target.value })} /></label>;
  const list = (field: "acceptedAnswersZh" | "acceptedFormsEn" | "synonymsEn" | "antonymsEn" | "distractorZh" | "distractorEn") => <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc(PAYLOAD_LABELS[field])}<textarea className="min-h-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--text)]" value={value[field].join(" | ")} onChange={(event) => onChange({ ...value, [field]: event.target.value.split("|").map((item) => item.trim()).filter(Boolean) })} /></label>;
  return <details className="mt-3 rounded-xl border border-[var(--primary)] bg-[var(--primary-soft)] p-3"><summary className="cursor-pointer text-xs font-bold text-[var(--text)]">{tc("編輯最終提案內容")}</summary><p className="mt-2 text-xs text-[var(--muted)]">{tc("清單欄位以直線分隔；儲存時伺服器會重新驗證全部內容及干擾項。")}</p><div className="mt-3 grid gap-3 md:grid-cols-2">{text("term")}{text("lemma")}{text("partOfSpeech")}<label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("程度")}<select className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm" value={value.level} onChange={(event) => onChange({ ...value, level: event.target.value as Payload["level"] })}>{["A1", "A2", "B1", "B2"].map((item) => <option key={item}>{item}</option>)}</select></label>{text("category")}{text("definitionZh")}{list("acceptedAnswersZh")}{text("phoneticIpa", true)}{text("exampleEn", true)}{text("exampleZh", true)}{list("acceptedFormsEn")}{list("synonymsEn")}{list("antonymsEn")}{list("distractorZh")}{list("distractorEn")}{text("sourceReference", true)}{text("contributorRef", true)}{text("changeNote", true)}<label className="flex items-center gap-2 text-sm text-[var(--text)]"><input type="checkbox" checked={value.enableEnToZh} onChange={(event) => onChange({ ...value, enableEnToZh: event.target.checked })} />{tc("啟用英譯中")}</label><label className="flex items-center gap-2 text-sm text-[var(--text)]"><input type="checkbox" checked={value.enableZhToEn} onChange={(event) => onChange({ ...value, enableZhToEn: event.target.checked })} />{tc("啟用中譯英")}</label></div></details>;
}
