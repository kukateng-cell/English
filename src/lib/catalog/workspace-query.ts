import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isCatalogCategory } from "./taxonomy";

export const CATALOG_WORKSPACE_DEFAULT_LIMIT = 100;
export const CATALOG_WORKSPACE_MAX_LIMIT = 100;

const INITIAL_VALUES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const;

export type CatalogWorkspaceStatus =
  | "ALL"
  | "ACTIVE"
  | "DRAFT"
  | "RETIRED"
  | "BLOCKED"
  | "VALIDATION_FAILED"
  | "PENDING";
export type CatalogWorkspaceLifecycle = "ALL" | "ACTIVE" | "DRAFT" | "RETIRED";
export type CatalogWorkspaceWorkflow = "ALL" | "PENDING" | "NONE";
export type CatalogWorkspaceLevel = "ALL" | "A1" | "A2" | "B1" | "B2";
export type CatalogWorkspaceDirection = "ALL" | "EN_ZH" | "ZH_EN";
export type CatalogWorkspaceReadiness =
  | "ALL"
  | "BOTH"
  | "EN_TO_ZH_ONLY"
  | "ZH_TO_EN_ONLY"
  | "UNAVAILABLE";
export type CatalogWorkspaceIssues =
  | "ALL"
  | "CURRENT_CONTENT"
  | "PENDING_DRAFT"
  | "IMPORT_DRAFT"
  | "NONE";
export type CatalogWorkspaceInitial =
  | "ALL"
  | "OTHER"
  | (typeof INITIAL_VALUES)[number];
export type CatalogWorkspaceSort =
  | "TERM_ASC"
  | "TERM_DESC"
  | "UPDATED_DESC"
  | "LEVEL_ASC"
  | "ACTION_REQUIRED_FIRST"
  | "SOURCE_ORDER";
export type CatalogWorkspaceQueryMode = "LEGACY_V1" | "WORKSPACE_V2";

export interface CatalogWorkspaceFilters {
  q: string;
  /** Kept only for old callers. New callers use the orthogonal filters below. */
  status: CatalogWorkspaceStatus;
  lifecycle: CatalogWorkspaceLifecycle;
  workflow: CatalogWorkspaceWorkflow;
  level: CatalogWorkspaceLevel;
  direction: CatalogWorkspaceDirection;
  partOfSpeech: string;
  initial: CatalogWorkspaceInitial;
  category: string;
  readiness: CatalogWorkspaceReadiness;
  issues: CatalogWorkspaceIssues;
  sort: CatalogWorkspaceSort;
  mode: CatalogWorkspaceQueryMode;
}

export interface CatalogWorkspaceQuery {
  filters: CatalogWorkspaceFilters;
  limit: number;
  cursor: string | null;
}

export interface CatalogWorkspaceCursorV1 {
  v: 1;
  offset: number;
  fingerprint: string;
  workspaceSignature: string;
  batchId: string;
}

export interface CatalogWorkspaceCursorV2 {
  v: 2;
  offset: number;
  fingerprint: string;
  workspaceSignature: string;
  batchId: string;
  sort: CatalogWorkspaceSort;
  snapshotCutoff: string;
}

export type CatalogWorkspaceCursor =
  | CatalogWorkspaceCursorV1
  | CatalogWorkspaceCursorV2;

const ALLOWED_QUERY_KEYS = new Set([
  "q",
  "status",
  "lifecycle",
  "workflow",
  "level",
  "direction",
  "partOfSpeech",
  "initial",
  "category",
  "readiness",
  "issues",
  "sort",
  "limit",
  "cursor",
]);
const STATUS_VALUES = new Set<CatalogWorkspaceStatus>([
  "ALL",
  "ACTIVE",
  "DRAFT",
  "RETIRED",
  "BLOCKED",
  "VALIDATION_FAILED",
  "PENDING",
]);
const LIFECYCLE_VALUES = new Set<CatalogWorkspaceLifecycle>([
  "ALL",
  "ACTIVE",
  "DRAFT",
  "RETIRED",
]);
const WORKFLOW_VALUES = new Set<CatalogWorkspaceWorkflow>([
  "ALL",
  "PENDING",
  "NONE",
]);
const LEVEL_VALUES = new Set<CatalogWorkspaceLevel>([
  "ALL",
  "A1",
  "A2",
  "B1",
  "B2",
]);
const DIRECTION_VALUES = new Set<CatalogWorkspaceDirection>([
  "ALL",
  "EN_ZH",
  "ZH_EN",
]);
const READINESS_VALUES = new Set<CatalogWorkspaceReadiness>([
  "ALL",
  "BOTH",
  "EN_TO_ZH_ONLY",
  "ZH_TO_EN_ONLY",
  "UNAVAILABLE",
]);
const ISSUE_VALUES = new Set<CatalogWorkspaceIssues>([
  "ALL",
  "CURRENT_CONTENT",
  "PENDING_DRAFT",
  "IMPORT_DRAFT",
  "NONE",
]);
const SORT_VALUES = new Set<CatalogWorkspaceSort>([
  "TERM_ASC",
  "TERM_DESC",
  "UPDATED_DESC",
  "LEVEL_ASC",
  "ACTION_REQUIRED_FIRST",
  "SOURCE_ORDER",
]);
const INITIAL_VALUE_SET = new Set<string>(["ALL", "OTHER", ...INITIAL_VALUES]);

function cursorSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "NEXTAUTH_SECRET is required for catalog workspace cursors",
    );
  return "development-only-catalog-workspace-cursor-secret";
}

function cursorSignature(body: string, version: 1 | 2): string {
  return createHmac("sha256", cursorSecret())
    .update(`catalog-workspace-v${version}:`)
    .update(body)
    .digest("base64url");
}

