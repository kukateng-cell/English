"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import {
  catalogExportAvailability,
  hasCatalogExportTarget,
} from "@/lib/catalog/workspace-selection";
import {
  catalogCategoryLabel,
  catalogIssuePresentation,
  catalogLifecycleLabel,
  catalogPartOfSpeechLabel,
  catalogReadinessLabel,
  catalogWorkflowLabel,
  type CatalogContentScope,
  type CatalogReadinessState,
  type CatalogStructuredIssue,
  type CatalogWorkflowState,
} from "@/lib/catalog/teacher-presentation";
import { useCatalogMediaQuery } from "./useCatalogMediaQuery";

export type CatalogDisplayRow = {
  id: string;
  senseKey: string | null;
  term: string;
  definitionZh: string;
  partOfSpeech: string;
  level: string;
  category: string;
  phoneticIpa: string | null;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  lifecycleState: "DRAFT" | "ACTIVE" | "RETIRED";
  workflowState: CatalogWorkflowState;
  readinessState: CatalogReadinessState;
  contentScope: CatalogContentScope;
  issueCount: number;
  structuredIssues: CatalogStructuredIssue[];
  pendingRequest: unknown;
  approvedRevisionId: string | null;
  revision: number | null;
  hasSense: boolean;
};

function lifecycleTone(status: CatalogDisplayRow["status"]): string {
  if (status === "ACTIVE")
    return "bg-[var(--success-bg)] text-[var(--success)]";
  if (status === "RETIRED") return "bg-[var(--danger-bg)] text-[var(--danger)]";
  return "bg-[var(--border-soft)] text-[var(--muted)]";
}

function IssueSummary({
  row,
  onEdit,
}: {
  row: CatalogDisplayRow;
  onEdit: () => void;
}) {
  const { tc } = useLocale();
  if (!row.issueCount) return null;
  const scope =
    row.contentScope === "PENDING_DRAFT"
      ? "待審版本"
      : row.contentScope === "IMPORT_DRAFT"
        ? "匯入草稿"
        : "目前正式版本";
  return (
    <details className="mt-1 text-xs text-[var(--danger)]">
      <summary className="cursor-pointer font-semibold">
        {tc(scope)}
        {tc("有")} {row.issueCount} {tc("項內容需修正")}
      </summary>
      <div className="mt-2 space-y-2 rounded-xl bg-[var(--danger-bg)] p-3">
        {row.structuredIssues.map((issue, index) => {
          const copy = catalogIssuePresentation(issue);
          return (
            <div key={`${issue.code}:${index}`}>
              <p className="font-semibold">
                {copy.directionLabel ? `${tc(copy.directionLabel)} · ` : ""}
                {tc(copy.fieldLabel)}：{tc(copy.reason)}
              </p>
              <p className="mt-1">{tc(copy.fix)}</p>
            </div>
          );
        })}
        <button
          type="button"
          className="font-semibold underline"
          onClick={onEdit}
        >
          {tc("查看／修改")}
        </button>
      </div>
    </details>
  );
}

