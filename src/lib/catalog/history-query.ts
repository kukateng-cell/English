import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface CatalogHistoryFilters {
  search?: string;
  status?: string;
  kind?: string;
  level?: string;
  category?: string;
  sourceKind?: string;
  catalogKey?: string;
  senseKey?: string;
  batchId?: string;
  actor?: string;
  dateFrom?: string;
  dateTo?: string;
}

export type CatalogHistoryCursor = {
  v: 1;
  occurredAt: string;
  sourceKind: string;
  id: string;
  cutoff: string;
  scope: string;
  fingerprint: string;
};

export type CatalogSenseHistoryCursor = {
  v: 1;
  senseKey: string;
  createdAt: string;
  id: string;
  cutoff: string;
  scope: string;
};

const FILTER_KEYS = new Set<keyof CatalogHistoryFilters>([
  "search",
  "status",
  "kind",
  "level",
  "category",
  "sourceKind",
  "catalogKey",
  "senseKey",
  "batchId",
  "actor",
  "dateFrom",
  "dateTo",
]);
const ENUMS: Partial<Record<keyof CatalogHistoryFilters, readonly string[]>> = {
  status: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
  kind: ["CREATE", "UPDATE", "RETIRE", "REACTIVATE"],
  level: ["A1", "A2", "B1", "B2"],
  sourceKind: ["STANDALONE_REQUEST", "BATCH", "INITIAL_BASELINE"],
};

function cursorSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production")
    throw new Error("NEXTAUTH_SECRET is required for catalog history cursors");
  return "development-only-catalog-history-cursor-secret";
}

function sign(namespace: string, body: string): string {
  return createHmac("sha256", cursorSecret())
    .update(namespace)
    .update(body)
    .digest("base64url");
}

function encodeSigned(namespace: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${body}.${sign(namespace, body)}`;
}

function decodeSigned(
  namespace: string,
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied) return null;
  const expected = sign(namespace, body);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizeCatalogHistoryFilters(
  value: unknown,
): CatalogHistoryFilters {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("CATALOG_HISTORY_FILTER_INVALID");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !FILTER_KEYS.has(key as keyof CatalogHistoryFilters),
    )
  )
    throw new Error("CATALOG_HISTORY_FILTER_INVALID");
  const output: CatalogHistoryFilters = {};
  for (const key of FILTER_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string")
      throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    const normalized = raw.trim();
    if (!normalized) continue;
    const max = key === "search" || key === "actor" ? 100 : 160;
    if (normalized.length > max)
      throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    const choices = ENUMS[key];
    if (choices && !choices.includes(normalized))
      throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    if (
      (key === "dateFrom" || key === "dateTo") &&
      !Number.isFinite(Date.parse(normalized))
    )
      throw new Error("CATALOG_HISTORY_FILTER_INVALID");
    output[key] = normalized;
  }
  if (
    output.dateFrom &&
    output.dateTo &&
    Date.parse(output.dateFrom) > Date.parse(output.dateTo)
  )
    throw new Error("CATALOG_HISTORY_FILTER_INVALID");
  return output;
}

export function catalogHistoryFilterFingerprint(
  filters: CatalogHistoryFilters,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest("hex");
}

export function encodeCatalogHistoryCursor(
  value: Omit<CatalogHistoryCursor, "v">,
): string {
  return encodeSigned("catalog-history-v1:", { v: 1, ...value });
}

export function decodeCatalogHistoryCursor(
  value: string | null | undefined,
): CatalogHistoryCursor | null {
  const row = decodeSigned("catalog-history-v1:", value);
  if (
    !row ||
    row.v !== 1 ||
    typeof row.occurredAt !== "string" ||
    typeof row.sourceKind !== "string" ||
    typeof row.id !== "string" ||
    typeof row.cutoff !== "string" ||
    typeof row.scope !== "string" ||
    typeof row.fingerprint !== "string"
  )
    return null;
  if (
    !Number.isFinite(Date.parse(row.occurredAt)) ||
    !Number.isFinite(Date.parse(row.cutoff))
  )
    return null;
  return row as CatalogHistoryCursor;
}

export function encodeCatalogBatchChildCursor(
  batchId: string,
  id: string,
): string {
  return encodeSigned("catalog-history-child-v1:", { v: 1, batchId, id });
}

export function decodeCatalogBatchChildCursor(
  value: string | null | undefined,
  batchId: string,
): string | null {
  if (!value) return null;
  const row = decodeSigned("catalog-history-child-v1:", value);
  return row &&
    row.v === 1 &&
    row.batchId === batchId &&
    typeof row.id === "string"
    ? row.id
    : null;
}

export function encodeCatalogSenseHistoryCursor(
  value: Omit<CatalogSenseHistoryCursor, "v">,
): string {
  return encodeSigned("catalog-sense-history-v1:", { v: 1, ...value });
}

export function catalogSenseHistoryScope(
  canReview: boolean,
  actorId: string,
  workspaceSignature: string,
): string {
  return createHash("sha256")
    .update(canReview ? `REVIEWER:${actorId}:` : `TEACHER:${actorId}:`)
    .update(workspaceSignature)
    .digest("hex");
}

export function decodeCatalogSenseHistoryCursor(
  value: string | null | undefined,
): CatalogSenseHistoryCursor | null {
  const row = decodeSigned("catalog-sense-history-v1:", value);
  if (
    !row ||
    row.v !== 1 ||
    typeof row.senseKey !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.id !== "string" ||
    typeof row.cutoff !== "string" ||
    typeof row.scope !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    !Number.isFinite(Date.parse(row.cutoff))
  )
    return null;
  return row as CatalogSenseHistoryCursor;
}
