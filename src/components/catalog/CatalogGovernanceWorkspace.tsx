"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import ErrorBanner from "@/components/ErrorBanner";
import { rosterFetch } from "@/lib/roster-client";
import { networkErrorMessage, responseErrorMessage } from "@/lib/api-error";
import { CATALOG_CATEGORIES } from "@/lib/catalog/taxonomy";
import { catalogExportAvailability, hasCatalogExportTarget } from "@/lib/catalog/workspace-selection";
import CatalogBulkSubmissionWorkspace from "@/components/catalog/CatalogBulkSubmissionWorkspace";
import CatalogHistoryWorkspace from "@/components/catalog/CatalogHistoryWorkspace";
import CatalogQuestionPreview from "@/components/catalog/CatalogQuestionPreview";
import CatalogFeedbackDialog, { type CatalogFeedbackTarget } from "@/components/catalog/CatalogFeedbackDialog";
import CatalogWorkItemsWorkspace from "@/components/catalog/CatalogWorkItemsWorkspace";
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

type CatalogStatus = "DRAFT" | "ACTIVE" | "RETIRED";
type FilterStatus = "ALL" | CatalogStatus | "BLOCKED" | "VALIDATION_FAILED" | "PENDING";
type RestrictedPendingRequest = { restricted: true; kind: string; status: string };
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
  revision: number | null;
  latestRevision: number | null;
  approvedRevisionId: string | null;
  primaryDisposition: string;
  eligibilityResult: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  pendingRequest: RestrictedPendingRequest | { restricted?: false; id: string; kind: string; status: string; proposerId: string; baseRevision: number | null; createdAt: string } | null;
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
  pendingRequest: RestrictedPendingRequest | { restricted?: false; id: string; kind: string; status: string; revision: number; payload: CatalogPayload; reason: string | null; proposerId: string; createdAt: string } | null;
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
type PendingResponse = { requests: PendingRequest[]; hasMore: boolean; signature: string; mutationRevision: number };
type CatalogListResponse = {
  rows: CatalogRow[];
  counts: Record<string, number>;
  filteredTotal: number;
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

function parseList(value: string) {
  return value.split("|").map((item) => item.normalize("NFKC").trim()).filter(Boolean);
}

function listText(value: readonly string[] | null | undefined) {
  return (value ?? []).join(" | ");
}

function retryConflictValueText(value: unknown, tc: (value: string) => string): string {
  if (value === null || value === undefined || value === "") return tc("（空白）");
  if (Array.isArray(value)) return value.length ? value.join(" | ") : tc("（空白）");
  if (typeof value === "boolean") return value ? tc("啟用") : tc("停用");
  return String(value);
}

function visiblePendingRequestId(value: Detail["pendingRequest"]): string | null {
  return value && "id" in value ? value.id : null;
}

function visiblePendingRequestPayload(value: Detail["pendingRequest"]): CatalogPayload | null {
  return value && "payload" in value ? value.payload : null;
}

function normalizeCatalogPayload(value: unknown, fallback: CatalogPayload = EMPTY_PAYLOAD): CatalogPayload {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: keyof CatalogPayload) => typeof source[key] === "string" ? source[key] as string : fallback[key] as string;
  const nullableText = (key: "phoneticIpa" | "exampleEn" | "exampleZh" | "sourceReference" | "contributorRef" | "changeNote" | "retirementReason") => {
    const item = source[key];
    return typeof item === "string" ? item : item === null ? null : fallback[key];
  };
  const list = (key: "acceptedAnswersZh" | "acceptedFormsEn" | "synonymsEn" | "antonymsEn" | "distractorZh" | "distractorEn") => {
    const item = source[key];
    return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [...fallback[key]];
  };
  const level = source.level === "A1" || source.level === "A2" || source.level === "B1" || source.level === "B2"
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
    enableEnToZh: typeof source.enableEnToZh === "boolean" ? source.enableEnToZh : fallback.enableEnToZh,
    distractorZh: list("distractorZh"),
    enableZhToEn: typeof source.enableZhToEn === "boolean" ? source.enableZhToEn : fallback.enableZhToEn,
    distractorEn: list("distractorEn"),
    sourceReference: nullableText("sourceReference"),
    contributorRef: nullableText("contributorRef"),
    changeNote: nullableText("changeNote"),
    retirementReason: nullableText("retirementReason"),
  };
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

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function CatalogOverviewWorkspace({
  bulkEnabled,
  historyEnabled,
  onOpenHistory,
  initialRetryRequestId,
  onRetryConsumed,
  initialSenseKey,
  onInitialSenseConsumed,
}: {
  bulkEnabled: boolean;
  historyEnabled: boolean;
  onOpenHistory: (senseKey: string) => void;
  initialRetryRequestId: string | null;
  onRetryConsumed: () => void;
  initialSenseKey: string | null;
  onInitialSenseConsumed: () => void;
}) {
  const { tc } = useLocale();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [canReview, setCanReview] = useState(false);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [status, setStatus] = useState<FilterStatus>("ALL");
  const [level, setLevel] = useState("ALL");
  const [direction, setDirection] = useState("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exportSenseKeys, setExportSenseKeys] = useState<Set<string>>(new Set());
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogInitialized, setCatalogInitialized] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelectedState] = useState<Detail | null>(null);
  const [form, setForm] = useState<CatalogPayload>(EMPTY_PAYLOAD);
  const [reason, setReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<CatalogFeedbackTarget | null>(null);
  const [retrySource, setRetrySource] = useState<RetrySource | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const pendingSignatureRef = useRef("");
  const pendingRefreshInFlightRef = useRef(false);
  const pendingBackoffUntilRef = useRef(0);
  const catalogLoadGenerationRef = useRef(0);
  const catalogLoadAbortRef = useRef<AbortController | null>(null);
  const catalogForegroundInFlightRef = useRef(false);
  const catalogLoadMoreGenerationRef = useRef(0);
  const catalogLoadMoreAbortRef = useRef<AbortController | null>(null);
  const catalogWorkspaceSignatureRef = useRef("");
  const catalogQueryKeyRef = useRef("");
  const selectedPendingRequestIdRef = useRef<string | null>(null);
  const submitOperationRef = useRef<PendingClientOperation | null>(null);
  const formBaselineRef = useRef<CatalogPayload>(EMPTY_PAYLOAD);
  const dialogIntentRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);

  const loadFormForDialog = useCallback((payload: CatalogPayload) => {
    formBaselineRef.current = payload;
    setForm(payload);
  }, []);

  const beginDialogIntent = useCallback(() => {
    const intent = ++dialogIntentRef.current;
    detailAbortRef.current?.abort();
    retryAbortRef.current?.abort();
    detailAbortRef.current = null;
    retryAbortRef.current = null;
    return intent;
  }, []);

  const setSelected = useCallback((value: Detail | null | ((current: Detail | null) => Detail | null)) => {
    beginDialogIntent();
    setSelectedState(value);
  }, [beginDialogIntent]);

  const isCurrentDialogIntent = useCallback((intent: number) => intent === dialogIntentRef.current, []);

  const closeDetailDialog = useCallback(() => {
    setSelected(null);
    setRetrySource(null);
    submitOperationRef.current = null;
  }, [setSelected]);

  useEffect(() => () => {
    beginDialogIntent();
  }, [beginDialogIntent]);

  const catalogQueryKey = useMemo(() => JSON.stringify({ search, status, level, direction }), [direction, level, search, status]);
  useEffect(() => {
    catalogQueryKeyRef.current = catalogQueryKey;
  }, [catalogQueryKey]);

  const catalogUrl = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams({ status, level, direction, limit: "100" });
    if (search) params.set("q", search);
    if (cursor) params.set("cursor", cursor);
    return `/api/catalog?${params.toString()}`;
  }, [direction, level, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.normalize("NFKC").trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCatalog = useCallback(async (options?: { background?: boolean }) => {
    if (options?.background && catalogForegroundInFlightRef.current) return null;
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
        const response = await fetch(catalogUrl(), { cache: "no-store", signal: controller.signal });
        if (response.status === 409 && attempt < 2) continue;
        if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
        const payload = await response.json() as CatalogListResponse;
        let reviewPayload: PendingResponse | null = null;
        let effectiveCanReview = payload.canReview;
        if (effectiveCanReview && pendingSignatureRef.current !== payload.workspaceSignature) {
          const reviewResponse = await fetch("/api/catalog/requests?status=PENDING", { cache: "no-store", signal: controller.signal });
          if (reviewResponse.status === 403) {
            if (attempt < 2) continue;
            effectiveCanReview = false;
          } else {
            if (reviewResponse.status === 409 && attempt < 2) continue;
            if (!reviewResponse.ok) throw new Error(await responseErrorMessage(reviewResponse, tc));
            const rawReviewPayload = await reviewResponse.json() as PendingResponse;
            reviewPayload = {
              ...rawReviewPayload,
              requests: rawReviewPayload.requests.map((request) => ({
                ...request,
                payload: normalizeCatalogPayload(request.payload),
              })),
            };
            if (reviewPayload.signature !== payload.workspaceSignature) {
              if (attempt < 2) continue;
              throw new Error(tc("词库刚刚有更新，请重新载入。"));
            }
          }
        }
        if (generation !== catalogLoadGenerationRef.current) return null;
        setRows(payload.rows);
        setCounts(payload.counts);
        setFilteredTotal(payload.filteredTotal);
        setNextCursor(payload.nextCursor);
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
        return { rows: payload.rows, pending: reviewPayload?.requests ?? null };
      }
      throw new Error(tc("词库刚刚有更新，请重新载入。"));
    } catch (cause) {
      if (generation !== catalogLoadGenerationRef.current || isAbortError(cause)) return null;
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
      return null;
    } finally {
      if (catalogLoadAbortRef.current === controller) catalogLoadAbortRef.current = null;
      if (generation === catalogLoadGenerationRef.current && !options?.background) {
        catalogForegroundInFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [catalogUrl, tc]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCatalog(); }, 0);
    return () => {
      window.clearTimeout(timer);
      catalogLoadGenerationRef.current += 1;
      catalogLoadAbortRef.current?.abort();
      catalogLoadMoreGenerationRef.current += 1;
      catalogLoadMoreAbortRef.current?.abort();
    };
  }, [loadCatalog]);

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
      const response = await fetch(catalogUrl(cursor), { cache: "no-store", signal: controller.signal });
      if (response.status === 409 || response.status === 422) {
        if (generation !== catalogLoadMoreGenerationRef.current || requestQueryKey !== catalogQueryKeyRef.current) return;
        setMessage(tc("词库刚刚有更新，列表已由第一页重新载入。"));
        await loadCatalog();
        return;
      }
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const payload = await response.json() as CatalogListResponse;
      if (
        generation !== catalogLoadMoreGenerationRef.current
        || requestQueryKey !== catalogQueryKeyRef.current
        || payload.workspaceSignature !== requestSignature
      ) return;
      setRows((current) => {
        const ids = new Set(current.map((row) => row.id));
        return [...current, ...payload.rows.filter((row) => !ids.has(row.id))];
      });
      setCounts(payload.counts);
      setFilteredTotal(payload.filteredTotal);
      setNextCursor(payload.nextCursor);
    } catch (cause) {
      if (generation !== catalogLoadMoreGenerationRef.current || isAbortError(cause)) return;
      setError(cause instanceof Error ? cause.message : tc(networkErrorMessage(cause)));
    } finally {
      if (catalogLoadMoreAbortRef.current === controller) catalogLoadMoreAbortRef.current = null;
      if (generation === catalogLoadMoreGenerationRef.current) setLoadingMore(false);
    }
  }, [catalogQueryKey, catalogUrl, loadCatalog, loadingMore, nextCursor, tc]);

  useEffect(() => {
    selectedPendingRequestIdRef.current = visiblePendingRequestId(selected?.pendingRequest ?? null);
  }, [selected?.pendingRequest]);

  const refreshPending = useCallback(async () => {
    if (!canReview || saving || pendingRefreshInFlightRef.current || document.visibilityState === "hidden" || Date.now() < pendingBackoffUntilRef.current) return;
    pendingRefreshInFlightRef.current = true;
    try {
      const response = await fetch("/api/catalog/requests?status=PENDING&view=signature", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setCanReview(false);
        setPending([]);
        setPendingHasMore(false);
        pendingSignatureRef.current = "";
        setSelected((current) => current?.pendingRequest ? null : current);
        setMessage(tc("审核权限已经更新，待审核工具已收起。"));
        return;
      }
      if (response.status === 503) {
        pendingBackoffUntilRef.current = Date.now() + 30_000;
        return;
      }
      if (!response.ok) return;
      pendingBackoffUntilRef.current = 0;
      const payload = await response.json() as { signature: string; mutationRevision: number };
      if (payload.signature === pendingSignatureRef.current) return;
      const previouslySelectedRequestId = selectedPendingRequestIdRef.current;
      const loaded = await loadCatalog({ background: true });
      if (!loaded?.pending || !previouslySelectedRequestId) return;
      const pendingIds = new Set(loaded.pending.map((request) => request.id));
      if (!pendingIds.has(previouslySelectedRequestId)) {
        setSelected((current) => visiblePendingRequestId(current?.pendingRequest ?? null) === previouslySelectedRequestId ? null : current);
        setMessage(tc("这项申请已经处理，画面已更新。"));
      }
    } finally {
      pendingRefreshInFlightRef.current = false;
    }
  }, [canReview, loadCatalog, saving, setSelected, tc]);

  useEffect(() => {
    if (!canReview) return;
    const onFocus = () => { void refreshPending(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshPending();
    };
    const interval = window.setInterval(() => { void refreshPending(); }, 10_000);
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
    const identity = `governance_${window.crypto.randomUUID().replaceAll("-", "")}`;
    const initialPayload = { ...EMPTY_PAYLOAD, acceptedAnswersZh: [], acceptedFormsEn: [], synonymsEn: [], antonymsEn: [], distractorZh: [], distractorEn: [] };
    setSelectedState({ id: null, senseKey: identity, catalogKey: null, sourceFile: null, sourceRow: null, status: "DRAFT", revision: null, latestRevision: null, approvedRevisionId: null, primaryDisposition: "CREATED_DRAFT", eligibilityResult: "DRAFT_BLOCKED", hasSense: false, issues: null, payload: EMPTY_PAYLOAD, pendingRequest: null });
    loadFormForDialog(initialPayload);
    setReason("");
    setReviewNote("");
    setRetrySource(null);
    submitOperationRef.current = null;
  }

  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetailDialog();
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
  }, [closeDetailDialog, selected]);

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

  const openDetailBySenseKey = useCallback(async (senseKey: string) => {
    const intent = beginDialogIntent();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setError(null);
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(senseKey)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!isCurrentDialogIntent(intent)) return;
      if (!response.ok) {
        const message = await responseErrorMessage(response, tc);
        if (!isCurrentDialogIntent(intent)) return;
        throw new Error(message);
      }
      const detail = await response.json() as Detail;
      if (!isCurrentDialogIntent(intent)) return;
      const currentPayload = detail.payload ? normalizeCatalogPayload(detail.payload) : null;
      const pendingRequest = detail.pendingRequest && "payload" in detail.pendingRequest
        ? { ...detail.pendingRequest, payload: normalizeCatalogPayload(detail.pendingRequest.payload, currentPayload ?? EMPTY_PAYLOAD) }
        : detail.pendingRequest;
      setSelectedState({ ...detail, payload: currentPayload, pendingRequest });
      loadFormForDialog(visiblePendingRequestPayload(pendingRequest) ?? currentPayload ?? EMPTY_PAYLOAD);
      setReason("");
      setReviewNote("");
      setRetrySource(null);
      submitOperationRef.current = null;
    } catch (cause) {
      if (!isCurrentDialogIntent(intent) || isAbortError(cause)) return;
      setError(cause instanceof Error ? cause.message : tc("讀取詞條失敗"));
    } finally {
      if (detailAbortRef.current === controller) detailAbortRef.current = null;
    }
  }, [beginDialogIntent, isCurrentDialogIntent, loadFormForDialog, tc]);

  async function openDetail(row: CatalogRow) {
    if (row.senseKey) await openDetailBySenseKey(row.senseKey);
  }

  useEffect(() => {
    if (!initialSenseKey) return;
    const timer = window.setTimeout(() => {
      void openDetailBySenseKey(initialSenseKey).finally(onInitialSenseConsumed);
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
        const response = await fetch(`/api/catalog/requests/${encodeURIComponent(initialRetryRequestId)}/retry`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!isCurrentDialogIntent(intent)) return;
        if (!response.ok) {
          const message = await responseErrorMessage(response, tc);
          if (!isCurrentDialogIntent(intent)) return;
          throw new Error(message);
        }
        const body = await response.json() as { replay: true; successorId: string; senseKey: string | null } | { replay: false; retry: {
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
        } };
        if (!isCurrentDialogIntent(intent)) return;
        if (body.replay) {
          setMessage(tc("呢項修正版已經成功提交，畫面已開啟現有後繼申請。"));
          if (body.senseKey) await openDetailBySenseKey(body.senseKey);
          return;
        }
        const retry = body.retry;
        const retryPayload = normalizeCatalogPayload(retry.payload);
        setSelectedState({
          id: retry.sourceRowId,
          senseKey: retry.senseKey ?? `governance_${window.crypto.randomUUID().replaceAll("-", "")}`,
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
          issues: null,
          payload: retryPayload,
          pendingRequest: null,
        });
        loadFormForDialog(retryPayload);
        setReason(retry.previousReason ?? "");
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
        submitOperationRef.current = null;
      } catch (cause) {
        if (isCurrentDialogIntent(intent) && !isAbortError(cause)) {
          setError(cause instanceof Error ? cause.message : tc("讀取重新提交草稿失敗"));
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
  }, [beginDialogIntent, initialRetryRequestId, isCurrentDialogIntent, loadFormForDialog, onRetryConsumed, openDetailBySenseKey, tc]);

  function openSelectedHistory() {
    if (!selected?.senseKey) return;
    const loadedFormBaseline = visiblePendingRequestPayload(selected.pendingRequest) ?? formBaselineRef.current;
    const hasUnsavedInput = clientOperationFingerprint(form) !== clientOperationFingerprint(loadedFormBaseline)
      || reason.trim().length > 0
      || reviewNote.trim().length > 0;
    if (hasUnsavedInput && !window.confirm(tc("你尚有未提交的詞條內容；開啟修改歷史後，這些輸入不會保留。確定繼續？"))) return;
    const senseKey = selected.senseKey;
    closeDetailDialog();
    onOpenHistory(senseKey);
  }

  function updateForm<K extends keyof CatalogPayload>(key: K, value: CatalogPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitChange(kind: "UPDATE" | "CREATE" | "RETIRE" | "REACTIVATE") {
    if (!selected || !selected.senseKey) return;
    if (retrySource && retrySource.kind !== kind) {
      setError(tc("呢個係被拒絕申請嘅修正版；請用原本相同嘅操作類型重新提交。"));
      return;
    }
    const immediate = kind === "RETIRE" && canReview;
    const trimmedReason = reason.trim();
    if ((kind === "RETIRE" || kind === "REACTIVATE") && trimmedReason.length < 3) {
      setError(tc("停用或重新啟用詞義前必須填寫至少三個字的理由。"));
      return;
    }
    if (trimmedReason.length > 2000) {
      setError(tc("修改、停用或重新啟用理由不可超過 2,000 字。"));
      return;
    }
    const loadedFormBaseline = visiblePendingRequestPayload(selected.pendingRequest) ?? formBaselineRef.current;
    const changedFields = (Object.keys(form) as Array<keyof CatalogPayload>).filter(
      (field) => clientOperationFingerprint(form[field]) !== clientOperationFingerprint(loadedFormBaseline[field]),
    );
    if (
      (kind === "RETIRE" || kind === "REACTIVATE")
      && changedFields.length > 0
    ) {
      setError(tc("你修改咗詞條內容。請先提交 UPDATE 並完成審核，之後再停用或重新啟用詞義。"));
      return;
    }
    if (kind !== "CREATE" && selected.revision === null) {
      setError(tc("詞義版本已經改變，請重新載入後再操作。"));
      return;
    }
    if (retrySource?.conflicts.some((conflict) => !retrySource.choices[conflict.field])) {
      setError(tc("正式版本同原提案改過同一欄；請先逐欄選擇保留目前值或採用原提案。"));
      return;
    }
    if (immediate && !window.confirm(tc("这个词义会立即停止出现在新学习题目；学生历史会保留。确定停用？"))) return;
    const submitIntent = dialogIntentRef.current;
    const submittedSenseKey = selected.senseKey;
    setSaving(true); setError(null); setMessage(null);
    try {
      const retryResolvedBaseline = retrySource?.kind === "UPDATE"
        ? retrySource.conflicts.reduce((current, conflict) => ({
            ...current,
            [conflict.field]: retrySource.choices[conflict.field] === "PROPOSAL" ? conflict.proposal : conflict.current,
          }), retrySource.mergeBaseline)
        : null;
      const requestBody = {
        kind,
        senseKey: selected.senseKey,
        sourceRowId: retrySource?.sourceRowId ?? (selected.sourceFile && selected.sourceFile !== "governance" ? selected.id : undefined),
        expectedRevision: kind === "CREATE" ? undefined : selected.revision,
        payload: kind === "UPDATE" || kind === "CREATE" ? form : undefined,
        reason: trimmedReason || undefined,
        immediate,
        supersedesRequestId: retrySource?.id,
        retryConflictChoices: retrySource?.kind === "UPDATE" ? retrySource.choices : undefined,
        retryPayloadPatch: retryResolvedBaseline ? catalogRetryPayloadPatch(retryResolvedBaseline, form) : undefined,
      };
      const fingerprint = clientOperationFingerprint(requestBody);
      submitOperationRef.current = pendingClientOperation(submitOperationRef.current, fingerprint, () => window.crypto.randomUUID());
      const response = await rosterFetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: submitOperationRef.current.operationId, ...requestBody }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const result = await response.json() as { status: string; immediate?: boolean };
      submitOperationRef.current = null;
      const refreshedCatalog = await loadCatalog();
      if (!isCurrentDialogIntent(submitIntent)) return;
      setRetrySource(null);
      setMessage(result.immediate && result.status === "APPROVED"
        ? tc("词义已停用；不会再出现在新学习题目，既有历史仍会保留。")
        : tc("已提交草稿，等待一位有权限的老师或管理员审核。"));
      if (kind === "CREATE" || immediate) { closeDetailDialog(); return; }
      if (refreshedCatalog) await openDetailBySenseKey(submittedSenseKey);
    } catch (cause) {
      if (isCurrentDialogIntent(submitIntent)) {
        setError(cause instanceof Error ? cause.message : tc("提交詞庫修改失敗"));
      }
    } finally { setSaving(false); }
  }

  async function exportSelectedUpdates() {
    const senseKeys = [...exportSenseKeys];
    if (!senseKeys.length || senseKeys.length > 200) return;
    setSaving(true); setError(null);
    try {
      const response = await rosterFetch("/api/catalog/submissions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senseKeys }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "catalog-update.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(tc("已匯出所選詞條；請保留系統欄位後修改內容。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : tc("匯出詞條失敗")); }
    finally { setSaving(false); }
  }

  function toggleExportSelection(senseKey: string, checked: boolean) {
    if (checked && !exportSenseKeys.has(senseKey) && exportSenseKeys.size >= 200) {
      setMessage(tc("每次最多選取 200 個詞條；請先匯出或清除全部選取。"));
      return;
    }
    setExportSenseKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(senseKey);
      else next.delete(senseKey);
      return next;
    });
  }

  async function reviewRequest(request: PendingRequest, decision: "APPROVE" | "REJECT") {
    setSaving(true); setError(null); setMessage(null);
    try {
      const note = reviewNotes[request.id] ?? (visiblePendingRequestId(selected?.pendingRequest ?? null) === request.id ? reviewNote : "");
      const response = await rosterFetch(`/api/catalog/requests/${encodeURIComponent(request.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, expectedRevision: request.revision, reviewNote: note.trim() }) });
      if (!response.ok) throw new Error(await responseErrorMessage(response, tc));
      const result = await response.json() as ReviewMutationResult;
      const actualStatus = result.request.status;
      setMessage(result.replay
        ? actualStatus === "APPROVED"
          ? tc("这项申请已经批准，画面已更新。")
          : actualStatus === "REJECTED"
            ? tc("这项申请已经拒绝，画面已更新。")
            : tc("这项申请已经处理，画面已更新。")
        : actualStatus === "APPROVED"
          ? tc("草稿已批准並更新詞庫。")
          : tc("草稿已拒絕。"));
      setReviewNote("");
      setReviewNotes((current) => { const next = { ...current }; delete next[request.id]; return next; });
      await loadCatalog();
      if (visiblePendingRequestId(selected?.pendingRequest ?? null) === request.id) closeDetailDialog();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc("審核詞庫修改失敗"));
    } finally { setSaving(false); }
  }

  if (!catalogInitialized && loading) return <div role="status" aria-label={tc("正在載入完整詞庫")} className="flex items-center justify-center gap-3 py-20 text-sm text-[var(--muted)]"><div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />{tc("正在載入完整詞庫…")}</div>;
  if (!catalogInitialized && error) return <ErrorBanner message={error} onRetry={() => void loadCatalog()} />;
  const statusOnlyRetry = retrySource?.kind === "RETIRE" || retrySource?.kind === "REACTIVATE";

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text)]">{tc("詞庫治理工作區")}</h1><p className="mt-1 text-sm text-[var(--muted)]">{tc("管理员及老师可以查看全部词条；一般修改由一位有权限人员审核，具权限者可即时停用。")}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-primary" onClick={startCreate}>{tc("新增詞條")}</button><button type="button" className="ui-button ui-button-secondary" onClick={() => setFeedbackTarget({ senseKey: null, term: null })}>{tc("提出詞庫意見")}</button>{bulkEnabled ? <><button type="button" className="ui-button ui-button-secondary" disabled={saving || exportSenseKeys.size === 0} onClick={() => void exportSelectedUpdates()}>{tc("匯出所選作 CSV 更新")} ({exportSenseKeys.size}/200)</button>{exportSenseKeys.size ? <button type="button" className="ui-button ui-button-quiet" disabled={saving} onClick={() => setExportSenseKeys(new Set())}>{tc("清除全部選取")}</button> : null}</> : null}</div>
      <div className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]">{tc("完整詞庫")}：{counts.all ?? rows.length} {tc("條")}</div>
    </div>
    {error ? <ErrorBanner message={error} onRetry={() => void loadCatalog()} /> : null}
    {message ? <p role="status" className="rounded-xl bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">{message}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {(["all", "ACTIVE", "DRAFT", "RETIRED", "blocked", "validationFailed", "pending"] as const).map((key) => <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-xs text-[var(--muted)]">{key === "all" ? tc("全部") : key === "ACTIVE" ? tc("已啟用") : key === "DRAFT" ? tc("草稿") : key === "RETIRED" ? tc("已停用") : key === "blocked" ? tc("方向被阻擋") : key === "validationFailed" ? tc("驗證失敗") : tc("等待審核")}</p><p className="mt-1 text-xl font-bold text-[var(--text)]">{counts[key] ?? 0}</p></div>)}
    </div>
    <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_150px_170px_190px]">
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("搜尋詞條、釋義或 key")}<input aria-label={tc("搜尋詞條、釋義或 key")} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("狀態")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}>{(["ALL", "ACTIVE", "DRAFT", "RETIRED", "BLOCKED", "VALIDATION_FAILED", "PENDING"] as FilterStatus[]).map((item) => <option key={item} value={item}>{statusLabel(item, tc)}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("程度")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={level} onChange={(event) => setLevel(event.target.value)}><option value="ALL">{tc("全部程度")}</option>{["A1", "A2", "B1", "B2"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("出題方向")}<select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="ALL">{tc("全部方向")}</option><option value="EN_ZH">{tc("英譯中可用")}</option><option value="ZH_EN">{tc("中譯英可用")}</option></select></label>
    </div>
    {canReview ? <section className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--border-soft)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-[var(--text)]">{tc("待審核草稿")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{tc("批准前會重新檢查版本、答案安全及干擾項；不能批准自己提交的修改。")}</p></div><span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--primary)]">{pending.length} {tc("項")}</span></div>{pendingHasMore ? <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]">{tc("待審核項目超過目前顯示上限，請先處理現有項目。")}</p> : null}{pending.length ? <div className="mt-3 grid gap-2 lg:grid-cols-2">{pending.map((request) => <article key={request.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--text)]">{request.sense?.term ?? request.payload.term ?? tc("新詞義")}</p><p className="mt-1 break-all text-[10px] text-[var(--muted)]">{request.senseKey ?? request.sourceImportRow?.senseKey ?? tc("尚未建立 sense key")} · {request.kind} · {request.proposer.legalName || request.proposer.accountName} · r{request.baseRevision ?? 0}</p></div><span className="rounded-full bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--warning)]">{tc("待審核")}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--text)]">{request.payload.definitionZh}</p><textarea className="mt-3 min-h-16 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--text)]" placeholder={tc("審核備註（拒絕時必填）")} value={reviewNotes[request.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))} aria-label={tc("審核備註")} /><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => { loadFormForDialog(request.payload); setReviewNote(reviewNotes[request.id] ?? ""); setSelected({ id: request.sourceImportRow?.id ?? null, senseKey: request.sense?.senseKey ?? request.senseKey ?? request.sourceImportRow?.senseKey ?? "", catalogKey: request.sourceImportRow?.catalogKey ?? request.catalogKey ?? null, sourceFile: request.sourceImportRow?.sourceFile ?? null, sourceRow: request.sourceImportRow?.sourceRow ?? null, status: request.baseStatus ?? "DRAFT", revision: request.baseRevision, latestRevision: request.baseRevision, approvedRevisionId: null, primaryDisposition: request.sourceImportRow?.primaryDisposition ?? "", eligibilityResult: request.sourceImportRow?.eligibilityResult ?? null, hasSense: Boolean(request.sense), issues: null, payload: request.payload, pendingRequest: { id: request.id, kind: request.kind, status: request.status, revision: request.revision, payload: request.payload, reason: request.reason, proposerId: request.proposerId, createdAt: request.createdAt } }); }}>{tc("查看草稿")}</button><button type="button" className="ui-button ui-button-primary ui-button-small" disabled={saving} onClick={() => void reviewRequest(request, "APPROVE")}>{tc("批准")}</button><button type="button" className="ui-button ui-button-danger ui-button-small" disabled={saving} onClick={() => void reviewRequest(request, "REJECT")}>{tc("拒絕")}</button></div></article>)}</div> : <p className="mt-3 text-sm text-[var(--muted)]">{tc("目前沒有等待審核的草稿。")}</p>}</section> : null}
    <p className="text-sm text-[var(--muted)]" role="status" aria-live="polite">{loading ? tc("正在更新詞庫結果…") : <>{tc("目前篩選")}: {filteredTotal} / {counts.all ?? 0} {tc("條；已載入")} {rows.length}</>}</p>
    <div aria-busy={loading || loadingMore}>{loading ? <p role="status" className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]">{tc("正在更新詞庫結果…")}</p> : rows.length ? <div className="space-y-2">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.6fr)_100px_150px_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-[17px] text-[var(--text)]">{row.term || tc("未完成詞條")}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status, tc)}</span></div><p className="mt-1 break-all text-[11px] text-[var(--muted)]">{row.senseKey ?? tc("尚未建立 sense key")}</p></div><div className="min-w-0"><p className="line-clamp-2 text-sm text-[var(--text)]">{row.definitionZh || tc("尚未填寫中文釋義")}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.partOfSpeech || "—"} · {row.level || "—"} · {tc(row.category || "other")}</p></div><div className="text-xs text-[var(--muted)]"><p>{row.enableEnToZh ? tc("英譯中") : tc("英譯中停用")}</p><p>{row.enableZhToEn ? tc("中譯英") : tc("中譯英停用")}</p></div><div className="text-xs text-[var(--muted)]"><p>{row.primaryDisposition === "VALIDATION_FAILED" ? tc("需修訂 validator 問題") : row.eligibilityResult === "DRAFT_BLOCKED" ? tc("出題方向未就緒") : row.approvedRevisionId ? `${tc("已批准 revision")} ${row.revision ?? "—"}` : tc("未批准")}</p><p>{row.pendingRequest ? tc("已有待審核修改") : row.sourceFile ? `${row.sourceFile}:${row.sourceRow}` : tc("治理草稿")}</p></div><div className="flex flex-wrap gap-2 lg:justify-end">{bulkEnabled ? hasCatalogExportTarget(row) ? <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><input type="checkbox" checked={exportSenseKeys.has(row.senseKey!)} disabled={Boolean(row.pendingRequest) || (!exportSenseKeys.has(row.senseKey!) && exportSenseKeys.size >= 200)} onChange={(event) => toggleExportSelection(row.senseKey!, event.target.checked)} />{tc("選取匯出")}</label> : catalogExportAvailability(row) === "REQUIRES_GOVERNED_REVISION" ? <span role="note" className="max-w-44 text-xs leading-5 text-[var(--muted)]">{tc("請先查看／修改並建立詞義版本，之後才可批量匯出。")}</span> : catalogExportAvailability(row) === "REVISION_UNAVAILABLE" ? <span role="note" className="max-w-44 text-xs leading-5 text-[var(--danger)]">{tc("詞義版本未就緒；請重新載入，如持續出現請通知管理員。")}</span> : <span role="note" className="max-w-44 text-xs leading-5 text-[var(--muted)]">{tc("未有 sense key；請用 CSV 批量提交修正來源資料。")}</span> : null}{row.senseKey ? <><button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => setFeedbackTarget({ senseKey: row.senseKey, term: row.term })}>{tc("報告問題")}</button>{historyEnabled ? <button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => onOpenHistory(row.senseKey!)}>{tc("查看歷史")}</button> : null}<button type="button" className="ui-button ui-button-secondary ui-button-small" onClick={() => void openDetail(row)}>{tc("查看／修改")}</button></> : null}{row.validationErrors.length ? <span className="rounded-full bg-[var(--danger-bg)] px-2 py-1 text-[10px] text-[var(--danger)]">{row.validationErrors.length} {tc("個問題")}</span> : null}</div></div></article>)}</div> : <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]">{tc("目前篩選沒有詞條。")}</p>}</div>
    {nextCursor ? <button type="button" className="ui-button ui-button-secondary mx-auto block" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? tc("載入中…") : tc("載入更多（最多 100 條）")}</button> : null}
    {selected ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title"><section ref={dialogRef} tabIndex={-1} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[var(--muted)]">{selected.senseKey}</p><h2 id="catalog-dialog-title" className="mt-1 text-xl font-bold text-[var(--text)]">{form.term || tc("詞條內容")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{statusLabel(selected.status, tc)} · {selected.revision === null ? tc("未有 revision") : `revision ${selected.revision}`}</p></div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => setFeedbackTarget({ senseKey: selected.senseKey, term: form.term })}>{tc("報告問題")}</button>{historyEnabled ? <button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={openSelectedHistory}>{tc("查看歷史")}</button> : null}<button type="button" className="ui-button ui-button-quiet ui-button-small" onClick={() => { setSelected(null); setRetrySource(null); }} aria-label={tc("關閉") as string}>×</button></div></div>{statusOnlyRetry ? <p role="note" className="mt-4 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">{tc("呢個係狀態變更申請；詞條內容修改需要另行提交 UPDATE，批准後再重新提交啟用／停用申請。今次只會重新提交理由。")}</p> : null}<fieldset disabled={statusOnlyRetry} className="m-0 min-w-0 border-0 p-0 disabled:opacity-70"><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文詞") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.term} onChange={(event) => updateForm("term", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("Lemma") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)] disabled:cursor-not-allowed disabled:bg-[var(--border-soft)]" value={form.lemma} disabled={selected.hasSense} onChange={(event) => updateForm("lemma", event.target.value)} />{selected.hasSense ? <small className="font-normal text-[var(--muted)]">{tc("Lemma 屬於穩定詞頭身份；如要改成另一個詞頭，請新增詞義並停用舊詞義。")}</small> : null}</label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("詞性") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.partOfSpeech} onChange={(event) => updateForm("partOfSpeech", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("程度") }<select className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.level} onChange={(event) => updateForm("level", event.target.value as CatalogPayload["level"])}>{["A1", "A2", "B1", "B2"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("Category") }<select className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.category} onChange={(event) => updateForm("category", event.target.value)}>{CATALOG_CATEGORIES.includes(form.category as (typeof CATALOG_CATEGORIES)[number]) ? null : <option value={form.category}>{form.category} ({tc("無效，請重新選擇")})</option>}{CATALOG_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("音標") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={form.phoneticIpa ?? ""} onChange={(event) => updateForm("phoneticIpa", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("中文釋義") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.definitionZh} onChange={(event) => updateForm("definitionZh", event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("例句英文") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.exampleEn ?? ""} onChange={(event) => updateForm("exampleEn", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("例句中文") }<textarea className="min-h-20 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={form.exampleZh ?? ""} onChange={(event) => updateForm("exampleZh", event.target.value || null)} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("中文正確答案（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.acceptedAnswersZh)} onChange={(event) => updateForm("acceptedAnswersZh", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文正確形式（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.acceptedFormsEn)} onChange={(event) => updateForm("acceptedFormsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文近義詞（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.synonymsEn)} onChange={(event) => updateForm("synonymsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("英文反義詞（用 | 分隔）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={listText(form.antonymsEn)} onChange={(event) => updateForm("antonymsEn", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("英譯中干擾項（用 | 分隔；5–6 個）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.distractorZh)} onChange={(event) => updateForm("distractorZh", parseList(event.target.value))} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--muted)] md:col-span-2">{tc("中譯英干擾項（用 | 分隔；5–6 個）") }<input className="h-11 rounded-xl border border-[var(--border)] px-3 text-sm text-[var(--text)]" value={listText(form.distractorEn)} onChange={(event) => updateForm("distractorEn", parseList(event.target.value))} /></label></div><div className="mt-4 flex flex-wrap gap-4 rounded-2xl border border-[var(--border)] p-3 text-sm text-[var(--text)]"><label className="flex items-center gap-2"><input type="checkbox" checked={form.enableEnToZh} onChange={(event) => updateForm("enableEnToZh", event.target.checked)} />{tc("啟用英譯中")}</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.enableZhToEn} onChange={(event) => updateForm("enableZhToEn", event.target.checked)} />{tc("啟用中譯英")}</label></div><CatalogQuestionPreview payload={form} senseKey={selected.senseKey} /></fieldset>{retrySource?.conflicts.length ? <section className="mt-4 rounded-2xl border border-[var(--warning)] bg-[var(--warning-bg)] p-4"><h3 className="font-bold text-[var(--warning)]">{tc("正式版本同原提案有欄位衝突")}</h3><p className="mt-1 text-xs text-[var(--warning)]">{tc("請逐欄比較原基線、被拒提案及目前正式值，再決定修正版採用邊一個。")}</p><div className="mt-3 space-y-3">{retrySource.conflicts.map((conflict) => <div key={conflict.field} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-sm font-bold text-[var(--text)]">{conflict.field}</p><dl className="mt-2 grid gap-2 text-xs md:grid-cols-3"><div><dt className="font-semibold text-[var(--muted)]">{tc("原基線")}</dt><dd className="mt-1 break-words text-[var(--text)]">{retryConflictValueText(conflict.base, tc)}</dd></div><div><dt className="font-semibold text-[var(--muted)]">{tc("被拒提案")}</dt><dd className="mt-1 break-words text-[var(--text)]">{retryConflictValueText(conflict.proposal, tc)}</dd></div><div><dt className="font-semibold text-[var(--muted)]">{tc("目前正式值")}</dt><dd className="mt-1 break-words text-[var(--text)]">{retryConflictValueText(conflict.current, tc)}</dd></div></dl><label className="mt-3 grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("修正版採用")}<select aria-label={`${tc("衝突欄位")} ${conflict.field}`} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" value={retrySource.choices[conflict.field] ?? ""} onChange={(event) => { const choice = event.target.value as CatalogRetryConflictChoice; const nextValue = choice === "PROPOSAL" ? conflict.proposal : conflict.current; setRetrySource((current) => current ? { ...current, choices: { ...current.choices, [conflict.field]: choice } } : current); setForm((current) => ({ ...current, [conflict.field]: nextValue }) as CatalogPayload); }}><option value="">{tc("請選擇")}</option><option value="CURRENT">{tc("保留目前正式值")}</option><option value="PROPOSAL">{tc("採用原提案值")}</option></select></label></div>)}</div></section> : null}{retrySource ? <p className="mt-4 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]"><strong>{tc("重新提交修正版")}</strong> · {tc("原審核意見")}：{retrySource.reviewNote || tc("未有備註")}。{tc("提交後會建立新申請，舊紀錄會保留。")}</p> : null}<label className="mt-4 grid gap-1 text-xs font-semibold text-[var(--muted)]">{tc("修改／停用理由") }<textarea className="min-h-16 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)]" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={tc("簡單說明修改原因，停用時必須填寫。")} /></label>{selected.status === "ACTIVE" && canReview ? <p className="mt-2 text-xs text-[var(--danger)]">{tc("按下「立即停用」并确认后会即时生效；学生历史及审核记录会保留。")}</p> : null}{selected.pendingRequest ? <p className="mt-3 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">{tc(canReview && selected.status === "ACTIVE" ? "已有待审核修改；即时停用仍会生效，现有内容申请不会自动重新启用这个词义。" : "此词条已有待审核版本，请先完成该审核。")}</p> : null}<div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4"><button type="button" className="ui-button ui-button-quiet" onClick={() => { setSelected(null); setRetrySource(null); }}>{tc("取消")}</button>{retrySource ? <button type="button" className="ui-button ui-button-primary" disabled={saving || Boolean(selected.pendingRequest) || retrySource.conflicts.some((conflict) => !retrySource.choices[conflict.field])} onClick={() => void submitChange(retrySource.kind)}>{saving ? tc("提交中…") : statusOnlyRetry ? tc("重新提交狀態申請") : tc("修改後重新提交")}</button> : selected.status === "RETIRED" ? <><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange("UPDATE")}>{saving ? tc("提交中…") : tc("提交內容修改草稿")}</button><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange("REACTIVATE")}>{tc("提交重新啟用申請")}</button></> : <><button type="button" className="ui-button ui-button-secondary" disabled={saving || Boolean(selected.pendingRequest)} onClick={() => void submitChange(selected.hasSense === false ? "CREATE" : "UPDATE")}>{saving ? tc("提交中…") : tc("提交草稿")}</button>{selected.status === "ACTIVE" ? <button type="button" className="ui-button ui-button-danger" disabled={saving || (!canReview && Boolean(selected.pendingRequest))} onClick={() => void submitChange("RETIRE")}>{tc(canReview ? "立即停用" : "提交停用申请")}</button> : null}</>}</div></section></div> : null}{feedbackTarget ? <CatalogFeedbackDialog key={`${feedbackTarget.senseKey ?? "general"}:${feedbackTarget.term ?? ""}`} target={feedbackTarget} onClose={() => setFeedbackTarget(null)} onSubmitted={() => setMessage(tc("意見已提交；你可以在「我的待辦」查看處理狀態。"))} /> : null}
  </div>;
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
  const accessGenerationRef = useRef(0);
  const confirmedBulkEnabledRef = useRef(false);

  const updateWorkspaceAccess = useCallback((access: CatalogWorkspaceAccess) => {
    setCanReview(access.canReview);
    setActorUserId(access.actorUserId);
    if (confirmedBulkEnabledRef.current && !access.bulkEnabled) {
      setCatalogResetVersion((current) => current + 1);
    }
    confirmedBulkEnabledRef.current = access.bulkEnabled;
    setBulkEnabled(access.bulkEnabled);
    setHistoryEnabled(access.historyEnabled);
    if (!access.bulkEnabled) setBulkBatchId(null);
    if (!access.historyEnabled) setHistorySenseKey(null);
    setTab((current) => (
      (current === "bulk" && access.bulkEnabled === false)
      || (current === "history" && access.historyEnabled === false)
        ? "catalog"
        : current
    ));
  }, []);

  const refreshAccess = useCallback(async () => {
    const generation = ++accessGenerationRef.current;
    try {
      const response = await fetch("/api/catalog/access", { cache: "no-store" });
      if (generation !== accessGenerationRef.current) return;
      if (response.status === 401 || response.status === 403) {
        updateWorkspaceAccess({ canReview: false, actorUserId: "", bulkEnabled: false, historyEnabled: false });
        return;
      }
      if (!response.ok) return;
      const payload = await response.json() as { canReview?: boolean; actorUserId?: string; bulkEnabled?: boolean; historyEnabled?: boolean };
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
    const initial = window.setTimeout(() => { void refreshAccess(); }, 0);
    const interval = window.setInterval(() => { void refreshAccess(); }, 30_000);
    const onFocus = () => { void refreshAccess(); };
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
    { id: "catalog", label: tc("完整詞庫"), detail: tc("瀏覽、篩選及逐條修改") },
    ...(bulkEnabled ? [{ id: "bulk" as const, label: tc("CSV 批量提交"), detail: tc("預覽、解決衝突及整批審核") }] : []),
    ...(historyEnabled ? [{ id: "history" as const, label: tc("修改歷史"), detail: tc("查看批次及詞條時間線") }] : []),
  ];

  return <div className="mx-auto w-full max-w-[1500px] space-y-5 overflow-x-clip">
    <nav aria-label={tc("詞庫工作區") as string} className={`grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 ${tabs.length === 4 ? "sm:grid-cols-4" : tabs.length === 3 ? "sm:grid-cols-3" : tabs.length === 2 ? "sm:grid-cols-2" : ""}`}>
      {tabs.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} className={`rounded-xl px-4 py-3 text-left transition-colors ${tab === item.id ? "bg-[var(--primary)] text-white" : "text-[var(--text)] hover:bg-[var(--border-soft)]"}`} onClick={() => { if (item.id === "history") setHistorySenseKey(null); setTab(item.id); }}><strong className="block text-sm">{item.label}</strong><span className={`mt-1 block text-xs ${tab === item.id ? "text-white/75" : "text-[var(--muted)]"}`}>{item.detail}</span></button>)}
    </nav>
    {tab === "work" ? <CatalogWorkItemsWorkspace bulkEnabled={bulkEnabled} onOpenCatalog={(senseKey) => { setCatalogSenseKey(senseKey ?? null); setTab("catalog"); }} onOpenBatch={(batchId) => { if (bulkEnabled) { setBulkBatchId(batchId); setTab("bulk"); } }} onRetryRequest={(requestId) => { setRetryRequestId(requestId); setTab("catalog"); }} /> : tab === "catalog" ? <CatalogOverviewWorkspace key={catalogResetVersion} bulkEnabled={bulkEnabled} historyEnabled={historyEnabled} initialRetryRequestId={retryRequestId} onRetryConsumed={() => setRetryRequestId(null)} initialSenseKey={catalogSenseKey} onInitialSenseConsumed={() => setCatalogSenseKey(null)} onOpenHistory={(senseKey) => { setHistorySenseKey(senseKey); setTab("history"); }} /> : tab === "bulk" ? <CatalogBulkSubmissionWorkspace canReview={canReview} actorUserId={actorUserId} initialBatchId={bulkBatchId} /> : <CatalogHistoryWorkspace canReview={canReview} bulkEnabled={bulkEnabled} initialSenseKey={historySenseKey} onBackToCatalog={() => { setHistorySenseKey(null); setTab("catalog"); }} onOpenCorrectiveBatch={(batchId) => { setBulkBatchId(batchId); setTab("bulk"); }} />}
  </div>;
}
