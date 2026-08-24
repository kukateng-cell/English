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
  if (kind === "MISSING_WORD" && !term) throw new Error("CATALOG_FEEDBACK_TERM_REQUIRED");

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
