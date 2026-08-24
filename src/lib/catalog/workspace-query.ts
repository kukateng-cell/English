import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CATALOG_WORKSPACE_DEFAULT_LIMIT = 100;
export const CATALOG_WORKSPACE_MAX_LIMIT = 100;

export type CatalogWorkspaceStatus = "ALL" | "ACTIVE" | "DRAFT" | "RETIRED" | "BLOCKED" | "VALIDATION_FAILED" | "PENDING";
export type CatalogWorkspaceLevel = "ALL" | "A1" | "A2" | "B1" | "B2";
export type CatalogWorkspaceDirection = "ALL" | "EN_ZH" | "ZH_EN";

export interface CatalogWorkspaceFilters {
  q: string;
  status: CatalogWorkspaceStatus;
  level: CatalogWorkspaceLevel;
  direction: CatalogWorkspaceDirection;
}

export interface CatalogWorkspaceQuery {
  filters: CatalogWorkspaceFilters;
  limit: number;
  cursor: string | null;
}

export interface CatalogWorkspaceCursor {
  v: 1;
  offset: number;
  fingerprint: string;
  workspaceSignature: string;
  batchId: string;
}

const ALLOWED_QUERY_KEYS = new Set(["q", "status", "level", "direction", "limit", "cursor"]);
const STATUS_VALUES = new Set<CatalogWorkspaceStatus>(["ALL", "ACTIVE", "DRAFT", "RETIRED", "BLOCKED", "VALIDATION_FAILED", "PENDING"]);
const LEVEL_VALUES = new Set<CatalogWorkspaceLevel>(["ALL", "A1", "A2", "B1", "B2"]);
const DIRECTION_VALUES = new Set<CatalogWorkspaceDirection>(["ALL", "EN_ZH", "ZH_EN"]);

function cursorSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for catalog workspace cursors");
  return "development-only-catalog-workspace-cursor-secret";
}

function cursorSignature(body: string): string {
  return createHmac("sha256", cursorSecret()).update("catalog-workspace-v1:").update(body).digest("base64url");
}

function enumValue<T extends string>(value: string | null, choices: Set<T>, fallback: T): T {
  if (value === null || value === "") return fallback;
  if (!choices.has(value as T)) throw new Error("CATALOG_QUERY_INVALID");
  return value as T;
}

export function parseCatalogWorkspaceQuery(searchParams: URLSearchParams): CatalogWorkspaceQuery {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || searchParams.getAll(key).length !== 1) throw new Error("CATALOG_QUERY_INVALID");
  }
  const q = (searchParams.get("q") ?? "").normalize("NFKC").trim();
  if (q.length > 100) throw new Error("CATALOG_QUERY_INVALID");
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit)) throw new Error("CATALOG_QUERY_INVALID");
  const limit = rawLimit === null ? CATALOG_WORKSPACE_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_WORKSPACE_MAX_LIMIT) throw new Error("CATALOG_QUERY_INVALID");
  const cursor = searchParams.get("cursor");
  if (cursor !== null && (!cursor || Buffer.byteLength(cursor, "utf8") > 2048)) throw new Error("CATALOG_CURSOR_INVALID");
  return {
    filters: {
      q,
      status: enumValue(searchParams.get("status"), STATUS_VALUES, "ALL"),
      level: enumValue(searchParams.get("level"), LEVEL_VALUES, "ALL"),
      direction: enumValue(searchParams.get("direction"), DIRECTION_VALUES, "ALL"),
    },
    limit,
    cursor,
  };
}

export function catalogWorkspaceQueryFingerprint(filters: CatalogWorkspaceFilters, limit: number, scope: string): string {
  return createHash("sha256").update(JSON.stringify({ filters, limit, scope })).digest("hex");
}

export function encodeCatalogWorkspaceCursor(value: Omit<CatalogWorkspaceCursor, "v">): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
  return `${body}.${cursorSignature(body)}`;
}

export function decodeCatalogWorkspaceCursor(value: string | null | undefined): CatalogWorkspaceCursor | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied) return null;
  const expected = cursorSignature(body);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (
      row.v !== 1
      || !Number.isSafeInteger(row.offset)
      || (row.offset as number) < 1
      || (row.offset as number) > 1_000_000
      || typeof row.fingerprint !== "string"
      || !/^[a-f0-9]{64}$/.test(row.fingerprint)
      || typeof row.workspaceSignature !== "string"
      || !/^[a-f0-9]{64}$/.test(row.workspaceSignature)
      || typeof row.batchId !== "string"
      || row.batchId.length < 1
      || row.batchId.length > 191
    ) return null;
    return row as unknown as CatalogWorkspaceCursor;
  } catch {
    return null;
  }
}
