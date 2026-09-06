import { createHash, randomBytes } from "node:crypto";
import {
  OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
  OBJECTIVE_QUALITY_POLICY_VERSION,
  RETRIEVAL_POLICY_VERSION,
  type ProbePurpose,
  type SelfRating,
  type StreamItemKind,
  type StreamMode,
} from "@/lib/learning-policy/types";
import type { LevelCode } from "@/lib/units";
import type { PublicObjectiveQuestion } from "@/lib/learning-policy/question";

export const STUDY_STREAM_FLOW_VERSION = "v2" as const;
export const STUDY_STREAM_CREDENTIAL_BYTES = 32;
export const STUDY_STREAM_CREDENTIAL_TTL_MS = 15 * 60_000;

export type StudyStreamActionKind =
  | "REVEAL"
  | "SELF_RATING"
  | "OBJECTIVE_ANSWER"
  | "FEEDBACK_ACK";

export interface StudyStreamActionInput {
  flowVersion: typeof STUDY_STREAM_FLOW_VERSION;
  studySessionId: string;
  streamItemId: string;
  operationId: string;
  itemCredential: string;
  actionKind: StudyStreamActionKind;
  clientKnownRevision: number;
  payload:
    | Record<string, never>
    | { selfRating: SelfRating }
    | { selectedOptionId: string }
    ;
}

export interface PublicStreamItemBase {
  streamItemId: string;
  kind: StreamItemKind;
  flowVersion: typeof STUDY_STREAM_FLOW_VERSION;
  policyVersion: typeof RETRIEVAL_POLICY_VERSION;
  qualityPolicyVersion: typeof OBJECTIVE_QUALITY_POLICY_VERSION;
  itemConstructionVersion: typeof OBJECTIVE_ITEM_CONSTRUCTION_VERSION;
  selectionReason: string;
  selectionOverrideReason?: string | null;
  itemCredential: string;
  credentialExpiresAt: string;
  clientRevision: number;
  prompt: string;
  /** Presentation-only context; never used as an action identity or score input. */
  level?: LevelCode;
  category?: string | null;
  direction?: "en-zh" | "zh-en";
  objectiveQuestion?: PublicObjectiveQuestion;
  learningCard?: {
    term: string;
    phonetic: string | null;
    definition: string;
    pos: string | null;
    examples: Array<{ en: string; zh: string }>;
  };
  probePurpose?: ProbePurpose;
  feedback?: {
    selectedOptionId: string;
    correctOptionId: string;
    quality: number;
    isCorrect: boolean;
    acknowledged: boolean;
  };
}

export interface PublicStreamSession {
  id: string;
  flowVersion: typeof STUDY_STREAM_FLOW_VERSION;
  mode: StreamMode;
  policyVersion: typeof RETRIEVAL_POLICY_VERSION;
  revision: number;
  expiresAt: string;
}

export interface PublicStreamUnitSummary {
  totalWordCount: number;
  encounteredWordCount: number;
  objectiveRecognitionCount: number;
}

export interface PublicStreamResponse {
  ok: true;
  assigned: true;
  session: PublicStreamSession;
  item: PublicStreamItemBase | null;
  resumedFeedback: boolean;
  unitSummary?: PublicStreamUnitSummary;
}

export interface PublicStreamActionResponse {
  ok: true;
  operationId: string;
  actionKind: StudyStreamActionKind;
  duplicate: boolean;
  itemStatus: string;
  clientRevision: number;
  requiresFeedbackAck: boolean;
  feedback?: PublicStreamItemBase["feedback"];
  learningCard?: PublicStreamItemBase["learningCard"];
  evidenceObligation?: {
    created: boolean;
    disposition: "accepted" | "already-active" | "debt-cap" | "not-required";
    obligationId: string | null;
  };
  newlyUnlocked?: string[];
  nextItem: PublicStreamItemBase | null;
}

export type StudyStreamActionReconciliation =
  | {
      ok: true;
      terminal: true;
      code:
        | "SUPERSEDED_STREAM_ITEM"
        | "STREAM_ITEM_COMPLETED"
        | "OBJECTIVE_TARGET_CONSUMED"
        | "FEEDBACK_ALREADY_ACKNOWLEDGED";
      message: string;
    }
  | {
      ok: true;
      terminal: false;
    };

const ACTION_KEYS = new Set([
  "flowVersion",
  "studySessionId",
  "streamItemId",
  "operationId",
  "itemCredential",
  "actionKind",
  "clientKnownRevision",
  "payload",
]);

const ACTION_ID_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/u;

