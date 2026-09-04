"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import {
  catalogExportAvailability,
  hasCatalogExportTarget,
} from "@/lib/catalog/workspace-selection";
import {
  catalogCategoryLabel,
  catalogExportAvailabilityPresentation,
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

function lifecycleTone(row: CatalogDisplayRow): string {
  if (row.contentScope === "IMPORT_DRAFT")
    return "bg-[var(--warning-bg)] text-[var(--warning)]";
  if (row.status === "ACTIVE")
    return "bg-[var(--success-bg)] text-[var(--success)]";
  if (row.status === "RETIRED") return "bg-[var(--danger-bg)] text-[var(--danger)]";
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
        ? "尚未提交的匯入資料"
        : "目前正式版本";
  const issues = row.structuredIssues.filter(
    (issue) => issue.severity === "ERROR",
  );
  const explanation =
    row.contentScope === "PENDING_DRAFT" && row.lifecycleState === "ACTIVE"
      ? "目前正式版本仍可正常使用；待審版本尚待教師補充。"
      : row.contentScope === "PENDING_DRAFT"
        ? "待審版本尚待教師補充，批准前不會取代正式內容。"
        : row.contentScope === "IMPORT_DRAFT"
          ? "此項尚未提交建立詞義。請查看下方具體問題，修正後提交新詞義並送交審核。"
          : "目前正式版本需要修正，請按以下提示處理。";
  return (
    <details className="mt-1 text-xs text-[var(--danger)]">
      <summary className="cursor-pointer font-semibold">
        {tc(scope)}
        {tc("有")} {row.issueCount} {tc("項內容需修正")}
      </summary>
      <div className="mt-2 space-y-2 rounded-xl bg-[var(--danger-bg)] p-3">
        <p>{tc(explanation)}</p>
        {issues.map((issue, index) => {
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

function ExportUnavailableHint({ row }: { row: CatalogDisplayRow }) {
  const { tc } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const presentation = catalogExportAvailabilityPresentation(
    catalogExportAvailability(row),
    Boolean(row.pendingRequest),
  );
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  if (!presentation) return null;
  return (
    <div
      ref={rootRef}
      className="relative w-fit text-[10px] leading-4 text-[var(--muted)]"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="cursor-pointer font-semibold underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        onClick={() => setOpen((value) => !value)}
      >
        {tc(presentation.shortLabel)}
      </button>
      {open ? (
        <p
          id={panelId}
          role="note"
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-xs font-normal leading-5 text-[var(--text)] shadow-xl"
        >
          {tc(presentation.reason)}
        </p>
      ) : null}
    </div>
  );
}

function ExportSelectionControl({
  row,
  checked,
  onToggle,
  showSelectionLabel = false,
}: {
  row: CatalogDisplayRow;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  showSelectionLabel?: boolean;
}) {
  const { tc } = useLocale();
  if (!hasCatalogExportTarget(row) || row.pendingRequest) {
    const presentation = catalogExportAvailabilityPresentation(
      catalogExportAvailability(row),
      Boolean(row.pendingRequest),
    );
    return (
      <div className="flex items-start gap-2">
        <input
          aria-label={`${tc("不可匯出此詞條")}：${row.term}。${presentation ? tc(presentation.reason) : ""}`}
          type="checkbox"
          disabled
        />
        <ExportUnavailableHint row={row} />
      </div>
    );
  }
  const checkbox = (
    <input
      aria-label={`${tc("選取要匯出的詞條")}：${row.term}`}
      type="checkbox"
      checked={checked}
      onChange={(event) => onToggle(event.target.checked)}
    />
  );
  return showSelectionLabel ? (
    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
      {checkbox}
      {tc("選取要匯出的詞條")}
    </label>
  ) : checkbox;
}

function MoreMenu({
  onReport,
  onHistory,
  historyEnabled,
  rowLabel,
}: {
  onReport: () => void;
  onHistory: () => void;
  historyEnabled: boolean;
  rowLabel: string;
}) {
  const { tc } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role='menuitem']:not(:disabled)",
        ) ?? [],
      );
    const timer = window.setTimeout(() => {
      const available = items();
      (initialFocusRef.current === "last"
        ? available.at(-1)
        : available[0]
      )?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
        return;
      const available = items();
      if (!available.length) return;
      event.preventDefault();
      const current = available.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? available.length - 1
            : event.key === "ArrowUp"
              ? (current - 1 + available.length) % available.length
              : (current + 1) % available.length;
      available[next]?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.clearTimeout(timer);
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
        aria-label={`${tc("更多操作")}：${rowLabel}`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialFocusRef.current =
            event.key === "ArrowUp" ? "last" : "first";
          setOpen(true);
        }}
        onClick={() => {
          initialFocusRef.current = "first";
          setOpen((value) => !value);
        }}
      >
        {tc("更多操作")}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 min-w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          <button
            role="menuitem"
            aria-label={`${tc("報告問題")}：${rowLabel}`}
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
              aria-label={`${tc("查看歷史")}：${rowLabel}`}
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
    row.contentScope === "IMPORT_DRAFT"
      ? tc("匯入資料")
      : tc(catalogLifecycleLabel(row.lifecycleState));
  const workflow = (row: CatalogDisplayRow) =>
    row.contentScope === "IMPORT_DRAFT"
      ? tc("尚未提交建立詞義")
      : tc(catalogWorkflowLabel(row.workflowState));
  const readiness = (row: CatalogDisplayRow) =>
    tc(catalogReadinessLabel(row.readinessState));
  if (desktop)
    return (
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1000px] table-fixed border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--border-soft)] text-xs text-[var(--muted)]">
            <tr>
              {bulkEnabled ? (
                <th scope="col" className="w-24 px-3 py-3">
                  <span className="block">{tc("匯出")}</span>
                  <span className="mt-0.5 block text-[10px] font-normal">
                    {tc("選取／原因")}
                  </span>
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
                    <ExportSelectionControl
                      row={row}
                      checked={Boolean(
                        row.senseKey && selectedSenseKeys.has(row.senseKey),
                      )}
                      onToggle={(checked) => {
                        if (row.senseKey) onToggleSelection(row.senseKey, checked);
                      }}
                    />
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
                    className={`inline-flex rounded-full px-2 py-1 font-semibold ${lifecycleTone(row)}`}
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
                      className="min-h-11 whitespace-nowrap rounded-lg border border-[var(--border)] px-2 text-xs font-semibold text-[var(--text)]"
                      onClick={() => onEdit(row)}
                    >
                      {tc("查看／修改")}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[var(--primary)]"
                      onClick={() => onReport(row)}
                    >
                      {tc("報告問題")}
                    </button>
                    {historyEnabled ? (
                      <button
                        type="button"
                        className="min-h-11 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-[var(--primary)]"
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
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${lifecycleTone(row)}`}
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
              {bulkEnabled ? (
                <ExportSelectionControl
                  row={row}
                  checked={Boolean(
                    row.senseKey && selectedSenseKeys.has(row.senseKey),
                  )}
                  onToggle={(checked) => {
                    if (row.senseKey) onToggleSelection(row.senseKey, checked);
                  }}
                  showSelectionLabel
                />
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
                rowLabel={`${row.term} · ${row.definitionZh}`}
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
