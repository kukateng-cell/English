"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { CATALOG_CATEGORIES } from "@/lib/catalog/taxonomy";
import {
  catalogCategoryLabel,
  catalogPartOfSpeechLabel,
} from "@/lib/catalog/teacher-presentation";
import { useCatalogMediaQuery } from "./useCatalogMediaQuery";

export type CatalogClientFilters = {
  lifecycle: string;
  workflow: string;
  level: string;
  direction: string;
  partOfSpeech: string;
  initial: string;
  category: string;
  readiness: string;
  issues: string;
  sort: string;
};

export const DEFAULT_CATALOG_FILTERS: CatalogClientFilters = {
  lifecycle: "ALL",
  workflow: "ALL",
  level: "ALL",
  direction: "ALL",
  partOfSpeech: "ALL",
  initial: "ALL",
  category: "ALL",
  readiness: "ALL",
  issues: "ALL",
  sort: "TERM_ASC",
};

type Facet = { value: string; count: number };

const FILTER_LABELS: Record<
  keyof CatalogClientFilters,
  Record<string, string>
> = {
  lifecycle: {
    ACTIVE: "已啟用",
    DRAFT: "草稿（未供學生使用）",
    RETIRED: "已停用",
  },
  workflow: { PENDING: "有修改等待審核", NONE: "無待審修改" },
  level: { A1: "A1", A2: "A2", B1: "B1", B2: "B2" },
  direction: { EN_ZH: "英譯中可用", ZH_EN: "中譯英可用" },
  partOfSpeech: {},
  initial: { OTHER: "其他首字母" },
  category: {},
  readiness: {
    BOTH: "兩種題型可用",
    EN_TO_ZH_ONLY: "只可英譯中",
    ZH_TO_EN_ONLY: "只可中譯英",
    UNAVAILABLE: "暫不可出題",
  },
  issues: {
    CURRENT_CONTENT: "目前正式版本需修正",
    PENDING_DRAFT: "待審版本需修正",
    IMPORT_DRAFT: "匯入草稿需修正",
    NONE: "沒有內容問題",
  },
  sort: {
    TERM_ASC: "A–Z",
    TERM_DESC: "Z–A",
    UPDATED_DESC: "最近修改",
    LEVEL_ASC: "程度 A1→B2",
    ACTION_REQUIRED_FIRST: "需要處理優先",
  },
};

function optionLabel(key: keyof CatalogClientFilters, value: string): string {
  if (key === "partOfSpeech")
    return catalogPartOfSpeechLabel(value === "UNCLASSIFIED" ? "" : value);
  if (key === "category")
    return catalogCategoryLabel(value === "UNCLASSIFIED" ? "" : value);
  if (key === "initial" && /^[A-Z]$/u.test(value)) return value;
  return FILTER_LABELS[key][value] ?? value;
}

function FilterSelect({
  label,
  filterKey,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  filterKey: keyof CatalogClientFilters;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  allLabel: string;
}) {
  const { tc } = useLocale();
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-[var(--muted)]">
      {tc(label)}
      <select
        className="h-11 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="ALL">{tc(allLabel)}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {tc(optionLabel(filterKey, option))}
          </option>
        ))}
      </select>
    </label>
  );
}

function AllFilters({
  filters,
  facets,
  setFilter,
}: {
  filters: CatalogClientFilters;
  facets: { partOfSpeech: Facet[]; category: Facet[] };
  setFilter: (key: keyof CatalogClientFilters, value: string) => void;
}) {
  return (
    <>
      <FilterSelect
        label="生命週期"
        filterKey="lifecycle"
        value={filters.lifecycle}
        options={["ACTIVE", "DRAFT", "RETIRED"]}
        onChange={(value) => setFilter("lifecycle", value)}
        allLabel="全部生命週期"
      />
      <FilterSelect
        label="工作流程"
        filterKey="workflow"
        value={filters.workflow}
        options={["PENDING", "NONE"]}
        onChange={(value) => setFilter("workflow", value)}
        allLabel="全部工作流程"
      />
      <FilterSelect
        label="程度"
        filterKey="level"
        value={filters.level}
        options={["A1", "A2", "B1", "B2"]}
        onChange={(value) => setFilter("level", value)}
        allLabel="全部程度"
      />
      <FilterSelect
        label="出題方向"
        filterKey="direction"
        value={filters.direction}
        options={["EN_ZH", "ZH_EN"]}
        onChange={(value) => setFilter("direction", value)}
        allLabel="全部方向"
      />
      <FilterSelect
        label="詞性"
        filterKey="partOfSpeech"
        value={filters.partOfSpeech}
        options={facets.partOfSpeech.map((item) => item.value)}
        onChange={(value) => setFilter("partOfSpeech", value)}
        allLabel="全部詞性"
      />
      <FilterSelect
        label="首字母"
        filterKey="initial"
        value={filters.initial}
        options={[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "OTHER"]}
        onChange={(value) => setFilter("initial", value)}
        allLabel="全部首字母"
      />
      <FilterSelect
        label="主題"
        filterKey="category"
        value={filters.category}
        options={
          facets.category.length
            ? facets.category.map((item) => item.value)
            : [...CATALOG_CATEGORIES]
        }
        onChange={(value) => setFilter("category", value)}
        allLabel="全部主題"
      />
      <FilterSelect
        label="出題狀態"
        filterKey="readiness"
        value={filters.readiness}
        options={["BOTH", "EN_TO_ZH_ONLY", "ZH_TO_EN_ONLY", "UNAVAILABLE"]}
        onChange={(value) => setFilter("readiness", value)}
        allLabel="全部出題狀態"
      />
      <FilterSelect
        label="內容問題"
        filterKey="issues"
        value={filters.issues}
        options={["CURRENT_CONTENT", "PENDING_DRAFT", "IMPORT_DRAFT", "NONE"]}
        onChange={(value) => setFilter("issues", value)}
        allLabel="全部內容問題"
      />
    </>
  );
}