export type ParseActionResult =
  | { ok: true; value: StudyStreamActionInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && value.trim() === value;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parsePayload(
  actionKind: StudyStreamActionKind,
  value: unknown,
): StudyStreamActionInput["payload"] | null {
  if (!isRecord(value)) return null;
  if (actionKind === "REVEAL") {
    if (!hasOnlyKeys(value, [])) return null;
    return {};
  }
  if (actionKind === "SELF_RATING") {
    if (!hasOnlyKeys(value, ["selfRating"]) || (value.selfRating !== "selfForgot" && value.selfRating !== "selfRecalled")) return null;
    return { selfRating: value.selfRating };
  }
  if (actionKind === "OBJECTIVE_ANSWER") {
    if (!hasOnlyKeys(value, ["selectedOptionId"]) || !isBoundedString(value.selectedOptionId, 1, 128)) return null;
    return { selectedOptionId: value.selectedOptionId };
  }
  if (!hasOnlyKeys(value, [])) return null;
  return {};
}

export function parseStudyStreamAction(value: unknown): ParseActionResult {
  if (!isRecord(value)) return { ok: false, error: "請求體格式錯誤" };
  if (![...ACTION_KEYS].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return { ok: false, error: "V2 action 欄位不完整" };
  }
  if (!hasOnlyKeys(value, [...ACTION_KEYS])) return { ok: false, error: "V2 action 含有未授權欄位" };
  if (value.flowVersion !== STUDY_STREAM_FLOW_VERSION) return { ok: false, error: "flowVersion 無效" };
  if (!isBoundedString(value.studySessionId, 8, 128)) return { ok: false, error: "studySessionId 無效" };
  if (!isBoundedString(value.streamItemId, 8, 128)) return { ok: false, error: "streamItemId 無效" };
  if (!isBoundedString(value.operationId, 8, 200) || !ACTION_ID_PATTERN.test(value.operationId)) return { ok: false, error: "operationId 無效" };
  if (!isBoundedString(value.itemCredential, 32, 256)) return { ok: false, error: "itemCredential 無效" };
  if (typeof value.actionKind !== "string" || !["REVEAL", "SELF_RATING", "OBJECTIVE_ANSWER", "FEEDBACK_ACK"].includes(value.actionKind)) return { ok: false, error: "actionKind 無效" };
  const clientKnownRevision = value.clientKnownRevision;
  if (typeof clientKnownRevision !== "number" || !Number.isSafeInteger(clientKnownRevision) || clientKnownRevision < 0) return { ok: false, error: "clientKnownRevision 無效" };

  const payload = parsePayload(value.actionKind as StudyStreamActionKind, value.payload);
  if (!payload) return { ok: false, error: "action payload 無效" };
  return {
    ok: true,
    value: {
      flowVersion: STUDY_STREAM_FLOW_VERSION,
      studySessionId: value.studySessionId,
      streamItemId: value.streamItemId,
      operationId: value.operationId,
      itemCredential: value.itemCredential,
      actionKind: value.actionKind as StudyStreamActionKind,
      clientKnownRevision,
      payload,
    },
  };
}

export function createStudyStreamCredential(): string {
  return randomBytes(STUDY_STREAM_CREDENTIAL_BYTES).toString("base64url");
}

export function digestStudyStreamCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

export function canonicalActionPayload(input: StudyStreamActionInput): string {
  return JSON.stringify({
    flowVersion: input.flowVersion,
    studySessionId: input.studySessionId,
    streamItemId: input.streamItemId,
    operationId: input.operationId,
    actionKind: input.actionKind,
    clientKnownRevision: input.clientKnownRevision,
    payload: input.payload,
  });
}

export function actionFingerprint(input: StudyStreamActionInput): string {
  return createHash("sha256").update(canonicalActionPayload(input), "utf8").digest("hex");
}

/**
 * Receipts written before operationId became part of the canonical identity
 * remain replayable during the expand-only rollout. New receipts always use
 * actionFingerprint(); this compatibility helper is only accepted when the
 * operationId lookup already proves the same user-owned operation.
 */
export function legacyActionFingerprint(input: StudyStreamActionInput): string {
  const legacyPayload = JSON.stringify({
    flowVersion: input.flowVersion,
    studySessionId: input.studySessionId,
    streamItemId: input.streamItemId,
    actionKind: input.actionKind,
    clientKnownRevision: input.clientKnownRevision,
    payload: input.payload,
  });
  return createHash("sha256").update(legacyPayload, "utf8").digest("hex");
}