function MoreMenu({
  onReport,
  onHistory,
  historyEnabled,
}: {
  onReport: () => void;
  onHistory: () => void;
  historyEnabled: boolean;
}) {
  const { tc } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        data-catalog-history-trigger
        type="button"
        className="ui-button ui-button-quiet ui-button-small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {tc("更多操作")}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 min-w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          <button
            role="menuitem"
            type="button"
            className="block min-h-11 w-full rounded-lg px-3 text-left text-sm text-[var(--text)] hover:bg-[var(--border-soft)]"
            onClick={() => {
              setOpen(false);
              onReport();
            }}
          >
            {tc("報告問題")}
          </button>
          {historyEnabled ? (
            <button
              role="menuitem"
              type="button"
              className="block min-h-11 w-full rounded-lg px-3 text-left text-sm text-[var(--text)] hover:bg-[var(--border-soft)]"
              onClick={() => {
                setOpen(false);
                onHistory();
              }}
            >
              {tc("查看歷史")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function CatalogWorkspaceResults({
  rows,
  bulkEnabled,
  selectedSenseKeys,
  historyEnabled,
  onToggleSelection,
  onEdit,
  onReport,
  onHistory,
}: {
  rows: CatalogDisplayRow[];
  bulkEnabled: boolean;
  selectedSenseKeys: Set<string>;
  historyEnabled: boolean;
  onToggleSelection: (senseKey: string, checked: boolean) => void;
  onEdit: (row: CatalogDisplayRow) => void;
  onReport: (row: CatalogDisplayRow) => void;
  onHistory: (row: CatalogDisplayRow) => void;
}) {
  const { tc } = useLocale();
  const desktop = useCatalogMediaQuery("(min-width: 1100px)");
  const category = (row: CatalogDisplayRow) =>
    tc(catalogCategoryLabel(row.category));
  const status = (row: CatalogDisplayRow) =>
    tc(catalogLifecycleLabel(row.lifecycleState));
  const workflow = (row: CatalogDisplayRow) =>
    tc(catalogWorkflowLabel(row.workflowState));
  const readiness = (row: CatalogDisplayRow) =>
    tc(catalogReadinessLabel(row.readinessState));
  if (desktop)
    return (
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1000px] table-fixed border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--border-soft)] text-xs text-[var(--muted)]">
            <tr>
              {bulkEnabled ? (
                <th scope="col" className="w-12 px-3 py-3">
                  {tc("選取")}
                </th>
              ) : null}
              <th scope="col" className="w-[210px] px-3 py-3">
                {tc("詞條及詞義")}
              </th>
              <th scope="col" className="w-[150px] px-3 py-3">
                {tc("分類")}
              </th>
              <th scope="col" className="w-[170px] px-3 py-3">
                {tc("狀態")}
              </th>
              <th scope="col" className="w-[155px] px-3 py-3">
                {tc("出題狀態")}
              </th>
              <th scope="col" className="w-[285px] px-3 py-3 text-right">
                {tc("操作")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr
                key={row.id}
                data-catalog-row={row.id}
                className="h-[88px] align-middle hover:bg-[var(--border-soft)]/40"
              >
                {bulkEnabled ? (
                  <td className="px-3 py-2">
                    {hasCatalogExportTarget(row) ? (
                      <input
                        aria-label={`${tc("選取匯出")} ${row.term}`}
                        type="checkbox"
                        checked={selectedSenseKeys.has(row.senseKey!)}
                        disabled={Boolean(row.pendingRequest)}
                        onChange={(event) =>
                          onToggleSelection(row.senseKey!, event.target.checked)
                        }
                      />
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <strong
                    className="block truncate text-[15px] text-[var(--text)]"
                    title={row.term}
                  >
                    {row.term || tc("未完成詞條")}
                  </strong>
                  <span
                    className="mt-1 block truncate text-xs leading-5 text-[var(--muted)]"
                    title={row.definitionZh}
                  >
                    {row.definitionZh || tc("尚未填寫中文釋義")}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--muted)]">
                  <p>
                    {tc(catalogPartOfSpeechLabel(row.partOfSpeech))} ·{" "}
                    {row.level || "—"}
                  </p>
                  <p className="mt-1 truncate" title={category(row)}>
                    {category(row)}
                  </p>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 font-semibold ${lifecycleTone(row.status)}`}
                  >
                    {status(row)}
                  </span>
                  <p
                    className="mt-1 truncate text-[var(--muted)]"
                    title={workflow(row)}
                  >
                    {workflow(row)}
                  </p>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--muted)]">
                  <p className="font-semibold text-[var(--text)]">
                    {readiness(row)}
                  </p>
                  <IssueSummary row={row} onEdit={() => onEdit(row)} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-nowrap justify-end gap-1">
                    <button
                      type="button"
                      className="min-h-9 whitespace-nowrap rounded-lg border border-[var(--border)] px-2 text-xs font-semibold text-[var(--text)]"
                      onClick={() => onEdit(row)}
                    >
                      {tc("查看／修改")}
                    </button>
                    <button
                      type="button"
                      className="min-h-9 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[var(--primary)]"
                      onClick={() => onReport(row)}
                    >
                      {tc("報告問題")}
                    </button>
                    {historyEnabled ? (
                      <button
                        type="button"
                        className="min-h-9 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[var(--primary)]"
                        onClick={() => onHistory(row)}
                      >
                        {tc("查看歷史")}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <article
          key={row.id}
          data-catalog-row={row.id}
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-base text-[var(--text)]">
                {row.term || tc("未完成詞條")}
              </strong>
              {row.phoneticIpa ? (
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {row.phoneticIpa}
                </span>
              ) : null}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${lifecycleTone(row.status)}`}
            >
              {status(row)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--text)]">
            {row.definitionZh || tc("尚未填寫中文釋義")}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {tc(catalogPartOfSpeechLabel(row.partOfSpeech))} ·{" "}
            {row.level || "—"} · {category(row)}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {workflow(row)} ·{" "}
            <span className="font-semibold text-[var(--text)]">
              {readiness(row)}
            </span>
          </p>
          <IssueSummary row={row} onEdit={() => onEdit(row)} />
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
            <div>
              {bulkEnabled && hasCatalogExportTarget(row) ? (
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={selectedSenseKeys.has(row.senseKey!)}
                    disabled={Boolean(row.pendingRequest)}
                    onChange={(event) =>
                      onToggleSelection(row.senseKey!, event.target.checked)
                    }
                  />
                  {tc("選取匯出")}
                </label>
              ) : bulkEnabled &&
                catalogExportAvailability(row) ===
                  "REQUIRES_GOVERNED_REVISION" ? (
                <span className="text-xs text-[var(--muted)]">
                  {tc("建立版本後可匯出")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ui-button ui-button-secondary ui-button-small"
                onClick={() => onEdit(row)}
              >
                {tc("查看／修改")}
              </button>
              <MoreMenu
                historyEnabled={historyEnabled}
                onReport={() => onReport(row)}
                onHistory={() => onHistory(row)}
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