export default function CatalogWorkspaceToolbar({
  searchInput,
  onSearchInput,
  filters,
  onFilters,
  facets,
}: {
  searchInput: string;
  onSearchInput: (value: string) => void;
  filters: CatalogClientFilters;
  onFilters: (value: CatalogClientFilters) => void;
  facets: { partOfSpeech: Facet[]; category: Facet[] };
}) {
  const { tc } = useLocale();
  // The admin sidebar leaves less usable width than the viewport suggests;
  // keep the compact sheet through tablet widths.
  const desktop = useCatalogMediaQuery("(min-width: 1100px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLElement | null>(null);
  const setFilter = (key: keyof CatalogClientFilters, value: string) =>
    onFilters({ ...filters, [key]: value });
  const activeFilters = (
    Object.keys(filters) as Array<keyof CatalogClientFilters>
  ).filter(
    (key) => key !== "sort" && filters[key] !== DEFAULT_CATALOG_FILTERS[key],
  );

  useEffect(() => {
    if (!sheetOpen) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const timer = window.setTimeout(() => sheetRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          "button, input, select, [href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
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
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [sheetOpen]);

  return (
    <section
      aria-label={tc("詞庫篩選及排序") as string}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4"
    >
      {desktop ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_150px_170px_170px_auto]">
          <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
            {tc("搜尋詞條或釋義")}
            <input
              className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
              value={searchInput}
              onChange={(event) => onSearchInput(event.target.value)}
            />
          </label>
          <FilterSelect
            label="生命週期"
            filterKey="lifecycle"
            value={filters.lifecycle}
            options={["ACTIVE", "DRAFT", "RETIRED"]}
            onChange={(value) => setFilter("lifecycle", value)}
            allLabel="全部生命週期"
          />
          <FilterSelect
            label="程度"
            filterKey="level"
            value={filters.level}
            options={["A1", "A2", "B1", "B2"]}
            onChange={(value) => setFilter("level", value)}
            allLabel="全部程度"
          />
          <FilterSelect
            label="排序"
            filterKey="sort"
            value={filters.sort}
            options={[
              "TERM_ASC",
              "TERM_DESC",
              "UPDATED_DESC",
              "LEVEL_ASC",
              "ACTION_REQUIRED_FIRST",
            ]}
            onChange={(value) => setFilter("sort", value)}
            allLabel="A–Z"
          />
          <details className="relative self-end">
            <summary className="ui-button ui-button-secondary flex h-11 cursor-pointer list-none items-center">
              {tc("更多篩選")}
              {activeFilters.length ? ` (${activeFilters.length})` : ""}
            </summary>
            <div className="absolute right-0 z-30 mt-2 grid w-[min(720px,calc(100vw-3rem))] gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:grid-cols-2 lg:grid-cols-3">
              <AllFilters
                filters={filters}
                facets={facets}
                setFilter={setFilter}
              />
            </div>
          </details>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
            {tc("搜尋詞條或釋義")}
            <input
              className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
              value={searchInput}
              onChange={(event) => onSearchInput(event.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect
              label="排序"
              filterKey="sort"
              value={filters.sort}
              options={[
                "TERM_ASC",
                "TERM_DESC",
                "UPDATED_DESC",
                "LEVEL_ASC",
                "ACTION_REQUIRED_FIRST",
              ]}
              onChange={(value) => setFilter("sort", value)}
              allLabel="A–Z"
            />
            <button
              type="button"
              className="ui-button ui-button-secondary self-end"
              onClick={() => setSheetOpen(true)}
            >
              {tc("篩選")}
              {activeFilters.length ? ` (${activeFilters.length})` : ""}
            </button>
          </div>
        </div>
      )}
      {activeFilters.length ? (
        <div
          className="mt-3 flex flex-wrap gap-2"
          aria-label={tc("已套用篩選") as string}
        >
          {activeFilters.map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-full border border-[var(--border)] bg-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text)]"
              onClick={() => setFilter(key, DEFAULT_CATALOG_FILTERS[key])}
            >
              {tc(optionLabel(key, filters[key]))}{" "}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            type="button"
            className="text-xs font-semibold text-[var(--primary)]"
            onClick={() =>
              onFilters({ ...DEFAULT_CATALOG_FILTERS, sort: filters.sort })
            }
          >
            {tc("清除全部篩選")}
          </button>
        </div>
      ) : null}
      {sheetOpen && !desktop ? (
        <div
          className="fixed inset-0 z-[65] bg-black/35"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalog-filter-sheet-title"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label={tc("關閉篩選") as string}
            onClick={() => setSheetOpen(false)}
          />
          <section
            ref={sheetRef}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="catalog-filter-sheet-title"
                className="text-lg font-bold text-[var(--text)]"
              >
                {tc("篩選詞庫")}
              </h2>
              <button
                type="button"
                className="ui-button ui-button-quiet ui-button-small"
                onClick={() => setSheetOpen(false)}
                aria-label={tc("關閉") as string}
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <AllFilters
                filters={filters}
                facets={facets}
                setFilter={setFilter}
              />
            </div>
            <button
              type="button"
              className="ui-button ui-button-primary mt-5 w-full"
              onClick={() => setSheetOpen(false)}
            >
              {tc("查看結果")}
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