function enumValue<T extends string>(
  value: string | null,
  choices: Set<T>,
  fallback: T,
): T {
  if (value === null || value === "") return fallback;
  if (!choices.has(value as T)) throw new Error("CATALOG_QUERY_INVALID");
  return value as T;
}

function stringFilter(value: string | null, max: number): string {
  const normalized = (value ?? "ALL").normalize("NFKC").trim();
  if (!normalized) return "ALL";
  if (normalized.length > max || !/^[\p{L}\p{N}' -]+$/u.test(normalized))
    throw new Error("CATALOG_QUERY_INVALID");
  return normalized;
}

export function parseCatalogWorkspaceQuery(
  searchParams: URLSearchParams,
): CatalogWorkspaceQuery {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || searchParams.getAll(key).length !== 1)
      throw new Error("CATALOG_QUERY_INVALID");
  }
  const q = (searchParams.get("q") ?? "").normalize("NFKC").trim();
  if (q.length > 100) throw new Error("CATALOG_QUERY_INVALID");
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit))
    throw new Error("CATALOG_QUERY_INVALID");
  const limit =
    rawLimit === null ? CATALOG_WORKSPACE_DEFAULT_LIMIT : Number(rawLimit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CATALOG_WORKSPACE_MAX_LIMIT
  )
    throw new Error("CATALOG_QUERY_INVALID");
  const cursor = searchParams.get("cursor");
  if (cursor !== null && (!cursor || Buffer.byteLength(cursor, "utf8") > 2048))
    throw new Error("CATALOG_CURSOR_INVALID");

  const mode: CatalogWorkspaceQueryMode = searchParams.has("status")
    ? "LEGACY_V1"
    : "WORKSPACE_V2";
  if (
    mode === "LEGACY_V1" &&
    [
      "lifecycle",
      "workflow",
      "partOfSpeech",
      "initial",
      "category",
      "readiness",
      "issues",
      "sort",
    ].some((key) => searchParams.has(key))
  ) {
    throw new Error("CATALOG_QUERY_INVALID");
  }
  const category = stringFilter(searchParams.get("category"), 80);
  if (
    category !== "ALL" &&
    category !== "UNCLASSIFIED" &&
    !isCatalogCategory(category)
  )
    throw new Error("CATALOG_QUERY_INVALID");
  const initial = enumValue(
    searchParams.get("initial"),
    INITIAL_VALUE_SET,
    "ALL",
  ) as CatalogWorkspaceInitial;

  return {
    filters: {
      q,
      status: enumValue(searchParams.get("status"), STATUS_VALUES, "ALL"),
      lifecycle: enumValue(
        searchParams.get("lifecycle"),
        LIFECYCLE_VALUES,
        "ALL",
      ),
      workflow: enumValue(searchParams.get("workflow"), WORKFLOW_VALUES, "ALL"),
      level: enumValue(searchParams.get("level"), LEVEL_VALUES, "ALL"),
      direction: enumValue(
        searchParams.get("direction"),
        DIRECTION_VALUES,
        "ALL",
      ),
      partOfSpeech: stringFilter(searchParams.get("partOfSpeech"), 80),
      initial,
      category,
      readiness: enumValue(
        searchParams.get("readiness"),
        READINESS_VALUES,
        "ALL",
      ),
      issues: enumValue(searchParams.get("issues"), ISSUE_VALUES, "ALL"),
      sort: enumValue(
        searchParams.get("sort"),
        SORT_VALUES,
        mode === "LEGACY_V1" ? "SOURCE_ORDER" : "TERM_ASC",
      ),
      mode,
    },
    limit,
    cursor,
  };
}

export function catalogWorkspaceQueryFingerprint(
  filters: CatalogWorkspaceFilters,
  limit: number,
  scope: string,
): string {
  const serializedFilters =
    filters.mode === "LEGACY_V1"
      ? {
          q: filters.q,
          status: filters.status,
          level: filters.level,
          direction: filters.direction,
        }
      : filters;
  return createHash("sha256")
    .update(JSON.stringify({ filters: serializedFilters, limit, scope }))
    .digest("hex");
}

export function encodeCatalogWorkspaceCursor(
  value:
    | Omit<CatalogWorkspaceCursorV1, "v">
    | Omit<CatalogWorkspaceCursorV2, "v">,
): string {
  const version = "snapshotCutoff" in value ? 2 : 1;
  const body = Buffer.from(
    JSON.stringify({ v: version, ...value }),
    "utf8",
  ).toString("base64url");
  return `${body}.${cursorSignature(body, version)}`;
}

export function decodeCatalogWorkspaceCursor(
  value: string | null | undefined,
): CatalogWorkspaceCursor | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const row = parsed as Record<string, unknown>;
    if (row.v !== 1 && row.v !== 2) return null;
    const expected = cursorSignature(body, row.v);
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    )
      return null;
    if (
      !Number.isSafeInteger(row.offset) ||
      (row.offset as number) < 1 ||
      (row.offset as number) > 1_000_000 ||
      typeof row.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
      typeof row.workspaceSignature !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.workspaceSignature) ||
      typeof row.batchId !== "string" ||
      row.batchId.length < 1 ||
      row.batchId.length > 191
    )
      return null;
    if (
      row.v === 2 &&
      (typeof row.sort !== "string" ||
        !SORT_VALUES.has(row.sort as CatalogWorkspaceSort) ||
        typeof row.snapshotCutoff !== "string" ||
        Number.isNaN(Date.parse(row.snapshotCutoff)))
    )
      return null;
    return row as unknown as CatalogWorkspaceCursor;
  } catch {
    return null;
  }
}
