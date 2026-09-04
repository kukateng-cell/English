"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { catalogValidationResponseErrorMessage } from "@/lib/catalog/client-validation";
import {
  CATALOG_CATEGORIES,
  CATALOG_PARTS_OF_SPEECH,
} from "@/lib/catalog/taxonomy";
import {
  CATALOG_STRUCTURED_ISSUE_VERSION,
  CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
} from "@/lib/catalog/validation-issue-contract";
import CatalogBulkSubmissionWorkspace from "@/components/catalog/CatalogBulkSubmissionWorkspace";
import CatalogHistoryWorkspace from "@/components/catalog/CatalogHistoryWorkspace";
import CatalogQuestionPreviewComponent from "@/components/catalog/CatalogQuestionPreview";
import CatalogFeedbackDialog, {
  type CatalogFeedbackTarget,
} from "@/components/catalog/CatalogFeedbackDialog";
import CatalogWorkItemsWorkspace from "@/components/catalog/CatalogWorkItemsWorkspace";
import CatalogSenseHistoryDrawer from "@/components/catalog/CatalogSenseHistoryDrawer";
import CatalogWorkspaceResults from "@/components/catalog/CatalogWorkspaceResults";
import CatalogWorkspaceToolbar, {
  DEFAULT_CATALOG_FILTERS,
  type CatalogClientFilters,
} from "@/components/catalog/CatalogWorkspaceToolbar";
import {
  catalogRetryPayloadPatch,
  type CatalogRetryConflictChoice,
  type CatalogRetryMergeConflict,
} from "@/lib/catalog/retry-merge";
import {
  clientOperationFingerprint,
  pendingClientOperation,
  type PendingClientOperation,
} from "@/lib/catalog/client-operation";
import {
  catalogLifecycleLabel,
  catalogCategoryLabel,
  catalogIssueEvidence,
  catalogIssueEvidenceLocationLabel,
  catalogIssuePresentation,
  catalogPartOfSpeechLabel,
  catalogRequestKindLabel,
  catalogSourceSummary,
  type CatalogIssueEvidenceLocation,
  type CatalogStructuredIssue,
} from "@/lib/catalog/teacher-presentation";

type CatalogStatus = "DRAFT" | "ACTIVE" | "RETIRED";
type RestrictedPendingRequest = {
  restricted: true;
  kind: string;
  status: string;
};
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
  sourceReference: string | null;
  contributorRef: string | null;
  changeNote: string | null;
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
  lifecycleState: CatalogStatus;
  workflowState: "NONE" | "PENDING";
  readinessState: "BOTH" | "EN_TO_ZH_ONLY" | "ZH_TO_EN_ONLY" | "UNAVAILABLE";
  contentScope: "CURRENT_CONTENT" | "PENDING_DRAFT" | "IMPORT_DRAFT";
  issueCount: number;
  structuredIssues: Array<{
    code: string;
    field: string | null;
    direction: "EN_TO_ZH" | "ZH_TO_EN" | null;
    severity: "ERROR" | "WARNING";
  }>;
  currentRevisionNumber: number | null;
  lastChangedAt: string;
  revision: number | null;
  latestRevision: number | null;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  pendingRequest:
    | RestrictedPendingRequest
    | {
        restricted?: false;
        id: string;
        kind: string;
        status: string;
        proposerId: string;
        baseRevision: number | null;
        createdAt: string;
      }
    | null;
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
  structuredIssueVersion: string;
  structuredIssues: CatalogStructuredIssue[];
  payload: CatalogPayload | null;
  pendingRequest:
    | RestrictedPendingRequest
    | {
        restricted?: false;
        id: string;
        kind: string;
        status: string;
        revision: number;
        payload: CatalogPayload;
        reason: string | null;
        proposerId: string;
        createdAt: string;
      }
    | null;
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
  sense: {
    senseKey: string;
    term: string;
    level: string;
    category: string;
  } | null;
  sourceImportRow: {
    id: string;
    sourceFile: string;
    sourceRow: number;
    senseKey: string | null;
    catalogKey: string | null;
    primaryDisposition: string;
    eligibilityResult: string | null;
    issues: unknown;
  } | null;
  proposer: { legalName: string; accountName: string };
};
type PendingResponse = {
  requests: PendingRequest[];
  hasMore: boolean;
  signature: string;
  mutationRevision: number;
};
type CatalogListResponse = {
  rows: CatalogRow[];
  structuredIssueVersion: string;
  counts: Record<string, number>;
  filteredTotal: number;
  facets: {
    partOfSpeech: Array<{ value: string; count: number }>;
    category: Array<{ value: string; count: number }>;
  };
  nextCursor: string | null;
  canReview: boolean;
  mutationRevision: number;
  workspaceSignature: string;
};
type CatalogWorkspaceAccess = {
  canReview: boolean;
  actorUserId: string;
  bulkEnabled: boolean;
  historyEnabled: boolean;
};
type ReviewMutationResult = {
  replay: boolean;
  request: { status: string };
};
type ReviewActionNotice = {
  requestId: string;
  term: string;
  type: "success" | "error";
  message: string;
};
type CatalogPrecheckMatch = {
  kind: "SENSE" | "IMPORT_DRAFT" | "PENDING_CREATE";
  senseKey: string | null;
  term: string;
  definitionZh: string;
  partOfSpeech: string;
  level: string;
  status: string;
};
type CatalogPrecheckResponse = {
  normalizedTerm: string;
  matches: CatalogPrecheckMatch[];
  exactConflict: "EXISTING" | "PENDING" | null;
};

function CatalogQuestionPreview({
  payload,
  senseKey,
}: {
  payload: CatalogPayload;
  senseKey: string;
}) {
  const identity = clientOperationFingerprint({ senseKey, payload });
  return (
    <CatalogQuestionPreviewComponent
      key={identity}
      payload={payload}
      senseKey={senseKey}
    />
  );
}
type RetrySource = {
  id: string;
  kind: "UPDATE" | "CREATE" | "RETIRE" | "REACTIVATE";
  sourceRowId: string | null;
  reviewNote: string | null;
  mergeBaseline: CatalogPayload;
  conflicts: CatalogRetryMergeConflict[];
  choices: Partial<Record<keyof CatalogPayload, CatalogRetryConflictChoice>>;
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
  sourceReference: null,
  contributorRef: null,
  changeNote: null,
  retirementReason: null,
};

function normalizeCatalogClientText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function parseList(value: string) {
  return value
    .split("|")
    .map((item) => item.normalize("NFKC").trim())
    .filter(Boolean);
}

function listText(value: readonly string[] | null | undefined) {
  return (value ?? []).join(" | ");
}

function retryConflictValueText(
  value: unknown,
  tc: (value: string) => string,
): string {
  if (value === null || value === undefined || value === "")
    return tc("（空白）");
  if (Array.isArray(value))
    return value.length ? value.join(" | ") : tc("（空白）");
  if (typeof value === "boolean") return value ? tc("啟用") : tc("停用");
  return String(value);
}

function visiblePendingRequestId(
  value: Detail["pendingRequest"],
): string | null {
  return value && "id" in value ? value.id : null;
}

function visiblePendingRequestPayload(
  value: Detail["pendingRequest"],
): CatalogPayload | null {
  return value && "payload" in value ? value.payload : null;
}

function normalizeCatalogPayload(
  value: unknown,
  fallback: CatalogPayload = EMPTY_PAYLOAD,
): CatalogPayload {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: keyof CatalogPayload) =>
    typeof source[key] === "string"
      ? (source[key] as string)
      : (fallback[key] as string);
  const nullableText = (
    key:
      | "phoneticIpa"
      | "exampleEn"
      | "exampleZh"
      | "sourceReference"
      | "contributorRef"
      | "changeNote"
      | "retirementReason",
  ) => {
    const item = source[key];
    return typeof item === "string"
      ? item
      : item === null
        ? null
        : fallback[key];
  };
  const list = (
    key:
      | "acceptedAnswersZh"
      | "acceptedFormsEn"
      | "synonymsEn"
      | "antonymsEn"
      | "distractorZh"
      | "distractorEn",
  ) => {
    const item = source[key];
    return Array.isArray(item)
      ? item.filter((entry): entry is string => typeof entry === "string")
      : [...fallback[key]];
  };
  const level =
    source.level === "A1" ||
    source.level === "A2" ||
    source.level === "B1" ||
    source.level === "B2"
      ? source.level
      : fallback.level;
  return {
    term: text("term"),
    lemma: text("lemma"),
    partOfSpeech: text("partOfSpeech"),
    level,
    category: text("category"),
    definitionZh: text("definitionZh"),
    acceptedAnswersZh: list("acceptedAnswersZh"),
    phoneticIpa: nullableText("phoneticIpa"),
    exampleEn: nullableText("exampleEn"),
    exampleZh: nullableText("exampleZh"),
    acceptedFormsEn: list("acceptedFormsEn"),
    synonymsEn: list("synonymsEn"),
    antonymsEn: list("antonymsEn"),
    enableEnToZh:
      typeof source.enableEnToZh === "boolean"
        ? source.enableEnToZh
        : fallback.enableEnToZh,
    distractorZh: list("distractorZh"),
    enableZhToEn:
      typeof source.enableZhToEn === "boolean"
        ? source.enableZhToEn
        : fallback.enableZhToEn,
    distractorEn: list("distractorEn"),
    sourceReference: nullableText("sourceReference"),
    contributorRef: nullableText("contributorRef"),
    changeNote: nullableText("changeNote"),
    retirementReason: nullableText("retirementReason"),
  };
}

function normalizeDetailStructuredIssues(
  version: unknown,
  value: unknown,
): CatalogStructuredIssue[] {
  if (version !== CATALOG_STRUCTURED_ISSUE_VERSION) {
    return [{
      code: CATALOG_UNSUPPORTED_STRUCTURED_ISSUE_CODE,
      field: null,
      direction: null,
      severity: "ERROR",
    }];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const issue = item as Record<string, unknown>;
    if (typeof issue.code !== "string") return [];
    return [{
      code: issue.code,
      field: typeof issue.field === "string" ? issue.field : null,
      direction:
        issue.direction === "EN_TO_ZH" || issue.direction === "ZH_TO_EN"
          ? issue.direction
          : null,
      severity: issue.severity === "WARNING" ? "WARNING" : "ERROR",
    }];
  });
}

