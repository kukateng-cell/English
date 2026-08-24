import { createHmac, timingSafeEqual } from "node:crypto";

export const CATALOG_FEEDBACK_KINDS = [
  "DEFINITION",
  "LEVEL",
  "PART_OF_SPEECH",
  "PHONETIC",
  "EXAMPLE",
  "DISTRACTOR",
  "INAPPROPRIATE_WORD",
  "MISSING_WORD",
  "OTHER",
] as const;

export type CatalogFeedbackKind = (typeof CATALOG_FEEDBACK_KINDS)[number];
export type CatalogFeedbackStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type CatalogFeedbackScope = "mine" | "review";
export const CATALOG_FEEDBACK_DEFAULT_LIMIT = 50;
export const CATALOG_FEEDBACK_MAX_LIMIT = 100;

type CatalogFeedbackCursor = {
  v: 1;
  scope: CatalogFeedbackScope;
  actorId: string;
  createdAt: string;
  id: string;
};

function feedbackCursorSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("NEXTAUTH_SECRET is required for catalog feedback cursors");
  return "development-only-catalog-feedback-cursor-secret";
}

function feedbackCursorSignature(body: string): string {
  return createHmac("sha256", feedbackCursorSecret()).update("catalog-feedback-v1:").update(body).digest("base64url");
}

export function encodeCatalogFeedbackCursor(value: Omit<CatalogFeedbackCursor, "v">): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
  return `${body}.${feedbackCursorSignature(body)}`;
}

export function decodeCatalogFeedbackCursor(value: string | null | undefined): CatalogFeedbackCursor | null {
  if (!value || Buffer.byteLength(value, "utf8") > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !supplied) return null;
  const expected = feedbackCursorSignature(body);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (
      row.v !== 1
      || (row.scope !== "mine" && row.scope !== "review")
      || typeof row.actorId !== "string"
      || !row.actorId
      || typeof row.createdAt !== "string"
      || !Number.isFinite(Date.parse(row.createdAt))
      || typeof row.id !== "string"
      || !row.id
    ) return null;
    return row as CatalogFeedbackCursor;
  } catch {
    return null;
  }
}

export function parseCatalogFeedbackQuery(searchParams: URLSearchParams): {
  scope: CatalogFeedbackScope;
  limit: number;
  cursor: string | null;
} {
  const allowed = new Set(["scope", "limit", "cursor"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) throw new Error("CATALOG_FEEDBACK_QUERY_INVALID");
  }
  const rawScope = searchParams.get("scope") ?? "mine";
  if (rawScope !== "mine" && rawScope !== "review") throw new Error("CATALOG_FEEDBACK_QUERY_INVALID");
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit)) throw new Error("CATALOG_FEEDBACK_QUERY_INVALID");
  const limit = rawLimit === null ? CATALOG_FEEDBACK_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_FEEDBACK_MAX_LIMIT) throw new Error("CATALOG_FEEDBACK_QUERY_INVALID");
  const cursor = searchParams.get("cursor");
  if (cursor !== null && (!cursor || Buffer.byteLength(cursor, "utf8") > 2048)) throw new Error("CATALOG_FEEDBACK_CURSOR_INVALID");
  return { scope: rawScope, limit, cursor };
}

export type CatalogFeedbackInput = {
  operationId: string;
  senseKey: string | null;
  term: string | null;
  kind: CatalogFeedbackKind;
  message: string;
  suggestedValue: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

export function parseCatalogFeedbackInput(value: unknown): CatalogFeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CATALOG_FEEDBACK_INVALID");
  }
  const source = value as Record<string, unknown>;
  const operationId = text(source.operationId);
  const senseKey = text(source.senseKey) || null;
  const term = text(source.term) || null;
  const kind = text(source.kind);
  const message = text(source.message);
  const suggestedValue = text(source.suggestedValue) || null;

  if (!operationId || operationId.length > 120) throw new Error("CATALOG_FEEDBACK_OPERATION_INVALID");
  if (!CATALOG_FEEDBACK_KINDS.includes(kind as CatalogFeedbackKind)) throw new Error("CATALOG_FEEDBACK_KIND_INVALID");
  if (message.length < 3 || message.length > 2000) throw new Error("CATALOG_FEEDBACK_MESSAGE_INVALID");
  if (suggestedValue && suggestedValue.length > 2000) throw new Error("CATALOG_FEEDBACK_SUGGESTION_INVALID");
  if (senseKey && senseKey.length > 240) throw new Error("CATALOG_FEEDBACK_SENSE_INVALID");
  if (term && term.length > 240) throw new Error("CATALOG_FEEDBACK_TERM_INVALID");
  if (kind === "MISSING_WORD") {
    if (senseKey || !term) throw new Error("CATALOG_FEEDBACK_TARGET_INVALID");
  }
  if (
    ["DEFINITION", "LEVEL", "PART_OF_SPEECH", "PHONETIC", "EXAMPLE", "DISTRACTOR", "INAPPROPRIATE_WORD"].includes(kind)
    && !senseKey
  ) throw new Error("CATALOG_FEEDBACK_SENSE_REQUIRED");

  return {
    operationId,
    senseKey,
    term,
    kind: kind as CatalogFeedbackKind,
    message,
    suggestedValue,
  };
}

export function parseCatalogFeedbackResolution(value: unknown): {
  status: Extract<CatalogFeedbackStatus, "RESOLVED" | "DISMISSED">;
  resolutionNote: string;
  expectedRevision: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CATALOG_FEEDBACK_INVALID");
  }
  const source = value as Record<string, unknown>;
  const status = source.status;
  const resolutionNote = text(source.resolutionNote);
  const expectedRevision = source.expectedRevision;
  if (status !== "RESOLVED" && status !== "DISMISSED") throw new Error("CATALOG_FEEDBACK_STATUS_INVALID");
  if (resolutionNote.length < 3 || resolutionNote.length > 2000) throw new Error("CATALOG_FEEDBACK_RESOLUTION_INVALID");
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error("CATALOG_FEEDBACK_REVISION_INVALID");
  return { status, resolutionNote, expectedRevision: expectedRevision as number };
}

export function canReadCatalogFeedback(input: {
  actorId: string;
  reporterId: string;
  canReview: boolean;
}): boolean {
  return input.canReview || input.actorId === input.reporterId;
}

export function canResolveCatalogFeedback(input: {
  actorId: string;
  reporterId: string;
  canReview: boolean;
  status: CatalogFeedbackStatus;
}): boolean {
  return input.canReview && input.actorId !== input.reporterId && input.status === "OPEN";
}