function CatalogIssueGuidance({
  issues,
  payload,
  onLocate,
}: {
  issues: CatalogStructuredIssue[];
  payload: CatalogPayload;
  onLocate: (location: CatalogIssueEvidenceLocation) => void;
}) {
  const { tc } = useLocale();
  const errors = issues.filter((issue) => issue.severity === "ERROR");
  if (!errors.length) return null;
  return (
    <section
      data-testid="catalog-detail-issue-guidance"
      aria-labelledby="catalog-detail-issue-title"
      className="mt-4 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]"
    >
      <h3 id="catalog-detail-issue-title" className="font-bold">
        {tc(`提交前要修正以下 ${errors.length} 項內容`)}
      </h3>
      <p className="mt-1 text-xs leading-5">
        {tc("以下是匯入或上次檢查時發現的問題。修改後提交，系統會按照最新內容重新檢查。")}
      </p>
      <ol className="mt-3 space-y-3">
        {errors.map((issue, index) => {
          const copy = catalogIssuePresentation(issue);
          const evidence = catalogIssueEvidence(issue, payload);
          return (
            <li
              key={`${issue.code}:${issue.field ?? "content"}:${index}`}
              className="rounded-xl border border-[var(--danger)]/30 bg-[var(--surface)] p-3 text-[var(--text)]"
            >
              <p className="font-bold text-[var(--danger)]">
                {index + 1}. {copy.directionLabel ? `${tc(copy.directionLabel)} · ` : ""}
                {tc(copy.fieldLabel)}
              </p>
              <p className="mt-1">{tc(copy.reason)}</p>
              {evidence ? (
                <div className="mt-2 rounded-lg bg-[var(--danger-bg)] p-2 text-[var(--danger)]">
                  <p className="font-bold">{tc(evidence.summary)}</p>
                  {evidence.locations.length ? (
                    <>
                      <p className="mt-1 text-xs font-semibold">
                        {tc("同時出現在以下位置：")}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {evidence.locations.map((location) => (
                          <li
                            key={`${location.field}:${location.index ?? "scalar"}:${location.value}`}
                          >
                            <button
                              type="button"
                              className="text-left font-semibold underline underline-offset-2"
                              onClick={() => onLocate(location)}
                            >
                              {tc(catalogIssueEvidenceLocationLabel(location))}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-1 text-[var(--muted)]">{tc(copy.fix)}</p>
              {issue.field && !evidence?.locations.length ? (
                <button
                  type="button"
                  className="mt-2 font-semibold text-[var(--primary)] underline underline-offset-2"
                  onClick={() => onLocate({
                    field: issue.field!,
                    index: null,
                    value: "",
                  })}
                >
                  {tc("前往需要修正的欄位")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CatalogIssueLocationNote({ values }: { values: string[] }) {
  const { tc } = useLocale();
  if (!values.length) return null;
  return (
    <small className="font-semibold text-[var(--danger)]">
      {tc("需要處理的項目")}：{values.join("、")}
    </small>
  );
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function focusCatalogHistoryTrigger(
  rowId: string,
  historyLabel: string,
): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(
    `[data-catalog-row="${CSS.escape(rowId)}"]`,
  );
  const compactTrigger = row?.querySelector<HTMLButtonElement>(
    "[data-catalog-history-trigger]",
  );
  const desktopTrigger = Array.from(
    row?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  ).find((button) => button.textContent?.includes(historyLabel));
  const target = compactTrigger ?? desktopTrigger ?? row;
  target?.focus({ preventScroll: true });
  return row ?? null;
}

function scheduleCatalogViewRestore(input: {
  rowId: string;
  scrollY: number;
  historyLabel: string;
  onRestored: () => void;
  onMissing: () => void;
}): () => void {
  let cancelled = false;
  let timer: number | null = null;
  let attempts = 0;
  const restore = () => {
    if (cancelled) return;
    window.scrollTo({ top: input.scrollY });
    const row = focusCatalogHistoryTrigger(input.rowId, input.historyLabel);
    if (row) {
      row.classList.add("ring-2", "ring-[var(--primary)]");
      window.setTimeout(
        () => row.classList.remove("ring-2", "ring-[var(--primary)]"),
        1600,
      );
      input.onRestored();
      return;
    }
    attempts += 1;
    if (attempts >= 20) {
      input.onMissing();
      return;
    }
    timer = window.setTimeout(restore, 50);
  };
  timer = window.setTimeout(restore, 0);
  return () => {
    cancelled = true;
    if (timer !== null) window.clearTimeout(timer);
  };
}

type CatalogPersistedState = {
  initialized: boolean;
  rows: CatalogRow[];
  counts: Record<string, number>;
  facets: CatalogListResponse["facets"];
  filters: CatalogClientFilters;
  searchInput: string;
  search: string;
  selectedSenseKeys: string[];
  filteredTotal: number;
  nextCursor: string | null;
  workspaceSignature: string;
  scrollY: number;
  activeRowId: string | null;
};

const INITIAL_CATALOG_PERSISTED_STATE: CatalogPersistedState = {
  initialized: false,
  rows: [],
  counts: {},
  facets: { partOfSpeech: [], category: [] },
  filters: DEFAULT_CATALOG_FILTERS,
  searchInput: "",
  search: "",
  selectedSenseKeys: [],
  filteredTotal: 0,
  nextCursor: null,
  workspaceSignature: "",
  scrollY: 0,
  activeRowId: null,
};

type CatalogPersistedAction =
  | { type: "SAVE"; state: CatalogPersistedState }
  | { type: "RESET" };

function catalogPersistedReducer(
  _state: CatalogPersistedState,
  action: CatalogPersistedAction,
): CatalogPersistedState {
  return action.type === "RESET"
    ? INITIAL_CATALOG_PERSISTED_STATE
    : action.state;
}

function CatalogOverviewWorkspace({
  bulkEnabled,
  historyEnabled,
  onReviewActionNotice,
  onOpenHistory,
  initialRetryRequestId,
  onRetryConsumed,
  initialSenseKey,
  onInitialSenseConsumed,
  persistedState,
  onPersistedState,
}: {
  bulkEnabled: boolean;
  historyEnabled: boolean;
  onReviewActionNotice: (notice: ReviewActionNotice | null) => void;
  onOpenHistory: (senseKey: string) => void;
  initialRetryRequestId: string | null;
  onRetryConsumed: () => void;
  initialSenseKey: string | null;
  onInitialSenseConsumed: () => void;
  persistedState: CatalogPersistedState;
  onPersistedState: (state: CatalogPersistedState) => void;
}) {
  const { tc } = useLocale();
  const [rows, setRows] = useState<CatalogRow[]>(persistedState.rows);
  const [counts, setCounts] = useState<Record<string, number>>(
    persistedState.counts,
  );
  const [canReview, setCanReview] = useState(false);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [filters, setFilters] = useState<CatalogClientFilters>(
    persistedState.filters,
  );
  const [facets, setFacets] = useState<CatalogListResponse["facets"]>(
    persistedState.facets,
  );
  const [searchInput, setSearchInput] = useState(persistedState.searchInput);
  const [search, setSearch] = useState(persistedState.search);
  const [exportSenseKeys, setExportSenseKeys] = useState<Set<string>>(
    new Set(persistedState.selectedSenseKeys),
  );
  const [exportFormat, setExportFormat] = useState<"XLSX" | "CSV">("XLSX");
  const [filteredTotal, setFilteredTotal] = useState(
    persistedState.filteredTotal,
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    persistedState.nextCursor,
  );
  const [loading, setLoading] = useState(!persistedState.initialized);
  const [catalogInitialized, setCatalogInitialized] = useState(
    persistedState.initialized,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelectedState] = useState<Detail | null>(null);
  const [form, setForm] = useState<CatalogPayload>(EMPTY_PAYLOAD);
  const [reason, setReason] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [createStep, setCreateStep] = useState<"TERM" | "FORM" | null>(null);
  const [createTerm, setCreateTerm] = useState("");
  const [createPrecheck, setCreatePrecheck] =
    useState<CatalogPrecheckResponse | null>(null);
  const [createPrecheckLoading, setCreatePrecheckLoading] = useState(false);
  const [createPrecheckError, setCreatePrecheckError] = useState<string | null>(
    null,
  );
  const [createPrecheckRetryNonce, setCreatePrecheckRetryNonce] = useState(0);
  const [createExactConflict, setCreateExactConflict] = useState<
    "EXISTING" | "PENDING" | null
  >(null);
  const [createExactPrecheckLoading, setCreateExactPrecheckLoading] =
    useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [feedbackTarget, setFeedbackTarget] =
    useState<CatalogFeedbackTarget | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{
    senseKey: string;
    term: string;
    rowId: string;
    scrollY: number;
  } | null>(null);
  const [retrySource, setRetrySource] = useState<RetrySource | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogErrorRef = useRef<HTMLDivElement | null>(null);
  const createTermInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSignatureRef = useRef("");
  const pendingRefreshInFlightRef = useRef(false);
  const pendingBackoffUntilRef = useRef(0);
  const catalogLoadGenerationRef = useRef(0);
  const catalogLoadAbortRef = useRef<AbortController | null>(null);
  const catalogForegroundInFlightRef = useRef(false);
  const catalogLoadMoreGenerationRef = useRef(0);
  const catalogLoadMoreAbortRef = useRef<AbortController | null>(null);
  const catalogWorkspaceSignatureRef = useRef(
    persistedState.workspaceSignature,
  );
  const catalogQueryKeyRef = useRef("");
  const selectedPendingRequestIdRef = useRef<string | null>(null);
  const submitOperationRef = useRef<PendingClientOperation | null>(null);
  const formBaselineRef = useRef<CatalogPayload>(EMPTY_PAYLOAD);
  const dialogIntentRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  const createPrecheckAbortRef = useRef<AbortController | null>(null);
  const createPrecheckGenerationRef = useRef(0);
  const initialBackgroundRefreshRef = useRef(persistedState.initialized);
  const persistedSnapshotRef = useRef(persistedState);

  const loadFormForDialog = useCallback((payload: CatalogPayload) => {
    formBaselineRef.current = payload;
    setForm(payload);
  }, []);

  const beginDialogIntent = useCallback(() => {
    const intent = ++dialogIntentRef.current;
    createPrecheckGenerationRef.current += 1;
    detailAbortRef.current?.abort();
    retryAbortRef.current?.abort();
    createPrecheckAbortRef.current?.abort();
    detailAbortRef.current = null;
    retryAbortRef.current = null;
    createPrecheckAbortRef.current = null;
    return intent;
  }, []);

  const setSelected = useCallback(
    (value: Detail | null | ((current: Detail | null) => Detail | null)) => {
      beginDialogIntent();
      setSelectedState(value);
    },
    [beginDialogIntent],
  );

  const isCurrentDialogIntent = useCallback(
    (intent: number) => intent === dialogIntentRef.current,
    [],
  );

  const closeDetailDialog = useCallback(() => {
    createPrecheckGenerationRef.current += 1;
    createPrecheckAbortRef.current?.abort();
    createPrecheckAbortRef.current = null;
    setSelected(null);
    setRetrySource(null);
    setCreateStep(null);
    setCreatePrecheck(null);
    setCreateExactConflict(null);
    setCreateExactPrecheckLoading(false);
    setError(null);
    submitOperationRef.current = null;
  }, [setSelected]);

  useEffect(
    () => () => {
      beginDialogIntent();
    },
    [beginDialogIntent],
  );

  const catalogQueryKey = useMemo(
    () => JSON.stringify({ search, filters }),
    [filters, search],
  );
  useEffect(() => {
    catalogQueryKeyRef.current = catalogQueryKey;
  }, [catalogQueryKey]);

  const catalogUrl = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams({ limit: "100" });
      for (const [key, value] of Object.entries(filters)) {
        if (value !== "ALL") params.set(key, value);
      }
      if (search) params.set("q", search);
      if (cursor) params.set("cursor", cursor);
      return `/api/catalog?${params.toString()}`;
    },
    [filters, search],
  );

  const consumeRestoreIntent = useCallback(
    (nextMessage: string | null) => {
      if (!persistedSnapshotRef.current.activeRowId) return;
      setMessage(nextMessage);
      const nextState = {
        ...persistedSnapshotRef.current,
        activeRowId: null,
      };
      persistedSnapshotRef.current = nextState;
      onPersistedState(nextState);
    },
    [onPersistedState],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(searchInput.normalize("NFKC").trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!selected || createStep !== "TERM") return;
    const term = createTerm.normalize("NFKC").trim();
    if (!term) return;
    const generation = ++createPrecheckGenerationRef.current;
    const dialogIntent = dialogIntentRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (
        generation !== createPrecheckGenerationRef.current ||
        dialogIntent !== dialogIntentRef.current
      )
        return;
      createPrecheckAbortRef.current?.abort();
      createPrecheckAbortRef.current = controller;
      setCreatePrecheckLoading(true);
      setCreatePrecheckError(null);
      void (async () => {
        try {
          const response = await fetch(
            `/api/catalog/precheck?term=${encodeURIComponent(term)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok) {
            throw new Error(
              await catalogValidationResponseErrorMessage(response, tc),
            );
          }
          const result = (await response.json()) as CatalogPrecheckResponse;
          if (
            generation !== createPrecheckGenerationRef.current ||
            dialogIntent !== dialogIntentRef.current
          )
            return;
          setCreatePrecheck(result);
        } catch (cause) {
          if (
            !isAbortError(cause) &&
            generation === createPrecheckGenerationRef.current &&
            dialogIntent === dialogIntentRef.current
          ) {
            setCreatePrecheck(null);
            setCreatePrecheckError(
              cause instanceof Error
                ? cause.message
                : tc("未能檢查重複詞，請再試一次。"),
            );
          }
        } finally {
          if (createPrecheckAbortRef.current === controller) {
            createPrecheckAbortRef.current = null;
            if (
              generation === createPrecheckGenerationRef.current &&
              dialogIntent === dialogIntentRef.current
            )
              setCreatePrecheckLoading(false);
          }
        }
      })();
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (createPrecheckAbortRef.current === controller)
        createPrecheckAbortRef.current = null;
    };
  }, [createPrecheckRetryNonce, createStep, createTerm, selected, tc]);

  useEffect(() => {
    if (!selected || selected.hasSense || createStep !== "FORM") return;
    const term = form.term.normalize("NFKC").trim();
    const lemma = form.lemma.normalize("NFKC").trim();
    const partOfSpeech = form.partOfSpeech.normalize("NFKC").trim();
    const definitionZh = form.definitionZh.normalize("NFKC").trim();
    if (!term || !lemma || !partOfSpeech || !definitionZh) return;
    const generation = ++createPrecheckGenerationRef.current;
    const dialogIntent = dialogIntentRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (
        generation !== createPrecheckGenerationRef.current ||
        dialogIntent !== dialogIntentRef.current
      )
        return;
      const params = new URLSearchParams({
        term,
        lemma,
        partOfSpeech,
        definitionZh,
      });
      createPrecheckAbortRef.current?.abort();
      createPrecheckAbortRef.current = controller;
      setCreateExactPrecheckLoading(true);
      void (async () => {
        try {
          const response = await fetch(`/api/catalog/precheck?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return;
          const result = (await response.json()) as CatalogPrecheckResponse;
          if (
            generation !== createPrecheckGenerationRef.current ||
            dialogIntent !== dialogIntentRef.current
          )
            return;
          setCreateExactConflict(result.exactConflict);
        } catch (cause) {
          if (
            !isAbortError(cause) &&
            generation === createPrecheckGenerationRef.current &&
            dialogIntent === dialogIntentRef.current
          )
            setCreateExactConflict(null);
        } finally {
          if (createPrecheckAbortRef.current === controller) {
            createPrecheckAbortRef.current = null;
            if (
              generation === createPrecheckGenerationRef.current &&
              dialogIntent === dialogIntentRef.current
            )
              setCreateExactPrecheckLoading(false);
          }
        }
      })();
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (createPrecheckAbortRef.current === controller)
        createPrecheckAbortRef.current = null;
    };
  }, [
    createStep,
    form.definitionZh,
    form.lemma,
    form.partOfSpeech,
    form.term,
    selected,
  ]);

  const loadCatalog = useCallback(
    async (options?: { background?: boolean }) => {
      if (options?.background && catalogForegroundInFlightRef.current)
        return null;
      const generation = ++catalogLoadGenerationRef.current;
      catalogLoadAbortRef.current?.abort();
      catalogLoadMoreGenerationRef.current += 1;
      catalogLoadMoreAbortRef.current?.abort();
      const controller = new AbortController();
      catalogLoadAbortRef.current = controller;
      setLoadingMore(false);
      if (!options?.background) {
        catalogForegroundInFlightRef.current = true;
        setLoading(true);
        setError(null);
        setRows([]);
        setFilteredTotal(0);
        setNextCursor(null);
      }
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch(catalogUrl(), {
            cache: "no-store",
            signal: controller.signal,
          });
          if (response.status === 409 && attempt < 2) continue;
          if (!response.ok)
            throw new Error(
              await catalogValidationResponseErrorMessage(response, tc),
            );
          const payload = (await response.json()) as CatalogListResponse;
          if (
            payload.structuredIssueVersion !==
            CATALOG_STRUCTURED_ISSUE_VERSION
          ) {
            throw new Error(
              tc(
                "詞庫檢查格式已更新，請重新載入；如持續出現，請通知管理員。",
              ),
            );
          }
          let reviewPayload: PendingResponse | null = null;
          let effectiveCanReview = payload.canReview;
          if (
            effectiveCanReview &&
            pendingSignatureRef.current !== payload.workspaceSignature
          ) {
            const reviewResponse = await fetch(
              "/api/catalog/requests?status=PENDING",
              { cache: "no-store", signal: controller.signal },
            );
            if (reviewResponse.status === 403) {
              if (attempt < 2) continue;
              effectiveCanReview = false;
            } else {
              if (reviewResponse.status === 409 && attempt < 2) continue;
              if (!reviewResponse.ok)
                throw new Error(await responseErrorMessage(reviewResponse, tc));
              const rawReviewPayload =
                (await reviewResponse.json()) as PendingResponse;
              reviewPayload = {
                ...rawReviewPayload,
                requests: rawReviewPayload.requests.map((request) => ({
                  ...request,
                  payload: normalizeCatalogPayload(request.payload),
                })),
              };
              if (reviewPayload.signature !== payload.workspaceSignature) {
                if (attempt < 2) continue;
                throw new Error(tc("詞庫剛剛有更新，請重新載入。"));
              }
            }
          }
          if (generation !== catalogLoadGenerationRef.current) return null;
          const savedState = persistedSnapshotRef.current;
          const retainLoadedPages =
            options?.background === true &&
            savedState.workspaceSignature === payload.workspaceSignature;
          const nextRows = retainLoadedPages
            ? [
                ...payload.rows,
                ...savedState.rows.filter(
                  (persistedRow) =>
                    !payload.rows.some(
                      (freshRow) => freshRow.id === persistedRow.id,
                    ),
                ),
              ]
            : payload.rows;
          setRows(nextRows);
          setCounts(payload.counts);
          setFacets(payload.facets ?? { partOfSpeech: [], category: [] });
          setFilteredTotal(payload.filteredTotal);
          setNextCursor(
            retainLoadedPages ? savedState.nextCursor : payload.nextCursor,
          );
          catalogWorkspaceSignatureRef.current = payload.workspaceSignature;
          setCatalogInitialized(true);
          setCanReview(effectiveCanReview);
          if (effectiveCanReview && reviewPayload) {
            setPending(reviewPayload.requests);
            setPendingHasMore(reviewPayload.hasMore);
            pendingSignatureRef.current = reviewPayload.signature;
          } else if (!effectiveCanReview) {
            setPending([]);
            setPendingHasMore(false);
            pendingSignatureRef.current = "";
          }
          return {
            rows: nextRows,
            pending: reviewPayload?.requests ?? null,
          };
        }
        throw new Error(tc("詞庫剛剛有更新，請重新載入。"));
      } catch (cause) {
        if (
          generation !== catalogLoadGenerationRef.current ||
          isAbortError(cause)
        )
          return null;
        setError(
          cause instanceof Error
            ? cause.message
            : tc(networkErrorMessage(cause)),
        );
        return null;
      } finally {
        if (catalogLoadAbortRef.current === controller)
          catalogLoadAbortRef.current = null;
        if (
          generation === catalogLoadGenerationRef.current &&
          !options?.background
        ) {
          catalogForegroundInFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [catalogUrl, tc],
  );

  useEffect(() => {
    const background = initialBackgroundRefreshRef.current;
    initialBackgroundRefreshRef.current = false;
    const timer = window.setTimeout(() => {
      void loadCatalog(background ? { background: true } : undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      catalogLoadGenerationRef.current += 1;
      catalogLoadAbortRef.current?.abort();
      catalogLoadMoreGenerationRef.current += 1;
      catalogLoadMoreAbortRef.current?.abort();
    };
  }, [loadCatalog]);

  useEffect(() => {
    persistedSnapshotRef.current = {
      initialized: catalogInitialized,
      rows,
      counts,
      facets,
      filters,
      searchInput,
      search,
      selectedSenseKeys: [...exportSenseKeys],
      filteredTotal,
      nextCursor,
      workspaceSignature: catalogWorkspaceSignatureRef.current,
      scrollY:
        historyTarget?.scrollY ??
        (persistedState.activeRowId
          ? persistedState.scrollY
          : window.scrollY),
      activeRowId:
        historyTarget?.rowId ?? persistedSnapshotRef.current.activeRowId,
    };
  }, [
    catalogInitialized,
    counts,
    exportSenseKeys,
    facets,
    filteredTotal,
    filters,
    historyTarget?.rowId,
    historyTarget?.scrollY,
    nextCursor,
    persistedState.activeRowId,
    persistedState.scrollY,
    rows,
    search,
    searchInput,
  ]);

  useEffect(() => {
    if (!persistedState.initialized) return;
    if (!persistedState.activeRowId) {
      window.scrollTo({ top: persistedState.scrollY });
      return;
    }
    return scheduleCatalogViewRestore({
      rowId: persistedState.activeRowId,
      scrollY: persistedState.scrollY,
      historyLabel: tc("查看歷史"),
      onRestored: () => consumeRestoreIntent(null),
      onMissing: () =>
        consumeRestoreIntent(
          tc("原詞條已不在目前結果；篩選條件仍然保留。"),
        ),
    });
  }, [
    persistedState.activeRowId,
    persistedState.initialized,
    persistedState.scrollY,
    consumeRestoreIntent,
    tc,
  ]);

  useEffect(
    () => () => {
      onPersistedState({
        ...persistedSnapshotRef.current,
        scrollY: persistedSnapshotRef.current.activeRowId
          ? persistedSnapshotRef.current.scrollY
          : window.scrollY,
      });
    },
    [onPersistedState],
  );

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!cursor || loadingMore) return;
    const generation = ++catalogLoadMoreGenerationRef.current;
    catalogLoadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    catalogLoadMoreAbortRef.current = controller;
    const requestQueryKey = catalogQueryKey;
    const requestSignature = catalogWorkspaceSignatureRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(catalogUrl(cursor), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 409 || response.status === 422) {
        if (
          generation !== catalogLoadMoreGenerationRef.current ||
          requestQueryKey !== catalogQueryKeyRef.current
        )
          return;
        setMessage(tc("詞庫剛剛有更新，清單已由第一頁重新載入。"));
        await loadCatalog();
        return;
      }
      if (!response.ok)
        throw new Error(
          await catalogValidationResponseErrorMessage(response, tc),
        );
      const payload = (await response.json()) as CatalogListResponse;
      if (
        payload.structuredIssueVersion !== CATALOG_STRUCTURED_ISSUE_VERSION
      ) {
        throw new Error(
          tc(
            "詞庫檢查格式已更新，請重新載入；如持續出現，請通知管理員。",
          ),
        );
      }
      if (
        generation !== catalogLoadMoreGenerationRef.current ||
        requestQueryKey !== catalogQueryKeyRef.current ||
        payload.workspaceSignature !== requestSignature
      )
        return;
      setRows((current) => {
        const ids = new Set(current.map((row) => row.id));
        return [...current, ...payload.rows.filter((row) => !ids.has(row.id))];
      });
      setCounts(payload.counts);
      setFacets(payload.facets ?? { partOfSpeech: [], category: [] });
      setFilteredTotal(payload.filteredTotal);
      setNextCursor(payload.nextCursor);
    } catch (cause) {
      if (
        generation !== catalogLoadMoreGenerationRef.current ||
        isAbortError(cause)
      )
        return;
      setError(
        cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)),
      );
    } finally {
      if (catalogLoadMoreAbortRef.current === controller)
        catalogLoadMoreAbortRef.current = null;
      if (generation === catalogLoadMoreGenerationRef.current)
        setLoadingMore(false);
    }
  }, [catalogQueryKey, catalogUrl, loadCatalog, loadingMore, nextCursor, tc]);

  useEffect(() => {
    selectedPendingRequestIdRef.current = visiblePendingRequestId(
      selected?.pendingRequest ?? null,
    );
  }, [selected?.pendingRequest]);

  const refreshPending = useCallback(async () => {
    if (
      !canReview ||
      saving ||
      pendingRefreshInFlightRef.current ||
      document.visibilityState === "hidden" ||
      Date.now() < pendingBackoffUntilRef.current
    )
      return;
    pendingRefreshInFlightRef.current = true;
    try {
      const response = await fetch(
        "/api/catalog/requests?status=PENDING&view=signature",
        { cache: "no-store" },
      );
      if (response.status === 401 || response.status === 403) {
        setCanReview(false);
        setPending([]);
        setPendingHasMore(false);
        pendingSignatureRef.current = "";
        setSelected((current) => (current?.pendingRequest ? null : current));
        setMessage(tc("審核權限已經更新，待審核工具已收起。"));
        return;
      }
      if (response.status === 503) {
        pendingBackoffUntilRef.current = Date.now() + 30_000;
        return;
      }
      if (!response.ok) return;
      pendingBackoffUntilRef.current = 0;
      const payload = (await response.json()) as {
        signature: string;
        mutationRevision: number;
      };
      if (payload.signature === pendingSignatureRef.current) return;
      const previouslySelectedRequestId = selectedPendingRequestIdRef.current;
      const loaded = await loadCatalog({ background: true });
      if (!loaded?.pending || !previouslySelectedRequestId) return;
      const pendingIds = new Set(loaded.pending.map((request) => request.id));
      if (!pendingIds.has(previouslySelectedRequestId)) {
        setSelected((current) =>
          visiblePendingRequestId(current?.pendingRequest ?? null) ===
          previouslySelectedRequestId
            ? null
            : current,
        );
        setMessage(tc("這項申請已經處理，畫面已更新。"));
      }
    } finally {
      pendingRefreshInFlightRef.current = false;
    }
  }, [canReview, loadCatalog, saving, setSelected, tc]);

  useEffect(() => {
    if (!canReview) return;
    const onFocus = () => {
      void refreshPending();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshPending();
    };
    const interval = window.setInterval(() => {
      void refreshPending();
    }, 10_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canReview, refreshPending]);

  function startCreate() {
    beginDialogIntent();
    setError(null);
    const identity = `governance_${window.crypto.randomUUID().replaceAll("-", "")}`;
    const initialPayload = {
      ...EMPTY_PAYLOAD,
      acceptedAnswersZh: [],
      acceptedFormsEn: [],
      synonymsEn: [],
      antonymsEn: [],
      distractorZh: [],
      distractorEn: [],
    };
    setSelectedState({
      id: null,
      senseKey: identity,
      catalogKey: null,
      sourceFile: null,
      sourceRow: null,
      status: "DRAFT",
      revision: null,
      latestRevision: null,
      approvedRevisionId: null,
      primaryDisposition: "CREATED_DRAFT",
      eligibilityResult: "DRAFT_BLOCKED",
      hasSense: false,
      structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
      structuredIssues: [],
      payload: EMPTY_PAYLOAD,
      pendingRequest: null,
    });
    loadFormForDialog(initialPayload);
    setReason("");
    setStatusReason("");
    setReviewNote("");
    setRetrySource(null);
    setCreateTerm("");
    setCreatePrecheck(null);
    setCreatePrecheckError(null);
    setCreateExactConflict(null);
    setCreateExactPrecheckLoading(false);
    setCreateStep("TERM");
    submitOperationRef.current = null;
  }

  function continueCreateWithTerm() {
    const term = createTerm.normalize("NFKC").trim();
    if (!term || createPrecheckLoading || createPrecheckError) return;
    const previousNormalizedTerm = normalizeCatalogClientText(form.term);
    const nextNormalizedTerm = normalizeCatalogClientText(term);
    const headwordChanged =
      Boolean(previousNormalizedTerm) &&
      previousNormalizedTerm !== nextNormalizedTerm;
    const formWithoutIdentity = { ...form, term: "", lemma: "" };
    const hasDependentContent =
      clientOperationFingerprint(formWithoutIdentity) !==
      clientOperationFingerprint(EMPTY_PAYLOAD);
    if (
      headwordChanged &&
      hasDependentContent &&
      !window.confirm(
        tc(
          "英文詞已經改變。為免混合兩個詞的資料，系統會清除之前填寫的詞義、例句及題目設定。確定繼續？",
        ),
      )
    )
      return;
    createPrecheckGenerationRef.current += 1;
    createPrecheckAbortRef.current?.abort();
    createPrecheckAbortRef.current = null;
    setForm((current) => {
      if (headwordChanged) {
        const next = { ...EMPTY_PAYLOAD, term, lemma: term };
        formBaselineRef.current = next;
        return next;
      }
      const previousTerm = current.term.normalize("NFKC").trim();
      const shouldUpdateLemma =
        !current.lemma.trim() ||
        current.lemma.normalize("NFKC").trim().toLocaleLowerCase("en-US") ===
          previousTerm.toLocaleLowerCase("en-US");
      const next = {
        ...current,
        term,
        lemma: shouldUpdateLemma ? term : current.lemma,
      };
      formBaselineRef.current = next;
      return next;
    });
    setCreateExactConflict(null);
    setCreateExactPrecheckLoading(false);
    setCreateStep("FORM");
  }

  useEffect(() => {
    if (!selected) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    function handleKeyDown(event: KeyboardEvent) {
      // A feedback dialog can be layered above this editor. Its own focus trap
      // must be the only active one while the parent dialog is inert.
      if (dialogRef.current?.closest("[inert]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetailDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [closeDetailDialog, selected]);

  useEffect(() => {
    if (!selected || !error) return;
    const timer = window.setTimeout(() => dialogErrorRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [error, selected]);

  useEffect(() => {
    const parentDialog = dialogRef.current?.parentElement;
    if (!selected || !parentDialog) return;
    if (feedbackTarget) {
      parentDialog.removeAttribute("aria-modal");
      parentDialog.setAttribute("aria-hidden", "true");
      parentDialog.setAttribute("inert", "");
    } else {
      parentDialog.setAttribute("aria-modal", "true");
      parentDialog.removeAttribute("aria-hidden");
      parentDialog.removeAttribute("inert");
    }
    return () => {
      parentDialog.removeAttribute("aria-hidden");
      parentDialog.removeAttribute("inert");
    };
  }, [feedbackTarget, selected]);

  const openDetailBySenseKey = useCallback(
    async (senseKey: string) => {
      const intent = beginDialogIntent();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      setError(null);
      try {
        const response = await fetch(
          `/api/catalog/${encodeURIComponent(senseKey)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!isCurrentDialogIntent(intent)) return;
        if (!response.ok) {
          const message = await catalogValidationResponseErrorMessage(
            response,
            tc,
          );
          if (!isCurrentDialogIntent(intent)) return;
          throw new Error(message);
        }
        const detail = (await response.json()) as Detail;
        if (!isCurrentDialogIntent(intent)) return;
        const currentPayload = detail.payload
          ? normalizeCatalogPayload(detail.payload)
          : null;
        const pendingRequest =
          detail.pendingRequest && "payload" in detail.pendingRequest
            ? {
                ...detail.pendingRequest,
                payload: normalizeCatalogPayload(
                  detail.pendingRequest.payload,
                  currentPayload ?? EMPTY_PAYLOAD,
                ),
              }
            : detail.pendingRequest;
        setSelectedState({
          ...detail,
          structuredIssues: normalizeDetailStructuredIssues(
            detail.structuredIssueVersion,
            detail.structuredIssues,
          ),
          payload: currentPayload,
          pendingRequest,
        });
        loadFormForDialog(
          visiblePendingRequestPayload(pendingRequest) ??
            currentPayload ??
            EMPTY_PAYLOAD,
        );
        setReason("");
        setStatusReason("");
        setReviewNote("");
        setRetrySource(null);
        setCreateStep(null);
        setCreatePrecheck(null);
        setCreateExactConflict(null);
        setCreateExactPrecheckLoading(false);
        submitOperationRef.current = null;
      } catch (cause) {
        if (!isCurrentDialogIntent(intent) || isAbortError(cause)) return;
        setError(cause instanceof Error ? cause.message : tc("讀取詞條失敗"));
      } finally {
        if (detailAbortRef.current === controller)
          detailAbortRef.current = null;
      }
    },
    [beginDialogIntent, isCurrentDialogIntent, loadFormForDialog, tc],
  );

  async function openDetail(row: CatalogRow) {
    if (row.senseKey) await openDetailBySenseKey(row.senseKey);
  }

  useEffect(() => {
    if (!initialSenseKey) return;
    const timer = window.setTimeout(() => {
      void openDetailBySenseKey(initialSenseKey).finally(
        onInitialSenseConsumed,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialSenseKey, onInitialSenseConsumed, openDetailBySenseKey]);

  useEffect(() => {
    if (!initialRetryRequestId) return;
    const intent = beginDialogIntent();
    const controller = new AbortController();
    retryAbortRef.current = controller;
    let consumed = false;
    const consumeRetryIntent = () => {
      if (consumed) return;
      consumed = true;
      onRetryConsumed();
    };
    void (async () => {
      setError(null);
      try {
        const response = await fetch(
          `/api/catalog/requests/${encodeURIComponent(initialRetryRequestId)}/retry`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!isCurrentDialogIntent(intent)) return;
        if (!response.ok) {
          const message = await catalogValidationResponseErrorMessage(
            response,
            tc,
          );
          if (!isCurrentDialogIntent(intent)) return;
          throw new Error(message);
        }
        const body = (await response.json()) as
          | { replay: true; successorId: string; senseKey: string | null }
          | {
              replay: false;
              retry: {
                supersedesRequestId: string;
                kind: "UPDATE" | "CREATE" | "RETIRE" | "REACTIVATE";
                senseKey: string | null;
                sourceRowId: string | null;
                expectedRevision: number | null;
                currentStatus: CatalogStatus;
                payload: CatalogPayload;
                conflicts: CatalogRetryMergeConflict[];
                previousReason: string | null;
                reviewNote: string | null;
              };
            };
        if (!isCurrentDialogIntent(intent)) return;
        if (body.replay) {
          setMessage(tc("此修正版已成功提交，畫面已開啟現有的後續申請。"));
          if (body.senseKey) await openDetailBySenseKey(body.senseKey);
          return;
        }
        const retry = body.retry;
        const retryPayload = normalizeCatalogPayload(retry.payload);
        setSelectedState({
          id: retry.sourceRowId,
          senseKey:
            retry.senseKey ??
            `governance_${window.crypto.randomUUID().replaceAll("-", "")}`,
          catalogKey: null,
          sourceFile: retry.sourceRowId ? "retry-source" : "governance",
          sourceRow: null,
          status: retry.currentStatus,
          revision: retry.expectedRevision,
          latestRevision: retry.expectedRevision,
          approvedRevisionId: null,
          primaryDisposition: "RETRY_DRAFT",
          eligibilityResult: null,
          hasSense: retry.kind !== "CREATE",
          structuredIssueVersion: CATALOG_STRUCTURED_ISSUE_VERSION,
          structuredIssues: [],
          payload: retryPayload,
          pendingRequest: null,
        });
        loadFormForDialog(retryPayload);
        if (retry.kind === "RETIRE" || retry.kind === "REACTIVATE") {
          setReason("");
          setStatusReason(retry.previousReason ?? "");
        } else {
          setReason(retry.previousReason ?? "");
          setStatusReason("");
        }
        setReviewNote("");
        setRetrySource({
          id: retry.supersedesRequestId,
          kind: retry.kind,
          sourceRowId: retry.sourceRowId,
          reviewNote: retry.reviewNote,
          mergeBaseline: retryPayload,
          conflicts: retry.conflicts,
          choices: {},
        });
        setCreateStep(null);
        setCreatePrecheck(null);
        setCreateExactConflict(null);
        setCreateExactPrecheckLoading(false);
        submitOperationRef.current = null;
      } catch (cause) {
        if (isCurrentDialogIntent(intent) && !isAbortError(cause)) {
          setError(
            cause instanceof Error ? cause.message : tc("讀取重新提交申請失敗"),
          );
        }
      } finally {
        if (retryAbortRef.current === controller) retryAbortRef.current = null;
        consumeRetryIntent();
      }
    })();
    return () => {
      controller.abort();
      if (retryAbortRef.current === controller) retryAbortRef.current = null;
      consumeRetryIntent();
    };
  }, [
    beginDialogIntent,
    initialRetryRequestId,
    isCurrentDialogIntent,
    loadFormForDialog,
    onRetryConsumed,
    openDetailBySenseKey,
    tc,
  ]);

  function openSelectedHistory() {
    if (!selected?.senseKey) return;
    const loadedFormBaseline =
      visiblePendingRequestPayload(selected.pendingRequest) ??
      formBaselineRef.current;
    const hasUnsavedInput =
      clientOperationFingerprint(form) !==
        clientOperationFingerprint(loadedFormBaseline) ||
      reason.trim().length > 0 ||
      statusReason.trim().length > 0 ||
      reviewNote.trim().length > 0;
    if (
      hasUnsavedInput &&
      !window.confirm(
        tc(
          "你尚有未提交的詞條內容；開啟修改歷史後，這些輸入不會保留。確定繼續？",
        ),
      )
    )
      return;
    const senseKey = selected.senseKey;
    closeDetailDialog();
    onOpenHistory(senseKey);
  }

  function updateForm<K extends keyof CatalogPayload>(
    key: K,
    value: CatalogPayload[K],
  ) {
    if (
      key === "term" ||
      key === "lemma" ||
      key === "partOfSpeech" ||
      key === "definitionZh"
    ) {
      createPrecheckGenerationRef.current += 1;
      createPrecheckAbortRef.current?.abort();
      createPrecheckAbortRef.current = null;
      setCreateExactConflict(null);
      const next = { ...form, [key]: value };
      setCreateExactPrecheckLoading(
        createStep === "FORM" && selected?.hasSense === false
          ? Boolean(
              next.term.normalize("NFKC").trim() &&
                next.lemma.normalize("NFKC").trim() &&
                next.partOfSpeech.normalize("NFKC").trim() &&
                next.definitionZh.normalize("NFKC").trim(),
            )
          : false,
      );
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDistractorSlot(
    key: "distractorZh" | "distractorEn",
    index: number,
    value: string,
  ) {
    setForm((current) => {
      if (index > current[key].length) return current;
      const next = [...current[key]];
      if (index === next.length) next.push(value);
      else next[index] = value;
      return {
        ...current,
        [key]: next,
      };
    });
  }

  function compactDistractorSlots(key: "distractorZh" | "distractorEn") {
    setForm((current) => ({
      ...current,
      [key]: current[key]
        .map((item) => item.normalize("NFKC").trim())
        .filter(Boolean),
    }));
  }

  async function submitChange(
    kind: "UPDATE" | "CREATE" | "RETIRE" | "REACTIVATE",
  ) {
    if (!selected || !selected.senseKey) return;
    if (retrySource && retrySource.kind !== kind) {
      setError(
        tc("這是被拒絕申請的修正版；請使用與原申請相同的操作類型重新提交。"),
      );
      return;
    }
    const immediate = kind === "RETIRE" && canReview;
    const trimmedReason =
      kind === "RETIRE" || kind === "REACTIVATE"
        ? statusReason.trim()
        : reason.trim();
    if (kind === "CREATE" && createExactPrecheckLoading) {
      setError(tc("正在檢查是否已有相同詞義，請稍候再提交。"));
      return;
    }
    if (kind === "CREATE" && createExactConflict) {
      setError(
        tc(
          createExactConflict === "PENDING"
            ? "已有相同詞義的新增申請等待審核，不能重複提交。"
            : "詞庫已經有相同英文、詞性及中文主要釋義，請修改原有詞義。",
        ),
      );
      return;
    }
    if (
      (kind === "RETIRE" || kind === "REACTIVATE") &&
      trimmedReason.length < 3
    ) {
      setError(tc("停用或重新啟用詞義前必須填寫至少三個字的理由。"));
      return;
    }
    if (trimmedReason.length > 2000) {
      setError(tc("修改、停用或重新啟用理由不可超過 2,000 字。"));
      return;
    }
    const loadedFormBaseline =
      visiblePendingRequestPayload(selected.pendingRequest) ??
      formBaselineRef.current;
    const changedFields = (
      Object.keys(form) as Array<keyof CatalogPayload>
    ).filter(
      (field) =>
        clientOperationFingerprint(form[field]) !==
        clientOperationFingerprint(loadedFormBaseline[field]),
    );
    if (
      (kind === "RETIRE" || kind === "REACTIVATE") &&
      changedFields.length > 0
    ) {
      setError(
        tc(
          "你已修改詞條內容。請先提交 UPDATE 並完成審核，之後再停用或重新啟用詞義。",
        ),
      );
      return;
    }
    if (kind !== "CREATE" && selected.revision === null) {
      setError(tc("詞義版本已經改變，請重新載入後再操作。"));
      return;
    }
    if (
      retrySource?.conflicts.some(
        (conflict) => !retrySource.choices[conflict.field],
      )
    ) {
      setError(
        tc("正式版本與原提案曾修改同一欄位；請逐欄選擇保留目前值或採用原提案。"),
      );
      return;
    }
    if (
      immediate &&
      !window.confirm(
        tc("這個詞義會立即停止出現在新學習題目；學生歷史會保留。確定停用？"),
      )
    )
      return;
    const submitIntent = dialogIntentRef.current;
    const submittedSenseKey = selected.senseKey;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const retryResolvedBaseline =
        retrySource?.kind === "UPDATE"
          ? retrySource.conflicts.reduce(
              (current, conflict) => ({
                ...current,
                [conflict.field]:
                  retrySource.choices[conflict.field] === "PROPOSAL"
                    ? conflict.proposal
                    : conflict.current,
              }),
              retrySource.mergeBaseline,
            )
          : null;
      const requestBody = {
        kind,
        senseKey: selected.senseKey,
        sourceRowId:
          retrySource?.sourceRowId ??
          (selected.sourceFile && selected.sourceFile !== "governance"
            ? selected.id
            : undefined),
        expectedRevision: kind === "CREATE" ? undefined : selected.revision,
        payload: kind === "UPDATE" || kind === "CREATE" ? form : undefined,
        reason: trimmedReason || undefined,
        immediate,
        supersedesRequestId: retrySource?.id,
        retryConflictChoices:
          retrySource?.kind === "UPDATE" ? retrySource.choices : undefined,
        retryPayloadPatch: retryResolvedBaseline
          ? catalogRetryPayloadPatch(retryResolvedBaseline, form)
          : undefined,
      };
      const fingerprint = clientOperationFingerprint(requestBody);
      submitOperationRef.current = pendingClientOperation(
        submitOperationRef.current,
        fingerprint,
        () => window.crypto.randomUUID(),
      );
      const response = await rosterFetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: submitOperationRef.current.operationId,
          ...requestBody,
        }),
      });
      if (!response.ok)
        throw new Error(
          await catalogValidationResponseErrorMessage(response, tc),
        );
      const result = (await response.json()) as {
        status: string;
        immediate?: boolean;
      };
      submitOperationRef.current = null;
      const refreshedCatalog = await loadCatalog();
      if (!isCurrentDialogIntent(submitIntent)) return;
      setRetrySource(null);
      setMessage(
        result.immediate && result.status === "APPROVED"
          ? tc("詞義已停用；不會再出現在新學習題目，既有歷史仍會保留。")
          : tc("申請已送交審核；批准前不會改變學生使用的正式版本。"),
      );
      if (kind === "CREATE" || immediate) {
        closeDetailDialog();
        return;
      }
      if (refreshedCatalog) await openDetailBySenseKey(submittedSenseKey);
    } catch (cause) {
      if (isCurrentDialogIntent(submitIntent)) {
        setError(
          cause instanceof Error ? cause.message : tc("提交詞庫修改失敗"),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function exportSelectedUpdates() {
    const senseKeys = [...exportSenseKeys];
    if (!senseKeys.length || senseKeys.length > 200) return;
    setSaving(true);
    setError(null);
    try {
      const response = await rosterFetch("/api/catalog/submissions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senseKeys, format: exportFormat }),
      });
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, tc));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `catalog-export.${exportFormat.toLocaleLowerCase("en-US")}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(
        tc(
          `已匯出所選詞條（${exportFormat}）。匯出不會立即修改詞庫；完成修改後，請到「批量提交」上載並送交審核。`,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : tc("匯出所選詞條失敗"),
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleExportSelection(senseKey: string, checked: boolean) {
    if (
      checked &&
      !exportSenseKeys.has(senseKey) &&
      exportSenseKeys.size >= 200
    ) {
      setMessage(tc("每次最多選取 200 個詞條；請先匯出所選詞條或清除全部選取。"));
      return;
    }
    setExportSenseKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(senseKey);
      else next.delete(senseKey);
      return next;
    });
  }

  async function reviewRequest(
    request: PendingRequest,
    decision: "APPROVE" | "REJECT",
  ) {
    const reviewIntent = dialogIntentRef.current;
    const selectedRequestIdAtStart = visiblePendingRequestId(
      selected?.pendingRequest ?? null,
    );
    const requestTerm =
      request.sense?.term ||
      request.payload.term ||
      request.senseKey ||
      tc("詞庫申請");
    setSaving(true);
    setError(null);
    setMessage(null);
    onReviewActionNotice(null);
    try {
      const note =
        reviewNotes[request.id] ??
        (selectedRequestIdAtStart === request.id ? reviewNote : "");
      const response = await rosterFetch(
        `/api/catalog/requests/${encodeURIComponent(request.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            expectedRevision: request.revision,
            reviewNote: note.trim(),
          }),
        },
      );
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, tc));
      const result = (await response.json()) as ReviewMutationResult;
      const actualStatus = result.request.status;
      const successMessage = result.replay
        ? actualStatus === "APPROVED"
          ? tc("這項申請已經批准，畫面已更新。")
          : actualStatus === "REJECTED"
            ? tc("這項申請已經拒絕，畫面已更新。")
            : tc("這項申請已經處理，畫面已更新。")
        : actualStatus === "APPROVED"
          ? tc("草稿已批准並更新詞庫。")
          : tc("草稿已拒絕。");
      onReviewActionNotice({
        requestId: request.id,
        term: requestTerm,
        type: "success",
        message: successMessage,
      });
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      await loadCatalog();
      if (isCurrentDialogIntent(reviewIntent)) {
        setReviewNote("");
        if (
          selectedRequestIdAtStart === request.id &&
          selectedPendingRequestIdRef.current === request.id
        ) {
          setSelectedState(null);
          setRetrySource(null);
          submitOperationRef.current = null;
        }
      }
    } catch (cause) {
      const failureMessage =
        cause instanceof Error ? cause.message : tc("審核詞庫修改失敗");
      onReviewActionNotice({
        requestId: request.id,
        term: requestTerm,
        type: "error",
        message: failureMessage,
      });
      if (isCurrentDialogIntent(reviewIntent)) {
        setError(failureMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!catalogInitialized && loading)
    return (
      <div
        role="status"
        aria-label={tc("正在載入完整詞庫")}
        className="flex items-center justify-center gap-3 py-20 text-sm text-[var(--muted)]"
      >
        <div
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent"
        />
        {tc("正在載入完整詞庫…")}
      </div>
    );
  if (!catalogInitialized && error)
    return <ErrorBanner message={error} onRetry={() => void loadCatalog()} />;
  const statusOnlyRetry =
    retrySource?.kind === "RETIRE" || retrySource?.kind === "REACTIVATE";
  const blockingIssues = (selected?.structuredIssues ?? []).filter(
    (issue) => issue.severity === "ERROR",
  );
  const blockingIssueEvidence = blockingIssues.map((issue) => ({
    issue,
    evidence: catalogIssueEvidence(issue, form),
  }));
  const blockingIssueLocations = blockingIssueEvidence.flatMap(
    ({ evidence }) => evidence?.locations ?? [],
  );
  const blockingIssueGroupFields = new Set(
    blockingIssueEvidence.flatMap(({ issue, evidence }) =>
      issue.field && !evidence?.locations.length ? [issue.field] : [],
    ),
  );
  const indexedIssueField = (field: string) =>
    field === "distractorZh" || field === "distractorEn";
  const issueFieldIsMarked = (field: string, index?: number) => {
    if (index !== undefined) {
      return blockingIssueLocations.some(
        (location) => location.field === field && location.index === index,
      );
    }
    return blockingIssueGroupFields.has(field)
      || (!indexedIssueField(field)
        && blockingIssueLocations.some((location) => location.field === field));
  };
  const issueFieldMarker = (field: string, index?: number) => {
    const marked = issueFieldIsMarked(field, index);
    return {
      "data-catalog-field": field,
      "data-catalog-index": index === undefined ? undefined : String(index),
      "data-catalog-issue": marked ? "true" : undefined,
      style: marked
        ? {
            outline: "2px solid var(--danger)",
            outlineOffset: "2px",
            scrollMarginTop: "1rem",
          }
        : { scrollMarginTop: "1rem" },
    };
  };
  const issueLocationValues = (field: string, index?: number) => [
    ...new Set(
      blockingIssueLocations
        .filter((location) =>
          location.field === field
          && (index === undefined || location.index === index),
        )
        .map((location) => location.value),
    ),
  ];

  function focusDetailIssueField(location: CatalogIssueEvidenceLocation) {
    const indexedSelector = indexedIssueField(location.field)
      && location.index !== null
        ? `[data-catalog-index="${location.index}"]`
        : "";
    const target = dialogRef.current?.querySelector<HTMLElement>(
      `[data-catalog-field="${CSS.escape(location.field)}"]${indexedSelector}`,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      const control = target.matches("input, select, textarea, button")
        ? target
        : target.querySelector<HTMLElement>(
            "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
          );
      control?.focus({ preventScroll: true });
    }, 250);
  }

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)]">
              {tc("詞庫治理工作區")}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {tc(
                "管理員及老師可以查看全部詞條；一般修改由一位有權限人員審核，具權限者可即時停用。",
              )}
            </p>
          </div>
          <div
            data-testid="catalog-total-count"
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]"
          >
            {tc("完整詞庫")}：{counts.all ?? rows.length} {tc("條")}
          </div>
        </div>
        <div
          data-testid="catalog-action-toolbar"
          className="flex min-h-11 flex-wrap items-center gap-2"
        >
          <button
            type="button"
            className="ui-button ui-button-primary"
            onClick={startCreate}
          >
            {tc("新增詞條")}
          </button>
          <button
            type="button"
            className="ui-button ui-button-secondary"
            onClick={() => setFeedbackTarget({ senseKey: null, term: null })}
          >
            {tc("提出詞庫意見")}
          </button>
          {bulkEnabled ? (
            <>
              <label className="sr-only" htmlFor="catalog-export-format">
                {tc("匯出格式")}
              </label>
              <select
                id="catalog-export-format"
                aria-label={tc("匯出格式") as string}
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as "XLSX" | "CSV")}
                className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
              >
                <option value="XLSX">{tc("Excel（XLSX）")}</option>
                <option value="CSV">CSV</option>
              </select>
              <button
                type="button"
                className="ui-button ui-button-secondary"
                disabled={saving || exportSenseKeys.size === 0}
                onClick={() => void exportSelectedUpdates()}
              >
                {tc(`匯出所選詞條（${exportFormat}）`)} ({exportSenseKeys.size}/200)
              </button>
              <button
                type="button"
                className={`ui-button ui-button-quiet ${exportSenseKeys.size ? "" : "invisible pointer-events-none"}`}
                disabled={saving || exportSenseKeys.size === 0}
                aria-hidden={exportSenseKeys.size === 0}
                tabIndex={exportSenseKeys.size ? 0 : -1}
                onClick={() => setExportSenseKeys(new Set())}
              >
                {tc("清除全部選取")}
              </button>
            </>
          ) : null}
        </div>
      </header>
      {error && !selected ? (
        <ErrorBanner message={error} onRetry={() => void loadCatalog()} />
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]"
        >
          {message}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["all", "ACTIVE", "DRAFT", "pending"] as const).map((key) => (
          <div
            key={key}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <p className="text-xs text-[var(--muted)]">
              {key === "all"
                ? tc("完整詞庫")
                : key === "ACTIVE"
                  ? tc("已啟用")
                  : key === "DRAFT"
                    ? tc("草稿（未供學生使用）")
                    : tc("有修改等待審核")}
            </p>
            <p className="mt-0.5 text-lg font-bold text-[var(--text)]">
              {counts[key] ?? 0}
            </p>
          </div>
        ))}
      </div>
      <CatalogWorkspaceToolbar
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        filters={filters}
        onFilters={setFilters}
        facets={facets}
      />
      {bulkEnabled ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--border-soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
          {tc(
            "如需一次修改多個現有詞條，請先勾選並匯出所選詞條。預設格式為 Excel（XLSX），亦可選擇 CSV。完成修改後，請到「批量提交」上載並送交審核。匯出檔案不會立即更改詞庫。「尚未提交」表示該匯入資料尚未建立正式詞義；可選擇提示查看原因及下一步。",
          )}
        </p>
      ) : null}
      {canReview ? (
        <details
          className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)]"
          data-testid="catalog-pending-review-group"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-[var(--text)]">
            <span>{tc("待審核草稿")}</span>
            <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--primary)]">
              {pending.length} {tc("項")}
            </span>
          </summary>
          {canReview ? (
            <section className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-[var(--text)]">
                    {tc("待審核草稿")}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tc(
                      "批准前會重新檢查版本、答案安全及干擾項；不能批准自己提交的修改。",
                    )}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--primary)]">
                  {pending.length} {tc("項")}
                </span>
              </div>
              {pendingHasMore ? (
                <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]">
                  {tc("待審核項目超過目前顯示上限，請先處理現有項目。")}
                </p>
              ) : null}
              {pending.length ? (
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {pending.map((request) => (
                    <article
                      key={request.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--text)]">
                            {request.sense?.term ??
                              request.payload.term ??
                              tc("新詞義")}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {tc(catalogRequestKindLabel(request.kind))} ·{" "}
                            {request.proposer.legalName ||
                              request.proposer.accountName}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {request.payload.definitionZh ||
                              tc("尚未填寫中文釋義")}{" "}
                            · {request.payload.partOfSpeech || tc("未分類")} ·{" "}
                            {request.payload.level}
                          </p>
                          <details className="mt-2 text-xs text-[var(--muted)]">
                            <summary className="cursor-pointer font-semibold">
                              {tc("進階資料")}
                            </summary>
                            <dl className="mt-2 grid gap-1 break-all">
                              <div>
                                <dt className="inline font-semibold">
                                  {tc("系統識別碼")}：
                                </dt>{" "}
                                <dd className="inline font-mono">
                                  {request.senseKey ??
                                    request.sourceImportRow?.senseKey ??
                                    tc("尚未建立")}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-semibold">
                                  {tc("基準版本")}：
                                </dt>{" "}
                                <dd className="inline">
                                  {request.baseRevision === null
                                    ? tc("未有正式版本")
                                    : `${tc("第")} ${request.baseRevision} ${tc("版")}`}
                                </dd>
                              </div>
                            </dl>
                          </details>
                        </div>
                        <span className="rounded-full bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--warning)]">
                          {tc("待審核")}
                        </span>
                      </div>
                      <textarea
                        className="mt-3 min-h-16 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--text)]"
                        placeholder={tc("審核備註（拒絕時必填）")}
                        value={reviewNotes[request.id] ?? ""}
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        aria-label={tc("審核備註")}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="ui-button ui-button-secondary ui-button-small"
                          onClick={() => {
                            loadFormForDialog(request.payload);
                            setReviewNote(reviewNotes[request.id] ?? "");
                            setSelected({
                              id: request.sourceImportRow?.id ?? null,
                              senseKey:
                                request.sense?.senseKey ??
                                request.senseKey ??
                                request.sourceImportRow?.senseKey ??
                                "",
                              catalogKey:
                                request.sourceImportRow?.catalogKey ??
                                request.catalogKey ??
                                null,
                              sourceFile:
                                request.sourceImportRow?.sourceFile ?? null,
                              sourceRow:
                                request.sourceImportRow?.sourceRow ?? null,
                              status: request.baseStatus ?? "DRAFT",
                              revision: request.baseRevision,
                              latestRevision: request.baseRevision,
                              approvedRevisionId: null,
                              primaryDisposition:
                                request.sourceImportRow?.primaryDisposition ??
                                "",
                              eligibilityResult:
                                request.sourceImportRow?.eligibilityResult ??
                                null,
                              hasSense: Boolean(request.sense),
                              structuredIssueVersion:
                                CATALOG_STRUCTURED_ISSUE_VERSION,
                              structuredIssues: [],
                              payload: request.payload,
                              pendingRequest: {
                                id: request.id,
                                kind: request.kind,
                                status: request.status,
                                revision: request.revision,
                                payload: request.payload,
                                reason: request.reason,
                                proposerId: request.proposerId,
                                createdAt: request.createdAt,
                              },
                            });
                          }}
                        >
                          {tc("查看草稿")}
                        </button>
                        <button
                          type="button"
                          className="ui-button ui-button-primary ui-button-small"
                          disabled={saving}
                          onClick={() => void reviewRequest(request, "APPROVE")}
                        >
                          {tc("批准")}
                        </button>
                        <button
                          type="button"
                          className="ui-button ui-button-danger ui-button-small"
                          disabled={saving}
                          onClick={() => void reviewRequest(request, "REJECT")}
                        >
                          {tc("拒絕")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  {tc("目前沒有等待審核的草稿。")}
                </p>
              )}
            </section>
          ) : null}
        </details>
      ) : null}
      <p
        className="text-sm text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        {loading ? (
          tc("正在更新詞庫結果…")
        ) : (
          <>
            {tc("目前篩選")}: {filteredTotal} / {counts.all ?? 0}{" "}
            {tc("條；已載入")} {rows.length}
          </>
        )}
      </p>
      <div aria-busy={loading || loadingMore}>
        {loading ? (
          <p
            role="status"
            className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]"
          >
            {tc("正在更新詞庫結果…")}
          </p>
        ) : rows.length ? (
          <CatalogWorkspaceResults
            rows={rows}
            bulkEnabled={bulkEnabled}
            selectedSenseKeys={exportSenseKeys}
            historyEnabled={historyEnabled}
            onToggleSelection={toggleExportSelection}
            onEdit={(row) => void openDetail(row as CatalogRow)}
            onReport={(row) =>
              row.senseKey &&
              setFeedbackTarget({ senseKey: row.senseKey, term: row.term })
            }
            onHistory={(row) =>
              row.senseKey &&
              setHistoryTarget({
                senseKey: row.senseKey,
                term: row.term,
                rowId: row.id,
                scrollY: window.scrollY,
              })
            }
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]">
            {tc("目前篩選沒有詞條。")}
          </p>
        )}
      </div>
      {nextCursor ? (
        <button
          type="button"
          className="ui-button ui-button-secondary mx-auto block"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? tc("載入中…") : tc("載入更多（最多 100 條）")}
        </button>
      ) : null}
      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalog-dialog-title"
        >
          <section
            ref={dialogRef}
            data-testid="catalog-dialog-panel"
            tabIndex={-1}
            className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="catalog-dialog-title"
                  className="text-xl font-bold text-[var(--text)]"
                >
                  {createStep === "TERM"
                    ? tc("新增詞義")
                    : form.term || tc("詞條內容")}
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {createStep === "TERM" ? (
                    tc("步驟 1 / 2 · 先輸入英文串法並檢查詞庫")
                  ) : (
                    <>
                      {tc(catalogLifecycleLabel(selected.status))} ·{" "}
                      {selected.revision === null
                        ? tc("未有正式版本")
                        : `${tc("目前正式版本")}：${tc("第")} ${selected.revision} ${tc("版")}`}
                    </>
                  )}
                </p>
                {canReview ? (
                  <details className="mt-2 text-xs text-[var(--muted)]">
                    <summary className="cursor-pointer font-semibold">
                      {tc("進階資料")}
                    </summary>
                    <dl className="mt-2 grid gap-1 break-all rounded-xl bg-[var(--border-soft)] p-3">
                      <div>
                        <dt className="inline font-semibold">{tc("來源")}：</dt>{" "}
                        <dd className="inline">
                          {tc(
                            catalogSourceSummary(
                              selected.sourceFile,
                              selected.sourceRow,
                            ),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">
                          {tc("系統識別碼")}：
                        </dt>{" "}
                        <dd className="inline font-mono">
                          {selected.senseKey}
                        </dd>
                      </div>
                      {selected.sourceFile ? (
                        <div>
                          <dt className="inline font-semibold">
                            {tc("來源檔案")}：
                          </dt>{" "}
                          <dd className="inline font-mono">
                            {selected.sourceFile}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </details>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {createStep === null ? (
                  <button
                    type="button"
                    className="ui-button ui-button-quiet ui-button-small"
                    onClick={() =>
                      setFeedbackTarget({
                        senseKey: selected.senseKey,
                        term: form.term,
                      })
                    }
                  >
                    {tc("報告問題")}
                  </button>
                ) : null}
                {historyEnabled && createStep === null ? (
                  <button
                    type="button"
                    className="ui-button ui-button-quiet ui-button-small"
                    onClick={openSelectedHistory}
                  >
                    {tc("查看歷史")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ui-button ui-button-quiet ui-button-small"
                  onClick={closeDetailDialog}
                  aria-label={tc("關閉") as string}
                >
                  ×
                </button>
              </div>
            </div>
            {error ? (
              <div
                ref={dialogErrorRef}
                tabIndex={-1}
                role="alert"
                className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p>{error}</p>
                  <button
                    type="button"
                    className="shrink-0 font-semibold underline underline-offset-2"
                    onClick={() => {
                      setError(null);
                      window.requestAnimationFrame(() =>
                        dialogRef.current?.focus(),
                      );
                    }}
                  >
                    {tc("關閉提示")}
                  </button>
                </div>
              </div>
            ) : null}
            {createStep === null
            && selected.id
            && !selected.hasSense
            && !selected.pendingRequest ? (
              <section
                data-testid="catalog-import-next-step"
                className="mt-4 rounded-2xl border border-[var(--primary)]/35 bg-[var(--primary-soft)] p-4 text-sm text-[var(--text)]"
              >
                <h3 className="font-bold text-[var(--primary)]">
                  {tc("尚未提交建立詞義")}
                </h3>
                <p className="mt-1 leading-6">
                  {blockingIssues.length
                    ? tc(`此項來自匯入資料，尚未成為正式詞義。請先修正下方列出的 ${blockingIssues.length} 項內容，然後選擇「提交新詞義，送交審核」。`)
                    : tc("此項來自匯入資料，尚未成為正式詞義。目前沒有需要修正的內容；確認資料後，可直接選擇「提交新詞義，送交審核」。")}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {tc("經另一位有權限人士審核及批准後，詞義才可供學生使用，亦可勾選及匯出。")}
                </p>
              </section>
            ) : null}
            {createStep !== "TERM" && selected.payload ? (
              <CatalogIssueGuidance
                issues={selected.structuredIssues}
                payload={form}
                onLocate={focusDetailIssueField}
              />
            ) : null}
            {createStep === "TERM" ? (
              <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--border-soft)] p-4 sm:p-5">
                <h3 className="text-base font-bold text-[var(--text)]">
                  {tc("先檢查英文詞")}
                </h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {tc(
                    "輸入學生將會看到的英文拼法。系統會先列出同一英文的現有詞義，避免誤建重複內容。",
                  )}
                </p>
                <label className="mt-4 grid gap-1.5 text-sm font-semibold text-[var(--text)]">
                  {tc("英文詞（必填）")}
                  <input
                    ref={createTermInputRef}
                    autoFocus
                    required
                    maxLength={120}
                    className="h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)]"
                    value={createTerm}
                    onChange={(event) => {
                      createPrecheckGenerationRef.current += 1;
                      createPrecheckAbortRef.current?.abort();
                      createPrecheckAbortRef.current = null;
                      setCreateTerm(event.target.value);
                      setCreatePrecheck(null);
                      setCreatePrecheckError(null);
                      setCreatePrecheckLoading(false);
                    }}
                    placeholder={tc("例如：run")}
                  />
                  <small className="font-normal text-[var(--muted)]">
                    {tc("暫時只需填寫英文詞；確認沒有重複後，再填寫其餘內容。")}
                  </small>
                </label>
                {createPrecheckLoading ? (
                  <p className="mt-4 text-sm text-[var(--muted)]" role="status">
                    {tc("正在檢查詞庫…")}
                  </p>
                ) : null}
                {createPrecheckError ? (
                  <div className="mt-4 rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
                    <p role="alert">{createPrecheckError}</p>
                    <button
                      type="button"
                      className="ui-button ui-button-secondary ui-button-small mt-3"
                      onClick={() => {
                        createPrecheckGenerationRef.current += 1;
                        setCreatePrecheck(null);
                        setCreatePrecheckError(null);
                        setCreatePrecheckRetryNonce((current) => current + 1);
                        window.requestAnimationFrame(() =>
                          createTermInputRef.current?.focus(),
                        );
                      }}
                    >
                      {tc("重新檢查")}
                    </button>
                  </div>
                ) : null}
                {createPrecheck && !createPrecheckLoading ? (
                  <div className="mt-4">
                    <p
                      className="sr-only"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {createPrecheck.matches.length
                        ? tc(
                            `找到 ${createPrecheck.matches.length} 個同一英文的詞義。`,
                          )
                        : tc("詞庫暫時沒有這個英文詞，可以繼續新增。")}
                    </p>
                    {createPrecheck.matches.length ? (
                      <>
                        <p className="text-sm font-bold text-[var(--text)]">
                          {tc("詞庫已有同一英文的詞義")}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {tc("如果以下已有你想加的意思，請直接查看或修改原有詞義。")}
                        </p>
                        <div className="mt-3 grid gap-2">
                          {createPrecheck.matches.map((match, index) => (
                            <article
                              key={`${match.kind}:${match.senseKey ?? index}`}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                            >
                              <div>
                                <p className="font-bold text-[var(--text)]">
                                  {match.definitionZh || tc("未填中文釋義")}
                                </p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {tc(catalogPartOfSpeechLabel(match.partOfSpeech))} ·{" "}
                                  {match.level} ·{" "}
                                  {tc(
                                    match.status === "PENDING"
                                      ? "等待審核"
                                      : catalogLifecycleLabel(
                                          match.status as CatalogStatus,
                                        ),
                                  )}
                                </p>
                              </div>
                              {match.senseKey ? (
                                <button
                                  type="button"
                                  className="ui-button ui-button-secondary ui-button-small"
                                  aria-label={tc(
                                    `${match.status === "PENDING" ? "查看申請" : "查看／修改"}：${match.definitionZh || "未填中文釋義"}`,
                                  )}
                                  onClick={() =>
                                    void openDetailBySenseKey(match.senseKey!)
                                  }
                                >
                                  {tc(
                                    match.status === "PENDING"
                                      ? "查看申請"
                                      : "查看／修改",
                                  )}
                                </button>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="rounded-xl bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
                        {tc("詞庫暫時沒有這個英文詞，可以繼續新增。")}
                      </p>
                    )}
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="ui-button ui-button-quiet"
                        onClick={closeDetailDialog}
                      >
                        {tc("取消")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button-primary"
                        onClick={continueCreateWithTerm}
                      >
                        {createPrecheck.matches.length
                          ? tc(`新增「${createTerm.normalize("NFKC").trim()}」的另一個意思`)
                          : tc("繼續填寫詞義")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <>
            {statusOnlyRetry ? (
              <p
                role="note"
                className="mt-4 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]"
              >
                {tc(
                  "這是狀態變更申請；詞條內容修改需要另行提交 UPDATE，批准後再重新提交啟用／停用申請。本次只會重新提交理由。",
                )}
              </p>
            ) : null}
            <fieldset
              disabled={statusOnlyRetry}
              className="m-0 min-w-0 border-0 p-0 disabled:opacity-70"
            >
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <h3 className="text-base font-bold text-[var(--text)]">
                    {tc("基本資料")}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tc("請先填寫此詞義的英文資料、詞性、程度及主題。")}
                  </p>
                </div>
                <label
                  {...issueFieldMarker("term")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("英文詞（必填）")}
                  <input
                    required
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)] read-only:cursor-not-allowed read-only:bg-[var(--border-soft)]"
                    value={form.term}
                    readOnly={createStep === "FORM" && !selected.hasSense}
                    onChange={(event) => updateForm("term", event.target.value)}
                    placeholder={tc("例如：run")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("term")}
                  />
                  {createStep === "FORM" && !selected.hasSense ? (
                    <button
                      type="button"
                      className="w-fit font-normal text-[var(--primary)] underline underline-offset-2"
                      onClick={() => {
                        createPrecheckGenerationRef.current += 1;
                        createPrecheckAbortRef.current?.abort();
                        createPrecheckAbortRef.current = null;
                        setCreateTerm(form.term);
                        setCreatePrecheck(null);
                        setCreateExactConflict(null);
                        setCreateExactPrecheckLoading(false);
                        setCreateStep("TERM");
                      }}
                    >
                      {tc("更改英文詞並重新檢查")}
                    </button>
                  ) : null}
                </label>
                <label
                  {...issueFieldMarker("lemma")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("詞頭（必填）")}
                  <input
                    required
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)] disabled:cursor-not-allowed disabled:bg-[var(--border-soft)]"
                    value={form.lemma}
                    disabled={selected.hasSense}
                    onChange={(event) =>
                      updateForm("lemma", event.target.value)
                    }
                    placeholder={tc("例如：run；過去式 ran 的詞頭亦是 run")}
                  />
                  {selected.hasSense ? (
                    <small className="font-normal text-[var(--muted)]">
                      {tc(
                        "Lemma 屬於穩定詞頭身份；如要改成另一個詞頭，請新增詞義並停用舊詞義。",
                      )}
                    </small>
                  ) : (
                    <small className="font-normal text-[var(--muted)]">
                      {tc("詞頭是字典使用的基本形式；系統已按英文詞預填，可按需要修改。")}
                    </small>
                  )}
                </label>
                <label
                  {...issueFieldMarker("partOfSpeech")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("詞性（必填）")}
                  <select
                    required
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={form.partOfSpeech}
                    onChange={(event) =>
                      updateForm("partOfSpeech", event.target.value)
                    }
                  >
                    <option value="">{tc("請選擇詞性")}</option>
                    {CATALOG_PARTS_OF_SPEECH.map((item) => (
                      <option key={item} value={item}>
                        {tc(catalogPartOfSpeechLabel(item))}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  {...issueFieldMarker("level")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("程度（必填）")}
                  <select
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={form.level}
                    onChange={(event) =>
                      updateForm(
                        "level",
                        event.target.value as CatalogPayload["level"],
                      )
                    }
                  >
                    {["A1", "A2", "B1", "B2"].map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  {...issueFieldMarker("category")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("主題（必填）")}
                  <select
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={form.category}
                    onChange={(event) =>
                      updateForm("category", event.target.value)
                    }
                  >
                    {CATALOG_CATEGORIES.includes(
                      form.category as (typeof CATALOG_CATEGORIES)[number],
                    ) ? null : (
                      <option value={form.category}>
                        {form.category} ({tc("無效，請重新選擇")})
                      </option>
                    )}
                    {CATALOG_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {tc(catalogCategoryLabel(item))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
                  {tc("音標（選填）")}
                  <input
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={form.phoneticIpa ?? ""}
                    onChange={(event) =>
                      updateForm("phoneticIpa", event.target.value || null)
                    }
                    placeholder={tc("例如：rʌn（不用輸入 / /）")}
                  />
                </label>
                <div className="mt-2 border-t border-[var(--border)] pt-4 md:col-span-2">
                  <h3 className="text-base font-bold text-[var(--text)]">
                    {tc("學習內容")}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tc("中文釋義是學生答題時顯示的主要正確答案；例句用於展示實際用法。")}
                  </p>
                </div>
                <label
                  {...issueFieldMarker("definitionZh")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2"
                >
                  {tc("中文釋義（必填）")}
                  <textarea
                    required
                    data-testid="catalog-definition-zh"
                    className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                    value={form.definitionZh}
                    onChange={(event) =>
                      updateForm("definitionZh", event.target.value)
                    }
                    placeholder={tc("例如：跑步（只填寫此詞義的主要意思）")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("definitionZh")}
                  />
                </label>
                <label
                  {...issueFieldMarker("exampleEn")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("英文例句（選填）")}
                  <textarea
                    className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                    value={form.exampleEn ?? ""}
                    onChange={(event) =>
                      updateForm("exampleEn", event.target.value || null)
                    }
                    placeholder={tc("例如：I run in the park every morning.")}
                  />
                  <small className="font-normal text-[var(--muted)]">
                    {tc("如填英文例句，必須同時填寫對應中文例句。")}
                  </small>
                </label>
                <label
                  {...issueFieldMarker("exampleZh")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("中文例句（選填）")}
                  <textarea
                    className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                    value={form.exampleZh ?? ""}
                    onChange={(event) =>
                      updateForm("exampleZh", event.target.value || null)
                    }
                    placeholder={tc("例如：我每天早上在公園跑步。")}
                  />
                  <small className="font-normal text-[var(--muted)]">
                    {tc("如填中文例句，必須同時填寫對應英文例句。")}
                  </small>
                </label>
                <label
                  {...issueFieldMarker("acceptedAnswersZh")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("其他可接受中文譯法（選填）")}
                  <input
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={listText(form.acceptedAnswersZh)}
                    onChange={(event) =>
                      updateForm(
                        "acceptedAnswersZh",
                        parseList(event.target.value),
                      )
                    }
                    placeholder={tc("例如：奔跑 | 跑（多個答案用 | 分隔）")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("acceptedAnswersZh")}
                  />
                  <small className="font-normal text-[var(--muted)]">
                    {tc(
                      "多個譯法用 | 分隔。記錄其他合理譯法，避免被誤當成錯誤選項；學生題目仍以主要中文釋義顯示唯一正確選項。",
                    )}
                  </small>
                </label>
                <label
                  {...issueFieldMarker("acceptedFormsEn")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("其他可接受英文形式（選填）")}
                  <input
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={listText(form.acceptedFormsEn)}
                    onChange={(event) =>
                      updateForm(
                        "acceptedFormsEn",
                        parseList(event.target.value),
                      )
                    }
                    placeholder={tc("例如：runs | running（多個形式用 | 分隔）")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("acceptedFormsEn")}
                  />
                  <small className="font-normal text-[var(--muted)]">
                    {tc(
                      "多個形式用 | 分隔。記錄其他合理英文形式，避免被誤當成錯誤選項；學生題目仍以上方英文詞顯示唯一正確選項。",
                    )}
                  </small>
                </label>
                <label
                  {...issueFieldMarker("synonymsEn")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("英文近義詞（選填）")}
                  <input
                    className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                    value={listText(form.synonymsEn)}
                    onChange={(event) =>
                      updateForm("synonymsEn", parseList(event.target.value))
                    }
                    placeholder={tc("例如：sprint | jog（多個詞用 | 分隔）")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("synonymsEn")}
                  />
                </label>
                <label
                  {...issueFieldMarker("antonymsEn")}
                  className="grid gap-1 text-xs font-semibold text-[var(--muted)]"
                >
                  {tc("英文反義詞（選填）")}
                  <input
                    className="h-11 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                    value={listText(form.antonymsEn)}
                    onChange={(event) =>
                      updateForm("antonymsEn", parseList(event.target.value))
                    }
                    placeholder={tc("例如：walk | stop（多個詞用 | 分隔）")}
                  />
                  <CatalogIssueLocationNote
                    values={issueLocationValues("antonymsEn")}
                  />
                </label>
                <div className="mt-2 border-t border-[var(--border)] pt-4 md:col-span-2">
                  <h3 className="text-base font-bold text-[var(--text)]">
                    {tc("題目設定")}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tc("干擾項是錯誤選項的來源；系統出題時只會從已填寫的項目中抽選。")}
                  </p>
                </div>
                <fieldset
                  {...issueFieldMarker("distractorZh")}
                  className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:col-span-2"
                >
                  <legend className="px-1 text-xs font-semibold text-[var(--muted)]">
                    {tc("英譯中干擾項（5–6 個）")}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {["步行", "停止", "跳躍", "坐下", "游泳", "慢慢地"].map(
                      (example, index) => (
                        <label
                          key={`distractor-zh-${index}`}
                          {...issueFieldMarker("distractorZh", index)}
                          className="grid gap-1 text-xs font-normal text-[var(--muted)]"
                        >
                          {tc(`中文錯誤選項 ${index + 1}`)}
                          <input
                            className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                            value={form.distractorZh[index] ?? ""}
                            disabled={index > form.distractorZh.length}
                            onChange={(event) =>
                              updateDistractorSlot(
                                "distractorZh",
                                index,
                                event.target.value,
                              )
                            }
                            onBlur={() =>
                              compactDistractorSlots("distractorZh")
                            }
                            placeholder={tc(`例如：${example}`)}
                          />
                          <CatalogIssueLocationNote
                            values={issueLocationValues("distractorZh", index)}
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <small className="font-normal text-[var(--muted)]">
                    {tc(
                      `已填 ${form.distractorZh.filter((item) => item.normalize("NFKC").trim()).length} 個；請順序填寫 5–6 個錯誤但合理的中文選項。`,
                    )}
                  </small>
                </fieldset>
                <fieldset
                  {...issueFieldMarker("distractorEn")}
                  className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:col-span-2"
                >
                  <legend className="px-1 text-xs font-semibold text-[var(--muted)]">
                    {tc("中譯英干擾項（5–6 個）")}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {["walk", "stop", "jump", "sit", "swim", "slowly"].map(
                      (example, index) => (
                        <label
                          key={`distractor-en-${index}`}
                          {...issueFieldMarker("distractorEn", index)}
                          className="grid gap-1 text-xs font-normal text-[var(--muted)]"
                        >
                          {tc(`英文錯誤選項 ${index + 1}`)}
                          <input
                            className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--text)]"
                            value={form.distractorEn[index] ?? ""}
                            disabled={index > form.distractorEn.length}
                            onChange={(event) =>
                              updateDistractorSlot(
                                "distractorEn",
                                index,
                                event.target.value,
                              )
                            }
                            onBlur={() =>
                              compactDistractorSlots("distractorEn")
                            }
                            placeholder={tc(`例如：${example}`)}
                          />
                          <CatalogIssueLocationNote
                            values={issueLocationValues("distractorEn", index)}
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <small className="font-normal text-[var(--muted)]">
                    {tc(
                      `已填 ${form.distractorEn.filter((item) => item.normalize("NFKC").trim()).length} 個；請順序填寫 5–6 個錯誤但合理的英文選項。`,
                    )}
                  </small>
                </fieldset>
              </div>
              <div
                {...issueFieldMarker("enableEnToZh")}
                className="mt-4 flex flex-wrap gap-4 rounded-2xl border border-[var(--border)] p-3 text-sm text-[var(--text)]"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.enableEnToZh}
                    onChange={(event) =>
                      updateForm("enableEnToZh", event.target.checked)
                    }
                  />
                  {tc("啟用英譯中")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.enableZhToEn}
                    onChange={(event) =>
                      updateForm("enableZhToEn", event.target.checked)
                    }
                  />
                  {tc("啟用中譯英")}
                </label>
              </div>
              <CatalogQuestionPreview
                key={selected.senseKey}
                payload={form}
                senseKey={selected.senseKey}
              />
            </fieldset>
            {createExactConflict ? (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]"
              >
                <p className="font-bold">{tc("不能重複新增相同詞義")}</p>
                <p className="mt-1">
                  {tc(
                    createExactConflict === "PENDING"
                      ? "已有相同英文、詞性及中文主要釋義的申請等待審核。請稍後再試；如需確認，請聯絡詞庫審核員。"
                      : "詞庫已經有相同英文、詞性及中文主要釋義。請返回檢查結果並修改原有詞義。",
                  )}
                </p>
              </div>
            ) : null}
            {createExactPrecheckLoading ? (
              <p className="mt-4 text-sm text-[var(--muted)]" role="status">
                {tc("正在檢查是否已有相同詞義…")}
              </p>
            ) : null}
            {retrySource?.conflicts.length ? (
              <section className="mt-4 rounded-2xl border border-[var(--warning)] bg-[var(--warning-bg)] p-4">
                <h3 className="font-bold text-[var(--warning)]">
                  {tc("正式版本與原提案有欄位衝突")}
                </h3>
                <p className="mt-1 text-xs text-[var(--warning)]">
                  {tc(
                    "請逐欄比較原基線、被拒提案及目前正式值，再決定修正版採用哪一個內容。",
                  )}
                </p>
                <div className="mt-3 space-y-3">
                  {retrySource.conflicts.map((conflict) => (
                    <div
                      key={conflict.field}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                    >
                      <p className="text-sm font-bold text-[var(--text)]">
                        {conflict.field}
                      </p>
                      <dl className="mt-2 grid gap-2 text-xs md:grid-cols-3">
                        <div>
                          <dt className="font-semibold text-[var(--muted)]">
                            {tc("原基線")}
                          </dt>
                          <dd className="mt-1 break-words text-[var(--text)]">
                            {retryConflictValueText(conflict.base, tc)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[var(--muted)]">
                            {tc("被拒提案")}
                          </dt>
                          <dd className="mt-1 break-words text-[var(--text)]">
                            {retryConflictValueText(conflict.proposal, tc)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[var(--muted)]">
                            {tc("目前正式值")}
                          </dt>
                          <dd className="mt-1 break-words text-[var(--text)]">
                            {retryConflictValueText(conflict.current, tc)}
                          </dd>
                        </div>
                      </dl>
                      <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--muted)]">
                        {tc("修正版採用")}
                        <select
                          aria-label={`${tc("衝突欄位")} ${conflict.field}`}
                          className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
                          value={retrySource.choices[conflict.field] ?? ""}
                          onChange={(event) => {
                            const choice = event.target
                              .value as CatalogRetryConflictChoice;
                            const nextValue =
                              choice === "PROPOSAL"
                                ? conflict.proposal
                                : conflict.current;
                            setRetrySource((current) =>
                              current
                                ? {
                                    ...current,
                                    choices: {
                                      ...current.choices,
                                      [conflict.field]: choice,
                                    },
                                  }
                                : current,
                            );
                            setForm(
                              (current) =>
                                ({
                                  ...current,
                                  [conflict.field]: nextValue,
                                }) as CatalogPayload,
                            );
                          }}
                        >
                          <option value="">{tc("請選擇")}</option>
                          <option value="CURRENT">
                            {tc("保留目前正式值")}
                          </option>
                          <option value="PROPOSAL">{tc("採用原提案值")}</option>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {retrySource ? (
              <p className="mt-4 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
                <strong>{tc("重新提交修正版")}</strong> · {tc("原審核意見")}：
                {retrySource.reviewNote || tc("未有備註")}。
                {tc("提交後會建立新申請，舊紀錄會保留。")}
              </p>
            ) : null}
            {selected.pendingRequest ? (
              <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
                {tc(
                  canReview && selected.status === "ACTIVE"
                    ? "已有待審核修改；即時停用仍會生效，現有內容申請不會自動重新啟用這個詞義。"
                    : "此詞條已有待審核版本，請先完成該審核。",
                )}
              </p>
            ) : null}
            {retrySource ? (
              <section className="mt-5 rounded-2xl border border-[var(--border)] p-4">
                <h3 className="font-bold text-[var(--text)]">
                  {tc(
                    statusOnlyRetry
                      ? "重新提交狀態申請"
                      : "重新提交內容申請",
                  )}
                </h3>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--muted)]">
                  {tc(statusOnlyRetry ? "狀態變更理由（必填）" : "修改理由（選填）")}
                  <textarea
                    className="min-h-16 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                    value={statusOnlyRetry ? statusReason : reason}
                    onChange={(event) =>
                      statusOnlyRetry
                        ? setStatusReason(event.target.value)
                        : setReason(event.target.value)
                    }
                    placeholder={tc(
                      statusOnlyRetry
                        ? "請說明需要改變學生可用狀態的原因（至少三個字）。"
                        : "簡單說明本次修改內容的原因。",
                    )}
                  />
                </label>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
                  <button
                    type="button"
                    className="ui-button ui-button-quiet"
                    onClick={closeDetailDialog}
                  >
                    {tc("取消")}
                  </button>
                <button
                  type="button"
                  className="ui-button ui-button-primary"
                  disabled={
                    saving ||
                    Boolean(selected.pendingRequest) ||
                    retrySource.conflicts.some(
                      (conflict) => !retrySource.choices[conflict.field],
                    )
                  }
                  onClick={() => void submitChange(retrySource.kind)}
                >
                  {saving
                    ? tc("提交中…")
                    : statusOnlyRetry
                      ? tc("重新提交狀態申請")
                      : tc("修改後重新提交")}
                </button>
                </div>
              </section>
            ) : (
              <>
                <section className="mt-5 rounded-2xl border border-[var(--border)] p-4">
                  <h3 className="font-bold text-[var(--text)]">
                    {tc(
                      selected.hasSense === false
                        ? "提交新詞義"
                        : "提交內容修改",
                    )}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tc(
                      "提交後會送交有權限的老師或管理員審核；批准前不會改變學生使用的正式版本。",
                    )}
                  </p>
                  <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--muted)]">
                    {tc(
                      selected.hasSense === false
                        ? "新增說明（選填）"
                        : "修改理由（選填）",
                    )}
                    <textarea
                      className="min-h-16 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={tc(
                        selected.hasSense === false
                          ? "例如：補充課堂需要的新詞義。"
                          : "簡單說明本次修改內容的原因。",
                      )}
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
                    <button
                      type="button"
                      className="ui-button ui-button-quiet"
                      onClick={closeDetailDialog}
                    >
                      {tc("取消")}
                    </button>
                  <button
                    type="button"
                    className="ui-button ui-button-primary"
                    disabled={
                      saving ||
                      Boolean(selected.pendingRequest) ||
                      Boolean(createExactConflict) ||
                      createExactPrecheckLoading
                    }
                    onClick={() =>
                      void submitChange(
                        selected.hasSense === false ? "CREATE" : "UPDATE",
                      )
                    }
                  >
                    {saving
                      ? tc("提交中…")
                      : tc(
                          selected.hasSense === false
                            ? "提交新詞義，送交審核"
                            : "提交內容修改，送交審核",
                        )}
                  </button>
                  </div>
                </section>
                {selected.status === "ACTIVE" ||
                selected.status === "RETIRED" ? (
                  <section className="mt-4 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] p-4">
                    <h3 className="font-bold text-[var(--danger)]">
                      {tc("狀態管理")}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--danger)]">
                      {tc(
                        selected.status === "ACTIVE"
                          ? "停用只會決定此詞義是否可出現在新的學習題目中；上方尚未提交的內容修改不會一併送出。"
                          : "重新啟用只會申請恢復學生使用；上方尚未提交的內容修改不會一併送出。",
                      )}
                    </p>
                    <label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--danger)]">
                      {tc(
                        selected.status === "ACTIVE"
                          ? "停用理由（必填）"
                          : "重新啟用理由（必填）",
                      )}
                      <textarea
                        className="min-h-16 rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                        value={statusReason}
                        onChange={(event) => setStatusReason(event.target.value)}
                        placeholder={tc(
                          selected.status === "ACTIVE"
                            ? "請說明不應再供學生學習此詞義的原因（至少三個字）。"
                            : "請說明可以重新供學生使用此詞義的原因（至少三個字）。",
                        )}
                      />
                    </label>
                    {selected.status === "ACTIVE" && canReview ? (
                      <p className="mt-2 text-xs font-semibold text-[var(--danger)]">
                        {tc(
                          "你有審核權限：按下「立即停用」並確認後會即時生效；學生歷史及審核記錄會保留。",
                        )}
                      </p>
                    ) : null}
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        className="ui-button ui-button-danger"
                        disabled={
                          saving ||
                          (!canReview && Boolean(selected.pendingRequest)) ||
                          (selected.status === "RETIRED" &&
                            Boolean(selected.pendingRequest))
                        }
                      onClick={() =>
                        void submitChange(
                          selected.status === "ACTIVE"
                            ? "RETIRE"
                            : "REACTIVATE",
                        )
                      }
                    >
                      {tc(
                        selected.status === "ACTIVE"
                          ? canReview
                            ? "立即停用"
                            : "提交停用申請"
                          : "提交重新啟用申請",
                      )}
                    </button>
                    </div>
                  </section>
                ) : null}
              </>
            )}
              </>
            )}
          </section>
        </div>
      ) : null}
      {feedbackTarget ? (
        <CatalogFeedbackDialog
          key={`${feedbackTarget.senseKey ?? "general"}:${feedbackTarget.term ?? ""}`}
          target={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSubmitted={() =>
            setMessage(tc("意見已提交；你可以在「我的待辦」查看處理狀態。"))
          }
        />
      ) : null}
      {historyTarget ? (
        <CatalogSenseHistoryDrawer
          senseKey={historyTarget.senseKey}
          term={historyTarget.term}
          canReview={canReview}
          onClose={() => {
            const target = historyTarget;
            setHistoryTarget(null);
            window.setTimeout(() => {
              window.scrollTo({ top: target.scrollY });
              const row = focusCatalogHistoryTrigger(
                target.rowId,
                tc("查看歷史"),
              );
              row?.classList.add("ring-2", "ring-[var(--primary)]");
              window.setTimeout(
                () => row?.classList.remove("ring-2", "ring-[var(--primary)]"),
                1600,
              );
            }, 0);
          }}
          onOpenFullHistory={() => {
            const target = historyTarget;
            const nextState = {
              initialized: catalogInitialized,
              rows,
              counts,
              facets,
              filters,
              searchInput,
              search,
              selectedSenseKeys: [...exportSenseKeys],
              filteredTotal,
              nextCursor,
              workspaceSignature: catalogWorkspaceSignatureRef.current,
              scrollY: target.scrollY,
              activeRowId: target.rowId,
            };
            persistedSnapshotRef.current = nextState;
            onPersistedState(nextState);
            setHistoryTarget(null);
            onOpenHistory(target.senseKey);
          }}
        />
      ) : null}
    </div>
  );
}

type WorkspaceTab = "work" | "catalog" | "bulk" | "history";

export default function CatalogGovernanceWorkspace() {
  const { tc } = useLocale();
  const [tab, setTab] = useState<WorkspaceTab>("catalog");
  const [canReview, setCanReview] = useState(false);
  const [actorUserId, setActorUserId] = useState("");
  const [bulkBatchId, setBulkBatchId] = useState<string | null>(null);
  const [bulkEnabled, setBulkEnabled] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [historySenseKey, setHistorySenseKey] = useState<string | null>(null);
  const [catalogSenseKey, setCatalogSenseKey] = useState<string | null>(null);
  const [retryRequestId, setRetryRequestId] = useState<string | null>(null);
  const [catalogResetVersion, setCatalogResetVersion] = useState(0);
  const [reviewActionNotice, setReviewActionNotice] =
    useState<ReviewActionNotice | null>(null);
  const [catalogPersistedState, dispatchCatalogPersistedState] = useReducer(
    catalogPersistedReducer,
    INITIAL_CATALOG_PERSISTED_STATE,
  );
  const accessGenerationRef = useRef(0);
  const confirmedBulkEnabledRef = useRef(false);
  const persistCatalogState = useCallback((state: CatalogPersistedState) => {
    dispatchCatalogPersistedState({ type: "SAVE", state });
  }, []);

  const updateWorkspaceAccess = useCallback(
    (access: CatalogWorkspaceAccess) => {
      setCanReview(access.canReview);
      setActorUserId(access.actorUserId);
      if (confirmedBulkEnabledRef.current && !access.bulkEnabled) {
        setCatalogResetVersion((current) => current + 1);
        dispatchCatalogPersistedState({ type: "RESET" });
      }
      confirmedBulkEnabledRef.current = access.bulkEnabled;
      setBulkEnabled(access.bulkEnabled);
      setHistoryEnabled(access.historyEnabled);
      if (!access.bulkEnabled) setBulkBatchId(null);
      if (!access.historyEnabled) setHistorySenseKey(null);
      setTab((current) =>
        (current === "bulk" && access.bulkEnabled === false) ||
        (current === "history" && access.historyEnabled === false)
          ? "catalog"
          : current,
      );
    },
    [],
  );

  const refreshAccess = useCallback(async () => {
    const generation = ++accessGenerationRef.current;
    try {
      const response = await fetch("/api/catalog/access", {
        cache: "no-store",
      });
      if (generation !== accessGenerationRef.current) return;
      if (response.status === 401 || response.status === 403) {
        updateWorkspaceAccess({
          canReview: false,
          actorUserId: "",
          bulkEnabled: false,
          historyEnabled: false,
        });
        return;
      }
      if (!response.ok) return;
      const payload = (await response.json()) as {
        canReview?: boolean;
        actorUserId?: string;
        bulkEnabled?: boolean;
        historyEnabled?: boolean;
      };
      if (generation === accessGenerationRef.current) {
        updateWorkspaceAccess({
          canReview: payload.canReview === true,
          actorUserId: payload.actorUserId ?? "",
          bulkEnabled: payload.bulkEnabled === true,
          historyEnabled: payload.historyEnabled === true,
        });
      }
    } catch {
      // Keep the last confirmed access state during a transient read failure;
      // every reviewer mutation remains protected by the server-side guard.
    }
  }, [updateWorkspaceAccess]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshAccess();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshAccess();
    }, 30_000);
    const onFocus = () => {
      void refreshAccess();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshAccess();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      accessGenerationRef.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshAccess]);

  const tabs: Array<{ id: WorkspaceTab; label: string; detail: string }> = [
    { id: "work", label: tc("我的待辦"), detail: tc("修正、審核及最近結果") },
    {
      id: "catalog",
      label: tc("完整詞庫"),
      detail: tc("瀏覽、篩選及逐條修改"),
    },
    ...(bulkEnabled
      ? [
          {
            id: "bulk" as const,
            label: tc("批量提交"),
            detail: tc("預覽、解決衝突及整批審核"),
          },
        ]
      : []),
    ...(historyEnabled
      ? [
          {
            id: "history" as const,
            label: tc("修改歷史"),
            detail: tc("查看批次及詞條時間線"),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 overflow-x-clip">
      {reviewActionNotice ? (
        <div
          data-testid="catalog-review-action-notice"
          role={reviewActionNotice.type === "error" ? "alert" : "status"}
          className={`fixed right-4 top-4 z-[70] max-w-md rounded-xl border bg-[var(--surface)] p-4 shadow-xl ${reviewActionNotice.type === "error" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--success)] text-[var(--success)]"}`}
        >
          <strong className="text-[var(--text)]">
            {reviewActionNotice.term}
          </strong>
          <p className="mt-1 text-sm">{reviewActionNotice.message}</p>
          <button
            type="button"
            className="ui-button ui-button-quiet ui-button-small mt-3"
            onClick={() => setReviewActionNotice(null)}
          >
            {tc("關閉")}
          </button>
        </div>
      ) : null}
      <nav
        aria-label={tc("詞庫工作區") as string}
        className={`grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 ${tabs.length === 4 ? "sm:grid-cols-4" : tabs.length === 3 ? "sm:grid-cols-3" : tabs.length === 2 ? "sm:grid-cols-2" : ""}`}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            className={`rounded-xl px-4 py-3 text-left transition-colors ${tab === item.id ? "bg-[var(--primary)] text-white" : "text-[var(--text)] hover:bg-[var(--border-soft)]"}`}
            onClick={() => {
              if (item.id === "history") setHistorySenseKey(null);
              setTab(item.id);
            }}
          >
            <strong className="block text-sm">{item.label}</strong>
            <span
              className={`mt-1 block text-xs ${tab === item.id ? "text-white/75" : "text-[var(--muted)]"}`}
            >
              {item.detail}
            </span>
          </button>
        ))}
      </nav>
      {tab === "work" ? (
        <CatalogWorkItemsWorkspace
          bulkEnabled={bulkEnabled}
          onOpenCatalog={(senseKey) => {
            setCatalogSenseKey(senseKey ?? null);
            setTab("catalog");
          }}
          onOpenBatch={(batchId) => {
            if (bulkEnabled) {
              setBulkBatchId(batchId);
              setTab("bulk");
            }
          }}
          onRetryRequest={(requestId) => {
            setRetryRequestId(requestId);
            setTab("catalog");
          }}
        />
      ) : tab === "catalog" ? (
        <CatalogOverviewWorkspace
          key={catalogResetVersion}
          bulkEnabled={bulkEnabled}
          historyEnabled={historyEnabled}
          onReviewActionNotice={setReviewActionNotice}
          initialRetryRequestId={retryRequestId}
          onRetryConsumed={() => setRetryRequestId(null)}
          initialSenseKey={catalogSenseKey}
          onInitialSenseConsumed={() => setCatalogSenseKey(null)}
          persistedState={catalogPersistedState}
          onPersistedState={persistCatalogState}
          onOpenHistory={(senseKey) => {
            setHistorySenseKey(senseKey);
            setTab("history");
          }}
        />
      ) : tab === "bulk" ? (
        <CatalogBulkSubmissionWorkspace
          canReview={canReview}
          actorUserId={actorUserId}
          initialBatchId={bulkBatchId}
        />
      ) : (
        <CatalogHistoryWorkspace
          canReview={canReview}
          bulkEnabled={bulkEnabled}
          initialSenseKey={historySenseKey}
          onBackToCatalog={() => {
            setHistorySenseKey(null);
            setTab("catalog");
          }}
          onOpenCorrectiveBatch={(batchId) => {
            setBulkBatchId(batchId);
            setTab("bulk");
          }}
        />
      )}
    </div>
  );
}
